import BigNumber from 'bignumber.js';
import axios from 'axios';
import bs58 from 'bs58';
import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';
import { SolanaQuote } from '../types/core';
import { getTradingConfig, getTokenConfig, getQuoteTokenConfig, initializeConfig } from '../config';
import logger from '../utils/logger';

export interface SolanaExecutionParams {
  symbol: string;
  tradeSize: number;
  quoteCurrency: string; // e.g., USDC, SOL
  expectedCostInQuote: BigNumber; // cost per trade size in quote currency
  maxCostInQuote: BigNumber; // slippage-protected max cost
  route?: any;
  deadlineMs: number;
}

export interface SolanaExecutionResult {
  success: boolean;
  params: SolanaExecutionParams;
  txSig?: string;
  error?: string;
}

export class SolanaExecutor {
  private readonly maxSlippageBps: number;
  private readonly dynamicSlippageMaxMultiplier: number;
  private readonly dynamicSlippageEdgeRatio: number;
  private readonly defaultDeadlineSeconds = 60;
  private readonly jupiterApiBases = [
    process.env.JUPITER_API_BASE || 'https://lite-api.jup.ag/swap/v1'
  ];
  private connection?: Connection;
  private wallet?: Keypair;

  constructor() {
    const trading = getTradingConfig();
    this.maxSlippageBps = trading.maxSlippageBps;
    this.dynamicSlippageMaxMultiplier = trading.dynamicSlippageMaxMultiplier ?? 2.0;
    this.dynamicSlippageEdgeRatio = trading.dynamicSlippageEdgeRatio ?? 0.75;
  }

  /**
   * Calculate dynamic slippage tolerance based on expected edge
   * Formula: min(maxSlippageBps * multiplier, edgeBps * edgeRatio) with floor of maxSlippageBps
   * This allows higher slippage tolerance for trades with larger edges
   */
  private calculateDynamicSlippageBps(edgeBps?: number): number {
    if (!edgeBps || edgeBps <= 0) {
      return this.maxSlippageBps; // Use base slippage if no edge info
    }

    // Calculate slippage based on edge: allow up to edgeRatio% of edge as slippage
    // Cap at multiplier * base slippage tolerance, floor at base slippage tolerance
    const edgeBasedSlippage = edgeBps * this.dynamicSlippageEdgeRatio;
    const maxAllowedSlippage = this.maxSlippageBps * this.dynamicSlippageMaxMultiplier;
    
    const dynamicSlippage = Math.max(
      this.maxSlippageBps, // Floor: always at least base slippage
      Math.min(maxAllowedSlippage, edgeBasedSlippage) // Cap: never more than multiplier * base
    );

    return Math.round(dynamicSlippage);
  }

  /**
   * Prepare execution parameters for a buy on Solana using SolanaQuote.
   * This is a dry-run only; no on-chain submission.
   */
  dryRunFromQuote(symbol: string, tradeSize: number, quote: SolanaQuote): SolanaExecutionResult {
    try {
      // expected cost = price (quoteCurrency per token) * trade size
      const expectedCostInQuote = quote.price.multipliedBy(tradeSize);
      // For buys, we cap the max spend (slippage): maxCost = expected * (1 + slippage)
      const maxCostInQuote = expectedCostInQuote.multipliedBy(new BigNumber(1).plus(this.maxSlippageBps / 10000));

      const params: SolanaExecutionParams = {
        symbol,
        tradeSize,
        quoteCurrency: quote.currency,
        expectedCostInQuote,
        maxCostInQuote,
        route: quote.jupiterRoute,
        deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
      };

      logger.execution(`Prepared SOL execution params for ${symbol}`, {
        symbol,
        tradeSize,
        quoteCurrency: quote.currency,
        expectedCostInQuote: expectedCostInQuote.toString(),
        maxCostInQuote: maxCostInQuote.toString(),
        deadline: params.deadlineMs
      });

      return { success: true, params };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to build SOL execution params', { symbol, error: errorMessage });
      return {
        success: false,
        params: {
          symbol,
          tradeSize,
          quoteCurrency: quote.currency,
          expectedCostInQuote: new BigNumber(0),
          maxCostInQuote: new BigNumber(0),
          deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
        },
        error: errorMessage
      };
    }
  }

  /**
   * Execute a live buy on Solana using Jupiter based on a prior SolanaQuote.
   * Uses ExactOut mode to purchase "tradeSize" amount of the output token.
   */
  async executeFromQuoteLive(symbol: string, tradeSize: number, quote: SolanaQuote, edgeBps?: number): Promise<SolanaExecutionResult> {
    // Ensure config is initialized in case caller didn't
    try { initializeConfig(); } catch {}

    // Calculate dynamic slippage based on expected edge
    const slippageBps = this.calculateDynamicSlippageBps(edgeBps);
    
    const params: SolanaExecutionParams = {
      symbol,
      tradeSize,
      quoteCurrency: quote.currency,
      expectedCostInQuote: quote.price.multipliedBy(tradeSize),
      maxCostInQuote: quote.price.multipliedBy(tradeSize).multipliedBy(new BigNumber(1).plus(slippageBps / 10000)),
      route: quote.jupiterRoute,
      deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
    };
    
    logger.execution('📊 Dynamic slippage calculation (Solana BUY)', {
      symbol,
      baseSlippageBps: this.maxSlippageBps,
      edgeBps: edgeBps || 'N/A',
      dynamicSlippageBps: slippageBps,
      expectedCost: params.expectedCostInQuote.toString(),
      maxCost: params.maxCostInQuote.toString()
    });

    try {
      // Setup connection and wallet
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const priv = process.env.SOLANA_PRIVATE_KEY;
      if (!priv) {
        throw new Error('SOLANA_PRIVATE_KEY not set');
      }
      this.connection = new Connection(rpcUrl, 'confirmed');
      const secret = bs58.decode(priv);
      this.wallet = Keypair.fromSecretKey(secret);

      // Determine mints and decimals
      // IMPORTANT: Use quote.currency from the quote (which respects strategy overrides), not tokenCfg.solQuoteVia
      const tokenCfg = getTokenConfig(symbol);
      if (!tokenCfg?.solanaMint) throw new Error(`No Solana mint for token ${symbol}`);
      const quoteCurrency = quote.currency || tokenCfg.solQuoteVia || 'SOL';
      const quoteCfg = getQuoteTokenConfig(quoteCurrency);
      if (!quoteCfg?.solanaMint) throw new Error(`No Solana mint for quote token ${quoteCurrency}`);

      // For BUY operations (forward trades): always spend quote currency to get token
      // DO NOT use quote.jupiterRoute for mints - it may be from a reverse quote!
      const inputMint = quoteCfg.solanaMint; // quote currency (what we're spending)
      const outputMint = tokenCfg.solanaMint; // target token (what we're buying)

      // Use ExactOut: request to buy "tradeSize" output tokens
      const outAmountRaw = new BigNumber(tradeSize).multipliedBy(new BigNumber(10).pow(tokenCfg.decimals)).integerValue(BigNumber.ROUND_DOWN).toString();

      // Fresh quote (ExactOut) with fallback hosts
      let quoteRes: any;
      let lastErr: any;
      for (const base of this.jupiterApiBases) {
        try {
          quoteRes = await axios.get(`${base}/quote`, {
            params: {
              inputMint,
              outputMint,
              amount: outAmountRaw,
              slippageBps: slippageBps,
              swapMode: 'ExactOut'
            },
            timeout: 15000
          });
          logger.debug('Jupiter /quote OK', { base });
          break;
        } catch (e) {
          lastErr = e;
          logger.warn('Jupiter /quote failed on host', { base, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!quoteRes?.data) throw (lastErr || new Error('All Jupiter /quote hosts failed'));

      // Build swap transaction (fallback hosts)
      let swapRes: any;
      for (const base of this.jupiterApiBases) {
        try {
          swapRes = await axios.post(`${base}/swap`, {
            quoteResponse: quoteRes.data,
            userPublicKey: this.wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto'
          }, { timeout: 20000 });
          logger.debug('Jupiter /swap OK', { base });
          break;
        } catch (e) {
          lastErr = e;
          logger.warn('Jupiter /swap failed on host', { base, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!swapRes?.data) throw (lastErr || new Error('All Jupiter /swap hosts failed'));

      const swapTxB64 = swapRes.data?.swapTransaction;
      if (!swapTxB64) throw new Error('No swapTransaction returned by Jupiter');

      // Deserialize, sign, send
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTxB64, 'base64'));
      tx.sign([this.wallet]);
      const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const conf = await this.connection.confirmTransaction(sig, 'confirmed');
      if (conf.value.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);

      logger.execution('✅ Solana swap executed', { symbol, signature: sig, rpcUrl });
      return { success: true, params, txSig: sig };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('❌ Solana live execution failed', { symbol, error: message });
      return { success: false, params, error: message };
    }
  }

  /**
   * Execute a live token→USDC/SOL sell using Jupiter.
   * REVERSE: Sell token to get quote currency
   */
  async executeSellFromQuoteLive(
    symbol: string,
    tradeSize: number,
    quote: SolanaQuote,
    edgeBps?: number
  ): Promise<SolanaExecutionResult> {
    // Calculate dynamic slippage based on expected edge
    const slippageBps = this.calculateDynamicSlippageBps(edgeBps);
    
    const params: SolanaExecutionParams = {
      symbol,
      tradeSize,
      quoteCurrency: quote.currency,
      expectedCostInQuote: new BigNumber(0), // For reverse, this is proceeds
      maxCostInQuote: new BigNumber(0),
      route: quote.jupiterRoute,
      deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
    };
    
    logger.execution('📊 Dynamic slippage calculation (Solana SELL)', {
      symbol,
      baseSlippageBps: this.maxSlippageBps,
      edgeBps: edgeBps || 'N/A',
      dynamicSlippageBps: slippageBps
    });

    try {
      // Setup connection and wallet (same as executeFromQuoteLive)
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const priv = process.env.SOLANA_PRIVATE_KEY;
      if (!priv) {
        throw new Error('SOLANA_PRIVATE_KEY not set');
      }
      this.connection = new Connection(rpcUrl, 'confirmed');
      const secret = bs58.decode(priv);
      this.wallet = Keypair.fromSecretKey(secret);

      // Determine mints
      // IMPORTANT: Use quote.currency from the quote (which respects strategy overrides), not tokenCfg.solQuoteVia
      const tokenCfg = getTokenConfig(symbol);
      if (!tokenCfg?.solanaMint) throw new Error(`No Solana mint for token ${symbol}`);
      const quoteCurrency = quote.currency || tokenCfg.solQuoteVia || 'SOL';
      const quoteCfg = getQuoteTokenConfig(quoteCurrency);
      if (!quoteCfg?.solanaMint) throw new Error(`No Solana mint for quote token ${quoteCurrency}`);

      // For SELL operations (reverse trades): always sell token to get quote currency
      // DO NOT use quote.jupiterRoute for mints - it may be from a forward quote!
      const inputMint = tokenCfg.solanaMint; // token (what we're selling)
      const outputMint = quoteCfg.solanaMint; // quote currency (what we're receiving)

      // Use ExactIn: sell exact amount of token
      const inAmountRaw = new BigNumber(tradeSize)
        .multipliedBy(new BigNumber(10).pow(tokenCfg.decimals))
        .integerValue(BigNumber.ROUND_DOWN)
        .toString();

      // Get quote (ExactIn mode)
      let quoteRes: any;
      let lastErr: any;
      for (const base of this.jupiterApiBases) {
        try {
          quoteRes = await axios.get(`${base}/quote`, {
            params: {
              inputMint,
              outputMint,
              amount: inAmountRaw,
              slippageBps: slippageBps,
              swapMode: 'ExactIn' // REVERSE: selling exact amount
            },
            timeout: 15000
          });
          logger.debug('Jupiter /quote OK (REVERSE)', { base });
          break;
        } catch (e) {
          lastErr = e;
          logger.warn('Jupiter /quote failed on host', { base, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!quoteRes?.data) throw (lastErr || new Error('All Jupiter /quote hosts failed'));

      const expectedProceeds = new BigNumber(quoteRes.data.outAmount);
      const minProceeds = expectedProceeds.multipliedBy(1 - this.maxSlippageBps / 10000);

      params.expectedCostInQuote = expectedProceeds; // For reverse, this is proceeds
      params.maxCostInQuote = expectedProceeds.multipliedBy(1 + this.maxSlippageBps / 10000);

      // Build and execute swap (same as executeFromQuoteLive)
      let swapRes: any;
      for (const base of this.jupiterApiBases) {
        try {
          swapRes = await axios.post(`${base}/swap`, {
            quoteResponse: quoteRes.data,
            userPublicKey: this.wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto'
          }, { timeout: 20000 });
          logger.debug('Jupiter /swap OK (REVERSE)', { base });
          break;
        } catch (e) {
          lastErr = e;
          logger.warn('Jupiter /swap failed on host', { base, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!swapRes?.data) throw (lastErr || new Error('All Jupiter /swap hosts failed'));

      const swapTxB64 = swapRes.data?.swapTransaction;
      if (!swapTxB64) throw new Error('No swapTransaction returned by Jupiter');

      // Deserialize, sign, send
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTxB64, 'base64'));
      tx.sign([this.wallet]);
      const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const conf = await this.connection.confirmTransaction(sig, 'confirmed');
      if (conf.value.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);

      logger.execution('✅ Solana sell executed (REVERSE)', { 
        symbol, 
        signature: sig,
        tokensSold: tradeSize,
        proceeds: expectedProceeds.toString()
      });
      return { success: true, params, txSig: sig };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('❌ Solana sell execution failed (REVERSE)', { symbol, error: message });
      return { success: false, params, error: message };
    }
  }
}
