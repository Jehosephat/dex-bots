/**
 * Activity Service
 * 
 * Aggregates activity from various sources (trades, bridges, logs)
 * to create a unified activity feed
 */

import { TradeService, TradeLogEntry } from './tradeService';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'trade' | 'bridge' | 'balance' | 'error' | 'info';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  metadata?: {
    token?: string;
    direction?: 'forward' | 'reverse';
    txHash?: string;
    txSig?: string;
    amount?: number;
    chain?: 'galaChain' | 'solana';
    [key: string]: any;
  };
}

export class ActivityService {
  private tradeService: TradeService;
  private bridgeStatePath: string;

  constructor() {
    this.tradeService = new TradeService();
    
    // Path to bridge state
    const currentDir = __dirname;
    const botRoot = currentDir.includes('dist') 
      ? path.resolve(currentDir, '../../..')
      : path.resolve(currentDir, '../../../..');
    this.bridgeStatePath = path.join(botRoot, 'bridge-state.json');
  }

  /**
   * Get recent activity events
   */
  async getRecentActivity(limit: number = 100): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    try {
      // Get recent trades
      const trades = await this.tradeService.readTrades();
      const recentTrades = trades.slice(0, limit / 2); // Use half for trades

      for (const trade of recentTrades) {
        events.push({
          id: `trade-${trade.timestamp}`,
          timestamp: trade.timestamp,
          type: 'trade',
          level: trade.success ? 'success' : 'error',
          message: trade.success 
            ? `Trade executed: ${trade.tradeSize} ${trade.token} (${trade.direction || 'forward'})`
            : `Trade failed: ${trade.tradeSize} ${trade.token} (${trade.direction || 'forward'})`,
          metadata: {
            token: trade.token,
            direction: trade.direction,
            txHash: trade.galaChainTxHash,
            txSig: trade.solanaTxSig,
            amount: trade.tradeSize,
            mode: trade.mode,
            success: trade.success,
            edgeBps: trade.actualNetEdgeBps ?? trade.expectedNetEdgeBps
          }
        });
      }

      // Get recent bridge operations from bridge-state.json
      if (existsSync(this.bridgeStatePath)) {
        try {
          const bridgeStateContent = await fs.readFile(this.bridgeStatePath, 'utf-8');
          const bridgeState = JSON.parse(bridgeStateContent);
          
          if (bridgeState.history && Array.isArray(bridgeState.history)) {
            const recentBridges = bridgeState.history
              .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))
              .slice(0, limit / 4); // Use quarter for bridges

            for (const bridge of recentBridges) {
              const status = bridge.status || 'pending';
              events.push({
                id: `bridge-${bridge.hash || bridge.timestamp || Date.now()}`,
                timestamp: new Date(bridge.timestamp || Date.now()).toISOString(),
                type: 'bridge',
                level: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'info',
                message: `Bridge ${status}: ${bridge.amount || '?'} ${bridge.token || '?'} ${bridge.direction || ''}`,
                metadata: {
                  token: bridge.token,
                  direction: bridge.direction,
                  txHash: bridge.gcTxHash,
                  txSig: bridge.solTxSig,
                  amount: bridge.amount,
                  status: bridge.status
                }
              });
            }
          }
        } catch (e) {
          // Ignore bridge state read errors
        }
      }
    } catch (error) {
      // If we can't read trades, return empty array
      console.error('Failed to get activity:', error);
    }

    // Sort all events by timestamp (newest first)
    events.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Return limited results
    return events.slice(0, limit);
  }

  /**
   * Get activity events with filters
   */
  async getActivity(filters?: {
    type?: ActivityEvent['type'];
    level?: ActivityEvent['level'];
    token?: string;
    limit?: number;
  }): Promise<ActivityEvent[]> {
    const limit = filters?.limit || 100;
    let events = await this.getRecentActivity(limit * 2); // Get more to filter

    // Apply filters
    if (filters) {
      if (filters.type) {
        events = events.filter(e => e.type === filters.type);
      }
      if (filters.level) {
        events = events.filter(e => e.level === filters.level);
      }
      if (filters.token) {
        events = events.filter(e => e.metadata?.token === filters.token);
      }
    }

    return events.slice(0, limit);
  }
}

