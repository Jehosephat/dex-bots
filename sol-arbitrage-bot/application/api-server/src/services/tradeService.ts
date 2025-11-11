/**
 * Trade Service
 * 
 * Handles reading trade logs from the bot's log files
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export interface TradeLogEntry {
  timestamp: string;
  mode: 'live' | 'dry_run';
  token: string;
  tradeSize: number;
  direction?: 'forward' | 'reverse';
  success: boolean;
  expectedGalaChainProceeds?: number;
  expectedSolanaCost?: number;
  expectedSolanaCostGala?: number;
  expectedNetEdge?: number;
  expectedNetEdgeBps?: number;
  actualGalaChainProceeds?: number;
  actualSolanaCost?: number;
  actualSolanaCostGala?: number;
  actualNetEdge?: number;
  actualNetEdgeBps?: number;
  galaChainTxHash?: string;
  solanaTxSig?: string;
  galaChainSuccess?: boolean;
  solanaSuccess?: boolean;
  galaChainError?: string;
  solanaError?: string;
  galaChainPrice?: number;
  galaChainPriceCurrency?: string;
  solanaPrice?: number;
  solanaPriceCurrency?: string;
  priceImpactGcBps?: number;
  priceImpactSolBps?: number;
  executionDurationMs?: number;
}

export interface TradeStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitGala: number;
  totalProfitUsd: number;
  averageEdgeBps: number;
  winRate: number;
}

export class TradeService {
  private botRoot: string;
  private tradesPath: string;

  constructor() {
    // Path to bot root
    const currentDir = __dirname;
    if (currentDir.includes('dist')) {
      this.botRoot = path.resolve(currentDir, '../../..');
    } else {
      // Development mode
      this.botRoot = path.resolve(currentDir, '../../../..');
    }
    this.tradesPath = path.join(this.botRoot, 'logs', 'trades.json');
  }

  /**
   * Read all trades from log file
   */
  async readTrades(): Promise<TradeLogEntry[]> {
    try {
      if (!existsSync(this.tradesPath)) {
        return [];
      }
      const content = await fs.readFile(this.tradesPath, 'utf-8');
      const trades = JSON.parse(content);
      if (!Array.isArray(trades)) {
        return [];
      }
      // Sort by timestamp descending (newest first)
      return trades.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      throw new Error(`Failed to read trades: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get trades with pagination
   */
  async getTrades(page: number = 1, limit: number = 50, filters?: {
    token?: string;
    direction?: 'forward' | 'reverse';
    success?: boolean;
    mode?: 'live' | 'dry_run';
  }): Promise<{ trades: TradeLogEntry[]; total: number; page: number; limit: number }> {
    const allTrades = await this.readTrades();
    
    // Apply filters
    let filtered = allTrades;
    if (filters) {
      if (filters.token) {
        filtered = filtered.filter(t => t.token === filters.token);
      }
      if (filters.direction) {
        filtered = filtered.filter(t => t.direction === filters.direction);
      }
      if (filters.success !== undefined) {
        filtered = filtered.filter(t => t.success === filters.success);
      }
      if (filters.mode) {
        filtered = filtered.filter(t => t.mode === filters.mode);
      }
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const trades = filtered.slice(start, end);

    return { trades, total, page, limit };
  }

  /**
   * Get trade statistics
   */
  async getStats(): Promise<TradeStats> {
    const trades = await this.readTrades();
    const liveTrades = trades.filter(t => t.mode === 'live');
    
    const successfulTrades = liveTrades.filter(t => t.success);
    const failedTrades = liveTrades.filter(t => !t.success);
    
    // Calculate total profit (using actual edge if available, otherwise expected)
    let totalProfitGala = 0;
    let totalEdgeBps = 0;
    let edgeCount = 0;

    successfulTrades.forEach(trade => {
      const edgeBps = trade.actualNetEdgeBps ?? trade.expectedNetEdgeBps ?? 0;
      if (edgeBps > 0) {
        totalEdgeBps += edgeBps;
        edgeCount++;
      }
      const profit = trade.actualNetEdge ?? trade.expectedNetEdge ?? 0;
      if (profit > 0) {
        totalProfitGala += profit;
      }
    });

    const averageEdgeBps = edgeCount > 0 ? totalEdgeBps / edgeCount : 0;
    const winRate = liveTrades.length > 0 ? (successfulTrades.length / liveTrades.length) * 100 : 0;

    // Estimate USD value (rough estimate: 1 GALA = $0.01)
    const totalProfitUsd = totalProfitGala * 0.01;

    return {
      totalTrades: liveTrades.length,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      totalProfitGala,
      totalProfitUsd,
      averageEdgeBps,
      winRate
    };
  }

  /**
   * Get trade by ID (using timestamp as ID)
   */
  async getTradeById(timestamp: string): Promise<TradeLogEntry | null> {
    const trades = await this.readTrades();
    return trades.find(t => t.timestamp === timestamp) || null;
  }
}

