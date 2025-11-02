/**
 * Solana Price Provider
 * 
 * Provides size-aware quoting for Solana using Jupiter aggregator.
 * Handles token buy operations with priority fee estimation.
 */

import axios from 'axios';
import BigNumber from 'bignumber.js';
import { BasePriceProvider } from './base';
import { PriceQuote, SolanaQuote } from '../../types/core';
import { TokenConfig } from '../../types/config';
import { getTokenConfig, getQuoteTokenConfig } from '../../config';
import logger from '../../utils/logger';
import { 
  calculatePriceImpactBps, 
  toRawAmount, 
  toTokenAmount,
  isValidPrice,
  isValidTokenAmount 
} from '../../utils/calculations';

/**
 * Solana DEX price provider using Jupiter aggregator
 * Fetches size-aware quotes from Solana DEXs via Jupiter
 */
export class SolanaPriceProvider extends BasePriceProvider {
  private jupiterApiUrl = process.env.JUPITER_API_BASE || 'https://lite-api.jup.ag/swap/v1';
  private coinGeckoApiUrl = 'https://api.coingecko.com/api/v3';
  private solUsdPrice: number = 0;
  private solUsdPriceLastUpdate: number = 0;
  private solUsdPriceCacheDuration: number = 60000; // Cache for 60 seconds

  async initialize(): Promise<void> {
    try {
      // Fetch initial SOL/USD price
      await this.updateSOLUSDPrice();
      this.isInitialized = true;
      this.clearError();
      logger.info('✅ Solana price provider initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setError(errorMessage);
      logger.error('❌ Failed to initialize Solana price provider', { error: errorMessage });
      throw error;
    }
  }

  getName(): string {
    return 'solana';
  }

  async getQuote(symbol: string, amount: number): Promise<PriceQuote | null> {
    try {
      if (!this.isReady()) {
        throw new Error('Provider not ready');
      }

      const tokenConfig = getTokenConfig(symbol);
      if (!tokenConfig) {
        throw new Error(`Token ${symbol} not configured`);
      }

      if (!isValidTokenAmount(new BigNumber(amount))) {
        throw new Error(`Invalid amount: ${amount}`);
      }

      // Update SOL/USD price if needed
      await this.updateSOLUSDPrice();

      // Get quote for SOL → Token (buying token with SOL)
      const quote = await this.getJupiterQuote(symbol, amount);

      if (!quote) {
        return null;
      }

      // Calculate price and price impact
      const quoteTokenConfig = getQuoteTokenConfig(tokenConfig.solQuoteVia);
      const inputAmount = toTokenAmount(new BigNumber(quote.inputAmount), quoteTokenConfig?.decimals || 9);
      const outputAmount = toTokenAmount(new BigNumber(quote.outputAmount), tokenConfig.decimals);
      const price = inputAmount.div(outputAmount); // QuoteToken per token
      const spotPrice = await this.getSpotPrice(symbol);
      const priceImpactBps = calculatePriceImpactBps(
        outputAmount,
        inputAmount,
        spotPrice
      );

      // Calculate priority fee
      const priorityFee = this.calculatePriorityFee(quote.priceImpact);

      const solanaQuote: SolanaQuote = {
        symbol,
        price,
        currency: tokenConfig.solQuoteVia,
        tradeSize: amount,
        priceImpactBps,
        minOutput: outputAmount.multipliedBy(0.99), // 1% slippage protection
        provider: this.getName(),
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000, // 30 seconds
        isValid: true,
        priorityFee,
        jupiterRoute: quote.route
      };

      this.updateTimestamp();
      this.clearError();

      logger.debug(`📊 Solana quote for ${symbol}: ${price.toString()} ${tokenConfig.solQuoteVia} (impact: ${priceImpactBps}bps)`);
      return solanaQuote;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setError(errorMessage);
      logger.error(`❌ Failed to get Solana quote for ${symbol}`, { 
        symbol, 
        amount, 
        error: errorMessage 
      });
      return null;
    }
  }

  private async getJupiterQuote(
    tokenSymbol: string, 
    amount: number
  ): Promise<{
    inputAmount: string;
    outputAmount: string;
    priceImpact: number;
    route?: any;
  } | null> {
    try {
      const tokenConfig = getTokenConfig(tokenSymbol);
      if (!tokenConfig?.solanaMint) {
        throw new Error(`No Solana mint for token ${tokenSymbol}`);
      }

      // Get the quote token configuration
      const quoteTokenConfig = getQuoteTokenConfig(tokenConfig.solQuoteVia);
      if (!quoteTokenConfig) {
        throw new Error(`Quote token config not found for ${tokenConfig.solQuoteVia}`);
      }
      if (!quoteTokenConfig.solanaMint) {
        throw new Error(`No Solana mint for quote token ${tokenConfig.solQuoteVia}`);
      }

      const inputMint = quoteTokenConfig.solanaMint; // e.g., USDC
      const outputMint = tokenConfig.solanaMint;     // target token (e.g., SOL or other)

      // We request ExactOut: amount is in output token units
      const rawAmountOut = toRawAmount(new BigNumber(amount), tokenConfig.decimals);

      // Get quote from Jupiter (QuoteToken → Token) using ExactOut
      const response = await axios.get(`${this.jupiterApiUrl}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: rawAmountOut.toString(),
          slippageBps: 50, // 0.5% slippage
          swapMode: 'ExactOut'
        },
        timeout: 10000
      });

      if (!response.data || !response.data.outAmount) {
        return null;
      }

      return {
        inputAmount: response.data.inAmount,
        outputAmount: response.data.outAmount,
        priceImpact: response.data.priceImpactPct || 0,
        route: response.data.routePlan ? {
          routeId: response.data.routePlan[0]?.swapInfo?.label || 'unknown',
          inputMint: inputMint,
          outputMint: outputMint,
          steps: response.data.routePlan || [],
          totalPriceImpact: response.data.priceImpactPct || 0,
          totalFee: response.data.platformFee?.amount || 0
        } : undefined
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('⚠️ Jupiter quote failed', { tokenSymbol, amount, error: errorMessage });
      return null;
    }
  }

  private async getSpotPrice(tokenSymbol: string): Promise<BigNumber> {
    try {
      // Get a small quote to determine spot price
      const smallAmount = 1; // 1 unit
      const quote = await this.getJupiterQuote(tokenSymbol, smallAmount);

      if (!quote) {
        return new BigNumber(0);
      }

      const tokenConfig = getTokenConfig(tokenSymbol);
      const solQuoteVia = tokenConfig?.solQuoteVia || 'SOL';
      const quoteTokenConfig = getQuoteTokenConfig(solQuoteVia);
      if (!quoteTokenConfig) {
        logger.warn(`⚠️ Quote token config not found for ${solQuoteVia}, using fallback decimals`);
      }
      const inputAmount = toTokenAmount(new BigNumber(quote.inputAmount), quoteTokenConfig?.decimals || 9);
      const outputAmount = toTokenAmount(new BigNumber(quote.outputAmount), tokenConfig?.decimals || 6);

      return inputAmount.div(outputAmount);
    } catch (error) {
      logger.warn('⚠️ Failed to get spot price, using fallback', { tokenSymbol });
      return new BigNumber(0);
    }
  }

  private calculatePriorityFee(priceImpact: number): BigNumber {
    // Calculate priority fee based on price impact
    // Higher impact = higher fee to ensure execution
    const baseFee = 0.000005; // 5000 lamports base fee
    const impactMultiplier = Math.max(1, priceImpact * 10); // Scale with impact
    return new BigNumber(baseFee).multipliedBy(impactMultiplier);
  }

  private async updateSOLUSDPrice(): Promise<void> {
    const now = Date.now();
    
    // Check if cached price is still valid
    if (this.solUsdPrice > 0 && (now - this.solUsdPriceLastUpdate) < this.solUsdPriceCacheDuration) {
      logger.debug(`Using cached SOL/USD price: $${this.solUsdPrice.toFixed(2)}`);
      return;
    }

    try {
      // Fetch SOL/USD price from CoinGecko
      const response = await axios.get(`${this.coinGeckoApiUrl}/simple/price`, {
        params: {
          ids: 'solana',
          vs_currencies: 'usd'
        },
        timeout: 10000
      });

      if (response.data?.solana?.usd) {
        this.solUsdPrice = response.data.solana.usd;
        this.solUsdPriceLastUpdate = now;
        logger.info(`💰 SOL/USD price: $${this.solUsdPrice.toFixed(2)}`);
      }
    } catch (error) {
      // Keep this quiet to avoid noisy stack traces (e.g., CG 429). Use concise message and fallback once.
      const msg = (error instanceof Error && (error as any).response?.status === 429)
        ? 'Coingecko rate limited (429)'
        : (error instanceof Error ? error.message : String(error));
      logger.warn('⚠️ Failed to fetch SOL/USD price, using fallback', { reason: msg });
      if (this.solUsdPrice === 0) {
        this.solUsdPrice = 225; // Fallback price
        logger.warn(`Using fallback SOL/USD price: $${this.solUsdPrice}`);
      }
    }
  }

  /**
   * Get current SOL/USD price
   */
  getSOLUSDPrice(): number {
    return this.solUsdPrice;
  }
}
