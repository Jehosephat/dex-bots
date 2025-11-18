/**
 * Standard Quote Strategy
 * 
 * Handles standard quotes (SOL/USDC→Token or Token→SOL/USDC) on Solana
 */

import BigNumber from 'bignumber.js';
import { SolanaQuote } from '../../../types/core';
import { TokenConfig } from '../../../types/config';
import { IQuoteStrategy } from './quoteStrategy';
import { calculatePriceImpactBps, toRawAmount, toTokenAmount } from '../../../utils/calculations';
import { getErrorHandler } from '../../../utils/errorHandler';
import logger from '../../../utils/logger';

/**
 * Standard Quote Strategy
 * 
 * Handles standard quotes using Jupiter aggregator
 */
export class SolanaStandardQuoteStrategy implements IQuoteStrategy {
  private readonly jupiterApiUrl: string;
  private readonly getJupiterQuote: (tokenSymbol: string, amount: number, reverse: boolean, quoteCurrency?: string) => Promise<{
    inputAmount: string;
    outputAmount: string;
    priceImpact: number;
    route?: any;
  } | null>;
  private readonly getSpotPrice: (tokenSymbol: string) => Promise<BigNumber>;
  private readonly configService: any;
  private errorHandler = getErrorHandler();

  constructor(
    jupiterApiUrl: string,
    getJupiterQuote: (tokenSymbol: string, amount: number, reverse: boolean, quoteCurrency?: string) => Promise<{
      inputAmount: string;
      outputAmount: string;
      priceImpact: number;
      route?: any;
    } | null>,
    getSpotPrice: (tokenSymbol: string) => Promise<BigNumber>,
    configService: any
  ) {
    this.jupiterApiUrl = jupiterApiUrl;
    this.getJupiterQuote = getJupiterQuote;
    this.getSpotPrice = getSpotPrice;
    this.configService = configService;
  }

  canHandle(tokenConfig: TokenConfig, reverse?: boolean): boolean {
    // Handles standard quotes (not SOL→GALA or Token→GALA)
    const solQuoteVia = tokenConfig.solQuoteVia || 'SOL';
    return solQuoteVia !== 'GALA' && (tokenConfig.symbol !== 'SOL' || solQuoteVia !== 'SOL');
  }

  async getQuote(symbol: string, amount: number, tokenConfig: TokenConfig): Promise<SolanaQuote | null> {
    return this.getQuoteWithReverse(symbol, amount, tokenConfig, false);
  }

  async getQuoteWithReverse(symbol: string, amount: number, tokenConfig: TokenConfig, reverse: boolean): Promise<SolanaQuote | null> {
    try {
      // Get quote based on direction with error handling
      // reverse=false: SOL → Token (buying token with SOL/USDC)
      // reverse=true: Token → SOL (selling token for SOL/USDC)
      // Pass the quote currency from tokenConfig so getJupiterQuote uses the correct quote token
      // Use more tolerant circuit breaker config for Jupiter API
      const quote = await this.errorHandler.executeWithProtection(
        () => this.getJupiterQuote(symbol, amount, reverse, tokenConfig.solQuoteVia),
        'jupiter-api',
        `Jupiter quote for ${symbol}`,
        undefined, // retryPolicy
        {
          failureThreshold: 10,  // More tolerant: 10 failures instead of 5
          timeout: 60000,         // Longer wait: 60s instead of 30s before retry
          failureWindow: 120000  // Longer window: 2min instead of 1min
        }
      );

      if (!quote) {
        return null;
      }

      // Calculate price and price impact
      const quoteTokenConfig = this.configService.getQuoteTokenConfig(tokenConfig.solQuoteVia);
      const inputAmount = toTokenAmount(new BigNumber(quote.inputAmount), reverse ? tokenConfig.decimals : (quoteTokenConfig?.decimals || 9));
      const outputAmount = toTokenAmount(new BigNumber(quote.outputAmount), reverse ? (quoteTokenConfig?.decimals || 9) : tokenConfig.decimals);
      
      // Price calculation:
      // reverse=false: buying token with quoteToken, price = inputAmount (quoteToken) / outputAmount (token) = quoteToken per token
      // reverse=true: selling token for quoteToken, price = outputAmount (quoteToken) / inputAmount (token) = quoteToken per token
      const price = reverse ? outputAmount.div(inputAmount) : inputAmount.div(outputAmount);
      
      // Calculate price impact
      // For reverse quotes, Jupiter provides priceImpact directly, use that
      // For forward quotes, calculate from spot price
      let priceImpactBps: number;
      if (reverse) {
        // Use Jupiter's price impact if available (it's in percentage, convert to bps)
        priceImpactBps = (quote.priceImpact || 0) * 100; // Convert percentage to bps
        if (priceImpactBps === 0) {
          // Fallback: calculate from spot price (inverted since we're selling)
          const spotPrice = await this.getSpotPrice(symbol);
          // For selling: spot price is for buying (quoteToken/token), we need inverse
          if (!spotPrice.isZero()) {
            const inverseSpotPrice = new BigNumber(1).div(spotPrice); // tokens per quoteToken
            const effectivePrice = inputAmount.div(outputAmount); // tokens per quoteToken (inverse of price)
            priceImpactBps = calculatePriceImpactBps(effectivePrice, inverseSpotPrice, new BigNumber(1));
          }
        }
      } else {
        // Forward: calculate from spot price
        const spotPrice = await this.getSpotPrice(symbol);
        priceImpactBps = calculatePriceImpactBps(outputAmount, inputAmount, spotPrice); // tokens received, quoteToken paid, spot price
      }

      // Calculate priority fee
      const priorityFee = this.calculatePriorityFee(quote.priceImpact);

      const solanaQuote: SolanaQuote = {
        symbol,
        price,
        currency: tokenConfig.solQuoteVia,
        tradeSize: amount,
        priceImpactBps,
        minOutput: outputAmount.multipliedBy(0.99), // 1% slippage protection
        provider: 'solana',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000, // 30 seconds
        isValid: true,
        priorityFee,
        jupiterRoute: quote.route
      };

      logger.debug(`📊 Solana quote for ${symbol}: ${price.toString()} ${tokenConfig.solQuoteVia} (impact: ${priceImpactBps}bps)`);
      return solanaQuote;
    } catch (error) {
      await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'getQuote', symbol, amount, reverse, provider: 'solana', strategy: 'Standard' }
      );
      return null;
    }
  }

  private calculatePriorityFee(priceImpact: number): BigNumber {
    const baseFee = 0.000005; // 5000 lamports base fee
    const impactMultiplier = Math.max(1, priceImpact * 10);
    return new BigNumber(baseFee).multipliedBy(impactMultiplier);
  }
}

