/**
 * Balance Service
 * 
 * Reads token balances from state.json and can fetch fresh balances
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { ConfigService } from './configService';

export interface TokenBalance {
  symbol: string;
  mint: string;
  rawBalance: string;
  balance: string;
  decimals: number;
  valueUsd?: number;
  lastUpdated: number;
}

export interface ChainBalances {
  tokens: Record<string, TokenBalance>;
  native: string;
  totalValueUsd: number;
  lastUpdated: number;
}

export interface AllBalances {
  galaChain: ChainBalances;
  solana: ChainBalances;
  lastUpdated: number;
  version?: number;
}

export class BalanceService {
  private stateFilePath: string;
  private configService: ConfigService;
  private botRoot: string;

  constructor() {
    this.configService = new ConfigService();
    
    // Determine bot root directory
    const currentDir = __dirname;
    this.botRoot = currentDir.includes('dist') 
      ? path.resolve(currentDir, '../../..')
      : path.resolve(currentDir, '../../../..');
    this.stateFilePath = path.join(this.botRoot, 'state.json');
  }

  /**
   * Get all balances from state.json
   */
  async getAllBalances(): Promise<AllBalances | null> {
    try {
      if (!existsSync(this.stateFilePath)) {
        return null;
      }
      
      const content = await fs.readFile(this.stateFilePath, 'utf-8');
      const state = JSON.parse(content);
      
      if (!state.inventory) {
        return null;
      }
      
      return {
        galaChain: state.inventory.galaChain || {
          tokens: {},
          native: '0',
          totalValueUsd: 0,
          lastUpdated: Date.now()
        },
        solana: state.inventory.solana || {
          tokens: {},
          native: '0',
          totalValueUsd: 0,
          lastUpdated: Date.now()
        },
        lastUpdated: state.inventory.lastUpdated || Date.now(),
        version: state.inventory.version
      };
    } catch (error) {
      console.error('Failed to read balances from state:', error);
      return null;
    }
  }

  /**
   * Get balances for a specific chain
   */
  async getChainBalances(chain: 'galaChain' | 'solana'): Promise<ChainBalances | null> {
    const allBalances = await this.getAllBalances();
    if (!allBalances) {
      return null;
    }
    
    return allBalances[chain];
  }

  /**
   * Refresh balances by running InventoryRefresher
   * This will fetch fresh balances from the networks and update state.json
   */
  async refreshBalances(): Promise<AllBalances | null> {
    try {
      // Import InventoryRefresher dynamically to avoid circular dependencies
      const { InventoryRefresher } = require('../../../src/core/inventoryRefresher');
      const { StateManager } = require('../../../src/core/stateManager');
      
      const stateManager = new StateManager();
      const refresher = new InventoryRefresher(stateManager);
      
      // Refresh all balances
      await refresher.refreshAll();
      
      // Read the updated balances
      return await this.getAllBalances();
    } catch (error) {
      console.error('Failed to refresh balances:', error);
      // Return current balances even if refresh failed
      return await this.getAllBalances();
    }
  }
}

