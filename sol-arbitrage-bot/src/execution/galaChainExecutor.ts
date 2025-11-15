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

      // FORWARD direction: SELL token, receive GALA
      // IMPORTANT: tokenIn = token we're SELLING (spending)
      //            tokenOut = GALA we're RECEIVING
      // This should result in: -token balance, +GALA balance
      const tokenIn = tokenCfg.galaChainMint; // e.g., GUSDUC|Unit|none|none (what we're selling)
      const tokenOut = 'GALA|Unit|none|none'; // GALA (what we're receiving)
      
      // Validate: tokenIn should NOT be GALA for a SELL operation
      if (tokenIn === 'GALA|Unit|none|none') {
        throw new Error(`Invalid swap direction: tokenIn is GALA but this is a SELL operation. Expected tokenIn=${tokenCfg.galaChainMint}, tokenOut=GALA`);
      }
      
      // Validate: tokenOut MUST be GALA for a SELL operation
      if (tokenOut !== 'GALA|Unit|none|none') {
        throw new Error(`Invalid swap direction: tokenOut is not GALA for SELL operation. Expected tokenOut=GALA, got ${tokenOut}`);
      }

      logger.execution('🔄 Executing GalaChain SELL (FORWARD)', {
        symbol,
        direction: 'FORWARD (SELL token, receive GALA)',
        tokenIn,
        tokenOut,
        tradeSize,
        operation: `Selling ${tradeSize} ${symbol} for GALA`,
        validation: 'tokenIn=token (selling), tokenOut=GALA (receiving)'
      });

      // Fresh quote from SDK (more reliable for feeTier/minOut)
      // quoteExactInput(tokenIn, tokenOut, amount) = quote for spending tokenIn, receiving tokenOut
      const q = await this.gswap.quoting.quoteExactInput(tokenIn, tokenOut, tradeSize);
      
      // Verify quote direction: we're spending tokenIn (token), receiving tokenOut (GALA)
      logger.execution('📋 Quote received', {
        tokenIn,
        tokenOut,
        amountIn: tradeSize,
        expectedAmountOut: q.outTokenAmount.toString(),
        feeTier: q.feeTier,
        interpretation: `Spending ${tradeSize} ${symbol}, receiving ${q.outTokenAmount.toString()} GALA`
      });
      
      const expectedProceedsGala = new BigNumber(q.outTokenAmount.toString());
      const minProceedsGala = expectedProceedsGala.multipliedBy(1 - this.maxSlippageBps / 10000);
      
      // Sanity check: expected proceeds should be positive and reasonable
      if (expectedProceedsGala.isLessThanOrEqualTo(0)) {
        throw new Error(`Invalid quote: expected GALA proceeds is ${expectedProceedsGala.toString()}, should be positive`);
      }

      params.expectedProceedsGala = expectedProceedsGala;
      params.minProceedsGala = minProceedsGala;
      params.feeTier = q.feeTier;

      logger.execution('📊 GalaChain swap parameters', {
        tokenIn,
        tokenOut,
        exactIn: tradeSize,
        amountOutMinimum: minProceedsGala.toString(),
        expectedProceedsGala: expectedProceedsGala.toString(),
        feeTier: q.feeTier,
        operation: 'SELL token → receive GALA'
      });

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

      logger.execution('✅ GalaChain swap executed', { 
        symbol, 
        transactionId: result.transactionId,
        direction: 'FORWARD (SELL)',
        tokenIn,
        tokenOut,
        amountIn: tradeSize,
        expectedAmountOut: expectedProceedsGala.toString()
      });
      return { success: true, params, txHash: result.transactionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('❌ GalaChain live execution failed', { symbol, error: message });
      return { success: false, params, error: message };
    }
  }

  /**
   * Execute a live GALA→token buy using the GSwap SDK.
   * REVERSE: Spend GALA to buy EXACTLY tradeSize tokens.
   * Uses exact output swap to ensure we receive exactly the amount we need.
   */
  async executeBuyFromQuoteLive(
    symbol: string,
    tradeSize: number,
    quote: GalaChainQuote
  ): Promise<GalaChainExecutionResult> {
    const tokenCfg = getTokenConfig(symbol);
    const params: GalaChainExecutionParams = {
      symbol,
      tradeSize,
      expectedProceedsGala: new BigNumber(0), // For reverse, this is the cost
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

      // REVERSE: tokenIn = GALA, tokenOut = token
      const tokenIn = 'GALA|Unit|none|none';
      const tokenOut = tokenCfg.galaChainMint;

      // Get EXACT OUTPUT quote: how much GALA needed for exactly 'tradeSize' tokens
      // This is critical for reverse arbitrage - we need EXACTLY tradeSize tokens
      logger.execution('🔄 Getting exact output quote for REVERSE buy', {
        symbol,
        exactTokensNeeded: tradeSize,
        tokenIn,
        tokenOut
      });

      const q = await this.gswap.quoting.quoteExactOutput(
        tokenIn,
        tokenOut,
        tradeSize // Exact amount of tokens we want to receive
      );

      const exactGalaCost = new BigNumber(q.inTokenAmount.toString());
      const maxGalaCost = exactGalaCost.multipliedBy(1 + this.maxSlippageBps / 10000); // Allow slippage on cost

      // Update params (for reverse, expectedProceedsGala is actually the cost)
      params.expectedProceedsGala = exactGalaCost;
      params.minProceedsGala = maxGalaCost; // Max cost with slippage
      params.feeTier = q.feeTier;

      logger.execution('📊 Exact output quote received', {
        symbol,
        exactTokensToReceive: tradeSize,
        exactGalaCost: exactGalaCost.toString(),
        maxGalaCost: maxGalaCost.toString(),
        feeTier: q.feeTier,
        pricePerToken: exactGalaCost.div(tradeSize).toString()
      });

      // Execute EXACT OUTPUT swap: receive exactly tradeSize tokens, spend up to maxGalaCost GALA
      const result = await this.gswap.swaps.swap(
        tokenIn,
        tokenOut,
        q.feeTier,
        {
          exactOut: tradeSize, // We want EXACTLY this many tokens
          amountInMaximum: maxGalaCost.toNumber() // Max GALA we're willing to spend
        },
        wallet
      );

      logger.execution('✅ GalaChain exact output buy executed (REVERSE)', {
        symbol,
        transactionId: result.transactionId,
        exactTokensReceived: tradeSize,
        expectedGalaCost: exactGalaCost.toString(),
        maxGalaCost: maxGalaCost.toString()
      });
      return { success: true, params, txHash: result.transactionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('❌ GalaChain exact output buy execution failed (REVERSE)', { symbol, error: message });
      return { success: false, params, error: message };
    }
  }
}
