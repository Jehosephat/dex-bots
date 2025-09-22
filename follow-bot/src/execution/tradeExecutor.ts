/**
 * Trade Execution Engine
 * 
 * Executes approved trades using the GSwap SDK with proper error handling,
 * slippage protection, retry logic, and execution monitoring.
 */

import { EventEmitter } from 'events';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from '../utils/logger';
import { ConfigurationManager } from '../config/configManager';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/errorHandler';
import { TradeAnalysis, CalculatedTrade } from '../analysis/tradeAnalyzer';

// Trade execution interfaces
export interface TradeExecution {
  id: string;
  analysisId: string;
  trade: CalculatedTrade;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  executionStrategy: ExecutionStrategy;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: TradeExecutionResult;
  error?: string;
  retryDelay?: number;
}

export interface TradeExecutionResult {
  success: boolean;
  transactionId?: string;
  actualAmountIn: number;
  actualAmountOut: number;
  feeTier?: string;
  gasUsed?: number;
  executionTime: number;
  slippage: number;
  priceImpact: number;
  error?: string;
}

export interface ExecutionStrategy {
  type: 'immediate' | 'delayed' | 'conditional' | 'scheduled';
  delay?: number; // milliseconds
  condition?: ExecutionCondition;
  scheduleTime?: number; // timestamp
  maxSlippage?: number;
  maxPriceImpact?: number;
  retryPolicy?: RetryPolicy;
}

export interface ExecutionCondition {
  type: 'price_threshold' | 'volume_threshold' | 'time_threshold' | 'market_condition';
  value: number;
  operator: 'greater_than' | 'less_than' | 'equals';
  token?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface ExecutionMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  averageSlippage: number;
  totalVolumeExecuted: number;
  lastExecutionTime: number;
}

export class TradeExecutor extends EventEmitter {
  private static instance: TradeExecutor;
  private configManager: ConfigurationManager;
  private errorHandler: ErrorHandler;
  private gSwap: GSwap | null = null;
  
  private executions: Map<string, TradeExecution> = new Map();
  private executionQueue: TradeExecution[] = [];
  private processingInterval: NodeJS.Timeout | null = null;
  private metrics: ExecutionMetrics;
  
  private privateKey: string = '';
  private walletAddress: string = '';

  private constructor() {
    super();
    this.configManager = ConfigurationManager.getInstance();
    this.errorHandler = ErrorHandler.getInstance();
    
    this.metrics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      averageSlippage: 0,
      totalVolumeExecuted: 0,
      lastExecutionTime: 0
    };
  }

  public static getInstance(): TradeExecutor {
    if (!TradeExecutor.instance) {
      TradeExecutor.instance = new TradeExecutor();
    }
    return TradeExecutor.instance;
  }

  /**
   * Initialize the trade executor
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('🚀 Initializing Trade Executor...');
      
      // Load configuration
      const envConfig = this.configManager.getEnvironmentConfig();
      this.privateKey = envConfig.privateKey;
      this.walletAddress = envConfig.walletAddress;
      
      if (!this.privateKey || !this.walletAddress) {
        throw new Error('Private key and wallet address are required for trade execution');
      }
      
      // Initialize GSwap SDK
      await this.initializeGSwap();
      
      // Start execution processing
      this.startExecutionProcessing();
      
      // Register health check
      this.errorHandler.addHealthCheck('trade-executor', this.checkTradeExecutorHealth.bind(this));
      
      logger.info('✅ Trade Executor initialized successfully');
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        { phase: 'trade_executor_initialization' }
      );
      throw error;
    }
  }

  /**
   * Shutdown the trade executor
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Trade Executor...');
    
    this.stopExecutionProcessing();
    
    // Cancel pending executions
    for (const execution of this.executions.values()) {
      if (execution.status === 'pending' || execution.status === 'executing') {
        execution.status = 'cancelled';
        this.emit('executionCancelled', execution);
      }
    }
    
    logger.info('✅ Trade Executor shutdown complete');
  }

  /**
   * Execute a trade from trade analysis
   */
  public async executeTrade(analysis: TradeAnalysis): Promise<TradeExecution> {
    try {
      const executionId = this.generateExecutionId();
      const execution: TradeExecution = {
        id: executionId,
        analysisId: analysis.id,
        trade: analysis.calculatedTrade,
        status: 'pending',
        executionStrategy: this.determineExecutionStrategy(analysis),
        attempts: 0,
        maxAttempts: 3,
        createdAt: Date.now()
      };
      
      this.executions.set(executionId, execution);
      this.executionQueue.push(execution);
      
      this.emit('executionQueued', execution);
      
      logger.info(`🚀 Trade execution queued: ${executionId}`, {
        trade: `${execution.trade.amountIn} ${execution.trade.tokenIn} → ${execution.trade.amountOut} ${execution.trade.tokenOut}`,
        strategy: execution.executionStrategy.type
      });
      
      return execution;
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'execute_trade', analysisId: analysis.id }
      );
      throw error;
    }
  }

  /**
   * Initialize GSwap SDK
   */
  private async initializeGSwap(): Promise<void> {
    try {
      const signer = new PrivateKeySigner(this.privateKey);
      this.gSwap = new GSwap({ signer });
      
      logger.info('✅ GSwap SDK initialized successfully');
      
    } catch (error) {
      logger.error('❌ Failed to initialize GSwap SDK:', error);
      throw error;
    }
  }

  /**
   * Start execution processing
   */
  private startExecutionProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    this.processingInterval = setInterval(async () => {
      await this.processExecutionQueue();
    }, 1000); // Process every second
    
    logger.info('🔄 Trade execution processing started');
  }

  /**
   * Stop execution processing
   */
  private stopExecutionProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    logger.info('🛑 Trade execution processing stopped');
  }

  /**
   * Process the execution queue
   */
  private async processExecutionQueue(): Promise<void> {
    if (this.executionQueue.length === 0) {
      return;
    }
    
    const execution = this.executionQueue.shift();
    if (!execution) return;
    
    try {
      // Check if execution should proceed
      if (!await this.shouldExecute(execution)) {
        // Re-queue for later processing
        this.executionQueue.push(execution);
        return;
      }
      
      // Execute the trade
      await this.executeTradeInternal(execution);
      
    } catch (error) {
      logger.error('❌ Error processing execution:', error);
      execution.status = 'failed';
      execution.error = (error as Error).message;
      this.emit('executionFailed', execution);
    }
  }

  /**
   * Check if execution should proceed
   */
  private async shouldExecute(execution: TradeExecution): Promise<boolean> {
    const strategy = execution.executionStrategy;
    const now = Date.now();
    
    // Check execution delay
    if (strategy.delay && (now - execution.createdAt) < strategy.delay) {
      return false;
    }
    
    // Check scheduled time
    if (strategy.scheduleTime && now < strategy.scheduleTime) {
      return false;
    }
    
    // Check conditions
    if (strategy.condition) {
      return await this.evaluateCondition(strategy.condition);
    }
    
    return true;
  }

  /**
   * Evaluate execution condition
   */
  private async evaluateCondition(_condition: ExecutionCondition): Promise<boolean> {
    // Placeholder for condition evaluation
    // In a real implementation, this would check market conditions, prices, etc.
    return true;
  }

  /**
   * Execute trade internally
   */
  private async executeTradeInternal(execution: TradeExecution): Promise<void> {
    try {
      execution.status = 'executing';
      execution.startedAt = Date.now();
      execution.attempts++;
      
      this.emit('executionStarted', execution);
      
      logger.info(`🚀 Executing trade: ${execution.id}`, {
        attempt: execution.attempts,
        trade: `${execution.trade.amountIn} ${execution.trade.tokenIn} → ${execution.trade.amountOut} ${execution.trade.tokenOut}`
      });
      
      // Get quote
      const quote = await this.getQuote(execution.trade);
      
      // Validate slippage
      if (!this.validateSlippage(execution, quote)) {
        throw new Error('Slippage exceeds maximum tolerance');
      }
      
      // Execute the swap
      const result = await this.executeSwap(execution, quote);
      
      // Update execution
      execution.status = 'completed';
      execution.completedAt = Date.now();
      execution.result = result;
      
      // Update metrics
      this.updateMetrics(result);
      
      this.emit('executionCompleted', execution);
      
      logger.info(`✅ Trade execution completed: ${execution.id}`, {
        transactionId: result.transactionId,
        actualAmountOut: result.actualAmountOut,
        slippage: `${(result.slippage * 100).toFixed(2)}%`,
        executionTime: `${result.executionTime}ms`
      });
      
    } catch (error) {
      await this.handleExecutionError(execution, error as Error);
    }
  }

  /**
   * Get quote for trade
   */
  private async getQuote(trade: CalculatedTrade): Promise<any> {
    if (!this.gSwap) {
      throw new Error('GSwap SDK not initialized');
    }
    
    const tokenIn = this.formatTokenAddress(trade.tokenIn);
    const tokenOut = this.formatTokenAddress(trade.tokenOut);
    
    const quote = await this.gSwap.quoting.quoteExactInput(
      tokenIn,
      tokenOut,
      trade.amountIn
    );
    
    return quote;
  }

  /**
   * Validate slippage
   */
  private validateSlippage(execution: TradeExecution, quote: any): boolean {
    const expectedAmountOut = execution.trade.amountOut;
    const actualAmountOut = quote.outTokenAmount.toNumber();
    const slippage = Math.abs(actualAmountOut - expectedAmountOut) / expectedAmountOut;
    
    const maxSlippage = execution.executionStrategy.maxSlippage || execution.trade.maxSlippage;
    
    return slippage <= maxSlippage;
  }

  /**
   * Execute the swap
   */
  private async executeSwap(execution: TradeExecution, quote: any): Promise<TradeExecutionResult> {
    if (!this.gSwap) {
      throw new Error('GSwap SDK not initialized');
    }
    
    const startTime = Date.now();
    const trade = execution.trade;
    
    const tokenIn = this.formatTokenAddress(trade.tokenIn);
    const tokenOut = this.formatTokenAddress(trade.tokenOut);
    
    // Calculate minimum output with slippage protection
    const amountOutMinimum = quote.outTokenAmount.multipliedBy(1 - trade.maxSlippage);
    
    // Execute the swap
    const result = await this.gSwap.swaps.swap(
      tokenIn,
      tokenOut,
      quote.feeTier,
      {
        exactIn: trade.amountIn,
        amountOutMinimum: amountOutMinimum
      },
      this.walletAddress
    );
    
    const executionTime = Date.now() - startTime;
    const actualAmountOut = quote.outTokenAmount.toNumber();
    const slippage = Math.abs(actualAmountOut - trade.amountOut) / trade.amountOut;
    const priceImpact = 0; // Placeholder - would need to calculate actual price impact
    
    return {
      success: true,
      transactionId: result.transactionId,
      actualAmountIn: trade.amountIn,
      actualAmountOut: actualAmountOut,
      feeTier: quote.feeTier,
      executionTime: executionTime,
      slippage: slippage,
      priceImpact: priceImpact
    };
  }

  /**
   * Handle execution error
   */
  private async handleExecutionError(execution: TradeExecution, error: Error): Promise<void> {
    const retryPolicy = execution.executionStrategy.retryPolicy;
    
    // Check if error is retryable
    const isRetryable = retryPolicy?.retryableErrors.some(retryableError => 
      error.message.toLowerCase().includes(retryableError.toLowerCase())
    ) || false;
    
    if (isRetryable && execution.attempts < execution.maxAttempts) {
      // Calculate retry delay
      const delay = this.calculateRetryDelay(execution.attempts, retryPolicy!);
      execution.retryDelay = delay;
      
      // Re-queue for retry
      setTimeout(() => {
        this.executionQueue.push(execution);
      }, delay);
      
      logger.warn(`⚠️ Trade execution failed, retrying: ${execution.id}`, {
        attempt: execution.attempts,
        error: error.message,
        retryDelay: delay
      });
      
    } else {
      // Mark as failed
      execution.status = 'failed';
      execution.error = error.message;
      execution.completedAt = Date.now();
      
      this.metrics.failedExecutions++;
      
      this.emit('executionFailed', execution);
      
      logger.error(`❌ Trade execution failed: ${execution.id}`, {
        error: error.message,
        attempts: execution.attempts
      });
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, retryPolicy: RetryPolicy): number {
    const delay = retryPolicy.baseDelay * Math.pow(retryPolicy.backoffMultiplier, attempt - 1);
    return Math.min(delay, retryPolicy.maxDelay);
  }

  /**
   * Determine execution strategy
   */
  private determineExecutionStrategy(analysis: TradeAnalysis): ExecutionStrategy {
    const envConfig = this.configManager.getEnvironmentConfig();
    
    return {
      type: 'immediate',
      delay: envConfig.executionDelay * 1000, // Convert to milliseconds
      maxSlippage: analysis.calculatedTrade.maxSlippage,
      maxPriceImpact: 0.05, // 5% max price impact
      retryPolicy: {
        maxAttempts: 3,
        baseDelay: 1000, // 1 second
        maxDelay: 30000, // 30 seconds
        backoffMultiplier: 2,
        retryableErrors: ['network', 'timeout', 'gas', 'slippage']
      }
    };
  }

  /**
   * Update execution metrics
   */
  private updateMetrics(result: TradeExecutionResult): void {
    this.metrics.totalExecutions++;
    this.metrics.successfulExecutions++;
    this.metrics.lastExecutionTime = Date.now();
    
    // Update average execution time
    this.metrics.averageExecutionTime = 
      (this.metrics.averageExecutionTime * (this.metrics.successfulExecutions - 1) + result.executionTime) / 
      this.metrics.successfulExecutions;
    
    // Update average slippage
    this.metrics.averageSlippage = 
      (this.metrics.averageSlippage * (this.metrics.successfulExecutions - 1) + result.slippage) / 
      this.metrics.successfulExecutions;
    
    // Update total volume
    this.metrics.totalVolumeExecuted += result.actualAmountIn;
  }

  /**
   * Format token address for GSwap SDK
   */
  private formatTokenAddress(token: string): string {
    // Convert token symbol to GSwap format
    const tokenMap: Record<string, string> = {
      'GALA': 'GALA|Unit|none|none',
      'GUSDC': 'GUSDC|Unit|none|none',
      'GUSDT': 'GUSDT|Unit|none|none',
      'GWETH': 'GWETH|Unit|none|none'
    };
    
    return tokenMap[token.toUpperCase()] || `${token}|Unit|none|none`;
  }

  /**
   * Generate execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get execution by ID
   */
  public getExecution(executionId: string): TradeExecution | null {
    return this.executions.get(executionId) || null;
  }

  /**
   * Get all executions
   */
  public getExecutions(): TradeExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Get executions by status
   */
  public getExecutionsByStatus(status: TradeExecution['status']): TradeExecution[] {
    return this.getExecutions().filter(e => e.status === status);
  }

  /**
   * Get execution metrics
   */
  public getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get queue status
   */
  public getQueueStatus(): { queueLength: number; processingActive: boolean } {
    return {
      queueLength: this.executionQueue.length,
      processingActive: this.processingInterval !== null
    };
  }

  /**
   * Cancel execution
   */
  public cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    
    if (execution.status === 'pending' || execution.status === 'executing') {
      execution.status = 'cancelled';
      execution.completedAt = Date.now();
      
      // Remove from queue if pending
      const queueIndex = this.executionQueue.findIndex(e => e.id === executionId);
      if (queueIndex !== -1) {
        this.executionQueue.splice(queueIndex, 1);
      }
      
      this.emit('executionCancelled', execution);
      return true;
    }
    
    return false;
  }

  /**
   * Health check for trade executor
   */
  private async checkTradeExecutorHealth(): Promise<boolean> {
    try {
      return this.gSwap !== null && this.processingInterval !== null;
    } catch (error) {
      logger.error('❌ Trade executor health check failed:', error);
      return false;
    }
  }
}
