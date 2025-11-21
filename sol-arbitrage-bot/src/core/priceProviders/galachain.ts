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
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { BasePriceProvider } from './base';
import { PriceQuote, GalaChainQuote } from '../../types/core';
import { TokenConfig } from '../../types/config';
import { IConfigService } from '../../config';
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
  private gswap: GSwap | null = null;

  constructor(private configService: IConfigService) {
    super();
  }

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

  async getQuote(symbol: string, amount: number, reverse: boolean = false, quoteCurrency?: string): Promise<PriceQuote | null> {
    try {
      if (!this.isReady()) {
        throw new Error('Provider not ready');
      }

      const tokenConfig = this.configService.getTokenConfig(symbol);
      if (!tokenConfig) {
        throw new Error(`Token ${symbol} not configured`);
      }

      if (!isValidTokenAmount(new BigNumber(amount))) {
        throw new Error(`Invalid amount: ${amount}`);
      }

      // Get quote via the configured quote token (usually GALA)
      // Allow quoteCurrency parameter to override token config (for strategies)
      const quoteVia = quoteCurrency || tokenConfig.gcQuoteVia || 'GALA';
      const quoteTokenConfig = this.configService.getQuoteTokenConfig(quoteVia);
      if (!quoteTokenConfig) {
        throw new Error(`Quote token ${quoteVia} not configured`);
      }

      // Determine quote direction:
      // For REVERSE arbitrage (reverse=true): We want to BUY token with GALA (spend GALA, get token)
      //   - shouldReverse=true (selling GALA to buy token)
      // For FORWARD arbitrage (reverse=false): We want to SELL token to GET GALA
      //   - shouldReverse=false (selling token to get GALA)
      // 
      // The reverse parameter indicates arbitrage direction, not quote direction
      const shouldReverse = reverse; // Only reverse for reverse arbitrage (buying token with GALA)

      // Try to use SDK for more accurate quotes (matches executor behavior)
      let quote;
      let exactOutputQuote: { inputAmount: string; outputAmount: string; poolAddress: string; route?: string[] } | null = null;

      if (shouldReverse && quoteVia === 'GALA') {
        // Reverse quote: buying token with GALA - use exact output for accuracy
        // This ensures we get EXACTLY the amount of tokens we need (e.g., exactly 0.01 SOL)
        exactOutputQuote = await this.getSDKExactOutputQuote(symbol, amount);
        if (exactOutputQuote) {
          quote = exactOutputQuote;
        }
      } else if (!shouldReverse && quoteVia === 'GALA') {
        // Forward quote: selling token to get GALA - use SDK if available
        quote = await this.getSDKQuote(symbol, amount);
      }

      // Fall back to local API quote if SDK not available
      if (!quote) {
        logger.debug(`🔍 ${reverse ? 'Reverse' : 'Forward'} Quote Parameters (${quoteVia === 'GALA' ? 'GALA' : 'Token'} → ${quoteVia === 'GALA' ? 'Token' : quoteVia}):`, {
          tokenSymbol: symbol,
          quoteVia,
          token0: quoteVia === 'GALA' ? 'GALA' : symbol,
          token1: quoteVia === 'GALA' ? symbol : quoteVia,
          desiredTokens: reverse ? amount : (quoteVia === 'GALA' ? 'N/A' : amount),
          estimatedGalaInput: reverse ? 'N/A' : (quoteVia === 'GALA' ? amount : 'N/A'),
          reverseZeroForOne: shouldReverse,
          sellingToken: shouldReverse ? 'token0 (GALA)' : (quoteVia === 'GALA' ? 'token1 (token)' : 'token0 (token)'),
          receivingToken: shouldReverse ? 'token1 (token)' : (quoteVia === 'GALA' ? 'token0 (GALA)' : 'token1 (quote)')
        });

        // Get the quote - pass amount directly (e.g., 0.01 SOL or 1500 MEW)
        quote = await this.getLocalQuote(
          symbol,
          quoteVia,
          new BigNumber(amount),
          DexFeePercentageTypes.FEE_1_PERCENT,
          shouldReverse // Reverse if we're selling GALA to buy token (or if reverse arbitrage)
        );
      }

      if (!quote) {
        return null;
      }

      // Calculate price and price impact
      let price: BigNumber;
      let outputAmount: BigNumber;

      if (exactOutputQuote) {
        // Exact output quote: inputAmount is GALA cost, outputAmount is tokens received
        // Price = inputAmount (GALA cost) / outputAmount (tokens received) = GALA per token
        outputAmount = new BigNumber(exactOutputQuote.inputAmount); // GALA cost for the quote result
        price = outputAmount.div(amount); // GALA per token
        logger.info(`📊 Exact output pricing: ${outputAmount.toString()} GALA for exactly ${amount} ${symbol} = ${price.toString()} GALA per token`);
      } else {
        outputAmount = new BigNumber(quote.outputAmount);

        // Price calculation depends on direction:
        if (shouldReverse) {
          // REVERSE: Buying token with GALA (spend GALA, get token)
          // outputAmount is GALA cost, amount is tokens received
          // Price = outputAmount (GALA cost) / amount (tokens received) = GALA per token
          price = outputAmount.div(amount);
        } else {
          // FORWARD: Selling token to get quote currency
          // outputAmount is quote currency received, amount is tokens sold
          // Price = outputAmount (quote currency received) / amount (tokens sold) = quote currency per token
          price = outputAmount.div(amount);
        }
      }
      const spotPrice = await this.getSpotPrice(symbol, quoteVia);
      
      // Price impact calculation depends on direction:
      let priceImpactBps: number;
      if (shouldReverse) {
        // REVERSE: Buying token with GALA - calculate impact from spot price
        // Spot price is for selling token (GALA per token), we're buying at effective price
        if (!spotPrice.isZero()) {
          // Calculate impact: (effectivePrice - spotPrice) / spotPrice
          const priceDiff = price.minus(spotPrice);
          priceImpactBps = priceDiff.div(spotPrice).multipliedBy(10000).abs().toNumber(); // Convert to bps
        } else {
          priceImpactBps = 0;
        }
      } else {
        // FORWARD: Selling token - amount is tokens sold, outputAmount is quote currency received
        priceImpactBps = calculatePriceImpactBps(new BigNumber(amount), outputAmount, spotPrice);
      }

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
        route: quote.route,
        poolLiquidity: (quote as any).poolLiquidity // Include liquidity if available
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

  /**
   * Get quote using GSwap SDK (matches executor behavior for accuracy)
   * Only works for forward quotes (selling token to get GALA)
   */
  private async getSDKQuote(symbol: string, amount: number): Promise<{
    outputAmount: string;
    poolAddress: string;
    route?: string[];
  } | null> {
    try {
      // Initialize SDK if not already initialized
      if (!this.gswap) {
        const priv = process.env.GALACHAIN_PRIVATE_KEY;
        if (!priv) {
          logger.debug('GALACHAIN_PRIVATE_KEY not set, skipping SDK quote');
          return null;
        }
        const signer = new PrivateKeySigner(priv);
        this.gswap = new GSwap({ signer });
      }

      const tokenConfig = this.configService.getTokenConfig(symbol);
      if (!tokenConfig?.galaChainMint) {
        return null;
      }

      const tokenIn = tokenConfig.galaChainMint;
      const tokenOut = 'GALA|Unit|none|none';

      // Use SDK quoting (matches executor)
      const q = await this.gswap.quoting.quoteExactInput(tokenIn, tokenOut, amount);
      const outputAmount = new BigNumber(q.outTokenAmount.toString());

      logger.info(`📊 Using SDK quote for ${symbol}: ${outputAmount.toString()} GALA for ${amount} ${symbol} (matches executor)`);

      return {
        outputAmount: outputAmount.toString(),
        poolAddress: 'unknown',
        route: [symbol, 'GALA']
      };
    } catch (error) {
      logger.debug('SDK quote failed, falling back to local API', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get exact output quote using GSwap SDK for reverse arbitrage.
   * Returns the GALA cost required to receive exactly 'amount' tokens.
   */
  private async getSDKExactOutputQuote(symbol: string, amount: number): Promise<{
    inputAmount: string;
    outputAmount: string;
    poolAddress: string;
    route?: string[];
  } | null> {
    try {
      // Initialize SDK if not already initialized
      if (!this.gswap) {
        const priv = process.env.GALACHAIN_PRIVATE_KEY;
        if (!priv) {
          logger.debug('GALACHAIN_PRIVATE_KEY not set, skipping SDK exact output quote');
          return null;
        }
        const signer = new PrivateKeySigner(priv);
        this.gswap = new GSwap({ signer });
      }

      const tokenConfig = this.configService.getTokenConfig(symbol);
      if (!tokenConfig?.galaChainMint) {
        return null;
      }

      // For reverse (buy token with GALA): tokenIn = GALA, tokenOut = token
      const tokenIn = 'GALA|Unit|none|none';
      const tokenOut = tokenConfig.galaChainMint;

      // Use exact output quoting - how much GALA needed for exactly 'amount' tokens
      const q = await this.gswap.quoting.quoteExactOutput(tokenIn, tokenOut, amount);
      const inputAmount = new BigNumber(q.inTokenAmount.toString());

      logger.info(`📊 Using SDK exact output quote for ${symbol}: ${inputAmount.toString()} GALA for exactly ${amount} ${symbol} (reverse arb)`);

      return {
        inputAmount: inputAmount.toString(),
        outputAmount: amount.toString(),
        poolAddress: 'unknown',
        route: ['GALA', symbol]
      };
    } catch (error) {
      logger.debug('SDK exact output quote failed, falling back to local API', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async getLocalQuote(
    tokenSymbol: string,
    quoteVia: string,
    amount: BigNumber,
    fee: number,
    reverse: boolean = false
  ): Promise<{
    outputAmount: string;
    poolAddress: string;
    route?: string[];
    poolLiquidity?: {
      liquidity: BigNumber;
      grossPoolLiquidity: BigNumber;
    };
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
      tokenConfig = this.configService.getTokenConfig(tokenSymbol);
      quoteTokenConfig = this.configService.getQuoteTokenConfig(quoteVia);
      
      if (!tokenConfig || !quoteTokenConfig) {
        throw new Error('Token configuration not found');
      }

      const tokenKey = this.parseTokenMint(tokenConfig.galaChainMint);
      const quoteKey = this.parseTokenMint(quoteTokenConfig.galaChainMint);

      // Determine token ordering (GalaChain requires token0 < token1)
      const comparison = this.compareTokenKeys(quoteKey, tokenKey);
      isToken0Quote = comparison < 0;
      
      // Get composite pool data first (needed for both forward and reverse)
      let token0Key: TokenClassKey;
      let token1Key: TokenClassKey;
      
      if (isToken0Quote) {
        token0Key = quoteKey; // GALA
        token1Key = tokenKey;  // TOKEN (e.g., GSOL)
      } else {
        token0Key = tokenKey;  // TOKEN
        token1Key = quoteKey;  // GALA
      }

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
      
      let outputAmount: BigNumber;
      
      if (reverse) {
        // Reverse: Selling GALA to buy token
        // First, estimate GALA needed by doing a small forward quote (selling token to get GALA)
        let estimatedGalaNeeded: BigNumber;
        
        try {
          // Do a small forward quote (selling token to get GALA) to estimate rate
          const smallAmount = new BigNumber(1); // 1 token for estimation
          let forwardZeroForOne: boolean;
          if (isToken0Quote) {
            // Pool is GALA/TOKEN, forward: selling token1 for token0 (GALA)
            forwardZeroForOne = false;
          } else {
            // Pool is TOKEN/GALA, forward: selling token0 for token1 (GALA)
            forwardZeroForOne = true;
          }
          
          const estimateDto = new QuoteExactAmountDto(
            token0Key,
            token1Key,
            fee,
            smallAmount,
            forwardZeroForOne,
            compositePoolData
          );
          
          const estimateResult: any = await quoteExactAmount(null as any, estimateDto);
          
          // Extract GALA received from selling smallAmount tokens
          let galaReceived: BigNumber;
          if (forwardZeroForOne) {
            galaReceived = new BigNumber(estimateResult.amount1 || '0').abs();
          } else {
            galaReceived = new BigNumber(estimateResult.amount0 || '0').abs();
          }
          
          // Price = GALA received / tokens sold = GALA per token
          const pricePerToken = galaReceived.div(smallAmount);
          // Estimate GALA needed to buy 'amount' tokens
          estimatedGalaNeeded = pricePerToken.multipliedBy(amount);
          // Add 10% buffer for price impact
          estimatedGalaNeeded = estimatedGalaNeeded.multipliedBy(1.1);
          
          logger.debug(`📊 Reverse quote estimation: ${pricePerToken.toString()} GALA per ${tokenSymbol} → ${estimatedGalaNeeded.toString()} GALA needed for ${amount.toString()} ${tokenSymbol}`);
        } catch (estError) {
          // Fallback: assume 1:1 ratio (conservative)
          estimatedGalaNeeded = amount.multipliedBy(1.1);
          logger.debug(`⚠️ Failed to estimate GALA needed, using fallback: ${estimatedGalaNeeded.toString()}`);
        }
        
        // Now quote selling GALA to get tokens
        let reverseZeroForOne: boolean;
        if (isToken0Quote) {
          // Pool is GALA/TOKEN, reverse: selling token0 (GALA) for token1 (token)
          reverseZeroForOne = true;
        } else {
          // Pool is TOKEN/GALA, reverse: selling token1 (GALA) for token0 (token)
          reverseZeroForOne = false;
        }
        
          logger.debug('🔍 Reverse Quote Parameters (GALA → Token):', {
          tokenSymbol,
          quoteVia,
          token0: token0Str,
          token1: token1Str,
          desiredTokens: amount.toString(),
          estimatedGalaInput: estimatedGalaNeeded.toString(),
          reverseZeroForOne,
          sellingToken: reverseZeroForOne ? 'token0 (GALA)' : 'token1 (GALA)',
          receivingToken: reverseZeroForOne ? 'token1 (token)' : 'token0 (token)'
        });
        
        const reverseQuoteDto = new QuoteExactAmountDto(
          token0Key,
          token1Key,
          fee,
          estimatedGalaNeeded, // GALA input
          reverseZeroForOne,
          compositePoolData
        );
        
        const reverseQuoteResult: any = await quoteExactAmount(null as any, reverseQuoteDto);
        
        // Extract tokens received
        let tokensReceived: BigNumber;
        if (reverseZeroForOne) {
          tokensReceived = new BigNumber(reverseQuoteResult.amount1 || '0').abs();
        } else {
          tokensReceived = new BigNumber(reverseQuoteResult.amount0 || '0').abs();
        }
        
        // Calculate actual price: GALA spent / tokens received
        const actualPrice = estimatedGalaNeeded.div(tokensReceived);
        // For 'amount' tokens, the total cost is: actualPrice * amount
        // But we need to scale this based on how many tokens we actually received vs desired
        const scaleFactor = amount.div(tokensReceived); // Scale factor to get to desired amount
        const costForAmount = estimatedGalaNeeded.multipliedBy(scaleFactor);
        
        // Return the GALA cost for 'amount' tokens
        outputAmount = costForAmount;
        
        logger.debug(`📊 Reverse quote result: ${estimatedGalaNeeded.toString()} GALA → ${tokensReceived.toString()} ${tokenSymbol}, price: ${actualPrice.toString()} GALA per ${tokenSymbol}, scaled cost for ${amount.toString()}: ${costForAmount.toString()} GALA`);
      } else {
        // Forward quote: selling token to get GALA
        let zeroForOne: boolean;
        if (isToken0Quote) {
          // Pool is GALA/TOKEN, forward: selling token1 (SOL) for token0 (GALA)
          zeroForOne = false;
        } else {
          // Pool is TOKEN/GALA, forward: selling token0 (TOKEN) for token1 (GALA)
          zeroForOne = true;
        }
        
          logger.debug('🔍 Forward Quote Parameters (Token → GALA):', {
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
        
        // Extract output based on direction
        if (zeroForOne) {
          // Selling token0, receiving token1
          outputAmount = new BigNumber(quoteResult.amount1 || '0');
        } else {
          // Selling token1, receiving token0
          outputAmount = new BigNumber(quoteResult.amount0 || '0');
        }
        
        // Take absolute value to handle negative values
        outputAmount = outputAmount.abs();
      }
      
      // Extract liquidity information from pool data
      const poolLiquidity = compositePoolData?.pool ? {
        liquidity: compositePoolData.pool.liquidity,
        grossPoolLiquidity: compositePoolData.pool.grossPoolLiquidity
      } : undefined;

      return {
        outputAmount: outputAmount.toString(),
        poolAddress: 'unknown',
        route: [tokenSymbol, quoteVia],
        poolLiquidity
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
          const solReceived = new BigNumber(reverseQuoteResult.amount1 || '0').abs();
          
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
            
            // Extract liquidity information from pool data if available
            const poolLiquidity = compositePoolData?.pool ? {
              liquidity: compositePoolData.pool.liquidity,
              grossPoolLiquidity: compositePoolData.pool.grossPoolLiquidity
            } : undefined;

            return {
              outputAmount: expectedOutput.toString(),
              poolAddress: 'unknown',
              route: [tokenSymbol, quoteVia],
              poolLiquidity
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
   * Get SOL to GALA conversion rate directly from GALA/GSOL pool
   * This is more accurate than using USD prices as it uses actual market rates
   */
  async getSOLToGALARate(solAmount: BigNumber): Promise<BigNumber | null> {
    try {
      // Get quote for converting SOL to GALA using the GALA/GSOL pool
      const quote = await this.getLocalQuote('SOL', 'GALA', solAmount, DexFeePercentageTypes.FEE_1_PERCENT, false);
      if (!quote || !quote.outputAmount) {
        return null;
      }
      
      const outputGala = new BigNumber(quote.outputAmount);
      if (outputGala.isZero() || outputGala.isNaN()) {
        return null;
      }
      
      // Rate = GALA received / SOL amount
      const rate = outputGala.div(solAmount);
      logger.debug(`💱 SOL→GALA rate from pool: ${rate.toFixed(4)} GALA per SOL (for ${solAmount.toFixed(9)} SOL)`);
      return rate;
    } catch (error) {
      logger.warn('Failed to get SOL→GALA rate from pool, falling back to USD conversion', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get current GALA/USD price
   */
  getGALAUSDPrice(): number {
    return this.galaUsdPrice;
  }
}
