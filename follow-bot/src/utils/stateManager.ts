/**
 * State Manager
 * 
 * Manages persistent state storage for the follow bot including
 * position tracking, trade history, cooldown periods, and runtime state.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger';

// State interfaces
export interface TradeRecord {
  id: string;
  timestamp: number;
  targetWallet: string;
  originalTrade: {
    type: 'buy' | 'sell';
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    amountOut: number;
  };
  copiedTrade: {
    type: 'buy' | 'sell';
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    amountOut: number;
    transactionHash?: string;
    status: 'pending' | 'completed' | 'failed';
  };
  copyMode: 'exact' | 'proportional';
  executionDelay: number;
  slippage: number;
}

export interface Position {
  token: string;
  amount: number;
  averagePrice: number;
  totalCost: number;
  lastUpdated: number;
}

export interface CooldownState {
  walletAddress: string;
  lastTradeTime: number;
  cooldownEndTime: number;
  reason: string;
}

export interface DailyLimits {
  date: string; // YYYY-MM-DD format
  tradeCount: number;
  totalVolume: number;
  lastReset: number;
}

export interface BotState {
  // Trade tracking
  trades: TradeRecord[];
  positions: Position[];
  cooldowns: CooldownState[];
  
  // Daily limits tracking
  dailyLimits: DailyLimits;
  
  // Runtime state
  lastHeartbeat: number;
  totalTradesExecuted: number;
  totalVolumeTraded: number;
  lastConfigurationReload: number;
  
  // Performance metrics
  successfulTrades: number;
  failedTrades: number;
  averageExecutionTime: number;
  
  // WebSocket connection state
  websocketConnected: boolean;
  lastWebSocketReconnect: number;
  websocketReconnectCount: number;
  
  // Version for state migration
  version: string;
  lastSaved: number;
}

export class StateManager {
  private static instance: StateManager;
  private state: BotState;
  private statePath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_INTERVAL = 30000; // 30 seconds

  private constructor() {
    this.statePath = path.join(process.cwd(), 'state.json');
    this.state = this.getDefaultState();
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  /**
   * Initialize state manager and load existing state
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('💾 Initializing state manager...');
      
      // Load existing state or create default
      await this.loadState();
      
      // Start auto-save
      this.startAutoSave();
      
      // Update heartbeat
      this.updateHeartbeat();
      
      logger.info('✅ State manager initialized successfully');
      logger.info(`📊 Loaded ${this.state.trades.length} trades, ${this.state.positions.length} positions`);
    } catch (error) {
      logger.error('❌ Failed to initialize state manager:', error);
      throw error;
    }
  }

  /**
   * Get default state structure
   */
  private getDefaultState(): BotState {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0] as string;
    
    return {
      trades: [],
      positions: [],
      cooldowns: [],
      dailyLimits: {
        date: today,
        tradeCount: 0,
        totalVolume: 0,
        lastReset: now
      },
      lastHeartbeat: now,
      totalTradesExecuted: 0,
      totalVolumeTraded: 0,
      lastConfigurationReload: now,
      successfulTrades: 0,
      failedTrades: 0,
      averageExecutionTime: 0,
      websocketConnected: false,
      lastWebSocketReconnect: 0,
      websocketReconnectCount: 0,
      version: '1.0.0',
      lastSaved: now
    };
  }

  /**
   * Load state from file
   */
  private async loadState(): Promise<void> {
    try {
      if (fs.existsSync(this.statePath)) {
        const stateData = fs.readFileSync(this.statePath, 'utf8');
        const loadedState = JSON.parse(stateData) as BotState;
        
        // Validate and migrate state if needed
        this.state = this.validateAndMigrateState(loadedState);
        
        logger.info(`📂 Loaded state from ${this.statePath}`);
      } else {
        logger.info('📝 No existing state found, using default state');
        this.state = this.getDefaultState();
      }
    } catch (error) {
      logger.error('❌ Failed to load state, using default:', error);
      this.state = this.getDefaultState();
    }
  }

  /**
   * Validate and migrate state structure
   */
  private validateAndMigrateState(loadedState: unknown): BotState {
    const defaultState = this.getDefaultState();
    
    // If loaded state is not an object, return default
    if (typeof loadedState !== 'object' || loadedState === null) {
      logger.warn('⚠️ Invalid state structure, using default state');
      return defaultState;
    }
    
    const state = loadedState as Record<string, unknown>;
    
    // Merge with default state to ensure all fields exist
    const mergedState: BotState = {
      ...defaultState,
      ...state,
      // Ensure arrays are arrays
      trades: Array.isArray(state['trades']) ? state['trades'] as TradeRecord[] : defaultState.trades,
      positions: Array.isArray(state['positions']) ? state['positions'] as Position[] : defaultState.positions,
      cooldowns: Array.isArray(state['cooldowns']) ? state['cooldowns'] as CooldownState[] : defaultState.cooldowns,
      // Ensure dailyLimits is properly structured
      dailyLimits: typeof state['dailyLimits'] === 'object' && state['dailyLimits'] !== null 
        ? { ...defaultState.dailyLimits, ...state['dailyLimits'] as Record<string, unknown> }
        : defaultState.dailyLimits
    };
    
    // Reset daily limits if it's a new day
    const today = new Date().toISOString().split('T')[0] as string;
    if (mergedState.dailyLimits.date !== today) {
      logger.info('📅 New day detected, resetting daily limits');
      mergedState.dailyLimits = {
        date: today,
        tradeCount: 0,
        totalVolume: 0,
        lastReset: Date.now()
      };
    }
    
    return mergedState;
  }

  /**
   * Save state to file
   */
  public async saveState(): Promise<void> {
    try {
      this.state.lastSaved = Date.now();
      const stateData = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(this.statePath, stateData);
      logger.debug('💾 State saved successfully');
    } catch (error) {
      logger.error('❌ Failed to save state:', error);
      throw error;
    }
  }

  /**
   * Start auto-save functionality
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    this.autoSaveInterval = setInterval(async () => {
      try {
        await this.saveState();
      } catch (error) {
        logger.error('❌ Auto-save failed:', error);
      }
    }, this.AUTO_SAVE_INTERVAL);
    
    logger.info(`🔄 Auto-save enabled (every ${this.AUTO_SAVE_INTERVAL / 1000}s)`);
  }

  /**
   * Stop auto-save functionality
   */
  public stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      logger.info('⏹️ Auto-save disabled');
    }
  }

  /**
   * Update heartbeat timestamp
   */
  public updateHeartbeat(): void {
    this.state.lastHeartbeat = Date.now();
  }

  /**
   * Add a new trade record
   */
  public addTrade(trade: TradeRecord): void {
    this.state.trades.push(trade);
    this.state.totalTradesExecuted++;
    this.state.dailyLimits.tradeCount++;
    this.state.dailyLimits.totalVolume += trade.copiedTrade.amountIn;
    this.state.totalVolumeTraded += trade.copiedTrade.amountIn;
    
    logger.info(`📈 Trade added: ${trade.copiedTrade.type} ${trade.copiedTrade.amountIn} ${trade.copiedTrade.tokenIn} → ${trade.copiedTrade.amountOut} ${trade.copiedTrade.tokenOut}`);
  }

  /**
   * Update trade status
   */
  public updateTradeStatus(tradeId: string, status: 'completed' | 'failed', transactionHash?: string): void {
    const trade = this.state.trades.find(t => t.id === tradeId);
    if (trade) {
      trade.copiedTrade.status = status;
      if (transactionHash) {
        trade.copiedTrade.transactionHash = transactionHash;
      }
      
      if (status === 'completed') {
        this.state.successfulTrades++;
      } else {
        this.state.failedTrades++;
      }
      
      logger.info(`📊 Trade ${tradeId} status updated to ${status}`);
    }
  }

  /**
   * Update position
   */
  public updatePosition(token: string, amount: number, price: number): void {
    const existingPosition = this.state.positions.find(p => p.token === token);
    
    if (existingPosition) {
      // Update existing position
      const totalCost = existingPosition.totalCost + (amount * price);
      const totalAmount = existingPosition.amount + amount;
      existingPosition.amount = totalAmount;
      existingPosition.averagePrice = totalCost / totalAmount;
      existingPosition.totalCost = totalCost;
      existingPosition.lastUpdated = Date.now();
    } else {
      // Add new position
      this.state.positions.push({
        token,
        amount,
        averagePrice: price,
        totalCost: amount * price,
        lastUpdated: Date.now()
      });
    }
    
    logger.info(`💰 Position updated: ${amount} ${token} @ ${price}`);
  }

  /**
   * Add cooldown for a wallet
   */
  public addCooldown(walletAddress: string, durationMinutes: number, reason: string): void {
    const now = Date.now();
    const cooldownEndTime = now + (durationMinutes * 60 * 1000);
    
    // Remove existing cooldown for this wallet
    this.state.cooldowns = this.state.cooldowns.filter(c => c.walletAddress !== walletAddress);
    
    // Add new cooldown
    this.state.cooldowns.push({
      walletAddress,
      lastTradeTime: now,
      cooldownEndTime,
      reason
    });
    
    logger.info(`⏰ Cooldown added for ${walletAddress}: ${durationMinutes}min (${reason})`);
  }

  /**
   * Check if wallet is in cooldown
   */
  public isWalletInCooldown(walletAddress: string): boolean {
    const cooldown = this.state.cooldowns.find(c => c.walletAddress === walletAddress);
    if (!cooldown) return false;
    
    const now = Date.now();
    if (now >= cooldown.cooldownEndTime) {
      // Cooldown expired, remove it
      this.state.cooldowns = this.state.cooldowns.filter(c => c.walletAddress !== walletAddress);
      return false;
    }
    
    return true;
  }

  /**
   * Get remaining cooldown time for wallet
   */
  public getCooldownRemainingTime(walletAddress: string): number {
    const cooldown = this.state.cooldowns.find(c => c.walletAddress === walletAddress);
    if (!cooldown) return 0;
    
    const now = Date.now();
    const remaining = cooldown.cooldownEndTime - now;
    return Math.max(0, remaining);
  }

  /**
   * Check if daily trade limit is reached
   */
  public isDailyTradeLimitReached(maxTrades: number): boolean {
    return this.state.dailyLimits.tradeCount >= maxTrades;
  }

  /**
   * Update WebSocket connection state
   */
  public updateWebSocketState(connected: boolean): void {
    const wasConnected = this.state.websocketConnected;
    this.state.websocketConnected = connected;
    
    if (!wasConnected && connected) {
      this.state.lastWebSocketReconnect = Date.now();
      this.state.websocketReconnectCount++;
      logger.info('🔌 WebSocket reconnected');
    } else if (wasConnected && !connected) {
      logger.warn('🔌 WebSocket disconnected');
    }
  }

  /**
   * Get current state
   */
  public getState(): BotState {
    return { ...this.state };
  }

  /**
   * Get trade history
   */
  public getTradeHistory(limit?: number): TradeRecord[] {
    const trades = [...this.state.trades].reverse(); // Most recent first
    return limit ? trades.slice(0, limit) : trades;
  }

  /**
   * Get current positions
   */
  public getPositions(): Position[] {
    return [...this.state.positions];
  }

  /**
   * Get active cooldowns
   */
  public getActiveCooldowns(): CooldownState[] {
    const now = Date.now();
    return this.state.cooldowns.filter(c => c.cooldownEndTime > now);
  }

  /**
   * Get performance metrics
   */
  public getPerformanceMetrics(): {
    totalTrades: number;
    successfulTrades: number;
    failedTrades: number;
    successRate: number;
    totalVolume: number;
    averageExecutionTime: number;
  } {
    const totalTrades = this.state.successfulTrades + this.state.failedTrades;
    const successRate = totalTrades > 0 ? (this.state.successfulTrades / totalTrades) * 100 : 0;
    
    return {
      totalTrades,
      successfulTrades: this.state.successfulTrades,
      failedTrades: this.state.failedTrades,
      successRate,
      totalVolume: this.state.totalVolumeTraded,
      averageExecutionTime: this.state.averageExecutionTime
    };
  }

  /**
   * Cleanup old data
   */
  public cleanupOldData(daysToKeep: number = 30): void {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    // Remove old trades
    const oldTradeCount = this.state.trades.length;
    this.state.trades = this.state.trades.filter(t => t.timestamp > cutoffTime);
    const removedTrades = oldTradeCount - this.state.trades.length;
    
    // Remove expired cooldowns
    const now = Date.now();
    const oldCooldownCount = this.state.cooldowns.length;
    this.state.cooldowns = this.state.cooldowns.filter(c => c.cooldownEndTime > now);
    const removedCooldowns = oldCooldownCount - this.state.cooldowns.length;
    
    if (removedTrades > 0 || removedCooldowns > 0) {
      logger.info(`🧹 Cleanup completed: removed ${removedTrades} old trades, ${removedCooldowns} expired cooldowns`);
    }
  }

  /**
   * Shutdown state manager
   */
  public async shutdown(): Promise<void> {
    try {
      logger.info('🛑 Shutting down state manager...');
      
      // Stop auto-save
      this.stopAutoSave();
      
      // Final save
      await this.saveState();
      
      logger.info('✅ State manager shutdown complete');
    } catch (error) {
      logger.error('❌ Error during state manager shutdown:', error);
      throw error;
    }
  }
}
