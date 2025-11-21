/**
 * Bridge State Tracker
 * 
 * Tracks bridge history, cooldowns, and rate limits for auto-bridging.
 */

import BigNumber from 'bignumber.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger';

export interface BridgeRecord {
  token: string;
  amount: BigNumber;
  direction: 'galaChain->solana' | 'solana->galaChain';
  hash: string;
  timestamp: number;
  status?: 'pending' | 'completed' | 'failed';
}

interface BridgeState {
  bridges: BridgeRecord[];
  lastBridgeTime: Record<string, number>; // token -> timestamp
  dailyBridgeCount: Record<string, number>; // token -> count
  lastResetDate: string; // YYYY-MM-DD format
}

export class BridgeStateTracker {
  private state: BridgeState;
  private stateFilePath: string;

  constructor(stateFilePath?: string) {
    this.stateFilePath = stateFilePath || join(process.cwd(), 'bridge-state.json');
    this.state = this.loadState();
  }

  /**
   * Record a bridge operation
   */
  recordBridge(
    token: string,
    amount: BigNumber,
    direction: 'galaChain->solana' | 'solana->galaChain',
    hash: string
  ): void {
    const record: BridgeRecord = {
      token,
      amount,
      direction,
      hash,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.state.bridges.push(record);
    this.state.lastBridgeTime[token] = Date.now();
    
    // Update daily count
    this.resetDailyCountsIfNeeded();
    this.state.dailyBridgeCount[token] = (this.state.dailyBridgeCount[token] || 0) + 1;

    this.saveState();
    logger.debug('Bridge recorded', { token, amount: amount.toString(), direction, hash });
  }

  /**
   * Update bridge status
   */
  updateBridgeStatus(hash: string, status: 'pending' | 'completed' | 'failed'): void {
    const bridge = this.state.bridges.find((b) => b.hash === hash);
    if (bridge) {
      bridge.status = status;
      this.saveState();
      logger.debug('Bridge status updated', { hash, status });
    }
  }

  /**
   * Get last bridge time for a token
   */
  getLastBridgeTime(token: string): number | null {
    return this.state.lastBridgeTime[token] || null;
  }

  /**
   * Get daily bridge count for a token
   */
  getBridgesToday(token: string): number {
    this.resetDailyCountsIfNeeded();
    return this.state.dailyBridgeCount[token] || 0;
  }

  /**
   * Check if token is in cooldown period
   */
  isInCooldown(token: string, cooldownMinutes: number): boolean {
    const lastTime = this.getLastBridgeTime(token);
    if (!lastTime) return false;

    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastBridge = Date.now() - lastTime;
    return timeSinceLastBridge < cooldownMs;
  }

  /**
   * Check if token has exceeded daily bridge limit
   */
  hasExceededDailyLimit(token: string, maxBridgesPerDay: number): boolean {
    const bridgesToday = this.getBridgesToday(token);
    return bridgesToday >= maxBridgesPerDay;
  }

  /**
   * Get remaining cooldown time in minutes
   */
  getRemainingCooldown(token: string, cooldownMinutes: number): number {
    const lastTime = this.getLastBridgeTime(token);
    if (!lastTime) return 0;

    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastBridge = Date.now() - lastTime;
    const remaining = cooldownMs - timeSinceLastBridge;
    
    return remaining > 0 ? Math.ceil(remaining / (60 * 1000)) : 0;
  }

  /**
   * Get bridge history for a token
   */
  getBridgeHistory(token: string, limit: number = 10): BridgeRecord[] {
    return this.state.bridges
      .filter((b) => b.token === token)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Load state from file
   */
  private loadState(): BridgeState {
    try {
      if (existsSync(this.stateFilePath)) {
        const content = readFileSync(this.stateFilePath, 'utf8');
        const bridgeState = JSON.parse(content) as BridgeState;

        // Convert amount strings back to BigNumber
        bridgeState.bridges = bridgeState.bridges.map((b: any) => ({
          ...b,
          amount: new BigNumber(b.amount),
        }));

        logger.debug('Bridge state loaded from file', { file: this.stateFilePath });
        return bridgeState;
      }
    } catch (error) {
      logger.warn('Failed to load bridge state, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      bridges: [],
      lastBridgeTime: {},
      dailyBridgeCount: {},
      lastResetDate: new Date().toISOString().split('T')[0],
    };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      const stateToSave = {
        ...this.state,
        bridges: this.state.bridges.map((b) => ({
          ...b,
          amount: b.amount.toString(), // Convert BigNumber to string for storage
        })),
      };

      writeFileSync(this.stateFilePath, JSON.stringify(stateToSave, null, 2), 'utf8');
      logger.debug('Bridge state saved to file', { file: this.stateFilePath });
    } catch (error) {
      logger.error('Failed to save bridge state', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reset daily counts if a new day has started
   */
  private resetDailyCountsIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.state.lastResetDate !== today) {
      this.state.dailyBridgeCount = {};
      this.state.lastResetDate = today;
      this.saveState();
    }
  }
}

