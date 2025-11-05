/**
 * Token Evaluator
 * 
 * Evaluates a single token for arbitrage opportunities.
 * Handles quote fetching, rate conversion, and risk evaluation.
 */

import BigNumber from 'bignumber.js';
import logger from '../utils/logger';
import { IConfigService } from '../config';
import { TokenConfig } from '../types/config';
import { GalaChainPriceProvider } from './priceProviders/galachain';
import { SolanaPriceProvider } from './priceProviders/solana';
import { RiskManager } from '../execution/riskManager';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import { RateConverter, RateConversionResult } from './rateConverter';
import { getErrorHandler } from '../utils/errorHandler';
import { ArbitrageDirection, DirectionUtils } from '../types/direction';

/**
 * Result of token evaluation
 */
export interface TokenEvaluationResult {
  /** Token that was evaluated */
  token: TokenConfig;
  
  /** Arbitrage direction ('forward' or 'reverse') */
  direction?: 'forward' | 'reverse';
  
  /** Whether evaluation was successful */
  success: boolean;
  
  /** GalaChain quote (if available) */
  gcQuote: GalaChainQuote | null;
  
  /** Solana quote (if available) */
  solQuote: SolanaQuote | null;
  
  /** Rate conversion result (if available) */
  rateConversion: RateConversionResult | null;
  
  /** Risk evaluation result (if available) */
  riskResult: any | null;
  
  /** Error message if evaluation failed */
  error?: string;
}

/**
 * Token Evaluator
 * 
 * Evaluates a token for arbitrage opportunities by:
 * 1. Fetching quotes from both chains
 * 2. Converting quote currencies to GALA
 * 3. Evaluating risk and edge
 */
export class TokenEvaluator {
  private rateConverter: RateConverter;
  private riskManager: RiskManager;
  private errorHandler = getErrorHandler();

  constructor(
    private configService: IConfigService,
    private gcProvider: GalaChainPriceProvider,
    private solProvider: SolanaPriceProvider
  ) {
    this.rateConverter = new RateConverter(gcProvider, solProvider);
    this.riskManager = new RiskManager(undefined, configService);
  }

  /**
   * Evaluate a token for arbitrage opportunity (bidirectional)
   */
  async evaluateToken(token: TokenConfig): Promise<TokenEvaluationResult> {
    try {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 EVALUATING: ${token.symbol} | Trade Size: ${token.tradeSize}`);

      // Get direction configuration
      const directionConfig = this.configService.getDirectionConfig();

      // Evaluate forward direction (always)
      logger.debug(`   📈 Evaluating FORWARD direction...`);
      const forwardEvaluation = await this.evaluateDirection(token, 'forward');

      // Evaluate reverse direction (if enabled)
      let reverseEvaluation: TokenEvaluationResult | null = null;
      if (directionConfig.reverse.enabled) {
        logger.debug(`   📉 Evaluating REVERSE direction...`);
        reverseEvaluation = await this.evaluateDirection(token, 'reverse');
      } else {
        logger.debug(`   ⏭️  REVERSE direction disabled in config`);
      }

      // Log both evaluations before selecting
      if (reverseEvaluation) {
        logger.info(`\n   📊 Direction Comparison:`);
        logger.info(`      FORWARD: ${forwardEvaluation.riskResult?.shouldProceed ? '✅ PASS' : '❌ FAIL'} (Edge: ${forwardEvaluation.riskResult?.edge?.netEdgeBps?.toFixed(2) || 'N/A'} bps)`);
        logger.info(`      REVERSE: ${reverseEvaluation.riskResult?.shouldProceed ? '✅ PASS' : '❌ FAIL'} (Edge: ${reverseEvaluation.riskResult?.edge?.netEdgeBps?.toFixed(2) || 'N/A'} bps)`);
      }

      // Select best direction based on configuration
      const selectedEvaluation = this.selectBestDirection(
        forwardEvaluation,
        reverseEvaluation,
        directionConfig
      );

      if (reverseEvaluation && selectedEvaluation.direction !== forwardEvaluation.direction) {
        logger.debug(`   ✅ Selected REVERSE direction (better edge)`);
      } else if (reverseEvaluation) {
        logger.debug(`   ✅ Selected FORWARD direction`);
      }

      // Store both evaluations for logging purposes
      (selectedEvaluation as any).forwardEvaluation = forwardEvaluation;
      (selectedEvaluation as any).reverseEvaluation = reverseEvaluation;

      return selectedEvaluation;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'evaluateToken', token: token.symbol }
      );
      
      return {
        token,
        direction: 'forward',
        success: false,
        gcQuote: null,
        solQuote: null,
        rateConversion: null,
        riskResult: null,
        error: errorMessage
      };
    }
  }

  /**
   * Evaluate a token for a specific direction
   */
  private async evaluateDirection(
    token: TokenConfig,
    direction: ArbitrageDirection
  ): Promise<TokenEvaluationResult> {
    const reverse = direction === 'reverse';
    const directionLabel = DirectionUtils.getLabel(direction);

    try {
      logger.debug(`   🔍 Fetching quotes for ${directionLabel} direction...`);

      // Fetch quotes for the specified direction
      const [gcQuote, solQuote] = await Promise.all([
        this.gcProvider.getQuote(token.symbol, token.tradeSize, reverse),
        this.solProvider.getQuote(token.symbol, token.tradeSize, reverse)
      ]);

      // Check if we have both quotes
      if (!gcQuote || !solQuote) {
        const error = `Missing quote(s) for ${directionLabel} - hasGcQuote: ${!!gcQuote}, hasSolQuote: ${!!solQuote}`;
        logger.warn(`   ⚠️ ${error}`);
        return {
          token,
          direction,
          success: false,
          gcQuote: gcQuote as GalaChainQuote | null,
          solQuote: solQuote as SolanaQuote | null,
          rateConversion: null,
          riskResult: null,
          error
        };
      }
      
      logger.debug(`   ✅ Quotes received for ${directionLabel} direction`);

      const galaQuote = gcQuote as GalaChainQuote;
      const solQuoteResult = solQuote as SolanaQuote;

      // Convert quote currency to GALA
      const rateConversion = await this.rateConverter.convertQuoteCurrencyToGala(
        solQuoteResult.currency,
        solQuoteResult,
        token.tradeSize
      );

      if (!rateConversion || rateConversion.rate.isZero() || rateConversion.rate.isNaN()) {
        const error = `Invalid conversion rate for ${directionLabel}`;
        logger.warn(`   ⚠️ ${error}`);
        return {
          token,
          direction,
          success: false,
          gcQuote: galaQuote,
          solQuote: solQuoteResult,
          rateConversion: null,
          riskResult: null,
          error
        };
      }

      // Evaluate risk (direction-aware)
      logger.debug(`   🧮 Evaluating risk for ${directionLabel} direction...`);
      let riskResult;
      try {
        // Use direction-aware risk evaluation if available, otherwise fallback
        if (this.riskManager.evaluateDirection) {
          riskResult = this.riskManager.evaluateDirection(
            token,
            galaQuote,
            solQuoteResult,
            rateConversion.rate,
            direction,
            rateConversion.galaUsdPrice
          );
        } else {
          // Fallback to forward evaluation for now
          riskResult = this.riskManager.evaluate(
            token,
            galaQuote,
            solQuoteResult,
            rateConversion.rate,
            rateConversion.galaUsdPrice
          );
        }
        
        logger.debug(`   ${riskResult.shouldProceed ? '✅' : '❌'} Risk evaluation ${directionLabel}: ${riskResult.shouldProceed ? 'PASS' : 'FAIL'} (Edge: ${riskResult.edge?.netEdgeBps?.toFixed(2) || 'N/A'} bps)`);
      } catch (evalError) {
        logger.error(`❌ ERROR in risk.evaluate() for ${token.symbol} (${directionLabel})`, {
          error: evalError instanceof Error ? evalError.message : String(evalError)
        });
        riskResult = {
          shouldProceed: false,
          reasons: ['Evaluation error'],
          edge: undefined
        };
      }

      return {
        token,
        direction,
        success: true,
        gcQuote: galaQuote,
        solQuote: solQuoteResult,
        rateConversion,
        riskResult
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error evaluating ${directionLabel} direction for ${token.symbol}`, {
        error: errorMessage
      });
      return {
        token,
        direction,
        success: false,
        gcQuote: null,
        solQuote: null,
        rateConversion: null,
        riskResult: null,
        error: errorMessage
      };
    }
  }

  /**
   * Select best direction based on configuration and edge comparison
   */
  private selectBestDirection(
    forward: TokenEvaluationResult,
    reverse: TokenEvaluationResult | null,
    config: import('../types/direction').DirectionConfig
  ): TokenEvaluationResult {
    // If direction is forced, return that
    if (config.priority === 'forward') {
      return { ...forward, direction: 'forward' };
    }
    if (config.priority === 'reverse' && reverse) {
      return reverse;
    }

    // If "best", compare edges
    if (config.priority === 'best') {
      const forwardEdge = forward.riskResult?.edge?.netEdgeBps || -Infinity;
      const reverseEdge = reverse?.riskResult?.edge?.netEdgeBps || -Infinity;
      const forwardProceed = forward.riskResult?.shouldProceed || false;
      const reverseProceed = reverse?.riskResult?.shouldProceed || false;

      // Prefer forward if both equal (default)
      if (forwardEdge >= reverseEdge && forwardProceed) {
        logger.debug(`   Selected FORWARD direction (edge: ${forwardEdge.toFixed(2)} bps)`);
        return { ...forward, direction: 'forward' };
      }
      if (reverseEdge > forwardEdge && reverseProceed) {
        logger.debug(`   Selected REVERSE direction (edge: ${reverseEdge.toFixed(2)} bps)`);
        return reverse!;
      }

      // If only one meets threshold, use that one
      if (forwardProceed && !reverseProceed) {
        logger.debug(`   Selected FORWARD direction (only direction meeting threshold)`);
        return { ...forward, direction: 'forward' };
      }
      if (reverseProceed && !forwardProceed) {
        logger.debug(`   Selected REVERSE direction (only direction meeting threshold)`);
        return reverse!;
      }
    }

    // Default to forward
    logger.debug(`   Selected FORWARD direction (default)`);
    return { ...forward, direction: 'forward' };
  }

  /**
   * Log evaluation results
   * Logs both forward and reverse results if both were evaluated
   */
  logEvaluationResults(result: TokenEvaluationResult): void {
    const tradingConfig = this.configService.getTradingConfig();
    
    // Get both evaluations if available
    const forwardEvaluation = (result as any).forwardEvaluation as TokenEvaluationResult | undefined;
    const reverseEvaluation = (result as any).reverseEvaluation as TokenEvaluationResult | undefined;
    
    // Log forward evaluation if we have it
    if (forwardEvaluation && forwardEvaluation.success && forwardEvaluation.gcQuote && forwardEvaluation.solQuote) {
      this.logDirectionResults(forwardEvaluation, tradingConfig);
    }
    
    // Log reverse evaluation if we have it (always show it for comparison)
    if (reverseEvaluation && reverseEvaluation.success && reverseEvaluation.gcQuote && reverseEvaluation.solQuote) {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 REVERSE Evaluation Results:`);
      this.logDirectionResults(reverseEvaluation, tradingConfig);
    }
  }
  
  /**
   * Log results for a specific direction
   */
  private logDirectionResults(result: TokenEvaluationResult, tradingConfig: any): void {
    const { token, gcQuote, solQuote, direction } = result;
    
    if (!gcQuote || !solQuote) {
      logger.warn(`   ⚠️ Cannot log ${direction} results - missing quotes`);
      return;
    }
    
    const directionLabel = DirectionUtils.getLabel(direction);
    const isReverse = direction === 'reverse';

    // Log prices
    const gcProceeds = gcQuote.price.multipliedBy(token.tradeSize);
    const solCost = solQuote.price.multipliedBy(token.tradeSize);

    logger.info(`\n💰 MARKET PRICES (${directionLabel})`);
    
    if (isReverse) {
      // REVERSE: BUY on GC, SELL on SOL
      logger.info(`   🔷 GalaChain (BUY ${token.symbol} with GALA)`);
      logger.info(`      Price:    ${gcQuote.price.toFixed(8)} ${gcQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Cost:     ${gcProceeds.toFixed(8)} ${gcQuote.currency} (to buy ${token.tradeSize} ${token.symbol})`);
      logger.info(`      Impact:   ${gcQuote.priceImpactBps.toFixed(2)} bps`);

      logger.info(`   🔸 Solana (SELL ${token.symbol} for ${solQuote.currency})`);
      logger.info(`      Price:    ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Proceeds: ${solCost.toFixed(8)} ${solQuote.currency} (from selling ${token.tradeSize} ${token.symbol})`);
      logger.info(`      Impact:   ${solQuote.priceImpactBps.toFixed(2)} bps`);
    } else {
      // FORWARD: SELL on GC, BUY on SOL
      const gcAction = token.gcQuoteVia === 'GALA'
        ? `SELL GALA → BUY ${token.symbol}`
        : `SELL ${token.symbol}`;
      const solAction = token.solQuoteVia === 'GALA'
        ? `SELL ${token.symbol} → BUY GALA`
        : `BUY ${token.symbol}`;

      logger.info(`   🔷 GalaChain (${gcAction})`);
      logger.info(`      Price:    ${gcQuote.price.toFixed(8)} ${gcQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      if (token.gcQuoteVia === 'GALA') {
        logger.info(`      Cost:     ${gcProceeds.toFixed(8)} ${gcQuote.currency} (to buy ${token.tradeSize} ${token.symbol})`);
      } else {
        logger.info(`      Proceeds: ${gcProceeds.toFixed(8)} ${gcQuote.currency}`);
      }
      logger.info(`      Impact:   ${gcQuote.priceImpactBps.toFixed(2)} bps`);

      logger.info(`   🔸 Solana (${solAction})`);
      logger.info(`      Price:    ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      if (token.solQuoteVia === 'GALA') {
        logger.info(`      Proceeds: ${solCost.toFixed(8)} ${solQuote.currency} (from selling ${token.tradeSize} ${token.symbol})`);
      } else {
        logger.info(`      Cost:     ${solCost.toFixed(8)} ${solQuote.currency}`);
      }
      logger.info(`      Impact:   ${solQuote.priceImpactBps.toFixed(2)} bps`);
    }

    // Log risk evaluation result
    if (!result.riskResult || !result.riskResult.shouldProceed) {
      logger.info(`❌ DECISION: DO NOT TRADE ${token.symbol}`);
      if (result.riskResult?.reasons) {
        logger.info(`\n   Reasons:`);
        result.riskResult.reasons.forEach((r: string, i: number) =>
          logger.info(`   ${i + 1}. ${r}`)
        );
      }
      logger.info(`${'═'.repeat(60)}\n`);
      return;
    }

    // Log detailed edge calculation
    if (result.riskResult.edge) {
      const edge = result.riskResult.edge;
      const isProfitable = edge.isProfitable;
      const meetsThreshold = edge.meetsThreshold;
      const impactAcceptable = edge.priceImpactAcceptable;
      const minEdgeBps = isReverse 
        ? (tradingConfig.reverseArbitrageMinEdgeBps || tradingConfig.minEdgeBps)
        : tradingConfig.minEdgeBps;

      logger.info(`\n🧮 EDGE CALCULATION (${directionLabel})`);
      
      if (isReverse) {
        // REVERSE: SOL proceeds - GC cost
        logger.info(`   📥 INCOME:`);
        logger.info(`      🔸 Solana Proceeds:    ${edge.galaChainProceeds.toFixed(8)} GALA (${solCost.toFixed(8)} ${solQuote.currency})`);
        logger.info(`   📤 COSTS:`);
        logger.info(`      🔷 GalaChain Cost:    ${edge.solanaCostGala.toFixed(8)} GALA`);
        logger.info(`      🌉 Bridge Cost (amort): ${edge.bridgeCost.toFixed(8)} GALA (amortized per trade)`);
        logger.info(`      🛡️  Risk Buffer:        ${edge.riskBuffer.toFixed(8)} GALA`);
      } else {
        // FORWARD: GC proceeds - SOL cost
        logger.info(`   📥 INCOME:`);
        logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);
        logger.info(`   📤 COSTS:`);
        logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA (${solCost.toFixed(8)} ${solQuote.currency})`);
        logger.info(`      🌉 Bridge Cost (amort): ${edge.bridgeCost.toFixed(8)} GALA (amortized per trade)`);
        logger.info(`      🛡️  Risk Buffer:        ${edge.riskBuffer.toFixed(8)} GALA`);
      }
      
      logger.info(`      ────────────────────────────`);
      logger.info(`      💰 Total Cost:         ${edge.totalCost.toFixed(8)} GALA`);
      logger.info(`   ════════════════════════════════`);
      logger.info(`   💵 NET EDGE:              ${edge.netEdge.toFixed(8)} GALA (${edge.netEdgeBps.toFixed(2)} bps)`);
      logger.info(`   📊 Threshold:             ${minEdgeBps} bps minimum`);
      logger.info(`   ✅ Meets Threshold:        ${meetsThreshold ? 'YES ✓' : 'NO ✗'}`);
      logger.info(`   💹 Profitable:             ${isProfitable ? 'YES ✓' : 'NO ✗'}`);
      logger.info(`\n   📉 PRICE IMPACT:`);
      logger.info(`      🔷 GalaChain:           ${edge.galaChainPriceImpactBps.toFixed(2)} bps`);
      logger.info(`      🔸 Solana:              ${edge.solanaPriceImpactBps.toFixed(2)} bps`);
      logger.info(`      Max Allowed:            ${tradingConfig.maxPriceImpactBps} bps`);
      logger.info(`      ✅ Acceptable:          ${impactAcceptable ? 'YES ✓' : 'NO ✗'}`);
    }

    // Log decision
    logger.info(`\n${'═'.repeat(60)}`);
    logger.info(`✅ DECISION: PROCEED WITH ${directionLabel} TRADE ${token.symbol}`);
    if (result.riskResult.edge) {
      logger.info(`   Expected Edge: ${result.riskResult.edge.netEdge.toFixed(8)} GALA (${result.riskResult.edge.netEdgeBps.toFixed(2)} bps)`);
    }
    logger.info(`${'═'.repeat(60)}\n`);
  }
}

