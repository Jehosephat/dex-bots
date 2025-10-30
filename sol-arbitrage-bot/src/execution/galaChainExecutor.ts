import BigNumber from 'bignumber.js';
import { GalaChainQuote } from '../types/core';
import { getTradingConfig, getTokenConfig } from '../config';
import { calculateMinOutput } from '../utils/calculations';
import logger from '../utils/logger';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

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
  private gswap?: GSwap;

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

  /**
   * Execute a live token→GALA sell using the GSwap SDK.
   */
  async executeFromQuoteLive(symbol: string, tradeSize: number, _quote?: GalaChainQuote): Promise<GalaChainExecutionResult> {
    const tokenCfg = getTokenConfig(symbol);
    const params: GalaChainExecutionParams = {
      symbol,
      tradeSize,
      expectedProceedsGala: new BigNumber(0),
      minProceedsGala: new BigNumber(0),
      deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
    };

    try {
      const priv = process.env.GALACHAIN_PRIVATE_KEY;
      const wallet = process.env.GALACHAIN_WALLET_ADDRESS;
      if (!priv || !wallet) {
        throw new Error('GALACHAIN_PRIVATE_KEY and GALACHAIN_WALLET_ADDRESS are required');
      }
      if (!tokenCfg?.galaChainMint) throw new Error(`No GalaChain mint for ${symbol}`);

      if (!this.gswap) {
        const signer = new PrivateKeySigner(priv);
        this.gswap = new GSwap({ signer });
      }

      const tokenIn = tokenCfg.galaChainMint; // e.g., GSOL|Unit|none|none
      const tokenOut = 'GALA|Unit|none|none';

      // Fresh quote from SDK (more reliable for feeTier/minOut)
      const q = await this.gswap.quoting.quoteExactInput(tokenIn, tokenOut, tradeSize);
      const expectedProceedsGala = new BigNumber(q.outTokenAmount.toString());
      const minProceedsGala = expectedProceedsGala.multipliedBy(1 - this.maxSlippageBps / 10000);

      params.expectedProceedsGala = expectedProceedsGala;
      params.minProceedsGala = minProceedsGala;
      params.feeTier = q.feeTier;

      const result = await this.gswap.swaps.swap(
        tokenIn,
        tokenOut,
        q.feeTier,
        {
          exactIn: tradeSize,
          amountOutMinimum: minProceedsGala
        },
        wallet
      );

      logger.execution('✅ GalaChain swap executed', { symbol, transactionId: result.transactionId });
      return { success: true, params, txHash: result.transactionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('❌ GalaChain live execution failed', { symbol, error: message });
      return { success: false, params, error: message };
    }
  }
}
