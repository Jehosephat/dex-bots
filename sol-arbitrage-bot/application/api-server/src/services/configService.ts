/**
 * Config Service
 * 
 * Handles reading and writing configuration files without modifying core bot code.
 * Uses the existing config file structure.
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export interface TokenConfig {
  symbol: string;
  enabled: boolean;
  tradeSize: number;
  decimals: number;
  galaChainMint: string; // Format: "G{TOKEN}|Unit|none|none"
  solanaMint: string;
  solanaSymbol?: string;
  gcQuoteVia?: string;
  solQuoteVia?: string;
  minBalanceGc?: number;
  minBalanceSol?: number;
  cooldownMinutes?: number;
  inventoryTarget?: number; // Total amount of tokens desired across both chains
}

export interface BridgingConfig {
  enabled: boolean;
  imbalanceThresholdPercent: number;
  targetSplitPercent: number;
  minRebalanceAmount: number;
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  maxBridgesPerDay: number;
  enabledTokens: string[];
  skipTokens: string[];
  bridgeCostUsd?: number; // Bridge cost in USD (default $1.25)
  tradesPerBridge?: number; // Number of trades per bridge (for amortization)
}

export interface InventoryConfig {
  minSolForFees: number;
  minGalaForReverse: number;
  balanceCheckCooldownSeconds: number;
  skipTokens: string[];
}

export interface TradingConfig {
  minEdgeBps: number;
  maxSlippageBps: number;
  riskBufferBps: number;
  maxPriceImpactBps: number;
  cooldownMinutes: number;
  maxDailyTrades: number;
  enableReverseArbitrage?: boolean;
  reverseArbitrageMinEdgeBps?: number;
  arbitrageDirection?: 'forward' | 'reverse' | 'best';
  dynamicSlippageMaxMultiplier?: number;
  dynamicSlippageEdgeRatio?: number;
}

export class ConfigService {
  private botRoot: string;
  private configPath: string;
  private tokensPath: string;

  constructor() {
    // Path to bot root (two levels up from api-server/dist)
    const currentDir = __dirname;
    if (currentDir.includes('dist')) {
      this.botRoot = path.resolve(currentDir, '../../..');
    } else {
      // Development mode
      this.botRoot = path.resolve(currentDir, '../../../..');
    }
    this.configPath = path.join(this.botRoot, 'config', 'config.json');
    this.tokensPath = path.join(this.botRoot, 'config', 'tokens.json');
  }

  /**
   * Read main config file
   */
  async readConfig(): Promise<any> {
    try {
      if (!existsSync(this.configPath)) {
        throw new Error('Config file not found');
      }
      const content = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to read config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Write main config file
   */
  async writeConfig(config: any): Promise<void> {
    try {
      // Create backup before writing
      if (existsSync(this.configPath)) {
        const backupPath = `${this.configPath}.backup.${Date.now()}`;
        await fs.copyFile(this.configPath, backupPath);
      }

      // Write new config
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Read tokens config
   * Includes both regular tokens and quote tokens
   */
  async readTokens(): Promise<TokenConfig[]> {
    try {
      if (!existsSync(this.tokensPath)) {
        return [];
      }
      const content = await fs.readFile(this.tokensPath, 'utf-8');
      const data = JSON.parse(content);
      
      const tokens: TokenConfig[] = [];
      
      // Add regular tokens
      if (data.tokens && typeof data.tokens === 'object') {
        tokens.push(...Object.values(data.tokens) as TokenConfig[]);
      } else if (Array.isArray(data)) {
        tokens.push(...data);
      }
      
      // Add quote tokens (convert to TokenConfig format)
      if (data.quoteTokens && typeof data.quoteTokens === 'object') {
        const quoteTokens = Object.entries(data.quoteTokens).map(([symbol, config]: [string, any]) => {
          return {
            symbol,
            enabled: false, // Quote tokens are not directly tradeable
            tradeSize: 0,
            decimals: config.decimals || 8,
            galaChainMint: config.galaChainMint || '',
            solanaMint: config.solanaMint || '',
            solanaSymbol: symbol,
            gcQuoteVia: undefined,
            solQuoteVia: undefined
          } as TokenConfig;
        });
        tokens.push(...quoteTokens);
      }
      
      return tokens;
    } catch (error) {
      throw new Error(`Failed to read tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Write tokens config
   * Only writes to the tokens section, preserves quoteTokens
   */
  async writeTokens(tokens: TokenConfig[]): Promise<void> {
    try {
      // Create backup before writing
      if (existsSync(this.tokensPath)) {
        const backupPath = `${this.tokensPath}.backup.${Date.now()}`;
        await fs.copyFile(this.tokensPath, backupPath);
      }

      // Read existing file to preserve structure (quoteTokens, etc.)
      let existingData: any = { tokens: {} };
      if (existsSync(this.tokensPath)) {
        try {
          const existingContent = await fs.readFile(this.tokensPath, 'utf-8');
          existingData = JSON.parse(existingContent);
        } catch (e) {
          // If we can't read existing, start fresh
        }
      }

      // Filter out quote tokens (they should not be in the tokens section)
      // Quote tokens are identified by having enabled=false, tradeSize=0, and no gcQuoteVia/solQuoteVia
      const regularTokens = tokens.filter(token => {
        // If it has quote token characteristics, exclude it
        if (token.enabled === false && token.tradeSize === 0 && !token.gcQuoteVia && !token.solQuoteVia) {
          // Check if it exists in quoteTokens - if so, it's a quote token
          if (existingData.quoteTokens && existingData.quoteTokens[token.symbol]) {
            return false;
          }
        }
        return true;
      });

      // Convert array to object format
      const tokensObject: any = {};
      regularTokens.forEach(token => {
        // Store token with symbol as key (symbol is also in the object)
        tokensObject[token.symbol] = token;
      });

      // Preserve other properties (like quoteTokens)
      const output = {
        ...existingData,
        tokens: tokensObject
      };

      await fs.writeFile(this.tokensPath, JSON.stringify(output, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get bridging config from main config
   */
  async getBridgingConfig(): Promise<BridgingConfig> {
    const config = await this.readConfig();
    return config.autoBridging || {
      enabled: false,
      imbalanceThresholdPercent: 80,
      targetSplitPercent: 50,
      minRebalanceAmount: 100,
      checkIntervalMinutes: 60,
      cooldownMinutes: 30,
      maxBridgesPerDay: 10,
      enabledTokens: [],
      skipTokens: []
    };
  }

  /**
   * Update bridging config in main config
   */
  async updateBridgingConfig(bridgingConfig: Partial<BridgingConfig>): Promise<void> {
    const config = await this.readConfig();
    config.autoBridging = {
      ...(config.autoBridging || {}),
      ...bridgingConfig
    };
    await this.writeConfig(config);
  }

  /**
   * Get inventory config from main config
   */
  async getInventoryConfig(): Promise<InventoryConfig> {
    const config = await this.readConfig();
    return config.balanceChecking || {
      minSolForFees: 0.001,
      minGalaForReverse: 1000,
      balanceCheckCooldownSeconds: 60,
      skipTokens: []
    };
  }

  /**
   * Update inventory config in main config
   */
  async updateInventoryConfig(inventoryConfig: Partial<InventoryConfig>): Promise<void> {
    const config = await this.readConfig();
    config.balanceChecking = {
      ...(config.balanceChecking || {}),
      ...inventoryConfig
    };
    await this.writeConfig(config);
  }

  /**
   * Get trading config from main config
   */
  async getTradingConfig(): Promise<TradingConfig> {
    const config = await this.readConfig();
    return config.trading || {
      minEdgeBps: 30,
      maxSlippageBps: 50,
      riskBufferBps: 10,
      maxPriceImpactBps: 250,
      cooldownMinutes: 5,
      maxDailyTrades: 100,
      enableReverseArbitrage: true,
      reverseArbitrageMinEdgeBps: 30,
      arbitrageDirection: 'best',
      dynamicSlippageMaxMultiplier: 2.0,
      dynamicSlippageEdgeRatio: 0.75
    };
  }

  /**
   * Update trading config in main config
   */
  async updateTradingConfig(tradingConfig: Partial<TradingConfig>): Promise<void> {
    const config = await this.readConfig();
    config.trading = {
      ...(config.trading || {}),
      ...tradingConfig
    };
    await this.writeConfig(config);
  }
}

