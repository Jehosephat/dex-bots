/**
 * Rate Converter Service
 * 
 * Handles conversion rates between different currencies (SOL→GALA, USDC→GALA, etc.)
 * Centralizes rate conversion logic that was scattered across the codebase.
 */

import BigNumber from 'bignumber.js';
import logger from '../utils/logger';
import { GalaChainPriceProvider } from './priceProviders/galachain';
import { SolanaPriceProvider } from './priceProviders/solana';
import { SolanaQuote } from '../types/core';

/**
 * Result of rate conversion
 */
export interface RateConversionResult {
  /** Conversion rate (output currency per input currency) */
  rate: BigNumber;
  
  /** GALA/USD price used for conversion (if applicable) */
  galaUsdPrice: number;
  
  /** Source of the rate (pool, USD, etc.) */
  source: 'pool' | 'usd' | 'direct';
}

/**
 * Rate Converter Service
 * 
 * Converts between different quote currencies and GALA
 */
export class RateConverter {
  constructor(
    private gcProvider: GalaChainPriceProvider,
    private solProvider: SolanaPriceProvider
  ) {}

  /**
   * Convert quote currency to GALA rate
   * 
   * @param quoteCurrency - Currency of the quote (GALA, SOL, USDC)
   * @param solQuote - Solana quote for context
   * @param tradeSize - Trade size for pool-based rate calculation
   * @returns Rate conversion result
   */
  async convertQuoteCurrencyToGala(
    quoteCurrency: string,
    solQuote: SolanaQuote,
    tradeSize: number
  ): Promise<RateConversionResult | null> {
    try {
      if (quoteCurrency === 'GALA') {
        // Already in GALA, no conversion needed
        const galaUsdPrice = this.gcProvider.getGALAUSDPrice?.() || 0.01;
        return {
          rate: new BigNumber(1),
          galaUsdPrice,
          source: 'direct'
        };
      } else if (quoteCurrency === 'SOL') {
        return await this.convertSOLToGala(solQuote, tradeSize);
      } else if (quoteCurrency === 'USDC') {
        return await this.convertUSDCToGala();
      } else {
        logger.warn(`⚠️ Unknown quote currency: ${quoteCurrency}`);
        return null;
      }
    } catch (error) {
      logger.error('❌ Failed to convert quote currency to GALA', {
        error: error instanceof Error ? error.message : String(error),
        quoteCurrency
      });
      return null;
    }
  }

  /**
   * Convert SOL to GALA rate
   * 
   * Tries pool-based rate first (more accurate), falls back to USD conversion
   */
  private async convertSOLToGala(
    solQuote: SolanaQuote,
    tradeSize: number
  ): Promise<RateConversionResult | null> {
    // Calculate SOL cost
    const solCost = solQuote.price.multipliedBy(tradeSize);
    
    // Try to get rate directly from GALA/GSOL pool (more accurate)
    try {
      const poolRate = await this.gcProvider.getSOLToGALARate?.(solCost);
      
      if (poolRate && !poolRate.isZero() && !poolRate.isNaN()) {
        const galaUsdPrice = this.gcProvider.getGALAUSDPrice?.() || 0.01;
        logger.debug(`💱 Using SOL→GALA rate from pool: ${poolRate.toFixed(4)} GALA per SOL`);
        return {
          rate: poolRate,
          galaUsdPrice,
          source: 'pool'
        };
      }
    } catch (poolError) {
      logger.debug('⚠️ Pool quote failed, falling back to USD conversion for SOL→GALA rate', {
        error: poolError instanceof Error ? poolError.message : String(poolError)
      });
    }

    // Fallback to USD conversion if pool quote fails
    return await this.convertSOLToGalaViaUSD();
  }

  /**
   * Convert SOL to GALA via USD conversion
   */
  private async convertSOLToGalaViaUSD(): Promise<RateConversionResult | null> {
    try {
      const solUsd = this.solProvider.getSOLUSDPrice();
      const galaUsdPrice = this.gcProvider.getGALAUSDPrice?.() || 0.01;
      
      if (solUsd > 0 && galaUsdPrice > 0) {
        const rate = new BigNumber(solUsd).div(galaUsdPrice);
        logger.debug(`💱 Using USD-based SOL→GALA rate: ${rate.toFixed(4)} GALA per SOL (via $${solUsd}/$${galaUsdPrice.toFixed(6)})`);
        return {
          rate,
          galaUsdPrice,
          source: 'usd'
        };
      }
      
      logger.warn('⚠️ Invalid USD prices for SOL→GALA conversion', { solUsd, galaUsdPrice });
      return null;
    } catch (error) {
      logger.error('❌ Failed to convert SOL to GALA via USD', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Convert USDC to GALA via USD conversion
   * 
   * Note: USDC requires USD conversion since there's no direct pool on GalaChain
   */
  private async convertUSDCToGala(): Promise<RateConversionResult | null> {
    try {
      const galaUsdPrice = this.gcProvider.getGALAUSDPrice?.() || 0.01;
      
      if (galaUsdPrice > 0) {
        // USDC is 1:1 with USD, so USDC to GALA = 1 / GALA_USD
        const rate = new BigNumber(1).div(galaUsdPrice);
        logger.debug(`💱 USDC→GALA rate: ${rate.toFixed(4)} GALA per USDC (via GALA/USD: $${galaUsdPrice.toFixed(6)})`);
        return {
          rate,
          galaUsdPrice,
          source: 'usd'
        };
      }
      
      logger.warn('⚠️ Invalid GALA/USD price for USDC→GALA conversion', { galaUsdPrice });
      return null;
    } catch (error) {
      logger.error('❌ Failed to convert USDC to GALA', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

