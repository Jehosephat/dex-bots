/**
 * Quote Strategy Interface
 * 
 * Defines the interface for quote strategies.
 * Each strategy handles a specific type of quote.
 */

import { PriceQuote } from '../../../types/core';
import { TokenConfig } from '../../../types/config';

/**
 * Quote Strategy Interface
 */
export interface IQuoteStrategy {
  /**
   * Get quote for a token
   * 
   * @param symbol - Token symbol
   * @param amount - Trade amount
   * @param tokenConfig - Token configuration
   * @returns Price quote or null if failed
   */
  getQuote(symbol: string, amount: number, tokenConfig: TokenConfig): Promise<PriceQuote | null>;

  /**
   * Check if this strategy can handle the given token configuration
   */
  canHandle(tokenConfig: TokenConfig, reverse?: boolean): boolean;
}

/**
 * Quote strategy context
 */
export interface QuoteStrategyContext {
  /** Token symbol */
  symbol: string;
  
  /** Trade amount */
  amount: number;
  
  /** Token configuration */
  tokenConfig: TokenConfig;
  
  /** Whether this is a reverse quote */
  reverse?: boolean;
}

