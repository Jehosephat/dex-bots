/**
 * Centralized Error Handler
 * 
 * Provides comprehensive error handling, categorization, recovery strategies,
 * and error tracking for the arbitrage bot.
 */

import logger from './logger';
import {
  ErrorCategory,
  ErrorSeverity,
  BotError,
  categorizeError,
  determineSeverity,
  isRetryableError,
  BotErrorBase
} from './errors';
import { retryWithBackoff, RetryPolicy } from './retry';
import { circuitBreakerRegistry, CircuitBreaker } from './circuitBreaker';

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  /** Maximum number of errors to track */
  maxTrackedErrors: number;
  
  /** Default retry policy */
  defaultRetryPolicy: RetryPolicy;
  
  /** Whether to enable circuit breakers */
  enableCircuitBreakers: boolean;
  
  /** Alert thresholds by severity */
  alertThresholds: {
    [key in ErrorSeverity]: number; // Alert after N errors of this severity
  };
}

/**
 * Default error handler configuration
 */
const DEFAULT_CONFIG: ErrorHandlerConfig = {
  maxTrackedErrors: 1000,
  defaultRetryPolicy: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    useExponentialBackoff: true
  },
  enableCircuitBreakers: true,
  alertThresholds: {
    [ErrorSeverity.LOW]: 100,
    [ErrorSeverity.MEDIUM]: 50,
    [ErrorSeverity.HIGH]: 10,
    [ErrorSeverity.CRITICAL]: 1
  }
};

/**
 * Recovery strategy function
 */
type RecoveryStrategy = (error: BotError) => Promise<boolean>;

/**
 * Centralized Error Handler
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private errors: Map<string, BotError> = new Map();
  private errorCounts: Map<ErrorCategory, number> = new Map();
  private severityCounts: Map<ErrorSeverity, number> = new Map();
  private recoveryStrategies: Map<ErrorCategory, RecoveryStrategy> = new Map();
  private config: ErrorHandlerConfig;
  private isShuttingDown = false;

  private constructor(config?: Partial<ErrorHandlerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeRecoveryStrategies();
    this.setupGlobalErrorHandlers();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ErrorHandlerConfig>): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler(config);
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle an error with categorization and recovery
   */
  public async handleError(
    error: unknown,
    category?: ErrorCategory,
    severity?: ErrorSeverity,
    context?: Record<string, unknown>
  ): Promise<BotError> {
    // Categorize error if not provided
    const errorCategory = category || categorizeError(error);
    
    // Determine severity if not provided
    const errorSeverity = severity || determineSeverity(error, errorCategory);
    
    // Create error ID
    const errorId = this.generateErrorId();
    
    // Extract error message and stack
    const errorMessage = error instanceof Error 
      ? error.message 
      : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    // Check retryability
    const retryable = isRetryableError(error, errorCategory);
    
    // Get max retries based on category and severity
    const maxRetries = this.getMaxRetries(errorCategory, errorSeverity);
    
    // Create bot error
    const botError: BotError = {
      id: errorId,
      category: errorCategory,
      severity: errorSeverity,
      message: errorMessage,
      originalError: error,
      timestamp: Date.now(),
      context,
      retryable,
      retryCount: 0,
      maxRetries,
      resolved: false,
      stack
    };

    // Store error
    this.storeError(botError);

    // Log error
    this.logError(botError);

    // Attempt recovery if retryable and not shutting down
    if (botError.retryable && !this.isShuttingDown) {
      await this.attemptRecovery(botError);
    }

    return botError;
  }

  /**
   * Execute a function with error handling and automatic retry
   */
  public async executeWithRetry<T>(
    fn: () => Promise<T>,
    context?: string,
    customPolicy?: Partial<RetryPolicy>
  ): Promise<T> {
    const policy = { ...this.config.defaultRetryPolicy, ...customPolicy };
    
    try {
      const result = await retryWithBackoff(
        fn,
        policy,
        context
      );
      return result.success;
    } catch (error) {
      // Handle the error through the error handler
      const botError = await this.handleError(error, undefined, undefined, { context });
      throw new Error(botError.message);
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  public async executeWithCircuitBreaker<T>(
    fn: () => Promise<T>,
    serviceName: string,
    circuitConfig?: Partial<import('./circuitBreaker').CircuitBreakerConfig>
  ): Promise<T> {
    if (!this.config.enableCircuitBreakers) {
      return fn();
    }

    const breaker = circuitBreakerRegistry.get(serviceName, circuitConfig);
    
    try {
      return await breaker.execute(fn);
    } catch (error) {
      // Handle circuit breaker errors
      await this.handleError(
        error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { serviceName, circuitBreaker: serviceName }
      );
      throw error;
    }
  }

  /**
   * Execute with both circuit breaker and retry
   */
  public async executeWithProtection<T>(
    fn: () => Promise<T>,
    serviceName: string,
    context?: string,
    retryPolicy?: Partial<RetryPolicy>,
    circuitConfig?: Partial<import('./circuitBreaker').CircuitBreakerConfig>
  ): Promise<T> {
    const protectedFn = () => this.executeWithCircuitBreaker(fn, serviceName, circuitConfig);
    return this.executeWithRetry(protectedFn, context, retryPolicy);
  }

  /**
   * Store error in memory
   */
  private storeError(botError: BotError): void {
    // Store error
    this.errors.set(botError.id, botError);

    // Limit stored errors
    if (this.errors.size > this.config.maxTrackedErrors) {
      const oldestId = Array.from(this.errors.keys())[0];
      this.errors.delete(oldestId);
    }

    // Update counts
    const categoryCount = this.errorCounts.get(botError.category) || 0;
    this.errorCounts.set(botError.category, categoryCount + 1);

    const severityCount = this.severityCounts.get(botError.severity) || 0;
    this.severityCounts.set(botError.severity, severityCount + 1);

    // Check alert thresholds
    this.checkAlertThresholds(botError);
  }

  /**
   * Log error
   */
  private logError(botError: BotError): void {
    const logData = {
      errorId: botError.id,
      category: botError.category,
      severity: botError.severity,
      retryable: botError.retryable,
      context: botError.context,
      stack: botError.stack
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
        logger.warn(`⚠️ LOW ERROR [${botError.category}]: ${botError.message}`, logData);
        break;
    }
  }

  /**
   * Attempt error recovery
   */
  private async attemptRecovery(botError: BotError): Promise<void> {
    const strategy = this.recoveryStrategies.get(botError.category);
    
    if (strategy) {
      try {
        const recovered = await strategy(botError);
        if (recovered) {
          botError.resolved = true;
          botError.resolvedAt = Date.now();
          logger.info(`✅ Error ${botError.id} recovered`);
        }
      } catch (recoveryError) {
        logger.warn(`⚠️ Recovery failed for error ${botError.id}`, {
          recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        });
      }
    }
  }

  /**
   * Initialize recovery strategies
   */
  private initializeRecoveryStrategies(): void {
    // Network errors: wait and retry
    this.recoveryStrategies.set(ErrorCategory.NETWORK, async (error) => {
      logger.info(`🔄 Attempting network recovery for error ${error.id}`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      return true; // Assume recovery after wait
    });

    // External API errors: wait and retry
    this.recoveryStrategies.set(ErrorCategory.EXTERNAL_API, async (error) => {
      logger.info(`🔄 Attempting API recovery for error ${error.id}`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      return true;
    });

    // Blockchain errors: wait longer and retry
    this.recoveryStrategies.set(ErrorCategory.BLOCKCHAIN, async (error) => {
      logger.info(`🔄 Attempting blockchain recovery for error ${error.id}`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      return true;
    });
  }

  /**
   * Check alert thresholds
   */
  private checkAlertThresholds(botError: BotError): void {
    const threshold = this.config.alertThresholds[botError.severity];
    const count = this.severityCounts.get(botError.severity) || 0;

    if (count >= threshold && count % threshold === 0) {
      logger.error(`🚨 Alert threshold reached: ${count} ${botError.severity} errors`);
      // TODO: Send alert notification
    }
  }

  /**
   * Get maximum retries for error category and severity
   */
  private getMaxRetries(category: ErrorCategory, severity: ErrorSeverity): number {
    // Base retries on category
    switch (category) {
      case ErrorCategory.NETWORK:
      case ErrorCategory.EXTERNAL_API:
        return 3;
      case ErrorCategory.BLOCKCHAIN:
        return 2;
      case ErrorCategory.EXECUTION:
        return severity === ErrorSeverity.HIGH ? 1 : 0;
      default:
        return 0;
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown) => {
      this.handleError(reason, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL, {
        type: 'unhandledRejection'
      }).catch(err => {
        logger.error('Failed to handle unhandled rejection', { error: err });
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.handleError(error, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL, {
        type: 'uncaughtException'
      }).catch(err => {
        logger.error('Failed to handle uncaught exception', { error: err });
        process.exit(1);
      });
    });
  }

  /**
   * Get error statistics
   */
  public getStatistics(): {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    unresolvedErrors: number;
  } {
    const unresolved = Array.from(this.errors.values()).filter(e => !e.resolved).length;
    
    return {
      totalErrors: this.errors.size,
      errorsByCategory: Object.fromEntries(this.errorCounts),
      errorsBySeverity: Object.fromEntries(this.severityCounts),
      unresolvedErrors: unresolved
    };
  }

  /**
   * Get recent errors
   */
  public getRecentErrors(limit: number = 10): BotError[] {
    return Array.from(this.errors.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Resolve an error
   */
  public resolveError(errorId: string): void {
    const error = this.errors.get(errorId);
    if (error) {
      error.resolved = true;
      error.resolvedAt = Date.now();
    }
  }

  /**
   * Mark as shutting down
   */
  public shutdown(): void {
    this.isShuttingDown = true;
    logger.info('🛑 Error handler shutting down');
  }
}

/**
 * Get error handler instance
 */
export function getErrorHandler(): ErrorHandler {
  return ErrorHandler.getInstance();
}

