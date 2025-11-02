/**
 * Configuration Manager for SOL Arbitrage Bot
 * 
 * Handles loading, validation, and management of bot configuration
 * from JSON files and environment variables.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import logger from '../utils/logger';
import {
  BotConfig,
  TokenConfig,
  QuoteTokenConfig,
  TradingConfig,
  BridgingConfig,
  MonitoringConfig,
  NetworksConfig,
  EnvironmentConfig,
  ConfigValidationResult,
  ConfigManager as IConfigManager
} from '../types/config';

// Load environment variables
dotenvConfig();

export class ConfigManager implements IConfigManager {
  private config: BotConfig;
  private envConfig: EnvironmentConfig;
  private configPath: string;
  private tokensPath: string;

  constructor(configPath?: string, tokensPath?: string) {
    this.configPath = configPath || join(process.cwd(), 'config', 'config.json');
    this.tokensPath = tokensPath || join(process.cwd(), 'config', 'tokens.json');
    this.envConfig = this.loadEnvironmentConfig();
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from JSON files and environment variables
   */
  private loadConfig(): BotConfig {
    try {
      // Load base configuration
      const baseConfig = this.loadJsonConfig(this.configPath);
      
      // Load tokens configuration
      const tokensConfig = this.loadJsonConfig(this.tokensPath);
      
      // Merge configurations
      const mergedConfig: BotConfig = {
        ...baseConfig,
        tokens: tokensConfig.tokens || baseConfig.tokens || {},
        quoteTokens: tokensConfig.quoteTokens || baseConfig.quoteTokens || {}
      };

      // Apply environment variable overrides
      return this.applyEnvironmentOverrides(mergedConfig);
    } catch (error) {
      logger.error('Failed to load configuration', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Configuration loading failed');
    }
  }

  /**
   * Load JSON configuration file
   */
  private loadJsonConfig(filePath: string): any {
    if (!existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse configuration file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load environment configuration
   */
  private loadEnvironmentConfig(): EnvironmentConfig {
    return {
      GALACHAIN_PRIVATE_KEY: process.env.GALACHAIN_PRIVATE_KEY,
      GALACHAIN_WALLET_ADDRESS: process.env.GALACHAIN_WALLET_ADDRESS,
      SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY,
      SOLANA_WALLET_ADDRESS: process.env.SOLANA_WALLET_ADDRESS,
      BRIDGE_PRIVATE_KEY: process.env.BRIDGE_PRIVATE_KEY,
      BRIDGE_WALLET_ADDRESS: process.env.BRIDGE_WALLET_ADDRESS,
      COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
      JUPITER_API_KEY: process.env.JUPITER_API_KEY,
      SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
      DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
      MIN_EDGE_BPS: process.env.MIN_EDGE_BPS,
      MAX_SLIPPAGE_BPS: process.env.MAX_SLIPPAGE_BPS,
      RISK_BUFFER_BPS: process.env.RISK_BUFFER_BPS,
      MAX_PRICE_IMPACT_BPS: process.env.MAX_PRICE_IMPACT_BPS,
      COOLDOWN_MINUTES: process.env.COOLDOWN_MINUTES,
      MAX_DAILY_TRADES: process.env.MAX_DAILY_TRADES,
      BRIDGE_INTERVAL_MINUTES: process.env.BRIDGE_INTERVAL_MINUTES,
      BRIDGE_THRESHOLD_USD: process.env.BRIDGE_THRESHOLD_USD,
      INVENTORY_FLOOR_USD: process.env.INVENTORY_FLOOR_USD,
      BRIDGE_TIMEOUT_MINUTES: process.env.BRIDGE_TIMEOUT_MINUTES,
      GALACHAIN_RPC_URL: process.env.GALACHAIN_RPC_URL,
      SOLANA_RPC_URL: process.env.SOLANA_RPC_URL
    };
  }

  /**
   * Apply environment variable overrides to configuration
   */
  private applyEnvironmentOverrides(config: BotConfig): BotConfig {
    const overridden = { ...config };

    // Override trading configuration
    if (this.envConfig.MIN_EDGE_BPS) {
      overridden.trading.minEdgeBps = parseInt(this.envConfig.MIN_EDGE_BPS, 10);
    }
    if (this.envConfig.MAX_SLIPPAGE_BPS) {
      overridden.trading.maxSlippageBps = parseInt(this.envConfig.MAX_SLIPPAGE_BPS, 10);
    }
    if (this.envConfig.RISK_BUFFER_BPS) {
      overridden.trading.riskBufferBps = parseInt(this.envConfig.RISK_BUFFER_BPS, 10);
    }
    if (this.envConfig.MAX_PRICE_IMPACT_BPS) {
      overridden.trading.maxPriceImpactBps = parseInt(this.envConfig.MAX_PRICE_IMPACT_BPS, 10);
    }
    if (this.envConfig.COOLDOWN_MINUTES) {
      overridden.trading.cooldownMinutes = parseInt(this.envConfig.COOLDOWN_MINUTES, 10);
    }
    if (this.envConfig.MAX_DAILY_TRADES) {
      overridden.trading.maxDailyTrades = parseInt(this.envConfig.MAX_DAILY_TRADES, 10);
    }

    // Override bridging configuration
    if (this.envConfig.BRIDGE_INTERVAL_MINUTES) {
      overridden.bridging.intervalMinutes = parseInt(this.envConfig.BRIDGE_INTERVAL_MINUTES, 10);
    }
    if (this.envConfig.BRIDGE_THRESHOLD_USD) {
      overridden.bridging.thresholdUsd = parseFloat(this.envConfig.BRIDGE_THRESHOLD_USD);
    }

    // Override monitoring configuration
    if (this.envConfig.INVENTORY_FLOOR_USD) {
      overridden.monitoring.inventoryFloorUsd = parseFloat(this.envConfig.INVENTORY_FLOOR_USD);
    }
    if (this.envConfig.BRIDGE_TIMEOUT_MINUTES) {
      overridden.monitoring.bridgeTimeoutMinutes = parseInt(this.envConfig.BRIDGE_TIMEOUT_MINUTES, 10);
    }
    if (this.envConfig.SLACK_WEBHOOK_URL) {
      overridden.monitoring.alertWebhookUrl = this.envConfig.SLACK_WEBHOOK_URL;
    }

    // Override network configuration
    if (this.envConfig.GALACHAIN_RPC_URL) {
      overridden.networks.galaChain.rpcUrl = this.envConfig.GALACHAIN_RPC_URL;
    }
    if (this.envConfig.SOLANA_RPC_URL) {
      overridden.networks.solana.rpcUrl = this.envConfig.SOLANA_RPC_URL;
    }

    return overridden;
  }

  /**
   * Get the complete bot configuration
   */
  getConfig(): BotConfig {
    return this.config;
  }

  /**
   * Get configuration for a specific token
   */
  getTokenConfig(symbol: string): TokenConfig | undefined {
    return this.config.tokens[symbol];
  }

  /**
   * Get configuration for a specific quote token
   */
  getQuoteTokenConfig(symbol: string): QuoteTokenConfig | undefined {
    if (!this.config || !this.config.quoteTokens) {
      logger.warn(`⚠️ Config or quoteTokens not initialized when accessing ${symbol}`);
      return undefined;
    }
    return this.config.quoteTokens[symbol];
  }

  /**
   * Get trading configuration
   */
  getTradingConfig(): TradingConfig {
    if (!this.config || !this.config.trading) {
      logger.warn('⚠️ Trading config not found, returning empty config');
      throw new Error('Trading configuration not loaded');
    }
    return this.config.trading;
  }

  /**
   * Get bridging configuration
   */
  getBridgingConfig(): BridgingConfig {
    if (!this.config || !this.config.bridging) {
      logger.warn('⚠️ Bridging config not found, returning empty config');
      throw new Error('Bridging configuration not loaded');
    }
    return this.config.bridging;
  }

  /**
   * Get monitoring configuration
   */
  getMonitoringConfig(): MonitoringConfig {
    return this.config.monitoring;
  }

  /**
   * Get networks configuration
   */
  getNetworksConfig(): NetworksConfig {
    return this.config.networks;
  }

  /**
   * Validate configuration
   */
  validateConfig(): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate trading configuration
    if (this.config.trading.minEdgeBps < 0) {
      errors.push('minEdgeBps must be non-negative');
    }
    if (this.config.trading.maxSlippageBps < 0 || this.config.trading.maxSlippageBps > 10000) {
      errors.push('maxSlippageBps must be between 0 and 10000 (0-100%)');
    }
    if (this.config.trading.riskBufferBps < 0) {
      errors.push('riskBufferBps must be non-negative');
    }
    if (this.config.trading.maxPriceImpactBps < 0 || this.config.trading.maxPriceImpactBps > 10000) {
      errors.push('maxPriceImpactBps must be between 0 and 10000 (0-100%)');
    }
    if (this.config.trading.cooldownMinutes < 0) {
      errors.push('cooldownMinutes must be non-negative');
    }
    if (this.config.trading.maxDailyTrades < 0) {
      errors.push('maxDailyTrades must be non-negative');
    }

    // Validate bridging configuration
    if (this.config.bridging.intervalMinutes < 1) {
      errors.push('bridging.intervalMinutes must be at least 1');
    }
    if (this.config.bridging.thresholdUsd < 0) {
      errors.push('bridging.thresholdUsd must be non-negative');
    }
    if (this.config.bridging.maxRetries < 0) {
      errors.push('bridging.maxRetries must be non-negative');
    }
    if (this.config.bridging.retryDelayMinutes < 0) {
      errors.push('bridging.retryDelayMinutes must be non-negative');
    }

    // Validate monitoring configuration
    if (this.config.monitoring.inventoryFloorUsd < 0) {
      errors.push('monitoring.inventoryFloorUsd must be non-negative');
    }
    if (this.config.monitoring.bridgeTimeoutMinutes < 1) {
      errors.push('monitoring.bridgeTimeoutMinutes must be at least 1');
    }

    // Validate network configuration
    if (!this.config.networks.galaChain.rpcUrl) {
      errors.push('galaChain.rpcUrl is required');
    }
    if (!this.config.networks.solana.rpcUrl) {
      errors.push('solana.rpcUrl is required');
    }

    // Validate tokens
    const enabledTokens = Object.values(this.config.tokens).filter(token => token.enabled);
    if (enabledTokens.length === 0) {
      warnings.push('No tokens are enabled for trading');
    }

    for (const [symbol, token] of Object.entries(this.config.tokens)) {
      if (!token.galaChainMint) {
        errors.push(`Token ${symbol}: galaChainMint is required`);
      }
      if (!token.solanaMint) {
        errors.push(`Token ${symbol}: solanaMint is required`);
      }
      if (token.decimals < 0 || token.decimals > 18) {
        errors.push(`Token ${symbol}: decimals must be between 0 and 18`);
      }
      if (token.tradeSize <= 0) {
        errors.push(`Token ${symbol}: tradeSize must be positive`);
      }
    }

    // Validate quote tokens
    const quoteTokens = this.config?.quoteTokens || {};
    for (const [symbol, token] of Object.entries(quoteTokens)) {
      if (!token.galaChainMint) {
        errors.push(`Quote token ${symbol}: galaChainMint is required`);
      }
      if (!token.solanaMint) {
        errors.push(`Quote token ${symbol}: solanaMint is required`);
      }
      if (token.decimals < 0 || token.decimals > 18) {
        errors.push(`Quote token ${symbol}: decimals must be between 0 and 18`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Reload configuration from files
   */
  async reloadConfig(): Promise<void> {
    try {
      logger.info('Reloading configuration...');
      this.envConfig = this.loadEnvironmentConfig();
      this.config = this.loadConfig();
      
      const validation = this.validateConfig();
      if (!validation.isValid) {
        logger.error('Configuration validation failed after reload', { errors: validation.errors });
        throw new Error('Invalid configuration after reload');
      }
      
      logger.info('Configuration reloaded successfully');
    } catch (error) {
      logger.error('Failed to reload configuration', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Get environment configuration (for debugging/logging)
   */
  getEnvironmentConfig(): Partial<EnvironmentConfig> {
    // Return only non-sensitive environment config
    return {
      GALACHAIN_WALLET_ADDRESS: this.envConfig.GALACHAIN_WALLET_ADDRESS,
      SOLANA_WALLET_ADDRESS: this.envConfig.SOLANA_WALLET_ADDRESS,
      BRIDGE_WALLET_ADDRESS: this.envConfig.BRIDGE_WALLET_ADDRESS,
      COINGECKO_API_KEY: this.envConfig.COINGECKO_API_KEY ? '***' : undefined,
      JUPITER_API_KEY: this.envConfig.JUPITER_API_KEY ? '***' : undefined,
      SLACK_WEBHOOK_URL: this.envConfig.SLACK_WEBHOOK_URL ? '***' : undefined,
      DISCORD_WEBHOOK_URL: this.envConfig.DISCORD_WEBHOOK_URL ? '***' : undefined
    };
  }
}
