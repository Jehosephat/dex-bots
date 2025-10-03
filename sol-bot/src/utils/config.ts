import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BotConfig, TokensConfig } from '../types';
import { logger } from './logger';

// Load environment variables
dotenv.config();

export class ConfigManager {
  private static instance: ConfigManager;
  private botConfig: BotConfig;
  private tokensConfig: TokensConfig;

  private constructor() {
    this.botConfig = this.loadBotConfig();
    this.tokensConfig = this.loadTokensConfig();
    this.validateConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadBotConfig(): BotConfig {
    const configPath = path.join(process.cwd(), 'config', 'config.json');
    try {
      const configData = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      logger.error(`Failed to load bot config: ${error}`);
      throw new Error('Failed to load bot configuration');
    }
  }

  private loadTokensConfig(): TokensConfig {
    const tokensPath = path.join(process.cwd(), 'config', 'tokens.json');
    try {
      const tokensData = fs.readFileSync(tokensPath, 'utf-8');
      return JSON.parse(tokensData);
    } catch (error) {
      logger.error(`Failed to load tokens config: ${error}`);
      throw new Error('Failed to load tokens configuration');
    }
  }

  private validateConfig(): void {
    // Validate required environment variables
    const required = [
      'GALA_PRIVATE_KEY',
      'GALA_WALLET_ADDRESS',
      'SOLANA_PRIVATE_KEY'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate bot config
    if (this.botConfig.trading.minEdgeThreshold <= 0) {
      throw new Error('minEdgeThreshold must be positive');
    }

    if (this.botConfig.trading.maxPriceImpact <= 0 || this.botConfig.trading.maxPriceImpact > 1) {
      throw new Error('maxPriceImpact must be between 0 and 1');
    }

    // Validate tokens config
    if (!this.tokensConfig.supportedTokens || this.tokensConfig.supportedTokens.length === 0) {
      throw new Error('No supported tokens configured');
    }

    logger.info('Configuration validated successfully');
  }

  getBotConfig(): BotConfig {
    return this.botConfig;
  }

  getTokensConfig(): TokensConfig {
    return this.tokensConfig;
  }

  getEnabledTokens() {
    return this.tokensConfig.supportedTokens.filter(t => t.enabled);
  }

  getToken(symbol: string) {
    return this.tokensConfig.supportedTokens.find(t => t.symbol === symbol);
  }

  // Environment variable getters
  getGalaPrivateKey(): string {
    return process.env.GALA_PRIVATE_KEY!;
  }

  getGalaWalletAddress(): string {
    return process.env.GALA_WALLET_ADDRESS!;
  }

  getGalaRpcEndpoint(): string {
    return process.env.GALA_RPC_ENDPOINT || 'https://mainnet.galachain.io';
  }

  getSolanaPrivateKey(): string {
    return process.env.SOLANA_PRIVATE_KEY!;
  }

  getSolanaRpcEndpoint(): string {
    return process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
  }

  getBridgeApiUrl(): string {
    return process.env.GALACHAIN_BRIDGE_API || 'https://bridge.galachain.io';
  }

  getBridgeApiKey(): string {
    return process.env.BRIDGE_API_KEY || '';
  }

  getSlackWebhookUrl(): string {
    return process.env.SLACK_WEBHOOK_URL || '';
  }

  isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  // Dynamic config updates
  updateRiskBuffer(newBuffer: number): void {
    if (newBuffer < 0 || newBuffer > 1) {
      throw new Error('Risk buffer must be between 0 and 1');
    }
    this.botConfig.trading.riskBuffer = newBuffer;
    logger.info(`Risk buffer updated to ${newBuffer}`);
  }

  updateMinEdgeThreshold(newThreshold: number): void {
    if (newThreshold <= 0) {
      throw new Error('Minimum edge threshold must be positive');
    }
    this.botConfig.trading.minEdgeThreshold = newThreshold;
    logger.info(`Min edge threshold updated to ${newThreshold}`);
  }

  updateMaxPriceImpact(newImpact: number): void {
    if (newImpact <= 0 || newImpact > 1) {
      throw new Error('Max price impact must be between 0 and 1');
    }
    this.botConfig.trading.maxPriceImpact = newImpact;
    logger.info(`Max price impact updated to ${newImpact}`);
  }
}

export const config = ConfigManager.getInstance();

