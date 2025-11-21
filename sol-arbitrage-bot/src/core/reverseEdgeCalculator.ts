/**
 * Reverse Edge Calculator
 * 
 * Calculates net edge for REVERSE arbitrage opportunities (BUY GalaChain → SELL Solana)
 * This is the opposite direction from the normal arbitrage flow.
 */

import BigNumber from 'bignumber.js';
import { 
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
import { EdgeCalculationResult } from './edgeCalculator';

export class ReverseEdgeCalculator {
  private tradingConfig: any;
  private bridgingConfig: any;
  
  constructor(private configService: IConfigService) {
    try {
      this.tradingConfig = configService.getTradingConfig();
      this.bridgingConfig = configService.getBridgingConfig();
    } catch (configError) {
      logger.error(`❌ ERROR getting config in ReverseEdgeCalculator constructor`, {
        error: configError instanceof Error ? configError.message : String(configError)
      });
      throw configError;
    }
  }

  /**
   * Calculate edge for REVERSE arbitrage opportunity
   * REVERSE: Buy token on GalaChain (spend GALA) → Sell token on Solana (get USDC/SOL)
   */
  calculateReverseEdge(
    tokenConfig: TokenConfig,
    galaChainQuote: GalaChainQuote, // Quote for BUYING token on GalaChain (cost in GALA)
    solanaQuote: SolanaQuote, // Quote for SELLING token on Solana (proceeds in USDC/SOL)
    quoteToGalaRate: BigNumber, // Rate to convert quote currency to GALA
    galaUsdPrice?: number
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
      
      if (!isValidPrice(quoteToGalaRate)) {
        invalidationReasons.push('Invalid quote to GALA rate');
      }

      if (invalidationReasons.length > 0) {
        return this.createInvalidResult(invalidationReasons);
      }

      // Calculate costs and proceeds (REVERSED from normal flow)
      // REVERSE: Spend GALA on GalaChain to BUY token, then SELL token on Solana for USDC/SOL
      const galaChainCost = galaChainQuote.price.multipliedBy(tokenConfig.tradeSize); // Cost in GALA
      const solanaProceedsInQuoteCurrency = solanaQuote.price.multipliedBy(tokenConfig.tradeSize); // Proceeds in quote currency
      
      // Convert Solana proceeds to GALA
      const solanaProceedsGala = solanaProceedsInQuoteCurrency.multipliedBy(quoteToGalaRate);
      
      // Calculate bridge cost in GALA (amortized)
      const bridgeCost = this.calculateBridgeCost(galaUsdPrice);
      
      // Calculate risk buffer (on proceeds, not cost)
      const riskBuffer = this.calculateRiskBuffer(solanaProceedsGala);
      
      // Calculate net edge (REVERSED: proceeds - costs)
      const netEdge = solanaProceedsGala
        .minus(galaChainCost)
        .minus(bridgeCost)
        .minus(riskBuffer);
      
      // Calculate net edge in basis points
      const totalCost = galaChainCost.plus(bridgeCost).plus(riskBuffer);
      const netEdgeBps = calculateNetEdgeBps(netEdge, totalCost);
      
      // Check if edge meets minimum threshold (use reverse threshold if configured)
      const minEdgeBps = this.tradingConfig.reverseArbitrageMinEdgeBps || this.tradingConfig.minEdgeBps;
      const meetsThreshold = isNetEdgeSufficient(netEdgeBps, minEdgeBps);
      
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
          invalidationReasons.push(`Edge ${netEdgeBps}bps below threshold ${minEdgeBps}bps`);
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

        // Universal fields (REVERSE direction: BUY on GalaChain, SELL on Solana)
        income: solanaProceedsGala,       // GALA received from selling on Solana
        expense: galaChainCost,           // GALA spent buying on GalaChain
        sellSide: 'solana',               // We're selling on Solana
        buySide: 'galachain',             // We're buying on GalaChain

        // Deprecated fields (kept for backward compatibility - confusing names!)
        galaChainProceeds: solanaProceedsGala, // ⚠️ Actually Solana proceeds, not GalaChain!
        solanaCostGala: galaChainCost,         // ⚠️ Actually GalaChain cost, not Solana!
        solToGalaRate: quoteToGalaRate,
        priceImpactAcceptable,
        invalidationReasons
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error calculating reverse edge for ${tokenConfig.symbol}`, { error: errorMessage });
      return this.createInvalidResult([`Calculation error: ${errorMessage}`]);
    }
  }

  /**
   * Calculate bridge cost in GALA (amortized per trade)
   */
  private calculateBridgeCost(galaUsdPrice?: number): BigNumber {
    const bridgeCostUsd = this.bridgingConfig.bridgeCostUsd || 1.25;
    const galaPrice = galaUsdPrice || 0.01;
    const fullBridgeCostGala = new BigNumber(bridgeCostUsd).div(galaPrice);
    const tradesPerBridge = this.bridgingConfig.tradesPerBridge || 100;
    return fullBridgeCostGala.div(tradesPerBridge);
  }

  /**
   * Calculate risk buffer in GALA
   */
  private calculateRiskBuffer(proceeds: BigNumber): BigNumber {
    const riskBufferBps = this.tradingConfig.riskBufferBps;
    return proceeds.multipliedBy(riskBufferBps).div(10000);
  }

  /**
   * Check if price impact is acceptable
   */
  private isPriceImpactAcceptable(
    gcImpactBps: number,
    solImpactBps: number
  ): boolean {
    const maxImpact = this.tradingConfig.maxPriceImpactBps;
    return Math.abs(gcImpactBps) <= maxImpact && Math.abs(solImpactBps) <= maxImpact;
  }

  /**
   * Create invalid result
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

      // Universal fields (reverse direction by default for this calculator)
      income: new BigNumber(0),
      expense: new BigNumber(0),
      sellSide: 'solana',      // Reverse direction: sell on Solana
      buySide: 'galachain',    // Reverse direction: buy on GalaChain

      // Deprecated fields
      galaChainProceeds: new BigNumber(0),
      solanaCostGala: new BigNumber(0),
      solToGalaRate: new BigNumber(0),
      priceImpactAcceptable: false,
      invalidationReasons: reasons
    };
  }
}

