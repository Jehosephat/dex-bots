import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios from 'axios';
import { InventoryStatus } from '../types';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export class InventoryManager {
  private gcBalances: Map<string, number> = new Map();
  private solBalances: Map<string, number> = new Map();
  private solanaConnection: Connection;
  private lastUpdate: number = 0;
  private updateInterval: number = 30000; // 30 seconds
  private galaChainApiUrl = 'https://gateway-mainnet.galachain.com/api/asset/token-contract';
  private solanaWalletPublicKey: PublicKey;
  private solanaRpcDelay: number = 300; // 300ms delay between Solana RPC calls to avoid rate limits

  constructor() {
    this.solanaConnection = new Connection(
      config.getSolanaRpcEndpoint(),
      'confirmed'
    );
    
    // Parse Solana wallet from private key or env
    // In production, this should be derived from the private key
    // For now, we'll get it from env or derive it
    try {
      const solanaWalletAddress = process.env.SOLANA_WALLET_ADDRESS || '';
      this.solanaWalletPublicKey = new PublicKey(solanaWalletAddress);
    } catch (error) {
      logger.error('Failed to parse Solana wallet address', { error });
      throw new Error('Invalid Solana wallet configuration');
    }
  }

  async updateBalances(): Promise<void> {
    const now = Date.now();
    
    // Rate limit updates
    if (now - this.lastUpdate < this.updateInterval) {
      return;
    }

    try {
      await Promise.all([
        this.updateGalaChainBalances(),
        this.updateSolanaBalances()
      ]);

      this.lastUpdate = now;
      logger.info('Inventory balances updated');
    } catch (error) {
      logger.error('Failed to update balances', { error });
    }
  }

  private async updateGalaChainBalances(): Promise<void> {
    try {
      // Fetch all balances at once using FetchBalances endpoint
      let walletAddress = config.getGalaWalletAddress();
      
      // Remove 'eth|' prefix if present (GalaChain FetchBalances expects just the address)
      if (walletAddress.startsWith('eth|')) {
        walletAddress = walletAddress.substring(4);
      }
      
      logger.debug(`Fetching GalaChain balances for wallet: ${walletAddress.substring(0, 10)}...`);
      
      const response = await axios.post(
        `${this.galaChainApiUrl}/FetchBalances`,
        { owner: walletAddress },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      if (response.data?.Data) {
        const balances = response.data.Data;
        
        // Parse balances for tokens we care about
        const tokens = config.getEnabledTokens();
        const tokensConfig = config.getTokensConfig();
        
        // Fetch enabled tokens
        for (const token of tokens) {
          try {
            // Find balance for this token by matching collection name
            const tokenBalance = balances.find((b: any) => 
              b.collection === token.galaChainMint.split('|')[0]
            );
            
            if (tokenBalance && tokenBalance.quantity) {
              // Parse quantity - it's typically a BigNumber string
              const balance = parseFloat(tokenBalance.quantity) || 0;
              this.gcBalances.set(token.symbol, balance);
              logger.debug(`GC balance for ${token.symbol}: ${balance.toFixed(2)}`);
            } else {
              // No balance found, set to 0
              this.gcBalances.set(token.symbol, 0);
              logger.debug(`GC balance for ${token.symbol}: 0 (no balance entry)`);
            }
          } catch (error) {
            logger.error(`Failed to parse GC balance for ${token.symbol}`, { error });
            this.gcBalances.set(token.symbol, 0);
          }
        }
        
        // Also fetch quote tokens (GALA, GUSDC)
        if (tokensConfig.quoteTokens) {
          for (const [symbol, quoteToken] of Object.entries(tokensConfig.quoteTokens)) {
            try {
              const collection = (quoteToken as any).galaChainMint.split('|')[0];
              const tokenBalance = balances.find((b: any) => b.collection === collection);
              
              if (tokenBalance && tokenBalance.quantity) {
                const balance = parseFloat(tokenBalance.quantity) || 0;
                this.gcBalances.set(symbol, balance);
                logger.debug(`GC balance for ${symbol}: ${balance.toFixed(2)}`);
              } else {
                this.gcBalances.set(symbol, 0);
                logger.debug(`GC balance for ${symbol}: 0 (no balance entry)`);
              }
            } catch (error) {
              logger.error(`Failed to parse GC balance for ${symbol}`, { error });
              this.gcBalances.set(symbol, 0);
            }
          }
        }
        
        logger.info(`Fetched ${balances.length} GalaChain balances for wallet ${walletAddress.substring(0, 8)}...`);
      } else {
        logger.warn('No balance data returned from GalaChain FetchBalances');
      }
    } catch (error: any) {
      logger.error('Failed to fetch GalaChain balances', { 
        error: error.message || error,
        endpoint: `${this.galaChainApiUrl}/FetchBalances`
      });
    }
  }

  private async updateSolanaBalances(): Promise<void> {
    try {
      // First, get native SOL balance
      const solBalance = await this.fetchSOLBalance();
      this.solBalances.set('SOL', solBalance);
      this.solBalances.set('GSOL', solBalance); // GSOL is just SOL on Solana
      logger.debug(`Native SOL balance: ${solBalance.toFixed(4)}`);

      // Add delay to avoid rate limits
      await this.sleep(this.solanaRpcDelay);

      // Then get all SPL token balances
      const tokens = config.getEnabledTokens();
      const tokensConfig = config.getTokensConfig();
      
      for (const tokenConfig of tokens) {
        try {
          // Skip SOL/GSOL (already handled above)
          if (tokenConfig.symbol === 'SOL' || tokenConfig.symbol === 'GSOL') {
            continue;
          }
          
          if (tokenConfig.solanaMint && !tokenConfig.solanaMint.includes('ADDRESS_HERE')) {
            // Get SPL token balance
            const balance = await this.fetchSPLTokenBalance(
              tokenConfig.solanaMint,
              tokenConfig.decimals
            );
            this.solBalances.set(tokenConfig.symbol, balance);
            logger.debug(`Solana balance for ${tokenConfig.symbol}: ${balance.toFixed(4)}`);
            
            // Add delay between token fetches to avoid rate limits
            await this.sleep(this.solanaRpcDelay);
          }
        } catch (error: any) {
          logger.error(`Failed to fetch Solana balance for ${tokenConfig.symbol}`, { 
            error: error.message || error 
          });
          this.solBalances.set(tokenConfig.symbol, 0);
        }
      }
      
      // Also fetch quote tokens (GALA, GUSDC) on Solana
      if (tokensConfig.quoteTokens) {
        for (const [symbol, quoteToken] of Object.entries(tokensConfig.quoteTokens)) {
          try {
            const solanaMint = (quoteToken as any).solanaMint;
            const decimals = (quoteToken as any).decimals;
            
            if (solanaMint && !solanaMint.includes('ADDRESS_HERE')) {
              const balance = await this.fetchSPLTokenBalance(solanaMint, decimals);
              this.solBalances.set(symbol, balance);
              logger.debug(`Solana balance for ${symbol}: ${balance.toFixed(4)}`);
              
              // Add delay between token fetches to avoid rate limits
              await this.sleep(this.solanaRpcDelay);
            }
          } catch (error: any) {
            logger.error(`Failed to fetch Solana balance for quote token ${symbol}`, {
              error: error.message || error
            });
            this.solBalances.set(symbol, 0);
          }
        }
      }
      
      logger.info(`Fetched Solana balances for wallet ${this.solanaWalletPublicKey.toBase58().substring(0, 8)}...`);
    } catch (error: any) {
      logger.error('Failed to update Solana balances', { error: error.message || error });
    }
  }

  /**
   * Sleep helper to add delays between RPC calls
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchSOLBalance(): Promise<number> {
    try {
      const balance = await this.solanaConnection.getBalance(this.solanaWalletPublicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error: any) {
      logger.error('Failed to fetch SOL balance', { error: error.message || error });
      return 0;
    }
  }

  private async fetchSPLTokenBalance(mint: string, decimals: number): Promise<number> {
    try {
      const mintPublicKey = new PublicKey(mint);
      
      // Get token accounts for this wallet and mint
      const tokenAccounts = await this.solanaConnection.getTokenAccountsByOwner(
        this.solanaWalletPublicKey,
        {
          mint: mintPublicKey,
          programId: TOKEN_PROGRAM_ID
        }
      );

      if (tokenAccounts.value.length === 0) {
        // No token account found, balance is 0
        return 0;
      }

      // Parse the token account data
      // Token account data structure: https://spl.solana.com/token#account-layout
      const accountInfo = tokenAccounts.value[0].account;
      const data = accountInfo.data;
      
      // Amount is stored at bytes 64-72 as a u64 little-endian
      const amountBuffer = data.slice(64, 72);
      let amount = 0n;
      for (let i = 0; i < 8; i++) {
        amount |= BigInt(amountBuffer[i]) << (BigInt(i) * 8n);
      }
      
      // Convert to decimal using token decimals
      return Number(amount) / Math.pow(10, decimals);
    } catch (error: any) {
      logger.error(`Failed to fetch SPL token balance for ${mint}`, { 
        error: error.message || error 
      });
      return 0;
    }
  }

  canExecuteTrade(token: string, gcSellAmount: number, _solBuyAmount: number): boolean {
    const gcBalance = this.gcBalances.get(token) || 0;
    const solBalance = this.solBalances.get('SOL') || 0;
    const botConfig = config.getBotConfig();

    // Check GC token balance
    if (gcBalance < gcSellAmount) {
      logger.warn(`Insufficient GC balance for ${token}. Have: ${gcBalance}, Need: ${gcSellAmount}`);
      return false;
    }

    // Check SOL balance for fees (approximate)
    const minSOLRequired = botConfig.risk.inventoryMinimums.SOL || 1;
    if (solBalance < minSOLRequired) {
      logger.warn(`Insufficient SOL balance. Have: ${solBalance}, Need: ${minSOLRequired}`);
      return false;
    }

    return true;
  }

  getInventoryStatus(): InventoryStatus {
    const botConfig = config.getBotConfig();
    const recommendations: string[] = [];

    // Calculate total value in GALA
    let gcTotalGALA = 0;
    let solTotalGALA = 0;

    this.gcBalances.forEach((balance, token) => {
      if (token === 'GALA') {
        gcTotalGALA += balance;
      } else {
        // Convert to GALA (simplified)
        gcTotalGALA += balance; // TODO: Convert using current prices
      }
    });

    this.solBalances.forEach((balance, token) => {
      if (token === 'GALA') {
        solTotalGALA += balance;
      } else {
        // Convert to GALA (simplified)
        solTotalGALA += balance; // TODO: Convert using current prices
      }
    });

    const totalValueGALA = gcTotalGALA + solTotalGALA;

    // Determine drift direction
    let driftDirection: 'toward-gc' | 'toward-sol' | 'balanced';
    const gcPercent = gcTotalGALA / totalValueGALA;
    
    if (gcPercent > 0.6) {
      driftDirection = 'toward-gc';
    } else if (gcPercent < 0.4) {
      driftDirection = 'toward-sol';
      recommendations.push('Consider bridging more assets to GalaChain');
    } else {
      driftDirection = 'balanced';
    }

    // Check minimum balances
    Object.entries(botConfig.risk.inventoryMinimums).forEach(([token, minimum]) => {
      const gcBalance = this.gcBalances.get(token) || 0;
      const solBalance = this.solBalances.get(token) || 0;

      if (gcBalance < minimum) {
        recommendations.push(`GC ${token} balance below minimum: ${gcBalance} < ${minimum}`);
      }

      if (token === 'SOL' && solBalance < minimum) {
        recommendations.push(`SOL balance below minimum: ${solBalance} < ${minimum}`);
      }
    });

    return {
      gcBalances: Object.fromEntries(this.gcBalances),
      solBalances: Object.fromEntries(this.solBalances),
      totalValueGALA,
      driftDirection,
      recommendations
    };
  }

  // Getters for specific balances
  getGCBalance(token: string): number {
    return this.gcBalances.get(token) || 0;
  }

  getSOLBalance(token: string): number {
    return this.solBalances.get(token) || 0;
  }

  // Manual balance updates (for testing or after trades)
  updateGCBalance(token: string, amount: number): void {
    const current = this.gcBalances.get(token) || 0;
    this.gcBalances.set(token, current + amount);
    logger.debug(`Updated GC balance for ${token}: ${current} -> ${current + amount}`);
  }

  updateSOLBalance(token: string, amount: number): void {
    const current = this.solBalances.get(token) || 0;
    this.solBalances.set(token, current + amount);
    logger.debug(`Updated SOL balance for ${token}: ${current} -> ${current + amount}`);
  }

  getAllBalances() {
    return {
      galaChain: Object.fromEntries(this.gcBalances),
      solana: Object.fromEntries(this.solBalances),
      lastUpdate: this.lastUpdate
    };
  }
}

