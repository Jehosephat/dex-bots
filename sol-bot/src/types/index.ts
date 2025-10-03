// Token configuration types
export interface TokenConfig {
  symbol: string;
  galaChainMint: string;
  solanaMint: string;
  solanaSymbol?: string;
  decimals: number;
  minTradeSize: number;
  maxTradeSize: number;
  enabled: boolean;
  gcQuoteVia?: string;
}

export interface QuoteTokenConfig {
  galaChainMint: string;
  decimals: number;
}

export interface TokensConfig {
  supportedTokens: TokenConfig[];
  quoteTokens?: Record<string, QuoteTokenConfig>;
  notes?: string;
}

// Trading configuration types
export interface TradingConfig {
  dryRun: boolean;
  minEdgeThreshold: number;
  maxPriceImpact: number;
  maxConcurrentTrades: number;
  slippageTolerance: number;
  executionTimeout: number;
  riskBuffer: number;
  priceUpdateInterval: number;
  cooldownPeriod: number;
}

export interface BridgingConfig {
  interval: number;
  thresholdMultiplier: number;
  maxBridgeDelay: number;
  bridgeCostUSD: number;
  bridgeCostGALA: number;
}

export interface RiskConfig {
  circuitBreakerThreshold: number;
  maxDailyLoss: number;
  maxDailyLossGALA: number;
  inventoryMinimums: Record<string, number>;
  inventoryTargets: Record<string, number>;
}

export interface MonitoringConfig {
  dashboardPort: number;
  slackEnabled: boolean;
  logLevel: string;
  alertRateLimit: number;
}

export interface BotConfig {
  trading: TradingConfig;
  bridging: BridgingConfig;
  risk: RiskConfig;
  monitoring: MonitoringConfig;
}

// Arbitrage opportunity types
export interface ArbitrageOpportunity {
  token: string;
  netEdge: number;
  gcSellPrice: number;
  solBuyPrice: number;
  bridgeCostGALA: number;
  recommendedSize: number;
  timestamp: number;
}

// Execution result types
export interface GalaChainResult {
  success: boolean;
  transactionId?: string;
  galaReceived: number;
  tokenSold: number;
  actualSlippage: number;
  executionTime: number;
  error?: string;
}

export interface SolanaResult {
  success: boolean;
  signature?: string;
  tokenReceived: number;
  costSOL: number;
  actualSlippage: number;
  executionTime: number;
  error?: string;
}

export interface ExecutionResult {
  success: boolean;
  token: string;
  gcResult: GalaChainResult;
  solResult: SolanaResult;
  realizedPnL: number;
  netEdge: number;
  executionTime: number;
  timestamp: number;
}

// Bridge types
export interface BridgeTransaction {
  txId: string;
  token: string;
  amount: number;
  fromChain: 'SOL' | 'GC';
  toChain: 'SOL' | 'GC';
  status: 'pending' | 'confirmed' | 'failed';
  estimatedArrival: number;
  actualArrival?: number;
  initiatedAt: number;
}

export interface BridgeStatus {
  txId: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations: number;
  estimatedArrival: number;
  error?: string;
}

export interface BridgeHealth {
  isHealthy: boolean;
  avgDelay: number;
  recentFailures: number;
  totalBridges: number;
  successRate: number;
}

// Inventory types
export interface InventoryStatus {
  gcBalances: Record<string, number>;
  solBalances: Record<string, number>;
  totalValueGALA: number;
  driftDirection: 'toward-gc' | 'toward-sol' | 'balanced';
  recommendations: string[];
}

// Risk validation types
export interface ValidationResult {
  isValid: boolean;
  message: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface RiskValidation {
  isValid: boolean;
  violations: ValidationResult[];
  riskScore: number;
}

// Alert types
export interface Alert {
  type: 'trade' | 'risk' | 'bridge' | 'system';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  data?: any;
  timestamp: number;
}

export interface RiskAlert extends Alert {
  type: 'risk';
  riskType: 'slippage' | 'edge' | 'impact' | 'inventory' | 'circuit-breaker';
}

export interface BridgeAlert extends Alert {
  type: 'bridge';
  token: string;
  amount: number;
  status: string;
  eta?: number;
}

// Telemetry types
export interface DashboardData {
  totalPnL: number;
  dailyPnL: number;
  winRate: number;
  avgEdge: number;
  tradeCount: number;
  inventoryStatus: InventoryStatus;
  bridgeStatus: BridgeHealth;
  systemHealth: SystemHealth;
  recentTrades: ExecutionResult[];
}

export interface SystemHealth {
  isHealthy: boolean;
  uptime: number;
  lastError?: string;
  circuitBreakerActive: boolean;
  activeTrades: number;
  pendingBridges: number;
}

// Price source types
export interface TokenPrice {
  token: string;
  price: number;
  priceUSD: number;
  liquidity: number;
  timestamp: number;
  source: 'galachain' | 'solana';
}

export interface PriceQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  route: string[];
  timestamp: number;
}

// State management types
export interface BotState {
  isRunning: boolean;
  isPaused: boolean;
  circuitBreakerActive: boolean;
  startTime: number;
  totalPnL: number;
  dailyPnL: number;
  tradeCount: number;
  lastTradeTime: number;
  pendingBridges: BridgeTransaction[];
  recentFailures: number;
  lastFailureTime: number;
}

