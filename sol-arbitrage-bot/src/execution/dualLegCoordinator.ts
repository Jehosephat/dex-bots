import BigNumber from 'bignumber.js';
import { initializeConfig, getTokenConfig } from '../config';
import { GalaChainPriceProvider } from '../core/priceProviders/galachain';
import { SolanaPriceProvider } from '../core/priceProviders/solana';
import { GalaChainExecutor, GalaChainExecutionResult } from './galaChainExecutor';
import { SolanaExecutor, SolanaExecutionResult } from './solanaExecutor';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import logger from '../utils/logger';

export interface DualLegDryRunResult {
  symbol: string;
  tradeSize: number;
  galaChain: GalaChainExecutionResult;
  solana: SolanaExecutionResult;
  // Simple preview of net (quote-based, not final PnL):
  previewNetGala?: BigNumber; // GC proceeds - (SOL cost converted to GALA) if known
}

export class DualLegCoordinator {
  private gcProvider: GalaChainPriceProvider;
  private solProvider: SolanaPriceProvider;
  private gcExecutor?: GalaChainExecutor;
  private solExecutor?: SolanaExecutor;

  constructor() {
    this.gcProvider = new GalaChainPriceProvider();
    this.solProvider = new SolanaPriceProvider();
  }

  /**
   * Prepare both legs (dry-run): GC sell and SOL buy for the token's configured tradeSize.
   */
  async dryRun(symbol: string): Promise<DualLegDryRunResult | null> {
    initializeConfig();
    // Instantiate executors after config is initialized to avoid early access
    if (!this.gcExecutor) this.gcExecutor = new GalaChainExecutor();
    if (!this.solExecutor) this.solExecutor = new SolanaExecutor();

    const token = getTokenConfig(symbol);
    if (!token) {
      logger.error('❌ Token not configured', { symbol });
      return null;
    }

    await this.gcProvider.initialize();
    await this.solProvider.initialize();

    const [gcQuoteGeneric, solQuoteGeneric] = await Promise.all([
      this.gcProvider.getQuote(symbol, token.tradeSize),
      this.solProvider.getQuote(symbol, token.tradeSize)
    ]);

    if (!gcQuoteGeneric || gcQuoteGeneric.currency !== 'GALA') {
      logger.warn('⚠️ Missing GalaChain quote for dual-leg', { symbol });
      return null;
    }
    if (!solQuoteGeneric) {
      logger.warn('⚠️ Missing Solana quote for dual-leg', { symbol });
      return null;
    }

    const gcQuote = gcQuoteGeneric as GalaChainQuote;
    const solQuote = solQuoteGeneric as SolanaQuote;

    // Build dry-run params
    const gc = this.gcExecutor.dryRunFromQuote(symbol, token.tradeSize, gcQuote);
    const sol = this.solExecutor.dryRunFromQuote(symbol, token.tradeSize, solQuote);

    // Basic timing guardrail: ensure both deadlines are near-future and within a small window
    const now = Date.now();
    const windowMs = 30_000; // 30s allowable window between legs
    const timingOk = gc.params.deadlineMs > now && sol.params.deadlineMs > now &&
      Math.abs(gc.params.deadlineMs - sol.params.deadlineMs) <= windowMs;

    if (!timingOk) {
      logger.warn('⚠️ Dual-leg deadlines are misaligned; consider adjusting deadlines', {
        gcDeadline: gc.params.deadlineMs,
        solDeadline: sol.params.deadlineMs
      });
    }

    // Simple net preview in GALA if quoteCurrency is USDC/SOL cannot be converted here directly.
    // For now, only compute preview if Solana quote is in GALA (unlikely) or if symbol is SOL and we have GC price per SOL.
    let previewNetGala: BigNumber | undefined;
    if (symbol === 'SOL' && gcQuote.price && solQuote.currency === 'USDC') {
      // We don't have USDC→GALA here; skip conversion.
      previewNetGala = undefined;
    }

    logger.execution('Prepared dual-leg dry-run', {
      symbol,
      tradeSize: token.tradeSize,
      timingOk
    });

    return {
      symbol,
      tradeSize: token.tradeSize,
      galaChain: gc,
      solana: sol,
      previewNetGala
    };
  }

  /**
   * Execute both legs live with simple failure handling.
   * GC sell and SOL buy are launched near-simultaneously.
   */
  async executeLive(symbol: string): Promise<{ gc: GalaChainExecutionResult; sol: SolanaExecutionResult }> {
    initializeConfig();
    if (!this.gcExecutor) this.gcExecutor = new GalaChainExecutor();
    if (!this.solExecutor) this.solExecutor = new SolanaExecutor();

    const token = getTokenConfig(symbol);
    if (!token) {
      throw new Error(`Token not configured: ${symbol}`);
    }

    // Global safety toggles
    if ((process.env.PAUSE || '').toLowerCase() === 'true') {
      throw new Error('Trading is paused via PAUSE env');
    }
    const start = process.env.TRADE_WINDOW_START || '00:00';
    const end = process.env.TRADE_WINDOW_END || '23:59';
    const nowUtc = new Date();
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const curMin = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
    const inWindow = curMin >= toMinutes(start) && curMin <= toMinutes(end);
    if (!inWindow) {
      throw new Error(`Outside TRADE_WINDOW (${start}-${end} UTC)`);
    }

    await this.gcProvider.initialize();
    await this.solProvider.initialize();

    // Fetch fresh quotes for the configured trade size
    const [gcQuoteGeneric, solQuoteGeneric] = await Promise.all([
      this.gcProvider.getQuote(symbol, token.tradeSize),
      this.solProvider.getQuote(symbol, token.tradeSize)
    ]);
    if (!gcQuoteGeneric) throw new Error('Missing GalaChain quote');
    if (!solQuoteGeneric) throw new Error('Missing Solana quote');

    const gcQuote = gcQuoteGeneric as GalaChainQuote;
    const solQuote = solQuoteGeneric as SolanaQuote;

    // Notional cap per trade (USD)
    const capStr = process.env.MAX_NOTIONAL_PER_TRADE;
    if (capStr) {
      const cap = Number(capStr);
      if (!Number.isNaN(cap) && cap > 0) {
        let notionalUsd = 0;
        if (solQuote.currency === 'USDC') {
          notionalUsd = solQuote.price.multipliedBy(token.tradeSize).toNumber();
        } else if (solQuote.currency === 'SOL') {
          const solUsd = this.solProvider.getSOLUSDPrice();
          const costSol = solQuote.price.multipliedBy(token.tradeSize).toNumber();
          notionalUsd = costSol * solUsd;
        }
        if (notionalUsd > cap) {
          throw new Error(`Per-trade notional ${notionalUsd.toFixed(2)} exceeds cap ${cap}`);
        }
      }
    }

    // Fire both legs nearly concurrently
    const [gcRes, solRes] = await Promise.allSettled([
      this.gcExecutor.executeFromQuoteLive(symbol, token.tradeSize, gcQuote),
      this.solExecutor.executeFromQuoteLive(symbol, token.tradeSize, solQuote)
    ]);

    const gc: GalaChainExecutionResult = gcRes.status === 'fulfilled' ? gcRes.value : {
      success: false,
      params: {
        symbol,
        tradeSize: token.tradeSize,
        expectedProceedsGala: new BigNumber(0),
        minProceedsGala: new BigNumber(0),
        deadlineMs: Date.now() + 60_000
      },
      error: (gcRes as PromiseRejectedResult).reason?.message || String((gcRes as PromiseRejectedResult).reason)
    };

    const sol: SolanaExecutionResult = solRes.status === 'fulfilled' ? solRes.value : {
      success: false,
      params: {
        symbol,
        tradeSize: token.tradeSize,
        quoteCurrency: solQuote.currency,
        expectedCostInQuote: new BigNumber(0),
        maxCostInQuote: new BigNumber(0),
        deadlineMs: Date.now() + 60_000
      },
      error: (solRes as PromiseRejectedResult).reason?.message || String((solRes as PromiseRejectedResult).reason)
    } as SolanaExecutionResult;

    // Simple failure handling: if one leg failed and the other succeeded, log and caller can cooldown
    if (gc.success && !sol.success) {
      logger.warn('⚠️ Dual-leg: GC succeeded but SOL failed - consider cooldown', { symbol, gcTx: gc.txHash, solError: sol.error });
    } else if (!gc.success && sol.success) {
      logger.warn('⚠️ Dual-leg: SOL succeeded but GC failed - consider cooldown', { symbol, solTx: sol.txSig, gcError: gc.error });
    }

    if (gc.success && sol.success) {
      logger.execution('✅ Dual-leg live execution complete', { symbol, gcTx: gc.txHash, solTx: sol.txSig });
    }

    return { gc, sol };
  }
}
