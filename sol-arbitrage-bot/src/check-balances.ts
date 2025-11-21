/**
 * Balance Checker Script
 * 
 * Checks and displays balances on both GalaChain and Solana chains.
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import { GalaConnectClient } from './bridging/galaConnectClient';
import { resolveGalaEndpoints } from './bridging/galaEndpoints';
import { initializeConfig, getEnabledTokens, getQuoteTokenBySymbol } from './config';
import logger from './utils/logger';

interface TokenBalance {
  symbol: string;
  balance: BigNumber;
  rawBalance: string;
  decimals?: number;
  mint?: string;
}

interface ChainBalances {
  chain: string;
  wallet: string;
  tokens: TokenBalance[];
  native?: BigNumber;
}

function formatBalance(balance: BigNumber, decimals: number = 8): string {
  return balance.toFixed(decimals).replace(/\.?0+$/, '');
}

function formatLargeNumber(num: BigNumber): string {
  if (num.isGreaterThanOrEqualTo(1_000_000)) {
    return num.dividedBy(1_000_000).toFixed(2) + 'M';
  } else if (num.isGreaterThanOrEqualTo(1_000)) {
    return num.dividedBy(1_000).toFixed(2) + 'K';
  }
  return formatBalance(num, 8);
}

async function fetchGalaChainBalances(): Promise<ChainBalances> {
  const wallet = process.env.GALACHAIN_WALLET_ADDRESS;
  if (!wallet) {
    throw new Error('GALACHAIN_WALLET_ADDRESS not set');
  }

  const baseUrl = process.env.GALA_CONNECT_BASE_URL || 'https://connect.gala.com';
  const galachainApi = process.env.GALACHAIN_API_BASE_URL || 'https://api.galachain.io';
  const client = new GalaConnectClient(baseUrl, galachainApi, wallet);

  logger.info('🔷 Fetching GalaChain balances...');
  const resp = (await client.fetchBalances()) as any;

  // Normalize response format
  let balancesList: any[] = [];
  if (Array.isArray(resp?.balances)) {
    balancesList = resp.balances;
  } else if (Array.isArray(resp?.data?.balances)) {
    balancesList = resp.data.balances;
  } else if (Array.isArray(resp?.Data)) {
    balancesList = resp.Data;
  } else if (Array.isArray(resp)) {
    balancesList = resp;
  }

  initializeConfig();
  const enabledTokens = getEnabledTokens();
  const quoteTokens = ['GALA', 'GUSDC', 'SOL', 'USDC'];
  
  // Create a map of all tokens we care about
  const tokenMap = new Map<string, { symbol: string; decimals: number; mint: string }>();
  
  // Add enabled tokens
  enabledTokens.forEach(token => {
    tokenMap.set(token.galaChainMint, {
      symbol: token.symbol,
      decimals: token.decimals,
      mint: token.galaChainMint
    });
  });
  
  // Add quote tokens
  quoteTokens.forEach(symbol => {
    const qt = getQuoteTokenBySymbol(symbol);
    if (qt) {
      tokenMap.set(qt.galaChainMint, {
        symbol,
        decimals: qt.decimals,
        mint: qt.galaChainMint
      });
    }
  });

  const tokens: TokenBalance[] = [];
  
  // Process balances
  balancesList.forEach((balanceEntry: any) => {
    let tokenKey: string | undefined;
    let balanceStr: string | undefined;
    
    // Handle different response formats
    if (balanceEntry.tokenInstance) {
      const ti = balanceEntry.tokenInstance;
      tokenKey = `${ti.collection}|${ti.category}|${ti.type}|${ti.additionalKey || 'none'}`;
      balanceStr = balanceEntry.balance;
    } else if (balanceEntry.token) {
      tokenKey = balanceEntry.token;
      balanceStr = balanceEntry.balance;
    } else if (balanceEntry.collection && balanceEntry.category) {
      tokenKey = `${balanceEntry.collection}|${balanceEntry.category}|${balanceEntry.type || 'none'}|${balanceEntry.additionalKey || 'none'}`;
      balanceStr = balanceEntry.quantity || balanceEntry.balance;
    }
    
    if (tokenKey && balanceStr) {
      const tokenInfo = tokenMap.get(tokenKey);
      if (tokenInfo) {
        const balance = new BigNumber(balanceStr);
        if (balance.isGreaterThan(0)) {
          tokens.push({
            symbol: tokenInfo.symbol,
            balance,
            rawBalance: balanceStr,
            decimals: tokenInfo.decimals,
            mint: tokenKey
          });
        }
      }
    }
  });

  // Sort by symbol
  tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    chain: 'GalaChain',
    wallet,
    tokens
  };
}

async function fetchSolanaBalances(): Promise<ChainBalances> {
  const wallet = process.env.SOLANA_WALLET_ADDRESS;
  if (!wallet) {
    throw new Error('SOLANA_WALLET_ADDRESS not set');
  }

  // Use balance RPC if available, otherwise fall back to main RPC
  const balanceRpc = process.env.SOLANA_BALANCE_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(balanceRpc, 'confirmed');
  const ownerPk = new PublicKey(wallet);

  logger.info('🔸 Fetching Solana balances...');
  logger.info(`   Using RPC: ${balanceRpc.replace(/\/\/.*@/, '//***@')}`);
  
  // Get native SOL balance with error handling
  let lamports: number;
  try {
    lamports = await connection.getBalance(ownerPk, 'confirmed');
    logger.debug(`   SOL balance: ${lamports} lamports (${(lamports / 1_000_000_000).toFixed(9)} SOL)`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('   Failed to fetch SOL balance', { 
      error: errorMsg,
      rpc: balanceRpc.replace(/\/\/.*@/, '//***@')
    });
    throw error;
  }
  
  const solBalance = new BigNumber(lamports).dividedBy(1_000_000_000);

  // Get SPL token balances (may fail on free tier RPCs)
  let tokenAccounts: any;
  try {
    tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      ownerPk,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    logger.debug(`   Fetched ${tokenAccounts.value.length} SPL token accounts`);
  } catch (splError) {
    const errorMsg = splError instanceof Error ? splError.message : String(splError);
    logger.warn(`   Failed to fetch SPL token balances (may require premium RPC tier): ${errorMsg}`);
    logger.warn(`   Note: SOL balance above is still valid. This only affects non-SOL tokens (USDC, etc.)`);
    // Create empty token accounts structure for graceful handling
    tokenAccounts = { value: [] };
  }

  initializeConfig();
  const enabledTokens = getEnabledTokens();
  const quoteTokens = ['GALA', 'SOL', 'USDC'];
  
  // Create mint to symbol map
  const mintMap = new Map<string, { symbol: string; decimals: number }>();
  
  // Add enabled tokens
  enabledTokens.forEach(token => {
    if (token.solanaMint) {
      mintMap.set(token.solanaMint, {
        symbol: token.symbol,
        decimals: token.decimals
      });
    }
  });
  
  // Add quote tokens
  quoteTokens.forEach(symbol => {
    const qt = getQuoteTokenBySymbol(symbol);
    if (qt && qt.solanaMint) {
      mintMap.set(qt.solanaMint, {
        symbol,
        decimals: qt.decimals
      });
    }
  });

  const tokens: TokenBalance[] = [];
  const solMint = 'So11111111111111111111111111111111111111112'; // Native SOL mint address

  // Process SPL token accounts
  tokenAccounts.value.forEach((acc: any) => {
    const data = acc.account.data;
    if ((data as any).program === 'spl-token') {
      const info = (data as any).parsed.info;
      const mint = info.mint as string;
      
      // Skip native SOL - it's already shown as native balance
      if (mint === solMint) {
        return;
      }
      
      const tokenInfo = mintMap.get(mint);
      
      if (tokenInfo) {
        // Also skip if symbol is SOL (in case of wrapped SOL or other SOL variants)
        if (tokenInfo.symbol === 'SOL') {
          return;
        }
        
        const uiAmount = new BigNumber(
          info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0
        );
        
        if (uiAmount.isGreaterThan(0)) {
          tokens.push({
            symbol: tokenInfo.symbol,
            balance: uiAmount,
            rawBalance: info.tokenAmount.amount || '0',
            decimals: tokenInfo.decimals,
            mint
          });
        }
      }
    }
  });

  // Sort by symbol
  tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    chain: 'Solana',
    wallet,
    tokens,
    native: solBalance
  };
}

function formatBalancesReport(gcBalances: ChainBalances, solBalances: ChainBalances): string {
  const lines: string[] = [];
  
  lines.push('='.repeat(80));
  lines.push('💰 BALANCE REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  
  // GalaChain balances
  lines.push(`🔷 ${gcBalances.chain.toUpperCase()}`);
  lines.push('-'.repeat(80));
  lines.push(`Wallet: ${gcBalances.wallet}`);
  if (gcBalances.tokens.length === 0) {
    lines.push('  No token balances found');
  } else {
    lines.push(`Tokens: ${gcBalances.tokens.length}`);
    lines.push('');
    lines.push('Symbol'.padEnd(15) + 'Balance'.padStart(30) + 'Mint');
    lines.push('-'.repeat(80));
    gcBalances.tokens.forEach(token => {
      const balanceStr = formatLargeNumber(token.balance).padStart(30);
      const mintStr = token.mint || 'N/A';
      lines.push(token.symbol.padEnd(15) + balanceStr + ' ' + mintStr);
    });
  }
  lines.push('');
  
  // Solana balances
  lines.push(`🔸 ${solBalances.chain.toUpperCase()}`);
  lines.push('-'.repeat(80));
  lines.push(`Wallet: ${solBalances.wallet}`);
  if (solBalances.native) {
    lines.push(`Native SOL: ${formatBalance(solBalances.native, 9)} SOL`);
  }
  if (solBalances.tokens.length === 0) {
    lines.push('  No SPL token balances found');
  } else {
    lines.push(`SPL Tokens: ${solBalances.tokens.length}`);
    lines.push('');
    lines.push('Symbol'.padEnd(15) + 'Balance'.padStart(30) + 'Mint');
    lines.push('-'.repeat(80));
    solBalances.tokens.forEach(token => {
      const balanceStr = formatLargeNumber(token.balance).padStart(30);
      const mintStr = token.mint || 'N/A';
      lines.push(token.symbol.padEnd(15) + balanceStr + ' ' + mintStr);
    });
  }
  lines.push('');
  
  // Summary - show enabled tokens across both chains
  initializeConfig();
  const enabledTokens = getEnabledTokens();
  if (enabledTokens.length > 0) {
    lines.push('📊 ENABLED TOKENS SUMMARY');
    lines.push('-'.repeat(80));
    lines.push('Symbol'.padEnd(15) + 'GalaChain'.padStart(20) + 'Solana'.padStart(20));
    lines.push('-'.repeat(80));
    enabledTokens.forEach(token => {
      const gcToken = gcBalances.tokens.find(t => t.symbol === token.symbol);
      
      // For SOL on Solana, check native balance instead of SPL tokens
      let solBalance: string;
      if (token.symbol === 'SOL' && solBalances.native) {
        solBalance = formatLargeNumber(solBalances.native);
      } else {
        const solToken = solBalances.tokens.find(t => t.symbol === token.symbol);
        solBalance = solToken ? formatLargeNumber(solToken.balance) : '0';
      }
      
      const gcBalance = gcToken ? formatLargeNumber(gcToken.balance) : '0';
      lines.push(
        token.symbol.padEnd(15) +
        gcBalance.padStart(20) +
        solBalance.padStart(20)
      );
    });
    lines.push('');
  }
  
  lines.push('='.repeat(80));
  
  return lines.join('\n');
}

async function main() {
  try {
    logger.info('🔍 Starting balance check...\n');
    
    const [gcBalances, solBalances] = await Promise.all([
      fetchGalaChainBalances().catch(err => {
        logger.error('Failed to fetch GalaChain balances', { error: err.message });
        return { chain: 'GalaChain', wallet: process.env.GALACHAIN_WALLET_ADDRESS || 'N/A', tokens: [] } as ChainBalances;
      }),
      fetchSolanaBalances().catch(err => {
        logger.error('Failed to fetch Solana balances', { error: err.message });
        return { chain: 'Solana', wallet: process.env.SOLANA_WALLET_ADDRESS || 'N/A', tokens: [], native: new BigNumber(0) } as ChainBalances;
      })
    ]);
    
    const report = formatBalancesReport(gcBalances, solBalances);
    console.log('\n' + report + '\n');
    
  } catch (error) {
    logger.error('❌ Balance check failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

main();

