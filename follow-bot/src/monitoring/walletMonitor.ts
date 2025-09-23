/**
 * Wallet Monitoring System
 * 
 * Provides comprehensive wallet activity tracking, statistics calculation,
 * and performance monitoring for target wallets.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ConfigurationManager, TargetWallet } from '../config/configManager';
import { StateManager, TradeRecord } from '../utils/stateManager';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/errorHandler';

// Wallet monitoring interfaces
export interface WalletActivity {
  walletAddress: string;
  activityType: string;
  transactionHash: string;
  timestamp: number;
  blockNumber?: string;
  transaction: any;
  detectedAt: number;
}

export interface WalletStats {
  walletAddress: string;
  name: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  totalVolume: number;
  averageTradeSize: number;
  lastActivity: number;
  lastTradeTime: number;
  activePositions: number;
  totalProfit: number;
  winRate: number;
  averageHoldTime: number;
  riskScore: number;
  performanceScore: number;
}

export interface WalletPerformance {
  walletAddress: string;
  period: '1h' | '24h' | '7d' | '30d';
  trades: number;
  volume: number;
  profit: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
}

export interface WalletAlert {
  id: string;
  walletAddress: string;
  type: 'high_volume' | 'unusual_activity' | 'performance_drop' | 'risk_increase' | 'inactive';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface WalletActivityPattern {
  walletAddress: string;
  pattern: 'frequent_trader' | 'swing_trader' | 'scalper' | 'hodler' | 'arbitrageur' | 'unknown';
  confidence: number;
  characteristics: {
    averageTradeSize: number;
    tradeFrequency: number;
    holdTime: number;
    tokenDiversity: number;
    riskTolerance: number;
  };
}

export class WalletMonitor extends EventEmitter {
  private static instance: WalletMonitor;
  private configManager: ConfigurationManager;
  private stateManager: StateManager;
  private errorHandler: ErrorHandler;
  private walletStats: Map<string, WalletStats> = new Map();
  private walletPerformance: Map<string, WalletPerformance[]> = new Map();
  private walletAlerts: WalletAlert[] = [];
  private activityPatterns: Map<string, WalletActivityPattern> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private alertCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.configManager = ConfigurationManager.getInstance();
    this.stateManager = StateManager.getInstance();
    this.errorHandler = ErrorHandler.getInstance();
  }

  public static getInstance(): WalletMonitor {
    if (!WalletMonitor.instance) {
      WalletMonitor.instance = new WalletMonitor();
    }
    return WalletMonitor.instance;
  }

  /**
   * Initialize the wallet monitoring system
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('👥 Initializing Wallet Monitor...');
      
      // Load initial wallet configurations
      await this.loadWalletConfigurations();
      
      // Initialize wallet statistics
      await this.initializeWalletStats();
      
      // Start monitoring intervals
      this.startMonitoring();
      
      // Register health check
      this.errorHandler.addHealthCheck('wallet-monitor', this.checkWalletMonitorHealth.bind(this));
      
      logger.info('✅ Wallet Monitor initialized successfully');
      logger.info(`📊 Monitoring ${this.walletStats.size} target wallets`);
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        { phase: 'wallet_monitor_initialization' }
      );
      throw error;
    }
  }

  /**
   * Shutdown the wallet monitoring system
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Wallet Monitor...');
    
    this.stopMonitoring();
    
    // Save final statistics
    await this.saveWalletStats();
    
    logger.info('✅ Wallet Monitor shutdown complete');
  }

  /**
   * Load wallet configurations from config manager
   */
  private async loadWalletConfigurations(): Promise<void> {
    const walletConfig = this.configManager.getWalletConfig();
    const enabledWallets = walletConfig.targetWallets.filter(w => w.enabled);
    
    logger.info(`📋 Loaded ${enabledWallets.length} enabled target wallets`);
    
    for (const wallet of enabledWallets) {
      this.initializeWalletStatsForWallet(wallet);
    }
  }

  /**
   * Initialize wallet statistics for a specific wallet
   */
  private initializeWalletStatsForWallet(wallet: TargetWallet): void {
    const stats: WalletStats = {
      walletAddress: wallet.address,
      name: wallet.name,
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      successRate: 0,
      totalVolume: 0,
      averageTradeSize: 0,
      lastActivity: Date.now(),
      lastTradeTime: Date.now(),
      activePositions: 0,
      totalProfit: 0,
      winRate: 0,
      averageHoldTime: 0,
      riskScore: 0,
      performanceScore: 0
    };
    
    this.walletStats.set(wallet.address, stats);
    logger.debug(`📊 Initialized stats for wallet: ${wallet.name} (${wallet.address})`);
  }

  /**
   * Initialize wallet statistics from existing state
   */
  private async initializeWalletStats(): Promise<void> {
    const state = this.stateManager.getState();
    
    // Calculate statistics from existing trades
    for (const trade of state.trades) {
      await this.updateWalletStatsFromTrade(trade);
    }
    
    // Calculate performance metrics
    for (const [walletAddress, stats] of this.walletStats.entries()) {
      await this.calculatePerformanceMetrics(walletAddress, stats);
    }
    
    logger.info(`📈 Initialized wallet statistics from ${state.trades.length} existing trades`);
  }

  /**
   * Start monitoring intervals
   */
  private startMonitoring(): void {
    // Update wallet statistics every 5 minutes
    this.updateInterval = setInterval(async () => {
      await this.updateAllWalletStats();
    }, 5 * 60 * 1000);
    
    // Check for alerts every 2 minutes
    this.alertCheckInterval = setInterval(async () => {
      await this.checkForAlerts();
    }, 2 * 60 * 1000);
    
    logger.info('🔄 Wallet monitoring intervals started');
  }

  /**
   * Stop monitoring intervals
   */
  private stopMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }
    
    logger.info('🛑 Wallet monitoring intervals stopped');
  }

  /**
   * Process wallet activity from transaction monitor
   */
  public async processWalletActivity(activity: WalletActivity): Promise<void> {
    try {
      const walletAddress = activity.walletAddress;
      // Find stats by case-insensitive comparison
      let stats = this.walletStats.get(walletAddress);
      if (!stats) {
        // Try to find with different case
        for (const [storedAddress, storedStats] of this.walletStats.entries()) {
          if (storedAddress.toLowerCase() === walletAddress.toLowerCase()) {
            stats = storedStats;
            break;
          }
        }
      }
      
      if (!stats) {
        logger.warn(`⚠️ Received activity for unmonitored wallet: ${walletAddress}`);
        return;
      }
      
      // Update basic statistics
      stats.lastActivity = Date.now();
      
      // Update trade-specific statistics if this is a trade
      if (activity.activityType === 'swap') {
        stats.lastTradeTime = Date.now();
        await this.updateStatsFromActivity(stats, activity);
      }
      
      // Analyze activity pattern
      await this.analyzeActivityPattern(walletAddress, activity);
      
      // Emit wallet activity event
      this.emit('walletActivity', {
        wallet: stats,
        activity: activity,
        timestamp: Date.now()
      });
      
      logger.debug(`📊 Updated stats for wallet: ${stats.name}`, { activity: activity.activityType });
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'process_wallet_activity', walletAddress: activity.walletAddress }
      );
    }
  }

  /**
   * Update wallet statistics from a trade record
   */
  private async updateWalletStatsFromTrade(trade: TradeRecord): Promise<void> {
    const stats = this.walletStats.get(trade.targetWallet);
    if (!stats) return;
    
    stats.totalTrades++;
    stats.totalVolume += trade.originalTrade.amountIn;
    
    if (trade.copiedTrade.status === 'completed') {
      stats.successfulTrades++;
    } else if (trade.copiedTrade.status === 'failed') {
      stats.failedTrades++;
    }
    
    // Calculate derived metrics
    stats.successRate = stats.totalTrades > 0 ? (stats.successfulTrades / stats.totalTrades) * 100 : 0;
    stats.averageTradeSize = stats.totalTrades > 0 ? stats.totalVolume / stats.totalTrades : 0;
  }

  /**
   * Update statistics from wallet activity
   */
  private async updateStatsFromActivity(stats: WalletStats, activity: WalletActivity): Promise<void> {
    // Update volume if this is a trade activity
    if (activity.transaction && activity.transaction.amountIn) {
      const amount = parseFloat(activity.transaction.amountIn.toString());
      if (!isNaN(amount)) {
        stats.totalVolume += amount;
      }
    }
    
    // Update last activity time
    stats.lastActivity = Date.now();
  }

  /**
   * Calculate performance metrics for a wallet
   */
  private async calculatePerformanceMetrics(walletAddress: string, stats: WalletStats): Promise<void> {
    try {
      // Calculate risk score based on trade frequency and size
      const riskScore = this.calculateRiskScore(stats);
      stats.riskScore = riskScore;
      
      // Calculate performance score based on success rate and volume
      const performanceScore = this.calculatePerformanceScore(stats);
      stats.performanceScore = performanceScore;
      
      // Calculate win rate (simplified - would need more data for accurate calculation)
      stats.winRate = stats.successRate; // Placeholder
      
      // Calculate average hold time (simplified)
      stats.averageHoldTime = this.calculateAverageHoldTime(walletAddress);
      
      logger.debug(`📈 Calculated metrics for wallet: ${stats.name}`, {
        riskScore,
        performanceScore,
        winRate: stats.winRate
      });
      
    } catch (error) {
      logger.error(`❌ Error calculating performance metrics for wallet ${walletAddress}:`, error);
    }
  }

  /**
   * Calculate risk score for a wallet
   */
  private calculateRiskScore(stats: WalletStats): number {
    let riskScore = 0;
    
    // Base risk from trade frequency
    const tradesPerDay = stats.totalTrades / 30; // Assuming 30 days
    if (tradesPerDay > 10) riskScore += 30;
    else if (tradesPerDay > 5) riskScore += 20;
    else if (tradesPerDay > 2) riskScore += 10;
    
    // Risk from average trade size
    if (stats.averageTradeSize > 1000) riskScore += 25;
    else if (stats.averageTradeSize > 500) riskScore += 15;
    else if (stats.averageTradeSize > 100) riskScore += 5;
    
    // Risk from success rate
    if (stats.successRate < 50) riskScore += 20;
    else if (stats.successRate < 70) riskScore += 10;
    
    return Math.min(riskScore, 100); // Cap at 100
  }

  /**
   * Calculate performance score for a wallet
   */
  private calculatePerformanceScore(stats: WalletStats): number {
    let performanceScore = 0;
    
    // Base score from success rate
    performanceScore += stats.successRate * 0.4;
    
    // Bonus for high volume
    if (stats.totalVolume > 10000) performanceScore += 20;
    else if (stats.totalVolume > 5000) performanceScore += 15;
    else if (stats.totalVolume > 1000) performanceScore += 10;
    
    // Bonus for consistent trading
    if (stats.totalTrades > 50) performanceScore += 15;
    else if (stats.totalTrades > 20) performanceScore += 10;
    else if (stats.totalTrades > 10) performanceScore += 5;
    
    return Math.min(performanceScore, 100); // Cap at 100
  }

  /**
   * Calculate average hold time for a wallet
   */
  private calculateAverageHoldTime(walletAddress: string): number {
    // Simplified calculation - would need more detailed trade data
    const stats = this.walletStats.get(walletAddress);
    if (!stats || stats.totalTrades === 0) return 0;
    
    // Placeholder calculation based on trade frequency
    const daysSinceFirstTrade = 30; // Placeholder
    return daysSinceFirstTrade / stats.totalTrades;
  }

  /**
   * Analyze activity pattern for a wallet
   */
  private async analyzeActivityPattern(walletAddress: string, _activity: WalletActivity): Promise<void> {
    try {
      const stats = this.walletStats.get(walletAddress);
      if (!stats) return;
      
      // Determine trading pattern based on characteristics
      let pattern: WalletActivityPattern['pattern'] = 'unknown';
      let confidence = 0.5;
      
      const characteristics = {
        averageTradeSize: stats.averageTradeSize,
        tradeFrequency: stats.totalTrades / 30, // trades per day
        holdTime: stats.averageHoldTime,
        tokenDiversity: 1, // Placeholder
        riskTolerance: stats.riskScore / 100
      };
      
      // Pattern classification logic
      if (characteristics.tradeFrequency > 10 && characteristics.averageTradeSize < 100) {
        pattern = 'scalper';
        confidence = 0.8;
      } else if (characteristics.tradeFrequency > 5 && characteristics.averageTradeSize < 500) {
        pattern = 'frequent_trader';
        confidence = 0.7;
      } else if (characteristics.holdTime > 7) {
        pattern = 'swing_trader';
        confidence = 0.6;
      } else if (characteristics.holdTime > 30) {
        pattern = 'hodler';
        confidence = 0.7;
      }
      
      const activityPattern: WalletActivityPattern = {
        walletAddress,
        pattern,
        confidence,
        characteristics
      };
      
      this.activityPatterns.set(walletAddress, activityPattern);
      
      logger.debug(`🔍 Analyzed activity pattern for wallet: ${stats.name}`, {
        pattern,
        confidence,
        characteristics
      });
      
    } catch (error) {
      logger.error(`❌ Error analyzing activity pattern for wallet ${walletAddress}:`, error);
    }
  }

  /**
   * Update all wallet statistics
   */
  private async updateAllWalletStats(): Promise<void> {
    try {
      for (const [walletAddress, stats] of this.walletStats.entries()) {
        await this.calculatePerformanceMetrics(walletAddress, stats);
      }
      
      logger.debug('📊 Updated all wallet statistics');
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'update_all_wallet_stats' }
      );
    }
  }

  /**
   * Check for wallet alerts
   */
  private async checkForAlerts(): Promise<void> {
    try {
      const newAlerts: WalletAlert[] = [];
      
      for (const [walletAddress, stats] of this.walletStats.entries()) {
        // Check for high volume alert
        if (stats.totalVolume > 50000) {
          newAlerts.push({
            id: `high_volume_${walletAddress}_${Date.now()}`,
            walletAddress,
            type: 'high_volume',
            severity: 'medium',
            message: `High trading volume detected: ${stats.totalVolume.toFixed(2)}`,
            timestamp: Date.now(),
            data: { volume: stats.totalVolume }
          });
        }
        
        // Check for performance drop alert
        if (stats.successRate < 30 && stats.totalTrades > 10) {
          newAlerts.push({
            id: `performance_drop_${walletAddress}_${Date.now()}`,
            walletAddress,
            type: 'performance_drop',
            severity: 'high',
            message: `Low success rate detected: ${stats.successRate.toFixed(1)}%`,
            timestamp: Date.now(),
            data: { successRate: stats.successRate }
          });
        }
        
        // Check for inactive wallet alert
        const hoursSinceLastActivity = (Date.now() - stats.lastActivity) / (1000 * 60 * 60);
        // Only alert if wallet has had actual activity and has been inactive for more than 24 hours
        if (hoursSinceLastActivity > 72 && stats.totalTrades > 0 && stats.lastActivity > 0) {
          logger.debug(`🔍 Inactive wallet check: ${walletAddress} - Last activity: ${new Date(stats.lastActivity).toISOString()}, Hours since: ${hoursSinceLastActivity.toFixed(1)}`);
          newAlerts.push({
            id: `inactive_${walletAddress}_${Date.now()}`,
            walletAddress,
            type: 'inactive',
            severity: 'low',
            message: `Wallet inactive for ${hoursSinceLastActivity.toFixed(1)} hours`,
            timestamp: Date.now(),
            data: { hoursSinceLastActivity }
          });
        }
      }
      
      // Add new alerts
      this.walletAlerts.push(...newAlerts);
      
      // Emit alerts
      for (const alert of newAlerts) {
        this.emit('walletAlert', alert);
        logger.warn(`🚨 Wallet Alert: ${alert.message}`, { alert });
      }
      
      // Clean up old alerts (keep last 100)
      if (this.walletAlerts.length > 100) {
        this.walletAlerts = this.walletAlerts.slice(-100);
      }
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'check_wallet_alerts' }
      );
    }
  }

  /**
   * Get wallet statistics
   */
  public getWalletStats(walletAddress?: string): WalletStats | Map<string, WalletStats> | null {
    if (walletAddress) {
      // Try exact match first
      let stats = this.walletStats.get(walletAddress);
      if (!stats) {
        // Try case-insensitive match
        for (const [storedAddress, storedStats] of this.walletStats.entries()) {
          if (storedAddress.toLowerCase() === walletAddress.toLowerCase()) {
            stats = storedStats;
            break;
          }
        }
      }
      return stats || null;
    }
    return this.walletStats;
  }

  /**
   * Get wallet performance data
   */
  public getWalletPerformance(walletAddress: string, period?: '1h' | '24h' | '7d' | '30d'): WalletPerformance[] {
    const performance = this.walletPerformance.get(walletAddress) || [];
    if (period) {
      return performance.filter(p => p.period === period);
    }
    return performance;
  }

  /**
   * Get wallet alerts
   */
  public getWalletAlerts(walletAddress?: string, severity?: WalletAlert['severity']): WalletAlert[] {
    let alerts = this.walletAlerts;
    
    if (walletAddress) {
      alerts = alerts.filter(alert => alert.walletAddress === walletAddress);
    }
    
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }
    
    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get wallet activity patterns
   */
  public getWalletActivityPatterns(): Map<string, WalletActivityPattern> {
    return this.activityPatterns;
  }

  /**
   * Get top performing wallets
   */
  public getTopPerformingWallets(limit: number = 10): WalletStats[] {
    return Array.from(this.walletStats.values())
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, limit);
  }

  /**
   * Get wallets by risk level
   */
  public getWalletsByRiskLevel(riskLevel: 'low' | 'medium' | 'high'): WalletStats[] {
    const riskThresholds = {
      low: [0, 30],
      medium: [30, 70],
      high: [70, 100]
    };
    
    const [min, max] = riskThresholds[riskLevel];
    
    return Array.from(this.walletStats.values())
      .filter(stats => stats.riskScore >= min! && stats.riskScore < max!);
  }

  /**
   * Save wallet statistics to state
   */
  private async saveWalletStats(): Promise<void> {
    try {
      // This would typically save to a persistent store
      // For now, we'll just log the current state
      logger.debug('💾 Saving wallet statistics', {
        totalWallets: this.walletStats.size,
        totalAlerts: this.walletAlerts.length
      });
      
    } catch (error) {
      logger.error('❌ Error saving wallet statistics:', error);
    }
  }

  /**
   * Health check for wallet monitor
   */
  private async checkWalletMonitorHealth(): Promise<boolean> {
    try {
      // Check if monitoring intervals are running
      if (!this.updateInterval || !this.alertCheckInterval) {
        return false;
      }
      
      // Check if we have wallet statistics
      if (this.walletStats.size === 0) {
        return false;
      }
      
      return true;
      
    } catch (error) {
      logger.error('❌ Wallet monitor health check failed:', error);
      return false;
    }
  }

  /**
   * Get monitoring summary
   */
  public getMonitoringSummary(): {
    totalWallets: number;
    activeWallets: number;
    totalAlerts: number;
    criticalAlerts: number;
    averagePerformanceScore: number;
    averageRiskScore: number;
  } {
    const stats = Array.from(this.walletStats.values());
    const now = Date.now();
    const activeThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    const activeWallets = stats.filter(s => (now - s.lastActivity) < activeThreshold).length;
    const criticalAlerts = this.walletAlerts.filter(a => a.severity === 'critical').length;
    
    const averagePerformanceScore = stats.length > 0 
      ? stats.reduce((sum, s) => sum + s.performanceScore, 0) / stats.length 
      : 0;
    
    const averageRiskScore = stats.length > 0 
      ? stats.reduce((sum, s) => sum + s.riskScore, 0) / stats.length 
      : 0;
    
    return {
      totalWallets: stats.length,
      activeWallets,
      totalAlerts: this.walletAlerts.length,
      criticalAlerts,
      averagePerformanceScore,
      averageRiskScore
    };
  }
}
