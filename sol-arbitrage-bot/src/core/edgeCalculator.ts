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
import { IConfigService } from '../config';
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

  // ============================================================================
  // UNIVERSAL FIELDS (Clear semantics for all trade directions)
  // ============================================================================

  /** GALA received from sell side (income) - universal meaning across all directions */
  income: BigNumber;

  /** GALA spent on buy side (expense) - universal meaning across all directions */
  expense: BigNumber;

  /** Which chain we're selling on (income side) */
  sellSide: 'galachain' | 'solana';

  /** Which chain we're buying on (expense side) */
  buySide: 'galachain' | 'solana';

  // ============================================================================
  // DEPRECATED FIELDS (Kept for backward compatibility)
  // ============================================================================

  /**
   * @deprecated Use 'income' instead - this field has confusing semantics
   * In forward mode: GalaChain proceeds (correct naming)
   * In reverse mode: Solana proceeds (confusing naming!)
   */
  galaChainProceeds: BigNumber;

  /**
   * @deprecated Use 'expense' instead - this field has confusing semantics
   * In forward mode: Solana cost (correct naming)
   * In reverse mode: GalaChain cost (confusing naming!)
   */
  solanaCostGala: BigNumber;

  /** Quote currency to GALA conversion rate */
  solToGalaRate: BigNumber;

  /** Whether price impact is acceptable */
  priceImpactAcceptable: boolean;

  /** Reasons why opportunity is invalid (if any) */
  invalidationReasons: string[];
}

export class EdgeCalculator {
  private tradingConfig: any;
  private bridgingConfig: any;
  
  constructor(private configService: IConfigService) {
    try {
      logger.debug(`🔍 DEBUG: EdgeCalculator constructor - getting trading config...`);
      this.tradingConfig = configService.getTradingConfig();
      logger.debug(`🔍 DEBUG: EdgeCalculator constructor - trading config obtained`);
      logger.debug(`🔍 DEBUG: EdgeCalculator constructor - getting bridging config...`);
      this.bridgingConfig = configService.getBridgingConfig();
      logger.debug(`🔍 DEBUG: EdgeCalculator constructor - bridging config obtained`);
    } catch (configError) {
      logger.error(`❌ ERROR getting config in EdgeCalculator constructor`, {
        error: configError instanceof Error ? configError.message : String(configError),
        stack: configError instanceof Error ? configError.stack : undefined
      });
      throw configError;
    }
  }

  /**
   * Calculate edge for an arbitrage opportunity
   */
  calculateEdge(
    tokenConfig: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    solToGalaRate: BigNumber,
    galaUsdPrice?: number
  ): EdgeCalculationResult {
    const invalidationReasons: string[] = [];
    
    try {
      logger.debug(`🔍 DEBUG: EdgeCalculator.calculateEdge() started`, {
        token: tokenConfig.symbol,
        solQuoteVia: tokenConfig.solQuoteVia,
        solQuoteCurrency: solanaQuote.currency,
        solToGalaRate: solToGalaRate.toString()
      });

      // Validate inputs
      logger.debug(`🔍 DEBUG: Validating prices...`);
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
        logger.debug(`🔍 DEBUG: Validation failed, returning invalid result`);
        return this.createInvalidResult(invalidationReasons);
      }

      logger.debug(`🔍 DEBUG: Calculating proceeds and costs...`);
      // Calculate GALA proceeds from GalaChain sell
      const galaChainProceeds = galaChainQuote.price.multipliedBy(tokenConfig.tradeSize);
      logger.debug(`🔍 DEBUG: GalaChain proceeds calculated: ${galaChainProceeds.toString()}`);
      
      // Calculate quote currency cost for Solana buy
      // Note: solanaQuote.price is in quote currency (SOL or USDC) per token
      const solanaCostInQuoteCurrency = solanaQuote.price.multipliedBy(tokenConfig.tradeSize);
      logger.debug(`🔍 DEBUG: Solana cost in quote currency (${solanaQuote.currency}): ${solanaCostInQuoteCurrency.toString()}`);
      
      // Convert quote currency cost to GALA
      // Note: solToGalaRate is actually quoteToGalaRate (handles both SOL and USDC)
      const solanaCostGala = solanaCostInQuoteCurrency.multipliedBy(solToGalaRate);
      logger.debug(`🔍 DEBUG: Solana cost converted to GALA: ${solanaCostGala.toString()}`);
      
      // Calculate bridge cost in GALA (amortized per trade)
      const bridgeCost = this.calculateBridgeCost(galaUsdPrice);
      
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

        // Universal fields (FORWARD direction: SELL on GalaChain, BUY on Solana)
        income: galaChainProceeds,        // GALA received from selling on GalaChain
        expense: solanaCostGala,          // GALA spent buying on Solana
        sellSide: 'galachain',            // We're selling on GalaChain
        buySide: 'solana',                // We're buying on Solana

        // Deprecated fields (kept for backward compatibility)
        galaChainProceeds,
        solanaCostGala,
        solToGalaRate,
        priceImpactAcceptable,
        invalidationReasons
      };

      // Detailed logging moved to mainLoop.ts for better visibility
      // This debug log kept for backwards compatibility
      logger.debug(`🧮 Edge calculation completed for ${tokenConfig.symbol}`, {
        netEdge: netEdge.toString(),
        netEdgeBps,
        isProfitable,
        meetsThreshold
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
   * Calculate bridge cost in GALA (amortized per trade)
   * The bridge cost is amortized across many trades since we don't bridge with every trade
   */
  private calculateBridgeCost(galaUsdPrice?: number): BigNumber {
    // Get bridge cost from config (default $1.25 USD)
    const bridgeCostUsd = this.bridgingConfig.bridgeCostUsd || 1.25;
    
    // Get GALA USD price (use provided value or fallback)
    const galaPrice = galaUsdPrice || 0.01;
    
    // Calculate full bridge cost in GALA
    const fullBridgeCostGala = new BigNumber(bridgeCostUsd).div(galaPrice);
    
    // Amortize across trades (default: 100 trades per bridge)
    const tradesPerBridge = this.bridgingConfig.tradesPerBridge || 100;
    const amortizedBridgeCost = fullBridgeCostGala.div(tradesPerBridge);
    
    logger.debug(`🔍 Bridge cost calculation:`, {
      bridgeCostUsd,
      galaUsdPrice: galaPrice,
      fullBridgeCostGala: fullBridgeCostGala.toString(),
      tradesPerBridge,
      amortizedBridgeCost: amortizedBridgeCost.toString()
    });
    
    return amortizedBridgeCost;
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

      // Universal fields
      income: new BigNumber(0),
      expense: new BigNumber(0),
      sellSide: 'galachain',  // Default to forward direction
      buySide: 'solana',

      // Deprecated fields
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
