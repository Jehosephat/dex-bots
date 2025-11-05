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
import { IConfigService } from '../../config';
import logger from '../../utils/logger';
import { getErrorHandler } from '../../utils/errorHandler';
import { ExternalApiError, ValidationError, NetworkError } from '../../utils/errors';
import { 
  calculatePriceImpactBps,
  calculateBps,
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
  private errorHandler = getErrorHandler();

  constructor(private configService: IConfigService) {
    super();
  }

  async initialize(): Promise<void> {
    try {
      // Fetch initial SOL/USD price with error handling
      await this.errorHandler.executeWithProtection(
        () => this.updateSOLUSDPrice(),
        'solana-price-provider',
        'initialize'
      );
      this.isInitialized = true;
      this.clearError();
      logger.info('✅ Solana price provider initialized');
    } catch (error) {
      const botError = await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'initialize', provider: 'solana' }
      );
      const errorMessage = botError.message;
      this.setError(errorMessage);
      throw new ExternalApiError(errorMessage, 'SolanaPriceProvider', undefined, { operation: 'initialize' });
    }
  }

  getName(): string {
    return 'solana';
  }

  async getQuote(symbol: string, amount: number, reverse: boolean = false): Promise<PriceQuote | null> {
    try {
      if (!this.isReady()) {
        throw new ValidationError('Provider not ready', { symbol, provider: 'solana' });
      }

      const tokenConfig = this.configService.getTokenConfig(symbol);
      if (!tokenConfig) {
        throw new ValidationError(`Token ${symbol} not configured`, { symbol });
      }

      if (!isValidTokenAmount(new BigNumber(amount))) {
        throw new ValidationError(`Invalid amount: ${amount}`, { symbol, amount });
      }

      // Update SOL/USD price if needed
      await this.updateSOLUSDPrice();

      // Special case: SOL token - quote SOL → GALA on Solana (buying GALA with SOL)
      // For forward arbitrage: BUY GALA using SOL on Solana
      if (symbol === 'SOL' && (tokenConfig.solQuoteVia || 'SOL') === 'SOL') {
        // Always quote SOL → GALA (selling SOL to get GALA)
        const galaMint = 'eEUiUs4JWYZrp72djAGF1A8PhpR6rHphGeGN7GbVLp6'; // GALA on Solana
        const solMint = 'So11111111111111111111111111111111111111112'; // Native SOL
        const rawAmount = toRawAmount(new BigNumber(amount), 9).toString(); // SOL has 9 decimals
        
        try {
          const response = await this.errorHandler.executeWithProtection(
            () => axios.get(`${this.jupiterApiUrl}/quote`, {
              params: {
                inputMint: solMint,
                outputMint: galaMint,
                amount: rawAmount,
                slippageBps: 50,
                swapMode: 'ExactIn'
              },
              timeout: 10000
            }),
            'jupiter-api',
            `SOL→GALA quote for ${symbol}`
          );

          if (response.data?.outAmount) {
            // GALA has 8 decimals
            const solAmount = new BigNumber(amount);
            const galaAmount = toTokenAmount(new BigNumber(response.data.outAmount), 8);
            const price = galaAmount.div(solAmount); // GALA per SOL
            
            const solanaQuote: SolanaQuote = {
              symbol,
              price,
              currency: 'GALA', // Return price in GALA, not SOL
              tradeSize: amount,
              priceImpactBps: (response.data.priceImpactPct || 0) * 100,
              minOutput: galaAmount.multipliedBy(0.99),
              provider: this.getName(),
              timestamp: Date.now(),
              expiresAt: Date.now() + 30000,
              isValid: true,
              priorityFee: this.calculatePriorityFee(response.data.priceImpactPct || 0),
              jupiterRoute: response.data.routePlan ? {
                routeId: response.data.routePlan[0]?.swapInfo?.label || 'unknown',
                inputMint: solMint,
                outputMint: galaMint,
                steps: response.data.routePlan || [],
                totalPriceImpact: response.data.priceImpactPct || 0,
                totalFee: response.data.platformFee?.amount || 0
              } : undefined
            };
            
            this.updateTimestamp();
            this.clearError();
            logger.debug(`📊 Solana quote for ${symbol} (SOL→GALA): ${price.toString()} GALA per SOL`);
            return solanaQuote;
          }
        } catch (error) {
          await this.errorHandler.handleError(
            error,
            undefined,
            undefined,
            { operation: 'getQuote', symbol, quoteType: 'SOL→GALA', provider: 'solana' }
          );
          return null;
        }
      }

      // Special case: Any token with solQuoteVia === 'GALA' - quote Token → GALA on Solana (selling token to get GALA)
      // For forward arbitrage: Get GALA by selling token on Solana
      // This applies to MEW, USDUC, and any other token that uses GALA as the quote currency
      if ((tokenConfig.solQuoteVia || 'SOL') === 'GALA') {
        const galaMint = 'eEUiUs4JWYZrp72djAGF1A8PhpR6rHphGeGN7GbVLp6'; // GALA on Solana
        const tokenMint = tokenConfig.solanaMint;
        if (!tokenMint) {
          logger.warn(`No Solana mint found for ${symbol}`);
          return null;
        }
        
        const rawAmount = toRawAmount(new BigNumber(amount), tokenConfig.decimals).toString();
        
        try {
          const response = await this.errorHandler.executeWithProtection(
            () => axios.get(`${this.jupiterApiUrl}/quote`, {
              params: {
                inputMint: tokenMint,
                outputMint: galaMint,
                amount: rawAmount,
                slippageBps: 50,
                swapMode: 'ExactIn'
              },
              timeout: 10000
            }),
            'jupiter-api',
            `${symbol}→GALA quote`
          );

          if (response.data?.outAmount) {
            // GALA has 8 decimals
            const tokenAmount = new BigNumber(amount);
            const galaAmount = toTokenAmount(new BigNumber(response.data.outAmount), 8);
            const price = galaAmount.div(tokenAmount); // GALA per token
            
            const solanaQuote: SolanaQuote = {
              symbol,
              price,
              currency: 'GALA', // Return price in GALA
              tradeSize: amount,
              priceImpactBps: (response.data.priceImpactPct || 0) * 100,
              minOutput: galaAmount.multipliedBy(0.99),
              provider: this.getName(),
              timestamp: Date.now(),
              expiresAt: Date.now() + 30000,
              isValid: true,
              priorityFee: this.calculatePriorityFee(response.data.priceImpactPct || 0),
              jupiterRoute: response.data.routePlan ? {
                routeId: response.data.routePlan[0]?.swapInfo?.label || 'unknown',
                inputMint: tokenMint,
                outputMint: galaMint,
                steps: response.data.routePlan || [],
                totalPriceImpact: response.data.priceImpactPct || 0,
                totalFee: response.data.platformFee?.amount || 0
              } : undefined
            };
            
            this.updateTimestamp();
            this.clearError();
            logger.debug(`📊 Solana quote for ${symbol} (${symbol}→GALA): ${price.toString()} GALA per ${symbol}`);
            return solanaQuote;
          }
        } catch (error) {
          await this.errorHandler.handleError(
            error,
            undefined,
            undefined,
            { operation: 'getQuote', symbol, quoteType: `${symbol}→GALA`, provider: 'solana' }
          );
          return null;
        }
      }

      // Get quote based on direction with error handling
      // reverse=false: SOL → Token (buying token with SOL/USDC)
      // reverse=true: Token → SOL (selling token for SOL/USDC)
      const quote = await this.errorHandler.executeWithProtection(
        () => this.getJupiterQuote(symbol, amount, reverse),
        'jupiter-api',
        `Jupiter quote for ${symbol}`
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
            priceImpactBps = calculateBps(effectivePrice, inverseSpotPrice);
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
      const botError = await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'getQuote', symbol, amount, reverse, provider: 'solana' }
      );
      this.setError(botError.message);
      return null;
    }
  }

  private async getJupiterQuote(
    tokenSymbol: string, 
    amount: number,
    reverse: boolean = false
  ): Promise<{
    inputAmount: string;
    outputAmount: string;
    priceImpact: number;
    route?: any;
  } | null> {
    try {
      const tokenConfig = this.configService.getTokenConfig(tokenSymbol);
      if (!tokenConfig?.solanaMint) {
        throw new Error(`No Solana mint for token ${tokenSymbol}`);
      }

      // Get the quote token configuration
      const quoteTokenConfig = this.configService.getQuoteTokenConfig(tokenConfig.solQuoteVia);
      if (!quoteTokenConfig) {
        throw new Error(`Quote token config not found for ${tokenConfig.solQuoteVia}`);
      }
      if (!quoteTokenConfig.solanaMint) {
        throw new Error(`No Solana mint for quote token ${tokenConfig.solQuoteVia}`);
      }

      // Special case: Can't quote SOL/SOL on Jupiter (trying to swap SOL for itself)
      if (tokenConfig.solanaMint === quoteTokenConfig.solanaMint) {
        logger.debug(`Skipping Jupiter quote for ${tokenSymbol}/${tokenConfig.solQuoteVia} - same mint, returning 1:1 price`);
        // Return a 1:1 quote with no price impact
        const rawAmount = toRawAmount(new BigNumber(amount), tokenConfig.decimals).toString();
        return {
          inputAmount: rawAmount,
          outputAmount: rawAmount,
          priceImpact: 0,
          route: undefined
        };
      }

      let inputMint: string;
      let outputMint: string;
      let swapMode: 'ExactIn' | 'ExactOut';
      let rawAmount: string;

      if (reverse) {
        // Selling token for quote token: Token → QuoteToken
        inputMint = tokenConfig.solanaMint;     // source token
        outputMint = quoteTokenConfig.solanaMint; // e.g., USDC
        swapMode = 'ExactIn';
        rawAmount = toRawAmount(new BigNumber(amount), tokenConfig.decimals).toString();
      } else {
        // Buying token with quote token: QuoteToken → Token
        inputMint = quoteTokenConfig.solanaMint; // e.g., USDC
        outputMint = tokenConfig.solanaMint;     // target token
        swapMode = 'ExactOut';
        rawAmount = toRawAmount(new BigNumber(amount), tokenConfig.decimals).toString();
      }

      // Get quote from Jupiter with error handling
      const response = await this.errorHandler.executeWithProtection(
        () => axios.get(`${this.jupiterApiUrl}/quote`, {
          params: {
            inputMint,
            outputMint,
            amount: rawAmount,
            slippageBps: 50, // 0.5% slippage
            swapMode
          },
          timeout: 10000
        }),
        'jupiter-api',
        `Jupiter quote ${inputMint}→${outputMint}`
      );

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
      await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'getJupiterQuote', tokenSymbol, amount, reverse }
      );
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

      const tokenConfig = this.configService.getTokenConfig(tokenSymbol);
      const solQuoteVia = tokenConfig?.solQuoteVia || 'SOL';
      const quoteTokenConfig = this.configService.getQuoteTokenConfig(solQuoteVia);
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

    // Try to get SOL/USD from SOL/USDC pool on Jupiter first (most accurate)
    try {
      const solMint = 'So11111111111111111111111111111111111111112'; // Native SOL
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
      const amount = 1; // 1 SOL
      const rawAmount = (amount * 1_000_000_000).toString(); // Convert to lamports
      
      const response = await this.errorHandler.executeWithProtection(
        () => axios.get(`${this.jupiterApiUrl}/quote`, {
          params: {
            inputMint: solMint,
            outputMint: usdcMint,
            amount: rawAmount,
            slippageBps: 50,
            swapMode: 'ExactIn'
          },
          timeout: 5000
        }),
        'jupiter-api',
        'SOL/USDC price update'
      );

      if (response.data?.outAmount) {
        // USDC has 6 decimals, SOL has 9 decimals
        const solAmount = new BigNumber(amount);
        const usdcAmount = new BigNumber(response.data.outAmount).dividedBy(1_000_000); // Convert from raw USDC (6 decimals)
        
        // Price = USDC received / SOL spent
        this.solUsdPrice = usdcAmount.toNumber();
        this.solUsdPriceLastUpdate = now;
        logger.info(`💰 SOL/USD price: $${this.solUsdPrice.toFixed(2)} [Source: SOL/USDC pool on Jupiter]`);
        return;
      }
    } catch (jupiterError) {
      await this.errorHandler.handleError(
        jupiterError,
        undefined,
        undefined,
        { operation: 'updateSOLUSDPrice', source: 'jupiter' }
      );
    }

    // Fallback to CoinGecko
    try {
      const response = await this.errorHandler.executeWithProtection(
        () => axios.get(`${this.coinGeckoApiUrl}/simple/price`, {
          params: {
            ids: 'solana',
            vs_currencies: 'usd'
          },
          timeout: 10000
        }),
        'coingecko-api',
        'SOL/USD price update'
      );

      if (response.data?.solana?.usd) {
        this.solUsdPrice = response.data.solana.usd;
        this.solUsdPriceLastUpdate = now;
        logger.info(`💰 SOL/USD price: $${this.solUsdPrice.toFixed(2)} [Source: CoinGecko]`);
        return;
      }
    } catch (error) {
      // Handle CoinGecko errors (rate limiting is common)
      const statusCode = (error as any)?.response?.status;
      await this.errorHandler.handleError(
        error,
        undefined,
        statusCode === 429 ? undefined : undefined,
        { operation: 'updateSOLUSDPrice', source: 'coingecko', statusCode }
      );
    }

    // Last resort: use fallback if no price sources worked
    if (this.solUsdPrice === 0) {
      this.solUsdPrice = 225; // Fallback price
      logger.warn(`Using fallback SOL/USD price: $${this.solUsdPrice}`);
    }
  }

  /**
   * Get current SOL/USD price
   */
  getSOLUSDPrice(): number {
    return this.solUsdPrice;
  }
}
