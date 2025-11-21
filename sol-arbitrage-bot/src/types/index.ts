/**
 * Types Index - SOL Arbitrage Bot
 * 
 * Central export point for all types and interfaces.
 */

// Configuration types
export * from './config';

// Core types
export * from './core';

// Re-export commonly used types for convenience
export type {
  ArbitrageOpportunity,
  ExecutionResult,
  InventoryState,
  PriceQuote,
  TradeDecision,
  BridgeStatus,
  BotState,
  PerformanceMetrics
} from './core';

export type {
  BotConfig,
  TokenConfig,
  QuoteTokenConfig,
  TradingConfig,
  BridgingConfig,
  MonitoringConfig
} from './config';
