import BigNumber from 'bignumber.js';
import { IConfigService } from '../config';
import { UnifiedEdgeCalculator, EdgeCalculationResult } from '../core/unifiedEdgeCalculator';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import { TokenConfig } from '../types/config';
import { StateManager } from '../core/stateManager';
import { ArbitrageDirection } from '../types/direction';
import logger from '../utils/logger';

export interface RiskCheckResult {
  shouldProceed: boolean;
  reasons: string[];
  edge?: EdgeCalculationResult;
}

export class RiskManager {
  private trading: any;
  private stateManager: StateManager;
  private edgeCalculator: UnifiedEdgeCalculator;
  private configService: IConfigService;

  constructor(stateManager?: StateManager, configService?: IConfigService) {
    // Use provided stateManager or the singleton instance
    this.stateManager = stateManager || StateManager.getInstance();
    // Use provided config service or create default one
    const config = configService || (require('../config').createConfigService());
    this.configService = config;
    this.trading = config.getTradingConfig();
    this.edgeCalculator = new UnifiedEdgeCalculator(config);
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
      logger.debug(`🔍 DEBUG: About to call edgeCalculator.calculateEdge() (forward)`, {
        token: token.symbol,
        solQuoteVia: token.solQuoteVia,
        solQuoteCurrency: solanaQuote.currency,
        solToGalaRate: solToGalaRate.toString()
      });
      edge = this.edgeCalculator.calculateEdge('forward', token, galaChainQuote, solanaQuote, solToGalaRate, galaUsdPrice);
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

    logger.debug(`[EXECUTION] Risk evaluation for ${token.symbol}: ${shouldProceed ? 'PASS' : 'FAIL'}`, {
      token: token.symbol,
      reasons,
      netEdge: edge.netEdge.toString(),
      netEdgeBps: edge.netEdgeBps
    });

    return { shouldProceed, reasons, edge };
  }

  /**
   * Evaluate whether a trade should proceed for a specific direction
   */
  evaluateDirection(
    token: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    solToGalaRate: BigNumber,
    direction: ArbitrageDirection,
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

    // 2) Cooldown check
    if (this.stateManager.isTokenInCooldown(token.symbol)) {
      reasons.push('Token is in cooldown');
    }

    // 3) Edge calculation and threshold (direction-aware)
    let edge: EdgeCalculationResult;
    try {
      // Use unified edge calculator with direction parameter
      edge = this.edgeCalculator.calculateEdge(
        direction,
        token,
        galaChainQuote,
        solanaQuote,
        solToGalaRate,
        galaUsdPrice
      );
    } catch (edgeError) {
      logger.error(`❌ ERROR in edge calculation for ${token.symbol} (${direction})`, {
        error: edgeError instanceof Error ? edgeError.message : String(edgeError)
      });
      throw edgeError;
    }

    // Apply direction-specific threshold
    const minEdgeBps = direction === 'reverse'
      ? (this.trading.reverseArbitrageMinEdgeBps || this.trading.minEdgeBps)
      : this.trading.minEdgeBps;

    if (!edge.isProfitable) {
      reasons.push(...edge.invalidationReasons);
    }
    if (!edge.meetsThreshold) {
      reasons.push(`Edge below threshold: ${edge.netEdgeBps}bps < ${minEdgeBps}bps`);
    }
    if (!edge.priceImpactAcceptable) {
      reasons.push('Combined price impact not acceptable');
    }

    // 4) Inventory check (direction-aware)
    const state = this.stateManager.getState() as any;
    const gcTokens = state?.inventory?.galaChain?.tokens || {};
    const solTokens = state?.inventory?.solana?.tokens || {};

    if (direction === 'reverse') {
      // REVERSE: Need GALA on GC (to buy token), Token on SOL (to sell)
      // Check GALA balance on GC
      const galaCost = galaChainQuote.price.multipliedBy(token.tradeSize);
      const galaToken = gcTokens['GALA'];
      if (galaToken && galaToken.balance) {
        const balanceBN = BigNumber.isBigNumber(galaToken.balance) 
          ? galaToken.balance 
          : new BigNumber(galaToken.balance);
        if (balanceBN.isLessThan(galaCost)) {
          reasons.push(`Insufficient GALA on GalaChain for reverse trade (have ${balanceBN.toString()}, need ${galaCost.toString()})`);
        }
      } else {
        reasons.push(`Insufficient GALA on GalaChain for reverse trade (simulation mode if dry-run)`);
      }

      // Check token balance on Solana
      const tokenBalance = solTokens[token.symbol];
      if (tokenBalance && tokenBalance.balance) {
        const balanceBN = BigNumber.isBigNumber(tokenBalance.balance)
          ? tokenBalance.balance
          : new BigNumber(tokenBalance.balance);
        const requiredAmount = new BigNumber(token.tradeSize);
        if (balanceBN.isLessThan(requiredAmount)) {
          reasons.push(`Insufficient ${token.symbol} on Solana for reverse trade (have ${balanceBN.toString()}, need ${requiredAmount.toString()})`);
        }
      } else {
        reasons.push(`Insufficient ${token.symbol} on Solana for reverse trade (simulation mode if dry-run)`);
      }
    } else {
      // FORWARD: Need token on GC (to sell), SOL/USDC on SOL (to buy)
      // Check token balance on GC
      const quoteVia = token.gcQuoteVia || 'GALA';
      let inventoryTokenSymbol: string;
      let requiredAmount: BigNumber;
      let inventoryToken: any;

      if (quoteVia === 'GALA') {
        // Selling GALA to buy token - need GALA inventory
        inventoryTokenSymbol = 'GALA';
        requiredAmount = galaChainQuote.price.multipliedBy(token.tradeSize);
        inventoryToken = gcTokens['GALA'];
      } else {
        // Selling token to get quote currency - need token inventory
        inventoryTokenSymbol = token.symbol;
        requiredAmount = new BigNumber(token.tradeSize);
        inventoryToken = gcTokens[token.symbol];
      }

      if (inventoryToken && inventoryToken.balance) {
        const balanceBN = BigNumber.isBigNumber(inventoryToken.balance)
          ? inventoryToken.balance
          : new BigNumber(inventoryToken.balance);
        if (balanceBN.isLessThan(requiredAmount)) {
          reasons.push(`Insufficient GalaChain ${inventoryTokenSymbol} inventory (have ${balanceBN.toString()}, need ${requiredAmount.toString()})`);
        }
      } else {
        reasons.push(`Insufficient GalaChain ${inventoryTokenSymbol} inventory for ${quoteVia === 'GALA' ? 'buy' : 'sell'} (simulation mode if dry-run)`);
      }
    }

    const shouldProceed = reasons.length === 0;

    logger.debug(`[EXECUTION] Risk evaluation for ${token.symbol} (${direction}): ${shouldProceed ? 'PASS' : 'FAIL'}`, {
      token: token.symbol,
      direction,
      reasons,
      netEdge: edge.netEdge.toString(),
      netEdgeBps: edge.netEdgeBps
    });

    return { shouldProceed, reasons, edge };
  }
}
