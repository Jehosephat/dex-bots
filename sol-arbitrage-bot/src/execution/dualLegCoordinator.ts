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
}
