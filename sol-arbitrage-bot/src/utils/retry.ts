/**
 * Retry Logic with Exponential Backoff
 * 
 * Provides retry functionality with configurable policies and exponential backoff.
 */

import logger from './logger';
import { isRetryableError, categorizeError } from './errors';

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number;
  
  /** Initial delay in milliseconds */
  initialDelay: number;
  
  /** Maximum delay in milliseconds */
  maxDelay: number;
  
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  
  /** Whether to use exponential backoff */
  useExponentialBackoff: boolean;
  
  /** Custom retry condition function */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Default retry policy
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelay: 1000,      // 1 second
  maxDelay: 30000,         // 30 seconds
  backoffMultiplier: 2,
  useExponentialBackoff: true
};

/**
 * Retry result
 */
export interface RetryResult<T> {
  /** Success result */
  success: T;
  
  /** Number of attempts made */
  attempts: number;
  
  /** Total time taken (including retries) */
  totalTime: number;
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  context?: string
): Promise<RetryResult<T>> {
  const fullPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  const startTime = Date.now();
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= fullPolicy.maxRetries; attempt++) {
    try {
      const result = await fn();
      
      if (attempt > 0) {
        logger.info(`✅ Retry succeeded after ${attempt} attempts${context ? ` (${context})` : ''}`);
      }
      
      return {
        success: result,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime
      };
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt >= fullPolicy.maxRetries) {
        break; // Max retries reached
      }
      
      // Check custom retry condition
      if (fullPolicy.shouldRetry && !fullPolicy.shouldRetry(error, attempt)) {
        break; // Custom condition says don't retry
      }
      
      // Check if error is retryable
      const category = categorizeError(error);
      if (!isRetryableError(error, category)) {
        logger.debug(`Error not retryable: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      
      // Calculate delay
      const delay = calculateDelay(attempt, fullPolicy);
      
      logger.warn(
        `⚠️ Retry attempt ${attempt + 1}/${fullPolicy.maxRetries} after ${delay}ms${context ? ` (${context})` : ''}`,
        { error: error instanceof Error ? error.message : String(error) }
      );
      
      // Wait before retry
      await sleep(delay);
    }
  }
  
  // All retries failed
  const errorMessage = lastError instanceof Error 
    ? lastError.message 
    : String(lastError);
    
  throw new Error(
    `Failed after ${fullPolicy.maxRetries + 1} attempts${context ? ` (${context})` : ''}: ${errorMessage}`
  );
}

/**
 * Calculate delay for retry attempt
 */
function calculateDelay(attempt: number, policy: RetryPolicy): number {
  if (!policy.useExponentialBackoff) {
    return policy.initialDelay;
  }
  
  // Exponential backoff: initialDelay * (backoffMultiplier ^ attempt)
  const delay = policy.initialDelay * Math.pow(policy.backoffMultiplier, attempt);
  
  // Cap at maxDelay
  return Math.min(delay, policy.maxDelay);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with specific error handling
 */
export async function retryOnError<T>(
  fn: () => Promise<T>,
  errorTypes: string[],
  policy: Partial<RetryPolicy> = {},
  context?: string
): Promise<RetryResult<T>> {
  const customPolicy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    ...policy,
    shouldRetry: (error: unknown) => {
      if (error instanceof Error) {
        return errorTypes.some(type => 
          error.message.toLowerCase().includes(type.toLowerCase()) ||
          error.name.toLowerCase().includes(type.toLowerCase())
        );
      }
      return false;
    }
  };
  
  return retryWithBackoff(fn, customPolicy, context);
}

/**
 * Retry with timeout
 */
export async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  policy: Partial<RetryPolicy> = {},
  context?: string
): Promise<RetryResult<T>> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  
  const wrappedFn = async (): Promise<T> => {
    return Promise.race([fn(), timeoutPromise]);
  };
  
  return retryWithBackoff(wrappedFn, policy, context);
}

