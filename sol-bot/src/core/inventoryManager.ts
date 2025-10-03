import { Connection } from '@solana/web3.js';
import { InventoryStatus } from '../types';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export class InventoryManager {
  private gcBalances: Map<string, number> = new Map();
  private solBalances: Map<string, number> = new Map();
  private solanaConnection: Connection;
  private lastUpdate: number = 0;
  private updateInterval: number = 30000; // 30 seconds

  constructor() {
    this.solanaConnection = new Connection(
      config.getSolanaRpcEndpoint(),
      'confirmed'
    );
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
    // TODO: Implement actual GalaChain balance fetching using @gala-chain/api
    // For now, using placeholders
    const tokens = config.getEnabledTokens();
    
    for (const token of tokens) {
      try {
        // Placeholder - replace with actual API call
        const balance = await this.fetchGalaChainBalance(token.symbol);
        this.gcBalances.set(token.symbol, balance);
        logger.debug(`GC balance for ${token.symbol}: ${balance}`);
      } catch (error) {
        logger.error(`Failed to fetch GC balance for ${token.symbol}`, { error });
      }
    }
  }

  private async updateSolanaBalances(): Promise<void> {
    const tokens = config.getEnabledTokens();
    
    for (const tokenConfig of tokens) {
      try {
        if (tokenConfig.symbol === 'SOL') {
          // Get SOL balance
          const balance = await this.fetchSOLBalance();
          this.solBalances.set('SOL', balance);
          logger.debug(`SOL balance: ${balance}`);
        } else if (tokenConfig.solanaMint && !tokenConfig.solanaMint.includes('ADDRESS_HERE')) {
          // Get SPL token balance
          const balance = await this.fetchSPLTokenBalance(tokenConfig.solanaMint);
          this.solBalances.set(tokenConfig.symbol, balance);
          logger.debug(`Solana balance for ${tokenConfig.symbol}: ${balance}`);
        }
      } catch (error) {
        logger.error(`Failed to fetch Solana balance for ${tokenConfig.symbol}`, { error });
      }
    }
  }

  private async fetchGalaChainBalance(_token: string): Promise<number> {
    // TODO: Implement using @gala-chain/api
    // const client = createValidChainObject(...);
    // const balance = await client.GetMyBalance({ ... });
    
    // Placeholder for now
    return 1000; // Return placeholder balance
  }

  private async fetchSOLBalance(): Promise<number> {
    try {
      // Extract keypair from private key
      // For now, using wallet address from config
      // const walletAddress = config.getGalaWalletAddress();
      // This would need to be converted to Solana public key
      // Placeholder implementation
      
      // In production:
      // const publicKey = new PublicKey(solanaWalletAddress);
      // const balance = await this.solanaConnection.getBalance(publicKey);
      // return balance / 1e9; // Convert lamports to SOL
      
      return 5; // Placeholder
    } catch (error) {
      logger.error('Failed to fetch SOL balance', { error });
      return 0;
    }
  }

  private async fetchSPLTokenBalance(mint: string): Promise<number> {
    try {
      // TODO: Implement SPL token balance fetching
      // const mintPublicKey = new PublicKey(mint);
      // const tokenAccounts = await this.solanaConnection.getTokenAccountsByOwner(...);
      
      return 0; // Placeholder
    } catch (error) {
      logger.error(`Failed to fetch SPL token balance for ${mint}`, { error });
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

