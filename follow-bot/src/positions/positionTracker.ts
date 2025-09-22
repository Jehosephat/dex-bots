/**
 * Position Management System
 * 
 * Tracks and manages copied positions including swaps, liquidity provision,
 * and position monitoring with risk management and performance analytics.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/errorHandler';
import { TradeAnalysis } from '../analysis/tradeAnalyzer';

// Position management interfaces
export interface LiquidityPosition {
  id: string;
  positionId: string; // GalaChain position ID
  poolHash: string;
  token0: string;
  token1: string;
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  amount0: number;
  amount1: number;
  fee: number;
  createdAt: number;
  lastUpdated: number;
  status: 'active' | 'closed' | 'partial';
  originalWallet: string;
  copiedFrom: string;
  performance: PositionPerformance;
}

export interface PositionPerformance {
  totalFeesEarned: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalReturn: number;
  returnPercentage: number;
  duration: number; // in milliseconds
  lastPriceUpdate: number;
  currentValue: number;
  initialValue: number;
}

export interface PositionAlert {
  id: string;
  positionId: string;
  type: 'price_alert' | 'liquidity_alert' | 'fee_alert' | 'duration_alert' | 'risk_alert';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: number;
  resolved: boolean;
}

export interface PositionUpdate {
  positionId: string;
  type: 'liquidity_change' | 'fee_update' | 'price_update' | 'status_change';
  oldValue?: any;
  newValue: any;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

export interface PositionRiskMetrics {
  positionId: string;
  impermanentLoss: number;
  concentrationRisk: number;
  liquidityRisk: number;
  durationRisk: number;
  overallRisk: number;
  riskFactors: string[];
  lastCalculated: number;
}

export class PositionTracker extends EventEmitter {
  private static instance: PositionTracker;
  private errorHandler: ErrorHandler;
  
  private positions: Map<string, LiquidityPosition> = new Map();
  private positionAlerts: Map<string, PositionAlert[]> = new Map();
  private positionUpdates: Map<string, PositionUpdate[]> = new Map();
  private riskMetrics: Map<string, PositionRiskMetrics> = new Map();
  
  private monitoringInterval: NodeJS.Timeout | null = null;
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private alertCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.errorHandler = ErrorHandler.getInstance();
  }

  public static getInstance(): PositionTracker {
    if (!PositionTracker.instance) {
      PositionTracker.instance = new PositionTracker();
    }
    return PositionTracker.instance;
  }

  /**
   * Initialize the position tracker
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('📊 Initializing Position Tracker...');
      
      // Load existing positions from state
      await this.loadPositionsFromState();
      
      // Start monitoring intervals
      this.startMonitoring();
      
      // Register health check
      this.errorHandler.addHealthCheck('position-tracker', this.checkPositionTrackerHealth.bind(this));
      
      logger.info('✅ Position Tracker initialized successfully');
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        { phase: 'position_tracker_initialization' }
      );
      throw error;
    }
  }

  /**
   * Shutdown the position tracker
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Position Tracker...');
    
    this.stopMonitoring();
    await this.savePositionsToState();
    
    logger.info('✅ Position Tracker shutdown complete');
  }

  /**
   * Create a new position from a trade analysis
   */
  public async createPositionFromTrade(analysis: TradeAnalysis): Promise<LiquidityPosition | null> {
    try {
      const trade = analysis.calculatedTrade;
      
      // Only create positions for liquidity operations
      if (trade.type !== 'swap') {
        return null;
      }
      
      const positionId = this.generatePositionId();
      const now = Date.now();
      
      const position: LiquidityPosition = {
        id: positionId,
        positionId: '', // Will be set when we get the actual position ID from the transaction
        poolHash: this.extractPoolHash(analysis.originalActivity),
        token0: trade.tokenIn,
        token1: trade.tokenOut,
        tickLower: this.extractTickLower(analysis.originalActivity),
        tickUpper: this.extractTickUpper(analysis.originalActivity),
        liquidity: trade.amountIn,
        amount0: trade.amountIn,
        amount1: trade.amountOut,
        fee: this.extractFee(analysis.originalActivity),
        createdAt: now,
        lastUpdated: now,
        status: 'active',
        originalWallet: analysis.originalActivity.walletAddress,
        copiedFrom: analysis.targetWallet.address,
        performance: {
          totalFeesEarned: 0,
          unrealizedPnL: 0,
          realizedPnL: 0,
          totalReturn: 0,
          returnPercentage: 0,
          duration: 0,
          lastPriceUpdate: now,
          currentValue: trade.amountIn + trade.amountOut,
          initialValue: trade.amountIn + trade.amountOut
        }
      };
      
      this.positions.set(positionId, position);
      
      // Emit position created event
      this.emit('positionCreated', position);
      
      logger.info(`📊 Created new position: ${positionId}`, {
        token0: position.token0,
        token1: position.token1,
        liquidity: position.liquidity,
        originalWallet: position.originalWallet
      });
      
      return position;
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'create_position_from_trade' }
      );
      return null;
    }
  }

  /**
   * Update position from transaction data
   */
  public async updatePositionFromTransaction(transaction: any, blockNumber: number): Promise<void> {
    try {
      const operations = this.extractOperations(transaction);
      
      for (const operation of operations) {
        if (operation.method === 'AddLiquidity') {
          await this.handleAddLiquidity(operation, transaction, blockNumber);
        } else if (operation.method === 'RemoveLiquidity') {
          await this.handleRemoveLiquidity(operation, transaction, blockNumber);
        } else if (operation.method === 'Swap') {
          await this.handleSwap(operation, transaction, blockNumber);
        }
      }
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'update_position_from_transaction' }
      );
    }
  }

  /**
   * Handle AddLiquidity operation
   */
  private async handleAddLiquidity(operation: any, transaction: any, blockNumber: number): Promise<void> {
    try {
      const dto = operation.dto;
      const positionId = dto.positionId || this.generatePositionId();
      const poolHash = this.extractPoolHashFromTransaction(transaction);
      
      // Check if this is a new position or adding to existing
      const existingPosition = this.findPositionByPoolAndTicks(
        poolHash,
        dto.tickLower,
        dto.tickUpper,
        dto.recipient
      );
      
      if (existingPosition) {
        // Update existing position
        existingPosition.liquidity += parseFloat(dto.amount || '0');
        existingPosition.amount0 += parseFloat(dto.amount0Desired || '0');
        existingPosition.amount1 += parseFloat(dto.amount1Desired || '0');
        existingPosition.lastUpdated = Date.now();
        
        this.addPositionUpdate(existingPosition.id, {
          positionId: existingPosition.id,
          type: 'liquidity_change',
          oldValue: existingPosition.liquidity - parseFloat(dto.amount || '0'),
          newValue: existingPosition.liquidity,
          timestamp: Date.now(),
          blockNumber,
          transactionHash: transaction.id
        });
        
        this.emit('positionUpdated', existingPosition);
        
      } else {
        // Create new position
        const position: LiquidityPosition = {
          id: this.generatePositionId(),
          positionId: positionId,
          poolHash: poolHash,
          token0: dto.token0?.collection || 'Unknown',
          token1: dto.token1?.collection || 'Unknown',
          tickLower: dto.tickLower || 0,
          tickUpper: dto.tickUpper || 0,
          liquidity: parseFloat(dto.amount || '0'),
          amount0: parseFloat(dto.amount0Desired || '0'),
          amount1: parseFloat(dto.amount1Desired || '0'),
          fee: dto.fee || 10000,
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          status: 'active',
          originalWallet: dto.recipient || 'Unknown',
          copiedFrom: 'Unknown', // Will be updated when we know the source
          performance: {
            totalFeesEarned: 0,
            unrealizedPnL: 0,
            realizedPnL: 0,
            totalReturn: 0,
            returnPercentage: 0,
            duration: 0,
            lastPriceUpdate: Date.now(),
            currentValue: parseFloat(dto.amount0Desired || '0') + parseFloat(dto.amount1Desired || '0'),
            initialValue: parseFloat(dto.amount0Desired || '0') + parseFloat(dto.amount1Desired || '0')
          }
        };
        
        this.positions.set(position.id, position);
        this.emit('positionCreated', position);
      }
      
    } catch (error) {
      logger.error('❌ Error handling AddLiquidity:', error);
    }
  }

  /**
   * Handle RemoveLiquidity operation
   */
  private async handleRemoveLiquidity(operation: any, transaction: any, blockNumber: number): Promise<void> {
    try {
      const dto = operation.dto;
      const positionId = dto.positionId;
      // const poolHash = this.extractPoolHashFromTransaction(transaction);
      
      // Find the position
      const position = this.findPositionByPositionId(positionId);
      
      if (position) {
        const removedLiquidity = parseFloat(dto.amount || '0');
        const removedAmount0 = parseFloat(dto.amount0Min || '0');
        const removedAmount1 = parseFloat(dto.amount1Min || '0');
        
        // Update position
        position.liquidity -= removedLiquidity;
        position.amount0 -= removedAmount0;
        position.amount1 -= removedAmount1;
        position.lastUpdated = Date.now();
        
        // Check if position is fully closed
        if (position.liquidity <= 0) {
          position.status = 'closed';
          position.performance.realizedPnL = this.calculateRealizedPnL(position);
        } else {
          position.status = 'partial';
        }
        
        this.addPositionUpdate(position.id, {
          positionId: position.id,
          type: 'liquidity_change',
          oldValue: position.liquidity + removedLiquidity,
          newValue: position.liquidity,
          timestamp: Date.now(),
          blockNumber,
          transactionHash: transaction.id
        });
        
        this.emit('positionUpdated', position);
        
        if (position.status === 'closed') {
          this.emit('positionClosed', position);
        }
      }
      
    } catch (error) {
      logger.error('❌ Error handling RemoveLiquidity:', error);
    }
  }

  /**
   * Handle Swap operation (for tracking fees and price impact)
   */
  private async handleSwap(operation: any, transaction: any, blockNumber: number): Promise<void> {
    try {
      const dto = operation.dto;
      
      // Find positions in this pool
      const poolHash = this.extractPoolHashFromTransaction(transaction);
      const positions = this.findPositionsByPool(poolHash);
      
      for (const position of positions) {
        // Update fees earned (simplified calculation)
        const feeEarned = this.calculateFeeEarned(position, dto);
        position.performance.totalFeesEarned += feeEarned;
        position.performance.lastPriceUpdate = Date.now();
        
        this.addPositionUpdate(position.id, {
          positionId: position.id,
          type: 'fee_update',
          oldValue: position.performance.totalFeesEarned - feeEarned,
          newValue: position.performance.totalFeesEarned,
          timestamp: Date.now(),
          blockNumber,
          transactionHash: transaction.id
        });
      }
      
    } catch (error) {
      logger.error('❌ Error handling Swap:', error);
    }
  }

  /**
   * Start monitoring positions
   */
  private startMonitoring(): void {
    // Monitor positions every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.updateAllPositions();
    }, 30000);
    
    // Update prices every 5 minutes
    this.priceUpdateInterval = setInterval(async () => {
      await this.updatePositionPrices();
    }, 300000);
    
    // Check alerts every minute
    this.alertCheckInterval = setInterval(async () => {
      await this.checkPositionAlerts();
    }, 60000);
    
    logger.info('🔄 Position monitoring started');
  }

  /**
   * Stop monitoring positions
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }
    
    logger.info('🛑 Position monitoring stopped');
  }

  /**
   * Update all positions
   */
  private async updateAllPositions(): Promise<void> {
    try {
      for (const [, position] of this.positions) {
        await this.updatePositionPerformance(position);
        await this.calculatePositionRisk(position);
      }
    } catch (error) {
      logger.error('❌ Error updating positions:', error);
    }
  }

  /**
   * Update position performance metrics
   */
  private async updatePositionPerformance(position: LiquidityPosition): Promise<void> {
    try {
      const now = Date.now();
      position.performance.duration = now - position.createdAt;
      
      // Calculate current value (simplified)
      const currentValue = position.amount0 + position.amount1 + position.performance.totalFeesEarned;
      position.performance.currentValue = currentValue;
      
      // Calculate returns
      position.performance.totalReturn = currentValue - position.performance.initialValue;
      position.performance.returnPercentage = (position.performance.totalReturn / position.performance.initialValue) * 100;
      
      // Update unrealized PnL
      position.performance.unrealizedPnL = position.performance.totalReturn;
      
    } catch (error) {
      logger.error('❌ Error updating position performance:', error);
    }
  }

  /**
   * Calculate position risk metrics
   */
  private async calculatePositionRisk(position: LiquidityPosition): Promise<void> {
    try {
      const riskMetrics: PositionRiskMetrics = {
        positionId: position.id,
        impermanentLoss: this.calculateImpermanentLoss(position),
        concentrationRisk: this.calculateConcentrationRisk(position),
        liquidityRisk: this.calculateLiquidityRisk(position),
        durationRisk: this.calculateDurationRisk(position),
        overallRisk: 0,
        riskFactors: [],
        lastCalculated: Date.now()
      };
      
      // Calculate overall risk
      riskMetrics.overallRisk = (
        riskMetrics.impermanentLoss * 0.3 +
        riskMetrics.concentrationRisk * 0.25 +
        riskMetrics.liquidityRisk * 0.25 +
        riskMetrics.durationRisk * 0.2
      );
      
      // Identify risk factors
      if (riskMetrics.impermanentLoss > 0.1) {
        riskMetrics.riskFactors.push('High impermanent loss risk');
      }
      if (riskMetrics.concentrationRisk > 0.7) {
        riskMetrics.riskFactors.push('High concentration risk');
      }
      if (riskMetrics.liquidityRisk > 0.6) {
        riskMetrics.riskFactors.push('Low liquidity risk');
      }
      if (riskMetrics.durationRisk > 0.8) {
        riskMetrics.riskFactors.push('Long duration risk');
      }
      
      this.riskMetrics.set(position.id, riskMetrics);
      
    } catch (error) {
      logger.error('❌ Error calculating position risk:', error);
    }
  }

  /**
   * Check position alerts
   */
  private async checkPositionAlerts(): Promise<void> {
    try {
      for (const [positionId, position] of this.positions) {
        const riskMetrics = this.riskMetrics.get(positionId);
        if (!riskMetrics) continue;
        
        // Check for risk alerts
        if (riskMetrics.overallRisk > 0.8) {
          await this.createPositionAlert(position, 'risk_alert', 'critical', 
            `High risk detected: ${riskMetrics.overallRisk.toFixed(2)}`, riskMetrics.overallRisk);
        }
        
        // Check for duration alerts
        const durationDays = position.performance.duration / (1000 * 60 * 60 * 24);
        if (durationDays > 30) {
          await this.createPositionAlert(position, 'duration_alert', 'medium',
            `Position held for ${durationDays.toFixed(1)} days`, durationDays);
        }
        
        // Check for performance alerts
        if (position.performance.returnPercentage < -20) {
          await this.createPositionAlert(position, 'price_alert', 'high',
            `Position down ${position.performance.returnPercentage.toFixed(2)}%`, position.performance.returnPercentage);
        }
      }
    } catch (error) {
      logger.error('❌ Error checking position alerts:', error);
    }
  }

  /**
   * Create a position alert
   */
  private async createPositionAlert(
    position: LiquidityPosition,
    type: PositionAlert['type'],
    severity: PositionAlert['severity'],
    message: string,
    threshold: number
  ): Promise<void> {
    try {
      const alert: PositionAlert = {
        id: this.generateAlertId(),
        positionId: position.id,
        type,
        severity,
        message,
        threshold,
        currentValue: threshold,
        timestamp: Date.now(),
        resolved: false
      };
      
      const alerts = this.positionAlerts.get(position.id) || [];
      alerts.push(alert);
      this.positionAlerts.set(position.id, alerts);
      
      this.emit('positionAlert', alert);
      
      logger.warn(`🚨 Position Alert [${severity.toUpperCase()}]: ${message}`, {
        positionId: position.id,
        type,
        threshold
      });
      
    } catch (error) {
      logger.error('❌ Error creating position alert:', error);
    }
  }

  /**
   * Get all positions
   */
  public getPositions(): LiquidityPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by ID
   */
  public getPosition(positionId: string): LiquidityPosition | null {
    return this.positions.get(positionId) || null;
  }

  /**
   * Get positions by status
   */
  public getPositionsByStatus(status: LiquidityPosition['status']): LiquidityPosition[] {
    return this.getPositions().filter(p => p.status === status);
  }

  /**
   * Get position alerts
   */
  public getPositionAlerts(positionId?: string): PositionAlert[] {
    if (positionId) {
      return this.positionAlerts.get(positionId) || [];
    }
    
    const allAlerts: PositionAlert[] = [];
    for (const alerts of this.positionAlerts.values()) {
      allAlerts.push(...alerts);
    }
    return allAlerts;
  }

  /**
   * Get position risk metrics
   */
  public getPositionRiskMetrics(positionId: string): PositionRiskMetrics | null {
    return this.riskMetrics.get(positionId) || null;
  }

  /**
   * Get position performance summary
   */
  public getPositionPerformanceSummary(): {
    totalPositions: number;
    activePositions: number;
    totalValue: number;
    totalFeesEarned: number;
    totalReturn: number;
    averageReturn: number;
  } {
    const positions = this.getPositions();
    const activePositions = positions.filter(p => p.status === 'active');
    
    const totalValue = positions.reduce((sum, p) => sum + p.performance.currentValue, 0);
    const totalFeesEarned = positions.reduce((sum, p) => sum + p.performance.totalFeesEarned, 0);
    const totalReturn = positions.reduce((sum, p) => sum + p.performance.totalReturn, 0);
    const averageReturn = positions.length > 0 ? totalReturn / positions.length : 0;
    
    return {
      totalPositions: positions.length,
      activePositions: activePositions.length,
      totalValue,
      totalFeesEarned,
      totalReturn,
      averageReturn
    };
  }

  // Helper methods
  private generatePositionId(): string {
    return `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractOperations(transaction: any): any[] {
    try {
      if (transaction.actions && transaction.actions.length > 0) {
        const firstAction = transaction.actions[0];
        if (firstAction.args && firstAction.args.length >= 2) {
          const batchData = JSON.parse(firstAction.args[1]);
          return batchData.operations || [];
        }
      }
      return [];
    } catch (error) {
      logger.debug('Failed to extract operations:', error);
      return [];
    }
  }

  private extractPoolHash(activity: any): string {
    // Extract pool hash from activity data
    return activity.transaction?.poolHash || 'unknown';
  }

  private extractPoolHashFromTransaction(transaction: any): string {
    // Extract pool hash from transaction response
    try {
      const response = JSON.parse(transaction.chaincodeResponse?.payload || '{}');
      return response.Data?.[0]?.Data?.poolHash || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  private extractTickLower(activity: any): number {
    return activity.transaction?.tickLower || 0;
  }

  private extractTickUpper(activity: any): number {
    return activity.transaction?.tickUpper || 0;
  }

  private extractFee(activity: any): number {
    return activity.transaction?.fee || 10000;
  }

  private findPositionByPositionId(positionId: string): LiquidityPosition | null {
    for (const position of this.positions.values()) {
      if (position.positionId === positionId) {
        return position;
      }
    }
    return null;
  }

  private findPositionByPoolAndTicks(poolHash: string, tickLower: number, tickUpper: number, recipient: string): LiquidityPosition | null {
    for (const position of this.positions.values()) {
      if (position.poolHash === poolHash && 
          position.tickLower === tickLower && 
          position.tickUpper === tickUpper &&
          position.originalWallet === recipient) {
        return position;
      }
    }
    return null;
  }

  private findPositionsByPool(poolHash: string): LiquidityPosition[] {
    return Array.from(this.positions.values()).filter(p => p.poolHash === poolHash);
  }

  private calculateFeeEarned(_position: LiquidityPosition, _swapDto: any): number {
    // Simplified fee calculation
    return 0.001; // Placeholder
  }

  private calculateRealizedPnL(position: LiquidityPosition): number {
    return position.performance.currentValue - position.performance.initialValue;
  }

  private calculateImpermanentLoss(_position: LiquidityPosition): number {
    // Simplified impermanent loss calculation
    return 0.05; // Placeholder
  }

  private calculateConcentrationRisk(position: LiquidityPosition): number {
    // Calculate based on position size relative to portfolio
    const summary = this.getPositionPerformanceSummary();
    return position.performance.currentValue / summary.totalValue;
  }

  private calculateLiquidityRisk(position: LiquidityPosition): number {
    // Calculate based on tick range and liquidity
    const tickRange = position.tickUpper - position.tickLower;
    return tickRange < 1000 ? 0.8 : 0.2; // Simplified
  }

  private calculateDurationRisk(position: LiquidityPosition): number {
    const durationDays = position.performance.duration / (1000 * 60 * 60 * 24);
    return Math.min(durationDays / 30, 1); // Risk increases with duration
  }

  private addPositionUpdate(positionId: string, update: PositionUpdate): void {
    const updates = this.positionUpdates.get(positionId) || [];
    updates.push(update);
    this.positionUpdates.set(positionId, updates);
  }

  private async loadPositionsFromState(): Promise<void> {
    // Load positions from persistent state
    // Implementation would load from state manager
  }

  private async savePositionsToState(): Promise<void> {
    // Save positions to persistent state
    // Implementation would save to state manager
  }

  private async updatePositionPrices(): Promise<void> {
    // Update position prices from external sources
    // Implementation would fetch current prices
  }

  private async checkPositionTrackerHealth(): Promise<boolean> {
    try {
      return this.monitoringInterval !== null && this.positions.size < 1000;
    } catch (error) {
      logger.error('❌ Position tracker health check failed:', error);
      return false;
    }
  }
}
