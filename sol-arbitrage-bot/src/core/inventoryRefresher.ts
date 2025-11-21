import BigNumber from 'bignumber.js';
import axios from 'axios';
import { PublicKey, Connection } from '@solana/web3.js';
import { AccountLayout } from '@solana/spl-token';
import logger from '../utils/logger';
import { getEnabledTokens, getQuoteTokenBySymbol } from '../config';
import { StateManager } from './stateManager';
import { GalaConnectClient } from '../bridging/galaConnectClient';
import { resolveGalaEndpoints } from '../bridging/galaEndpoints';

export class InventoryRefresher {
  private state: StateManager;
  private gcClient: GalaConnectClient | null = null;

  constructor(stateManager?: StateManager) {
    // Use provided stateManager or the singleton instance
    this.state = stateManager || StateManager.getInstance();
    // Defer client init until refresh to access env comfortably
    this.gcClient = null;
  }

  async refreshAll(): Promise<void> {
    // Ensure default structure exists; if not, reset once
    try {
      const s = this.state.getState() as any;
      if (!s.inventory || !s.inventory.galaChain || !s.inventory.solana) {
        (this.state as any).resetInventory?.();
      }
    } catch {}
    await Promise.all([this.refreshGalaChain(), this.refreshSolana()]);
    // State manager auto-saves; no direct setState API. Chain updates are done in sub-methods.
    try { this.state.forceSave(); } catch {}
    logger.info('✅ Inventory refreshed');
  }

  private async refreshGalaChain(): Promise<void> {
    try {
      const owner = process.env.GALACHAIN_WALLET_ADDRESS;
      if (!owner) {
        logger.warn('GALACHAIN_WALLET_ADDRESS not set; skipping GC inventory');
        return;
      }
      if (!this.gcClient) {
        const ep = resolveGalaEndpoints();
        this.gcClient = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, owner);
      }
      const resp = (await this.gcClient.fetchBalances()) as any;

      const st = this.state.getState() as any;
      const current = st.inventory && st.inventory.galaChain ? st.inventory.galaChain : {
        tokens: {},
        native: new BigNumber(0),
        totalValueUsd: new BigNumber(0),
        lastUpdated: Date.now()
      };
      const tokens: Record<string, any> = { ...current.tokens };
      const enabled = getEnabledTokens();
      // Include core base tokens even if not in enabled trade set
      const baseSymbols = ['GALA', 'GUSDC'];
      const virtualBaseTokens = baseSymbols
        .filter(sym => !enabled.find(t => t.symbol === sym))
        .map(sym => {
          const qt = getQuoteTokenBySymbol(sym);
          return qt ? { symbol: sym, galaChainMint: `${sym}|Unit|none|none`, decimals: qt.decimals } : null;
        })
        .filter(Boolean) as Array<{ symbol: string; galaChainMint: string; decimals: number }>;
      const iterable = [...enabled, ...virtualBaseTokens];
      // Normalize balances payload: support { balances: [...] }, { data: { balances: [...] } }, or { Data: [...] }
      const balancesList = Array.isArray(resp?.balances)
        ? resp.balances
        : Array.isArray(resp?.data?.balances)
          ? resp.data.balances
          : Array.isArray(resp?.Data)
            ? resp.Data
            : undefined;
      for (const token of iterable) {
        const [collection, category, type] = token.galaChainMint.split('|');
        const prefix = [collection, category, type].join('|');
        let match: any | undefined;
        if (Array.isArray(balancesList)) {
          match = balancesList.find((b: any) => {
            // Shapes:
            // - { tokenInstance: 'GUSDC|Unit|none|none|<instance>', balance: '...' }
            // - { token: 'GUSDC|Unit|none|none', balance: '...' }
            // - { collection: 'GUSDC', category: 'Unit', type: 'none', quantity: '...' }
            const tokenInst = (b.tokenInstance || b.token) as string | undefined;
            if (tokenInst && tokenInst.startsWith(prefix)) return true;
            if (b.collection && b.category && typeof b.type !== 'undefined') {
              const key3 = `${b.collection}|${b.category}|${b.type}`;
              return key3 === prefix;
            }
            return false;
          });
        }
        const rawStr = (match?.balance ?? match?.quantity ?? '0').toString();
        const raw = new BigNumber(rawStr);
        const balance = raw; // GC API returns human amounts for fungible tokens
        tokens[token.symbol] = {
          symbol: token.symbol,
          mint: token.galaChainMint,
          rawBalance: raw,
          balance,
          decimals: token.decimals,
          valueUsd: new BigNumber(0),
          lastUpdated: Date.now()
        };
      }
      this.state.updateChainInventory('galaChain', {
        tokens: tokens as any,
        native: current.native,
        totalValueUsd: new BigNumber(0),
        lastUpdated: Date.now()
      } as any);
      logger.info('✅ GalaChain inventory updated', { count: Object.keys(tokens).length, symbols: Object.keys(tokens) });
    } catch (e) {
      logger.warn('⚠️ Failed to refresh GalaChain balances', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async refreshSolana(): Promise<void> {
    try {
      const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const walletAddress = process.env.SOLANA_WALLET_ADDRESS;
      if (!walletAddress) {
        logger.warn('SOLANA_WALLET_ADDRESS not set; skipping Solana inventory');
        return;
      }
      const conn = new Connection(rpc, 'confirmed');
      const owner = new PublicKey(walletAddress);
      const lamports = await conn.getBalance(owner);

      const st = this.state.getState() as any;
      const current = st.inventory && st.inventory.solana ? st.inventory.solana : {
        tokens: {},
        native: new BigNumber(0),
        totalValueUsd: new BigNumber(0),
        lastUpdated: Date.now()
      };
      const native = new BigNumber(lamports).dividedBy(1e9);

      const tokens: Record<string, any> = { ...current.tokens };
      const enabled = getEnabledTokens();
      const quoteTokens = ['GALA', 'SOL', 'USDC'];
      
      // Create a list of all tokens to check (enabled + quote tokens)
      const tokensToCheck: Array<{ symbol: string; solanaMint: string; decimals: number }> = [];
      
      // Add enabled tokens
      enabled.forEach(token => {
        if (token.solanaMint) {
          tokensToCheck.push({
            symbol: token.symbol,
            solanaMint: token.solanaMint,
            decimals: token.decimals
          });
        }
      });
      
      // Add quote tokens (skip SOL since it's native)
      quoteTokens.forEach(symbol => {
        if (symbol === 'SOL') return; // Skip SOL - it's already shown as native
        const qt = getQuoteTokenBySymbol(symbol);
        if (qt && qt.solanaMint) {
          // Only add if not already in enabled tokens
          if (!tokensToCheck.find(t => t.symbol === symbol)) {
            tokensToCheck.push({
              symbol,
              solanaMint: qt.solanaMint,
              decimals: qt.decimals
            });
          }
        }
      });
      
      let rpcScanWorked = true;
      try {
        for (const token of tokensToCheck) {
          if (!token.solanaMint) continue;
          try {
            const mint = new PublicKey(token.solanaMint);
            const accounts = await conn.getTokenAccountsByOwner(owner, { mint });
            let raw = new BigNumber(0);
            for (const acc of accounts.value) {
              const data = acc.account.data as Buffer;
              const decoded: any = AccountLayout.decode(data);
              const amountU64: Buffer = decoded.amount as Buffer;
              const amountBig = amountU64.readBigUInt64LE(0);
              raw = raw.plus(new BigNumber(amountBig.toString()));
            }
            const balance = raw.dividedBy(new BigNumber(10).pow(token.decimals));
            // Always store the token, even if balance is 0
            tokens[token.symbol] = {
              symbol: token.symbol,
              mint: token.solanaMint,
              rawBalance: raw,
              balance,
              decimals: token.decimals,
              valueUsd: new BigNumber(0),
              lastUpdated: Date.now()
            };
            logger.debug(`Stored Solana balance for ${token.symbol}: ${balance.toString()}`);
          } catch (tokenErr) {
            logger.debug(`Failed to fetch balance for ${token.symbol} on Solana: ${tokenErr instanceof Error ? tokenErr.message : String(tokenErr)}`);
            // Store 0 balance if fetch fails
            tokens[token.symbol] = {
              symbol: token.symbol,
              mint: token.solanaMint,
              rawBalance: new BigNumber(0),
              balance: new BigNumber(0),
              decimals: token.decimals,
              valueUsd: new BigNumber(0),
              lastUpdated: Date.now()
            };
          }
        }
      } catch (scanErr) {
        rpcScanWorked = false;
        logger.warn('⚠️ SPL scan via RPC failed, attempting indexer fallbacks', { error: scanErr instanceof Error ? scanErr.message : String(scanErr) });

        // 1) Helius balances (if available)
        const heliusKey = process.env.HELIUS_API_KEY;
        if (heliusKey) {
          try {
            const heliusUrl = `https://api.helius.xyz/v0/addresses/${owner.toBase58()}/balances?api-key=${heliusKey}`;
            const { data } = await axios.get(heliusUrl, { timeout: 15000, headers: { accept: 'application/json' } });
            const items: any[] = Array.isArray(data?.tokens) ? data.tokens : [];
            for (const token of tokensToCheck) {
              if (!token.solanaMint) continue;
              const entry = items.find((t: any) => t?.mint === token.solanaMint);
              if (!entry) continue;
              const amountStr = (entry?.amount || 0).toString();
              const decimals = Number.isFinite(entry?.decimals) ? entry.decimals : token.decimals;
              const raw = new BigNumber(amountStr);
              const balance = raw.dividedBy(new BigNumber(10).pow(decimals));
              tokens[token.symbol] = {
                symbol: token.symbol,
                mint: token.solanaMint,
                rawBalance: raw,
                balance,
                decimals,
                valueUsd: new BigNumber(0),
                lastUpdated: Date.now()
              };
            }
          } catch (e) {
            logger.warn('⚠️ Helius fallback failed', { error: e instanceof Error ? e.message : String(e) });
          }
        }

        // 2) Solscan fallbacks (public-api → api) with headers and simple retry
        try {
          if (Object.keys(tokens).length === 0) {
            const bases = [
              process.env.SOLSCAN_BASE || 'https://public-api.solscan.io',
              'https://api.solscan.io'
            ];
            let data: any = null;
            for (const base of bases) {
              try {
                const url = `${base}/account/tokens?account=${owner.toBase58()}`;
                const res = await axios.get(url, { timeout: 15000, headers: { accept: 'application/json' } });
                data = res.data;
                if (Array.isArray(data)) break;
              } catch (e) {
                // try next base
                continue;
              }
            }
            if (Array.isArray(data)) {
              for (const token of tokensToCheck) {
                if (!token.solanaMint) continue;
                const entry = data.find((t: any) => t.tokenAddress === token.solanaMint || t.mintAddress === token.solanaMint);
                if (!entry) continue;
                const amountStr = entry.tokenAmount?.amount ?? entry.amount ?? '0';
                const decimals = entry.tokenAmount?.decimals ?? token.decimals;
                const raw = new BigNumber(amountStr);
                const balance = raw.dividedBy(new BigNumber(10).pow(decimals));
                tokens[token.symbol] = {
                  symbol: token.symbol,
                  mint: token.solanaMint,
                  rawBalance: raw,
                  balance,
                  decimals,
                  valueUsd: new BigNumber(0),
                  lastUpdated: Date.now()
                };
              }
            } else {
              logger.warn('⚠️ Solscan responses not usable');
            }
          }
        } catch (solscanErr) {
          logger.warn('⚠️ Solscan fallback failed', { error: solscanErr instanceof Error ? solscanErr.message : String(solscanErr) });
        }
      }
      this.state.updateChainInventory('solana', {
        tokens: tokens as any,
        native,
        totalValueUsd: new BigNumber(0),
        lastUpdated: Date.now()
      } as any);
      logger.info('✅ Solana inventory updated', { count: Object.keys(tokens).length });
    } catch (e) {
      logger.warn('⚠️ Failed to refresh Solana balances', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}
