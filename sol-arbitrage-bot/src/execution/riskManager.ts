import BigNumber from 'bignumber.js';
import { getTradingConfig } from '../config';
import { EdgeCalculator, EdgeCalculationResult } from '../core/edgeCalculator';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import { TokenConfig } from '../types/config';
import { StateManager } from '../core/stateManager';
import logger from '../utils/logger';

export interface RiskCheckResult {
  shouldProceed: boolean;
  reasons: string[];
  edge?: EdgeCalculationResult;
}

export class RiskManager {
  private trading = getTradingConfig();
  private stateManager: StateManager;
  private edgeCalculator: EdgeCalculator;

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
    this.edgeCalculator = new EdgeCalculator();
  }

  /**
   * Evaluate whether a trade should proceed based on quotes and config.
   * Requires computed SOL→GALA rate (pass from providers or calculation).
   */
  evaluate(
    token: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    solToGalaRate: BigNumber
  ): RiskCheckResult {
    const reasons: string[] = [];

    // 1) Price impact guardrails
    if (Math.abs(galaChainQuote.priceImpactBps) > this.trading.maxPriceImpactBps) {
      reasons.push(`GalaChain price impact too high: ${galaChainQuote.priceImpactBps}bps > ${this.trading.maxPriceImpactBps}bps`);
    }
    if (Math.abs(solanaQuote.priceImpactBps) > this.trading.maxPriceImpactBps) {
      reasons.push(`Solana price impact too high: ${solanaQuote.priceImpactBps}bps > ${this.trading.maxPriceImpactBps}bps`);
    }

    // 2) Cooldown check (optional, uses state)
    if (this.stateManager.isTokenInCooldown(token.symbol)) {
      reasons.push('Token is in cooldown');
    }

    // 3) Edge calculation and threshold
    let edge: EdgeCalculationResult;
    try {
      logger.debug(`🔍 DEBUG: About to call edgeCalculator.calculateEdge()`, {
        token: token.symbol,
        solQuoteVia: token.solQuoteVia,
        solQuoteCurrency: solanaQuote.currency,
        solToGalaRate: solToGalaRate.toString()
      });
      edge = this.edgeCalculator.calculateEdge(token, galaChainQuote, solanaQuote, solToGalaRate);
      logger.debug(`🔍 DEBUG: edgeCalculator.calculateEdge() completed`);
    } catch (edgeError) {
      logger.error(`❌ ERROR in edgeCalculator.calculateEdge() for ${token.symbol}`, {
        error: edgeError instanceof Error ? edgeError.message : String(edgeError),
        stack: edgeError instanceof Error ? edgeError.stack : undefined,
        token: token.symbol,
        solQuoteVia: token.solQuoteVia,
        solQuoteCurrency: solanaQuote.currency,
        solToGalaRate: solToGalaRate.toString()
      });
      throw edgeError; // Re-throw to be caught by mainLoop
    }
    if (!edge.isProfitable) {
      reasons.push(...edge.invalidationReasons);
    }
    if (!edge.meetsThreshold) {
      reasons.push(`Edge below threshold: ${edge.netEdgeBps}bps < ${this.trading.minEdgeBps}bps`);
    }
    if (!edge.priceImpactAcceptable) {
      reasons.push('Combined price impact not acceptable');
    }

    // 4) Inventory check (best-effort; warn if absent)
    const state = this.stateManager.getState() as any;
    const gcTokens = state?.inventory?.galaChain?.tokens || {};
    const gcToken = gcTokens ? gcTokens[token.symbol] : undefined;
    
    // Defensively handle balance - ensure it's a BigNumber
    if (gcToken && gcToken.balance) {
      let balanceBN: BigNumber;
      try {
        if (BigNumber.isBigNumber(gcToken.balance)) {
          balanceBN = gcToken.balance;
        } else {
          // Convert to BigNumber if it's not already one
          balanceBN = new BigNumber(gcToken.balance);
          // Update the state with the converted value
          gcToken.balance = balanceBN;
        }
        
        if (balanceBN.isLessThan(token.tradeSize)) {
          reasons.push('Insufficient GalaChain inventory for sell (simulation mode if dry-run)');
        }
      } catch (balanceError) {
        logger.warn(`⚠️ Failed to check inventory balance for ${token.symbol}`, {
          error: balanceError instanceof Error ? balanceError.message : String(balanceError),
          balanceType: typeof gcToken.balance,
          balanceValue: gcToken.balance
        });
        reasons.push('Unable to verify GalaChain inventory balance');
      }
    } else {
      reasons.push('Insufficient GalaChain inventory for sell (simulation mode if dry-run)');
    }

    const shouldProceed = reasons.length === 0;

    logger.execution(`Risk evaluation for ${token.symbol}: ${shouldProceed ? 'PASS' : 'FAIL'}`, {
      token: token.symbol,
      reasons,
      netEdge: edge.netEdge.toString(),
      netEdgeBps: edge.netEdgeBps
    });

    return { shouldProceed, reasons, edge };
  }
}
