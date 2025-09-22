/**
 * Configuration Manager
 * 
 * Handles loading, validation, and management of all configuration
 * including environment variables, wallet configurations, and runtime settings.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// Configuration interfaces
export interface TargetWallet {
  address: string;
  name: string;
  maxCopyAmount: number;
  enabled: boolean;
  priority: number;
  type: 'ethereum' | 'client';
}

export interface GlobalSettings {
  maxTotalExposure: number;
  blacklistedTokens: string[];
  whitelistedTokens: string[];
  defaultMaxCopyAmount: {
    ethereum: number;
    client: number;
  };
  copyMode: 'exact' | 'proportional';
  executionDelay: number;
  cooldownMinutes: number;
  slippageTolerance: number;
  maxDailyTrades: number;
  galaMinimumThreshold: number;
  websocketReconnectDelay: number;
  websocketMaxRetries: number;
}

export interface WalletConfig {
  targetWallets: TargetWallet[];
  globalSettings: GlobalSettings;
}

export interface EnvironmentConfig {
  // Wallet Configuration (REQUIRED)
  privateKey: string;
  walletAddress: string;
  
  // Target Wallets (REQUIRED)
  targetWallets: string;
  
  // Copy Trading Settings
  copyMode: 'exact' | 'proportional';
  maxPositionSize: number;
  executionDelay: number;
  cooldownMinutes: number;
  slippageTolerance: number;
  enableAutoTrading: boolean;
  minTradeAmount: number;
  maxDailyTrades: number;
  galaMinimumThreshold: number;
  
  // WebSocket Configuration
  websocketReconnectDelay: number;
  websocketMaxRetries: number;
  
  // Logging Configuration
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFile: string;
  
  // GalaChain API Configuration
  galachainRpcUrl: string;
  galachainWebsocketUrl: string;
  
  // Optional
  cgKey: string | undefined;
  
  // Development Settings
  nodeEnv: 'development' | 'production' | 'test';
  debug: boolean;
}

export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private envConfig: EnvironmentConfig | null = null;
  private walletConfig: WalletConfig | null = null;
  private configPath: string;
  // private envPath: string; // Reserved for future use

  private constructor() {
    this.configPath = path.join(process.cwd(), 'config.json');
    // this.envPath = path.join(process.cwd(), '.env'); // Reserved for future use
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Initialize configuration by loading environment variables and wallet config
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('🔧 Initializing configuration manager...');
      
      // Load environment configuration
      await this.loadEnvironmentConfig();
      
      // Load wallet configuration
      await this.loadWalletConfig();
      
      // Validate configurations
      this.validateConfigurations();
      
      logger.info('✅ Configuration manager initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize configuration manager:', error);
      throw error;
    }
  }

  /**
   * Load config file
   */
  private async loadConfigFile(): Promise<any> {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      const configData = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      logger.warn('⚠️ Could not load config.json, using defaults');
      return {};
    }
  }

  /**
   * Load and validate environment variables
   */
  private async loadEnvironmentConfig(): Promise<void> {
    logger.info('📋 Loading environment configuration...');
    
    const requiredEnvVars = [
      'PRIVATE_KEY',
      'WALLET_ADDRESS',
      'TARGET_WALLETS'
    ];

    const missingVars: string[] = [];
    
    for (const varName of requiredEnvVars) {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Load config file first to get defaults
    const configFile = await this.loadConfigFile();
    const globalSettings = configFile.globalSettings || {};
    
    // Parse and validate environment variables (env vars override config file)
    this.envConfig = {
      // Required
      privateKey: this.validatePrivateKey(process.env['PRIVATE_KEY']!),
      walletAddress: this.validateWalletAddress(process.env['WALLET_ADDRESS']!),
      targetWallets: process.env['TARGET_WALLETS']!,
      
      // Copy Trading Settings - env vars override config file
      copyMode: (process.env['COPY_MODE'] as 'exact' | 'proportional') || globalSettings.copyMode || 'proportional',
      maxPositionSize: this.parseNumber(process.env['MAX_POSITION_SIZE'], globalSettings.maxTotalExposure || 0.1),
      executionDelay: this.parseNumber(process.env['EXECUTION_DELAY'], globalSettings.executionDelay || 30),
      cooldownMinutes: this.parseNumber(process.env['COOLDOWN_MINUTES'], globalSettings.cooldownMinutes || 5),
      slippageTolerance: this.parseNumber(process.env['SLIPPAGE_TOLERANCE'], globalSettings.slippageTolerance || 0.05),
      enableAutoTrading: process.env['ENABLE_AUTO_TRADING'] === 'true' || globalSettings.enableAutoTrading === true,
      minTradeAmount: this.parseNumber(process.env['MIN_TRADE_AMOUNT'], 10),
      maxDailyTrades: this.parseNumber(process.env['MAX_DAILY_TRADES'], globalSettings.maxDailyTrades || 50),
      galaMinimumThreshold: this.parseNumber(process.env['GALA_MINIMUM_THRESHOLD'], globalSettings.galaMinimumThreshold || 50),
      
      // WebSocket Configuration
      websocketReconnectDelay: this.parseNumber(process.env['WEBSOCKET_RECONNECT_DELAY'], 5000),
      websocketMaxRetries: this.parseNumber(process.env['WEBSOCKET_MAX_RETRIES'], 10),
      
      // Logging Configuration
      logLevel: (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') || 'info',
      logFile: process.env['LOG_FILE'] || '/var/log/follow-bot.log',
      
      // GalaChain API Configuration
      galachainRpcUrl: process.env['GALACHAIN_RPC_URL'] || 'https://rpc.galachain.io',
      galachainWebsocketUrl: process.env['GALACHAIN_WEBSOCKET_URL'] || 'wss://explorer.galachain.io/ws',
      
      // Optional
      cgKey: process.env['CG_KEY'] || undefined,
      
      // Development Settings
      nodeEnv: (process.env['NODE_ENV'] as 'development' | 'production' | 'test') || 'development',
      debug: process.env['DEBUG'] === 'true'
    };

    logger.info('✅ Environment configuration loaded successfully');
  }

  /**
   * Load wallet configuration from JSON file
   */
  private async loadWalletConfig(): Promise<void> {
    logger.info('📋 Loading wallet configuration...');
    
    try {
      if (!fsSync.existsSync(this.configPath)) {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }

      const configData = fsSync.readFileSync(this.configPath, 'utf8');
      const parsedConfig = JSON.parse(configData) as WalletConfig;
      
      // Validate wallet configuration structure
      this.validateWalletConfigStructure(parsedConfig);
      
      this.walletConfig = parsedConfig;
      logger.info(`✅ Loaded ${parsedConfig.targetWallets.length} target wallets`);
    } catch (error) {
      logger.error('❌ Failed to load wallet configuration:', error);
      throw error;
    }
  }

  /**
   * Validate private key format
   */
  private validatePrivateKey(privateKey: string): string {
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      throw new Error('Invalid private key format. Must be 64 hex characters prefixed with 0x');
    }
    return privateKey;
  }

  /**
   * Validate wallet address format
   */
  private validateWalletAddress(address: string): string {
    if (!address.startsWith('eth|') && !address.startsWith('client|')) {
      throw new Error('Invalid wallet address format. Must start with "eth|" or "client|"');
    }
    return address;
  }

  /**
   * Parse number from environment variable with default
   */
  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      logger.warn(`Invalid number value: ${value}, using default: ${defaultValue}`);
      return defaultValue;
    }
    return parsed;
  }

  /**
   * Validate wallet configuration structure
   */
  private validateWalletConfigStructure(config: unknown): void {
    const configObj = config as Record<string, unknown>;
    
    if (!configObj['targetWallets'] || !Array.isArray(configObj['targetWallets'])) {
      throw new Error('Invalid wallet configuration: targetWallets must be an array');
    }

    if (!configObj['globalSettings']) {
      throw new Error('Invalid wallet configuration: globalSettings is required');
    }

    // Validate each target wallet
    for (const wallet of configObj['targetWallets'] as Array<Record<string, unknown>>) {
      if (!wallet['address'] || !wallet['name'] || typeof wallet['maxCopyAmount'] !== 'number') {
        throw new Error('Invalid wallet configuration: each wallet must have address, name, and maxCopyAmount');
      }
    }
  }

  /**
   * Validate all configurations
   */
  private validateConfigurations(): void {
    if (!this.envConfig || !this.walletConfig) {
      throw new Error('Configuration not properly loaded');
    }

    // Validate environment and wallet config compatibility
    const envTargetWallets = this.envConfig.targetWallets.split(',').map(w => w.trim());
    const configTargetWallets = this.walletConfig.targetWallets.map(w => w.address);

    // Check if environment target wallets match config file
    for (const envWallet of envTargetWallets) {
      if (!configTargetWallets.includes(envWallet)) {
        logger.warn(`Target wallet in environment not found in config: ${envWallet}`);
      }
    }

    logger.info('✅ Configuration validation completed');
  }

  /**
   * Get environment configuration
   */
  public getEnvironmentConfig(): EnvironmentConfig {
    if (!this.envConfig) {
      throw new Error('Environment configuration not loaded. Call initialize() first.');
    }
    return this.envConfig;
  }

  /**
   * Get wallet configuration
   */
  public getWalletConfig(): WalletConfig {
    if (!this.walletConfig) {
      throw new Error('Wallet configuration not loaded. Call initialize() first.');
    }
    return this.walletConfig;
  }

  /**
   * Get enabled target wallets
   */
  public getEnabledTargetWallets(): TargetWallet[] {
    if (!this.walletConfig) {
      throw new Error('Wallet configuration not loaded. Call initialize() first.');
    }
    return this.walletConfig.targetWallets
      .filter(wallet => wallet.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Reload configuration (hot reload)
   */
  public async reload(): Promise<void> {
    logger.info('🔄 Reloading configuration...');
    await this.initialize();
    logger.info('✅ Configuration reloaded successfully');
  }

  /**
   * Backup current configuration
   */
  public async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(process.cwd(), 'config', `config.backup.${timestamp}.json`);
    
    if (this.walletConfig) {
      fsSync.writeFileSync(backupPath, JSON.stringify(this.walletConfig, null, 2));
      logger.info(`✅ Configuration backed up to: ${backupPath}`);
      return backupPath;
    }
    
    throw new Error('No configuration to backup');
  }

  /**
   * Restore configuration from backup
   */
  public async restore(backupPath: string): Promise<void> {
    if (!fsSync.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const backupData = fsSync.readFileSync(backupPath, 'utf8');
    const parsedConfig = JSON.parse(backupData) as WalletConfig;
    
    this.validateWalletConfigStructure(parsedConfig);
    
    // Write to current config file
    fsSync.writeFileSync(this.configPath, JSON.stringify(parsedConfig, null, 2));
    
    // Reload configuration
    await this.reload();
    
    logger.info(`✅ Configuration restored from: ${backupPath}`);
  }
}
