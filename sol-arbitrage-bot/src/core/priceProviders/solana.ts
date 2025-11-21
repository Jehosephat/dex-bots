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
import { QuoteValidator } from '../../core/quoteValidator';
import { getPriceCache } from '../../core/priceCache';
import { StrategyManager } from './strategies/strategyManager';
import { SolanaStandardQuoteStrategy } from './strategies/solanaStandardQuoteStrategy';
import { JupiterUltraClient } from '../../services/jupiterUltraClient';
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
  private errorHandler = getErrorHandler();
  private quoteValidator: QuoteValidator;
  private priceCache = getPriceCache();
  private strategyManager: StrategyManager;
  private useUltraSwap: boolean;
  private ultraClient: JupiterUltraClient | null = null;

  constructor(private configService: IConfigService) {
    super();
    this.quoteValidator = new QuoteValidator();
    
    // Check if Ultra Swap should be used
    this.useUltraSwap = (process.env.USE_JUPITER_ULTRA || '').toLowerCase() === 'true';
    if (this.useUltraSwap) {
      this.ultraClient = new JupiterUltraClient();
      logger.info('✅ Jupiter Ultra Swap API enabled (dynamic rate limits)');
    }
    
      // Initialize strategy manager with bound methods
      // Note: getJupiterQuote will be called with quoteCurrency from the strategy
      this.strategyManager = StrategyManager.createSolanaStrategyManager(
        this.jupiterApiUrl,
        (tokenSymbol: string, amount: number, reverse: boolean, quoteCurrency?: string) => 
          this.getJupiterQuote(tokenSymbol, amount, reverse, quoteCurrency),
        (tokenSymbol: string) => this.getSpotPrice(tokenSymbol),
        this.configService
      );
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

  async getQuote(symbol: string, amount: number, reverse: boolean = false, quoteCurrency?: string): Promise<PriceQuote | null> {
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

      // Update SOL/USD price if needed (using cache)
      await this.updateSOLUSDPrice();

      // Create temporary token config with override quote currency (for strategies)
      const tempTokenConfig = quoteCurrency 
        ? { ...tokenConfig, solQuoteVia: quoteCurrency }
        : tokenConfig;

      // Get strategy for this token
      const strategy = this.strategyManager.getStrategy(tempTokenConfig, reverse);
      if (!strategy) {
        logger.warn(`No strategy found for token ${symbol}`, { solQuoteVia: tokenConfig.solQuoteVia });
        return null;
      }

      // Get quote using strategy
      // Use tempTokenConfig (with quoteCurrency override) instead of original tokenConfig
      const configToUse = quoteCurrency ? tempTokenConfig : tokenConfig;
      let quote: PriceQuote | null;
      if (strategy instanceof SolanaStandardQuoteStrategy) {
        // Standard strategy needs reverse parameter
        quote = await (strategy as any).getQuoteWithReverse(symbol, amount, configToUse, reverse);
      } else {
        quote = await strategy.getQuote(symbol, amount, configToUse);
      }

      // Validate quote
      if (quote) {
        const validation = this.quoteValidator.validate(quote, `Solana quote for ${symbol}`);
        if (!validation.isValid) {
          // Validation errors are already logged by quoteValidator at debug level
          return null;
        }
        
        this.updateTimestamp();
        this.clearError();
        return quote;
      }

      return null;
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
    reverse: boolean = false,
    quoteCurrency?: string
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

      // Use provided quoteCurrency override, or fall back to token config
      const effectiveQuoteCurrency = quoteCurrency || tokenConfig.solQuoteVia;

      // Get the quote token configuration
      const quoteTokenConfig = this.configService.getQuoteTokenConfig(effectiveQuoteCurrency);
      if (!quoteTokenConfig) {
        throw new Error(`Quote token config not found for ${effectiveQuoteCurrency}`);
      }
      if (!quoteTokenConfig.solanaMint) {
        throw new Error(`No Solana mint for quote token ${effectiveQuoteCurrency}`);
      }

      // Special case: Can't quote SOL/SOL on Jupiter (trying to swap SOL for itself)
      if (tokenConfig.solanaMint === quoteTokenConfig.solanaMint) {
        logger.debug(`Skipping Jupiter quote for ${tokenSymbol}/${effectiveQuoteCurrency} - same mint, returning 1:1 price`);
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

      // Try Ultra Swap API first if enabled, fallback to v1 API
      if (this.useUltraSwap && this.ultraClient) {
        try {
          const wallet = process.env.SOLANA_WALLET_ADDRESS;
          if (!wallet) {
            throw new Error('SOLANA_WALLET_ADDRESS not set for Ultra Swap');
          }

          const order = await this.ultraClient.getOrder({
            inputMint,
            outputMint,
            amount: rawAmount,
            slippageBps: 50,
            swapMode,
            userPublicKey: wallet,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto'
          });

          return {
            inputAmount: order.inAmount,
            outputAmount: order.outAmount,
            priceImpact: order.priceImpactPct || 0,
            route: order.routePlan ? {
              routeId: order.routePlan[0]?.swapInfo?.label || 'unknown',
              inputMint: inputMint,
              outputMint: outputMint,
              steps: order.routePlan || [],
              totalPriceImpact: order.priceImpactPct || 0,
              totalFee: order.platformFee?.amount || 0
            } : undefined
          };
        } catch (ultraError) {
          logger.warn('⚠️ Ultra Swap API failed, falling back to v1 API', {
            error: ultraError instanceof Error ? ultraError.message : String(ultraError)
          });
          // Fall through to v1 API
        }
      }

      // Fallback to v1 API (or use if Ultra Swap not enabled)
      // Use more tolerant circuit breaker config for Jupiter API to handle rate limiting better
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
        `Jupiter quote ${inputMint}→${outputMint}`,
        undefined, // retryPolicy
        {
          failureThreshold: 10,  // More tolerant: 10 failures instead of 5
          timeout: 60000,         // Longer wait: 60s instead of 30s before retry
          failureWindow: 120000  // Longer window: 2min instead of 1min
        }
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
    // Check cache first
    const cachedPrice = this.priceCache.get('SOL/USD', 60000); // 60 second TTL
    if (cachedPrice !== null) {
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
        'SOL/USDC price update',
        undefined, // retryPolicy
        {
          failureThreshold: 10,  // More tolerant: 10 failures instead of 5
          timeout: 60000,         // Longer wait: 60s instead of 30s before retry
          failureWindow: 120000  // Longer window: 2min instead of 1min
        }
      );

      if (response.data?.outAmount) {
        // USDC has 6 decimals, SOL has 9 decimals
        const solAmount = new BigNumber(amount);
        const usdcAmount = new BigNumber(response.data.outAmount).dividedBy(1_000_000); // Convert from raw USDC (6 decimals)
        
        // Price = USDC received / SOL spent
        const solUsdPrice = usdcAmount.toNumber();
        this.priceCache.set('SOL/USD', solUsdPrice, 'SOL/USDC pool on Jupiter');
        logger.info(`💰 SOL/USD price: $${solUsdPrice.toFixed(2)} [Source: SOL/USDC pool on Jupiter]`);
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
        const solUsdPrice = response.data.solana.usd;
        this.priceCache.set('SOL/USD', solUsdPrice, 'CoinGecko');
        logger.info(`💰 SOL/USD price: $${solUsdPrice.toFixed(2)} [Source: CoinGecko]`);
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
    const finalCachedPrice = this.priceCache.get('SOL/USD');
    if (finalCachedPrice === null) {
      const fallbackPrice = 225; // Fallback price
      this.priceCache.set('SOL/USD', fallbackPrice, 'fallback');
      logger.warn(`Using fallback SOL/USD price: $${fallbackPrice}`);
    }
  }

  /**
   * Get current SOL/USD price
   */
  getSOLUSDPrice(): number {
    const cachedPrice = this.priceCache.get('SOL/USD');
    return cachedPrice !== null ? cachedPrice : 225; // Fallback to 225 if not cached
  }
}
