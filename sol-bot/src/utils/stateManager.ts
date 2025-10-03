import fs from 'fs';
import path from 'path';
import { BotState, BridgeTransaction } from '../types';
import { logger } from './logger';

export class StateManager {
  private static instance: StateManager;
  private state: BotState;
  private statePath: string;
  private saveInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.statePath = path.join(process.cwd(), 'state.json');
    this.state = this.loadState();
    this.startAutoSave();
  }

  static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  private loadState(): BotState {
    try {
      if (fs.existsSync(this.statePath)) {
        const stateData = fs.readFileSync(this.statePath, 'utf-8');
        const loadedState = JSON.parse(stateData);
        logger.info('State loaded from disk');
        return loadedState;
      }
    } catch (error) {
      logger.warn(`Failed to load state: ${error}`);
    }

    // Return default state if file doesn't exist or fails to load
    return this.getDefaultState();
  }

  private getDefaultState(): BotState {
    return {
      isRunning: false,
      isPaused: false,
      circuitBreakerActive: false,
      startTime: Date.now(),
      totalPnL: 0,
      dailyPnL: 0,
      tradeCount: 0,
      lastTradeTime: 0,
      pendingBridges: [],
      recentFailures: 0,
      lastFailureTime: 0
    };
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error(`Failed to save state: ${error}`);
    }
  }

  private startAutoSave(): void {
    // Auto-save every 30 seconds
    this.saveInterval = setInterval(() => {
      this.saveState();
    }, 30000);
  }

  stopAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.saveState(); // Final save
  }

  // State getters
  getState(): BotState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.state.isRunning;
  }

  isPaused(): boolean {
    return this.state.isPaused;
  }

  isCircuitBreakerActive(): boolean {
    return this.state.circuitBreakerActive;
  }

  getTotalPnL(): number {
    return this.state.totalPnL;
  }

  getDailyPnL(): number {
    return this.state.dailyPnL;
  }

  getTradeCount(): number {
    return this.state.tradeCount;
  }

  getPendingBridges(): BridgeTransaction[] {
    return [...this.state.pendingBridges];
  }

  getRecentFailures(): number {
    return this.state.recentFailures;
  }

  // State setters
  setRunning(isRunning: boolean): void {
    this.state.isRunning = isRunning;
    if (isRunning && this.state.startTime === 0) {
      this.state.startTime = Date.now();
    }
    this.saveState();
  }

  setPaused(isPaused: boolean): void {
    this.state.isPaused = isPaused;
    logger.info(`Bot ${isPaused ? 'paused' : 'resumed'}`);
    this.saveState();
  }

  setCircuitBreaker(active: boolean): void {
    this.state.circuitBreakerActive = active;
    logger.warn(`Circuit breaker ${active ? 'activated' : 'deactivated'}`);
    this.saveState();
  }

  recordTrade(pnl: number): void {
    this.state.totalPnL += pnl;
    this.state.dailyPnL += pnl;
    this.state.tradeCount += 1;
    this.state.lastTradeTime = Date.now();
    this.saveState();
  }

  recordFailure(): void {
    this.state.recentFailures += 1;
    this.state.lastFailureTime = Date.now();
    this.saveState();
  }

  resetFailures(): void {
    this.state.recentFailures = 0;
    this.saveState();
  }

  addPendingBridge(bridge: BridgeTransaction): void {
    this.state.pendingBridges.push(bridge);
    this.saveState();
  }

  removePendingBridge(txId: string): void {
    this.state.pendingBridges = this.state.pendingBridges.filter(
      b => b.txId !== txId
    );
    this.saveState();
  }

  updatePendingBridge(txId: string, updates: Partial<BridgeTransaction>): void {
    const bridge = this.state.pendingBridges.find(b => b.txId === txId);
    if (bridge) {
      Object.assign(bridge, updates);
      this.saveState();
    }
  }

  resetDailyPnL(): void {
    this.state.dailyPnL = 0;
    this.saveState();
  }

  reset(): void {
    this.state = this.getDefaultState();
    this.saveState();
    logger.info('State reset to default');
  }
}

export const stateManager = StateManager.getInstance();

