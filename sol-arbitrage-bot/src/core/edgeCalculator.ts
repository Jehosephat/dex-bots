/**
 * Edge Calculator for SOL Arbitrage Bot
 * 
 * Calculates net edge for arbitrage opportunities by comparing
 * GalaChain sell prices with Solana buy prices.
 */

import BigNumber from 'bignumber.js';
import { 
  ArbitrageOpportunity, 
  PriceQuote, 
  GalaChainQuote, 
  SolanaQuote
} from '../types/core';
import { TokenConfig } from '../types/config';
import { getTradingConfig, getBridgingConfig } from '../config';
import logger from '../utils/logger';
import { 
  calculateNetEdge, 
  calculateNetEdgeBps,
  isNetEdgeSufficient,
  calculatePriceImpactBps,
  isValidPrice 
} from '../utils/calculations';

export interface EdgeCalculationResult {
  /** Whether the opportunity is profitable */
  isProfitable: boolean;
  
  /** Net edge in GALA */
  netEdge: BigNumber;
  
  /** Net edge in basis points */
  netEdgeBps: number;
  
  /** Whether edge meets minimum threshold */
  meetsThreshold: boolean;
  
  /** Price impact on GalaChain */
  galaChainPriceImpactBps: number;
  
  /** Price impact on Solana */
  solanaPriceImpactBps: number;
  
  /** Bridge cost in GALA */
  bridgeCost: BigNumber;
  
  /** Risk buffer in GALA */
  riskBuffer: BigNumber;
  
  /** Total cost in GALA */
  totalCost: BigNumber;
  
  /** GALA proceeds from GalaChain sell */
  galaChainProceeds: BigNumber;
  
  /** SOL cost converted to GALA */
  solanaCostGala: BigNumber;
  
  /** SOL to GALA conversion rate */
  solToGalaRate: BigNumber;
  
  /** Whether price impact is acceptable */
  priceImpactAcceptable: boolean;
  
  /** Reasons why opportunity is invalid (if any) */
  invalidationReasons: string[];
}

export class EdgeCalculator {
  private tradingConfig = getTradingConfig();
  private bridgingConfig = getBridgingConfig();

  /**
   * Calculate edge for an arbitrage opportunity
   */
  calculateEdge(
    tokenConfig: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    solToGalaRate: BigNumber
  ): EdgeCalculationResult {
    const invalidationReasons: string[] = [];
    
    try {
      // Validate inputs
      if (!isValidPrice(galaChainQuote.price)) {
        invalidationReasons.push('Invalid GalaChain price');
      }
      
      if (!isValidPrice(solanaQuote.price)) {
        invalidationReasons.push('Invalid Solana price');
      }
      
      if (!isValidPrice(solToGalaRate)) {
        invalidationReasons.push('Invalid SOL to GALA rate');
      }

      if (invalidationReasons.length > 0) {
        return this.createInvalidResult(invalidationReasons);
      }

      // Calculate GALA proceeds from GalaChain sell
      const galaChainProceeds = galaChainQuote.price.multipliedBy(tokenConfig.tradeSize);
      
      // Calculate SOL cost for Solana buy
      const solanaCostSol = solanaQuote.price.multipliedBy(tokenConfig.tradeSize);
      
      // Convert SOL cost to GALA
      const solanaCostGala = solanaCostSol.multipliedBy(solToGalaRate);
      
      // Calculate bridge cost in GALA
      const bridgeCost = this.calculateBridgeCost();
      
      // Calculate risk buffer
      const riskBuffer = this.calculateRiskBuffer(galaChainProceeds);
      
      // Calculate net edge
      const netEdge = calculateNetEdge(
        galaChainProceeds,
        solanaCostGala,
        bridgeCost,
        riskBuffer
      );
      
      // Calculate net edge in basis points
      const totalCost = solanaCostGala.plus(bridgeCost).plus(riskBuffer);
      const netEdgeBps = calculateNetEdgeBps(netEdge, totalCost);
      
      // Check if edge meets minimum threshold
      const meetsThreshold = isNetEdgeSufficient(netEdgeBps, this.tradingConfig.minEdgeBps);
      
      // Calculate price impacts
      const galaChainPriceImpactBps = galaChainQuote.priceImpactBps;
      const solanaPriceImpactBps = solanaQuote.priceImpactBps;
      
      // Check if price impacts are acceptable
      const priceImpactAcceptable = this.isPriceImpactAcceptable(
        galaChainPriceImpactBps,
        solanaPriceImpactBps
      );
      
      // Check if opportunity is profitable
      const isProfitable = netEdge.isPositive() && meetsThreshold && priceImpactAcceptable;
      
      // Add invalidation reasons if not profitable
      if (!isProfitable) {
        if (!netEdge.isPositive()) {
          invalidationReasons.push('Negative net edge');
        }
        if (!meetsThreshold) {
          invalidationReasons.push(`Edge ${netEdgeBps}bps below threshold ${this.tradingConfig.minEdgeBps}bps`);
        }
        if (!priceImpactAcceptable) {
          invalidationReasons.push(`Price impact too high: GC ${galaChainPriceImpactBps}bps, SOL ${solanaPriceImpactBps}bps`);
        }
      }

      const result: EdgeCalculationResult = {
        isProfitable,
        netEdge,
        netEdgeBps,
        meetsThreshold,
        galaChainPriceImpactBps,
        solanaPriceImpactBps,
        bridgeCost,
        riskBuffer,
        totalCost,
        galaChainProceeds,
        solanaCostGala,
        solToGalaRate,
        priceImpactAcceptable,
        invalidationReasons
      };

      logger.debug(`🧮 Edge calculation for ${tokenConfig.symbol}`, {
        netEdge: netEdge.toString(),
        netEdgeBps,
        isProfitable,
        galaChainProceeds: galaChainProceeds.toString(),
        solanaCostGala: solanaCostGala.toString(),
        bridgeCost: bridgeCost.toString(),
        riskBuffer: riskBuffer.toString()
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Edge calculation failed', { 
        tokenSymbol: tokenConfig.symbol,
        error: errorMessage 
      });
      return this.createInvalidResult([`Calculation error: ${errorMessage}`]);
    }
  }

  /**
   * Calculate SOL to GALA conversion rate
   */
  async calculateSolToGalaRate(
    galaUsdPrice: number,
    solUsdPrice: number
  ): Promise<BigNumber> {
    if (galaUsdPrice <= 0 || solUsdPrice <= 0) {
      throw new Error('Invalid USD prices for rate calculation');
    }

    // SOL to GALA rate = SOL_USD / GALA_USD
    const rate = new BigNumber(solUsdPrice).div(galaUsdPrice);
    
    logger.debug(`💱 SOL to GALA rate: 1 SOL = ${rate.toString()} GALA`, {
      solUsdPrice,
      galaUsdPrice
    });

    return rate;
  }

  /**
   * Calculate bridge cost in GALA
   */
  private calculateBridgeCost(): BigNumber {
    // Bridge cost is fixed at $1.25 USD, convert to GALA
    const bridgeCostUsd = 1.25;
    const galaUsdPrice = 0.04; // This should be fetched from price provider
    return new BigNumber(bridgeCostUsd).div(galaUsdPrice);
  }

  /**
   * Calculate risk buffer in GALA
   */
  private calculateRiskBuffer(galaChainProceeds: BigNumber): BigNumber {
    const riskBufferBps = this.tradingConfig.riskBufferBps;
    return galaChainProceeds.multipliedBy(riskBufferBps).div(10000);
  }

  /**
   * Check if price impacts are acceptable
   */
  private isPriceImpactAcceptable(
    galaChainImpactBps: number,
    solanaImpactBps: number
  ): boolean {
    const maxImpactBps = this.tradingConfig.maxPriceImpactBps;
    
    return Math.abs(galaChainImpactBps) <= maxImpactBps && 
           Math.abs(solanaImpactBps) <= maxImpactBps;
  }

  /**
   * Create invalid result with reasons
   */
  private createInvalidResult(reasons: string[]): EdgeCalculationResult {
    return {
      isProfitable: false,
      netEdge: new BigNumber(0),
      netEdgeBps: 0,
      meetsThreshold: false,
      galaChainPriceImpactBps: 0,
      solanaPriceImpactBps: 0,
      bridgeCost: new BigNumber(0),
      riskBuffer: new BigNumber(0),
      totalCost: new BigNumber(0),
      galaChainProceeds: new BigNumber(0),
      solanaCostGala: new BigNumber(0),
      solToGalaRate: new BigNumber(0),
      priceImpactAcceptable: false,
      invalidationReasons: reasons
    };
  }

  /**
   * Create arbitrage opportunity from edge calculation
   */
  createArbitrageOpportunity(
    tokenConfig: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    edgeResult: EdgeCalculationResult
  ): ArbitrageOpportunity | null {
    if (!edgeResult.isProfitable) {
      return null;
    }

    return {
      id: this.generateOpportunityId(tokenConfig.symbol),
      tokenSymbol: tokenConfig.symbol,
      tradeSize: tokenConfig.tradeSize,
      galaChainPrice: galaChainQuote.price,
      solanaPrice: solanaQuote.price,
      solToGalaRate: edgeResult.solToGalaRate,
      netEdge: edgeResult.netEdge,
      netEdgeBps: edgeResult.netEdgeBps,
      galaChainPriceImpactBps: edgeResult.galaChainPriceImpactBps,
      solanaPriceImpactBps: edgeResult.solanaPriceImpactBps,
      bridgeCost: edgeResult.bridgeCost,
      riskBuffer: edgeResult.riskBuffer,
      timestamp: Date.now(),
      isValid: true,
      invalidationReasons: [],
      quoteAgeSeconds: Math.floor((Date.now() - galaChainQuote.timestamp) / 1000)
    };
  }

  /**
   * Generate unique opportunity ID
   */
  private generateOpportunityId(tokenSymbol: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${tokenSymbol}-${timestamp}-${random}`;
  }
}
