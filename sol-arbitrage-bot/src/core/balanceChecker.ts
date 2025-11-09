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
import { IConfigService } from '../config';
import { StateManager } from './stateManager';
import { ArbitrageDirection } from '../types/direction';
import logger from '../utils/logger';
import { sendAlert } from '../utils/alerts';
import { GalaChainPriceProvider } from './priceProviders/galachain';
import { SolanaPriceProvider } from './priceProviders/solana';

export interface BalanceCheckResult {
  canTrade: boolean;
  insufficientFunds: InsufficientFund[];
  recommendations: string[];
  checkedBalances?: {
    galaChain: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>;
    solana: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>;
  };
  totalUsdValue?: {
    galaChain: number;
    solana: number;
    total: number;
  };
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
  private lastBalanceCheckResult: BalanceCheckResult | null = null;

  /**
   * Get the last balance check result (cached)
   */
  getLastBalanceCheckResult(): BalanceCheckResult | null {
    return this.lastBalanceCheckResult;
  }

  constructor(stateManager?: StateManager, private configService?: IConfigService) {
    this.stateManager = stateManager || new StateManager();
    // Use provided config service or create default one
    if (!this.configService) {
      this.configService = require('../config').createConfigService();
    }
  }

  /**
   * Check if we have sufficient balances for trading (BOTH directions)
   * Since we support bidirectional arbitrage, we check all required balances:
   * - Forward: Token on GC (to sell), SOL/USDC on SOL (to buy)
   * - Reverse: GALA on GC (to buy), Token on SOL (to sell)
   * Uses price providers to get accurate cost estimates
   * Respects cooldown when paused to avoid excessive API calls
   * 
   * @param usePriceQuotes - Whether to use price quotes for accurate cost estimation
   * @param forceCheck - Force check even if paused
   * @param direction - DEPRECATED: Now checks both directions. Kept for backward compatibility.
   */
  async checkBalances(
    usePriceQuotes: boolean = true, 
    forceCheck: boolean = false,
    direction?: ArbitrageDirection // Deprecated, now checks both directions
  ): Promise<BalanceCheckResult> {
    // Always respect cooldown to avoid checking too frequently (prevents API rate limiting)
    const config = this.configService!.getConfig();
    const cooldownSeconds = (config as any).balanceChecking?.balanceCheckCooldownSeconds || 60;
    const now = Date.now();
    
    if (!forceCheck) {
      const timeSinceLastCheck = (now - this.lastBalanceCheckTime) / 1000;
      if (timeSinceLastCheck < cooldownSeconds) {
        const remainingSeconds = Math.ceil(cooldownSeconds - timeSinceLastCheck);
        logger.debug(`⏸️ Balance check cooldown: ${remainingSeconds}s remaining (checking once per ${cooldownSeconds}s)`);
        // Return cached result
        return {
          canTrade: this.lastBalanceCheckResult?.canTrade ?? true, // Use cached result if available
          insufficientFunds: this.lastBalanceCheckResult?.insufficientFunds ?? [],
          recommendations: [`Balance check on cooldown (${remainingSeconds}s remaining). Using cached result.`]
        };
      }
    }
    
    this.lastBalanceCheckTime = now;
    const insufficientFunds: InsufficientFund[] = [];
    const recommendations: string[] = [];
    const checkedBalances = {
      galaChain: [] as Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean }>,
      solana: [] as Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean }>
    };
    
    try {
      const enabledTokens = this.configService!.getEnabledTokens();
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
          gcProvider = new GalaChainPriceProvider(this.configService!);
          solProvider = new SolanaPriceProvider(this.configService!);
          await Promise.all([
            gcProvider.initialize().catch(() => {}),
            solProvider.initialize().catch(() => {})
          ]);
        } catch (error) {
          logger.debug('Price providers unavailable for balance check, using estimates');
        }
      }
      
      // Check balances for BOTH directions since we support bidirectional arbitrage
      // This ensures we can trade in either direction when opportunities arise
      // We check all required balances regardless of current direction preference
      
      // FORWARD balances needed:
      // - Token inventory on GalaChain (to sell tokens)
      // - GALA on GalaChain (if gcQuoteVia is GALA, to buy tokens)
      // - SOL/USDC on Solana (to buy tokens)
      
      // REVERSE balances needed:
      // - GALA on GalaChain (to buy tokens)
      // - Token inventory on Solana (to sell tokens)
      
      // Check all token balances on both chains
      await this.checkGalaChainBalances(enabledTokens, insufficientFunds, recommendations, gcProvider, checkedBalances.galaChain, 'forward');
      await this.checkSolanaBalances(enabledTokens, insufficientFunds, recommendations, solProvider, checkedBalances.solana, 'forward');
      
      // Also check reverse-specific balances
      const tradingConfig = this.configService!.getTradingConfig();
      const enableReverse = tradingConfig.enableReverseArbitrage || false;
      if (enableReverse) {
        // Check reverse balances (GALA on GC for buying, tokens on SOL for selling)
        await this.checkGalaChainBalances(enabledTokens, insufficientFunds, recommendations, gcProvider, checkedBalances.galaChain, 'reverse');
        await this.checkSolanaBalances(enabledTokens, insufficientFunds, recommendations, solProvider, checkedBalances.solana, 'reverse');
      }
      
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

      // Calculate USD values for all balances
      let totalUsdValue: { galaChain: number; solana: number; total: number } | undefined;
      if (checkedBalances && (gcProvider || solProvider)) {
        await this.calculateUsdValues(checkedBalances, enabledTokens, gcProvider, solProvider);
        totalUsdValue = this.calculateTotalUsdValue(checkedBalances);
      }

      const result: BalanceCheckResult = {
        canTrade,
        insufficientFunds,
        recommendations,
        checkedBalances,
        totalUsdValue
      };
      
      // Cache the result for cooldown period
      this.lastBalanceCheckResult = result;
      
      return result;

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
    priceProvider?: GalaChainPriceProvider | null,
    checkedBalances?: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean }>,
    direction: ArbitrageDirection = 'forward'
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
      const config = this.configService!.getConfig();
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

        // Determine what we need based on direction and quote currency
        const quoteVia = token.gcQuoteVia || 'GALA';
        
        // ALWAYS check token balance on GalaChain (needed for forward trades - selling tokens)
        // This is required regardless of direction since we support both
        const requiredForSell = new BigNumber(token.tradeSize || 0);
        const sufficientToken = tokenBalance.isGreaterThanOrEqualTo(requiredForSell);
        
        // Track token balance check (always, for visibility)
        if (checkedBalances) {
          // Check if we already have this token in the list (avoid duplicates)
          const existingIndex = checkedBalances.findIndex(b => b.token === token.symbol);
          if (existingIndex >= 0) {
            // Update existing entry if this check is more restrictive
            if (checkedBalances[existingIndex].required.isLessThan(requiredForSell)) {
              checkedBalances[existingIndex].required = requiredForSell;
              checkedBalances[existingIndex].sufficient = sufficientToken;
            }
          } else {
            checkedBalances.push({
              token: token.symbol,
              current: tokenBalance,
              required: requiredForSell,
              purpose: 'sell',
              sufficient: sufficientToken
            });
          }
        }
        
        // Only add to insufficient funds for forward direction (since reverse doesn't need token on GC)
        if (direction === 'forward' && !sufficientToken && quoteVia !== 'GALA') {
          insufficientFunds.push({
            chain: 'galaChain',
            token: token.symbol,
            currentBalance: tokenBalance,
            requiredBalance: requiredForSell,
            purpose: 'sell'
          });
        }
        
        if (direction === 'reverse') {
          // REVERSE: Always need GALA on GC (to buy token)
          // Check GALA balance on GC
          const galaQuoteToken = this.configService!.getQuoteTokenBySymbol('GALA');
          if (galaQuoteToken) {
            const galaKey = galaQuoteToken.galaChainMint;
            const galaBalance = balanceMap.get(galaKey) || new BigNumber(0);
            
            // Estimate GALA needed to buy tradeSize tokens
            let requiredGala: BigNumber;
            if (priceProvider) {
              try {
                const quote = await priceProvider.getQuote(token.symbol, token.tradeSize || 0, true);
                if (quote && quote.price && !quote.price.isZero()) {
                  requiredGala = quote.price.multipliedBy(token.tradeSize || 0);
                  requiredGala = requiredGala.multipliedBy(1.1); // 10% buffer
                } else {
                  requiredGala = new BigNumber(token.tradeSize || 0);
                }
              } catch {
                requiredGala = new BigNumber(token.tradeSize || 0);
              }
            } else {
              requiredGala = new BigNumber(token.tradeSize || 0);
            }
            
            const sufficient = galaBalance.isGreaterThanOrEqualTo(requiredGala);
            
            // Check if GALA already in checkedBalances (avoid duplicates)
            if (checkedBalances) {
              const galaIndex = checkedBalances.findIndex(b => b.token === 'GALA');
              if (galaIndex >= 0) {
                if (checkedBalances[galaIndex].required.isLessThan(requiredGala)) {
                  checkedBalances[galaIndex].required = requiredGala;
                  checkedBalances[galaIndex].sufficient = sufficient;
                }
              } else {
                checkedBalances.push({
                  token: 'GALA',
                  current: galaBalance,
                  required: requiredGala,
                  purpose: 'buy',
                  sufficient
                });
              }
            }
            
            if (!sufficient) {
              insufficientFunds.push({
                chain: 'galaChain',
                token: 'GALA',
                currentBalance: galaBalance,
                requiredBalance: requiredGala,
                purpose: 'buy'
              });
            }
          }
        } else if (quoteVia === 'GALA') {
          // FORWARD: Selling GALA to buy token - need GALA balance
          const galaQuoteToken = this.configService!.getQuoteTokenBySymbol('GALA');
          if (galaQuoteToken) {
            const galaKey = galaQuoteToken.galaChainMint;
            const galaBalance = balanceMap.get(galaKey) || new BigNumber(0);
            
            // Estimate GALA needed to buy tradeSize tokens
            let requiredGala: BigNumber;
            if (priceProvider) {
              try {
                // Get quote to determine actual cost
                const quote = await priceProvider.getQuote(token.symbol, token.tradeSize || 0, false);
                if (quote && quote.price && !quote.price.isZero()) {
                  // cost = price * tradeSize (price is GALA per token)
                  requiredGala = quote.price.multipliedBy(token.tradeSize || 0);
                  // Add 10% buffer for safety
                  requiredGala = requiredGala.multipliedBy(1.1);
                } else {
                  throw new Error('Quote returned zero price');
                }
              } catch (quoteError) {
                // Fall back to using token trade size as rough estimate
                // Assume 1:1 ratio as conservative estimate
                requiredGala = new BigNumber(token.tradeSize || 0);
              }
            } else {
              // No price provider, use conservative estimate
              requiredGala = new BigNumber(token.tradeSize || 0);
            }
            
            const sufficient = galaBalance.isGreaterThanOrEqualTo(requiredGala);
            
            // Track this check
            if (checkedBalances) {
              checkedBalances.push({
                token: 'GALA',
                current: galaBalance,
                required: requiredGala,
                purpose: 'buy',
                sufficient
              });
            }
            
            if (!sufficient) {
              insufficientFunds.push({
                chain: 'galaChain',
                token: 'GALA',
                currentBalance: galaBalance,
                requiredBalance: requiredGala,
                purpose: 'buy'
              });
            }
          }
        }
      }

      // Check GALA balance (only if reverse trades are enabled)
      // Use configurable minimum instead of calculating from trade sizes
      const tradingConfig = (config as any).trading || {};
      const enableReverse = tradingConfig.enableReverseArbitrage !== false;
      const minGalaFromConfig = (config as any).balanceChecking?.minGalaForReverse || 1000;
      
      if (enableReverse) {
        const galaQuoteToken = this.configService!.getQuoteTokenBySymbol('GALA');
        if (galaQuoteToken) {
          const galaKey = galaQuoteToken.galaChainMint;
          const galaBalance = balanceMap.get(galaKey) || new BigNumber(0);
          const minGalaForReverse = new BigNumber(minGalaFromConfig);
          const sufficient = galaBalance.isGreaterThanOrEqualTo(minGalaForReverse);
          
          // Track this check (always, for visibility)
          if (checkedBalances) {
            checkedBalances.push({
              token: 'GALA',
              current: galaBalance,
              required: minGalaForReverse,
              purpose: 'buy',
              sufficient
            });
          }
          
          if (!sufficient) {
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

      // Note: SOL on GalaChain is already checked in the loop above if it's an enabled token
      // No need to check it separately here - that would create duplicates

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
    priceProvider?: SolanaPriceProvider | null,
    checkedBalances?: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>,
    direction: ArbitrageDirection = 'forward'
  ): Promise<void> {
    const config = this.configService!.getConfig();
    
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
        const quoteVia = token.solQuoteVia || 'SOL'; // Default to SOL instead of USDC
        
        // Skip SOL quote currency check here - we'll handle it separately below to avoid duplicates
        // SOL is native token, doesn't need solanaMint check
        if (quoteVia === 'SOL') {
          continue; // Will be checked in the consolidated SOL check below
        }
        
        // For non-SOL quote tokens, check if configured
        const quoteToken = this.configService!.getQuoteTokenBySymbol(quoteVia);
        if (!quoteToken || !quoteToken.solanaMint) {
          recommendations.push(`Quote token ${quoteVia} not configured for Solana`);
          continue;
        }

        // Only check quote currencies that are actually being used by enabled tokens
        // Skip USDC and other quote currencies if no enabled tokens use them
        const tokensUsingThisQuote = enabledTokens.filter(t => 
          t.enabled !== false && 
          !skipTokensSolana.includes(t.symbol) &&
          (t.solQuoteVia || 'SOL') === quoteVia
        );
        
        if (tokensUsingThisQuote.length === 0) {
          logger.debug(`Skipping ${quoteVia} balance check - no enabled tokens use it as quote currency`);
          continue;
        }

        // For USDC and other quote currencies: need quote currency to BUY tokens
        // SOL is native token, others are SPL tokens
        let quoteBalance: BigNumber;
        if (quoteVia === 'SOL') {
          // SOL is native - use native balance
          quoteBalance = balanceMap.get('SOL') || new BigNumber(0);
        } else {
          // SPL tokens - lookup by mint address
          quoteBalance = balanceMap.get(quoteToken.solanaMint) || new BigNumber(0);
        }
        
        // Try to get accurate price quote, otherwise use conservative estimate
        let requiredInQuoteCurrency: BigNumber;
        
        if (priceProvider) {
          try {
            // Get quote to determine actual cost (use reverse for reverse direction)
            const reverse = direction === 'reverse';
            const quote = await priceProvider.getQuote(token.symbol, token.tradeSize || 0, reverse);
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
          
          const sufficient = quoteBalance.isGreaterThanOrEqualTo(requiredInQuoteCurrency);
          
          // Track this check
          if (checkedBalances) {
            checkedBalances.push({
              token: quoteVia,
              current: quoteBalance,
              required: requiredInQuoteCurrency,
              purpose: 'buy',
              sufficient
            });
          }
          
          // Check if we have enough quote currency
          if (!sufficient) {
            insufficientFunds.push({
              chain: 'solana',
              token: quoteVia,
              currentBalance: quoteBalance,
              requiredBalance: requiredInQuoteCurrency,
              purpose: 'buy'
            });
          }
        }

        // ALWAYS check token balance on Solana (needed for reverse trades - selling tokens)
        // This is required regardless of direction since we support both
        // Special handling: SOL is native token, not SPL
        let tokenBalance: BigNumber;
        if (token.symbol === 'SOL') {
          // SOL is native token - use native SOL balance
          tokenBalance = balanceMap.get('SOL') || new BigNumber(0);
        } else if (token.solanaMint) {
          // For SPL tokens, lookup by mint address
          tokenBalance = balanceMap.get(token.solanaMint) || new BigNumber(0);
        } else {
          // No mint address configured - skip this token
          continue;
        }
        
        const requiredForSell = new BigNumber(token.tradeSize || 0);
        const sufficient = tokenBalance.isGreaterThanOrEqualTo(requiredForSell);
        
        // Track this check (always, for visibility)
        if (checkedBalances) {
          // Check if we already have this token in the list (avoid duplicates)
          const existingIndex = checkedBalances.findIndex(b => b.token === token.symbol);
          if (existingIndex >= 0) {
            // Update existing entry if this check is more restrictive
            if (checkedBalances[existingIndex].required.isLessThan(requiredForSell)) {
              checkedBalances[existingIndex].required = requiredForSell;
              checkedBalances[existingIndex].sufficient = sufficient;
            }
          } else {
            checkedBalances.push({
              token: token.symbol,
              current: tokenBalance,
              required: requiredForSell,
              purpose: 'sell',
              sufficient
            });
          }
        }
        
        // Only add to insufficient funds for reverse direction (since forward doesn't need token on SOL)
        if (direction === 'reverse' && !sufficient) {
          insufficientFunds.push({
            chain: 'solana',
            token: token.symbol,
            currentBalance: tokenBalance,
            requiredBalance: requiredForSell,
            purpose: 'sell'
          });
        } else if (direction === 'forward' && !sufficient) {
          // For forward, note in recommendations (not blocking)
          recommendations.push(`Low ${token.symbol} balance on Solana for reverse trades: ${tokenBalance.toFixed(4)}`);
        }
      }

      // Check SOL balance on Solana - needed for:
      // 1. Transaction fees (minimum) - ALWAYS required
      // 2. Quote currency if any enabled token uses SOL as quote (excluding skipTokens)
      const minSolForFeesConfig = (config as any).balanceChecking?.minSolForFees || 0.001;
      const minSolForFees = new BigNumber(minSolForFeesConfig);
      
      // Only check tokens that are enabled and not in skipTokens list
      // Exclude SOL token itself - for SOL arbitrage, we're selling SOL to get GALA, not buying SOL with SOL
      const solAsQuoteTokens = enabledTokens.filter(t => 
        t.enabled !== false && 
        !skipTokensSolana.includes(t.symbol) &&
        t.symbol !== 'SOL' && // Exclude SOL token - it's the asset being traded, not a quote currency
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
      
      // ALWAYS check SOL balance on Solana (for visibility)
      const solSufficient = solBalance.isGreaterThanOrEqualTo(minSolRequired);
      
      // Track this check (always, for visibility)
      if (checkedBalances) {
        checkedBalances.push({
          token: 'SOL',
          current: solBalance,
          required: minSolRequired,
          purpose: solRequiredForTrading ? 'buy' : 'quote',
          sufficient: solSufficient
        });
      }
      
      if (!solSufficient) {
        insufficientFunds.push({
          chain: 'solana',
          token: 'SOL',
          currentBalance: solBalance,
          requiredBalance: minSolRequired,
          purpose: solRequiredForTrading ? 'buy' : 'quote' // 'buy' if used as quote, 'quote' if just for fees
        });
      }

      // Check GALA balance on Solana (if reverse trades enabled or for visibility)
      // GALA on Solana is an SPL token that might be needed for certain operations
      const tradingConfig = (config as any).trading || {};
      const enableReverse = tradingConfig.enableReverseArbitrage !== false;
      const minGalaOnSolana = (config as any).balanceChecking?.minGalaOnSolana || 0; // Optional minimum, default 0
      
      // Only check if there's a minimum requirement or reverse trades are enabled
      if (enableReverse || minGalaOnSolana > 0) {
        const galaQuoteToken = this.configService!.getQuoteTokenBySymbol('GALA');
        if (galaQuoteToken && galaQuoteToken.solanaMint) {
          const galaBalance = balanceMap.get(galaQuoteToken.solanaMint) || new BigNumber(0);
          const minGalaRequired = new BigNumber(minGalaOnSolana);
          const galaSufficient = galaBalance.isGreaterThanOrEqualTo(minGalaRequired);
          
          // Track this check (always, for visibility)
          if (checkedBalances) {
            checkedBalances.push({
              token: 'GALA',
              current: galaBalance,
              required: minGalaRequired,
              purpose: minGalaRequired.isGreaterThan(0) ? 'quote' : 'info', // 'quote' if there's a requirement, 'info' if just for visibility
              sufficient: galaSufficient
            });
          }
          
          // Only add to insufficientFunds if there's an actual minimum requirement
          if (minGalaRequired.isGreaterThan(0) && !galaSufficient) {
            insufficientFunds.push({
              chain: 'solana',
              token: 'GALA',
              currentBalance: galaBalance,
              requiredBalance: minGalaRequired,
              purpose: 'quote'
            });
          }
        }
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
   * Calculate USD values for all checked balances
   */
  private async calculateUsdValues(
    checkedBalances: {
      galaChain: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>;
      solana: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>;
    },
    enabledTokens: any[],
    gcProvider?: GalaChainPriceProvider | null,
    solProvider?: SolanaPriceProvider | null
  ): Promise<void> {
    try {
      // Get base USD prices
      let galaUsdPrice = 0;
      let solUsdPrice = 0;

      if (gcProvider) {
        try {
          galaUsdPrice = gcProvider.getGALAUSDPrice();
        } catch (error) {
          logger.debug('Failed to get GALA/USD price for USD value calculation', { error });
        }
      }

      if (solProvider) {
        try {
          solUsdPrice = solProvider.getSOLUSDPrice();
        } catch (error) {
          logger.debug('Failed to get SOL/USD price for USD value calculation', { error });
        }
      }

      // Create token config map for quick lookup
      const tokenConfigMap = new Map<string, any>();
      enabledTokens.forEach(token => {
        tokenConfigMap.set(token.symbol, token);
      });

      // Calculate USD values for GalaChain balances
      for (const balance of checkedBalances.galaChain) {
        let usdValue = 0;

        // Handle known quote currencies (GALA, SOL) even if not in enabled tokens
        if (balance.token === 'GALA') {
          // Direct GALA to USD
          if (galaUsdPrice > 0) {
            usdValue = balance.current.multipliedBy(galaUsdPrice).toNumber();
          }
        } else if (balance.token === 'SOL' || balance.token === 'GSOL') {
          // SOL to USD
          if (solUsdPrice > 0) {
            usdValue = balance.current.multipliedBy(solUsdPrice).toNumber();
          }
        } else {
          // For other tokens, need token config to get quote
          const tokenConfig = tokenConfigMap.get(balance.token);
          if (tokenConfig && gcProvider && galaUsdPrice > 0) {
            // Try to get token price in GALA, then convert to USD
            try {
              // Get a small quote to determine price (1 token)
              const quote = await gcProvider.getQuote(balance.token, 1, false);
              if (quote && quote.price) {
                // Price is in GALA per token
                const priceInGala = quote.price;
                const usdValuePerToken = priceInGala.multipliedBy(galaUsdPrice);
                usdValue = balance.current.multipliedBy(usdValuePerToken).toNumber();
              }
            } catch (error) {
              logger.debug(`Failed to get price for ${balance.token} on GalaChain`, { error });
            }
          }
        }

        balance.usdValue = usdValue;
      }

      // Calculate USD values for Solana balances
      for (const balance of checkedBalances.solana) {
        let usdValue = 0;

        // Handle known quote currencies (SOL, GALA) even if not in enabled tokens
        if (balance.token === 'SOL' || balance.token === 'GSOL') {
          // Direct SOL to USD
          if (solUsdPrice > 0) {
            usdValue = balance.current.multipliedBy(solUsdPrice).toNumber();
          }
        } else if (balance.token === 'GALA') {
          // GALA to USD
          if (galaUsdPrice > 0) {
            usdValue = balance.current.multipliedBy(galaUsdPrice).toNumber();
          }
        } else {
          // For other tokens, need token config to get quote
          const tokenConfig = tokenConfigMap.get(balance.token);
          if (tokenConfig && solProvider && (galaUsdPrice > 0 || solUsdPrice > 0)) {
            // Try to get token price in quote currency, then convert to USD
            try {
              const quoteCurrency = tokenConfig.solQuoteVia || 'USDC';
              // Get a small quote to determine price (1 token)
              const quote = await solProvider.getQuote(balance.token, 1, false, quoteCurrency);
              if (quote && quote.price) {
                if (quoteCurrency === 'USDC') {
                  // USDC is 1:1 with USD
                  usdValue = balance.current.multipliedBy(quote.price).toNumber();
                } else if (quoteCurrency === 'SOL') {
                  // SOL price, convert to USD
                  const priceInSol = quote.price;
                  usdValue = balance.current.multipliedBy(priceInSol).multipliedBy(solUsdPrice).toNumber();
                } else if (quoteCurrency === 'GALA') {
                  // GALA price, convert to USD
                  const priceInGala = quote.price;
                  usdValue = balance.current.multipliedBy(priceInGala).multipliedBy(galaUsdPrice).toNumber();
                }
              }
            } catch (error) {
              logger.debug(`Failed to get price for ${balance.token} on Solana`, { error });
            }
          }
        }

        balance.usdValue = usdValue;
      }
    } catch (error) {
      logger.warn('Failed to calculate USD values for balances', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Calculate total USD value across all balances
   */
  private calculateTotalUsdValue(
    checkedBalances: {
      galaChain: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>;
      solana: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean; usdValue?: number }>;
    }
  ): { galaChain: number; solana: number; total: number } {
    // Deduplicate by token (keep highest USD value if duplicates exist)
    const gcMap = new Map<string, number>();
    const solMap = new Map<string, number>();

    for (const balance of checkedBalances.galaChain) {
      const existing = gcMap.get(balance.token) || 0;
      gcMap.set(balance.token, Math.max(existing, balance.usdValue || 0));
    }

    for (const balance of checkedBalances.solana) {
      const existing = solMap.get(balance.token) || 0;
      solMap.set(balance.token, Math.max(existing, balance.usdValue || 0));
    }

    const galaChainTotal = Array.from(gcMap.values()).reduce((sum, val) => sum + val, 0);
    const solanaTotal = Array.from(solMap.values()).reduce((sum, val) => sum + val, 0);

    return {
      galaChain: galaChainTotal,
      solana: solanaTotal,
      total: galaChainTotal + solanaTotal
    };
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

