/**
 * State Manager for SOL Arbitrage Bot
 * 
 * Handles inventory tracking, state persistence, and state management
 * for the arbitrage bot.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import BigNumber from 'bignumber.js';
import logger from '../utils/logger';
import {
  BotState,
  InventoryState,
  ChainInventory,
  TokenBalance,
  ExecutionResult,
  BridgeStatus,
  CooldownInfo,
  PerformanceMetrics
} from '../types/core';

export class StateManager {
  private static instance: StateManager | null = null;

  private state: BotState;
  private stateFilePath: string;
  private isDirty: boolean = false;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  /**
   * Get the singleton instance of StateManager.
   * All components should use this to share the same state.
   */
  static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    if (StateManager.instance) {
      StateManager.instance.stopAutoSave();
    }
    StateManager.instance = null;
  }

  constructor(stateFilePath?: string) {
    this.stateFilePath = stateFilePath || join(process.cwd(), 'state.json');
    this.state = this.loadState();
    this.startAutoSave();
  }

  /**
   * Load state from file or create default state
   */
  private loadState(): BotState {
    try {
      if (existsSync(this.stateFilePath)) {
        const content = readFileSync(this.stateFilePath, 'utf8');
        const loadedState = JSON.parse(content);
        
        // Ensure required fields exist (for backwards compatibility)
        if (!loadedState.tokenCooldowns) {
          loadedState.tokenCooldowns = {};
        }
        if (!loadedState.dailyTradeCounts) {
          loadedState.dailyTradeCounts = {};
        }
        if (!loadedState.lastBridgeTimes) {
          loadedState.lastBridgeTimes = {};
        }
        if (!loadedState.pendingBridges) {
          loadedState.pendingBridges = [];
        }
        if (!loadedState.recentTrades) {
          loadedState.recentTrades = [];
        }
        
        // Convert BigNumber strings back to BigNumber instances
        this.convertBigNumbers(loadedState);
        
        logger.info('✅ State loaded from file', { 
          file: this.stateFilePath,
          version: loadedState.version 
        });
        
        return loadedState;
      }
    } catch (error) {
      logger.warn('⚠️ Failed to load state file, creating new state', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // Create default state
    return this.createDefaultState();
  }

  /**
   * Convert BigNumber strings back to BigNumber instances
   * Also handles known BigNumber fields in TokenBalance structures
   */
  private convertBigNumbers(obj: any): void {
    if (obj === null || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(item => this.convertBigNumbers(item));
    } else {
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        
        // Convert "BigNumber:..." strings back to BigNumber instances
        if (typeof value === 'string' && value.startsWith('BigNumber:')) {
          obj[key] = new BigNumber(value.replace('BigNumber:', ''));
        } 
        // Convert known BigNumber fields in TokenBalance structures
        // (even if they were stored as plain numbers/strings due to JSON serialization issues)
        else if (key === 'balance' || key === 'rawBalance' || key === 'valueUsd' || 
                 key === 'native' || key === 'totalValueUsd') {
          if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
            obj[key] = new BigNumber(value);
          } else if (!BigNumber.isBigNumber(value) && value !== null && value !== undefined) {
            // Try to convert if it's not already a BigNumber
            try {
              obj[key] = new BigNumber(value);
            } catch (e) {
              logger.warn(`⚠️ Failed to convert ${key} to BigNumber`, { value, error: e });
            }
          }
        } 
        // Recurse into nested objects
        else if (typeof value === 'object') {
          this.convertBigNumbers(value);
        }
      });
    }
  }

  /**
   * Create default bot state
   */
  private createDefaultState(): BotState {
    return {
      inventory: {
        galaChain: {
          tokens: {},
          native: new BigNumber(0),
          totalValueUsd: new BigNumber(0),
          lastUpdated: Date.now()
        },
        solana: {
          tokens: {},
          native: new BigNumber(0),
          totalValueUsd: new BigNumber(0),
          lastUpdated: Date.now()
        },
        lastUpdated: Date.now(),
        version: 1
      },
      pendingBridges: [],
      recentTrades: [],
      tokenCooldowns: {},
      dailyTradeCounts: {},
      lastBridgeTimes: {},
      status: 'stopped',
      lastHeartbeat: Date.now(),
      version: 1,
      lastSaved: Date.now()
    };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      // Convert BigNumber instances to strings for JSON serialization
      const stateToSave = JSON.parse(JSON.stringify(this.state, (key, value) => {
        if (BigNumber.isBigNumber(value)) {
          return `BigNumber:${value.toString()}`;
        }
        return value;
      }));

      stateToSave.lastSaved = Date.now();
      stateToSave.version = (stateToSave.version || 0) + 1;

      writeFileSync(this.stateFilePath, JSON.stringify(stateToSave, null, 2), 'utf8');
      this.isDirty = false;
      
      logger.debug('💾 State saved to file', { 
        file: this.stateFilePath,
        version: stateToSave.version 
      });
    } catch (error) {
      logger.error('❌ Failed to save state', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(() => {
      if (this.isDirty) {
        this.saveState();
      }
    }, 30000); // Save every 30 seconds if dirty
  }

  /**
   * Stop auto-save interval
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Mark state as dirty and trigger save
   */
  private markDirty(): void {
    this.isDirty = true;
  }

  /**
   * Get current bot state
   */
  getState(): BotState {
    return { ...this.state };
  }

  /**
   * Update bot status
   */
  updateStatus(status: BotState['status'], error?: string): void {
    this.state.status = status;
    this.state.lastHeartbeat = Date.now();
    if (error) {
      this.state.error = error;
    } else {
      delete this.state.error;
    }
    this.markDirty();
    
    logger.info('📊 Bot status updated', { status, error });
  }

  /**
   * Update inventory for a specific chain
   */
  updateChainInventory(chain: 'galaChain' | 'solana', inventory: ChainInventory): void {
    this.state.inventory[chain] = {
      ...inventory,
      lastUpdated: Date.now()
    };
    this.state.inventory.lastUpdated = Date.now();
    this.state.inventory.version = (this.state.inventory.version || 0) + 1;
    this.markDirty();
    
    logger.debug('📦 Chain inventory updated', { 
      chain, 
      tokenCount: Object.keys(inventory.tokens).length,
      totalValueUsd: inventory.totalValueUsd.toString() 
    });
  }

  /**
   * Update token balance for a specific chain
   */
  updateTokenBalance(
    chain: 'galaChain' | 'solana',
    symbol: string,
    balance: TokenBalance
  ): void {
    this.state.inventory[chain].tokens[symbol] = {
      ...balance,
      lastUpdated: Date.now()
    };
    this.state.inventory[chain].lastUpdated = Date.now();
    this.state.inventory.lastUpdated = Date.now();
    this.state.inventory.version = (this.state.inventory.version || 0) + 1;
    this.markDirty();
    
    logger.debug('🪙 Token balance updated', { 
      chain, 
      symbol, 
      balance: balance.balance.toString() 
    });
  }

  /**
   * Add execution result to recent trades
   */
  addExecutionResult(result: ExecutionResult): void {
    this.state.recentTrades.unshift(result);
    
    // Keep only last 100 trades
    if (this.state.recentTrades.length > 100) {
      this.state.recentTrades = this.state.recentTrades.slice(0, 100);
    }
    
    // Update daily trade count
    const today = new Date().toISOString().split('T')[0];
    this.state.dailyTradeCounts[today] = (this.state.dailyTradeCounts[today] || 0) + 1;
    
    this.markDirty();
    
    logger.info('📈 Execution result added', { 
      tokenSymbol: result.tokenSymbol,
      success: result.success,
      netEdge: result.actualNetEdge.toString() 
    });
  }

  /**
   * Add bridge status
   */
  addBridgeStatus(bridgeStatus: BridgeStatus): void {
    this.state.pendingBridges.push(bridgeStatus);
    this.markDirty();
    
    logger.info('🌉 Bridge status added', { 
      tokenSymbol: bridgeStatus.tokenSymbol,
      amount: bridgeStatus.amount.toString(),
      status: bridgeStatus.status 
    });
  }

  /**
   * Update bridge status
   */
  updateBridgeStatus(bridgeId: string, updates: Partial<BridgeStatus>): void {
    const bridgeIndex = this.state.pendingBridges.findIndex(b => b.id === bridgeId);
    if (bridgeIndex >= 0) {
      this.state.pendingBridges[bridgeIndex] = {
        ...this.state.pendingBridges[bridgeIndex],
        ...updates
      };
      this.markDirty();
      
      logger.info('🌉 Bridge status updated', { 
        bridgeId, 
        status: updates.status 
      });
    }
  }

  /**
   * Remove completed bridge status
   */
  removeBridgeStatus(bridgeId: string): void {
    this.state.pendingBridges = this.state.pendingBridges.filter(b => b.id !== bridgeId);
    this.markDirty();
    
    logger.debug('🗑️ Bridge status removed', { bridgeId });
  }

  /**
   * Set token cooldown
   */
  setTokenCooldown(symbol: string, cooldown: CooldownInfo): void {
    if (!this.state.tokenCooldowns) {
      this.state.tokenCooldowns = {};
    }
    this.state.tokenCooldowns[symbol] = cooldown;
    this.markDirty();
    
    logger.info('⏰ Token cooldown set', { 
      symbol, 
      duration: cooldown.remainingSeconds 
    });
  }

  /**
   * Clear token cooldown
   */
  clearTokenCooldown(symbol: string): void {
    if (this.state.tokenCooldowns) {
      delete this.state.tokenCooldowns[symbol];
    }
    this.markDirty();
    
    logger.debug('✅ Token cooldown cleared', { symbol });
  }

  /**
   * Check if token is in cooldown
   */
  isTokenInCooldown(symbol: string): boolean {
    if (!this.state || !this.state.tokenCooldowns) {
      // State not initialized or tokenCooldowns missing, no cooldown active
      return false;
    }
    const cooldown = this.state.tokenCooldowns[symbol];
    if (!cooldown) return false;
    
    if (cooldown.cooldownEndsAt && Date.now() < cooldown.cooldownEndsAt) {
      return true;
    }
    
    // Clear expired cooldown
    this.clearTokenCooldown(symbol);
    return false;
  }

  /**
   * Get token cooldown info
   */
  getTokenCooldown(symbol: string): CooldownInfo | undefined {
    if (!this.state || !this.state.tokenCooldowns) {
      return undefined;
    }
    const cooldown = this.state.tokenCooldowns[symbol];
    if (!cooldown) return undefined;
    
    if (cooldown.cooldownEndsAt && Date.now() < cooldown.cooldownEndsAt) {
      return {
        ...cooldown,
        remainingSeconds: Math.max(0, Math.floor((cooldown.cooldownEndsAt - Date.now()) / 1000))
      };
    }
    
    // Clear expired cooldown
    this.clearTokenCooldown(symbol);
    return undefined;
  }

  /**
   * Update last bridge time for token
   */
  updateLastBridgeTime(symbol: string): void {
    this.state.lastBridgeTimes[symbol] = Date.now();
    this.markDirty();
    
    logger.debug('🕐 Last bridge time updated', { symbol });
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const trades = this.state.recentTrades;
    const successfulTrades = trades.filter(t => t.success);
    const failedTrades = trades.filter(t => !t.success);
    
    const totalPnlGala = trades.reduce((sum, trade) => 
      sum.plus(trade.actualNetEdge), new BigNumber(0)
    );
    
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (successfulTrades.length / totalTrades) * 100 : 0;
    
    const averageTradeSize = trades.length > 0 
      ? trades.reduce((sum, trade) => sum.plus(trade.tradeSize), new BigNumber(0)).div(trades.length)
      : new BigNumber(0);
    
    const averageNetEdge = trades.length > 0
      ? totalPnlGala.div(trades.length)
      : new BigNumber(0);
    
    const bestTradePnl = trades.length > 0
      ? BigNumber.max(...trades.map(t => t.actualNetEdge))
      : new BigNumber(0);
    
    const worstTradePnl = trades.length > 0
      ? BigNumber.min(...trades.map(t => t.actualNetEdge))
      : new BigNumber(0);
    
    return {
      totalTrades,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      totalPnlGala,
      totalPnlUsd: new BigNumber(0), // TODO: Calculate USD value
      averageTradeSize,
      averageNetEdge,
      bestTradePnl,
      worstTradePnl,
      winRate,
      lastUpdated: Date.now()
    };
  }

  /**
   * Force save state
   */
  forceSave(): void {
    this.saveState();
  }

  /**
   * Cleanup and save state
   */
  destroy(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    this.saveState();
    logger.info('🛑 State manager destroyed');
  }

  /**
   * Reset inventory structure to defaults (tokens cleared, balances zeroed)
   */
  resetInventory(): void {
    this.state.inventory = {
      galaChain: {
        tokens: {},
        native: new BigNumber(0),
        totalValueUsd: new BigNumber(0),
        lastUpdated: Date.now()
      },
      solana: {
        tokens: {},
        native: new BigNumber(0),
        totalValueUsd: new BigNumber(0),
        lastUpdated: Date.now()
      },
      lastUpdated: Date.now(),
      version: 1
    };
    this.markDirty();
    this.forceSave();
    logger.info('🧹 Inventory reset to default structure');
  }
}
