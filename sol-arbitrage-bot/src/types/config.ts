/**
 * Configuration Types for SOL Arbitrage Bot
 * 
 * Defines all configuration interfaces and types used throughout the bot.
 */

export interface TokenConfig {
  symbol: string;
  galaChainMint: string;
  solanaMint: string;
  solanaSymbol: string;
  decimals: number;
  tradeSize: number;
  enabled: boolean;
  gcQuoteVia: string;
  solQuoteVia: string;
}

export interface QuoteTokenConfig {
  galaChainMint: string;
  solanaMint: string;
  decimals: number;
}

export interface TradingConfig {
  minEdgeBps: number;
  maxSlippageBps: number;
  riskBufferBps: number;
  maxPriceImpactBps: number;
  cooldownMinutes: number;
  maxDailyTrades: number;
  enableReverseArbitrage?: boolean; // Enable reverse arbitrage (buy GC, sell SOL)
  reverseArbitrageMinEdgeBps?: number; // Min edge for reverse (defaults to minEdgeBps)
  arbitrageDirection?: 'forward' | 'reverse' | 'best'; // Force direction or choose best
}

export interface BridgingConfig {
  intervalMinutes: number;
  thresholdUsd: number;
  maxRetries: number;
  retryDelayMinutes: number;
  tradesPerBridge?: number; // Number of trades before needing to bridge (for amortization)
  bridgeCostUsd?: number; // Bridge cost in USD (default $1.25)
}

export interface MonitoringConfig {
  enableAlerts: boolean;
  alertWebhookUrl: string;
  inventoryFloorUsd: number;
  bridgeTimeoutMinutes: number;
}

export interface AutoBridgingConfig {
  enabled: boolean;
  imbalanceThresholdPercent: number;
  targetSplitPercent: number;
  minRebalanceAmount: number;
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  maxBridgesPerDay: number;
  enabledTokens: string[]; // Empty = all enabled tokens
  skipTokens: string[];
}

export interface NetworkConfig {
  rpcUrl: string;
  chainId: string;
}

export interface NetworksConfig {
  galaChain: NetworkConfig;
  solana: NetworkConfig;
}

export interface BotConfig {
  tokens: Record<string, TokenConfig>;
  quoteTokens: Record<string, QuoteTokenConfig>;
  trading: TradingConfig;
  bridging: BridgingConfig;
  monitoring: MonitoringConfig;
  networks: NetworksConfig;
  strategies?: Record<string, any>; // Optional strategies configuration
  autoBridging?: AutoBridgingConfig; // Optional auto-bridging configuration
}

export interface EnvironmentConfig {
  // GalaChain configuration
  GALACHAIN_PRIVATE_KEY?: string;
  GALACHAIN_WALLET_ADDRESS?: string;
  
  // Solana configuration
  SOLANA_PRIVATE_KEY?: string;
  SOLANA_WALLET_ADDRESS?: string;
  
  // Bridge configuration
  BRIDGE_PRIVATE_KEY?: string;
  BRIDGE_WALLET_ADDRESS?: string;
  
  // External API keys
  COINGECKO_API_KEY?: string;
  JUPITER_API_KEY?: string;
  
  // Monitoring
  SLACK_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  
  // Override configuration values
  MIN_EDGE_BPS?: string;
  MAX_SLIPPAGE_BPS?: string;
  RISK_BUFFER_BPS?: string;
  MAX_PRICE_IMPACT_BPS?: string;
  COOLDOWN_MINUTES?: string;
  MAX_DAILY_TRADES?: string;
  BRIDGE_INTERVAL_MINUTES?: string;
  BRIDGE_THRESHOLD_USD?: string;
  INVENTORY_FLOOR_USD?: string;
  BRIDGE_TIMEOUT_MINUTES?: string;
  
  // Network overrides
  GALACHAIN_RPC_URL?: string;
  SOLANA_RPC_URL?: string;
}

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigManager {
  getConfig(): BotConfig;
  getTokenConfig(symbol: string): TokenConfig | undefined;
  getQuoteTokenConfig(symbol: string): QuoteTokenConfig | undefined;
  getTradingConfig(): TradingConfig;
  getBridgingConfig(): BridgingConfig;
  getMonitoringConfig(): MonitoringConfig;
  getNetworksConfig(): NetworksConfig;
  validateConfig(): ConfigValidationResult;
  reloadConfig(): Promise<void>;
}
