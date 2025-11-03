/**
 * Balance Checker
 * 
 * Checks if we have sufficient balances to continue trading after each execution.
 * Pauses trading if funds are too low on either chain.
 */

import BigNumber from 'bignumber.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { GalaConnectClient } from '../bridging/galaConnectClient';
import { resolveGalaEndpoints } from '../bridging/galaEndpoints';
import { getEnabledTokens, getQuoteTokenBySymbol, getTokenConfig } from '../config';
import { StateManager } from './stateManager';
import logger from '../utils/logger';
import { sendAlert } from '../utils/alerts';
import { GalaChainPriceProvider } from './priceProviders/galachain';
import { SolanaPriceProvider } from './priceProviders/solana';
import { getConfig } from '../config';

export interface BalanceCheckResult {
  canTrade: boolean;
  insufficientFunds: InsufficientFund[];
  recommendations: string[];
}

export interface InsufficientFund {
  chain: 'galaChain' | 'solana';
  token: string;
  currentBalance: BigNumber;
  requiredBalance: BigNumber;
  purpose: 'sell' | 'buy' | 'quote';
}

export class BalanceChecker {
  private stateManager: StateManager;
  private gcClient: GalaConnectClient | null = null;
  private solConnection: Connection | null = null;
  private solBalanceRpc: string | null = null; // Track which RPC we're using
  private isPaused: boolean = false;
  private pauseReason: string = '';
  private lastBalanceCheckTime: number = 0;

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
  }

  /**
   * Check if we have sufficient balances for trading
   * Uses price providers to get accurate cost estimates
   * Respects cooldown when paused to avoid excessive API calls
   */
  async checkBalances(usePriceQuotes: boolean = true, forceCheck: boolean = false): Promise<BalanceCheckResult> {
    // If paused, respect cooldown to avoid checking too frequently
    const config = getConfig();
    const cooldownSeconds = (config as any).balanceChecking?.balanceCheckCooldownSeconds || 60;
    const now = Date.now();
    
    if (this.isPaused && !forceCheck) {
      const timeSinceLastCheck = (now - this.lastBalanceCheckTime) / 1000;
      if (timeSinceLastCheck < cooldownSeconds) {
        const remainingSeconds = Math.ceil(cooldownSeconds - timeSinceLastCheck);
        logger.debug(`⏸️ Balance check cooldown: ${remainingSeconds}s remaining (checking once per ${cooldownSeconds}s when paused)`);
        // Return cached result or a "still paused" result
        return {
          canTrade: false,
          insufficientFunds: [],
          recommendations: [`Balance check on cooldown (${remainingSeconds}s remaining). Trading remains paused.`]
        };
      }
    }
    
    this.lastBalanceCheckTime = now;
    const insufficientFunds: InsufficientFund[] = [];
    const recommendations: string[] = [];
    
    try {
      const enabledTokens = getEnabledTokens();
      if (enabledTokens.length === 0) {
        return {
          canTrade: false,
          insufficientFunds: [],
          recommendations: ['No enabled tokens configured']
        };
      }

      // Initialize price providers for accurate cost estimation
      let gcProvider: GalaChainPriceProvider | null = null;
      let solProvider: SolanaPriceProvider | null = null;
      
      if (usePriceQuotes) {
        try {
          gcProvider = new GalaChainPriceProvider();
          solProvider = new SolanaPriceProvider();
          await Promise.all([
            gcProvider.initialize().catch(() => {}),
            solProvider.initialize().catch(() => {})
          ]);
        } catch (error) {
          logger.debug('Price providers unavailable for balance check, using estimates');
        }
      }
      
      // Check GalaChain balances
      await this.checkGalaChainBalances(enabledTokens, insufficientFunds, recommendations, gcProvider);
      
      // Check Solana balances
      await this.checkSolanaBalances(enabledTokens, insufficientFunds, recommendations, solProvider);
      
      // Determine if we can trade
      const canTrade = insufficientFunds.length === 0;
      
      if (!canTrade) {
        this.isPaused = true;
        this.pauseReason = insufficientFunds.map(f => `${f.chain}: ${f.token} (${f.purpose})`).join(', ');
        logger.error(`\n⛔ TRADING PAUSED: Insufficient funds`);
        insufficientFunds.forEach(f => {
          logger.error(`   ${f.chain === 'galaChain' ? '🔷' : '🔸'} ${f.chain.toUpperCase()}: ${f.token}`);
          logger.error(`      Current: ${f.currentBalance.toFixed(8)}`);
          logger.error(`      Required: ${f.requiredBalance.toFixed(8)}`);
          logger.error(`      Purpose: ${f.purpose === 'sell' ? 'SELL (inventory)' : f.purpose === 'buy' ? 'BUY (quote currency)' : 'QUOTE'}`);
        });
        
        // Send alert
        await sendAlert(
          'Trading Paused: Insufficient Funds',
          {
            reason: this.pauseReason,
            details: insufficientFunds.map(f => ({
              chain: f.chain,
              token: f.token,
              current: f.currentBalance.toString(),
              required: f.requiredBalance.toString(),
              purpose: f.purpose
            }))
          },
          'error'
        ).catch(() => {});
      } else {
        // If we previously paused but now have funds, resume
        if (this.isPaused) {
          logger.info(`\n✅ Trading RESUMED: Sufficient funds available`);
          this.isPaused = false;
          this.pauseReason = '';
        }
      }

      return {
        canTrade,
        insufficientFunds,
        recommendations
      };

    } catch (error) {
      logger.error('Failed to check balances', {
        error: error instanceof Error ? error.message : String(error)
      });
      // On error, be conservative and pause
      return {
        canTrade: false,
        insufficientFunds: [{
          chain: 'galaChain',
          token: 'UNKNOWN',
          currentBalance: new BigNumber(0),
          requiredBalance: new BigNumber(0),
          purpose: 'sell'
        }],
        recommendations: ['Balance check failed - trading paused for safety']
      };
    }
  }

  /**
   * Check GalaChain balances
   */
  private async checkGalaChainBalances(
    enabledTokens: any[],
    insufficientFunds: InsufficientFund[],
    recommendations: string[],
    priceProvider?: GalaChainPriceProvider | null
  ): Promise<void> {
    try {
      const owner = process.env.GALACHAIN_WALLET_ADDRESS;
      if (!owner) {
        recommendations.push('GALACHAIN_WALLET_ADDRESS not set');
        return;
      }

      if (!this.gcClient) {
        const ep = resolveGalaEndpoints();
        this.gcClient = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, owner);
      }

      const resp = (await this.gcClient.fetchBalances()) as any;
      
      // Normalize balances response
      let balancesList: any[] = [];
      if (Array.isArray(resp?.balances)) {
        balancesList = resp.balances;
      } else if (Array.isArray(resp?.data?.balances)) {
        balancesList = resp.data.balances;
      } else if (Array.isArray(resp?.Data)) {
        balancesList = resp.Data;
      } else if (Array.isArray(resp)) {
        balancesList = resp;
      }

      // Create balance map
      const balanceMap = new Map<string, BigNumber>();
      balancesList.forEach((entry: any) => {
        let tokenKey: string | undefined;
        let balanceStr: string | undefined;
        
        if (entry.tokenInstance) {
          const ti = entry.tokenInstance;
          tokenKey = `${ti.collection}|${ti.category}|${ti.type}|${ti.additionalKey || 'none'}`;
          balanceStr = entry.balance;
        } else if (entry.token) {
          tokenKey = entry.token;
          balanceStr = entry.balance;
        } else if (entry.collection && entry.category) {
          tokenKey = `${entry.collection}|${entry.category}|${entry.type || 'none'}|${entry.additionalKey || 'none'}`;
          balanceStr = entry.quantity || entry.balance;
        }
        
        if (tokenKey && balanceStr) {
          balanceMap.set(tokenKey, new BigNumber(balanceStr));
        }
      });

      // Get tokens to skip from config
      const config = getConfig();
      const skipTokens = (config as any).balanceChecking?.skipTokens || [];
      
      // Check each enabled token (skip tokens in skipTokens list)
      for (const token of enabledTokens) {
        // Skip tokens that are explicitly excluded from balance checks
        if (skipTokens.includes(token.symbol)) {
          logger.debug(`Skipping balance check for ${token.symbol} (in skipTokens list)`);
          continue;
        }
        
        const [collection, category, type] = token.galaChainMint.split('|');
        const prefix = `${collection}|${category}|${type}`;
        
        // Find matching balance
        let tokenBalance = new BigNumber(0);
        balanceMap.forEach((balance, key) => {
          if (key.startsWith(prefix)) {
            tokenBalance = balance;
          }
        });

        // For forward trades: need token inventory to SELL
        // Check if we have enough to sell
        const requiredForSell = new BigNumber(token.tradeSize || 0);
        if (tokenBalance.isLessThan(requiredForSell)) {
          insufficientFunds.push({
            chain: 'galaChain',
            token: token.symbol,
            currentBalance: tokenBalance,
            requiredBalance: requiredForSell,
            purpose: 'sell'
          });
        }
      }

      // Check GALA balance (only if reverse trades are enabled)
      // Use configurable minimum instead of calculating from trade sizes
      const tradingConfig = (config as any).trading || {};
      const enableReverse = tradingConfig.enableReverseArbitrage !== false;
      const minGalaFromConfig = (config as any).balanceChecking?.minGalaForReverse || 1000;
      
      if (enableReverse) {
        const galaQuoteToken = getQuoteTokenBySymbol('GALA');
        if (galaQuoteToken) {
          const galaKey = galaQuoteToken.galaChainMint;
          const galaBalance = balanceMap.get(galaKey) || new BigNumber(0);
          const minGalaForReverse = new BigNumber(minGalaFromConfig);
          
          // Only check if balance is below configured minimum
          if (galaBalance.isLessThan(minGalaForReverse)) {
            insufficientFunds.push({
              chain: 'galaChain',
              token: 'GALA',
              currentBalance: galaBalance,
              requiredBalance: minGalaForReverse,
              purpose: 'buy'
            });
          }
        }
      }

      // Check SOL (GSOL) balance on GalaChain - needed if SOL is an enabled token
      const solQuoteToken = getQuoteTokenBySymbol('SOL');
      const solEnabledToken = enabledTokens.find(t => t.symbol === 'SOL');
      if (solQuoteToken && solEnabledToken) {
        const solKey = solQuoteToken.galaChainMint; // GSOL|Unit|none|none
        const solBalance = balanceMap.get(solKey) || new BigNumber(0);
        const requiredForSell = new BigNumber(solEnabledToken.tradeSize || 0);
        
        if (solBalance.isLessThan(requiredForSell)) {
          insufficientFunds.push({
            chain: 'galaChain',
            token: 'SOL',
            currentBalance: solBalance,
            requiredBalance: requiredForSell,
            purpose: 'sell'
          });
        }
      }

    } catch (error) {
      logger.error('Failed to check GalaChain balances', {
        error: error instanceof Error ? error.message : String(error)
      });
      recommendations.push('Failed to fetch GalaChain balances');
    }
  }

  /**
   * Check Solana balances
   */
  private async checkSolanaBalances(
    enabledTokens: any[],
    insufficientFunds: InsufficientFund[],
    recommendations: string[],
    priceProvider?: SolanaPriceProvider | null
  ): Promise<void> {
    const config = getConfig();
    
    try {
      const wallet = process.env.SOLANA_WALLET_ADDRESS;
      if (!wallet) {
        recommendations.push('SOLANA_WALLET_ADDRESS not set');
        return;
      }

      // Use dedicated balance RPC if available, otherwise fall back to main RPC
      const balanceRpc = process.env.SOLANA_BALANCE_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      if (!this.solConnection || balanceRpc !== this.solBalanceRpc) {
        // Create new connection if using different RPC or connection doesn't exist
        this.solConnection = new Connection(balanceRpc, 'confirmed');
        this.solBalanceRpc = balanceRpc;
        logger.debug(`Using RPC for balance checks: ${balanceRpc.replace(/\/\/.*@/, '//***@')}`);
      }
      
      const ownerPk = new PublicKey(wallet);
      
      // Get native SOL balance with error handling
      let lamports: number;
      try {
        lamports = await this.solConnection.getBalance(ownerPk, 'confirmed');
        logger.debug(`Solana SOL balance: ${lamports} lamports (${(lamports / 1_000_000_000).toFixed(9)} SOL)`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Failed to fetch SOL balance from Solana RPC', { 
          error: errorMsg,
          rpc: balanceRpc.replace(/\/\/.*@/, '//***@'), // Hide credentials in log
          wallet: wallet.substring(0, 8) + '...' // Hide full wallet
        });
        recommendations.push(`Failed to fetch SOL balance: ${errorMsg}`);
        throw error; // Re-throw to be caught by outer try-catch
      }
      
      const solBalance = new BigNumber(lamports).dividedBy(1_000_000_000);
      
      // Create balance map
      const balanceMap = new Map<string, BigNumber>();
      
      // Add SOL to map (native SOL balance from getBalance - works on Chainstack)
      balanceMap.set('SOL', solBalance);
      balanceMap.set('GSOL', solBalance); // GSOL is SOL on Solana
      
      // Get SPL token balances (this may fail on some RPC providers like Chainstack free tier)
      // Make it optional - we primarily need SOL balance anyway
      try {
        const tokenAccounts = await this.solConnection.getParsedTokenAccountsByOwner(
          ownerPk,
          { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );
        
        // Add SPL tokens to map
        tokenAccounts.value.forEach((acc) => {
          const data = acc.account.data;
          if ((data as any).program === 'spl-token') {
            const info = (data as any).parsed.info;
            const mint = info.mint as string;
            const uiAmount = new BigNumber(
              info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0
            );
            balanceMap.set(mint, uiAmount);
          }
        });
        
        logger.debug(`Fetched ${tokenAccounts.value.length} SPL token accounts`);
      } catch (splError) {
        // getTokenAccountsByOwner may fail on some RPC providers (e.g., Chainstack free tier returns 403)
        // This is okay - we have SOL balance from getBalance() which is what we primarily need
        // Note: This only affects non-SOL tokens (USDC, etc.) - native SOL balance from getBalance() is unaffected
        const errorMsg = splError instanceof Error ? splError.message : String(splError);
        logger.debug('Failed to fetch SPL token balances (non-SOL tokens like USDC). SOL balance from getBalance() is still valid', {
          error: errorMsg,
          note: 'This only affects checking balances of SPL tokens (USDC, etc.), not native SOL'
        });
        recommendations.push(`SPL token balance fetch failed (non-SOL tokens like USDC - may require premium RPC tier). Native SOL balance is unaffected: ${errorMsg}`);
        // Continue without SPL token balances - SOL balance is what matters for balance checks
      }

      // Get tokens to skip from config
      const skipTokensSolana = (config as any).balanceChecking?.skipTokens || [];
      
      // Track which quote currencies we've already checked to avoid duplicates
      const checkedQuoteCurrencies = new Set<string>();
      
      // Check each enabled token (skip disabled ones and skipTokens)
      for (const token of enabledTokens) {
        // Skip disabled tokens
        if (token.enabled === false) {
          continue;
        }
        
        // Skip tokens that are explicitly excluded from balance checks
        if (skipTokensSolana.includes(token.symbol)) {
          logger.debug(`Skipping balance check for ${token.symbol} on Solana (in skipTokens list)`);
          continue;
        }
        
        // Determine quote currency (USDC or SOL)
        const quoteVia = token.solQuoteVia || 'USDC';
        const quoteToken = getQuoteTokenBySymbol(quoteVia);
        
        if (!quoteToken || !quoteToken.solanaMint) {
          recommendations.push(`Quote token ${quoteVia} not configured for Solana`);
          continue;
        }

        // Skip SOL quote currency check here - we'll handle it separately below to avoid duplicates
        if (quoteVia === 'SOL') {
          continue; // Will be checked in the consolidated SOL check below
        }

        // For USDC and other quote currencies: need quote currency to BUY tokens
        const quoteBalance = balanceMap.get(quoteToken.solanaMint) || new BigNumber(0);
        
        // Try to get accurate price quote, otherwise use conservative estimate
        let requiredInQuoteCurrency: BigNumber;
        
        if (priceProvider) {
          try {
            // Get quote to determine actual cost
            const quote = await priceProvider.getQuote(token.symbol, token.tradeSize || 0, false);
            if (quote && quote.price && !quote.price.isZero()) {
              // cost = price * tradeSize
              requiredInQuoteCurrency = quote.price.multipliedBy(token.tradeSize || 0);
              // Add 10% buffer for safety
              requiredInQuoteCurrency = requiredInQuoteCurrency.multipliedBy(1.1);
            } else {
              throw new Error('Quote returned zero price');
            }
          } catch (quoteError) {
            // Fall back to estimate
            logger.debug(`Failed to get quote for balance check, using estimate`, { 
              token: token.symbol,
              error: quoteError instanceof Error ? quoteError.message : String(quoteError)
            });
            requiredInQuoteCurrency = this.estimateRequiredQuoteCurrency(token, quoteVia);
          }
        } else {
          // No price provider, use estimate
          requiredInQuoteCurrency = this.estimateRequiredQuoteCurrency(token, quoteVia);
        }
        
        // Check if we've already checked this quote currency (avoid duplicates)
        if (!checkedQuoteCurrencies.has(quoteVia)) {
          checkedQuoteCurrencies.add(quoteVia);
          
          // Check if we have enough quote currency
          if (quoteBalance.isLessThan(requiredInQuoteCurrency)) {
            insufficientFunds.push({
              chain: 'solana',
              token: quoteVia,
              currentBalance: quoteBalance,
              requiredBalance: requiredInQuoteCurrency,
              purpose: 'buy'
            });
          }
        }

        // For reverse trades: need token inventory on Solana to SELL
        // Check if we have the token on Solana
        if (token.solanaMint) {
          const tokenBalance = balanceMap.get(token.solanaMint) || new BigNumber(0);
          const requiredForSell = new BigNumber(token.tradeSize || 0);
          
          // Note: We don't fail here for reverse trades since forward is primary
          // But we can note it in recommendations
          if (tokenBalance.isLessThan(requiredForSell)) {
            recommendations.push(`Low ${token.symbol} balance on Solana for reverse trades: ${tokenBalance.toFixed(4)}`);
          }
        }
      }

      // Check SOL balance on Solana - needed for:
      // 1. Transaction fees (minimum) - ALWAYS required
      // 2. Quote currency if any enabled token uses SOL as quote (excluding skipTokens)
      const minSolForFeesConfig = (config as any).balanceChecking?.minSolForFees || 0.001;
      const minSolForFees = new BigNumber(minSolForFeesConfig);
      
      // Only check tokens that are enabled and not in skipTokens list
      const solAsQuoteTokens = enabledTokens.filter(t => 
        t.enabled !== false && 
        !skipTokensSolana.includes(t.symbol) &&
        (t.solQuoteVia || 'USDC') === 'SOL'
      );
      
      // Start with minimum for fees (always required)
      let minSolRequired = minSolForFees;
      let solRequiredForTrading = false;
      
      // If any enabled token uses SOL as quote currency, estimate SOL needed
      if (solAsQuoteTokens.length > 0) {
        solRequiredForTrading = true;
        const maxSolTradeSize = Math.max(...solAsQuoteTokens.map(t => t.tradeSize || 0));
        
        // Try to get accurate quote if price provider available
        if (priceProvider) {
          try {
            const testToken = solAsQuoteTokens.find(t => t.tradeSize === maxSolTradeSize);
            if (testToken) {
              const quote = await priceProvider.getQuote(testToken.symbol, testToken.tradeSize, false);
              if (quote && quote.price && !quote.price.isZero()) {
                // Price is in SOL per token, so cost = price * tradeSize
                const solCost = quote.price.multipliedBy(testToken.tradeSize);
                // Add 20% buffer
                minSolRequired = minSolRequired.plus(solCost.multipliedBy(1.2));
              }
            }
          } catch (quoteError) {
            // Fallback: estimate 0.2 SOL per token
            minSolRequired = minSolRequired.plus(new BigNumber(maxSolTradeSize).multipliedBy(0.2));
          }
        } else {
          // No price provider, use conservative estimate
          minSolRequired = minSolRequired.plus(new BigNumber(maxSolTradeSize).multipliedBy(0.2));
        }
      }
      
      // Check if we have enough SOL (only add once, not per token)
      if (solBalance.isLessThan(minSolRequired)) {
        insufficientFunds.push({
          chain: 'solana',
          token: 'SOL',
          currentBalance: solBalance,
          requiredBalance: minSolRequired,
          purpose: solRequiredForTrading ? 'buy' : 'quote' // 'buy' if used as quote, 'quote' if just for fees
        });
      }

    } catch (error) {
      logger.error('Failed to check Solana balances', {
        error: error instanceof Error ? error.message : String(error)
      });
      recommendations.push('Failed to fetch Solana balances');
    }
  }

  /**
   * Check if trading is currently paused
   */
  isTradingPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Get the reason trading is paused
   */
  getPauseReason(): string {
    return this.pauseReason;
  }

  /**
   * Manually pause trading
   */
  pause(reason: string): void {
    this.isPaused = true;
    this.pauseReason = reason;
    logger.warn(`⛔ Trading manually paused: ${reason}`);
  }

  /**
   * Manually resume trading
   */
  resume(): void {
    this.isPaused = false;
    this.pauseReason = '';
    logger.info(`✅ Trading manually resumed`);
  }

  /**
   * Estimate required quote currency when price quotes are unavailable
   */
  private estimateRequiredQuoteCurrency(token: any, quoteVia: string): BigNumber {
    const tradeSize = new BigNumber(token.tradeSize || 0);
    
    if (token.symbol === 'SOL' && quoteVia === 'USDC') {
      // Buying SOL with USDC: estimate ~250 USDC per SOL (conservative)
      return tradeSize.multipliedBy(250);
    } else if (quoteVia === 'SOL') {
      // Buying token with SOL: estimate ~0.2 SOL per token (conservative)
      return tradeSize.multipliedBy(0.2);
    } else {
      // Buying with USDC: estimate ~3 USDC per token (conservative)
      return tradeSize.multipliedBy(3);
    }
  }
}

