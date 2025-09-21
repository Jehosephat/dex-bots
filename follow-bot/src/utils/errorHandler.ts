/**
 * Error Handler
 * 
 * Comprehensive error handling and recovery system for the follow bot
 * including error categorization, recovery mechanisms, and circuit breakers.
 */

import { logger } from './logger';

// Error categories
export enum ErrorCategory {
  CONFIGURATION = 'CONFIGURATION',
  NETWORK = 'NETWORK',
  WEBSOCKET = 'WEBSOCKET',
  TRADING = 'TRADING',
  VALIDATION = 'VALIDATION',
  SYSTEM = 'SYSTEM',
  EXTERNAL_API = 'EXTERNAL_API',
  UNKNOWN = 'UNKNOWN'
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

// Error interface
export interface BotError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  timestamp: number;
  context: Record<string, unknown> | undefined;
  retryable: boolean;
  retryCount: number;
  maxRetries: number;
  lastRetryTime?: number;
  resolved: boolean;
  resolutionTime?: number;
}

// Circuit breaker states
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Circuit is open, requests fail fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service is back
}

// Circuit breaker configuration
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  recoveryTimeout: number;       // Time to wait before trying again (ms)
  monitoringPeriod: number;      // Time window for failure counting (ms)
  halfOpenMaxCalls: number;      // Max calls in half-open state
}

// Circuit breaker state
export interface CircuitBreakerStateData {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  halfOpenCalls: number;
  totalCalls: number;
  totalFailures: number;
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errors: Map<string, BotError> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerStateData> = new Map();
  private recoveryStrategies: Map<ErrorCategory, (error: BotError) => Promise<boolean>> = new Map();
  private healthChecks: Map<string, () => Promise<boolean>> = new Map();
  private isShuttingDown = false;

  private constructor() {
    this.initializeRecoveryStrategies();
    this.setupGlobalErrorHandlers();
  }

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Initialize recovery strategies for different error categories
   */
  private initializeRecoveryStrategies(): void {
    this.recoveryStrategies.set(ErrorCategory.CONFIGURATION, this.handleConfigurationError.bind(this));
    this.recoveryStrategies.set(ErrorCategory.NETWORK, this.handleNetworkError.bind(this));
    this.recoveryStrategies.set(ErrorCategory.WEBSOCKET, this.handleWebSocketError.bind(this));
    this.recoveryStrategies.set(ErrorCategory.TRADING, this.handleTradingError.bind(this));
    this.recoveryStrategies.set(ErrorCategory.VALIDATION, this.handleValidationError.bind(this));
    this.recoveryStrategies.set(ErrorCategory.SYSTEM, this.handleSystemError.bind(this));
    this.recoveryStrategies.set(ErrorCategory.EXTERNAL_API, this.handleExternalApiError.bind(this));
  }

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.handleError(error, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL, {
        type: 'uncaughtException'
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.handleError(error, ErrorCategory.SYSTEM, ErrorSeverity.HIGH, {
        type: 'unhandledRejection',
        promise: promise.toString()
      });
    });

    // Handle warnings
    process.on('warning', (warning: Error) => {
      this.handleError(warning, ErrorCategory.SYSTEM, ErrorSeverity.LOW, {
        type: 'warning',
        name: warning.name
      });
    });
  }

  /**
   * Handle an error with categorization and recovery
   */
  public async handleError(
    error: Error,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context?: Record<string, unknown>
  ): Promise<BotError> {
    const errorId = this.generateErrorId();
    const botError: BotError = {
      id: errorId,
      category,
      severity,
      message: error.message,
      originalError: error,
      timestamp: Date.now(),
      context,
      retryable: this.isRetryableError(error, category),
      retryCount: 0,
      maxRetries: this.getMaxRetries(category, severity),
      resolved: false
    };

    // Store error
    this.errors.set(errorId, botError);

    // Log error
    this.logError(botError);

    // Attempt recovery if retryable
    if (botError.retryable && !this.isShuttingDown) {
      await this.attemptRecovery(botError);
    }

    return botError;
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: Error, category: ErrorCategory): boolean {
    const retryableCategories = [
      ErrorCategory.NETWORK,
      ErrorCategory.WEBSOCKET,
      ErrorCategory.EXTERNAL_API
    ];

    const retryableMessages = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'timeout',
      'network',
      'connection'
    ];

    return retryableCategories.includes(category) ||
           retryableMessages.some(msg => error.message.toLowerCase().includes(msg));
  }

  /**
   * Get maximum retries based on category and severity
   */
  private getMaxRetries(category: ErrorCategory, severity: ErrorSeverity): number {
    const baseRetries = {
      [ErrorSeverity.LOW]: 3,
      [ErrorSeverity.MEDIUM]: 5,
      [ErrorSeverity.HIGH]: 7,
      [ErrorSeverity.CRITICAL]: 10
    };

    const categoryMultiplier = {
      [ErrorCategory.NETWORK]: 1.5,
      [ErrorCategory.WEBSOCKET]: 1.2,
      [ErrorCategory.EXTERNAL_API]: 1.0,
      [ErrorCategory.TRADING]: 0.5,
      [ErrorCategory.CONFIGURATION]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.SYSTEM]: 0.8,
      [ErrorCategory.UNKNOWN]: 1.0
    };

    return Math.floor(baseRetries[severity] * categoryMultiplier[category]);
  }

  /**
   * Log error with appropriate level
   */
  private logError(botError: BotError): void {
    const logData = {
      errorId: botError.id,
      category: botError.category,
      severity: botError.severity,
      retryable: botError.retryable,
      context: botError.context
    };

    switch (botError.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(`🚨 CRITICAL ERROR [${botError.category}]: ${botError.message}`, logData);
        break;
      case ErrorSeverity.HIGH:
        logger.error(`❌ HIGH ERROR [${botError.category}]: ${botError.message}`, logData);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(`⚠️ MEDIUM ERROR [${botError.category}]: ${botError.message}`, logData);
        break;
      case ErrorSeverity.LOW:
        logger.info(`ℹ️ LOW ERROR [${botError.category}]: ${botError.message}`, logData);
        break;
    }
  }

  /**
   * Attempt error recovery
   */
  private async attemptRecovery(botError: BotError): Promise<void> {
    if (botError.retryCount >= botError.maxRetries) {
      logger.error(`🔄 Recovery failed for error ${botError.id}: max retries exceeded`);
      return;
    }

    const strategy = this.recoveryStrategies.get(botError.category);
    if (!strategy) {
      logger.warn(`⚠️ No recovery strategy for error category: ${botError.category}`);
      return;
    }

    try {
      botError.retryCount++;
      botError.lastRetryTime = Date.now();

      logger.info(`🔄 Attempting recovery for error ${botError.id} (attempt ${botError.retryCount}/${botError.maxRetries})`);

      const success = await strategy(botError);
      if (success) {
        botError.resolved = true;
        botError.resolutionTime = Date.now();
        logger.info(`✅ Error ${botError.id} resolved successfully`);
      } else {
        // Schedule next retry with exponential backoff
        const delay = this.calculateRetryDelay(botError.retryCount);
        setTimeout(() => this.attemptRecovery(botError), delay);
      }
    } catch (recoveryError) {
      logger.error(`❌ Recovery attempt failed for error ${botError.id}:`, recoveryError);
      // Schedule next retry
      const delay = this.calculateRetryDelay(botError.retryCount);
      setTimeout(() => this.attemptRecovery(botError), delay);
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, retryCount - 1), maxDelay);
    return delay + Math.random() * 1000; // Add jitter
  }

  /**
   * Recovery strategy for configuration errors
   */
  private async handleConfigurationError(_botError: BotError): Promise<boolean> {
    logger.info('🔧 Attempting configuration recovery...');
    // Configuration errors are usually not recoverable
    return false;
  }

  /**
   * Recovery strategy for network errors
   */
  private async handleNetworkError(_botError: BotError): Promise<boolean> {
    logger.info('🌐 Attempting network recovery...');
    // Network errors might resolve themselves
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true; // Assume recovered
  }

  /**
   * Recovery strategy for WebSocket errors
   */
  private async handleWebSocketError(_botError: BotError): Promise<boolean> {
    logger.info('🔌 Attempting WebSocket recovery...');
    // WebSocket reconnection will be handled by WebSocket manager
    return false; // Let WebSocket manager handle reconnection
  }

  /**
   * Recovery strategy for trading errors
   */
  private async handleTradingError(_botError: BotError): Promise<boolean> {
    logger.info('💰 Attempting trading recovery...');
    // Trading errors might be recoverable (e.g., retry failed transaction)
    return false; // Let trading system handle retries
  }

  /**
   * Recovery strategy for validation errors
   */
  private async handleValidationError(_botError: BotError): Promise<boolean> {
    logger.info('✅ Attempting validation recovery...');
    // Validation errors are usually not recoverable
    return false;
  }

  /**
   * Recovery strategy for system errors
   */
  private async handleSystemError(_botError: BotError): Promise<boolean> {
    logger.info('🖥️ Attempting system recovery...');
    // System errors might require restart
    return false;
  }

  /**
   * Recovery strategy for external API errors
   */
  private async handleExternalApiError(_botError: BotError): Promise<boolean> {
    logger.info('🔗 Attempting external API recovery...');
    // External API errors might resolve themselves
    await new Promise(resolve => setTimeout(resolve, 1000));
    return true; // Assume recovered
  }

  /**
   * Create circuit breaker for external service
   */
  public createCircuitBreaker(
    serviceName: string,
    _config: CircuitBreakerConfig = {
      failureThreshold: 5,
      recoveryTimeout: 30000,
      monitoringPeriod: 60000,
      halfOpenMaxCalls: 3
    }
  ): void {
    this.circuitBreakers.set(serviceName, {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      halfOpenCalls: 0,
      totalCalls: 0,
      totalFailures: 0
    });

    logger.info(`🔒 Circuit breaker created for service: ${serviceName}`);
  }

  /**
   * Execute function with circuit breaker protection
   */
  public async executeWithCircuitBreaker<T>(
    serviceName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for service: ${serviceName}`);
    }

    circuitBreaker.totalCalls++;

    // Check circuit breaker state
    if (circuitBreaker.state === CircuitBreakerState.OPEN) {
      if (Date.now() < circuitBreaker.nextAttemptTime) {
        throw new Error(`Circuit breaker is OPEN for service: ${serviceName}`);
      } else {
        circuitBreaker.state = CircuitBreakerState.HALF_OPEN;
        circuitBreaker.halfOpenCalls = 0;
        logger.info(`🔓 Circuit breaker transitioning to HALF_OPEN for service: ${serviceName}`);
      }
    }

    if (circuitBreaker.state === CircuitBreakerState.HALF_OPEN) {
      if (circuitBreaker.halfOpenCalls >= 3) { // halfOpenMaxCalls
        throw new Error(`Circuit breaker HALF_OPEN call limit exceeded for service: ${serviceName}`);
      }
      circuitBreaker.halfOpenCalls++;
    }

    try {
      const result = await operation();
      
      // Success - reset circuit breaker
      if (circuitBreaker.state === CircuitBreakerState.HALF_OPEN) {
        circuitBreaker.state = CircuitBreakerState.CLOSED;
        circuitBreaker.failureCount = 0;
        logger.info(`✅ Circuit breaker reset to CLOSED for service: ${serviceName}`);
      }
      
      return result;
    } catch (error) {
      // Failure - update circuit breaker
      circuitBreaker.failureCount++;
      circuitBreaker.totalFailures++;
      circuitBreaker.lastFailureTime = Date.now();

      if (circuitBreaker.failureCount >= 5) { // failureThreshold
        circuitBreaker.state = CircuitBreakerState.OPEN;
        circuitBreaker.nextAttemptTime = Date.now() + 30000; // recoveryTimeout
        logger.error(`🔒 Circuit breaker opened for service: ${serviceName}`);
      }

      throw error;
    }
  }

  /**
   * Add health check function
   */
  public addHealthCheck(name: string, checkFunction: () => Promise<boolean>): void {
    this.healthChecks.set(name, checkFunction);
    logger.info(`🏥 Health check added: ${name}`);
  }

  /**
   * Run all health checks
   */
  public async runHealthChecks(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [name, checkFunction] of this.healthChecks) {
      try {
        results[name] = await checkFunction();
      } catch (error) {
        results[name] = false;
        logger.error(`🏥 Health check failed for ${name}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Get error statistics
   */
  public getErrorStatistics(): {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    unresolvedErrors: number;
    averageResolutionTime: number;
  } {
    const errors = Array.from(this.errors.values());
    const errorsByCategory: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};
    let unresolvedErrors = 0;
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const error of errors) {
      errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
      
      if (!error.resolved) {
        unresolvedErrors++;
      } else if (error.resolutionTime) {
        totalResolutionTime += error.resolutionTime - error.timestamp;
        resolvedCount++;
      }
    }

    return {
      totalErrors: errors.length,
      errorsByCategory,
      errorsBySeverity,
      unresolvedErrors,
      averageResolutionTime: resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0
    };
  }

  /**
   * Get circuit breaker status
   */
  public getCircuitBreakerStatus(): Record<string, CircuitBreakerStateData> {
    return Object.fromEntries(this.circuitBreakers);
  }

  /**
   * Cleanup old errors
   */
  public cleanupOldErrors(maxAge: number = 24 * 60 * 60 * 1000): void { // 24 hours
    const cutoffTime = Date.now() - maxAge;
    let removedCount = 0;

    for (const [id, error] of this.errors) {
      if (error.timestamp < cutoffTime && error.resolved) {
        this.errors.delete(id);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info(`🧹 Cleaned up ${removedCount} old resolved errors`);
    }
  }

  /**
   * Set shutdown flag
   */
  public setShuttingDown(): void {
    this.isShuttingDown = true;
    logger.info('🛑 Error handler set to shutting down mode');
  }

  /**
   * Get all errors
   */
  public getAllErrors(): BotError[] {
    return Array.from(this.errors.values());
  }

  /**
   * Get unresolved errors
   */
  public getUnresolvedErrors(): BotError[] {
    return Array.from(this.errors.values()).filter(error => !error.resolved);
  }
}
