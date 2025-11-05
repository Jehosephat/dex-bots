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
import { StrategyRegistry, StrategyEvaluator, StrategyEvaluationResult } from './strategies';

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
  private strategyRegistry: StrategyRegistry | null = null;
  private strategyEvaluator: StrategyEvaluator | null = null;
  private useStrategies: boolean = false;

  constructor(
    private configService: IConfigService,
    private gcProvider: GalaChainPriceProvider,
    private solProvider: SolanaPriceProvider
  ) {
    this.rateConverter = new RateConverter(gcProvider, solProvider);
    this.riskManager = new RiskManager(undefined, configService);
    
    // Initialize strategy system if strategies are configured
    this.initializeStrategies();
  }

  /**
   * Initialize strategy system if strategies are configured
   */
  private initializeStrategies(): void {
    try {
      const strategiesConfig = this.configService.getStrategiesConfig();
      if (strategiesConfig && Object.keys(strategiesConfig).length > 0) {
        this.strategyRegistry = new StrategyRegistry();
        this.strategyRegistry.loadFromConfig(strategiesConfig);
        this.strategyEvaluator = new StrategyEvaluator(
          this.configService,
          this.gcProvider,
          this.solProvider,
          this.strategyRegistry
        );
        this.useStrategies = true;
        logger.info(`✅ Strategy system initialized with ${this.strategyRegistry.getEnabledCount()} enabled strategy(ies)`);
      } else {
        logger.debug('No strategies configured, using default forward/reverse evaluation');
      }
    } catch (error) {
      logger.warn('Failed to initialize strategy system, falling back to default evaluation', {
        error: error instanceof Error ? error.message : String(error)
      });
      this.useStrategies = false;
    }
  }

  /**
   * Evaluate a token for arbitrage opportunity (bidirectional or strategy-based)
   */
  async evaluateToken(token: TokenConfig): Promise<TokenEvaluationResult> {
    try {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 EVALUATING: ${token.symbol} | Trade Size: ${token.tradeSize}`);

      // Use strategy-based evaluation if strategies are configured
      if (this.useStrategies && this.strategyEvaluator) {
        return await this.evaluateWithStrategies(token);
      }

      // Fall back to default forward/reverse evaluation
      return await this.evaluateWithDirections(token);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ ERROR evaluating ${token.symbol}`, { error: errorMessage });
      return {
        token,
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
   * Evaluate using strategy system
   */
  private async evaluateWithStrategies(token: TokenConfig): Promise<TokenEvaluationResult> {
    if (!this.strategyEvaluator) {
      throw new Error('Strategy evaluator not initialized');
    }

    // Evaluate all strategies
    const comparison = await this.strategyEvaluator.compareStrategies(token);
    
    if (!comparison.bestStrategy) {
      // No profitable strategy found
      logger.info(`\n   ⚠️  No profitable strategies found for ${token.symbol}`);
      logger.info(`      All ${comparison.strategies.length} strategies evaluated, none met profitability criteria`);
      return {
        token,
        success: false,
        gcQuote: null,
        solQuote: null,
        rateConversion: null,
        riskResult: null,
        error: 'No profitable strategies'
      };
    }

    // Convert StrategyEvaluationResult to TokenEvaluationResult
    const bestStrategy = comparison.bestStrategy;
    const strategy = bestStrategy.strategy;
    
    // Determine direction based on strategy operations
    const direction: 'forward' | 'reverse' = 
      (strategy.galaChainSide.operation === 'sell' && strategy.solanaSide.operation === 'buy')
        ? 'forward'
        : 'reverse';

    const result: TokenEvaluationResult = {
      token,
      direction,
      success: bestStrategy.success,
      gcQuote: bestStrategy.gcQuote,
      solQuote: bestStrategy.solQuote,
      rateConversion: bestStrategy.rateConversion,
      riskResult: bestStrategy.riskResult,
      error: bestStrategy.error
    };

    // Store strategy information for logging
    (result as any).strategy = strategy;
    (result as any).allStrategies = comparison.strategies;

    // Strategy selection already logged by StrategyEvaluator
    return result;
  }

  /**
   * Evaluate using default forward/reverse directions
   */
  private async evaluateWithDirections(token: TokenConfig): Promise<TokenEvaluationResult> {
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
   * Logs strategy results or forward/reverse results depending on evaluation mode
   */
  logEvaluationResults(result: TokenEvaluationResult): void {
    const tradingConfig = this.configService.getTradingConfig();
    
    // Check if this is a strategy-based result
    const strategy = (result as any).strategy;
    const allStrategies = (result as any).allStrategies as StrategyEvaluationResult[] | undefined;
    
    if (strategy && allStrategies) {
      // Log strategy-based results
      this.logStrategyResults(result, allStrategies, tradingConfig);
      return;
    }
    
    // Log forward/reverse direction-based results
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
   * Log strategy-based evaluation results
   */
  private logStrategyResults(
    result: TokenEvaluationResult,
    allStrategies: StrategyEvaluationResult[],
    tradingConfig: any
  ): void {
    const strategy = (result as any).strategy;
    
    logger.info(`\n${'━'.repeat(60)}`);
    logger.info(`📊 Strategy Evaluation Results`);
    logger.info(`   ⭐ Selected: ${strategy.name}`);
    
    // Show strategy operations clearly
    const gcOp = strategy.galaChainSide.operation.toUpperCase();
    const solOp = strategy.solanaSide.operation.toUpperCase();
    logger.info(`   🔷 GalaChain: ${gcOp} ${result.token.symbol} → Receive ${strategy.galaChainSide.quoteCurrency}`);
    logger.info(`   🔸 Solana: ${solOp} ${result.token.symbol} → Spend ${strategy.solanaSide.quoteCurrency}`);
    
    // Log all strategy results for comparison in a cleaner format
    if (allStrategies.length > 1) {
      logger.info(`\n   📊 All Strategies Evaluated:`);
      logger.info(`   ════════════════════════════════════════════════════════`);
      allStrategies.forEach((s, i) => {
        const edge = s.edge?.netEdgeBps?.toFixed(2) || 'N/A';
        const grossEdge = s.edge && !s.edge.galaChainProceeds.isZero() ? 
          (s.edge.galaChainProceeds.minus(s.edge.solanaCostGala).div(s.edge.galaChainProceeds).multipliedBy(10000).toFixed(2)) : 
          'N/A';
        const isSelected = s.strategy.id === strategy.id;
        
        if (s.success && s.riskResult?.shouldProceed && s.edge?.isProfitable && s.edge?.meetsThreshold) {
          const marker = isSelected ? '⭐' : '✅';
          logger.info(`      ${marker} ${s.strategy.name}`);
          logger.info(`         Net Edge:    ${edge} bps (Gross: ${grossEdge} bps)`);
          logger.info(`         GC Impact:   ${s.edge?.galaChainPriceImpactBps.toFixed(2) || 'N/A'} bps`);
          logger.info(`         SOL Impact:  ${s.edge?.solanaPriceImpactBps.toFixed(2) || 'N/A'} bps`);
          logger.info(`         Total Cost:  ${s.edge?.totalCost.toFixed(8) || 'N/A'} GALA`);
        } else if (s.success) {
          const reason = s.riskResult?.reasons?.[0] || 'Edge too low';
          const edgeInfo = edge !== 'N/A' ? ` (Edge: ${edge} bps)` : '';
          logger.info(`      ❌ ${s.strategy.name}: ${reason}${edgeInfo}`);
          if (s.edge && !s.edge.isProfitable) {
            logger.debug(`         Net Edge: ${s.edge.netEdgeBps.toFixed(2)} bps (below threshold)`);
          }
        } else {
          const error = s.error?.split(':')[0] || 'Failed';
          logger.info(`      ⚠️  ${s.strategy.name}: ${error}`);
        }
        if (i < allStrategies.length - 1) {
          logger.info(``);
        }
      });
      logger.info(`   ════════════════════════════════════════════════════════`);
    }
    
    // Log detailed results for selected strategy
    if (result.success && result.gcQuote && result.solQuote) {
      logger.info(`\n${'━'.repeat(60)}`);
      this.logDirectionResults(result, tradingConfig);
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
    logger.info(`   ════════════════════════════════════════════════════════`);
    
    if (isReverse) {
      // REVERSE: BUY on GC, SELL on SOL
      logger.info(`   🔷 GalaChain (BUY ${token.symbol} with GALA)`);
      logger.info(`      Price:      ${gcQuote.price.toFixed(8)} ${gcQuote.currency} per ${token.symbol}`);
      logger.info(`      Trade Size:  ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Total Cost:  ${gcProceeds.toFixed(8)} ${gcQuote.currency}`);
      logger.info(`      Price Impact: ${gcQuote.priceImpactBps.toFixed(2)} bps`);
      if (gcQuote.minOutput) {
        logger.info(`      Min Output:  ${gcQuote.minOutput.toFixed(8)} ${gcQuote.currency}`);
      }

      logger.info(`\n   🔸 Solana (SELL ${token.symbol} for ${solQuote.currency})`);
      logger.info(`      Price:      ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol}`);
      logger.info(`      Trade Size:  ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Proceeds:    ${solCost.toFixed(8)} ${solQuote.currency}`);
      logger.info(`      Price Impact: ${solQuote.priceImpactBps.toFixed(2)} bps`);
      if (solQuote.minOutput) {
        logger.info(`      Min Output:  ${solQuote.minOutput.toFixed(8)} ${solQuote.currency}`);
      }
      if ((solQuote as any).jupiterRoute) {
        const route = (solQuote as any).jupiterRoute;
        logger.info(`      Route:       ${route.routeId || 'N/A'}`);
      }
    } else {
      // FORWARD: SELL on GC, BUY on SOL
      const gcAction = token.gcQuoteVia === 'GALA'
        ? `SELL GALA → BUY ${token.symbol}`
        : `SELL ${token.symbol}`;
      const solAction = token.solQuoteVia === 'GALA'
        ? `SELL ${token.symbol} → BUY GALA`
        : `BUY ${token.symbol}`;

      logger.info(`   🔷 GalaChain (${gcAction})`);
      logger.info(`      Price:      ${gcQuote.price.toFixed(8)} ${gcQuote.currency} per ${token.symbol}`);
      logger.info(`      Trade Size:  ${token.tradeSize} ${token.symbol}`);
      if (token.gcQuoteVia === 'GALA') {
        logger.info(`      Total Cost:  ${gcProceeds.toFixed(8)} ${gcQuote.currency}`);
      } else {
        logger.info(`      Proceeds:    ${gcProceeds.toFixed(8)} ${gcQuote.currency}`);
      }
      logger.info(`      Price Impact: ${gcQuote.priceImpactBps.toFixed(2)} bps`);
      if (gcQuote.minOutput) {
        logger.info(`      Min Output:  ${gcQuote.minOutput.toFixed(8)} ${gcQuote.currency}`);
      }

      logger.info(`\n   🔸 Solana (${solAction})`);
      logger.info(`      Price:      ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol}`);
      logger.info(`      Trade Size:  ${token.tradeSize} ${token.symbol}`);
      if (token.solQuoteVia === 'GALA') {
        logger.info(`      Proceeds:    ${solCost.toFixed(8)} ${solQuote.currency}`);
      } else {
        logger.info(`      Total Cost:  ${solCost.toFixed(8)} ${solQuote.currency}`);
      }
      logger.info(`      Price Impact: ${solQuote.priceImpactBps.toFixed(2)} bps`);
      if (solQuote.minOutput) {
        logger.info(`      Min Output:  ${solQuote.minOutput.toFixed(8)} ${solQuote.currency}`);
      }
      if ((solQuote as any).jupiterRoute) {
        const route = (solQuote as any).jupiterRoute;
        logger.info(`      Route:       ${route.routeId || 'N/A'}`);
        if (route.steps && route.steps.length > 0) {
          logger.info(`      Route Hops:  ${route.steps.length} step(s)`);
        }
      }
    }
    logger.info(`   ════════════════════════════════════════════════════════`);

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

      // Calculate gross edge (before bridge cost and risk buffer)
      const grossEdge = edge.galaChainProceeds.minus(edge.solanaCostGala);
      const grossEdgeBps = edge.galaChainProceeds.isZero() ? 0 : 
        grossEdge.div(edge.galaChainProceeds).multipliedBy(10000).toNumber();

      // Get USD values if we have rate conversion
      const galaUsdPrice = result.rateConversion?.galaUsdPrice;
      
      logger.info(`\n🧮 EDGE CALCULATION (${directionLabel})`);
      logger.info(`   ════════════════════════════════════════════════════════`);
      
      if (isReverse) {
        // REVERSE: SOL proceeds - GC cost
        logger.info(`   📥 INCOME:`);
        logger.info(`      🔸 Solana Proceeds:    ${edge.galaChainProceeds.toFixed(8)} GALA`);
        if (solQuote.currency !== 'GALA') {
          logger.info(`                          (${solCost.toFixed(8)} ${solQuote.currency})`);
        }
        if (galaUsdPrice) {
          const usdValue = edge.galaChainProceeds.multipliedBy(galaUsdPrice);
          logger.info(`                          ≈ $${usdValue.toFixed(2)} USD`);
        }
        
        logger.info(`\n   📤 COSTS:`);
        logger.info(`      🔷 GalaChain Cost:    ${edge.solanaCostGala.toFixed(8)} GALA`);
        if (galaUsdPrice) {
          const usdValue = edge.solanaCostGala.multipliedBy(galaUsdPrice);
          logger.info(`                          ≈ $${usdValue.toFixed(2)} USD`);
        }
      } else {
        // FORWARD: GC proceeds - SOL cost
        logger.info(`   📥 INCOME:`);
        logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);
        if (galaUsdPrice) {
          const usdValue = edge.galaChainProceeds.multipliedBy(galaUsdPrice);
          logger.info(`                          ≈ $${usdValue.toFixed(2)} USD`);
        }
        
        logger.info(`\n   📤 COSTS:`);
        logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA`);
        if (solQuote.currency !== 'GALA') {
          logger.info(`                          (${solCost.toFixed(8)} ${solQuote.currency})`);
        }
        if (galaUsdPrice) {
          const usdValue = edge.solanaCostGala.multipliedBy(galaUsdPrice);
          logger.info(`                          ≈ $${usdValue.toFixed(2)} USD`);
        }
      }
      
      // Rate conversion details
      if (result.rateConversion && solQuote.currency !== 'GALA') {
        logger.info(`\n   🔄 RATE CONVERSION:`);
        logger.info(`      ${solQuote.currency}/GALA: ${edge.solToGalaRate.toFixed(8)}`);
        if (galaUsdPrice && result.rateConversion.rate) {
          const galaUsdPriceBN = new BigNumber(galaUsdPrice);
          const quoteUsdPrice = galaUsdPriceBN.multipliedBy(result.rateConversion.rate);
          logger.info(`      ${solQuote.currency}/USD: ${quoteUsdPrice.toFixed(8)}`);
        }
      }
      
      logger.info(`\n   💰 COST BREAKDOWN:`);
      logger.info(`      🔷 GalaChain/Solana Cost: ${edge.solanaCostGala.toFixed(8)} GALA`);
      logger.info(`      🌉 Bridge Cost (amort):   ${edge.bridgeCost.toFixed(8)} GALA`);
      logger.info(`      🛡️  Risk Buffer:           ${edge.riskBuffer.toFixed(8)} GALA`);
      logger.info(`      ───────────────────────────────────────────`);
      logger.info(`      💰 Total Cost:            ${edge.totalCost.toFixed(8)} GALA`);
      if (galaUsdPrice) {
        const usdValue = edge.totalCost.multipliedBy(galaUsdPrice);
        logger.info(`                              ≈ $${usdValue.toFixed(2)} USD`);
      }
      
      logger.info(`\n   📊 EDGE ANALYSIS:`);
      logger.info(`      💰 Gross Edge:            ${grossEdge.toFixed(8)} GALA (${grossEdgeBps.toFixed(2)} bps)`);
      if (galaUsdPrice) {
        const usdValue = grossEdge.multipliedBy(galaUsdPrice);
        logger.info(`                              ≈ $${usdValue.toFixed(2)} USD`);
      }
      logger.info(`      💵 Net Edge:              ${edge.netEdge.toFixed(8)} GALA (${edge.netEdgeBps.toFixed(2)} bps)`);
      if (galaUsdPrice) {
        const usdValue = edge.netEdge.multipliedBy(galaUsdPrice);
        logger.info(`                              ≈ $${usdValue.toFixed(2)} USD`);
      }
      logger.info(`      📉 Edge Reduction:        ${grossEdge.minus(edge.netEdge).toFixed(8)} GALA (${(grossEdgeBps - edge.netEdgeBps).toFixed(2)} bps)`);
      logger.info(`      ───────────────────────────────────────────`);
      logger.info(`      📊 Threshold:             ${minEdgeBps} bps minimum`);
      logger.info(`      ✅ Meets Threshold:        ${meetsThreshold ? 'YES ✓' : 'NO ✗'}`);
      logger.info(`      💹 Profitable:             ${isProfitable ? 'YES ✓' : 'NO ✗'}`);
      
      logger.info(`\n   📉 PRICE IMPACT ANALYSIS:`);
      logger.info(`      🔷 GalaChain:             ${edge.galaChainPriceImpactBps.toFixed(2)} bps`);
      logger.info(`      🔸 Solana:                ${edge.solanaPriceImpactBps.toFixed(2)} bps`);
      logger.info(`      📊 Total Impact:          ${(edge.galaChainPriceImpactBps + edge.solanaPriceImpactBps).toFixed(2)} bps`);
      logger.info(`      ⚠️  Max Allowed:           ${tradingConfig.maxPriceImpactBps} bps`);
      logger.info(`      ✅ Acceptable:             ${impactAcceptable ? 'YES ✓' : 'NO ✗'}`);
      
      // Show quote details
      if (gcQuote.priceImpactBps || solQuote.priceImpactBps) {
        logger.info(`\n   📋 QUOTE DETAILS:`);
        if (gcQuote.minOutput) {
          logger.info(`      🔷 GalaChain Min Output: ${gcQuote.minOutput.toFixed(8)} ${gcQuote.currency}`);
        }
        if (solQuote.minOutput) {
          logger.info(`      🔸 Solana Min Output:    ${solQuote.minOutput.toFixed(8)} ${solQuote.currency}`);
        }
        if ((solQuote as any).jupiterRoute) {
          const route = (solQuote as any).jupiterRoute;
          logger.info(`      🔸 Solana Route:         ${route.routeId || 'N/A'}`);
          if (route.steps && route.steps.length > 0) {
            logger.info(`      🔸 Route Steps:          ${route.steps.length} hop(s)`);
          }
        }
      }
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

