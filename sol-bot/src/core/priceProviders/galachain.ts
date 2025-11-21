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
import { TokenPrice, TokenConfig } from '../../types';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

/**
 * GalaChain DEX price provider
 * Fetches prices from GalaChain DEX v3 using local quoting
 */
export class GalaChainPriceProvider extends BasePriceProvider {
  private galaChainApiUrl = 'https://gateway-mainnet.galachain.com/api/asset/dexv3-contract/GetCompositePool';

  async initialize(): Promise<void> {
    logger.info('GalaChain price provider initialized');
  }

  getName(): string {
    return 'galachain';
  }

  async updatePrices(tokens: TokenConfig[]): Promise<void> {
    for (const tokenConfig of tokens) {
      try {
        const quoteVia = tokenConfig.gcQuoteVia || 'GUSDC';
        const quoteAmount = tokenConfig.minTradeSize;
        
        // Create token class keys
        const tokenKey = this.parseTokenMint(tokenConfig.galaChainMint);
        
        let priceInGALA: number;
        let priceInUSD: number;

        if (quoteVia === 'GALA') {
          // Direct GALA pair (e.g., GTRUMP/GALA)
          const galaKey = this.parseTokenMint('GALA|Unit|none|none');
          
          // Determine correct token ordering (GalaChain requires token0 < token1)
          const comparison = this.compareTokenKeys(galaKey, tokenKey);
          
          let quote;
          if (comparison < 0) {
            // Pool is GALA/TOKEN (e.g., GALA/GTRUMP)
            // We want to sell TOKEN for GALA, so use zeroForOne = false
            quote = await this.getLocalQuote(
              galaKey,
              tokenKey,
              new BigNumber(quoteAmount),
              DexFeePercentageTypes.FEE_1_PERCENT,
              false  // Selling token1 (TOKEN) for token0 (GALA)
            );
            
            if (!quote) {
              logger.warn(`No quote available for ${tokenConfig.symbol}/GALA`);
              continue;
            }
            
            // When zeroForOne = false:
            // - amount1 is negative (token1 input)
            // - amount0 is positive (token0 output)
            const tokenIn = Math.abs(parseFloat(quote.amount1));
            const galaOut = Math.abs(parseFloat(quote.amount0));
            priceInGALA = galaOut / tokenIn;
            
            logger.debug(`GalaChain price for ${tokenConfig.symbol}: ${priceInGALA.toFixed(6)} GALA (pool: GALA/${tokenConfig.symbol})`);
          } else {
            // Pool is TOKEN/GALA, use zeroForOne = true
            quote = await this.getLocalQuote(
              tokenKey,
              galaKey,
              new BigNumber(quoteAmount),
              DexFeePercentageTypes.FEE_1_PERCENT,
              true  // Selling token0 (TOKEN) for token1 (GALA)
            );

            if (!quote) {
              logger.warn(`No quote available for ${tokenConfig.symbol}/GALA`);
              continue;
            }

            // When zeroForOne = true:
            // - amount0 is positive (token0 input)
            // - amount1 is negative (token1 output)
            const tokenIn = Math.abs(parseFloat(quote.amount0));
            const galaOut = Math.abs(parseFloat(quote.amount1));
            priceInGALA = galaOut / tokenIn;
            
            logger.debug(`GalaChain price for ${tokenConfig.symbol}: ${priceInGALA.toFixed(6)} GALA (pool: ${tokenConfig.symbol}/GALA)`);
          }

          // Convert GALA to USD
          const galaUSDPrice = await this.getGALAUSDPrice();
          priceInUSD = priceInGALA * galaUSDPrice;
        } else {
          // GUSDC pair (e.g., GFARTCOIN/GUSDC) - need to convert to GALA
          const quoteTokenMint = config.getTokensConfig().quoteTokens?.[quoteVia]?.galaChainMint || 'GUSDC|Unit|none|none';
          const quoteKey = this.parseTokenMint(quoteTokenMint);

          const quote = await this.getLocalQuote(
            tokenKey,
            quoteKey,
            new BigNumber(quoteAmount),
            DexFeePercentageTypes.FEE_1_PERCENT
          );

          if (!quote) {
            logger.warn(`No quote available for ${tokenConfig.symbol}/${quoteVia}`);
            continue;
          }

          // Quote returns amount in GUSDC
          const gusdcReceived = Math.abs(parseFloat(quote.amount1));
          const priceInGUSDC = gusdcReceived / quoteAmount;
          priceInUSD = priceInGUSDC; // GUSDC ≈ 1 USD

          // Convert GUSDC to GALA: need GUSDC/GALA rate
          const gusdcGalaRate = await this.getGUSDCGALARate();
          priceInGALA = priceInGUSDC * gusdcGalaRate;

          logger.debug(`GalaChain price for ${tokenConfig.symbol}: ${priceInGALA.toFixed(6)} GALA (${priceInGUSDC.toFixed(6)} ${quoteVia})`);
        }

        this.setPrice(tokenConfig.symbol, {
          token: tokenConfig.symbol,
          price: priceInGALA,
          priceUSD: priceInUSD,
          liquidity: 0,
          timestamp: Date.now(),
          source: 'galachain'
        });

      } catch (error: any) {
        logger.error(`Failed to fetch GalaChain price for ${tokenConfig.symbol}`, { 
          error: error.message || error 
        });
      }
    }

    this.updateTimestamp();
  }

  private async getLocalQuote(
    token0: TokenClassKey,
    token1: TokenClassKey,
    amount: BigNumber,
    fee: number,
    zeroForOne: boolean = true
  ): Promise<{ amount0: string; amount1: string } | null> {
    try {
      // 1. Get composite pool data
      const getCompositePoolDto = new GetCompositePoolDto(token0, token1, fee);
      
      const response = await axios.post(this.galaChainApiUrl, getCompositePoolDto, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.data?.Data) {
        return null;
      }

      // 2. Convert response to CompositePoolDto
      const compositePoolData = this.createCompositePoolDtoFromResponse(response.data.Data);

      // 3. Perform local quote
      const quoteDto = new QuoteExactAmountDto(
        token0,
        token1,
        fee,
        amount,
        zeroForOne,
        compositePoolData
      );

      const quoteResult: any = await quoteExactAmount(null as any, quoteDto);
      return {
        amount0: quoteResult.amount0.toString(),
        amount1: quoteResult.amount1.toString()
      };
    } catch (error: any) {
      throw new Error(error.message || 'Local quote failed');
    }
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

    // Create TokenBalance objects - using 'as any' to work around type issues
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
    // Returns: < 0 if token0 < token1, > 0 if token0 > token1, 0 if equal
    if (token0.collection !== token1.collection) return token0.collection.localeCompare(token1.collection);
    if (token0.category !== token1.category) return token0.category.localeCompare(token1.category);
    if (token0.type !== token1.type) return token0.type.localeCompare(token1.type);
    return token0.additionalKey.localeCompare(token1.additionalKey);
  }

  private async getGUSDCGALARate(): Promise<number> {
    try {
      // Get GALA -> GUSDC quote, then invert to get GUSDC -> GALA rate
      // (GalaChain requires token0 < token1, so we can't quote GUSDC -> GALA directly)
      const galaKey = this.parseTokenMint('GALA|Unit|none|none');
      const gusdcKey = this.parseTokenMint('GUSDC|Unit|none|none');
      
      const quote = await this.getLocalQuote(
        galaKey,
        gusdcKey,
        new BigNumber(1),
        DexFeePercentageTypes.FEE_1_PERCENT
      );

      if (quote) {
        const galaIn = Math.abs(parseFloat(quote.amount0));
        const gusdcOut = Math.abs(parseFloat(quote.amount1));
        const galaPerGUSDC = galaIn / gusdcOut; // Invert the rate
        
        logger.debug(`GUSDC/GALA rate: 1 GUSDC = ${galaPerGUSDC.toFixed(2)} GALA`);
        return galaPerGUSDC;
      }
    } catch (error) {
      logger.warn('Failed to get GUSDC/GALA rate, using fallback', { error });
    }

    // Fallback rate
    return 63.3; // 1 GUSDC = 63.3 GALA (based on ~$0.0158 per GALA)
  }

  async getGALAUSDPrice(): Promise<number> {
    try {
      // Get GALA -> GUSDC rate (GUSDC ≈ 1 USD)
      const galaKey = this.parseTokenMint('GALA|Unit|none|none');
      const gusdcKey = this.parseTokenMint('GUSDC|Unit|none|none');
      
      const quote = await this.getLocalQuote(
        galaKey,
        gusdcKey,
        new BigNumber(1),
        DexFeePercentageTypes.FEE_1_PERCENT
      );

      if (quote) {
        const galaIn = Math.abs(parseFloat(quote.amount0));
        const gusdcOut = Math.abs(parseFloat(quote.amount1));
        const galaUSDPrice = gusdcOut / galaIn;
        
        logger.debug(`GALA/USD price: 1 GALA = $${galaUSDPrice.toFixed(6)} USD`);
        return galaUSDPrice;
      }
    } catch (error) {
      logger.warn('Failed to get GALA/USD price, using fallback', { error });
    }

    return 0.04; // $0.04 per GALA as fallback
  }
}

