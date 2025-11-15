/**
 * Error Types and Categories for SOL Arbitrage Bot
 * 
 * Defines error categories, severity levels, and specific error classes
 * for consistent error handling throughout the application.
 */

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  /** Configuration errors (invalid config, missing env vars) */
  CONFIGURATION = 'CONFIGURATION',
  
  /** Network errors (timeouts, connection failures) */
  NETWORK = 'NETWORK',
  
  /** Validation errors (invalid input, format issues) */
  VALIDATION = 'VALIDATION',
  
  /** Execution errors (trade execution failures) */
  EXECUTION = 'EXECUTION',
  
  /** External API errors (Jupiter, CoinGecko, GalaChain API) */
  EXTERNAL_API = 'EXTERNAL_API',
  
  /** Blockchain errors (transaction failures, RPC errors) */
  BLOCKCHAIN = 'BLOCKCHAIN',
  
  /** State errors (state corruption, persistence failures) */
  STATE = 'STATE',
  
  /** System errors (unexpected errors, memory issues) */
  SYSTEM = 'SYSTEM',
  
  /** Unknown/unclassified errors */
  UNKNOWN = 'UNKNOWN'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Low severity - warnings, non-critical issues */
  LOW = 'LOW',
  
  /** Medium severity - recoverable errors */
  MEDIUM = 'MEDIUM',
  
  /** High severity - critical errors that may affect trading */
  HIGH = 'HIGH',
  
  /** Critical severity - system failures, requires immediate attention */
  CRITICAL = 'CRITICAL'
}

/**
 * Structured error information
 */
export interface BotError {
  /** Unique error ID */
  id: string;
  
  /** Error category */
  category: ErrorCategory;
  
  /** Error severity */
  severity: ErrorSeverity;
  
  /** Error message */
  message: string;
  
  /** Original error object */
  originalError: Error | unknown;
  
  /** Timestamp when error occurred */
  timestamp: number;
  
  /** Additional context (token, chain, etc.) */
  context?: Record<string, unknown>;
  
  /** Whether this error is retryable */
  retryable: boolean;
  
  /** Current retry count */
  retryCount: number;
  
  /** Maximum retries allowed */
  maxRetries: number;
  
  /** Whether error has been resolved */
  resolved: boolean;
  
  /** Resolution timestamp */
  resolvedAt?: number;
  
  /** Stack trace if available */
  stack?: string;
}

/**
 * Base error class for bot-specific errors
 */
export class BotErrorBase extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly retryable: boolean;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: number;

  constructor(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    retryable: boolean = false,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
    this.severity = severity;
    this.retryable = retryable;
    this.context = context;
    this.timestamp = Date.now();
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends BotErrorBase {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCategory.CONFIGURATION, ErrorSeverity.HIGH, false, context);
  }
}

/**
 * Network error (retryable)
 */
export class NetworkError extends BotErrorBase {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM, true, context);
  }
}

/**
 * Validation error (not retryable)
 */
export class ValidationError extends BotErrorBase {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCategory.VALIDATION, ErrorSeverity.LOW, false, context);
  }
}

/**
 * Execution error (trade execution failures)
 */
export class ExecutionError extends BotErrorBase {
  constructor(message: string, context?: Record<string, unknown>, retryable: boolean = false) {
    super(message, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, retryable, context);
  }
}

/**
 * External API error (retryable)
 */
export class ExternalApiError extends BotErrorBase {
  public readonly apiName: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    apiName: string,
    statusCode?: number,
    context?: Record<string, unknown>
  ) {
    const retryable = statusCode ? statusCode >= 500 || statusCode === 429 : true;
    super(message, ErrorCategory.EXTERNAL_API, ErrorSeverity.MEDIUM, retryable, context);
    this.apiName = apiName;
    this.statusCode = statusCode;
  }
}

/**
 * Blockchain error (RPC, transaction failures)
 */
export class BlockchainError extends BotErrorBase {
  public readonly chain: 'galaChain' | 'solana';
  public readonly transactionHash?: string;

  constructor(
    message: string,
    chain: 'galaChain' | 'solana',
    transactionHash?: string,
    context?: Record<string, unknown>
  ) {
    // Some blockchain errors are retryable (network issues), others are not (invalid transaction)
    const retryable = message.toLowerCase().includes('timeout') || 
                     message.toLowerCase().includes('network') ||
                     message.toLowerCase().includes('connection');
    super(message, ErrorCategory.BLOCKCHAIN, ErrorSeverity.HIGH, retryable, context);
    this.chain = chain;
    this.transactionHash = transactionHash;
  }
}

/**
 * State error (state corruption, persistence failures)
 */
export class StateError extends BotErrorBase {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCategory.STATE, ErrorSeverity.HIGH, false, context);
  }
}

/**
 * System error (unexpected errors)
 */
export class SystemError extends BotErrorBase {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL, false, context);
  }
}

/**
 * Determine error category from error object
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof BotErrorBase) {
    return error.category;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Check error name
    if (name.includes('network') || name.includes('timeout') || name.includes('connection')) {
      return ErrorCategory.NETWORK;
    }
    if (name.includes('validation') || name.includes('invalid')) {
      return ErrorCategory.VALIDATION;
    }
    if (name.includes('config')) {
      return ErrorCategory.CONFIGURATION;
    }

    // Check error message
    if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return ErrorCategory.NETWORK;
    }
    if (message.includes('api') || message.includes('http') || message.includes('axios')) {
      return ErrorCategory.EXTERNAL_API;
    }
    if (message.includes('transaction') || message.includes('rpc') || message.includes('blockchain')) {
      return ErrorCategory.BLOCKCHAIN;
    }
    if (message.includes('validation') || message.includes('invalid') || message.includes('format')) {
      return ErrorCategory.VALIDATION;
    }
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Determine error severity from error object
 */
export function determineSeverity(error: unknown, category: ErrorCategory): ErrorSeverity {
  if (error instanceof BotErrorBase) {
    return error.severity;
  }

  // Default severity by category
  switch (category) {
    case ErrorCategory.CONFIGURATION:
    case ErrorCategory.SYSTEM:
      return ErrorSeverity.CRITICAL;
    case ErrorCategory.EXECUTION:
    case ErrorCategory.BLOCKCHAIN:
      return ErrorSeverity.HIGH;
    case ErrorCategory.NETWORK:
    case ErrorCategory.EXTERNAL_API:
      return ErrorSeverity.MEDIUM;
    case ErrorCategory.VALIDATION:
      return ErrorSeverity.LOW;
    default:
      return ErrorSeverity.MEDIUM;
  }
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown, category: ErrorCategory): boolean {
  if (error instanceof BotErrorBase) {
    return error.retryable;
  }

  // Explicitly non-retryable: circuit breaker OPEN errors
  // These should NOT be retried - the circuit breaker timeout will handle recovery
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('circuit breaker') && message.includes('is open')) {
      return false;
    }
  }

  // Default retryability by category
  switch (category) {
    case ErrorCategory.NETWORK:
    case ErrorCategory.EXTERNAL_API:
      return true;
    case ErrorCategory.VALIDATION:
    case ErrorCategory.CONFIGURATION:
    case ErrorCategory.STATE:
    case ErrorCategory.SYSTEM:
      return false;
    case ErrorCategory.EXECUTION:
    case ErrorCategory.BLOCKCHAIN:
      // Check error message for retryable patterns
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return message.includes('timeout') ||
               message.includes('network') ||
               message.includes('connection') ||
               message.includes('rate limit');
      }
      return false;
    default:
      return false;
  }
}

/**
 * Check if error is a circuit breaker OPEN error
 * Useful for special handling of circuit breaker state
 */
export function isCircuitBreakerOpenError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('circuit breaker') && message.includes('is open');
  }
  return false;
}

