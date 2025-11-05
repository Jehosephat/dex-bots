import BigNumber from 'bignumber.js';
import { IConfigService } from '../config';
import { GalaChainPriceProvider } from '../core/priceProviders/galachain';
import { SolanaPriceProvider } from '../core/priceProviders/solana';
import { GalaChainExecutor, GalaChainExecutionResult } from './galaChainExecutor';
import { SolanaExecutor, SolanaExecutionResult } from './solanaExecutor';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import logger from '../utils/logger';
import { sendAlert } from '../utils/alerts';
import { getErrorHandler } from '../utils/errorHandler';
import { ExecutionError, ValidationError } from '../utils/errors';

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
  private errorHandler = getErrorHandler();

  constructor(private configService: IConfigService) {
    this.gcProvider = new GalaChainPriceProvider(configService);
    this.solProvider = new SolanaPriceProvider(configService);
  }

  /**
   * Prepare both legs (dry-run): GC sell and SOL buy for the token's configured tradeSize.
   */
  async dryRun(symbol: string): Promise<DualLegDryRunResult | null> {
    // Instantiate executors after config is initialized to avoid early access
    if (!this.gcExecutor) this.gcExecutor = new GalaChainExecutor();
    if (!this.solExecutor) this.solExecutor = new SolanaExecutor();

    const token = this.configService.getTokenConfig(symbol);
    if (!token) {
      await this.errorHandler.handleError(
        new ValidationError(`Token ${symbol} not configured`, { symbol }),
        undefined,
        undefined,
        { operation: 'dryRun', symbol }
      );
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
    if (!this.gcExecutor) this.gcExecutor = new GalaChainExecutor();
    if (!this.solExecutor) this.solExecutor = new SolanaExecutor();

    const token = this.configService.getTokenConfig(symbol);
    if (!token) {
      throw new ValidationError(`Token not configured: ${symbol}`, { symbol });
    }

    // Global safety toggles
    if ((process.env.PAUSE || '').toLowerCase() === 'true') {
      throw new ExecutionError('Trading is paused via PAUSE env', { symbol }, false);
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
      throw new ExecutionError(`Outside TRADE_WINDOW (${start}-${end} UTC)`, { symbol, start, end }, false);
    }

    await this.gcProvider.initialize();
    await this.solProvider.initialize();

    // Fetch fresh quotes for the configured trade size with error handling
    const [gcQuoteGeneric, solQuoteGeneric] = await Promise.all([
      this.errorHandler.executeWithProtection(
        () => this.gcProvider.getQuote(symbol, token.tradeSize),
        'galachain-price-provider',
        `GC quote for ${symbol}`
      ),
      this.errorHandler.executeWithProtection(
        () => this.solProvider.getQuote(symbol, token.tradeSize),
        'solana-price-provider',
        `SOL quote for ${symbol}`
      )
    ]);
    if (!gcQuoteGeneric) {
      throw new ExecutionError('Missing GalaChain quote', { symbol, tradeSize: token.tradeSize }, false);
    }
    if (!solQuoteGeneric) {
      throw new ExecutionError('Missing Solana quote', { symbol, tradeSize: token.tradeSize }, false);
    }

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
          throw new ExecutionError(
            `Per-trade notional ${notionalUsd.toFixed(2)} exceeds cap ${cap}`,
            { symbol, notionalUsd, cap },
            false
          );
        }
      }
    }

    // Fire both legs nearly concurrently with error handling
    const [gcRes, solRes] = await Promise.allSettled([
      this.errorHandler.executeWithProtection(
        () => this.gcExecutor!.executeFromQuoteLive(symbol, token.tradeSize, gcQuote),
        'galachain-executor',
        `GC execution for ${symbol}`
      ),
      this.errorHandler.executeWithProtection(
        () => this.solExecutor!.executeFromQuoteLive(symbol, token.tradeSize, solQuote),
        'solana-executor',
        `SOL execution for ${symbol}`
      )
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
      await this.errorHandler.handleError(
        new ExecutionError('Dual-leg partial success: SOL failed', { symbol, gcTx: gc.txHash, solError: sol.error }, false),
        undefined,
        undefined,
        { operation: 'executeLive', symbol, leg: 'solana' }
      );
      logger.warn('⚠️ Dual-leg: GC succeeded but SOL failed - consider cooldown', { symbol, gcTx: gc.txHash, solError: sol.error });
      sendAlert('Dual-leg partial success: SOL failed', { symbol, gcTx: gc.txHash, solError: sol.error }, 'warn').catch(() => {});
    } else if (!gc.success && sol.success) {
      await this.errorHandler.handleError(
        new ExecutionError('Dual-leg partial success: GC failed', { symbol, solTx: sol.txSig, gcError: gc.error }, false),
        undefined,
        undefined,
        { operation: 'executeLive', symbol, leg: 'galachain' }
      );
      logger.warn('⚠️ Dual-leg: SOL succeeded but GC failed - consider cooldown', { symbol, solTx: sol.txSig, gcError: gc.error });
      sendAlert('Dual-leg partial success: GC failed', { symbol, solTx: sol.txSig, gcError: gc.error }, 'warn').catch(() => {});
    }

    if (gc.success && sol.success) {
      logger.execution('✅ Dual-leg live execution complete', { symbol, gcTx: gc.txHash, solTx: sol.txSig });
      sendAlert('Dual-leg trade executed', { symbol, gcTx: gc.txHash, solTx: sol.txSig }, 'success').catch(() => {});
    }

    return { gc, sol };
  }
}
