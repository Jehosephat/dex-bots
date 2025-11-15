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
  // Quote cache to avoid duplicate API calls within an evaluation cycle
  private quoteCache: Map<string, { gcQuote: GalaChainQuote | null; solQuote: SolanaQuote | null; timestamp: number }> = new Map();
  private readonly QUOTE_CACHE_TTL = 5000; // 5 seconds - quotes are only valid for a short time

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
    logger.info(`📊 Evaluating ${strategies.length} Strategy(ies) for ${token.symbol}`);
    logger.info(`   Trade Size: ${token.tradeSize} ${token.symbol}`);

    // Clear quote cache at start of evaluation cycle
    this.quoteCache.clear();

    // Evaluate strategies sequentially with small delays to avoid rate limiting
    // This also allows quote caching to work more effectively
    const results: StrategyEvaluationResult[] = [];
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      
      // Add delay between evaluations to avoid rate limits (except for first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }
      
      const result = await this.evaluateStrategy(token, strategy);
      results.push(result);
    }

    // Log summary with better formatting
    // "Successful" = evaluation completed without errors (quotes fetched, edge calculated)
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    
    // "Profitable" = successful + passed all risk checks + edge is profitable + meets threshold
    const profitable = results.filter(r => 
      r.success && 
      r.riskResult?.shouldProceed && 
      r.edge?.isProfitable && 
      r.edge?.meetsThreshold
    ).length;
    
    logger.info(`\n   📈 Summary:`);
    logger.info(`      ✅ Evaluated: ${successful}/${strategies.length} (quotes fetched, edge calculated)`);
    if (failed.length > 0) {
      const failureReasons = failed.map(f => {
        if (f.error?.includes('Missing quote')) return 'quote fetch failed';
        if (f.error?.includes('validation')) return 'quote validation failed';
        if (f.error?.includes('convert')) return 'rate conversion failed';
        return 'evaluation error';
      });
      const uniqueReasons = [...new Set(failureReasons)];
      logger.debug(`      ⚠️  Failed: ${failed.length}/${strategies.length} (${uniqueReasons.join(', ')})`);
    }
    logger.info(`      💰 Profitable: ${profitable}/${strategies.length} (passed all checks & meets threshold)`);
    
    if (profitable === 0) {
      logger.info(`      ⚠️  No profitable opportunities found`);
    }

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
    const edgeBps = best.edge?.netEdgeBps.toFixed(2) || '0.00';
    logger.info(`\n   ⭐ Best Strategy: ${best.strategy.name}`);
    logger.info(`      Edge: ${edgeBps} bps`);
    
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
      // Log strategy being evaluated in a more readable format
      const gcAction = strategy.galaChainSide.operation === 'buy' ? 'BUY' : 'SELL';
      const solAction = strategy.solanaSide.operation === 'buy' ? 'BUY' : 'SELL';
      logger.info(`\n   🔍 Strategy: ${strategy.name}`);
      logger.info(`      ${gcAction} ${token.symbol} on GalaChain (quote: ${strategy.galaChainSide.quoteCurrency})`);
      logger.info(`      ${solAction} ${token.symbol} on Solana (quote: ${strategy.solanaSide.quoteCurrency})`);

      // Determine reverse flags based on operations
      // 
      // For Solana: reverse=false = BUY token, reverse=true = SELL token
      // So: operation='buy' → reverse=false, operation='sell' → reverse=true
      const solReverse = strategy.solanaSide.operation === 'sell';
      
      // For GalaChain: reverse=false = SELL token → GET GALA, reverse=true = SELL GALA → BUY token
      // So: operation='sell' → reverse=false (sell token, get GALA)
      //     operation='buy' → reverse=true (sell GALA, buy token)
      const gcReverse = strategy.galaChainSide.operation === 'buy';

      // Create temporary token config with strategy's quote currencies
      const tempTokenConfig: TokenConfig = {
        ...token,
        gcQuoteVia: strategy.galaChainSide.quoteCurrency,
        solQuoteVia: strategy.solanaSide.quoteCurrency
      };

      // Fetch quotes with strategy-specific quote currencies
      // Use cache key to deduplicate identical quote requests
      const gcCacheKey = `gc:${token.symbol}:${token.tradeSize}:${strategy.galaChainSide.quoteCurrency}:${gcReverse}`;
      const solCacheKey = `sol:${token.symbol}:${token.tradeSize}:${strategy.solanaSide.quoteCurrency}:${solReverse}`;
      
      // Check cache first
      const cachedGc = this.quoteCache.get(gcCacheKey);
      const cachedSol = this.quoteCache.get(solCacheKey);
      const now = Date.now();
      
      let gcQuote: GalaChainQuote | null;
      let solQuote: SolanaQuote | null;
      
      if (cachedGc && (now - cachedGc.timestamp) < this.QUOTE_CACHE_TTL) {
        gcQuote = cachedGc.gcQuote;
        logger.debug(`   ♻️  Reusing cached GalaChain quote for ${strategy.galaChainSide.quoteCurrency}`);
      } else {
        gcQuote = await this.fetchGalaChainQuote(token.symbol, token.tradeSize, gcReverse, strategy.galaChainSide.quoteCurrency);
        this.quoteCache.set(gcCacheKey, { gcQuote, solQuote: null, timestamp: now });
      }
      
      if (cachedSol && (now - cachedSol.timestamp) < this.QUOTE_CACHE_TTL) {
        solQuote = cachedSol.solQuote;
        logger.debug(`   ♻️  Reusing cached Solana quote for ${strategy.solanaSide.quoteCurrency}`);
      } else {
        solQuote = await this.fetchSolanaQuote(token.symbol, token.tradeSize, solReverse, strategy.solanaSide.quoteCurrency);
        this.quoteCache.set(solCacheKey, { gcQuote: null, solQuote, timestamp: now });
      }

      if (!gcQuote || !solQuote) {
        const error = `Missing quote(s) for strategy ${strategy.id} - hasGcQuote: ${!!gcQuote}, hasSolQuote: ${!!solQuote}`;
        logger.info(`      ⚠️ Quote Fetch Failed: ${error}`);
        if (gcQuote) {
          logger.info(`      🔷 GalaChain Quote: ${gcQuote.price.toFixed(8)} ${gcQuote.currency} per ${token.symbol} (Impact: ${gcQuote.priceImpactBps.toFixed(2)} bps)`);
        }
        if (solQuote) {
          logger.info(`      🔸 Solana Quote: ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol} (Impact: ${solQuote.priceImpactBps.toFixed(2)} bps)`);
        }
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

      logger.info(`      ✅ Quotes received`);
      logger.info(`      🔷 GalaChain: ${gcQuote.price.toFixed(8)} ${gcQuote.currency} per ${token.symbol} (Impact: ${gcQuote.priceImpactBps.toFixed(2)} bps)`);
      logger.info(`      🔸 Solana: ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol} (Impact: ${solQuote.priceImpactBps.toFixed(2)} bps)`);

      // Convert quote currency to GALA
      const rateConversion = await this.rateConverter.convertQuoteCurrencyToGala(
        solQuote.currency,
        solQuote,
        token.tradeSize
      );

      if (!rateConversion || rateConversion.rate.isZero()) {
        const error = `Failed to convert ${solQuote.currency} to GALA for strategy ${strategy.id}`;
        logger.info(`      ⚠️ Rate Conversion Failed: ${error}`);
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
      
      logger.info(`      🔄 Rate Conversion: ${solQuote.currency}/GALA = ${rateConversion.rate.toFixed(8)}`);
      if (rateConversion.galaUsdPrice) {
        logger.info(`      💵 GALA/USD: $${rateConversion.galaUsdPrice.toFixed(4)}`);
      }

      // Calculate edge
      // Determine if this is forward-like or reverse-like based on operations
      const isForwardLike = strategy.galaChainSide.operation === 'sell' &&
                           strategy.solanaSide.operation === 'buy';

      const direction = isForwardLike ? 'forward' : 'reverse';

      let riskResult;
      try {
        // Use RiskManager's evaluateDirection method which handles both directions
        riskResult = this.riskManager.evaluateDirection(
          token,
          gcQuote as GalaChainQuote,
          solQuote as SolanaQuote,
          rateConversion.rate,
          direction,
          rateConversion.galaUsdPrice
        );
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

      // Log detailed edge calculation results
      if (riskResult.edge) {
        const edge = riskResult.edge;
        const grossEdge = edge.galaChainProceeds.minus(edge.solanaCostGala);
        const grossEdgeBps = edge.galaChainProceeds.isZero() ? 0 : 
          grossEdge.div(edge.galaChainProceeds).multipliedBy(10000).toNumber();
        
        logger.info(`\n      🧮 Edge Calculation:`);
        logger.info(`         📥 GalaChain Proceeds: ${edge.galaChainProceeds.toFixed(8)} GALA`);
        logger.info(`         📤 Solana Cost:        ${edge.solanaCostGala.toFixed(8)} GALA`);
        logger.info(`         💰 Gross Edge:         ${grossEdge.toFixed(8)} GALA (${grossEdgeBps.toFixed(2)} bps)`);
        logger.info(`         🌉 Bridge Cost:        ${edge.bridgeCost.toFixed(8)} GALA`);
        logger.info(`         🛡️ Risk Buffer:         ${edge.riskBuffer.toFixed(8)} GALA`);
        logger.info(`         💰 Total Cost:          ${edge.totalCost.toFixed(8)} GALA`);
        logger.info(`         💵 Net Edge:            ${edge.netEdge.toFixed(8)} GALA (${edge.netEdgeBps.toFixed(2)} bps)`);
        logger.info(`         📉 GC Impact:           ${edge.galaChainPriceImpactBps.toFixed(2)} bps`);
        logger.info(`         📉 SOL Impact:          ${edge.solanaPriceImpactBps.toFixed(2)} bps`);
        logger.info(`         📊 Total Impact:        ${(edge.galaChainPriceImpactBps + edge.solanaPriceImpactBps).toFixed(2)} bps`);
        
        const status = riskResult.shouldProceed ? '✅ PASS' : '❌ FAIL';
        logger.info(`         ${status}`);
        
        if (!riskResult.shouldProceed && riskResult.reasons && riskResult.reasons.length > 0) {
          logger.info(`         ⚠️  Reasons:`);
          riskResult.reasons.forEach((reason: string, i: number) => {
            logger.info(`            ${i + 1}. ${reason}`);
          });
        }
      } else {
        const edgeDisplay = 'N/A';
        const status = riskResult.shouldProceed ? '✅ PASS' : '❌ FAIL';
        logger.info(`      ${status} - Edge: ${edgeDisplay}`);
        if (!riskResult.shouldProceed && riskResult.reasons && riskResult.reasons.length > 0) {
          const reasons = riskResult.reasons.slice(0, 2).join(', ');
          logger.info(`      ⚠️  ${reasons}`);
        }
      }

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
    
    // Clear cache after evaluation cycle
    this.quoteCache.clear();

    return {
      strategies: results,
      bestStrategy,
      hasProfitableStrategy: bestStrategy !== null,
      passingStrategies: passingStrategies.length
    };
  }
  
  /**
   * Clear the quote cache
   */
  clearCache(): void {
    this.quoteCache.clear();
  }
}

