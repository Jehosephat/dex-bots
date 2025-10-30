import BigNumber from 'bignumber.js';
import logger from './utils/logger';
import { initializeConfig, getEnabledTokens } from './config';
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
      const [gcQ, solQ] = await Promise.all([
        gcProvider.getQuote(token.symbol, token.tradeSize),
        solProvider.getQuote(token.symbol, token.tradeSize)
      ]);
      if (!gcQ || !solQ) {
        logger.warn('⚠️ Missing quote(s), skipping token', { token: token.symbol });
        continue;
      }

      const galaQuote = gcQ as GalaChainQuote;
      const solQuote = solQ as SolanaQuote;

      // Approximate SOL→GALA rate if Solana quote currency is SOL using SOL/USD and a GALA/USD proxy from GC
      let solToGala = new BigNumber(0);
      if (solQuote.currency === 'SOL') {
        const solUsd = solProvider.getSOLUSDPrice();
        // Use GalaChain quote of GALA itself if present; fallback to 0 to force fail
        const galaUsd = 1; // placeholder if we later add a direct GALA/USD feed
        if (solUsd > 0 && galaUsd > 0) solToGala = new BigNumber(solUsd / galaUsd);
      }

      const riskResult = risk.evaluate(token, galaQuote, solQuote, solToGala);
      if (!riskResult.shouldProceed) {
        logger.info('⛔ Risk gate blocked trade', { token: token.symbol, reasons: riskResult.reasons });
        continue;
      }

      if (runMode === 'live') {
        const { gc, sol } = await coord.executeLive(token.symbol);
        if (gc.success && sol.success) {
          anyExecuted = true;
        } else if (!gc.success && !sol.success) {
          sendAlert('Dual-leg trade failed', { token: token.symbol, gcError: gc.error, solError: sol.error }, 'error').catch(() => {});
        }
      } else {
        await coord.dryRun(token.symbol);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('❌ Error in main cycle for token', { token: token.symbol, error: msg });
    }
  }

  return anyExecuted;
}


