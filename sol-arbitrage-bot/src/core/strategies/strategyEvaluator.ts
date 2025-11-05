/**
 * Strategy Evaluator
 * 
 * Evaluates multiple arbitrage strategies for a token and selects the best one.
 * Handles quote fetching, rate conversion, edge calculation, and risk evaluation
 * for each strategy.
 */

import BigNumber from 'bignumber.js';
import logger from '../../utils/logger';
import { IConfigService } from '../../config';
import { TokenConfig } from '../../types/config';
import { GalaChainPriceProvider } from '../priceProviders/galachain';
import { SolanaPriceProvider } from '../priceProviders/solana';
import { RateConverter, RateConversionResult } from '../rateConverter';
import { RiskManager } from '../../execution/riskManager';
import { GalaChainQuote, SolanaQuote } from '../../types/core';
import { getErrorHandler } from '../../utils/errorHandler';
import {
  ArbitrageStrategy,
  StrategyEvaluationResult,
  StrategyComparisonResult,
  ChainSideConfig
} from './arbitrageStrategy';
import { StrategyRegistry } from './strategyRegistry';

/**
 * Strategy Evaluator
 * 
 * Evaluates multiple arbitrage strategies for a token and selects the best one
 */
export class StrategyEvaluator {
  private errorHandler = getErrorHandler();
  private rateConverter: RateConverter;
  private riskManager: RiskManager;

  constructor(
    private configService: IConfigService,
    private gcProvider: GalaChainPriceProvider,
    private solProvider: SolanaPriceProvider,
    private strategyRegistry: StrategyRegistry
  ) {
    this.rateConverter = new RateConverter(gcProvider, solProvider);
    this.riskManager = new RiskManager(undefined, configService);
  }

  /**
   * Evaluate all enabled strategies for a token
   */
  async evaluateStrategies(token: TokenConfig): Promise<StrategyEvaluationResult[]> {
    const strategies = this.strategyRegistry.getStrategiesForToken(token.symbol);
    
    if (strategies.length === 0) {
      logger.debug(`No enabled strategies found for token ${token.symbol}`);
      return [];
    }

    logger.info(`\n${'━'.repeat(60)}`);
    logger.info(`📊 EVALUATING STRATEGIES: ${token.symbol} | Trade Size: ${token.tradeSize}`);
    logger.info(`   Found ${strategies.length} enabled strategy(ies)`);

    // Evaluate all strategies in parallel
    const evaluationPromises = strategies.map(strategy =>
      this.evaluateStrategy(token, strategy)
    );

    const results = await Promise.all(evaluationPromises);

    // Log summary
    const successful = results.filter(r => r.success).length;
    const profitable = results.filter(r => r.riskResult?.shouldProceed).length;
    logger.info(`   Results: ${successful}/${strategies.length} successful, ${profitable} profitable`);

    return results;
  }

  /**
   * Select the best strategy from evaluation results
   */
  selectBestStrategy(results: StrategyEvaluationResult[]): StrategyEvaluationResult | null {
    // Filter to only successful evaluations with passing risk checks
    const passingStrategies = results.filter(result =>
      result.success &&
      result.riskResult?.shouldProceed &&
      result.edge &&
      result.edge.isProfitable &&
      result.edge.meetsThreshold
    );

    if (passingStrategies.length === 0) {
      logger.debug('No profitable strategies found');
      return null;
    }

    // Sort by edge (highest first), then by priority
    passingStrategies.sort((a, b) => {
      const edgeA = a.edge?.netEdgeBps || 0;
      const edgeB = b.edge?.netEdgeBps || 0;
      
      if (Math.abs(edgeA - edgeB) > 0.1) {
        // Significant edge difference, prioritize by edge
        return edgeB - edgeA;
      }
      
      // Similar edge, prioritize by strategy priority
      const priorityA = a.strategy.priority ?? 999;
      const priorityB = b.strategy.priority ?? 999;
      return priorityA - priorityB;
    });

    const best = passingStrategies[0];
    logger.info(`   ✅ Best strategy: ${best.strategy.name} (Edge: ${best.edge?.netEdgeBps.toFixed(2)} bps)`);
    
    return best;
  }

  /**
   * Evaluate a single strategy
   */
  private async evaluateStrategy(
    token: TokenConfig,
    strategy: ArbitrageStrategy
  ): Promise<StrategyEvaluationResult> {
    const startTime = Date.now();
    
    try {
      logger.debug(`   🔍 Evaluating strategy: ${strategy.name}`);

      // Determine reverse flags based on operations
      const gcReverse = strategy.galaChainSide.operation === 'buy';
      const solReverse = strategy.solanaSide.operation === 'buy';

      // Create temporary token config with strategy's quote currencies
      const tempTokenConfig: TokenConfig = {
        ...token,
        gcQuoteVia: strategy.galaChainSide.quoteCurrency,
        solQuoteVia: strategy.solanaSide.quoteCurrency
      };

      // Fetch quotes with strategy-specific quote currencies
      const [gcQuote, solQuote] = await Promise.all([
        this.fetchGalaChainQuote(token.symbol, token.tradeSize, gcReverse, strategy.galaChainSide.quoteCurrency),
        this.fetchSolanaQuote(token.symbol, token.tradeSize, solReverse, strategy.solanaSide.quoteCurrency)
      ]);

      if (!gcQuote || !solQuote) {
        const error = `Missing quote(s) for strategy ${strategy.id} - hasGcQuote: ${!!gcQuote}, hasSolQuote: ${!!solQuote}`;
        logger.debug(`   ⚠️ ${error}`);
        return {
          strategy,
          tokenSymbol: token.symbol,
          success: false,
          gcQuote: gcQuote as GalaChainQuote | null,
          solQuote: solQuote as SolanaQuote | null,
          rateConversion: null,
          riskResult: null,
          error,
          timestamp: startTime
        };
      }

      logger.debug(`   ✅ Quotes received for strategy ${strategy.id}`);

      // Convert quote currency to GALA
      const rateConversion = await this.rateConverter.convertQuoteCurrencyToGala(
        solQuote.currency,
        solQuote,
        token.tradeSize
      );

      if (!rateConversion || rateConversion.rate.isZero()) {
        const error = `Failed to convert ${solQuote.currency} to GALA for strategy ${strategy.id}`;
        logger.debug(`   ⚠️ ${error}`);
        return {
          strategy,
          tokenSymbol: token.symbol,
          success: false,
          gcQuote: gcQuote as GalaChainQuote,
          solQuote: solQuote as SolanaQuote,
          rateConversion: null,
          riskResult: null,
          error,
          timestamp: startTime
        };
      }

      // Calculate edge
      // Determine if this is forward-like or reverse-like based on operations
      const isForwardLike = strategy.galaChainSide.operation === 'sell' && 
                           strategy.solanaSide.operation === 'buy';
      
      let riskResult;
      try {
        if (isForwardLike) {
          // Forward-like: GC sell (get GALA) - SOL buy (spend quote)
          riskResult = this.riskManager.evaluate(
            token,
            gcQuote as GalaChainQuote,
            solQuote as SolanaQuote,
            rateConversion.rate,
            rateConversion.galaUsdPrice
          );
        } else {
          // Reverse-like: GC buy (spend GALA) - SOL sell (get quote)
          // Use reverse edge calculator
          const reverseEdgeCalculator = (this.riskManager as any).reverseEdgeCalculator;
          if (reverseEdgeCalculator) {
            const edge = reverseEdgeCalculator.calculateReverseEdge(
              token,
              gcQuote as GalaChainQuote,
              solQuote as SolanaQuote,
              rateConversion.rate,
              rateConversion.galaUsdPrice
            );
            
            // Create risk result from reverse edge
            const minEdgeBps = strategy.minEdgeBps || 
              this.configService.getTradingConfig().minEdgeBps;
            
            riskResult = {
              shouldProceed: edge.isProfitable && edge.meetsThreshold,
              reasons: edge.invalidationReasons || [],
              edge
            };
          } else {
            // Fallback to forward evaluation
            riskResult = this.riskManager.evaluate(
              token,
              gcQuote as GalaChainQuote,
              solQuote as SolanaQuote,
              rateConversion.rate,
              rateConversion.galaUsdPrice
            );
          }
        }
      } catch (evalError) {
        const error = `Risk evaluation failed for strategy ${strategy.id}: ${evalError instanceof Error ? evalError.message : String(evalError)}`;
        logger.error(`   ❌ ${error}`);
        return {
          strategy,
          tokenSymbol: token.symbol,
          success: false,
          gcQuote: gcQuote as GalaChainQuote,
          solQuote: solQuote as SolanaQuote,
          rateConversion,
          riskResult: null,
          error,
          timestamp: startTime
        };
      }

      logger.debug(`   ${riskResult.shouldProceed ? '✅' : '❌'} Strategy ${strategy.id}: ${riskResult.shouldProceed ? 'PASS' : 'FAIL'} (Edge: ${riskResult.edge?.netEdgeBps?.toFixed(2) || 'N/A'} bps)`);

      return {
        strategy,
        tokenSymbol: token.symbol,
        success: true,
        gcQuote: gcQuote as GalaChainQuote,
        solQuote: solQuote as SolanaQuote,
        rateConversion,
        riskResult,
        edge: riskResult.edge,
        timestamp: startTime
      };

    } catch (error) {
      const errorMessage = `Strategy evaluation error for ${strategy.id}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`   ❌ ${errorMessage}`);
      return {
        strategy,
        tokenSymbol: token.symbol,
        success: false,
        gcQuote: null,
        solQuote: null,
        rateConversion: null,
        riskResult: null,
        error: errorMessage,
        timestamp: startTime
      };
    }
  }

  /**
   * Fetch GalaChain quote with strategy-specific quote currency
   */
  private async fetchGalaChainQuote(
    symbol: string,
    tradeSize: number,
    reverse: boolean,
    quoteCurrency: string
  ): Promise<GalaChainQuote | null> {
    try {
      const quote = await this.gcProvider.getQuote(symbol, tradeSize, reverse, quoteCurrency);
      return quote as GalaChainQuote | null;
    } catch (error) {
      logger.error(`Failed to fetch GalaChain quote for strategy`, {
        error: error instanceof Error ? error.message : String(error),
        symbol,
        quoteCurrency
      });
      return null;
    }
  }

  /**
   * Fetch Solana quote with strategy-specific quote currency
   */
  private async fetchSolanaQuote(
    symbol: string,
    tradeSize: number,
    reverse: boolean,
    quoteCurrency: string
  ): Promise<SolanaQuote | null> {
    try {
      const quote = await this.solProvider.getQuote(symbol, tradeSize, reverse, quoteCurrency);
      return quote as SolanaQuote | null;
    } catch (error) {
      logger.error(`Failed to fetch Solana quote for strategy`, {
        error: error instanceof Error ? error.message : String(error),
        symbol,
        quoteCurrency
      });
      return null;
    }
  }

  /**
   * Compare multiple strategies and return comparison result
   */
  async compareStrategies(token: TokenConfig): Promise<StrategyComparisonResult> {
    const results = await this.evaluateStrategies(token);
    const bestStrategy = this.selectBestStrategy(results);
    const passingStrategies = results.filter(r =>
      r.success && r.riskResult?.shouldProceed && r.edge?.isProfitable && r.edge?.meetsThreshold
    );

    return {
      strategies: results,
      bestStrategy,
      hasProfitableStrategy: bestStrategy !== null,
      passingStrategies: passingStrategies.length
    };
  }
}

