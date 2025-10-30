import BigNumber from 'bignumber.js';
import { GalaChainQuote } from '../types/core';
import { getTradingConfig } from '../config';
import { calculateMinOutput } from '../utils/calculations';
import logger from '../utils/logger';

export interface GalaChainExecutionParams {
  symbol: string;
  tradeSize: number;
  expectedProceedsGala: BigNumber;
  minProceedsGala: BigNumber; // slippage protected
  feeTier?: number;
  poolAddress?: string;
  route?: string[];
  deadlineMs: number;
}

export interface GalaChainExecutionResult {
  success: boolean;
  params: GalaChainExecutionParams;
  txHash?: string;
  error?: string;
}

export class GalaChainExecutor {
  private readonly maxSlippageBps: number;
  private readonly defaultDeadlineSeconds = 60;

  constructor() {
    const trading = getTradingConfig();
    this.maxSlippageBps = trading.maxSlippageBps;
  }

  /**
   * Prepare execution parameters for a token→GALA sell using a price quote.
   * This is a dry-run: it does not submit any transaction.
   */
  dryRunFromQuote(symbol: string, tradeSize: number, quote: GalaChainQuote): GalaChainExecutionResult {
    try {
      // Expected proceeds in GALA = quote.price (GALA per token) * size
      const expectedProceedsGala = quote.price.multipliedBy(tradeSize);
      const minProceedsGala = calculateMinOutput(expectedProceedsGala, this.maxSlippageBps);

      const params: GalaChainExecutionParams = {
        symbol,
        tradeSize,
        expectedProceedsGala,
        minProceedsGala,
        feeTier: quote.feeTier,
        poolAddress: quote.poolAddress,
        route: quote.route,
        deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
      };

      logger.execution(`Prepared GC execution params for ${symbol}`, {
        symbol,
        tradeSize,
        expectedProceedsGala: expectedProceedsGala.toString(),
        minProceedsGala: minProceedsGala.toString(),
        feeTier: quote.feeTier,
        poolAddress: quote.poolAddress,
        deadline: params.deadlineMs
      });

      return { success: true, params };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to build GC execution params', { symbol, error: errorMessage });
      return {
        success: false,
        params: {
          symbol,
          tradeSize,
          expectedProceedsGala: new BigNumber(0),
          minProceedsGala: new BigNumber(0),
          deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
        },
        error: errorMessage
      };
    }
  }
}
