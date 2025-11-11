/**
 * P&L Service
 * 
 * Calculates profit and loss from trade logs and balance data
 */

import { TradeService, TradeLogEntry } from './tradeService';
import { ConfigService } from './configService';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export interface PnLSummary {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalExpectedEdge: number; // In GALA
  totalActualEdge?: number; // In GALA (if available)
  totalExpectedEdgeBps: number;
  totalActualEdgeBps?: number; // If available
  winRate: number;
  totalVolume: number; // Total trade volume
  averageEdgeBps: number;
  totalBridgingFees: number; // In GALA (estimated)
  totalBridgingFeesUsd: number; // In USD
  netExpectedEdge: number; // totalExpectedEdge - totalBridgingFees
  netActualEdge?: number; // totalActualEdge - totalBridgingFees (if available)
  period: {
    start: string;
    end: string;
  };
}

export interface TokenPnL {
  token: string;
  trades: number;
  successfulTrades: number;
  totalExpectedEdge: number;
  totalActualEdge?: number;
  totalVolume: number;
  averageEdgeBps: number;
}

export interface PnLBreakdown {
  summary: PnLSummary;
  byToken: TokenPnL[];
  byDirection: {
    forward: PnLSummary;
    reverse: PnLSummary;
  };
  byTimePeriod: {
    today: PnLSummary;
    week: PnLSummary;
    month: PnLSummary;
    allTime: PnLSummary;
  };
}

export class PnLService {
  private tradeService: TradeService;
  private configService: ConfigService;
  private stateFilePath: string;
  private bridgeStatePath: string;

  constructor() {
    this.tradeService = new TradeService();
    this.configService = new ConfigService();
    
    // Determine bot root directory
    const currentDir = __dirname;
    const botRoot = currentDir.includes('dist') 
      ? path.resolve(currentDir, '../../..')
      : path.resolve(currentDir, '../../../..');
    this.stateFilePath = path.join(botRoot, 'state.json');
    this.bridgeStatePath = path.join(botRoot, 'bridge-state.json');
  }

  /**
   * Calculate total bridging fees for a given time period
   */
  private async calculateBridgingFees(filters?: {
    startDate?: string;
    endDate?: string;
  }): Promise<{ totalFeesGala: number; totalFeesUsd: number }> {
    try {
      // Get bridging config to get bridge cost
      const bridgingConfig = await this.configService.getBridgingConfig();
      const bridgeCostUsd = bridgingConfig.bridgeCostUsd || 1.25; // Default $1.25 USD
      
      // Read bridge state
      if (!existsSync(this.bridgeStatePath)) {
        return { totalFeesGala: 0, totalFeesUsd: 0 };
      }
      
      const bridgeStateContent = await fs.readFile(this.bridgeStatePath, 'utf-8');
      const bridgeState = JSON.parse(bridgeStateContent);
      
      if (!bridgeState.bridges || !Array.isArray(bridgeState.bridges)) {
        return { totalFeesGala: 0, totalFeesUsd: 0 };
      }
      
      // Filter bridges by date if specified
      let bridges = bridgeState.bridges;
      
      if (filters?.startDate) {
        const start = new Date(filters.startDate).getTime();
        bridges = bridges.filter((b: any) => (b.timestamp || 0) >= start);
      }
      
      if (filters?.endDate) {
        const end = new Date(filters.endDate).getTime();
        bridges = bridges.filter((b: any) => (b.timestamp || 0) <= end);
      }
      
      // Count completed bridges (or all if status is not available)
      const completedBridges = bridges.filter((b: any) => 
        !b.status || b.status === 'completed' || b.status === 'pending'
      );
      
      const totalBridges = completedBridges.length;
      const totalFeesUsd = totalBridges * bridgeCostUsd;
      
      // Estimate GALA price from state.json if available, otherwise use default
      let galaUsdPrice = 0.01; // Default fallback
      try {
        if (existsSync(this.stateFilePath)) {
          const stateContent = await fs.readFile(this.stateFilePath, 'utf-8');
          const state = JSON.parse(stateContent);
          // Try to get GALA price from state if available
          if (state.galaUsdPrice) {
            galaUsdPrice = parseFloat(state.galaUsdPrice) || 0.01;
          }
        }
      } catch (e) {
        // Use default if we can't read state
      }
      
      const totalFeesGala = totalFeesUsd / galaUsdPrice;
      
      return { totalFeesGala, totalFeesUsd };
    } catch (error) {
      console.error('Failed to calculate bridging fees:', error);
      return { totalFeesGala: 0, totalFeesUsd: 0 };
    }
  }

  /**
   * Calculate P&L summary for a given time period
   */
  async calculatePnL(filters?: {
    startDate?: string;
    endDate?: string;
    token?: string;
    direction?: 'forward' | 'reverse';
    mode?: 'live' | 'dry_run';
  }): Promise<PnLSummary> {
    const trades = await this.tradeService.readTrades();
    
    // Filter trades
    let filteredTrades = trades;
    
    if (filters?.startDate) {
      const start = new Date(filters.startDate).getTime();
      filteredTrades = filteredTrades.filter(t => new Date(t.timestamp).getTime() >= start);
    }
    
    if (filters?.endDate) {
      const end = new Date(filters.endDate).getTime();
      filteredTrades = filteredTrades.filter(t => new Date(t.timestamp).getTime() <= end);
    }
    
    if (filters?.token) {
      filteredTrades = filteredTrades.filter(t => t.token === filters.token);
    }
    
    if (filters?.direction) {
      filteredTrades = filteredTrades.filter(t => t.direction === filters.direction);
    }
    
    if (filters?.mode) {
      filteredTrades = filteredTrades.filter(t => t.mode === filters.mode);
    }

    // Calculate summary
    const totalTrades = filteredTrades.length;
    const successfulTrades = filteredTrades.filter(t => t.success).length;
    const failedTrades = totalTrades - successfulTrades;
    
    const totalExpectedEdge = filteredTrades.reduce((sum, t) => {
      return sum + (t.expectedNetEdge || 0);
    }, 0);
    
    const totalActualEdge = filteredTrades.reduce((sum, t) => {
      return sum + (t.actualNetEdge || 0);
    }, 0);
    
    const totalExpectedEdgeBps = filteredTrades.reduce((sum, t) => {
      return sum + (t.expectedNetEdgeBps || 0);
    }, 0);
    
    const totalActualEdgeBps = filteredTrades.reduce((sum, t) => {
      return sum + (t.actualNetEdgeBps || 0);
    }, 0);
    
    const totalVolume = filteredTrades.reduce((sum, t) => {
      return sum + (t.tradeSize || 0);
    }, 0);
    
    const averageEdgeBps = totalTrades > 0 ? totalExpectedEdgeBps / totalTrades : 0;
    const winRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
    
    // Calculate bridging fees for the same period
    const bridgingFees = await this.calculateBridgingFees({
      startDate: filters?.startDate,
      endDate: filters?.endDate
    });
    
    // Calculate net edge (edge minus bridging fees)
    const netExpectedEdge = totalExpectedEdge - bridgingFees.totalFeesGala;
    const netActualEdge = totalActualEdge !== 0 
      ? totalActualEdge - bridgingFees.totalFeesGala 
      : undefined;
    
    const timestamps = filteredTrades.map(t => new Date(t.timestamp).getTime());
    const start = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : new Date().toISOString();
    const end = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : new Date().toISOString();
    
    return {
      totalTrades,
      successfulTrades,
      failedTrades,
      totalExpectedEdge,
      totalActualEdge: totalActualEdge !== 0 ? totalActualEdge : undefined,
      totalExpectedEdgeBps,
      totalActualEdgeBps: totalActualEdgeBps !== 0 ? totalActualEdgeBps : undefined,
      winRate,
      totalVolume,
      averageEdgeBps,
      totalBridgingFees: bridgingFees.totalFeesGala,
      totalBridgingFeesUsd: bridgingFees.totalFeesUsd,
      netExpectedEdge,
      netActualEdge,
      period: { start, end }
    };
  }

  /**
   * Get P&L breakdown by token
   */
  async getPnLByToken(filters?: {
    startDate?: string;
    endDate?: string;
    mode?: 'live' | 'dry_run';
  }): Promise<TokenPnL[]> {
    const trades = await this.tradeService.readTrades();
    
    // Filter trades
    let filteredTrades = trades;
    
    if (filters?.startDate) {
      const start = new Date(filters.startDate).getTime();
      filteredTrades = filteredTrades.filter(t => new Date(t.timestamp).getTime() >= start);
    }
    
    if (filters?.endDate) {
      const end = new Date(filters.endDate).getTime();
      filteredTrades = filteredTrades.filter(t => new Date(t.timestamp).getTime() <= end);
    }
    
    if (filters?.mode) {
      filteredTrades = filteredTrades.filter(t => t.mode === filters.mode);
    }
    
    // Group by token
    const tokenMap = new Map<string, TradeLogEntry[]>();
    filteredTrades.forEach(trade => {
      const existing = tokenMap.get(trade.token) || [];
      existing.push(trade);
      tokenMap.set(trade.token, existing);
    });
    
    // Calculate P&L for each token
    const tokenPnL: TokenPnL[] = [];
    
    for (const [token, tokenTrades] of tokenMap) {
      const successfulTrades = tokenTrades.filter(t => t.success).length;
      const totalExpectedEdge = tokenTrades.reduce((sum, t) => sum + (t.expectedNetEdge || 0), 0);
      const totalActualEdge = tokenTrades.reduce((sum, t) => sum + (t.actualNetEdge || 0), 0);
      const totalVolume = tokenTrades.reduce((sum, t) => sum + (t.tradeSize || 0), 0);
      const totalEdgeBps = tokenTrades.reduce((sum, t) => sum + (t.expectedNetEdgeBps || 0), 0);
      const averageEdgeBps = tokenTrades.length > 0 ? totalEdgeBps / tokenTrades.length : 0;
      
      tokenPnL.push({
        token,
        trades: tokenTrades.length,
        successfulTrades,
        totalExpectedEdge,
        totalActualEdge: totalActualEdge !== 0 ? totalActualEdge : undefined,
        totalVolume,
        averageEdgeBps
      });
    }
    
    // Sort by total expected edge (descending)
    tokenPnL.sort((a, b) => b.totalExpectedEdge - a.totalExpectedEdge);
    
    return tokenPnL;
  }

  /**
   * Get comprehensive P&L breakdown
   */
  async getPnLBreakdown(filters?: {
    startDate?: string;
    endDate?: string;
    mode?: 'live' | 'dry_run';
  }): Promise<PnLBreakdown> {
    // Overall summary
    const summary = await this.calculatePnL(filters);
    
    // By token
    const byToken = await this.getPnLByToken(filters);
    
    // By direction
    const forward = await this.calculatePnL({ ...filters, direction: 'forward' });
    const reverse = await this.calculatePnL({ ...filters, direction: 'reverse' });
    
    // By time period
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const todayPnL = await this.calculatePnL({ ...filters, startDate: today });
    const weekPnL = await this.calculatePnL({ ...filters, startDate: weekAgo });
    const monthPnL = await this.calculatePnL({ ...filters, startDate: monthAgo });
    const allTimePnL = await this.calculatePnL(filters);
    
    return {
      summary,
      byToken,
      byDirection: {
        forward,
        reverse
      },
      byTimePeriod: {
        today: todayPnL,
        week: weekPnL,
        month: monthPnL,
        allTime: allTimePnL
      }
    };
  }

  /**
   * Get current inventory value from state.json
   */
  async getCurrentInventoryValue(): Promise<{
    galaChain: Record<string, number>;
    solana: Record<string, number>;
    totalUsd?: number;
    updatedAt: string;
  } | null> {
    try {
      if (!existsSync(this.stateFilePath)) {
        return null;
      }
      
      const content = await fs.readFile(this.stateFilePath, 'utf-8');
      const state = JSON.parse(content);
      
      // Check if state has inventory data
      if (state.inventory) {
        return {
          galaChain: state.inventory.galaChain || {},
          solana: state.inventory.solana || {},
          updatedAt: state.lastBalanceCheck || new Date().toISOString()
        };
      }
      
      return null;
    } catch (error) {
      console.error('Failed to read inventory from state:', error);
      return null;
    }
  }
}

