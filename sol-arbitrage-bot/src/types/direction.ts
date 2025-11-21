/**
 * Direction Types for Bidirectional Arbitrage
 * 
 * Defines types and utilities for forward and reverse arbitrage directions.
 */

/**
 * Arbitrage direction type
 * 
 * - 'forward': SELL on GalaChain → BUY on Solana (default)
 * - 'reverse': BUY on GalaChain → SELL on Solana
 */
export type ArbitrageDirection = 'forward' | 'reverse';

/**
 * Direction configuration
 */
export interface DirectionConfig {
  /** Forward direction config */
  forward: {
    enabled: boolean;
    minEdgeBps: number;
  };
  
  /** Reverse direction config */
  reverse: {
    enabled: boolean;
    minEdgeBps: number;
  };
  
  /** Direction selection priority */
  priority?: 'forward' | 'reverse' | 'best';
}

/**
 * Directional quote pair
 */
export interface DirectionalQuote {
  /** Direction of the quote */
  direction: ArbitrageDirection;
  
  /** GalaChain quote (if available) */
  gcQuote: any | null;
  
  /** Solana quote (if available) */
  solQuote: any | null;
}

/**
 * Direction utilities
 */
export const DirectionUtils = {
  /**
   * Check if direction is forward
   */
  isForward(direction: ArbitrageDirection | undefined): boolean {
    return direction === 'forward' || !direction;
  },
  
  /**
   * Check if direction is reverse
   */
  isReverse(direction: ArbitrageDirection | undefined): boolean {
    return direction === 'reverse';
  },
  
  /**
   * Get reverse direction
   */
  reverse(direction: ArbitrageDirection): ArbitrageDirection {
    return direction === 'forward' ? 'reverse' : 'forward';
  },
  
  /**
   * Get direction label for logging
   */
  getLabel(direction: ArbitrageDirection | undefined): string {
    return direction === 'reverse' ? 'REVERSE' : 'FORWARD';
  }
};

