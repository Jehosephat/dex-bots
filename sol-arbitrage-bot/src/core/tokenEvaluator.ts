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

/**
 * Result of token evaluation
 */
export interface TokenEvaluationResult {
  /** Token that was evaluated */
  token: TokenConfig;
  
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
   * Evaluate a token for arbitrage opportunity
   */
  async evaluateToken(token: TokenConfig): Promise<TokenEvaluationResult> {
    try {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 EVALUATING: ${token.symbol} | Trade Size: ${token.tradeSize}`);

      // Fetch quotes for FORWARD direction (SELL token on GC → BUY token on SOL)
      const [gcQuote, solQuote] = await Promise.all([
        this.gcProvider.getQuote(token.symbol, token.tradeSize, false),
        this.solProvider.getQuote(token.symbol, token.tradeSize, false)
      ]);

      // Check if we have both quotes
      if (!gcQuote || !solQuote) {
        const error = `Missing quote(s) - hasGcQuote: ${!!gcQuote}, hasSolQuote: ${!!solQuote}`;
        logger.warn(`⚠️ ${error}, skipping token`, {
          token: token.symbol,
          hasGcQuote: !!gcQuote,
          hasSolQuote: !!solQuote
        });
        return {
          token,
          success: false,
          gcQuote: gcQuote as GalaChainQuote | null,
          solQuote: solQuote as SolanaQuote | null,
          rateConversion: null,
          riskResult: null,
          error
        };
      }

      const galaQuote = gcQuote as GalaChainQuote;
      const solQuoteResult = solQuote as SolanaQuote;

      // Convert quote currency to GALA
      const rateConversion = await this.rateConverter.convertQuoteCurrencyToGala(
        solQuoteResult.currency,
        solQuoteResult,
        token.tradeSize
      );

      if (!rateConversion || rateConversion.rate.isZero() || rateConversion.rate.isNaN()) {
        const error = 'Invalid conversion rate';
        logger.warn(`⚠️ ${error}, skipping ${token.symbol}`);
        return {
          token,
          success: false,
          gcQuote: galaQuote,
          solQuote: solQuoteResult,
          rateConversion: null,
          riskResult: null,
          error
        };
      }

      // Evaluate risk
      let riskResult;
      try {
        riskResult = this.riskManager.evaluate(
          token,
          galaQuote,
          solQuoteResult,
          rateConversion.rate,
          rateConversion.galaUsdPrice
        );
      } catch (evalError) {
        logger.error(`❌ ERROR in risk.evaluate() for ${token.symbol}`, {
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
        success: true,
        gcQuote: galaQuote,
        solQuote: solQuoteResult,
        rateConversion,
        riskResult
      };
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
   * Log evaluation results
   */
  logEvaluationResults(result: TokenEvaluationResult): void {
    if (!result.success || !result.gcQuote || !result.solQuote) {
      return;
    }

    const { token, gcQuote, solQuote } = result;
    const tradingConfig = this.configService.getTradingConfig();

    // Log prices
    const gcProceeds = gcQuote.price.multipliedBy(token.tradeSize);
    const solCost = solQuote.price.multipliedBy(token.tradeSize);

    logger.info(`\n💰 MARKET PRICES`);
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

      logger.info(`\n🧮 EDGE CALCULATION`);
      logger.info(`   📥 INCOME:`);
      logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);
      logger.info(`   📤 COSTS:`);
      logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA (${solCost.toFixed(8)} ${solQuote.currency})`);
      logger.info(`      🌉 Bridge Cost (amort): ${edge.bridgeCost.toFixed(8)} GALA (amortized per trade)`);
      logger.info(`      🛡️  Risk Buffer:        ${edge.riskBuffer.toFixed(8)} GALA`);
      logger.info(`      ────────────────────────────`);
      logger.info(`      💰 Total Cost:         ${edge.totalCost.toFixed(8)} GALA`);
      logger.info(`   ════════════════════════════════`);
      logger.info(`   💵 NET EDGE:              ${edge.netEdge.toFixed(8)} GALA (${edge.netEdgeBps.toFixed(2)} bps)`);
      logger.info(`   📊 Threshold:             ${tradingConfig.minEdgeBps} bps minimum`);
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
    logger.info(`✅ DECISION: PROCEED WITH TRADE ${token.symbol}`);
    if (result.riskResult.edge) {
      logger.info(`   Expected Edge: ${result.riskResult.edge.netEdge.toFixed(8)} GALA (${result.riskResult.edge.netEdgeBps.toFixed(2)} bps)`);
    }
    logger.info(`${'═'.repeat(60)}\n`);
  }
}

