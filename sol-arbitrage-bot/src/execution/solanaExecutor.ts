import BigNumber from 'bignumber.js';
import { SolanaQuote } from '../types/core';
import { getTradingConfig } from '../config';
import { calculateMinOutput } from '../utils/calculations';
import logger from '../utils/logger';

export interface SolanaExecutionParams {
  symbol: string;
  tradeSize: number;
  quoteCurrency: string; // e.g., USDC, SOL
  expectedCostInQuote: BigNumber; // cost per trade size in quote currency
  maxCostInQuote: BigNumber; // slippage-protected max cost
  route?: any;
  deadlineMs: number;
}

export interface SolanaExecutionResult {
  success: boolean;
  params: SolanaExecutionParams;
  txSig?: string;
  error?: string;
}

export class SolanaExecutor {
  private readonly maxSlippageBps: number;
  private readonly defaultDeadlineSeconds = 60;

  constructor() {
    const trading = getTradingConfig();
    this.maxSlippageBps = trading.maxSlippageBps;
  }

  /**
   * Prepare execution parameters for a buy on Solana using SolanaQuote.
   * This is a dry-run only; no on-chain submission.
   */
  dryRunFromQuote(symbol: string, tradeSize: number, quote: SolanaQuote): SolanaExecutionResult {
    try {
      // expected cost = price (quoteCurrency per token) * trade size
      const expectedCostInQuote = quote.price.multipliedBy(tradeSize);
      // For buys, we cap the max spend (slippage): maxCost = expected * (1 + slippage)
      const maxCostInQuote = expectedCostInQuote.multipliedBy(new BigNumber(1).plus(this.maxSlippageBps / 10000));

      const params: SolanaExecutionParams = {
        symbol,
        tradeSize,
        quoteCurrency: quote.currency,
        expectedCostInQuote,
        maxCostInQuote,
        route: quote.jupiterRoute,
        deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
      };

      logger.execution(`Prepared SOL execution params for ${symbol}`, {
        symbol,
        tradeSize,
        quoteCurrency: quote.currency,
        expectedCostInQuote: expectedCostInQuote.toString(),
        maxCostInQuote: maxCostInQuote.toString(),
        deadline: params.deadlineMs
      });

      return { success: true, params };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to build SOL execution params', { symbol, error: errorMessage });
      return {
        success: false,
        params: {
          symbol,
          tradeSize,
          quoteCurrency: quote.currency,
          expectedCostInQuote: new BigNumber(0),
          maxCostInQuote: new BigNumber(0),
          deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
        },
        error: errorMessage
      };
    }
  }
}
