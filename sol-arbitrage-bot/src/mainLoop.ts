import BigNumber from 'bignumber.js';
import logger from './utils/logger';
import { initializeConfig, getEnabledTokens, getTradingConfig } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { RiskManager } from './execution/riskManager';
import { DualLegCoordinator } from './execution/dualLegCoordinator';
import { GalaChainQuote, SolanaQuote } from './types/core';
import { sendAlert } from './utils/alerts';

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

  await gcProvider.initialize();
  await solProvider.initialize();

  let anyExecuted = false;

  for (const token of enabled) {
    try {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 EVALUATING: ${token.symbol} | Trade Size: ${token.tradeSize}`);

      // Fetch quotes
      const [gcQ, solQ] = await Promise.all([
        gcProvider.getQuote(token.symbol, token.tradeSize),
        solProvider.getQuote(token.symbol, token.tradeSize)
      ]);
      
      if (!gcQ || !solQ) {
        logger.warn('⚠️ Missing quote(s), skipping token', { 
          token: token.symbol,
          hasGcQuote: !!gcQ,
          hasSolQuote: !!solQ
        });
        continue;
      }

      const galaQuote = gcQ as GalaChainQuote;
      const solQuote = solQ as SolanaQuote;

      // Log prices found with explicit chain labels
      const gcProceeds = galaQuote.price.multipliedBy(token.tradeSize);
      const solCost = solQuote.price.multipliedBy(token.tradeSize);
      
      logger.info(`\n💰 MARKET PRICES`);
      logger.info(`   🔷 GalaChain (SELL)`);
      logger.info(`      Price:    ${galaQuote.price.toFixed(8)} ${galaQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Proceeds: ${gcProceeds.toFixed(8)} ${galaQuote.currency}`);
      logger.info(`      Impact:   ${galaQuote.priceImpactBps.toFixed(2)} bps`);
      logger.info(`   🔸 Solana (BUY)`);
      logger.info(`      Price:    ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`      Cost:     ${solCost.toFixed(8)} ${solQuote.currency}`);
      logger.info(`      Impact:   ${solQuote.priceImpactBps.toFixed(2)} bps`);

      // Calculate conversion rate from Solana quote currency to GALA
      let quoteToGalaRate = new BigNumber(0);
      try {
        if (solQuote.currency === 'SOL') {
          const solUsd = solProvider.getSOLUSDPrice();
          const galaUsd = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01; // fallback
          if (solUsd > 0 && galaUsd > 0) {
            // SOL to GALA: SOL_USD / GALA_USD
            quoteToGalaRate = new BigNumber(solUsd).div(galaUsd);
            logger.info(`\n💱 EXCHANGE RATE`);
            logger.info(`   1 SOL = ${quoteToGalaRate.toFixed(4)} GALA`);
            logger.info(`   1 SOL = $${solUsd.toFixed(4)} USD`);
            logger.info(`   1 GALA = $${galaUsd.toFixed(4)} USD`);
          }
        } else if (solQuote.currency === 'USDC') {
          // For USDC: 1 USDC ≈ $1 USD, so USDC to GALA = 1 / GALA_USD
          const galaUsd = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01; // fallback
          if (galaUsd > 0) {
            quoteToGalaRate = new BigNumber(1).div(galaUsd);
            logger.info(`\n💱 EXCHANGE RATE`);
            logger.info(`   1 USDC = ${quoteToGalaRate.toFixed(4)} GALA`);
            logger.info(`   (Assumption: 1 USDC = $1 USD)`);
            logger.info(`   1 GALA = $${galaUsd.toFixed(4)} USD`);
          }
        } else {
          logger.warn(`⚠️ Unknown quote currency: ${solQuote.currency}, using zero rate`);
        }
      } catch (rateError) {
        logger.error('❌ Failed to calculate conversion rate', { 
          currency: solQuote.currency,
          error: rateError instanceof Error ? rateError.message : String(rateError)
        });
      }

      // Validate rate before proceeding
      if (quoteToGalaRate.isZero() || quoteToGalaRate.isNaN()) {
        logger.warn(`⚠️ Invalid conversion rate (${quoteToGalaRate.toString()}), skipping edge calculation for ${token.symbol}`);
        logger.info(`${'━'.repeat(60)}\n`);
        continue;
      }

      // Risk evaluation (includes edge calculation)
      // Note: passing quoteToGalaRate which handles both SOL and USDC conversions
      let riskResult;
      try {
        riskResult = risk.evaluate(token, galaQuote, solQuote, quoteToGalaRate);
      } catch (evalError) {
        logger.error(`❌ ERROR in risk.evaluate() for ${token.symbol}`, {
          error: evalError instanceof Error ? evalError.message : String(evalError),
          stack: evalError instanceof Error ? evalError.stack : undefined,
          token: token.symbol,
          solQuoteVia: token.solQuoteVia,
          solQuoteCurrency: solQuote.currency
        });
        logger.info(`${'━'.repeat(60)}\n`);
        continue;
      }

      // Log detailed edge calculation if available
      if (riskResult.edge) {
        const edge = riskResult.edge;
        const tradingConfig = getTradingConfig();
        const isProfitable = edge.isProfitable;
        const meetsThreshold = edge.meetsThreshold;
        const impactAcceptable = edge.priceImpactAcceptable;
        
        logger.info(`\n🧮 EDGE CALCULATION`);
        logger.info(`   📥 INCOME:`);
        logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);
        logger.info(`   📤 COSTS:`);
        logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA (${solCost.toFixed(8)} ${solQuote.currency})`);
        logger.info(`      🌉 Bridge Cost:         ${edge.bridgeCost.toFixed(8)} GALA`);
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
      if (!riskResult.shouldProceed) {
        logger.info(`❌ DECISION: DO NOT TRADE ${token.symbol}`);
        logger.info(`\n   Reasons:`);
        riskResult.reasons.forEach((reason, i) => {
          logger.info(`   ${i + 1}. ${reason}`);
        });
      } else {
        logger.info(`✅ DECISION: PROCEED WITH TRADE ${token.symbol}`);
        logger.info(`   Mode:     ${runMode === 'live' ? '🚀 LIVE TRADING' : '🧪 DRY-RUN'}`);
        logger.info(`   Size:     ${token.tradeSize} ${token.symbol}`);
        logger.info(`   Strategy: 🔷 SELL on GalaChain → 🔸 BUY on Solana`);
        if (riskResult.edge) {
          logger.info(`   Expected Edge: ${riskResult.edge.netEdge.toFixed(8)} GALA (${riskResult.edge.netEdgeBps.toFixed(2)} bps)`);
        }
      }
      logger.info(`${'═'.repeat(60)}\n`);
      
      if (!riskResult.shouldProceed) {
        continue;
      }

      if (runMode === 'live') {
        const { gc, sol } = await coord.executeLive(token.symbol);
        if (gc.success && sol.success) {
          anyExecuted = true;
          logger.info(`\n🎉 TRADE EXECUTED SUCCESSFULLY`);
          logger.info(`   Token: ${token.symbol}`);
          logger.info(`   🔷 GalaChain (SELL): ✅ Success`);
          logger.info(`      TX Hash: ${gc.txHash}`);
          logger.info(`   🔸 Solana (BUY): ✅ Success`);
          logger.info(`      TX Signature: ${sol.txSig}`);
        } else if (!gc.success && !sol.success) {
          logger.error(`\n❌ BOTH LEGS FAILED`);
          logger.error(`   Token: ${token.symbol}`);
          logger.error(`   🔷 GalaChain (SELL): ❌ Failed`);
          logger.error(`      Error: ${gc.error}`);
          logger.error(`   🔸 Solana (BUY): ❌ Failed`);
          logger.error(`      Error: ${sol.error}`);
          sendAlert('Dual-leg trade failed', { token: token.symbol, gcError: gc.error, solError: sol.error }, 'error').catch(() => {});
        } else {
          logger.warn(`\n⚠️ PARTIAL SUCCESS`);
          logger.warn(`   Token: ${token.symbol}`);
          logger.warn(`   🔷 GalaChain (SELL): ${gc.success ? '✅ Success' : '❌ Failed'}`);
          if (gc.success && gc.txHash) {
            logger.warn(`      TX Hash: ${gc.txHash}`);
          }
          if (!gc.success && gc.error) {
            logger.warn(`      Error: ${gc.error}`);
          }
          logger.warn(`   🔸 Solana (BUY): ${sol.success ? '✅ Success' : '❌ Failed'}`);
          if (sol.success && sol.txSig) {
            logger.warn(`      TX Signature: ${sol.txSig}`);
          }
          if (!sol.success && sol.error) {
            logger.warn(`      Error: ${sol.error}`);
          }
        }
      } else {
        await coord.dryRun(token.symbol);
        logger.info(`🧪 DRY-RUN completed`, {
          token: token.symbol,
          note: 'No actual trades executed - simulation only',
          strategy: `Would SELL on GalaChain and BUY on Solana`
        });
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


