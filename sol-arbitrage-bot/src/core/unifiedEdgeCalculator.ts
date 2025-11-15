/**
 * Unified Edge Calculator for SOL Arbitrage Bot
 *
 * Calculates net edge for arbitrage opportunities in BOTH directions:
 * - Forward: SELL on GalaChain → BUY on Solana
 * - Reverse: BUY on GalaChain → SELL on Solana
 *
 * This replaces EdgeCalculator + ReverseEdgeCalculator, eliminating 50% code duplication.
 */

import BigNumber from 'bignumber.js';
import {
  ArbitrageOpportunity,
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
  isValidPrice
} from '../utils/calculations';

/**
 * Trade direction for edge calculation
 */
export type TradeDirection = 'forward' | 'reverse';

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

export class UnifiedEdgeCalculator {
  private tradingConfig: any;
  private bridgingConfig: any;

  constructor(private configService: IConfigService) {
    try {
      logger.debug(`🔍 DEBUG: UnifiedEdgeCalculator constructor - getting configs...`);
      this.tradingConfig = configService.getTradingConfig();
      this.bridgingConfig = configService.getBridgingConfig();
      logger.debug(`🔍 DEBUG: UnifiedEdgeCalculator constructor - configs obtained`);
    } catch (configError) {
      logger.error(`❌ ERROR getting config in UnifiedEdgeCalculator constructor`, {
        error: configError instanceof Error ? configError.message : String(configError),
        stack: configError instanceof Error ? configError.stack : undefined
      });
      throw configError;
    }
  }

  /**
   * Calculate edge for an arbitrage opportunity (works for BOTH directions)
   *
   * @param direction - 'forward' (SELL GC → BUY SOL) or 'reverse' (BUY GC → SELL SOL)
   */
  calculateEdge(
    direction: TradeDirection,
    tokenConfig: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    quoteToGalaRate: BigNumber,
    galaUsdPrice?: number
  ): EdgeCalculationResult {
    const invalidationReasons: string[] = [];

    try {
      logger.debug(`🔍 DEBUG: UnifiedEdgeCalculator.calculateEdge() started`, {
        direction,
        token: tokenConfig.symbol,
        solQuoteVia: tokenConfig.solQuoteVia,
        solQuoteCurrency: solanaQuote.currency,
        quoteToGalaRate: quoteToGalaRate.toString()
      });

      // Validate inputs
      logger.debug(`🔍 DEBUG: Validating prices...`);
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
        logger.debug(`🔍 DEBUG: Validation failed, returning invalid result`);
        return this.createInvalidResult(direction, invalidationReasons);
      }

      // Calculate income and expense based on direction
      let income: BigNumber;
      let expense: BigNumber;
      let sellSide: 'galachain' | 'solana';
      let buySide: 'galachain' | 'solana';

      if (direction === 'forward') {
        // FORWARD: SELL token on GalaChain for GALA → BUY token on Solana with quote currency
        logger.debug(`🔍 DEBUG: Calculating FORWARD edge...`);

        // Income: GALA proceeds from selling on GalaChain
        income = galaChainQuote.price.multipliedBy(tokenConfig.tradeSize);
        logger.debug(`🔍 DEBUG: Income (GalaChain proceeds): ${income.toString()}`);

        // Expense: Quote currency cost converted to GALA for buying on Solana
        const solanaCostInQuoteCurrency = solanaQuote.price.multipliedBy(tokenConfig.tradeSize);
        expense = solanaCostInQuoteCurrency.multipliedBy(quoteToGalaRate);
        logger.debug(`🔍 DEBUG: Expense (Solana cost in GALA): ${expense.toString()}`);

        sellSide = 'galachain';
        buySide = 'solana';

      } else {
        // REVERSE: BUY token on GalaChain with GALA → SELL token on Solana for quote currency
        logger.debug(`🔍 DEBUG: Calculating REVERSE edge...`);

        // Expense: GALA cost for buying on GalaChain
        expense = galaChainQuote.price.multipliedBy(tokenConfig.tradeSize);
        logger.debug(`🔍 DEBUG: Expense (GalaChain cost): ${expense.toString()}`);

        // Income: Quote currency proceeds converted to GALA from selling on Solana
        const solanaProceedsInQuoteCurrency = solanaQuote.price.multipliedBy(tokenConfig.tradeSize);
        income = solanaProceedsInQuoteCurrency.multipliedBy(quoteToGalaRate);
        logger.debug(`🔍 DEBUG: Income (Solana proceeds in GALA): ${income.toString()}`);

        sellSide = 'solana';
        buySide = 'galachain';
      }

      // Calculate bridge cost in GALA (amortized)
      const bridgeCost = this.calculateBridgeCost(galaUsdPrice);

      // Calculate risk buffer (based on income)
      const riskBuffer = this.calculateRiskBuffer(income);

      // Calculate net edge using universal formula: income - expense - costs
      const netEdge = calculateNetEdge(income, expense, bridgeCost, riskBuffer);

      // Calculate total cost and net edge in basis points
      const totalCost = expense.plus(bridgeCost).plus(riskBuffer);
      const netEdgeBps = calculateNetEdgeBps(netEdge, totalCost);

      // Get minimum edge threshold (reverse may have different threshold)
      const minEdgeBps = direction === 'reverse'
        ? (this.tradingConfig.reverseArbitrageMinEdgeBps || this.tradingConfig.minEdgeBps)
        : this.tradingConfig.minEdgeBps;

      // Check if edge meets minimum threshold
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

      // Build result with universal fields
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

        // Universal fields (semantically correct for ALL directions)
        income,
        expense,
        sellSide,
        buySide,

        // Deprecated fields (kept for backward compatibility - confusing in reverse!)
        galaChainProceeds: income,  // Misleading name but maintains compatibility
        solanaCostGala: expense,     // Misleading name but maintains compatibility
        solToGalaRate: quoteToGalaRate,
        priceImpactAcceptable,
        invalidationReasons
      };

      logger.debug(`🧮 Edge calculation completed for ${tokenConfig.symbol} (${direction})`, {
        income: income.toString(),
        expense: expense.toString(),
        netEdge: netEdge.toString(),
        netEdgeBps,
        isProfitable,
        meetsThreshold,
        sellSide,
        buySide
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Edge calculation failed', {
        direction,
        tokenSymbol: tokenConfig.symbol,
        error: errorMessage
      });
      return this.createInvalidResult(direction, [`Calculation error: ${errorMessage}`]);
    }
  }

  /**
   * Calculate SOL to GALA conversion rate
   */
  async calculateQuoteToGalaRate(
    galaUsdPrice: number,
    quoteUsdPrice: number
  ): Promise<BigNumber> {
    if (galaUsdPrice <= 0 || quoteUsdPrice <= 0) {
      throw new Error('Invalid USD prices for rate calculation');
    }

    // Quote to GALA rate = QUOTE_USD / GALA_USD
    const rate = new BigNumber(quoteUsdPrice).div(galaUsdPrice);

    logger.debug(`💱 Quote to GALA rate: 1 QUOTE = ${rate.toString()} GALA`, {
      quoteUsdPrice,
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
   * Calculate risk buffer in GALA (based on income)
   */
  private calculateRiskBuffer(income: BigNumber): BigNumber {
    const riskBufferBps = this.tradingConfig.riskBufferBps;
    return income.multipliedBy(riskBufferBps).div(10000);
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
  private createInvalidResult(
    direction: TradeDirection,
    reasons: string[]
  ): EdgeCalculationResult {
    // Set default sell/buy sides based on direction
    const sellSide = direction === 'forward' ? 'galachain' : 'solana';
    const buySide = direction === 'forward' ? 'solana' : 'galachain';

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
      sellSide,
      buySide,

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
