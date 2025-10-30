/**
 * GalaChain Price Provider
 * 
 * Provides size-aware quoting for GalaChain DEX v3 using local quoting.
 * Handles token→GALA swaps with proper fee calculation.
 */

import axios from 'axios';
import BigNumber from 'bignumber.js';
import { TokenClassKey, TokenBalance } from '@gala-chain/api';
import { 
  GetCompositePoolDto, 
  QuoteExactAmountDto, 
  quoteExactAmount, 
  DexFeePercentageTypes,
  CompositePoolDto, 
  Pool, 
  TickData 
} from '@gala-chain/dex';
import { BasePriceProvider } from './base';
import { PriceQuote, GalaChainQuote } from '../../types/core';
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
 * GalaChain DEX price provider
 * Fetches size-aware quotes from GalaChain DEX v3 using local quoting
 */
export class GalaChainPriceProvider extends BasePriceProvider {
  private galaChainApiUrl = 'https://gateway-mainnet.galachain.com/api/asset/dexv3-contract/GetCompositePool';
  private galaUsdPrice: number = 0;
  private galaUsdPriceLastUpdate: number = 0;
  private galaUsdPriceCacheDuration: number = 60000; // Cache for 60 seconds

  async initialize(): Promise<void> {
    try {
      // Fetch initial GALA/USD price
      await this.updateGALAUSDPrice();
      this.isInitialized = true;
      this.clearError();
      logger.info('✅ GalaChain price provider initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setError(errorMessage);
      logger.error('❌ Failed to initialize GalaChain price provider', { error: errorMessage });
      throw error;
    }
  }

  getName(): string {
    return 'galachain';
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

      // Get quote via the configured quote token (usually GALA)
      const quoteVia = tokenConfig.gcQuoteVia || 'GALA';
      const quoteTokenConfig = getQuoteTokenConfig(quoteVia);
      if (!quoteTokenConfig) {
        throw new Error(`Quote token ${quoteVia} not configured`);
      }

      // Convert amount to raw amount
      const rawAmount = toRawAmount(new BigNumber(amount), tokenConfig.decimals);

      // Get the quote
      const quote = await this.getLocalQuote(
        symbol,
        quoteVia,
        rawAmount,
        DexFeePercentageTypes.FEE_1_PERCENT
      );

      if (!quote) {
        return null;
      }

      // Calculate price and price impact
      const outputAmount = toTokenAmount(new BigNumber(quote.outputAmount), quoteTokenConfig.decimals);
      const price = outputAmount.div(amount);
      const spotPrice = await this.getSpotPrice(symbol, quoteVia);
      const priceImpactBps = calculatePriceImpactBps(
        new BigNumber(amount),
        outputAmount,
        spotPrice
      );

      // Calculate GALA fee (1 GALA per hop + pool fees)
      const galaFee = this.calculateGalaFee(quote.route?.length || 1);

      const galaChainQuote: GalaChainQuote = {
        symbol,
        price,
        currency: 'GALA',
        tradeSize: amount,
        priceImpactBps,
        minOutput: outputAmount.multipliedBy(0.99), // 1% slippage protection
        feeTier: DexFeePercentageTypes.FEE_1_PERCENT,
        poolAddress: quote.poolAddress,
        provider: this.getName(),
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000, // 30 seconds
        isValid: true,
        galaFee,
        route: quote.route
      };

      this.updateTimestamp();
      this.clearError();

      logger.debug(`📊 GalaChain quote for ${symbol}: ${price.toString()} GALA (impact: ${priceImpactBps}bps)`);
      return galaChainQuote;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setError(errorMessage);
      logger.error(`❌ Failed to get GalaChain quote for ${symbol}`, { 
        symbol, 
        amount, 
        error: errorMessage 
      });
      return null;
    }
  }

  private async getLocalQuote(
    tokenSymbol: string,
    quoteVia: string,
    amount: BigNumber,
    fee: number
  ): Promise<{
    outputAmount: string;
    poolAddress: string;
    route?: string[];
  } | null> {
    try {
      // Parse token mints
      const tokenConfig = getTokenConfig(tokenSymbol);
      const quoteTokenConfig = getQuoteTokenConfig(quoteVia);
      
      if (!tokenConfig || !quoteTokenConfig) {
        throw new Error('Token configuration not found');
      }

      const tokenKey = this.parseTokenMint(tokenConfig.galaChainMint);
      const quoteKey = this.parseTokenMint(quoteTokenConfig.galaChainMint);

      // Determine token ordering (GalaChain requires token0 < token1)
      const comparison = this.compareTokenKeys(quoteKey, tokenKey);
      const isToken0Quote = comparison < 0;

      // Get composite pool data
      const getCompositePoolDto = new GetCompositePoolDto(
        isToken0Quote ? quoteKey : tokenKey,
        isToken0Quote ? tokenKey : quoteKey,
        fee
      );
      
      const response = await axios.post(this.galaChainApiUrl, getCompositePoolDto, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (!response.data?.Data) {
        return null;
      }

      // Convert response to CompositePoolDto
      const compositePoolData = this.createCompositePoolDtoFromResponse(response.data.Data);

      // Perform local quote
      const quoteDto = new QuoteExactAmountDto(
        isToken0Quote ? quoteKey : tokenKey,
        isToken0Quote ? tokenKey : quoteKey,
        fee,
        amount,
        isToken0Quote, // zeroForOne: true if selling token0 for token1
        compositePoolData
      );

      const quoteResult: any = await quoteExactAmount(null as any, quoteDto);
      
      // Extract output amount based on token ordering
      const outputAmount = isToken0Quote ? quoteResult.amount0 : quoteResult.amount1;
      
      return {
        outputAmount: outputAmount.toString(),
        poolAddress: 'unknown', // Pool address not available in current API
        route: [tokenSymbol, quoteVia] // Simple route for now
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Local quote failed', { 
        tokenSymbol, 
        quoteVia, 
        amount: amount.toString(),
        error: errorMessage 
      });
      return null;
    }
  }

  private async getSpotPrice(tokenSymbol: string, quoteVia: string): Promise<BigNumber> {
    try {
      // Get a small quote to determine spot price
      const smallAmount = 1; // 1 unit
      const quote = await this.getLocalQuote(
        tokenSymbol,
        quoteVia,
        toRawAmount(new BigNumber(smallAmount), getTokenConfig(tokenSymbol)?.decimals || 6),
        DexFeePercentageTypes.FEE_1_PERCENT
      );

      if (!quote) {
        return new BigNumber(0);
      }

      const quoteTokenConfig = getQuoteTokenConfig(quoteVia);
      const outputAmount = toTokenAmount(
        new BigNumber(quote.outputAmount), 
        quoteTokenConfig?.decimals || 8
      );

      return outputAmount.div(smallAmount);
    } catch (error) {
      logger.warn('⚠️ Failed to get spot price, using fallback', { tokenSymbol, quoteVia });
      return new BigNumber(0);
    }
  }

  private calculateGalaFee(hops: number): BigNumber {
    // 1 GALA per hop + small buffer
    return new BigNumber(hops).plus(0.1);
  }

  private createCompositePoolDtoFromResponse(responseData: any): CompositePoolDto {
    // Create Pool object with BigNumber conversions
    const pool = new Pool(
      responseData.pool.token0,
      responseData.pool.token1,
      responseData.pool.token0ClassKey,
      responseData.pool.token1ClassKey,
      responseData.pool.fee,
      new BigNumber(responseData.pool.sqrtPrice),
      responseData.pool.protocolFees
    );
    
    pool.bitmap = responseData.pool.bitmap;
    pool.grossPoolLiquidity = new BigNumber(responseData.pool.grossPoolLiquidity);
    pool.liquidity = new BigNumber(responseData.pool.liquidity);
    pool.feeGrowthGlobal0 = new BigNumber(responseData.pool.feeGrowthGlobal0);
    pool.feeGrowthGlobal1 = new BigNumber(responseData.pool.feeGrowthGlobal1);
    pool.protocolFeesToken0 = new BigNumber(responseData.pool.protocolFeesToken0);
    pool.protocolFeesToken1 = new BigNumber(responseData.pool.protocolFeesToken1);
    pool.tickSpacing = responseData.pool.tickSpacing;
    pool.maxLiquidityPerTick = new BigNumber(responseData.pool.maxLiquidityPerTick);

    // Create tick data map
    const tickDataMap: Record<string, any> = {};
    Object.keys(responseData.tickDataMap).forEach(tickKey => {
      const tickData = responseData.tickDataMap[tickKey];
      tickDataMap[tickKey] = new TickData(
        tickData.poolHash,
        tickData.tick
      );
      const tick = tickDataMap[tickKey];
      (tick as any).initialised = tickData.initialised;
      (tick as any).liquidityNet = new BigNumber(tickData.liquidityNet);
      (tick as any).liquidityGross = new BigNumber(tickData.liquidityGross);
      (tick as any).feeGrowthOutside0 = new BigNumber(tickData.feeGrowthOutside0);
      (tick as any).feeGrowthOutside1 = new BigNumber(tickData.feeGrowthOutside1);
    });

    // Create TokenBalance objects
    const token0Balance: any = new TokenBalance({
      owner: responseData.token0Balance.owner,
      collection: responseData.token0Balance.collection,
      category: responseData.token0Balance.category,
      type: responseData.token0Balance.type,
      additionalKey: responseData.token0Balance.additionalKey
    });
    token0Balance.quantity = new BigNumber(responseData.token0Balance.quantity);

    const token1Balance: any = new TokenBalance({
      owner: responseData.token1Balance.owner,
      collection: responseData.token1Balance.collection,
      category: responseData.token1Balance.category,
      type: responseData.token1Balance.type,
      additionalKey: responseData.token1Balance.additionalKey
    });
    token1Balance.quantity = new BigNumber(responseData.token1Balance.quantity);

    return new CompositePoolDto(
      pool,
      tickDataMap as any,
      token0Balance,
      token1Balance,
      responseData.token0Decimals,
      responseData.token1Decimals
    );
  }

  private parseTokenMint(mint: string): TokenClassKey {
    const parts = mint.split('|');
    const key = new TokenClassKey();
    key.collection = parts[0];
    key.category = parts[1];
    key.type = parts[2];
    key.additionalKey = parts[3];
    return key;
  }

  private compareTokenKeys(token0: TokenClassKey, token1: TokenClassKey): number {
    // Compare tokens to determine ordering (used by GalaChain DEX)
    if (token0.collection !== token1.collection) return token0.collection.localeCompare(token1.collection);
    if (token0.category !== token1.category) return token0.category.localeCompare(token1.category);
    if (token0.type !== token1.type) return token0.type.localeCompare(token1.type);
    return token0.additionalKey.localeCompare(token1.additionalKey);
  }

  private async updateGALAUSDPrice(): Promise<void> {
    const now = Date.now();
    
    // Check if cached price is still valid
    if (this.galaUsdPrice > 0 && (now - this.galaUsdPriceLastUpdate) < this.galaUsdPriceCacheDuration) {
      logger.debug(`Using cached GALA/USD price: $${this.galaUsdPrice.toFixed(6)}`);
      return;
    }

    try {
      // Get GALA/USD price from CoinGecko
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'gala',
          vs_currencies: 'usd'
        },
        timeout: 10000
      });

      if (response.data?.gala?.usd) {
        this.galaUsdPrice = response.data.gala.usd;
        this.galaUsdPriceLastUpdate = now;
        logger.info(`💰 GALA/USD price: $${this.galaUsdPrice.toFixed(6)}`);
      }
    } catch (error) {
      logger.warn('⚠️ Failed to fetch GALA/USD price, using fallback', { error });
      if (this.galaUsdPrice === 0) {
        this.galaUsdPrice = 0.04; // Fallback price
        logger.warn(`Using fallback GALA/USD price: $${this.galaUsdPrice}`);
      }
    }
  }

  /**
   * Get current GALA/USD price
   */
  getGALAUSDPrice(): number {
    return this.galaUsdPrice;
  }
}
