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
  private readonly dynamicSlippageMaxMultiplier: number;
  private readonly dynamicSlippageEdgeRatio: number;
  private readonly defaultDeadlineSeconds = 60;
  private gswap?: GSwap;

  constructor() {
    const trading = getTradingConfig();
    this.maxSlippageBps = trading.maxSlippageBps;
    this.dynamicSlippageMaxMultiplier = trading.dynamicSlippageMaxMultiplier ?? 2.0;
    this.dynamicSlippageEdgeRatio = trading.dynamicSlippageEdgeRatio ?? 0.75;
  }

  /**
   * Calculate dynamic slippage tolerance based on expected edge
   * Formula: min(maxSlippageBps * multiplier, edgeBps * edgeRatio) with floor of maxSlippageBps
   * This allows higher slippage tolerance for trades with larger edges
   */
  private calculateDynamicSlippageBps(edgeBps?: number): number {
    if (!edgeBps || edgeBps <= 0) {
      return this.maxSlippageBps; // Use base slippage if no edge info
    }

    // Calculate slippage based on edge: allow up to edgeRatio% of edge as slippage
    // Cap at multiplier * base slippage tolerance, floor at base slippage tolerance
    const edgeBasedSlippage = edgeBps * this.dynamicSlippageEdgeRatio;
    const maxAllowedSlippage = this.maxSlippageBps * this.dynamicSlippageMaxMultiplier;
    
    const dynamicSlippage = Math.max(
      this.maxSlippageBps, // Floor: always at least base slippage
      Math.min(maxAllowedSlippage, edgeBasedSlippage) // Cap: never more than multiplier * base
    );

    return Math.round(dynamicSlippage);
  }

  /**
   * Prepare execution parameters for a token→GALA sell using a price quote.
   * This is a dry-run: it does not submit any transaction.
   */
  dryRunFromQuote(symbol: string, tradeSize: number, quote: GalaChainQuote): GalaChainExecutionResult {
    try {
      // Check liquidity before execution if available
      if (quote.poolLiquidity) {
        const { liquidity, grossPoolLiquidity } = quote.poolLiquidity;
        // Heuristic: require at least 1000 units of liquidity for small trades
        // For larger trades, we'd need more sophisticated calculation
        const minLiquidityThreshold = 1000;
        
        if (liquidity.isLessThan(minLiquidityThreshold)) {
          const errorMsg = `Insufficient pool liquidity: ${liquidity.toString()} (minimum: ${minLiquidityThreshold}). Execution will likely fail.`;
          logger.warn(`⚠️ ${errorMsg}`, {
            symbol,
            feeTier: quote.feeTier,
            activeLiquidity: liquidity.toString(),
            totalLiquidity: grossPoolLiquidity.toString(),
            tradeSize
          });
          return {
            success: false,
            params: {
              symbol,
              tradeSize,
              expectedProceedsGala: new BigNumber(0),
              minProceedsGala: new BigNumber(0),
              deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
            },
            error: errorMsg
          };
        }
      } else {
        logger.warn(`⚠️ Pool liquidity information not available for ${symbol} - cannot validate liquidity before execution`, {
          symbol,
          feeTier: quote.feeTier
        });
      }

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
        deadline: params.deadlineMs,
        liquidity: quote.poolLiquidity ? {
          active: quote.poolLiquidity.liquidity.toString(),
          total: quote.poolLiquidity.grossPoolLiquidity.toString()
        } : 'N/A'
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
  async executeFromQuoteLive(symbol: string, tradeSize: number, _quote?: GalaChainQuote, edgeBps?: number): Promise<GalaChainExecutionResult> {
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
      
      // Calculate dynamic slippage based on expected edge
      const slippageBps = this.calculateDynamicSlippageBps(edgeBps);
      const minProceedsGala = expectedProceedsGala.multipliedBy(1 - slippageBps / 10000);
      
      logger.execution('📊 Dynamic slippage calculation', {
        symbol,
        baseSlippageBps: this.maxSlippageBps,
        edgeBps: edgeBps || 'N/A',
        dynamicSlippageBps: slippageBps,
        expectedProceeds: expectedProceedsGala.toString(),
        minProceeds: minProceedsGala.toString()
      });
      
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
    quote: GalaChainQuote,
    edgeBps?: number
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
      
      // Calculate dynamic slippage based on expected edge
      const slippageBps = this.calculateDynamicSlippageBps(edgeBps);
      const maxGalaCost = exactGalaCost.multipliedBy(1 + slippageBps / 10000); // Allow slippage on cost

      // Apply precision buffer to exactOut to account for rounding/precision issues
      // Use the dynamic slippage for precision buffer, but ensure at least 50 bps (0.5%)
      const precisionBufferBps = Math.max(slippageBps, 50); // At least 0.5% buffer
      
      logger.execution('📊 Dynamic slippage calculation (REVERSE)', {
        symbol,
        baseSlippageBps: this.maxSlippageBps,
        edgeBps: edgeBps || 'N/A',
        dynamicSlippageBps: slippageBps,
        precisionBufferBps,
        exactGalaCost: exactGalaCost.toString(),
        maxGalaCost: maxGalaCost.toString()
      });
      
      // Calculate buffer amount using token decimals for proper precision
      const tokenDecimals = tokenCfg?.decimals || 6;
      let exactOutWithBuffer = new BigNumber(tradeSize)
        .multipliedBy(1 - precisionBufferBps / 10000);
      
      // Round down to token's decimal places
      exactOutWithBuffer = exactOutWithBuffer.decimalPlaces(tokenDecimals, BigNumber.ROUND_DOWN);
      
      // Subtract a tiny additional buffer (1 unit in the smallest decimal place) to ensure
      // we're always slightly below what the contract will actually deliver
      // This prevents precision edge cases where the contract rounds slightly differently
      const smallestUnit = new BigNumber(10).pow(-tokenDecimals);
      exactOutWithBuffer = exactOutWithBuffer.minus(smallestUnit);
      
      // Ensure we don't go below zero
      if (exactOutWithBuffer.isLessThan(0)) {
        exactOutWithBuffer = new BigNumber(0);
      }
      
      // Final rounding to token decimals
      exactOutWithBuffer = exactOutWithBuffer.decimalPlaces(tokenDecimals, BigNumber.ROUND_DOWN);

      // Update params (for reverse, expectedProceedsGala is actually the cost)
      params.expectedProceedsGala = exactGalaCost;
      params.minProceedsGala = maxGalaCost; // Max cost with slippage
      params.feeTier = q.feeTier;

      logger.execution('📊 Exact output quote received', {
        symbol,
        exactTokensToReceive: tradeSize,
        exactOutWithBuffer: exactOutWithBuffer.toString(),
        exactGalaCost: exactGalaCost.toString(),
        maxGalaCost: maxGalaCost.toString(),
        feeTier: q.feeTier,
        pricePerToken: exactGalaCost.div(tradeSize).toString(),
        precisionBufferBps
      });

      // Execute EXACT OUTPUT swap: receive at least exactOutWithBuffer tokens (with precision buffer),
      // spend up to maxGalaCost GALA
      const result = await this.gswap.swaps.swap(
        tokenIn,
        tokenOut,
        q.feeTier,
        {
          exactOut: exactOutWithBuffer.toNumber(), // Apply precision buffer to prevent slippage failures
          amountInMaximum: maxGalaCost.toNumber() // Max GALA we're willing to spend
        },
        wallet
      );

      logger.execution('✅ GalaChain exact output buy executed (REVERSE)', {
        symbol,
        transactionId: result.transactionId,
        exactTokensRequested: tradeSize,
        exactOutWithBuffer: exactOutWithBuffer.toString(),
        expectedGalaCost: exactGalaCost.toString(),
        maxGalaCost: maxGalaCost.toString()
      });
      return { success: true, params, txHash: result.transactionId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('❌ GalaChain exact output buy execution failed (REVERSE)', {
        symbol,
        tradeSize,
        error: errorMessage
      });
      
      // Log specific slippage errors with more context
      if (errorMessage.includes('Slippage') || errorMessage.includes('slippage')) {
        const slippageDetails: any = {
          symbol,
          tradeSize,
          errorMessage,
          recommendation: 'Consider increasing maxSlippageBps or checking pool liquidity'
        };
        
        // Add execution parameters if they were set
        if (params.expectedProceedsGala && !params.expectedProceedsGala.isZero()) {
          slippageDetails.expectedGalaCost = params.expectedProceedsGala.toString();
        }
        if (params.minProceedsGala && !params.minProceedsGala.isZero()) {
          slippageDetails.maxGalaCost = params.minProceedsGala.toString();
        }
        
        logger.error('⚠️ SLIPPAGE ERROR DETECTED (REVERSE)', slippageDetails);
      }
      
      return { success: false, params, error: errorMessage };
    }
  }
}
