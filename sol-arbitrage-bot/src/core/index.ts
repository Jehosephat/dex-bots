/**
 * Core Module - SOL Arbitrage Bot
 * 
 * Core functionality for the arbitrage bot including state management.
 */

export { StateManager } from './stateManager';

// Re-export types for convenience
export type {
  BotState,
  InventoryState,
  ChainInventory,
  TokenBalance,
  ExecutionResult,
  BridgeStatus,
  CooldownInfo,
  PerformanceMetrics
} from '../types/core';
