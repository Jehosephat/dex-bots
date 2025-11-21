/**
 * Auto-Bridge Service
 * 
 * Automatically rebalances token inventories across GalaChain and Solana
 * when imbalances are detected (>80% on one chain, <20% on the other).
 */

import BigNumber from 'bignumber.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { IConfigService } from '../config';
import { TokenConfig } from '../types/config';
import { BalanceChecker } from '../core/balanceChecker';
import { BridgeManager } from './bridgeManager';
import { BridgeStateTracker } from './bridgeStateTracker';
import { GalaConnectClient } from './galaConnectClient';
import { resolveGalaEndpoints } from './galaEndpoints';
import { GalaChainPriceProvider } from '../core/priceProviders/galachain';
import { SolanaPriceProvider } from '../core/priceProviders/solana';
import logger from '../utils/logger';

export interface ImbalanceResult {
  needsRebalancing: boolean;
  token: string;
  gcBalance: BigNumber;
  solBalance: BigNumber;
  totalBalance: BigNumber;
  gcPercent: number;
  solPercent: number;
  direction?: 'galaChain->solana' | 'solana->galaChain';
  bridgeAmount?: BigNumber;
  reason?: string;
}

export interface BridgeResult {
  success: boolean;
  token: string;
  amount: BigNumber;
  direction: 'galaChain->solana' | 'solana->galaChain';
  hash?: string;
  error?: string;
}

export class AutoBridgeService {
  constructor(
    private configService: IConfigService,
    private balanceChecker: BalanceChecker,
    private bridgeManager: BridgeManager,
    private bridgeStateTracker: BridgeStateTracker,
    private gcPriceProvider: GalaChainPriceProvider,
    private solPriceProvider: SolanaPriceProvider
  ) {}

  /**
   * Check if rebalancing is needed for a specific token
   * @param token Token configuration
   * @param balances Optional pre-fetched balances to avoid duplicate API calls
   */
  async checkImbalance(
    token: TokenConfig,
    balances?: { gcBalance: BigNumber; solBalance: BigNumber }
  ): Promise<ImbalanceResult> {
    const autoBridgingConfig = this.configService.getAutoBridgingConfig();
    if (!autoBridgingConfig || !autoBridgingConfig.enabled) {
      return {
        needsRebalancing: false,
        token: token.symbol,
        gcBalance: new BigNumber(0),
        solBalance: new BigNumber(0),
        totalBalance: new BigNumber(0),
        gcPercent: 0,
        solPercent: 0,
        reason: 'Auto-bridging disabled',
      };
    }

    // Check if token is enabled/disabled for auto-bridging
    if (autoBridgingConfig.skipTokens.includes(token.symbol)) {
      return {
        needsRebalancing: false,
        token: token.symbol,
        gcBalance: new BigNumber(0),
        solBalance: new BigNumber(0),
        totalBalance: new BigNumber(0),
        gcPercent: 0,
        solPercent: 0,
        reason: `Token ${token.symbol} is in skipTokens list`,
      };
    }

    if (autoBridgingConfig.enabledTokens.length > 0 && !autoBridgingConfig.enabledTokens.includes(token.symbol)) {
      return {
        needsRebalancing: false,
        token: token.symbol,
        gcBalance: new BigNumber(0),
        solBalance: new BigNumber(0),
        totalBalance: new BigNumber(0),
        gcPercent: 0,
        solPercent: 0,
        reason: `Token ${token.symbol} not in enabledTokens list`,
      };
    }

    // Use provided balances or fetch them
    let gcBalance: BigNumber;
    let solBalance: BigNumber;
    
    if (balances) {
      gcBalance = balances.gcBalance;
      solBalance = balances.solBalance;
    } else {
      const fetchedBalances = await this.fetchTokenBalances(token);
      gcBalance = fetchedBalances.gcBalance;
      solBalance = fetchedBalances.solBalance;
    }
    const totalBalance = gcBalance.plus(solBalance);

    if (totalBalance.isZero()) {
      return {
        needsRebalancing: false,
        token: token.symbol,
        gcBalance,
        solBalance,
        totalBalance,
        gcPercent: 0,
        solPercent: 0,
        reason: 'No balance on either chain',
      };
    }

    // Calculate percentages
    const gcPercent = gcBalance.dividedBy(totalBalance).multipliedBy(100).toNumber();
    const solPercent = solBalance.dividedBy(totalBalance).multipliedBy(100).toNumber();

    const threshold = autoBridgingConfig.imbalanceThresholdPercent;
    const targetPercent = autoBridgingConfig.targetSplitPercent;

    // Check for imbalance
    let direction: 'galaChain->solana' | 'solana->galaChain' | undefined;
    let bridgeAmount: BigNumber | undefined;

    // GC has too much (>threshold) and SOL has too little (<100-threshold)
    if (gcPercent > threshold && solPercent < (100 - threshold)) {
      direction = 'galaChain->solana';
      const targetGcAmount = totalBalance.multipliedBy(targetPercent / 100);
      bridgeAmount = gcBalance.minus(targetGcAmount);
    }
    // SOL has too much (>threshold) and GC has too little (<100-threshold)
    else if (solPercent > threshold && gcPercent < (100 - threshold)) {
      direction = 'solana->galaChain';
      const targetSolAmount = totalBalance.multipliedBy(targetPercent / 100);
      bridgeAmount = solBalance.minus(targetSolAmount);
    }

    if (!direction || !bridgeAmount) {
      return {
        needsRebalancing: false,
        token: token.symbol,
        gcBalance,
        solBalance,
        totalBalance,
        gcPercent,
        solPercent,
        reason: 'No imbalance detected',
      };
    }

    // Validate bridge amount
    if (bridgeAmount.isLessThan(autoBridgingConfig.minRebalanceAmount)) {
      return {
        needsRebalancing: false,
        token: token.symbol,
        gcBalance,
        solBalance,
        totalBalance,
        gcPercent,
        solPercent,
        direction,
        bridgeAmount,
        reason: `Bridge amount ${bridgeAmount.toFixed(8)} is below minimum ${autoBridgingConfig.minRebalanceAmount}`,
      };
    }

    return {
      needsRebalancing: true,
      token: token.symbol,
      gcBalance,
      solBalance,
      totalBalance,
      gcPercent,
      solPercent,
      direction,
      bridgeAmount,
    };
  }

  /**
   * Calculate bridge amount to reach target split
   */
  calculateBridgeAmount(
    totalBalance: BigNumber,
    gcBalance: BigNumber,
    solBalance: BigNumber,
    targetPercent: number
  ): BigNumber {
    const targetGcAmount = totalBalance.multipliedBy(targetPercent / 100);
    const targetSolAmount = totalBalance.multipliedBy((100 - targetPercent) / 100);

    if (gcBalance.isGreaterThan(targetGcAmount)) {
      // Bridge from GC to SOL
      return gcBalance.minus(targetGcAmount);
    } else if (solBalance.isGreaterThan(targetSolAmount)) {
      // Bridge from SOL to GC
      return solBalance.minus(targetSolAmount);
    }

    return new BigNumber(0);
  }

  /**
   * Execute bridge operation
   */
  async executeBridge(
    token: TokenConfig,
    amount: BigNumber,
    direction: 'galaChain->solana' | 'solana->galaChain'
  ): Promise<BridgeResult> {
    try {
      if (direction === 'galaChain->solana') {
        const result = await this.bridgeManager.executeBridgeOut({
          symbol: token.symbol,
          amount: amount,
          recipient: process.env.SOLANA_WALLET_ADDRESS,
          destination: 'Solana',
        });

        if (result.success && result.transactionHash) {
          // Record bridge in state tracker
          this.bridgeStateTracker.recordBridge(
            token.symbol,
            amount,
            direction,
            result.transactionHash
          );

          logger.info(`✅ Bridge completed: ${amount.toFixed(8)} ${token.symbol} from GalaChain → Solana (tx: ${result.transactionHash})`);
          return {
            success: true,
            token: token.symbol,
            amount,
            direction,
            hash: result.transactionHash,
          };
        } else {
          logger.error(`❌ Bridge failed: ${result.error || 'Unknown error'}`);
          return {
            success: false,
            token: token.symbol,
            amount,
            direction,
            error: result.error || 'Unknown error',
          };
        }
      } else {
        // Solana → GalaChain bridging
        const result = await this.bridgeManager.executeBridgeIn({
          symbol: token.symbol,
          amount: amount,
          recipient: process.env.GALACHAIN_WALLET_ADDRESS,
        });

        if (result.success && result.transactionHash) {
          // Record bridge in state tracker
          this.bridgeStateTracker.recordBridge(
            token.symbol,
            amount,
            direction,
            result.transactionHash
          );

          logger.info(`✅ Bridge completed: ${amount.toFixed(8)} ${token.symbol} from Solana → GalaChain (tx: ${result.transactionHash})`);
          return {
            success: true,
            token: token.symbol,
            amount,
            direction,
            hash: result.transactionHash,
          };
        } else {
          logger.error(`❌ Bridge failed: ${result.error || 'Unknown error'}`);
          return {
            success: false,
            token: token.symbol,
            amount,
            direction,
            error: result.error || 'Unknown error',
          };
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Bridge execution failed for ${token.symbol}`, { error: errorMessage });
      return {
        success: false,
        token: token.symbol,
        amount,
        direction,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if bridging is allowed (rate limits and cooldowns)
   * Cooldowns prevent back-to-back bridges before balances can update
   */
  canBridge(token: string): boolean {
    const autoBridgingConfig = this.configService.getAutoBridgingConfig();
    if (!autoBridgingConfig || !autoBridgingConfig.enabled) {
      return false;
    }

    // Check daily limit
    if (this.bridgeStateTracker.hasExceededDailyLimit(token, autoBridgingConfig.maxBridgesPerDay)) {
      logger.info(`Token ${token} has exceeded daily bridge limit (${autoBridgingConfig.maxBridgesPerDay})`);
      return false;
    }

    // Check cooldown period - prevent back-to-back bridges before balances update
    if (this.bridgeStateTracker.isInCooldown(token, autoBridgingConfig.cooldownMinutes)) {
      const remaining = this.bridgeStateTracker.getRemainingCooldown(token, autoBridgingConfig.cooldownMinutes);
      logger.info(`Token ${token} is in cooldown period: ${remaining.toFixed(1)} minutes remaining (${autoBridgingConfig.cooldownMinutes} min cooldown)`);
      return false;
    }

    return true;
  }

  /**
   * Fetch token balances on both chains
   */
  private async fetchTokenBalances(token: TokenConfig): Promise<{
    gcBalance: BigNumber;
    solBalance: BigNumber;
  }> {
    // Fetch GalaChain balance
    const gcBalance = await this.fetchGalaChainBalance(token);
    
    // Fetch Solana balance
    const solBalance = await this.fetchSolanaBalance(token);

    return { gcBalance, solBalance };
  }

  /**
   * Fetch GalaChain balance for a specific token
   */
  private async fetchGalaChainBalance(token: TokenConfig): Promise<BigNumber> {
    try {
      const owner = process.env.GALACHAIN_WALLET_ADDRESS;
      if (!owner) {
        logger.warn('GALACHAIN_WALLET_ADDRESS not set');
        return new BigNumber(0);
      }

      const ep = resolveGalaEndpoints();
      const client = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, owner);
      const resp = (await client.fetchBalances()) as any;

      // Normalize response format
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

      // Parse token descriptor
      const [collection, category, type, additionalKey] = token.galaChainMint.split('|');
      const tokenKey = `${collection}|${category}|${type}|${additionalKey || 'none'}`;

      // Find matching balance
      for (const entry of balancesList) {
        let entryKey: string | undefined;
        if (entry.tokenInstance) {
          const ti = entry.tokenInstance;
          entryKey = `${ti.collection}|${ti.category}|${ti.type}|${ti.additionalKey || 'none'}`;
        } else if (entry.collection && entry.category) {
          entryKey = `${entry.collection}|${entry.category}|${entry.type || 'none'}|${entry.additionalKey || 'none'}`;
        }
        
        if (entryKey === tokenKey) {
          const balanceStr = entry.balance || entry.quantity || '0';
          return new BigNumber(balanceStr);
        }
      }

      return new BigNumber(0);
    } catch (error) {
      logger.error(`Failed to fetch GalaChain balance for ${token.symbol}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return new BigNumber(0);
    }
  }

  /**
   * Fetch Solana balance for a specific token
   */
  private async fetchSolanaBalance(token: TokenConfig): Promise<BigNumber> {
    try {
      const wallet = process.env.SOLANA_WALLET_ADDRESS;
      if (!wallet) {
        logger.warn('SOLANA_WALLET_ADDRESS not set');
        return new BigNumber(0);
      }

      const rpcUrl = process.env.SOLANA_BALANCE_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      const ownerPk = new PublicKey(wallet);

      // For native SOL (if token is SOL/GSOL)
      if (token.symbol === 'SOL' || token.symbol === 'GSOL') {
        const lamports = await connection.getBalance(ownerPk, 'confirmed');
        return new BigNumber(lamports).dividedBy(1_000_000_000);
      }

      // For SPL tokens
      if (!token.solanaMint) {
        return new BigNumber(0);
      }

      const mintPk = new PublicKey(token.solanaMint);
      
      // Get all token accounts (works on free tier RPCs)
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        ownerPk,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      // Filter by mint in code
      for (const acc of tokenAccounts.value) {
        const data = acc.account.data;
        if ((data as any).program === 'spl-token') {
          const info = (data as any).parsed.info;
          if (info.mint === token.solanaMint) {
            const uiAmount = info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0;
            return new BigNumber(uiAmount);
          }
        }
      }

      return new BigNumber(0);
    } catch (error) {
      logger.error(`Failed to fetch Solana balance for ${token.symbol}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return new BigNumber(0);
    }
  }

  /**
   * Check all enabled tokens for imbalances and return recommendations
   * @param balanceCheckResult Optional pre-fetched balance check result to avoid duplicate API calls
   */
  async checkAllTokens(balanceCheckResult?: {
    checkedBalances?: {
      galaChain: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean }>;
      solana: Array<{ token: string; current: BigNumber; required: BigNumber; purpose: string; sufficient: boolean }>;
    };
  }): Promise<{
    needsRebalancing: boolean;
    recommendations: ImbalanceResult[];
  }> {
    const autoBridgingConfig = this.configService.getAutoBridgingConfig();
    if (!autoBridgingConfig || !autoBridgingConfig.enabled) {
      return {
        needsRebalancing: false,
        recommendations: [],
      };
    }

    const enabledTokens = this.configService.getEnabledTokens();
    const recommendations: ImbalanceResult[] = [];

    // Build balance map from pre-fetched data if available
    const balanceMap = new Map<string, { gcBalance: BigNumber; solBalance: BigNumber }>();
    if (balanceCheckResult?.checkedBalances) {
      for (const gcCheck of balanceCheckResult.checkedBalances.galaChain) {
        const existing = balanceMap.get(gcCheck.token) || { gcBalance: new BigNumber(0), solBalance: new BigNumber(0) };
        existing.gcBalance = gcCheck.current;
        balanceMap.set(gcCheck.token, existing);
      }
      for (const solCheck of balanceCheckResult.checkedBalances.solana) {
        const existing = balanceMap.get(solCheck.token) || { gcBalance: new BigNumber(0), solBalance: new BigNumber(0) };
        existing.solBalance = solCheck.current;
        balanceMap.set(solCheck.token, existing);
      }
    }

    for (const token of enabledTokens) {
      // Check if token should be skipped
      if (autoBridgingConfig.skipTokens.includes(token.symbol)) {
        continue;
      }

      // Check if token is in enabled list (if specified)
      if (autoBridgingConfig.enabledTokens.length > 0 && !autoBridgingConfig.enabledTokens.includes(token.symbol)) {
        continue;
      }

      // Use pre-fetched balances if available, otherwise fetch
      const preFetchedBalances = balanceMap.get(token.symbol);
      
      if (!preFetchedBalances && balanceCheckResult?.checkedBalances) {
        logger.debug(`Token ${token.symbol} not found in balance check results, will fetch directly`);
      }
      
      const imbalance = await this.checkImbalance(token, preFetchedBalances);
      
      // Log imbalance check result for debugging
      if (imbalance.needsRebalancing) {
        logger.info(`🔍 Imbalance detected for ${token.symbol}: GC ${imbalance.gcPercent.toFixed(2)}%, SOL ${imbalance.solPercent.toFixed(2)}%`);
      } else if (imbalance.reason && imbalance.reason !== 'No imbalance detected') {
        logger.debug(`Token ${token.symbol} imbalance check: ${imbalance.reason}`);
      }
      
      if (imbalance.needsRebalancing) {
        // Check if bridging is allowed (rate limits and cooldowns)
        if (this.canBridge(token.symbol)) {
          recommendations.push(imbalance);
        } else {
          // canBridge() already logs the reason (daily limit or cooldown)
          logger.debug(`Token ${token.symbol} needs rebalancing but bridging is not allowed (check logs above for reason)`);
        }
      }
    }

    return {
      needsRebalancing: recommendations.length > 0,
      recommendations,
    };
  }

  /**
   * Execute rebalancing for a token
   */
  async rebalance(imbalance: ImbalanceResult): Promise<BridgeResult> {
    const token = this.configService.getTokenConfig(imbalance.token);
    if (!token) {
      return {
        success: false,
        token: imbalance.token,
        amount: imbalance.bridgeAmount || new BigNumber(0),
        direction: imbalance.direction || 'galaChain->solana',
        error: `Token ${imbalance.token} not found in configuration`,
      };
    }

    if (!imbalance.bridgeAmount || !imbalance.direction) {
      return {
        success: false,
        token: imbalance.token,
        amount: new BigNumber(0),
        direction: 'galaChain->solana',
        error: 'Invalid imbalance result - missing bridge amount or direction',
      };
    }

    logger.info(`🔍 Imbalance detected: ${imbalance.token} - GC: ${imbalance.gcPercent.toFixed(2)}%, SOL: ${imbalance.solPercent.toFixed(2)}%`);

    const result = await this.executeBridge(token, imbalance.bridgeAmount, imbalance.direction);

    // executeBridge() already logs success/failure, so we don't need to log again here
    return result;
  }
}

