/**
 * Core Types and Interfaces for SOL Arbitrage Bot
 * 
 * Defines the fundamental data structures used throughout the arbitrage bot.
 */

import BigNumber from 'bignumber.js';

// ============================================================================
// ARBITRAGE OPPORTUNITY TYPES
// ============================================================================

export interface ArbitrageOpportunity {
  /** Unique identifier for this opportunity */
  id: string;
  
  /** Token symbol being arbitraged */
  tokenSymbol: string;
  
  /** Trade size for this opportunity */
  tradeSize: number;
  
  /** GalaChain sell price (in GALA) */
  galaChainPrice: BigNumber;
  
  /** Solana buy price (in SOL) */
  solanaPrice: BigNumber;
  
  /** SOL to GALA conversion rate */
  solToGalaRate: BigNumber;
  
  /** Net edge calculation (in GALA) */
  netEdge: BigNumber;
  
  /** Net edge in basis points */
  netEdgeBps: number;
  
  /** Price impact on GalaChain (in basis points) */
  galaChainPriceImpactBps: number;
  
  /** Price impact on Solana (in basis points) */
  solanaPriceImpactBps: number;
  
  /** Bridge cost (in GALA) */
  bridgeCost: BigNumber;
  
  /** Risk buffer (in GALA) */
  riskBuffer: BigNumber;
  
  /** Timestamp when opportunity was detected */
  timestamp: number;
  
  /** Whether this opportunity passes all guardrails */
  isValid: boolean;
  
  /** Reasons why opportunity is invalid (if any) */
  invalidationReasons: string[];
  
  /** Quote freshness (seconds since last update) */
  quoteAgeSeconds: number;
}

// ============================================================================
// EXECUTION RESULT TYPES
// ============================================================================

export interface ExecutionResult {
  /** Unique identifier for this execution */
  id: string;
  
  /** Token symbol being executed */
  tokenSymbol: string;
  
  /** Trade size executed */
  tradeSize: number;
  
  /** Whether execution was successful */
  success: boolean;
  
  /** GalaChain sell transaction details */
  galaChainTx?: TransactionResult;
  
  /** Solana buy transaction details */
  solanaTx?: TransactionResult;
  
  /** Actual proceeds from GalaChain sell (in GALA) */
  actualGalaChainProceeds: BigNumber;
  
  /** Actual cost of Solana buy (in SOL) */
  actualSolanaCost: BigNumber;
  
  /** Actual cost of Solana buy (in GALA) */
  actualSolanaCostGala: BigNumber;
  
  /** Actual net edge realized (in GALA) */
  actualNetEdge: BigNumber;
  
  /** Actual net edge in basis points */
  actualNetEdgeBps: number;
  
  /** Slippage experienced on GalaChain (in basis points) */
  galaChainSlippageBps: number;
  
  /** Slippage experienced on Solana (in basis points) */
  solanaSlippageBps: number;
  
  /** Total fees paid (in GALA) */
  totalFees: BigNumber;
  
  /** Timestamp when execution started */
  startTimestamp: number;
  
  /** Timestamp when execution completed */
  endTimestamp: number;
  
  /** Execution duration in milliseconds */
  durationMs: number;
  
  /** Error message if execution failed */
  error?: string;
  
  /** Partial fill information */
  partialFill?: PartialFillInfo;
}

export interface TransactionResult {
  /** Transaction hash/ID */
  txHash: string;
  
  /** Block number where transaction was included */
  blockNumber?: number;
  
  /** Gas used (for GalaChain) */
  gasUsed?: number;
  
  /** Priority fee paid (for Solana) */
  priorityFee?: number;
  
  /** Transaction status */
  status: 'pending' | 'confirmed' | 'failed';
  
  /** Confirmation timestamp */
  confirmedAt?: number;
  
  /** Error message if transaction failed */
  error?: string;
}

export interface PartialFillInfo {
  /** Whether this was a partial fill */
  isPartial: boolean;
  
  /** Actual amount filled */
  filledAmount: BigNumber;
  
  /** Percentage of order filled (0-100) */
  fillPercentage: number;
  
  /** Whether the counterpart leg was cancelled */
  counterpartCancelled: boolean;
}

// ============================================================================
// INVENTORY STATE TYPES
// ============================================================================

export interface InventoryState {
  /** Token balances on GalaChain */
  galaChain: ChainInventory;
  
  /** Token balances on Solana */
  solana: ChainInventory;
  
  /** Last updated timestamp */
  lastUpdated: number;
  
  /** Version for optimistic updates */
  version: number;
}

export interface ChainInventory {
  /** Token balances by symbol */
  tokens: Record<string, TokenBalance>;
  
  /** Native token balance (GALA for GalaChain, SOL for Solana) */
  native: BigNumber;
  
  /** Total USD value of all tokens */
  totalValueUsd: BigNumber;
  
  /** Last updated timestamp */
  lastUpdated: number;
}

export interface TokenBalance {
  /** Token symbol */
  symbol: string;
  
  /** Token mint address */
  mint: string;
  
  /** Raw balance (with decimals) */
  rawBalance: BigNumber;
  
  /** Human-readable balance */
  balance: BigNumber;
  
  /** Token decimals */
  decimals: number;
  
  /** USD value of this balance */
  valueUsd: BigNumber;
  
  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// PRICE QUOTE TYPES
// ============================================================================

export interface PriceQuote {
  /** Token symbol */
  symbol: string;
  
  /** Quote price */
  price: BigNumber;
  
  /** Quote currency (GALA, SOL, USD) */
  currency: string;
  
  /** Trade size this quote is for */
  tradeSize: number;
  
  /** Price impact in basis points */
  priceImpactBps: number;
  
  /** Minimum output amount (for exact input) */
  minOutput?: BigNumber;
  
  /** Maximum input amount (for exact output) */
  maxInput?: BigNumber;
  
  /** Fee tier used */
  feeTier?: number;
  
  /** Pool address used */
  poolAddress?: string;
  
  /** Quote provider */
  provider: string;
  
  /** Quote timestamp */
  timestamp: number;
  
  /** Quote expiry time */
  expiresAt: number;
  
  /** Whether quote is still valid */
  isValid: boolean;
  
  /** Error message if quote failed */
  error?: string;
}

export interface GalaChainQuote extends PriceQuote {
  /** GalaChain specific fields */
  currency: 'GALA';
  
  /** GALA fee for this swap */
  galaFee: BigNumber;
  
  /** Pool fee tier */
  feeTier: number;
  
  /** Route taken (for multi-hop swaps) */
  route?: string[];
  
  /** Pool liquidity information (if available) */
  poolLiquidity?: {
    /** Active liquidity in current tick */
    liquidity: BigNumber;
    /** Total liquidity across all ticks */
    grossPoolLiquidity: BigNumber;
  };
}

export interface SolanaQuote extends PriceQuote {
  /** Solana specific fields */
  currency: string; // Can be SOL, USDC, etc.
  
  /** Priority fee estimate */
  priorityFee: BigNumber;
  
  /** Jupiter route information */
  jupiterRoute?: JupiterRoute;
}

export interface JupiterRoute {
  /** Route ID */
  routeId: string;
  
  /** Input mint */
  inputMint: string;
  
  /** Output mint */
  outputMint: string;
  
  /** Route steps */
  steps: JupiterRouteStep[];
  
  /** Total price impact */
  totalPriceImpact: number;
  
  /** Total fee */
  totalFee: number;
}

export interface JupiterRouteStep {
  /** Step type */
  type: string;
  
  /** Input mint */
  inputMint: string;
  
  /** Output mint */
  outputMint: string;
  
  /** Amount in */
  amountIn: BigNumber;
  
  /** Amount out */
  amountOut: BigNumber;
  
  /** Price impact */
  priceImpact: number;
  
  /** Fee */
  fee: number;
}

// ============================================================================
// TRADE DECISION TYPES
// ============================================================================

export interface TradeDecision {
  /** Unique identifier for this decision */
  id: string;
  
  /** Token symbol */
  tokenSymbol: string;
  
  /** Whether to execute the trade */
  shouldExecute: boolean;
  
  /** Arbitrage opportunity that triggered this decision */
  opportunity: ArbitrageOpportunity;
  
  /** Decision timestamp */
  timestamp: number;
  
  /** Reasons for the decision */
  reasons: string[];
  
  /** Risk assessment */
  riskAssessment: RiskAssessment;
  
  /** Cooldown information */
  cooldown?: CooldownInfo;
}

export interface RiskAssessment {
  /** Overall risk score (0-100) */
  riskScore: number;
  
  /** Price impact risk */
  priceImpactRisk: 'low' | 'medium' | 'high';
  
  /** Liquidity risk */
  liquidityRisk: 'low' | 'medium' | 'high';
  
  /** Bridge risk */
  bridgeRisk: 'low' | 'medium' | 'high';
  
  /** Market volatility risk */
  volatilityRisk: 'low' | 'medium' | 'high';
  
  /** Risk factors identified */
  riskFactors: string[];
}

export interface CooldownInfo {
  /** Whether token is in cooldown */
  isInCooldown: boolean;
  
  /** Cooldown end timestamp */
  cooldownEndsAt?: number;
  
  /** Remaining cooldown time in seconds */
  remainingSeconds?: number;
  
  /** Reason for cooldown */
  reason: string;
}

// ============================================================================
// BRIDGE STATUS TYPES
// ============================================================================

export interface BridgeStatus {
  /** Unique identifier for this bridge operation */
  id: string;
  
  /** Token symbol being bridged */
  tokenSymbol: string;
  
  /** Amount being bridged */
  amount: BigNumber;
  
  /** Source chain */
  sourceChain: 'solana';
  
  /** Destination chain */
  destinationChain: 'galachain';
  
  /** Bridge status */
  status: 'pending' | 'submitted' | 'confirmed' | 'completed' | 'failed';
  
  /** Source transaction hash */
  sourceTxHash?: string;
  
  /** Destination transaction hash */
  destinationTxHash?: string;
  
  /** Bridge transaction hash */
  bridgeTxHash?: string;
  
  /** Bridge fee paid */
  bridgeFee: BigNumber;
  
  /** Submission timestamp */
  submittedAt: number;
  
  /** Completion timestamp */
  completedAt?: number;
  
  /** Estimated completion time */
  estimatedCompletionAt?: number;
  
  /** Error message if bridge failed */
  error?: string;
  
  /** Retry count */
  retryCount: number;
  
  /** Maximum retries allowed */
  maxRetries: number;
}

// ============================================================================
// STATE MANAGEMENT TYPES
// ============================================================================

export interface BotState {
  /** Current inventory state */
  inventory: InventoryState;
  
  /** Pending bridge operations */
  pendingBridges: BridgeStatus[];
  
  /** Recent trade history */
  recentTrades: ExecutionResult[];
  
  /** Token cooldowns */
  tokenCooldowns: Record<string, CooldownInfo>;
  
  /** Daily trade counts */
  dailyTradeCounts: Record<string, number>;
  
  /** Last bridge time by token */
  lastBridgeTimes: Record<string, number>;
  
  /** Bot operational status */
  status: 'running' | 'paused' | 'stopped' | 'error';
  
  /** Last heartbeat timestamp */
  lastHeartbeat: number;
  
  /** Error information if status is error */
  error?: string;
  
  /** State version */
  version: number;
  
  /** Last saved timestamp */
  lastSaved: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface PriceImpact {
  /** Price impact in basis points */
  bps: number;
  
  /** Price impact percentage */
  percentage: number;
  
  /** Whether impact is within acceptable limits */
  isAcceptable: boolean;
  
  /** Maximum allowed impact in basis points */
  maxAllowedBps: number;
}

export interface SlippageInfo {
  /** Expected amount */
  expected: BigNumber;
  
  /** Actual amount */
  actual: BigNumber;
  
  /** Slippage in basis points */
  slippageBps: number;
  
  /** Slippage percentage */
  slippagePercentage: number;
  
  /** Whether slippage is within tolerance */
  isWithinTolerance: boolean;
  
  /** Maximum allowed slippage in basis points */
  maxAllowedBps: number;
}

export interface PerformanceMetrics {
  /** Total trades executed */
  totalTrades: number;
  
  /** Successful trades */
  successfulTrades: number;
  
  /** Failed trades */
  failedTrades: number;
  
  /** Total PnL in GALA */
  totalPnlGala: BigNumber;
  
  /** Total PnL in USD */
  totalPnlUsd: BigNumber;
  
  /** Average trade size */
  averageTradeSize: BigNumber;
  
  /** Average net edge */
  averageNetEdge: BigNumber;
  
  /** Best trade PnL */
  bestTradePnl: BigNumber;
  
  /** Worst trade PnL */
  worstTradePnl: BigNumber;
  
  /** Win rate percentage */
  winRate: number;
  
  /** Last updated timestamp */
  lastUpdated: number;
}
