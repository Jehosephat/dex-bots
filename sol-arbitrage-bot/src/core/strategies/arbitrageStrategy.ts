/**
 * Arbitrage Strategy Types
 * 
 * Defines types for flexible arbitrage strategies that can use different
 * quote currencies on each chain.
 */

import { GalaChainQuote, SolanaQuote } from '../../types/core';
import { RateConversionResult } from '../rateConverter';
import { EdgeCalculationResult } from '../edgeCalculator';

/**
 * Chain-side configuration for a strategy
 * 
 * Defines what operation to perform on a specific chain and which quote currency to use
 */
export interface ChainSideConfig {
  /** Chain name */
  chain: 'galaChain' | 'solana';
  
  /** Quote currency to use (GALA, SOL, USDC, etc.) */
  quoteCurrency: string;
  
  /** Operation: 'buy' or 'sell' */
  operation: 'buy' | 'sell';
}

/**
 * Arbitrage Strategy Definition
 * 
 * Defines a specific arbitrage path between two chains with specific quote currencies
 */
export interface ArbitrageStrategy {
  /** Unique strategy identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Strategy description */
  description?: string;
  
  /** GalaChain side configuration */
  galaChainSide: ChainSideConfig;
  
  /** Solana side configuration */
  solanaSide: ChainSideConfig;
  
  /** Whether this strategy is enabled */
  enabled: boolean;
  
  /** Minimum edge threshold in basis points (optional, uses global default if not set) */
  minEdgeBps?: number;
  
  /** Priority order (lower = higher priority) */
  priority?: number;
}

/**
 * Strategy evaluation result
 * 
 * Contains the results of evaluating a single strategy for a token
 */
export interface StrategyEvaluationResult {
  /** Strategy that was evaluated */
  strategy: ArbitrageStrategy;
  
  /** Token symbol that was evaluated */
  tokenSymbol: string;
  
  /** Whether evaluation was successful */
  success: boolean;
  
  /** GalaChain quote (if available) */
  gcQuote: GalaChainQuote | null;
  
  /** Solana quote (if available) */
  solQuote: SolanaQuote | null;
  
  /** Rate conversion result (if available) */
  rateConversion: RateConversionResult | null;
  
  /** Risk evaluation result (if available) */
  riskResult: any | null;
  
  /** Edge calculation result (if available) */
  edge?: EdgeCalculationResult;
  
  /** Error message if evaluation failed */
  error?: string;
  
  /** Timestamp when evaluation was performed */
  timestamp: number;
}

/**
 * Strategy comparison result
 * 
 * Contains comparison of multiple strategies for selecting the best one
 */
export interface StrategyComparisonResult {
  /** All evaluated strategies */
  strategies: StrategyEvaluationResult[];
  
  /** Best strategy (if any) */
  bestStrategy: StrategyEvaluationResult | null;
  
  /** Whether any strategy is profitable */
  hasProfitableStrategy: boolean;
  
  /** Number of strategies that passed risk checks */
  passingStrategies: number;
}

