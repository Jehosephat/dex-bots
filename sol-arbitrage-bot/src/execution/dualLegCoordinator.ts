import BigNumber from 'bignumber.js';
import { IConfigService } from '../config';
import { GalaChainPriceProvider } from '../core/priceProviders/galachain';
import { SolanaPriceProvider } from '../core/priceProviders/solana';
import { GalaChainExecutor, GalaChainExecutionResult } from './galaChainExecutor';
import { SolanaExecutor, SolanaExecutionResult } from './solanaExecutor';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import { ArbitrageDirection } from '../types/direction';
import logger from '../utils/logger';
import { sendAlert, sendSolanaTradeAlert } from '../utils/alerts';
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
  async dryRun(symbol: string, direction: ArbitrageDirection = 'forward'): Promise<DualLegDryRunResult | null> {
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

    const reverse = direction === 'reverse';
    const [gcQuoteGeneric, solQuoteGeneric] = await Promise.all([
      this.gcProvider.getQuote(symbol, token.tradeSize, reverse),
      this.solProvider.getQuote(symbol, token.tradeSize, reverse)
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
   * Uses quotes from evaluation (with strategy-specific quote currencies).
   * GC sell and SOL buy are launched sequentially (Solana first).
   */
  async executeLive(
    symbol: string, 
    direction: ArbitrageDirection = 'forward',
    gcQuote?: GalaChainQuote,
    solQuote?: SolanaQuote
  ): Promise<{ gc: GalaChainExecutionResult; sol: SolanaExecutionResult }> {
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

    // Use quotes from evaluation if provided (they contain strategy-specific quote currencies)
    // Otherwise, fall back to fetching fresh quotes (for backward compatibility)
    let finalGcQuote: GalaChainQuote;
    let finalSolQuote: SolanaQuote;
    
    if (gcQuote && solQuote) {
      // Use provided quotes from strategy evaluation (correct quote currencies)
      finalGcQuote = gcQuote;
      finalSolQuote = solQuote;
      logger.debug(`Using evaluation quotes: GC=${finalGcQuote.currency}, SOL=${finalSolQuote.currency}`);
    } else {
      // Fallback: fetch fresh quotes (for backward compatibility)
      const reverse = direction === 'reverse';
      const [gcQuoteGeneric, solQuoteGeneric] = await Promise.all([
        this.errorHandler.executeWithProtection(
          () => this.gcProvider.getQuote(symbol, token.tradeSize, reverse),
          'galachain-price-provider',
          `GC quote for ${symbol} (${direction})`
        ),
        this.errorHandler.executeWithProtection(
          () => this.solProvider.getQuote(symbol, token.tradeSize, reverse),
          'solana-price-provider',
          `SOL quote for ${symbol} (${direction})`
        )
      ]);
      if (!gcQuoteGeneric) {
        throw new ExecutionError('Missing GalaChain quote', { symbol, tradeSize: token.tradeSize }, false);
      }
      if (!solQuoteGeneric) {
        throw new ExecutionError('Missing Solana quote', { symbol, tradeSize: token.tradeSize }, false);
      }

      finalGcQuote = gcQuoteGeneric as GalaChainQuote;
      finalSolQuote = solQuoteGeneric as SolanaQuote;
    }

    // Notional cap per trade (USD)
    const capStr = process.env.MAX_NOTIONAL_PER_TRADE;
    if (capStr) {
      const cap = Number(capStr);
      if (!Number.isNaN(cap) && cap > 0) {
        let notionalUsd = 0;
        if (finalSolQuote.currency === 'USDC') {
          notionalUsd = finalSolQuote.price.multipliedBy(token.tradeSize).toNumber();
        } else if (finalSolQuote.currency === 'SOL') {
          const solUsd = this.solProvider.getSOLUSDPrice();
          const costSol = finalSolQuote.price.multipliedBy(token.tradeSize).toNumber();
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

    // Execute sequentially: Solana first, then GalaChain
    // This ensures Solana confirms before executing GalaChain, reducing risk of one-sided trades
    // For reverse: SELL on SOL first, then BUY on GC
    // For forward: BUY on SOL first, then SELL on GC
    
    logger.info(`🔄 Executing Solana leg first (${direction} direction)...`);
    let sol: SolanaExecutionResult;
    try {
      sol = await this.errorHandler.executeWithProtection(
        () => {
          if (direction === 'reverse') {
            // Reverse: SELL on Solana
            return this.solExecutor!.executeSellFromQuoteLive(symbol, token.tradeSize, finalSolQuote);
          } else {
            // Forward: BUY on Solana
            return this.solExecutor!.executeFromQuoteLive(symbol, token.tradeSize, finalSolQuote);
          }
        },
        'solana-executor',
        `SOL execution for ${symbol} (${direction})`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Solana execution failed before GalaChain execution`, { symbol, error: errorMessage });
      sol = {
        success: false,
        params: {
          symbol,
          tradeSize: token.tradeSize,
          quoteCurrency: finalSolQuote.currency,
          expectedCostInQuote: new BigNumber(0),
          maxCostInQuote: new BigNumber(0),
          deadlineMs: Date.now() + 60_000
        },
        error: errorMessage
      } as SolanaExecutionResult;
    }

    // If Solana failed, don't execute GalaChain to avoid one-sided trades
    if (!sol.success) {
      logger.warn(`⚠️ Solana execution failed - skipping GalaChain execution to prevent one-sided trade`, {
        symbol,
        solError: sol.error
      });
      const gc: GalaChainExecutionResult = {
        success: false,
        params: {
          symbol,
          tradeSize: token.tradeSize,
          expectedProceedsGala: new BigNumber(0),
          minProceedsGala: new BigNumber(0),
          deadlineMs: Date.now() + 60_000
        },
        error: 'Skipped - Solana execution failed first'
      };
      
      await this.errorHandler.handleError(
        new ExecutionError('Dual-leg execution aborted: SOL failed', { symbol, solError: sol.error }, false),
        undefined,
        undefined,
        { operation: 'executeLive', symbol, leg: 'solana' }
      );
      sendAlert('Dual-leg execution aborted: SOL failed', { symbol, solError: sol.error }, 'error').catch(() => {});
      
      return { gc, sol };
    }

    // Solana succeeded - proceed with GalaChain execution
    logger.info(`✅ Solana execution succeeded - proceeding with GalaChain execution...`);
    let gc: GalaChainExecutionResult;
    try {
      gc = await this.errorHandler.executeWithProtection(
        () => {
          if (direction === 'reverse') {
            // Reverse: BUY on GalaChain
            return this.gcExecutor!.executeBuyFromQuoteLive(symbol, token.tradeSize, finalGcQuote);
          } else {
            // Forward: SELL on GalaChain
            return this.gcExecutor!.executeFromQuoteLive(symbol, token.tradeSize, finalGcQuote);
          }
        },
        'galachain-executor',
        `GC execution for ${symbol} (${direction})`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ GalaChain execution failed after Solana succeeded`, {
        symbol,
        solTx: sol.txSig,
        error: errorMessage
      });
      gc = {
        success: false,
        params: {
          symbol,
          tradeSize: token.tradeSize,
          expectedProceedsGala: new BigNumber(0),
          minProceedsGala: new BigNumber(0),
          deadlineMs: Date.now() + 60_000
        },
        error: errorMessage
      };
    }

    // Handle partial success: Solana succeeded but GalaChain failed
    if (!gc.success && sol.success) {
      await this.errorHandler.handleError(
        new ExecutionError('Dual-leg partial success: GC failed after SOL succeeded', { symbol, solTx: sol.txSig, gcError: gc.error }, false),
        undefined,
        undefined,
        { operation: 'executeLive', symbol, leg: 'galachain' }
      );
      logger.warn('⚠️ Dual-leg: SOL succeeded but GC failed - one-sided trade risk', { symbol, solTx: sol.txSig, gcError: gc.error });
      sendAlert('Dual-leg partial success: GC failed', { symbol, solTx: sol.txSig, gcError: gc.error }, 'warn').catch(() => {});
    }
    // Note: If Solana failed, we already handled it above and skipped GalaChain execution

    if (gc.success && sol.success) {
      logger.execution('✅ Dual-leg live execution complete', { symbol, gcTx: gc.txHash, solTx: sol.txSig });
      
      // Build detailed trade information for notification
      const isReverse = direction === 'reverse';
      const gcAction = isReverse ? 'BUY' : 'SELL';
      const solAction = isReverse ? 'SELL' : 'BUY';
      
      // Format amounts for display
      // GALA amounts are already in human-readable units (not raw)
      const formatGala = (amount: BigNumber) => {
        return amount.toFixed(8).replace(/\.?0+$/, '');
      };
      
      // Get quote token decimals for proper formatting
      const quoteTokenConfig = this.configService.getQuoteTokenConfig(sol.params.quoteCurrency);
      const quoteDecimals = quoteTokenConfig?.decimals || (sol.params.quoteCurrency === 'SOL' ? 9 : 6);
      
      // Format quote currency amounts
      // For FORWARD: expectedCostInQuote is already human-readable (from quote.price * tradeSize)
      // For REVERSE: expectedCostInQuote is in raw units (from Jupiter API outAmount)
      const formatQuote = (amount: BigNumber, isRaw: boolean) => {
        if (isRaw) {
          // Convert from raw units to human-readable
          const humanReadable = amount.dividedBy(new BigNumber(10).pow(quoteDecimals));
          return humanReadable.toFixed(quoteDecimals).replace(/\.?0+$/, '');
        } else {
          // Already human-readable, just format
          return amount.toFixed(quoteDecimals).replace(/\.?0+$/, '');
        }
      };
      
      // GalaChain side details
      const gcAmount = token.tradeSize;
      const gcCurrency = 'GALA';
      
      // Solana side details
      const solAmount = token.tradeSize;
      const solCurrency = sol.params.quoteCurrency;
      
      // Build human-readable trade description
      let gcDescription: string;
      let solDescription: string;
      
      if (isReverse) {
        // REVERSE: BUY on GC (spend GALA), SELL on SOL (receive quote currency)
        // expectedProceedsGala is the cost (spent GALA) - already human-readable
        // expectedCostInQuote is proceeds (received quote) - in RAW units (from Jupiter API)
        const gcSpent = gc.params.expectedProceedsGala;
        const solReceived = sol.params.expectedCostInQuote;
        gcDescription = `BUY ${gcAmount} ${symbol} → Spent ${formatGala(gcSpent)} ${gcCurrency}`;
        solDescription = `SELL ${solAmount} ${symbol} → Received ${formatQuote(solReceived, true)} ${solCurrency}`;
      } else {
        // FORWARD: SELL on GC (receive GALA), BUY on SOL (spend quote currency)
        // expectedProceedsGala is proceeds (received GALA) - already human-readable
        // expectedCostInQuote is cost (spent quote) - already HUMAN-READABLE (from quote.price * tradeSize)
        const gcReceived = gc.params.expectedProceedsGala;
        const solSpent = sol.params.expectedCostInQuote;
        gcDescription = `SELL ${gcAmount} ${symbol} → Received ${formatGala(gcReceived)} ${gcCurrency}`;
        solDescription = `BUY ${solAmount} ${symbol} → Spent ${formatQuote(solSpent, false)} ${solCurrency}`;
      }
      
      const alertPayload: Record<string, unknown> = {
        symbol,
        direction: direction.toUpperCase(),
        'GalaChain': gcDescription,
        'Solana': solDescription,
        gcTx: gc.txHash || 'N/A',
        solTx: sol.txSig || 'N/A'
      };
      
      sendAlert('Dual-leg trade executed', alertPayload, 'success').catch(() => {});
      
      // Send separate Solana-only formatted message
      if (sol.success && sol.txSig) {
        const solanaWalletAddress = process.env.SOLANA_WALLET_ADDRESS;
        
        // Determine token in/out and amounts for Solana side
        let tokenIn: string;
        let amountIn: string;
        let tokenOut: string;
        let amountOut: string;
        
        if (isReverse) {
          // REVERSE: SELL token on Solana, receive quote currency
          tokenIn = symbol;
          amountIn = solAmount.toString();
          tokenOut = solCurrency;
          amountOut = formatQuote(sol.params.expectedCostInQuote, true); // Received quote (raw units)
        } else {
          // FORWARD: BUY token on Solana, spend quote currency
          tokenIn = solCurrency;
          amountIn = formatQuote(sol.params.expectedCostInQuote, false); // Spent quote (human-readable)
          tokenOut = symbol;
          amountOut = solAmount.toString();
        }
        
        sendSolanaTradeAlert(
          tokenIn,
          amountIn,
          tokenOut,
          amountOut,
          sol.txSig,
          solanaWalletAddress
        ).catch((err) => {
          logger.warn('Failed to send Solana trade alert', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    }

    return { gc, sol };
  }
}
