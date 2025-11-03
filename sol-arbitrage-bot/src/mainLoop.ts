import BigNumber from 'bignumber.js';
import logger from './utils/logger';
import { initializeConfig, getEnabledTokens, getTradingConfig } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { RiskManager } from './execution/riskManager';
import { DualLegCoordinator } from './execution/dualLegCoordinator';
import { GalaChainQuote, SolanaQuote } from './types/core';
import { sendAlert } from './utils/alerts';
import { getTradeLogger } from './utils/tradeLogger';
import { ReverseEdgeCalculator } from './core/reverseEdgeCalculator';
import { EdgeCalculationResult } from './core/edgeCalculator';

export async function runMainCycle(runMode: 'live' | 'dry_run' = 'dry_run'): Promise<boolean> {
  initializeConfig();

  const enabled = getEnabledTokens();
  if (enabled.length === 0) {
    logger.warn('⚠️ No enabled tokens');
    return false;
  }

  const gcProvider = new GalaChainPriceProvider();
  const solProvider = new SolanaPriceProvider();
  const risk = new RiskManager();
  const coord = new DualLegCoordinator();
  const reverseEdgeCalc = new ReverseEdgeCalculator();
  const tradingConfig = getTradingConfig();
  const enableReverse = tradingConfig.enableReverseArbitrage !== false; // Default to true if not set
  const arbitrageDirection = tradingConfig.arbitrageDirection || 'best';
  
  // Get stateManager for cooldown checks
  const stateManager = (risk as any).stateManager;

  await gcProvider.initialize();
  await solProvider.initialize();

  let anyExecuted = false;

  for (const token of enabled) {
    try {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 EVALUATING: ${token.symbol} | Trade Size: ${token.tradeSize}`);

      // Fetch quotes for FORWARD direction (SELL GC → BUY SOL)
      const [gcQForward, solQForward] = await Promise.all([
        gcProvider.getQuote(token.symbol, token.tradeSize, false), // Selling token on GC
        solProvider.getQuote(token.symbol, token.tradeSize, false)  // Buying token on SOL
      ]);
      
      // Fetch quotes for REVERSE direction if enabled (BUY GC → SELL SOL)
      let gcQReverse: GalaChainQuote | null = null;
      let solQReverse: SolanaQuote | null = null;
      if (enableReverse && arbitrageDirection !== 'forward') {
        try {
          const [gcRev, solRev] = await Promise.all([
            gcProvider.getQuote(token.symbol, token.tradeSize, true), // Buying token on GC
            solProvider.getQuote(token.symbol, token.tradeSize, true)  // Selling token on SOL
          ]);
          gcQReverse = gcRev as GalaChainQuote | null;
          solQReverse = solRev as SolanaQuote | null;
        } catch (reverseQuoteError) {
          logger.debug(`⚠️ Failed to get reverse quotes for ${token.symbol}`, { 
            error: reverseQuoteError instanceof Error ? reverseQuoteError.message : String(reverseQuoteError)
          });
        }
      }
      
      // Check if we have at least forward quotes
      if (!gcQForward || !solQForward) {
        logger.warn('⚠️ Missing forward quote(s), skipping token', { 
          token: token.symbol,
          hasGcQuote: !!gcQForward,
          hasSolQuote: !!solQForward
        });
        continue;
      }

      const galaQuoteForward = gcQForward as GalaChainQuote;
      const solQuoteForward = solQForward as SolanaQuote;

      // Calculate conversion rate from Solana quote currency to GALA (used for both directions)
      let quoteToGalaRate = new BigNumber(0);
      let galaUsdPrice = 0.01;
      try {
        // Use forward quote currency to determine rate (should be same for reverse)
        const quoteCurrency = solQuoteForward.currency;
        if (quoteCurrency === 'SOL') {
          const solUsd = solProvider.getSOLUSDPrice();
          galaUsdPrice = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01;
          if (solUsd > 0 && galaUsdPrice > 0) {
            quoteToGalaRate = new BigNumber(solUsd).div(galaUsdPrice);
          }
        } else if (quoteCurrency === 'USDC') {
          galaUsdPrice = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01;
          if (galaUsdPrice > 0) {
            quoteToGalaRate = new BigNumber(1).div(galaUsdPrice);
          }
        }
      } catch (rateError) {
        logger.error('❌ Failed to calculate conversion rate', { 
          error: rateError instanceof Error ? rateError.message : String(rateError)
        });
      }

      if (quoteToGalaRate.isZero() || quoteToGalaRate.isNaN()) {
        logger.warn(`⚠️ Invalid conversion rate, skipping ${token.symbol}`);
        logger.info(`${'━'.repeat(60)}\n`);
        continue;
      }

      // Evaluate FORWARD direction (SELL GC → BUY SOL)
      let forwardRiskResult;
      try {
        forwardRiskResult = risk.evaluate(token, galaQuoteForward, solQuoteForward, quoteToGalaRate, galaUsdPrice);
      } catch (evalError) {
        logger.error(`❌ ERROR in forward risk.evaluate() for ${token.symbol}`, { error: evalError });
        forwardRiskResult = { shouldProceed: false, reasons: ['Evaluation error'], edge: undefined };
      }

      // Evaluate REVERSE direction if enabled (BUY GC → SELL SOL)
      let reverseRiskResult: any = null;
      if (enableReverse && arbitrageDirection !== 'forward' && gcQReverse && solQReverse) {
        try {
          const reverseEdge = reverseEdgeCalc.calculateReverseEdge(
            token,
            gcQReverse as GalaChainQuote,
            solQReverse as SolanaQuote,
            quoteToGalaRate,
            galaUsdPrice
          );
          
          // Basic risk check for reverse (reuse same logic but with reverse edge)
          const reverseReasons: string[] = [];
          if (Math.abs(gcQReverse.priceImpactBps) > tradingConfig.maxPriceImpactBps) {
            reverseReasons.push(`GalaChain price impact too high: ${gcQReverse.priceImpactBps}bps`);
          }
          if (Math.abs(solQReverse.priceImpactBps) > tradingConfig.maxPriceImpactBps) {
            reverseReasons.push(`Solana price impact too high: ${solQReverse.priceImpactBps}bps`);
          }
          if (stateManager?.isTokenInCooldown?.(token.symbol)) {
            reverseReasons.push('Token is in cooldown');
          }
          if (!reverseEdge.isProfitable) {
            reverseReasons.push(...reverseEdge.invalidationReasons);
          }
          const reverseMinEdge = tradingConfig.reverseArbitrageMinEdgeBps || tradingConfig.minEdgeBps;
          if (!reverseEdge.meetsThreshold) {
            reverseReasons.push(`Edge below threshold: ${reverseEdge.netEdgeBps}bps < ${reverseMinEdge}bps`);
          }
          
          reverseRiskResult = {
            shouldProceed: reverseReasons.length === 0,
            reasons: reverseReasons,
            edge: reverseEdge,
            direction: 'reverse' as const
          };
        } catch (reverseError) {
          logger.debug(`⚠️ Failed to evaluate reverse direction for ${token.symbol}`, { error: reverseError });
        }
      }

      // Log prices for FORWARD direction
      const gcProceedsForward = galaQuoteForward.price.multipliedBy(token.tradeSize);
      const solCostForward = solQuoteForward.price.multipliedBy(token.tradeSize);
      
      logger.info(`\n💰 MARKET PRICES (FORWARD: SELL GC → BUY SOL)`);
      logger.info(`   🔷 GalaChain (SELL)`);
      logger.info(`      Price:    ${galaQuoteForward.price.toFixed(8)} ${galaQuoteForward.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Proceeds: ${gcProceedsForward.toFixed(8)} ${galaQuoteForward.currency}`);
      logger.info(`      Impact:   ${galaQuoteForward.priceImpactBps.toFixed(2)} bps`);
      logger.info(`   🔸 Solana (BUY)`);
      logger.info(`      Price:    ${solQuoteForward.price.toFixed(8)} ${solQuoteForward.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Cost:     ${solCostForward.toFixed(8)} ${solQuoteForward.currency}`);
      logger.info(`      Impact:   ${solQuoteForward.priceImpactBps.toFixed(2)} bps`);

      // Log prices for REVERSE direction if available
      if (gcQReverse && solQReverse) {
        const gcCostReverse = (gcQReverse as GalaChainQuote).price.multipliedBy(token.tradeSize);
        const solProceedsReverse = (solQReverse as SolanaQuote).price.multipliedBy(token.tradeSize);
        
        logger.info(`\n💰 MARKET PRICES (REVERSE: BUY GC → SELL SOL)`);
        logger.info(`   🔷 GalaChain (BUY)`);
        logger.info(`      Price:    ${(gcQReverse as GalaChainQuote).price.toFixed(8)} ${(gcQReverse as GalaChainQuote).currency} per ${token.symbol}`);
        logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
        logger.info(`      Cost:     ${gcCostReverse.toFixed(8)} ${(gcQReverse as GalaChainQuote).currency}`);
        logger.info(`      Impact:   ${(gcQReverse as GalaChainQuote).priceImpactBps.toFixed(2)} bps`);
        logger.info(`   🔸 Solana (SELL)`);
        logger.info(`      Price:    ${(solQReverse as SolanaQuote).price.toFixed(8)} ${(solQReverse as SolanaQuote).currency} per ${token.symbol}`);
        logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
        logger.info(`      Proceeds: ${solProceedsReverse.toFixed(8)} ${(solQReverse as SolanaQuote).currency}`);
        logger.info(`      Impact:   ${(solQReverse as SolanaQuote).priceImpactBps.toFixed(2)} bps`);
      }
      
      // Determine which direction to use
      let selectedDirection: 'forward' | 'reverse' | null = null;
      let selectedRiskResult: any = null;
      let selectedGalaQuote: GalaChainQuote = galaQuoteForward; // Initialize with forward
      let selectedSolQuote: SolanaQuote = solQuoteForward; // Initialize with forward
      
      // Mark forward result with direction
      if (forwardRiskResult) {
        (forwardRiskResult as any).direction = 'forward';
      }

      if (arbitrageDirection === 'forward') {
        // Force forward direction
        selectedDirection = 'forward';
        selectedRiskResult = forwardRiskResult;
        selectedGalaQuote = galaQuoteForward;
        selectedSolQuote = solQuoteForward;
      } else if (arbitrageDirection === 'reverse') {
        // Force reverse direction
        if (reverseRiskResult && reverseRiskResult.shouldProceed) {
          selectedDirection = 'reverse';
          selectedRiskResult = reverseRiskResult;
          selectedGalaQuote = gcQReverse as GalaChainQuote;
          selectedSolQuote = solQReverse as SolanaQuote;
        } else {
          logger.info(`⚠️ Reverse direction forced but not profitable, skipping ${token.symbol}`);
          logger.info(`${'━'.repeat(60)}\n`);
          continue;
        }
      } else {
        // 'best' mode: choose direction with best edge
        const forwardEdge = forwardRiskResult?.edge?.netEdgeBps || -Infinity;
        const reverseEdge = reverseRiskResult?.edge?.netEdgeBps || -Infinity;
        
        logger.info(`\n🔀 DIRECTION COMPARISON`);
        logger.info(`   📈 FORWARD Edge:  ${forwardEdge !== -Infinity ? forwardEdge.toFixed(2) : 'N/A'} bps ${forwardRiskResult?.shouldProceed ? '✅' : '❌'}`);
        logger.info(`   📉 REVERSE Edge:  ${reverseEdge !== -Infinity ? reverseEdge.toFixed(2) : 'N/A'} bps ${reverseRiskResult?.shouldProceed ? '✅' : '❌'}`);
        
        if (forwardRiskResult?.shouldProceed && (!reverseRiskResult?.shouldProceed || forwardEdge >= reverseEdge)) {
          selectedDirection = 'forward';
          selectedRiskResult = forwardRiskResult;
          selectedGalaQuote = galaQuoteForward;
          selectedSolQuote = solQuoteForward;
          logger.info(`   🎯 SELECTED: FORWARD (${forwardEdge.toFixed(2)} bps)`);
        } else if (reverseRiskResult?.shouldProceed && (!forwardRiskResult?.shouldProceed || reverseEdge > forwardEdge)) {
          selectedDirection = 'reverse';
          selectedRiskResult = reverseRiskResult;
          selectedGalaQuote = gcQReverse as GalaChainQuote;
          selectedSolQuote = solQReverse as SolanaQuote;
          logger.info(`   🎯 SELECTED: REVERSE (${reverseEdge.toFixed(2)} bps)`);
        } else {
          selectedDirection = null;
          logger.info(`   ⏸️  NO PROFITABLE DIRECTION`);
        }
      }

      // If no direction selected, skip token
      if (!selectedDirection || !selectedRiskResult) {
        logger.info(`❌ DECISION: DO NOT TRADE ${token.symbol} (no profitable direction)`);
        if (forwardRiskResult) {
          logger.info(`\n   Forward reasons:`);
          forwardRiskResult.reasons.forEach((r: string, i: number) => logger.info(`   ${i + 1}. ${r}`));
        }
        if (reverseRiskResult) {
          logger.info(`\n   Reverse reasons:`);
          reverseRiskResult.reasons.forEach((r: string, i: number) => logger.info(`   ${i + 1}. ${r}`));
        }
        logger.info(`${'═'.repeat(60)}\n`);
        continue;
      }

      // Log detailed edge calculation for selected direction
      if (selectedRiskResult.edge) {
        const edge = selectedRiskResult.edge;
        const isProfitable = edge.isProfitable;
        const meetsThreshold = edge.meetsThreshold;
        const impactAcceptable = edge.priceImpactAcceptable;
        
        logger.info(`\n🧮 EDGE CALCULATION (${selectedDirection.toUpperCase()})`);
        if (selectedDirection === 'forward') {
          logger.info(`   📥 INCOME:`);
          logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);
          logger.info(`   📤 COSTS:`);
          const solCostSelected = selectedSolQuote.price.multipliedBy(token.tradeSize);
          logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA (${solCostSelected.toFixed(8)} ${selectedSolQuote.currency})`);
        } else {
          logger.info(`   📥 INCOME:`);
          logger.info(`      🔸 Solana Proceeds:    ${edge.galaChainProceeds.toFixed(8)} GALA`);
          logger.info(`   📤 COSTS:`);
          logger.info(`      🔷 GalaChain Cost:      ${edge.solanaCostGala.toFixed(8)} GALA`);
        }
        logger.info(`      🌉 Bridge Cost (amort): ${edge.bridgeCost.toFixed(8)} GALA (amortized per trade)`);
        logger.info(`      🛡️  Risk Buffer:        ${edge.riskBuffer.toFixed(8)} GALA`);
        logger.info(`      ────────────────────────────`);
        logger.info(`      💰 Total Cost:         ${edge.totalCost.toFixed(8)} GALA`);
        logger.info(`   ════════════════════════════════`);
        logger.info(`   💵 NET EDGE:              ${edge.netEdge.toFixed(8)} GALA (${edge.netEdgeBps.toFixed(2)} bps)`);
        const minEdge = selectedDirection === 'reverse' ? (tradingConfig.reverseArbitrageMinEdgeBps || tradingConfig.minEdgeBps) : tradingConfig.minEdgeBps;
        logger.info(`   📊 Threshold:             ${minEdge} bps minimum`);
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
      if (!selectedRiskResult.shouldProceed) {
        logger.info(`❌ DECISION: DO NOT TRADE ${token.symbol}`);
        logger.info(`\n   Reasons:`);
        selectedRiskResult.reasons.forEach((reason: string, i: number) => {
          logger.info(`   ${i + 1}. ${reason}`);
        });
      } else {
        logger.info(`✅ DECISION: PROCEED WITH TRADE ${token.symbol}`);
        logger.info(`   Mode:     ${runMode === 'live' ? '🚀 LIVE TRADING' : '🧪 DRY-RUN'}`);
        logger.info(`   Size:     ${token.tradeSize} ${token.symbol}`);
        logger.info(`   Direction: ${selectedDirection === 'forward' ? '🔷 SELL on GalaChain → 🔸 BUY on Solana' : '🔷 BUY on GalaChain → 🔸 SELL on Solana'}`);
        if (selectedRiskResult.edge) {
          logger.info(`   Expected Edge: ${selectedRiskResult.edge.netEdge.toFixed(8)} GALA (${selectedRiskResult.edge.netEdgeBps.toFixed(2)} bps)`);
        }
      }
      logger.info(`${'═'.repeat(60)}\n`);
      
      if (!selectedRiskResult.shouldProceed) {
        continue;
      }

      // Get trade logger
      const tradeLogger = getTradeLogger();
      const startTime = Date.now();

      // Prepare log entry with expected values
      const edge = selectedRiskResult.edge;
      const selectedSolCost = selectedSolQuote.price.multipliedBy(token.tradeSize);
      const logEntry: any = {
        timestamp: new Date().toISOString(),
        mode: runMode,
        token: token.symbol,
        tradeSize: token.tradeSize,
        direction: selectedDirection,
        success: false,
        expectedGalaChainProceeds: selectedDirection === 'forward' ? (edge ? edge.galaChainProceeds.toNumber() : undefined) : undefined,
        expectedGalaChainCost: selectedDirection === 'reverse' ? (edge ? edge.solanaCostGala.toNumber() : undefined) : undefined,
        expectedSolanaCost: selectedDirection === 'forward' ? selectedSolCost.toNumber() : undefined,
        expectedSolanaProceeds: selectedDirection === 'reverse' ? selectedSolCost.toNumber() : undefined,
        expectedSolanaCostGala: selectedDirection === 'forward' ? (edge ? edge.solanaCostGala.toNumber() : undefined) : undefined,
        expectedSolanaProceedsGala: selectedDirection === 'reverse' ? (edge ? edge.galaChainProceeds.toNumber() : undefined) : undefined,
        expectedNetEdge: edge ? edge.netEdge.toNumber() : undefined,
        expectedNetEdgeBps: edge ? edge.netEdgeBps : undefined,
        galaChainPrice: selectedGalaQuote.price.toNumber(),
        galaChainPriceCurrency: selectedGalaQuote.currency,
        solanaPrice: selectedSolQuote.price.toNumber(),
        solanaPriceCurrency: selectedSolQuote.currency,
        priceImpactGcBps: selectedGalaQuote.priceImpactBps,
        priceImpactSolBps: selectedSolQuote.priceImpactBps
      };

      if (runMode === 'live') {
        // TODO: Implement reverse execution when reverse direction is selected
        // For now, only forward direction execution is supported
        if (selectedDirection === 'reverse') {
          logger.warn(`⚠️ Reverse execution not yet implemented, skipping live trade`);
          logger.info(`   Would execute: BUY ${token.symbol} on GalaChain → SELL ${token.symbol} on Solana`);
          logEntry.executionDurationMs = Date.now() - startTime;
          logEntry.success = false;
          logEntry.galaChainError = 'Reverse execution not implemented';
          tradeLogger.logTrade(logEntry);
          continue;
        }
        
        const { gc, sol } = await coord.executeLive(token.symbol);
        const endTime = Date.now();
        logEntry.executionDurationMs = endTime - startTime;
        logEntry.galaChainSuccess = gc.success;
        logEntry.solanaSuccess = sol.success;
        logEntry.success = gc.success && sol.success;

        const gcAction = selectedDirection === 'forward' ? 'SELL' : 'BUY';
        const solAction = selectedDirection === 'forward' ? 'BUY' : 'SELL';

        if (gc.success && sol.success) {
          anyExecuted = true;
          logEntry.galaChainTxHash = gc.txHash;
          logEntry.solanaTxSig = sol.txSig;
          
          logger.info(`\n🎉 TRADE EXECUTED SUCCESSFULLY`);
          logger.info(`   Token: ${token.symbol}`);
          logger.info(`   Direction: ${selectedDirection.toUpperCase()}`);
          logger.info(`   🔷 GalaChain (${gcAction}): ✅ Success`);
          logger.info(`      TX Hash: ${gc.txHash}`);
          logger.info(`   🔸 Solana (${solAction}): ✅ Success`);
          logger.info(`      TX Signature: ${sol.txSig}`);
          
          // Note: Actual values would need to be extracted from execution results
          // For now, we log expected values. Can enhance later if execution results provide actuals.
        } else if (!gc.success && !sol.success) {
          logEntry.galaChainError = gc.error;
          logEntry.solanaError = sol.error;
          
          logger.error(`\n❌ BOTH LEGS FAILED`);
          logger.error(`   Token: ${token.symbol}`);
          logger.error(`   🔷 GalaChain (${gcAction}): ❌ Failed`);
          logger.error(`      Error: ${gc.error}`);
          logger.error(`   🔸 Solana (${solAction}): ❌ Failed`);
          logger.error(`      Error: ${sol.error}`);
          sendAlert('Dual-leg trade failed', { token: token.symbol, direction: selectedDirection, gcError: gc.error, solError: sol.error }, 'error').catch(() => {});
        } else {
          logEntry.galaChainTxHash = gc.success ? gc.txHash : undefined;
          logEntry.solanaTxSig = sol.success ? sol.txSig : undefined;
          logEntry.galaChainError = !gc.success ? gc.error : undefined;
          logEntry.solanaError = !sol.success ? sol.error : undefined;
          
          logger.warn(`\n⚠️ PARTIAL SUCCESS`);
          logger.warn(`   Token: ${token.symbol}`);
          logger.warn(`   🔷 GalaChain (${gcAction}): ${gc.success ? '✅ Success' : '❌ Failed'}`);
          if (gc.success && gc.txHash) {
            logger.warn(`      TX Hash: ${gc.txHash}`);
          }
          if (!gc.success && gc.error) {
            logger.warn(`      Error: ${gc.error}`);
          }
          logger.warn(`   🔸 Solana (${solAction}): ${sol.success ? '✅ Success' : '❌ Failed'}`);
          if (sol.success && sol.txSig) {
            logger.warn(`      TX Signature: ${sol.txSig}`);
          }
          if (!sol.success && sol.error) {
            logger.warn(`      Error: ${sol.error}`);
          }
        }
        
        // Log the trade
        tradeLogger.logTrade(logEntry);
        
      } else {
        await coord.dryRun(token.symbol);
        logEntry.executionDurationMs = Date.now() - startTime;
        
        const strategy = selectedDirection === 'forward' 
          ? 'Would SELL on GalaChain and BUY on Solana'
          : 'Would BUY on GalaChain and SELL on Solana';
        
        logger.info(`🧪 DRY-RUN completed`, {
          token: token.symbol,
          direction: selectedDirection,
          note: 'No actual trades executed - simulation only',
          strategy
        });
        
        // Log dry-run trades too
        tradeLogger.logTrade(logEntry);
      }

      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('❌ Error in main cycle for token', { token: token.symbol, error: msg });
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }
  }

  return anyExecuted;
}


