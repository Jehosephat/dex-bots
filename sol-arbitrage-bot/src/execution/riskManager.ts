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
    const edge = this.edgeCalculator.calculateEdge(token, galaChainQuote, solanaQuote, solToGalaRate);
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
    const gcTokens = this.stateManager.getState().inventory.galaChain && (this.stateManager.getState().inventory.galaChain as any).tokens
      ? (this.stateManager.getState().inventory.galaChain as any).tokens
      : {} as Record<string, any>;
    const gcToken = gcTokens[token.symbol];
    if (!gcToken || !gcToken.balance || gcToken.balance.isLessThan(token.tradeSize)) {
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
