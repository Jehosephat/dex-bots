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
    const { token, gcQuote, solQuote, riskResult } = evaluation;

    if (!gcQuote || !solQuote || !riskResult) {
      throw new Error('Cannot execute trade: missing quotes or risk evaluation');
    }

    // Prepare log entry
    const tradeLogger = getTradeLogger();
    const solCost = solQuote.price.multipliedBy(token.tradeSize);
    const edge = riskResult.edge;
    
    const logEntry: any = {
      timestamp: new Date().toISOString(),
      mode: runMode,
      token: token.symbol,
      tradeSize: token.tradeSize,
      direction: 'forward',
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
      return await this.executeLiveTrade(token, gcQuote, solQuote, logEntry, tradeLogger, startTime);
    } else {
      return await this.executeDryRunTrade(token, gcQuote, solQuote, logEntry, tradeLogger, startTime);
    }
  }

  /**
   * Execute live trade
   */
  private async executeLiveTrade(
    token: TokenConfig,
    gcQuote: GalaChainQuote,
    solQuote: SolanaQuote,
    logEntry: any,
    tradeLogger: ReturnType<typeof getTradeLogger>,
    startTime: number
  ): Promise<TradeExecutionResult> {
    try {
      logger.info(`   Mode:     🚀 LIVE TRADING`);
      logger.info(`   Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`   Direction: 🔷 SELL on GalaChain → 🔸 BUY on Solana`);

      const { gc, sol } = await this.coordinator.executeLive(token.symbol);
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
        logger.error(`   🔷 GalaChain (SELL): ❌ Failed`);
        logger.error(`      Error: ${gc.error}`);
        logger.error(`   🔸 Solana (BUY): ❌ Failed`);
        logger.error(`      Error: ${sol.error}`);

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

      // Log the trade
      tradeLogger.logTrade(logEntry);

      return {
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
    logEntry: any,
    tradeLogger: ReturnType<typeof getTradeLogger>,
    startTime: number
  ): Promise<TradeExecutionResult> {
    try {
      await this.coordinator.dryRun(token.symbol);
      const executionDurationMs = Date.now() - startTime;

      logEntry.executionDurationMs = executionDurationMs;

      const strategy = 'Would SELL on GalaChain and BUY on Solana';
      logger.info(`🧪 DRY-RUN completed`, {
        token: token.symbol,
        direction: 'forward',
        note: 'No actual trades executed - simulation only',
        strategy
      });

      // Log dry-run trades too
      tradeLogger.logTrade(logEntry);

      return {
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

