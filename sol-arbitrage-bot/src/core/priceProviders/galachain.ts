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
  private galaUsdPriceCacheDuration: number = 300000; // Cache for 5 minutes (300 seconds)

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

      // Get the quote - pass amount directly (e.g., 0.01 SOL)
      const quote = await this.getLocalQuote(
        symbol,
        quoteVia,
        new BigNumber(amount),
        DexFeePercentageTypes.FEE_1_PERCENT
      );

      if (!quote) {
        return null;
      }

      // Calculate price and price impact
      const outputAmount = new BigNumber(quote.outputAmount);
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
    // Declare variables outside try block for use in catch block
    let tokenConfig: TokenConfig | undefined;
    let quoteTokenConfig: any;
    let isToken0Quote: boolean = false;
    let zeroForOne: boolean = false;
    let token0Key: TokenClassKey | undefined;
    let token1Key: TokenClassKey | undefined;
    let compositePoolData: CompositePoolDto | undefined;
    
    try {
      // Parse token mints
      tokenConfig = getTokenConfig(tokenSymbol);
      quoteTokenConfig = getQuoteTokenConfig(quoteVia);
      
      if (!tokenConfig || !quoteTokenConfig) {
        throw new Error('Token configuration not found');
      }

      const tokenKey = this.parseTokenMint(tokenConfig.galaChainMint);
      const quoteKey = this.parseTokenMint(quoteTokenConfig.galaChainMint);

      // Determine token ordering (GalaChain requires token0 < token1)
      const comparison = this.compareTokenKeys(quoteKey, tokenKey);
      isToken0Quote = comparison < 0;
      
      // Based on working code in sol-bot: when selling tokenSymbol for quoteVia
      // If quoteKey < tokenKey (GALA < GSOL): pool is GALA/GSOL, selling GSOL (token1) for GALA (token0)
      // If quoteKey > tokenKey: pool is TOKEN/GALA, selling TOKEN (token0) for GALA (token1)
      
      if (isToken0Quote) {
        // Pool is GALA/TOKEN (e.g., GALA/GSOL when selling SOL)
        // token0 = GALA, token1 = TOKEN (e.g., GSOL)
        token0Key = quoteKey; // GALA
        token1Key = tokenKey;  // TOKEN (e.g., GSOL)
        zeroForOne = false; // Selling token1 (SOL) for token0 (GALA)
      } else {
        // Pool is TOKEN/GALA (e.g., TRUMP/GALA when selling TRUMP)
        // token0 = TOKEN, token1 = GALA
        token0Key = tokenKey;  // TOKEN
        token1Key = quoteKey;  // GALA
        zeroForOne = true; // Selling token0 (TOKEN) for token1 (GALA)
      }

      // Get composite pool data
      const getCompositePoolDto = new GetCompositePoolDto(
        token0Key,
        token1Key,
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
      compositePoolData = this.createCompositePoolDtoFromResponse(response.data.Data);

      const token0Str = token0Key.collection || `${token0Key.category}|${token0Key.type}|${token0Key.additionalKey}`;
      const token1Str = token1Key.collection || `${token1Key.category}|${token1Key.type}|${token1Key.additionalKey}`;
      
      // Perform direct quote
      logger.info('🔍 Quote Parameters:', {
        tokenSymbol,
        quoteVia,
        token0: token0Str,
        token1: token1Str,
        amount: amount.toString(),
        zeroForOne,
        sellingToken: zeroForOne ? 'token0' : 'token1',
        receivingToken: zeroForOne ? 'token1' : 'token0'
      });

      const quoteDto = new QuoteExactAmountDto(
        token0Key,
        token1Key,
        fee,
        amount,
        zeroForOne,
        compositePoolData
      );

      const quoteResult: any = await quoteExactAmount(null as any, quoteDto);
      
      // Extract output
      // When zeroForOne = false (selling token1): amount0 is output (positive), amount1 is input (negative)
      // When zeroForOne = true (selling token0): amount1 is output (positive), amount0 is input (negative)
      let outputAmount: BigNumber;
      if (zeroForOne) {
        // Selling token0, receiving token1
        outputAmount = new BigNumber(quoteResult.amount1 || '0');
      } else {
        // Selling token1, receiving token0
        outputAmount = new BigNumber(quoteResult.amount0 || '0');
      }
      
      return {
        outputAmount: outputAmount.toString(),
        poolAddress: 'unknown',
        route: [tokenSymbol, quoteVia]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // If direct quote fails for SOL (selling token1 for token0), try reverse quote as fallback
      if (tokenConfig && quoteTokenConfig && token0Key && token1Key && compositePoolData &&
          isToken0Quote && !zeroForOne && errorMessage.includes('liquidity')) {
        logger.info('🔄 Direct quote failed, attempting reverse quote (GALA → SOL) as fallback...');
        
        try {
          // Estimate GALA needed: ~18,000 GALA per SOL
          const estimatedGalaNeeded = amount.multipliedBy(18000);
          
          logger.info('🔄 Reverse quote calculation:', {
            solAmount: amount.toString(),
            estimatedGala: estimatedGalaNeeded.toString()
          });
          
          const reverseQuoteDto = new QuoteExactAmountDto(
            token0Key,
            token1Key,
            fee,
            estimatedGalaNeeded,
            true, // zeroForOne=true: selling token0 (GALA) for token1 (SOL)
            compositePoolData
          );
          
          const reverseQuoteResult: any = await quoteExactAmount(null as any, reverseQuoteDto);
          const solReceived = new BigNumber(reverseQuoteResult.amount1 || '0');
          
          if (solReceived.gt(0)) {
            // Price per SOL = GALA sold / SOL received
            const pricePerSol = estimatedGalaNeeded.div(solReceived);
            const expectedOutput = amount.multipliedBy(pricePerSol);
            
            logger.info('✅ Reverse quote succeeded!', {
              galaIn: estimatedGalaNeeded.toString(),
              solOut: solReceived.toString(),
              pricePerSol: pricePerSol.toString(),
              expectedGalaOutput: expectedOutput.toString()
            });
            
            return {
              outputAmount: expectedOutput.toString(),
              poolAddress: 'unknown',
              route: [tokenSymbol, quoteVia]
            };
          }
        } catch (reverseError: any) {
          logger.warn('⚠️ Reverse quote also failed:', {
            error: reverseError.message || reverseError
          });
        }
      }
      
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
      const smallAmount = new BigNumber(1);
      const quote = await this.getLocalQuote(
        tokenSymbol,
        quoteVia,
        smallAmount,
        DexFeePercentageTypes.FEE_1_PERCENT
      );

      if (!quote) {
        return new BigNumber(0);
      }

      const outputAmount = new BigNumber(quote.outputAmount);
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
    
    // Check if cached price is still valid (5 minute cache to avoid rate limits)
    const cacheAge = now - this.galaUsdPriceLastUpdate;
    if (this.galaUsdPrice > 0 && cacheAge < this.galaUsdPriceCacheDuration) {
      logger.debug(`Using cached GALA/USD price: $${this.galaUsdPrice.toFixed(6)} (age: ${Math.floor(cacheAge / 1000)}s)`);
      return;
    }

    // Try CoinGecko first
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'gala',
          vs_currencies: 'usd'
        },
        timeout: 10000
      });

      if (response.data?.gala?.usd) {
        const newPrice = response.data.gala.usd;
        const priceChanged = Math.abs(newPrice - this.galaUsdPrice) > 0.0001;
        this.galaUsdPrice = newPrice;
        this.galaUsdPriceLastUpdate = now;
        logger.info(`💰 GALA/USD price: $${this.galaUsdPrice.toFixed(6)}${priceChanged ? ' (updated)' : ''} [Source: CoinGecko]`);
        return;
      }
    } catch (error: any) {
      const errorMsg = error?.response?.status === 429 
        ? 'CoinGecko rate limited (429)' 
        : (error instanceof Error ? error.message : String(error));
      logger.debug(`CoinGecko fetch failed: ${errorMsg}`);
    }

    // If CoinGecko fails and we have a cached price, keep using it
    if (this.galaUsdPrice > 0) {
      logger.warn(`⚠️ Failed to refresh GALA/USD price, continuing with cached value: $${this.galaUsdPrice.toFixed(6)} (age: ${Math.floor(cacheAge / 1000)}s)`);
      return;
    }

    // Last resort: use fallback if no cached price exists
    this.galaUsdPrice = 0.01; // Updated fallback closer to current market (~$0.01)
    logger.warn(`Using fallback GALA/USD price: $${this.galaUsdPrice}`);
  }

  /**
   * Get current GALA/USD price
   */
  getGALAUSDPrice(): number {
    return this.galaUsdPrice;
  }
}
