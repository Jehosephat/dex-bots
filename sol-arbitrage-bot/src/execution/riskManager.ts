import BigNumber from 'bignumber.js';
import { IConfigService } from '../config';
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
  private trading: any;
  private stateManager: StateManager;
  private edgeCalculator: EdgeCalculator;

  constructor(stateManager?: StateManager, configService?: IConfigService) {
    this.stateManager = stateManager || new StateManager();
    // Use provided config service or create default one
    const config = configService || (require('../config').createConfigService());
    this.trading = config.getTradingConfig();
    this.edgeCalculator = new EdgeCalculator(config);
  }

  /**
   * Evaluate whether a trade should proceed based on quotes and config.
   * Requires computed SOL→GALA rate (pass from providers or calculation).
   */
  evaluate(
    token: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    solToGalaRate: BigNumber,
    galaUsdPrice?: number
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
      edge = this.edgeCalculator.calculateEdge(token, galaChainQuote, solanaQuote, solToGalaRate, galaUsdPrice);
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
    // Determine what we're selling on GalaChain based on gcQuoteVia
    const quoteVia = token.gcQuoteVia || 'GALA';
    const state = this.stateManager.getState() as any;
    const gcTokens = state?.inventory?.galaChain?.tokens || {};
    
    let inventoryTokenSymbol: string;
    let requiredAmount: BigNumber;
    let inventoryToken: any;
    
    if (quoteVia === 'GALA') {
      // Selling GALA to buy token - need GALA inventory
      inventoryTokenSymbol = 'GALA';
      // Calculate GALA needed: price * tradeSize
      // For MEW: price is GALA per MEW, so cost = price * 1500 MEW = GALA needed
      requiredAmount = galaChainQuote.price.multipliedBy(token.tradeSize);
      inventoryToken = gcTokens ? gcTokens['GALA'] : undefined;
    } else {
      // Selling token to get quote currency - need token inventory
      inventoryTokenSymbol = token.symbol;
      requiredAmount = new BigNumber(token.tradeSize);
      inventoryToken = gcTokens ? gcTokens[token.symbol] : undefined;
    }
    
    // Defensively handle balance - ensure it's a BigNumber
    if (inventoryToken && inventoryToken.balance) {
      let balanceBN: BigNumber;
      try {
        if (BigNumber.isBigNumber(inventoryToken.balance)) {
          balanceBN = inventoryToken.balance;
        } else {
          // Convert to BigNumber if it's not already one
          balanceBN = new BigNumber(inventoryToken.balance);
          // Update the state with the converted value
          inventoryToken.balance = balanceBN;
        }
        
        if (balanceBN.isLessThan(requiredAmount)) {
          reasons.push(`Insufficient GalaChain ${inventoryTokenSymbol} inventory (have ${balanceBN.toString()}, need ${requiredAmount.toString()})`);
        }
      } catch (balanceError) {
        logger.warn(`⚠️ Failed to check inventory balance for ${inventoryTokenSymbol}`, {
          error: balanceError instanceof Error ? balanceError.message : String(balanceError),
          balanceType: typeof inventoryToken.balance,
          balanceValue: inventoryToken.balance
        });
        reasons.push(`Unable to verify GalaChain ${inventoryTokenSymbol} inventory balance`);
      }
    } else {
      reasons.push(`Insufficient GalaChain ${inventoryTokenSymbol} inventory for ${quoteVia === 'GALA' ? 'buy' : 'sell'} (simulation mode if dry-run)`);
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
