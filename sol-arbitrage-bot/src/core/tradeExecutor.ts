/**
 * Trade Executor
 * 
 * Handles trade execution (dry-run and live) and logging.
 * Separates execution logic from orchestration.
 */

import BigNumber from 'bignumber.js';
import logger from '../utils/logger';
import { IConfigService } from '../config';
import { TokenConfig } from '../types/config';
import { DualLegCoordinator } from '../execution/dualLegCoordinator';
import { GalaChainExecutionResult } from '../execution/galaChainExecutor';
import { SolanaExecutionResult } from '../execution/solanaExecutor';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import { TokenEvaluationResult } from './tokenEvaluator';
import { getTradeLogger } from '../utils/tradeLogger';
import { sendAlert } from '../utils/alerts';
import { getErrorHandler } from '../utils/errorHandler';

/**
 * Trade execution result
 */
export interface TradeExecutionResult {
  /** Arbitrage direction ('forward' or 'reverse') */
  direction: 'forward' | 'reverse';
  
  /** Whether trade was executed (true for live, false for dry-run) */
  executed: boolean;
  
  /** Whether execution was successful (only for live mode) */
  success?: boolean;
  
  /** GalaChain execution result (if executed) */
  gcResult?: GalaChainExecutionResult;
  
  /** Solana execution result (if executed) */
  solResult?: SolanaExecutionResult;
  
  /** Execution duration in milliseconds */
  executionDurationMs: number;
}

/**
 * Trade Executor
 * 
 * Handles execution of trades and logging
 */
export class TradeExecutor {
  private coordinator: DualLegCoordinator;
  private errorHandler = getErrorHandler();

  constructor(
    private configService: IConfigService
  ) {
    this.coordinator = new DualLegCoordinator(configService);
  }

  /**
   * Execute trade (dry-run or live)
   */
  async executeTrade(
    evaluation: TokenEvaluationResult,
    runMode: 'live' | 'dry_run'
  ): Promise<TradeExecutionResult> {
    const startTime = Date.now();
    const { token, gcQuote, solQuote, riskResult, direction } = evaluation;

    if (!gcQuote || !solQuote || !riskResult) {
      throw new Error('Cannot execute trade: missing quotes or risk evaluation');
    }

    // Determine direction (default to forward)
    const tradeDirection = direction || 'forward';

    // Prepare log entry
    const tradeLogger = getTradeLogger();
    const solCost = solQuote.price.multipliedBy(token.tradeSize);
    const edge = riskResult.edge;
    
    const logEntry: any = {
      timestamp: new Date().toISOString(),
      mode: runMode,
      token: token.symbol,
      tradeSize: token.tradeSize,
      direction: tradeDirection,
      success: false,
      expectedGalaChainProceeds: edge ? edge.galaChainProceeds.toNumber() : undefined,
      expectedSolanaCost: solCost.toNumber(),
      expectedSolanaCostGala: edge ? edge.solanaCostGala.toNumber() : undefined,
      expectedNetEdge: edge ? edge.netEdge.toNumber() : undefined,
      expectedNetEdgeBps: edge ? edge.netEdgeBps : undefined,
      galaChainPrice: gcQuote.price.toNumber(),
      galaChainPriceCurrency: gcQuote.currency,
      solanaPrice: solQuote.price.toNumber(),
      solanaPriceCurrency: solQuote.currency,
      priceImpactGcBps: gcQuote.priceImpactBps,
      priceImpactSolBps: solQuote.priceImpactBps
    };

    if (runMode === 'live') {
      return await this.executeLiveTrade(token, gcQuote, solQuote, tradeDirection, logEntry, tradeLogger, startTime);
    } else {
      return await this.executeDryRunTrade(token, gcQuote, solQuote, tradeDirection, logEntry, tradeLogger, startTime);
    }
  }

  /**
   * Execute live trade
   */
  private async executeLiveTrade(
    token: TokenConfig,
    gcQuote: GalaChainQuote,
    solQuote: SolanaQuote,
    direction: 'forward' | 'reverse',
    logEntry: any,
    tradeLogger: ReturnType<typeof getTradeLogger>,
    startTime: number
  ): Promise<TradeExecutionResult> {
    try {
      logger.info(`   Mode:     🚀 LIVE TRADING`);
      logger.info(`   Size:     ${token.tradeSize} ${token.symbol}`);
      
      if (direction === 'reverse') {
        logger.info(`   Direction: 🔷 BUY on GalaChain → 🔸 SELL on Solana (REVERSE)`);
      } else {
        logger.info(`   Direction: 🔷 SELL on GalaChain → 🔸 BUY on Solana (FORWARD)`);
      }

      // Pass quotes from evaluation to coordinator (they contain strategy-specific quote currencies)
      const { gc, sol } = await this.coordinator.executeLive(token.symbol, direction, gcQuote, solQuote);
      const endTime = Date.now();
      const executionDurationMs = endTime - startTime;

      logEntry.executionDurationMs = executionDurationMs;
      logEntry.galaChainSuccess = gc.success;
      logEntry.solanaSuccess = sol.success;
      logEntry.success = gc.success && sol.success;

      if (gc.success && sol.success) {
        logEntry.galaChainTxHash = gc.txHash;
        logEntry.solanaTxSig = sol.txSig;

        logger.info(`\n🎉 TRADE EXECUTED SUCCESSFULLY`);
        logger.info(`   Token: ${token.symbol}`);
        logger.info(`   Direction: FORWARD`);
        logger.info(`   🔷 GalaChain (SELL): ✅ Success`);
        logger.info(`      TX Hash: ${gc.txHash}`);
        logger.info(`   🔸 Solana (BUY): ✅ Success`);
        logger.info(`      TX Signature: ${sol.txSig}`);
      } else if (!gc.success && !sol.success) {
        logEntry.galaChainError = gc.error;
        logEntry.solanaError = sol.error;

        logger.error(`\n❌ BOTH LEGS FAILED`);
        logger.error(`   Token: ${token.symbol}`);
        logger.error(`   Direction: ${direction.toUpperCase()}`);
        if (direction === 'reverse') {
          logger.error(`   🔷 GalaChain (BUY): ❌ Failed`);
          logger.error(`      Error: ${gc.error}`);
          logger.error(`   🔸 Solana (SELL): ❌ Failed`);
          logger.error(`      Error: ${sol.error}`);
        } else {
          logger.error(`   🔷 GalaChain (SELL): ❌ Failed`);
          logger.error(`      Error: ${gc.error}`);
          logger.error(`   🔸 Solana (BUY): ❌ Failed`);
          logger.error(`      Error: ${sol.error}`);
        }

        await sendAlert(
          'Dual-leg trade failed',
          { token: token.symbol, direction: 'forward', gcError: gc.error, solError: sol.error },
          'error'
        ).catch(() => {});
      } else {
        logEntry.galaChainTxHash = gc.success ? gc.txHash : undefined;
        logEntry.solanaTxSig = sol.success ? sol.txSig : undefined;
        logEntry.galaChainError = !gc.success ? gc.error : undefined;
        logEntry.solanaError = !sol.success ? sol.error : undefined;

        logger.warn(`\n⚠️ PARTIAL SUCCESS`);
        logger.warn(`   Token: ${token.symbol}`);
        logger.warn(`   Direction: ${direction.toUpperCase()}`);
        if (direction === 'reverse') {
          logger.warn(`   🔷 GalaChain (BUY): ${gc.success ? '✅ Success' : '❌ Failed'}`);
          if (gc.success && gc.txHash) {
            logger.warn(`      TX Hash: ${gc.txHash}`);
          }
          if (!gc.success && gc.error) {
            logger.warn(`      Error: ${gc.error}`);
          }
          logger.warn(`   🔸 Solana (SELL): ${sol.success ? '✅ Success' : '❌ Failed'}`);
          if (sol.success && sol.txSig) {
            logger.warn(`      TX Signature: ${sol.txSig}`);
          }
          if (!sol.success && sol.error) {
            logger.warn(`      Error: ${sol.error}`);
          }
        } else {
          logger.warn(`   🔷 GalaChain (SELL): ${gc.success ? '✅ Success' : '❌ Failed'}`);
          if (gc.success && gc.txHash) {
            logger.warn(`      TX Hash: ${gc.txHash}`);
          }
          if (!gc.success && gc.error) {
            logger.warn(`      Error: ${gc.error}`);
          }
          logger.warn(`   🔸 Solana (BUY): ${sol.success ? '✅ Success' : '❌ Failed'}`);
          if (sol.success && sol.txSig) {
            logger.warn(`      TX Signature: ${sol.txSig}`);
          }
          if (!sol.success && sol.error) {
            logger.warn(`      Error: ${sol.error}`);
          }
        }
      }

      // Log the trade
      tradeLogger.logTrade(logEntry);

      return {
        direction,
        executed: true,
        success: gc.success && sol.success,
        gcResult: gc,
        solResult: sol,
        executionDurationMs
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'executeLiveTrade', token: token.symbol }
      );

      logEntry.executionDurationMs = Date.now() - startTime;
      logEntry.error = errorMessage;
      tradeLogger.logTrade(logEntry);

      throw error;
    }
  }

  /**
   * Execute dry-run trade
   */
  private async executeDryRunTrade(
    token: TokenConfig,
    gcQuote: GalaChainQuote,
    solQuote: SolanaQuote,
    direction: 'forward' | 'reverse',
    logEntry: any,
    tradeLogger: ReturnType<typeof getTradeLogger>,
    startTime: number
  ): Promise<TradeExecutionResult> {
    try {
      await this.coordinator.dryRun(token.symbol, direction);
      const executionDurationMs = Date.now() - startTime;

      logEntry.executionDurationMs = executionDurationMs;

      const strategy = direction === 'reverse'
        ? 'Would BUY on GalaChain and SELL on Solana'
        : 'Would SELL on GalaChain and BUY on Solana';
      logger.info(`🧪 DRY-RUN completed`, {
        token: token.symbol,
        direction,
        note: 'No actual trades executed - simulation only',
        strategy
      });

      // Log dry-run trades too
      tradeLogger.logTrade(logEntry);

      return {
        direction,
        executed: false,
        executionDurationMs
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'executeDryRunTrade', token: token.symbol }
      );

      const executionDurationMs = Date.now() - startTime;
      logEntry.executionDurationMs = executionDurationMs;
      logEntry.error = errorMessage;
      tradeLogger.logTrade(logEntry);

      throw error;
    }
  }
}

