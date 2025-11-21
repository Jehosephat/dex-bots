/**
 * Configuration Service Interface
 * 
 * Defines the interface for configuration management to enable dependency injection
 * and better testability.
 */

import {
  BotConfig,
  TokenConfig,
  QuoteTokenConfig,
  TradingConfig,
  BridgingConfig,
  MonitoringConfig,
  NetworksConfig,
  AutoBridgingConfig,
  ConfigValidationResult,
} from '../types/config';

/**
 * Configuration Service Interface
 * 
 * Provides access to bot configuration with validation and type safety.
 * This interface allows for easy mocking in tests and dependency injection.
 */
export interface IConfigService {
  /**
   * Get the complete bot configuration
   */
  getConfig(): BotConfig;

  /**
   * Get configuration for a specific token
   */
  getTokenConfig(symbol: string): TokenConfig | undefined;

  /**
   * Get configuration for a specific quote token
   */
  getQuoteTokenConfig(symbol: string): QuoteTokenConfig | undefined;

  /**
   * Get trading configuration
   */
  getTradingConfig(): TradingConfig;

  /**
   * Get bridging configuration
   */
  getBridgingConfig(): BridgingConfig;

  /**
   * Get monitoring configuration
   */
  getMonitoringConfig(): MonitoringConfig;

  /**
   * Get networks configuration
   */
  getNetworksConfig(): NetworksConfig;

  /**
   * Get all enabled tokens
   */
  getEnabledTokens(): TokenConfig[];

  /**
   * Get token by symbol (case-insensitive)
   */
  getTokenBySymbol(symbol: string): TokenConfig | undefined;

  /**
   * Get quote token by symbol (case-insensitive)
   */
  getQuoteTokenBySymbol(symbol: string): QuoteTokenConfig | undefined;

  /**
   * Check if a token is enabled
   */
  isTokenEnabled(symbol: string): boolean;

  /**
   * Validate configuration
   */
  validateConfig(): ConfigValidationResult;

  /**
   * Reload configuration from files
   */
  reloadConfig(): Promise<void>;
  
  /**
   * Get direction configuration for bidirectional arbitrage
   */
  getDirectionConfig(): import('../types/direction').DirectionConfig;
  
  /**
   * Get strategies configuration (if available)
   */
  getStrategiesConfig(): Record<string, any> | undefined;
  
  /**
   * Get auto-bridging configuration (if available)
   */
  getAutoBridgingConfig(): AutoBridgingConfig | undefined;
}

