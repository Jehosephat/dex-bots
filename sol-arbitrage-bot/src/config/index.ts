/**
 * Configuration Module for SOL Arbitrage Bot
 * 
 * Provides easy access to configuration throughout the application.
 */

import { ConfigManager } from './configManager';
import { BotConfig, TokenConfig, QuoteTokenConfig, TradingConfig, BridgingConfig, MonitoringConfig, NetworksConfig } from '../types/config';

// Global configuration manager instance
let configManager: ConfigManager | null = null;

/**
 * Initialize the configuration manager
 */
export function initializeConfig(configPath?: string, tokensPath?: string): ConfigManager {
  if (configManager) {
    return configManager;
  }
  
  configManager = new ConfigManager(configPath, tokensPath);
  return configManager;
}

/**
 * Get the configuration manager instance
 */
export function getConfigManager(): ConfigManager {
  if (!configManager) {
    throw new Error('Configuration not initialized. Call initializeConfig() first.');
  }
  return configManager;
}

/**
 * Get the complete bot configuration
 */
export function getConfig(): BotConfig {
  return getConfigManager().getConfig();
}

/**
 * Get configuration for a specific token
 */
export function getTokenConfig(symbol: string): TokenConfig | undefined {
  return getConfigManager().getTokenConfig(symbol);
}

/**
 * Get configuration for a specific quote token
 */
export function getQuoteTokenConfig(symbol: string): QuoteTokenConfig | undefined {
  return getConfigManager().getQuoteTokenConfig(symbol);
}

/**
 * Get trading configuration
 */
export function getTradingConfig(): TradingConfig {
  return getConfigManager().getTradingConfig();
}

/**
 * Get bridging configuration
 */
export function getBridgingConfig(): BridgingConfig {
  return getConfigManager().getBridgingConfig();
}

/**
 * Get monitoring configuration
 */
export function getMonitoringConfig(): MonitoringConfig {
  return getConfigManager().getMonitoringConfig();
}

/**
 * Get networks configuration
 */
export function getNetworksConfig(): NetworksConfig {
  return getConfigManager().getNetworksConfig();
}

/**
 * Validate configuration
 */
export function validateConfig() {
  return getConfigManager().validateConfig();
}

/**
 * Reload configuration
 */
export async function reloadConfig(): Promise<void> {
  return getConfigManager().reloadConfig();
}

/**
 * Get enabled tokens
 */
export function getEnabledTokens(): TokenConfig[] {
  const config = getConfig();
  return Object.values(config.tokens).filter(token => token.enabled);
}

/**
 * Get token by symbol (case-insensitive)
 */
export function getTokenBySymbol(symbol: string): TokenConfig | undefined {
  const config = getConfig();
  const upperSymbol = symbol.toUpperCase();
  return config.tokens[upperSymbol];
}

/**
 * Get quote token by symbol (case-insensitive)
 */
export function getQuoteTokenBySymbol(symbol: string): QuoteTokenConfig | undefined {
  const config = getConfig();
  if (!config || !config.quoteTokens) {
    return undefined;
  }
  const upperSymbol = symbol.toUpperCase();
  return config.quoteTokens[upperSymbol];
}

/**
 * Check if a token is enabled
 */
export function isTokenEnabled(symbol: string): boolean {
  const token = getTokenBySymbol(symbol);
  return token ? token.enabled : false;
}

/**
 * Get all token symbols
 */
export function getAllTokenSymbols(): string[] {
  const config = getConfig();
  return Object.keys(config.tokens);
}

/**
 * Get all quote token symbols
 */
export function getAllQuoteTokenSymbols(): string[] {
  const config = getConfig();
  return Object.keys(config.quoteTokens);
}

// Export types for external use
export type {
  BotConfig,
  TokenConfig,
  QuoteTokenConfig,
  TradingConfig,
  BridgingConfig,
  MonitoringConfig,
  NetworksConfig
} from '../types/config';
