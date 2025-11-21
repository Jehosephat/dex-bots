/**
 * Circuit Breaker Pattern Implementation
 * 
 * Provides circuit breaker functionality to prevent cascading failures
 * when external APIs or services are failing.
 */

import logger from './logger';

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  /** Closed - normal operation, all requests allowed */
  CLOSED = 'CLOSED',
  
  /** Open - service is failing, requests blocked */
  OPEN = 'OPEN',
  
  /** Half-Open - testing if service recovered, limited requests allowed */
  HALF_OPEN = 'HALF_OPEN'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  
  /** Time in milliseconds to wait before attempting half-open */
  timeout: number;
  
  /** Number of successful requests in half-open state to close circuit */
  successThreshold: number;
  
  /** Time window for tracking failures (in milliseconds) */
  failureWindow: number;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,      // Open after 5 failures
  timeout: 30000,           // Wait 30 seconds before half-open (was 60s)
  successThreshold: 2,      // Close after 2 successes in half-open
  failureWindow: 60000      // Track failures in 60 second window
};

/**
 * Circuit breaker state data
 */
interface CircuitBreakerStateData {
  state: CircuitBreakerState;
  failures: number[];
  successes: number;
  lastFailureTime?: number;
  openedAt?: number;
  halfOpenedAt?: number;
  consecutiveOpenings: number; // Track repeated failures for progressive backoff
}

/**
 * Circuit Breaker implementation
 * 
 * Prevents cascading failures by temporarily blocking requests
 * when a service is failing.
 */
export class CircuitBreaker {
  private stateData: CircuitBreakerStateData;
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateData = {
      state: CircuitBreakerState.CLOSED,
      failures: [],
      successes: 0,
      consecutiveOpenings: 0
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit state
    this.updateState();

    // If circuit is open, throw error
    if (this.stateData.state === CircuitBreakerState.OPEN) {
      const waitTime = this.getTimeUntilRetry();
      throw new Error(
        `Circuit breaker ${this.name} is OPEN. ` +
        `Retry after ${Math.ceil(waitTime / 1000)}s`
      );
    }

    // Execute function
    try {
      const result = await fn();
      
      // Record success
      this.recordSuccess();
      
      return result;
    } catch (error) {
      // Record failure
      this.recordFailure();
      
      throw error;
    }
  }

  /**
   * Update circuit breaker state based on time and thresholds
   */
  private updateState(): void {
    const now = Date.now();

    switch (this.stateData.state) {
      case CircuitBreakerState.OPEN:
        // Check if timeout has passed (with progressive backoff)
        const backoffMultiplier = Math.min(Math.pow(2, this.stateData.consecutiveOpenings - 1), 4);
        const effectiveTimeout = this.config.timeout * backoffMultiplier;

        if (this.stateData.openedAt &&
            (now - this.stateData.openedAt) >= effectiveTimeout) {
          this.transitionToHalfOpen();
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        // Check if we've had enough successes
        if (this.stateData.successes >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;

      case CircuitBreakerState.CLOSED:
        // Clean up old failures outside the window
        this.cleanupOldFailures(now);
        break;
    }
  }

  /**
   * Record a successful request
   */
  private recordSuccess(): void {
    if (this.stateData.state === CircuitBreakerState.HALF_OPEN) {
      this.stateData.successes++;
      
      if (this.stateData.successes >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    } else {
      // Reset failure count on success
      this.stateData.failures = [];
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(): void {
    const now = Date.now();
    this.stateData.lastFailureTime = now;
    this.stateData.failures.push(now);

    // Clean up old failures
    this.cleanupOldFailures(now);

    // Check if we should open the circuit
    if (this.stateData.state === CircuitBreakerState.CLOSED) {
      if (this.stateData.failures.length >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    } else if (this.stateData.state === CircuitBreakerState.HALF_OPEN) {
      // Any failure in half-open state goes back to open
      this.transitionToOpen();
    }
  }

  /**
   * Clean up failures outside the time window
   */
  private cleanupOldFailures(now: number): void {
    const cutoff = now - this.config.failureWindow;
    this.stateData.failures = this.stateData.failures.filter(
      timestamp => timestamp > cutoff
    );
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.stateData.state = CircuitBreakerState.OPEN;
    this.stateData.openedAt = Date.now();
    this.stateData.successes = 0;
    this.stateData.consecutiveOpenings++;

    const backoffMultiplier = Math.min(Math.pow(2, this.stateData.consecutiveOpenings - 1), 4);
    const effectiveTimeout = this.config.timeout * backoffMultiplier;

    logger.warn(`🔴 Circuit breaker ${this.name} opened after ${this.stateData.failures.length} failures (retry in ${Math.ceil(effectiveTimeout / 1000)}s, attempt #${this.stateData.consecutiveOpenings})`);
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.stateData.state = CircuitBreakerState.HALF_OPEN;
    this.stateData.halfOpenedAt = Date.now();
    this.stateData.successes = 0;
    this.stateData.failures = [];

    logger.info(`🟡 Circuit breaker ${this.name} half-opened (testing recovery, attempt #${this.stateData.consecutiveOpenings})`);
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    const wasConsecutive = this.stateData.consecutiveOpenings;
    this.stateData.state = CircuitBreakerState.CLOSED;
    this.stateData.failures = [];
    this.stateData.successes = 0;
    this.stateData.openedAt = undefined;
    this.stateData.halfOpenedAt = undefined;
    this.stateData.consecutiveOpenings = 0; // Reset on successful recovery

    logger.info(`🟢 Circuit breaker ${this.name} closed (service recovered after ${wasConsecutive} opening(s))`);
  }

  /**
   * Get time until next retry attempt (in milliseconds)
   * Uses progressive backoff based on consecutive openings
   */
  private getTimeUntilRetry(): number {
    if (this.stateData.state !== CircuitBreakerState.OPEN || !this.stateData.openedAt) {
      return 0;
    }

    // Progressive backoff: double timeout for each consecutive opening (up to 4x max)
    const backoffMultiplier = Math.min(Math.pow(2, this.stateData.consecutiveOpenings - 1), 4);
    const effectiveTimeout = this.config.timeout * backoffMultiplier;

    const elapsed = Date.now() - this.stateData.openedAt;
    return Math.max(0, effectiveTimeout - elapsed);
  }

  /**
   * Check if circuit is currently open (without throwing)
   * Useful for retry logic to skip attempts when circuit is open
   */
  isOpen(): boolean {
    this.updateState();
    return this.stateData.state === CircuitBreakerState.OPEN;
  }

  /**
   * Check if circuit allows requests (not open)
   */
  isAllowed(): boolean {
    this.updateState();
    return this.stateData.state !== CircuitBreakerState.OPEN;
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    this.updateState();
    return this.stateData.state;
  }

  /**
   * Get current failure count
   */
  getFailureCount(): number {
    this.cleanupOldFailures(Date.now());
    return this.stateData.failures.length;
  }

  /**
   * Reset circuit breaker (force to closed state)
   */
  reset(): void {
    this.stateData.consecutiveOpenings = 0; // Reset before transitioning
    this.transitionToClosed();
    logger.info(`🔄 Circuit breaker ${this.name} manually reset`);
  }

  /**
   * Get circuit breaker status
   */
  getStatus(): {
    state: CircuitBreakerState;
    failures: number;
    successes: number;
    openedAt?: number;
    halfOpenedAt?: number;
  } {
    this.updateState();
    return {
      state: this.stateData.state,
      failures: this.stateData.failures.length,
      successes: this.stateData.successes,
      openedAt: this.stateData.openedAt,
      halfOpenedAt: this.stateData.halfOpenedAt
    };
  }
}

/**
 * Circuit breaker registry
 */
class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, config));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return this.breakers;
  }

  /**
   * Reset a circuit breaker
   */
  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }

  /**
   * Get status of all circuit breakers
   */
  getStatuses(): Record<string, ReturnType<CircuitBreaker['getStatus']>> {
    const statuses: Record<string, ReturnType<CircuitBreaker['getStatus']>> = {};
    this.breakers.forEach((breaker, name) => {
      statuses[name] = breaker.getStatus();
    });
    return statuses;
  }
}

/**
 * Global circuit breaker registry
 */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

