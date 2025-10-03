# SOL BOT Implementation Plan

## Overview

This document outlines the detailed implementation plan for the Inventory-Mode Cross-Chain Arbitrage Bot (Solana → GalaChain) as specified in the PRD. The bot will continuously detect and execute low-risk arbitrage opportunities that sell on GalaChain (GC) and buy on Solana (SOL), then batch-bridge purchased inventory from SOL to GC so that profits and inventory accumulate on GC.

## Architecture Update (October 3, 2025)

### Modular Price Discovery System ✅

The price discovery system has been refactored into a **plugin-based architecture** for maximum extensibility:

**New Structure:**
```
src/core/
├── priceDiscovery.ts              # Main orchestrator
└── priceProviders/
    ├── base.ts                    # Provider interface & base class
    ├── galachain.ts              # GalaChain DEX v3 provider
    ├── solana.ts                 # Solana/Jupiter provider
    ├── index.ts                  # Provider exports
    └── README.md                 # Provider documentation
```

**Key Benefits:**
- **Easy Extension**: Add new networks by implementing `IPriceProvider` interface
- **Separation of Concerns**: Each blockchain has its own provider module
- **Testability**: Test providers in isolation
- **Maintainability**: Changes to one provider don't affect others

**Adding New Networks:**
```typescript
// 1. Create new provider class
export class EthereumPriceProvider extends BasePriceProvider {
  async initialize(): Promise<void> { /* setup */ }
  getName(): string { return 'ethereum'; }
  async updatePrices(tokens: TokenConfig[]): Promise<void> { /* fetch prices */ }
}

// 2. Register with orchestrator
const priceDiscovery = new PriceDiscovery();
priceDiscovery.addProvider(new EthereumPriceProvider());
await priceDiscovery.initialize();
```

See `src/core/priceProviders/README.md` for detailed guide on adding new providers.

---

## Prerequisites & Setup

### 1. Solana Development Environment Setup

**Required Setup:**
```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Generate trading wallet
solana-keygen new --outfile ~/.config/solana/sol-bot-wallet.json

# Fund wallet (devnet for testing)
solana airdrop 2 --keypair ~/.config/solana/sol-bot-wallet.json

# Get Jupiter API access (free tier available)
# Visit: https://jup.ag/docs/apis/quote-api
```

**Acceptance Criteria:**
- [ ] Solana CLI installed and configured
- [ ] Trading wallet generated and funded with SOL
- [ ] Jupiter API access obtained (no key required for basic usage)
- [ ] GalaChain Bridge API access configured

---

## Implementation Phases

### Phase 1: Project Foundation (Week 1)

#### 1.1 Project Structure Setup

**Objective:** Create modular TypeScript project following existing bot patterns

**Directory Structure:**
```
sol-bot/
├── src/
│   ├── core/
│   │   ├── priceDiscovery.ts      # Cross-chain price monitoring
│   │   ├── inventoryManager.ts    # Dual-chain inventory tracking
│   │   ├── bridgeMonitor.ts       # Bridge status & ETA tracking
│   │   └── riskManager.ts         # Risk controls & guardrails
│   ├── execution/
│   │   ├── dualLegExecutor.ts     # GC sell + SOL buy execution
│   │   ├── galaChainExecutor.ts   # GalaChain trading operations
│   │   └── solanaExecutor.ts      # Solana trading operations
│   ├── bridging/
│   │   ├── galaChainBridge.ts     # GalaChain Bridge integration
│   │   ├── batchBridgeManager.ts  # SOL → GC batch bridging
│   │   └── bridgeReconciler.ts    # Bridge arrival reconciliation
│   ├── monitoring/
│   │   ├── telemetry.ts           # PnL & metrics tracking
│   │   ├── slackAlerts.ts         # Slack alert system
│   │   └── localDashboard.ts      # Local development dashboard
│   ├── utils/
│   │   ├── logger.ts              # Structured logging
│   │   ├── config.ts              # Configuration management
│   │   └── stateManager.ts        # Persistent state
│   └── index.ts                   # Main orchestrator
├── config/
│   ├── config.json                # Trading parameters
│   └── tokens.json                # Supported token definitions
├── tests/
├── package.json
├── tsconfig.json
└── ecosystem.config.js            # PM2 configuration
```

**Dependencies:**
```json
{
  "dependencies": {
    "@gala-chain/gswap-sdk": "^0.0.7",
    "@gala-chain/api": "latest",
    "@gala-chain/dex": "latest",
    "@solana/web3.js": "^1.87.6",
    "axios": "^1.6.0",
    "winston": "^3.11.0",
    "dotenv": "^16.3.1",
    "@slack/web-api": "^6.10.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

**Acceptance Criteria:**
- [ ] Project structure created with all directories
- [ ] TypeScript configuration with strict mode enabled
- [ ] All dependencies installed and configured
- [ ] Basic build pipeline working (`npm run build`)
- [ ] Linting and formatting configured
- [ ] PM2 ecosystem configuration ready

#### 1.2 Initial Token Configuration

```typescript
// config/tokens.json
{
  "supportedTokens": [
    {
      "symbol": "GALA",
      "galaChainMint": "GALA|Unit|none|none",
      "solanaMint": "GALA_mint_address_on_solana",
      "decimals": 8,
      "minTradeSize": 100,
      "maxTradeSize": 10000
    },
    {
      "symbol": "FARTCOIN",
      "galaChainMint": "FARTCOIN|Unit|none|none", 
      "solanaMint": "FARTCOIN_mint_address_on_solana",
      "decimals": 6,
      "minTradeSize": 1000,
      "maxTradeSize": 100000
    },
    {
      "symbol": "TRUMP",
      "galaChainMint": "TRUMP|Unit|none|none",
      "solanaMint": "TRUMP_mint_address_on_solana", 
      "decimals": 6,
      "minTradeSize": 1000,
      "maxTradeSize": 100000
    },
    {
      "symbol": "SOL",
      "galaChainMint": "SOL|Unit|none|none",
      "solanaMint": "So11111111111111111111111111111111111111112",
      "decimals": 9,
      "minTradeSize": 0.1,
      "maxTradeSize": 10
    }
  ]
}
```

#### 1.3 Configuration with Conservative Defaults

```typescript
// config/config.json
{
  "trading": {
    "minEdgeThreshold": 0.02,        // 2% minimum edge (conservative)
    "maxPriceImpact": 0.03,          // 3% max price impact
    "maxConcurrentTrades": 2,        // Conservative concurrency
    "slippageTolerance": 0.05,       // 5% slippage protection
    "executionTimeout": 30000,       // 30 second timeout
    "riskBuffer": 0.01               // 1% risk buffer (configurable)
  },
  "bridging": {
    "interval": 1800000,             // 30 minutes
    "thresholdMultiplier": 1.5,      // Bridge when 1.5x target
    "maxBridgeDelay": 3600000,       // 1 hour max delay
    "bridgeCostUSD": 1.25,           // Fixed bridge cost
    "bridgeCostGALA": 0              // Will be calculated dynamically
  },
  "risk": {
    "circuitBreakerThreshold": 3,    // Conservative: 3 failures
    "maxDailyLoss": 500,             // $500 max daily loss
    "inventoryMinimums": {
      "GALA": 200,                   // 200 GALA minimum
      "SOL": 2                       // 2 SOL minimum
    }
  },
  "monitoring": {
    "dashboardPort": 3000,
    "slackWebhook": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
    "logLevel": "info"
  }
}
```

---

### Phase 2: Core Modules (Week 2-3)

#### 2.1 Price Discovery Module ✅ COMPLETED

**Objective:** Continuously monitor cross-chain price discrepancies

**Implementation Status:** ✅ **Complete with Modular Architecture**

**Key Components:**
- ✅ **GalaChain Provider**: Using `@gala-chain/dex` for local quoting
  - Supports GALA and GUSDC pairs
  - Automatic token ordering (token0 < token1)
  - Real-time GALA/USD conversion
- ✅ **Solana Provider**: Using Jupiter Lite API for token prices
  - Token → SOL quotes via Jupiter aggregator
  - SOL/USD price from CoinGecko
  - Real-time USD conversion
- ✅ **Main Orchestrator**: Coordinates multiple providers
  - Parallel price updates
  - Easy provider registration
  - Provider isolation
- ✅ **Cross-Chain Price Comparator**: Calculate net edge in GALA terms
- ✅ **Bridge Cost Calculation**: Dynamic bridge cost calculation

**Actual Implementation:**
```typescript
// src/core/priceDiscovery.ts
export class PriceDiscovery {
  private bridgeCostUSD: number = 1.25;
  
  async discoverOpportunities(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    for (const token of this.supportedTokens) {
      // 1. Get GC sell price (token → GALA)
      const gcSellPrice = await this.getGalaChainPrice(token, 'sell');
      
      // 2. Get SOL buy price (SOL → token) 
      const solBuyPrice = await this.getSolanaPrice(token, 'buy');
      
      // 3. Calculate bridge cost in GALA
      const bridgeCostGALA = await this.calculateBridgeCostGALA();
      
      // 4. Calculate net edge
      const netEdge = this.calculateNetEdge(
        gcSellPrice,
        solBuyPrice, 
        bridgeCostGALA,
        this.config.riskBuffer
      );
      
      if (netEdge >= this.config.minEdgeThreshold) {
        opportunities.push({
          token: token.symbol,
          netEdge,
          gcSellPrice,
          solBuyPrice,
          bridgeCostGALA,
          recommendedSize: this.calculateOptimalSize(token, netEdge)
        });
      }
    }
    
    return opportunities.sort((a, b) => b.netEdge - a.netEdge);
  }
  
  private async calculateBridgeCostGALA(): Promise<number> {
    // Get current GALA/USD price and convert bridge cost
    const galaPriceUSD = await this.getGalaChainPrice('GALA', 'buy');
    return this.bridgeCostUSD / galaPriceUSD;
  }
  
  private calculateNetEdge(
    gcSellPrice: number,
    solBuyPrice: number,
    bridgeCost: number,
    riskBuffer: number
  ): number {
    return gcSellPrice - solBuyPrice - bridgeCost - riskBuffer;
  }
}
```

**Acceptance Criteria:**
- [x] Can fetch real-time prices from both chains
- [x] Calculates accurate net edge in GALA terms
- [x] Handles price feed failures gracefully
- [x] Updates prices based on configurable interval
- [x] Filters opportunities by minimum edge threshold
- [x] Logs all price discovery activities
- [x] **Modular architecture for easy network addition**
- [x] **Provider isolation and testability**
- [x] **Parallel price updates across providers**

**Test Results:**
```bash
npm run test:price-discovery
# ✅ GalaChain: GFARTCOIN ($0.00259), GTRUMP ($10.95), GSOL ($225.16)
# ✅ Solana: GFARTCOIN ($0.66), GTRUMP ($7.75), GSOL ($230.32)
# ✅ Arbitrage opportunities detected
```

#### 2.2 Inventory Management Module ✅ COMPLETED

**Objective:** Track and manage token balances across both chains

**Implementation Status:** ✅ **Complete**

**Key Components:**
- **Dual-Chain Balance Tracking**: Monitor GC and SOL token balances
- **Working Capital Management**: Ensure sufficient liquidity for operations
- **Inventory Drift Control**: Prefer net movement toward GC

**Implementation Details:**
```typescript
// src/core/inventoryManager.ts
export class InventoryManager {
  private gcBalances: Map<string, number> = new Map();
  private solBalances: Map<string, number> = new Map();
  
  async updateBalances(): Promise<void> {
    // Update GC balances using @gala-chain/api
    // Update SOL balances using @solana/web3.js
  }
  
  canExecuteTrade(token: string, gcSellAmount: number, solBuyAmount: number): boolean {
    const gcBalance = this.gcBalances.get(token) || 0;
    const solQuoteBalance = this.solBalances.get('SOL') || 0;
    
    return gcBalance >= gcSellAmount && solQuoteBalance >= solBuyAmount;
  }
  
  getInventoryStatus(): InventoryStatus {
    // Return current inventory levels and recommendations
  }
}
```

**Acceptance Criteria:**
- [x] Accurately tracks balances on both chains
- [x] Validates trade feasibility before execution
- [x] Maintains minimum working balances
- [x] Provides inventory drift recommendations
- [x] Handles balance update failures
- [x] Persists inventory state

#### 2.3 Bridge Monitoring Module ✅ COMPLETED

**Objective:** Monitor bridge health and track pending transfers

**Implementation Status:** ✅ **Complete**

**Key Components:**
- **Bridge Status Monitoring**: Track bridge operational status
- **ETA Tracking**: Monitor expected arrival times
- **Reconciliation**: Handle bridge completions and failures

**Implementation Details:**
```typescript
// src/core/bridgeMonitor.ts
export class BridgeMonitor {
  private pendingBridges: Map<string, BridgeTransaction> = new Map();
  
  async monitorBridgeHealth(): Promise<BridgeHealth> {
    // Check bridge service status
    // Monitor recent bridge completion times
    // Calculate ETA percentiles
  }
  
  async trackPendingBridge(txId: string): Promise<void> {
    // Add to pending bridges tracking
    // Set up monitoring for completion
  }
  
  async reconcileBridgeArrival(txId: string): Promise<void> {
    // Update inventory on bridge completion
    // Remove from pending tracking
  }
}
```

**Acceptance Criteria:**
- [x] Monitors bridge service health continuously
- [x] Tracks all pending bridge transactions
- [x] Provides accurate ETA estimates
- [x] Handles bridge failures and delays
- [x] Reconciles completed bridges automatically
- [x] Alerts on bridge anomalies
- [x] **Loads bridge configurations for supported tokens**
- [x] **Validates bridge capabilities between chains**
- [x] **Historical data tracking for completion times**

**Test Results:**
```bash
npm run test:bridge-monitor
# ✅ Bridge configurations loaded: 3 tokens (GFARTCOIN, GTRUMP, GSOL)
# ✅ Health monitoring: Healthy (300s avg completion, 0% failure rate)
# ✅ Transaction tracking and status queries working
# ✅ Capability validation: GSOL (GC → Solana) supported
```

---

### Phase 3: Execution Engine (Week 4)

#### 3.1 Dual-Leg Execution Engine

**Objective:** Execute near-simultaneous GC sell and SOL buy operations

**Key Components:**
- **GalaChain Executor**: Handle GC sell operations using `@gala-chain/gswap-sdk`
- **Solana Executor**: Handle SOL buy operations using Jupiter API
- **Coordination Logic**: Ensure atomic-like execution with proper error handling

**Implementation Details:**
```typescript
// src/execution/dualLegExecutor.ts
export class DualLegExecutor {
  private galaExecutor: GalaChainExecutor;
  private solanaExecutor: SolanaExecutor;
  
  async executeDualLeg(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      // 1. Pre-execution validation
      await this.validateExecution(opportunity);
      
      // 2. Execute GC sell first (secure destination premium)
      const gcResult = await this.galaExecutor.executeSell(
        opportunity.token,
        opportunity.recommendedSize
      );
      
      // 3. Execute SOL buy concurrently
      const solResult = await this.solanaExecutor.executeBuy(
        opportunity.token,
        opportunity.recommendedSize
      );
      
      // 4. Calculate realized PnL in GALA
      const realizedPnL = this.calculateRealizedPnL(gcResult, solResult);
      
      return {
        success: true,
        gcResult,
        solResult,
        realizedPnL,
        executionTime: Date.now() - startTime
      };
      
    } catch (error) {
      await this.handleExecutionFailure(error, opportunity);
      throw error;
    }
  }
  
  private calculateRealizedPnL(gcResult: GalaChainResult, solResult: SolanaResult): number {
    // Convert SOL cost to GALA equivalent
    const solCostGALA = this.convertSOLToGALA(solResult.costSOL);
    
    // Net PnL = GC proceeds - SOL cost (in GALA) - bridge cost
    return gcResult.galaReceived - solCostGALA - this.bridgeCostGALA;
  }
}
```

**Acceptance Criteria:**
- [ ] Executes GC sell and SOL buy in near-lockstep
- [ ] Handles partial fills correctly
- [ ] Implements proper slippage protection
- [ ] Cancels counterpart leg on failure
- [ ] Records all execution details
- [ ] Provides execution status updates

#### 3.2 GalaChain Executor

**Objective:** Handle all GalaChain trading operations

**Implementation Details:**
```typescript
// src/execution/galaChainExecutor.ts
export class GalaChainExecutor {
  private gSwap: GSwap;
  
  async executeSell(opportunity: ArbitrageOpportunity): Promise<GalaChainResult> {
    const quote = await this.gSwap.quoting.quoteExactInput(
      opportunity.token,
      'GALA|Unit|none|none',
      opportunity.gcSellAmount
    );
    
    const result = await this.gSwap.swaps.swap(
      opportunity.token,
      'GALA|Unit|none|none',
      quote.feeTier,
      {
        exactIn: opportunity.gcSellAmount,
        amountOutMinimum: quote.outTokenAmount.multipliedBy(0.95)
      },
      this.walletAddress
    );
    
    return result;
  }
}
```

**Acceptance Criteria:**
- [ ] Successfully executes token → GALA swaps
- [ ] Handles slippage protection correctly
- [ ] Manages transaction timeouts
- [ ] Provides detailed execution logs
- [ ] Handles GSwap SDK errors gracefully

#### 3.3 Solana Executor

**Objective:** Handle all Solana trading operations using Jupiter

**Implementation Details:**
```typescript
// src/execution/solanaExecutor.ts
export class SolanaExecutor {
  private connection: Connection;
  private wallet: Keypair;
  
  async executeBuy(opportunity: ArbitrageOpportunity): Promise<SolanaResult> {
    // 1. Get Jupiter quote
    const quote = await this.getJupiterQuote(opportunity);
    
    // 2. Build and sign transaction
    const transaction = await this.buildJupiterTransaction(quote);
    
    // 3. Execute transaction
    const signature = await this.connection.sendTransaction(transaction, [this.wallet]);
    
    // 4. Wait for confirmation
    await this.connection.confirmTransaction(signature);
    
    return { signature, amount: opportunity.solBuyAmount };
  }
}
```

**Acceptance Criteria:**
- [ ] Successfully executes SOL → token swaps via Jupiter
- [ ] Handles Jupiter API routing correctly
- [ ] Manages transaction confirmation
- [ ] Provides detailed execution logs
- [ ] Handles Solana network errors gracefully

---

### Phase 4: Bridge Integration (Week 5)

#### 4.1 GalaChain Bridge Integration

**Objective:** Integrate with existing GalaChain Bridge for SOL ↔ GC transfers

**Implementation Details:**
```typescript
// src/bridging/galaChainBridge.ts
export class GalaChainBridge {
  private bridgeAPI: string;
  
  async initiateBridge(
    token: string,
    amount: number,
    fromChain: 'SOL' | 'GC',
    toChain: 'SOL' | 'GC'
  ): Promise<BridgeTransaction> {
    const bridgeRequest = {
      token,
      amount,
      fromChain,
      toChain,
      walletAddress: this.walletAddress
    };
    
    const response = await axios.post(`${this.bridgeAPI}/bridge`, bridgeRequest);
    
    return {
      txId: response.data.txId,
      estimatedArrival: response.data.estimatedArrival,
      status: 'pending'
    };
  }
  
  async getBridgeStatus(txId: string): Promise<BridgeStatus> {
    const response = await axios.get(`${this.bridgeAPI}/status/${txId}`);
    return response.data;
  }
  
  async calculateBridgeCost(token: string, amount: number): Promise<number> {
    const response = await axios.post(`${this.bridgeAPI}/quote`, {
      token,
      amount
    });
    return response.data.costUSD;
  }
}
```

#### 4.2 Batch Bridge Manager

**Objective:** Periodically bridge accumulated SOL tokens to GC

**Key Components:**
- **Threshold-Based Triggering**: Bridge when SOL balances exceed targets
- **Time-Based Triggering**: Bridge on schedule (e.g., every 30 minutes)
- **Batch Optimization**: Combine multiple tokens in single bridge transaction

**Implementation Details:**
```typescript
// src/bridging/batchBridgeManager.ts
export class BatchBridgeManager {
  private bridgeThresholds: Map<string, number> = new Map();
  private lastBridgeTime: number = 0;
  private bridgeInterval: number = 30 * 60 * 1000; // 30 minutes
  
  async checkBridgeTriggers(): Promise<void> {
    const timeSinceLastBridge = Date.now() - this.lastBridgeTime;
    const shouldBridgeByTime = timeSinceLastBridge >= this.bridgeInterval;
    
    const tokensToBridge = await this.getTokensExceedingThreshold();
    const shouldBridgeByThreshold = tokensToBridge.length > 0;
    
    if (shouldBridgeByTime || shouldBridgeByThreshold) {
      await this.executeBatchBridge(tokensToBridge);
    }
  }
  
  private async executeBatchBridge(tokens: string[]): Promise<void> {
    // 1. Calculate optimal bridge amounts
    // 2. Initiate bridge transactions
    // 3. Track pending bridges
    // 4. Update last bridge time
  }
}
```

**Acceptance Criteria:**
- [ ] Triggers bridges based on time and threshold
- [ ] Optimizes bridge batch sizes
- [ ] Tracks all pending bridge transactions
- [ ] Handles bridge failures gracefully
- [ ] Updates inventory on bridge completion
- [ ] Provides bridge status monitoring

#### 4.3 Bridge Reconciler

**Objective:** Handle bridge completions and inventory updates

**Implementation Details:**
```typescript
// src/bridging/bridgeReconciler.ts
export class BridgeReconciler {
  async reconcileBridgeArrival(txId: string): Promise<void> {
    // 1. Verify bridge completion on GC
    // 2. Update GC token inventory
    // 3. Remove from pending bridges
    // 4. Log reconciliation details
  }
  
  async handleBridgeFailure(txId: string, error: string): Promise<void> {
    // 1. Log bridge failure
    // 2. Update bridge health metrics
    // 3. Trigger alerts if needed
    // 4. Remove from pending tracking
  }
}
```

**Acceptance Criteria:**
- [ ] Accurately reconciles completed bridges
- [ ] Updates inventory balances correctly
- [ ] Handles bridge failures appropriately
- [ ] Provides detailed reconciliation logs
- [ ] Triggers alerts on anomalies

---

### Phase 5: Risk Controls (Week 6)

#### 5.1 Risk Manager

**Objective:** Implement comprehensive risk controls and guardrails

**Key Components:**
- **Price Impact Limits**: Reject trades with excessive slippage
- **Minimum Edge Thresholds**: Only execute profitable opportunities
- **Concurrency Controls**: Limit simultaneous trades
- **Circuit Breakers**: Pause on repeated failures
- **Kill Switch**: Emergency stop functionality

**Implementation Details:**
```typescript
// src/core/riskManager.ts
export class RiskManager {
  private config: RiskConfig;
  
  constructor(config: RiskConfig) {
    this.config = config;
  }
  
  async validateTrade(opportunity: ArbitrageOpportunity): Promise<RiskValidation> {
    const validations = await Promise.all([
      this.validateMinimumEdge(opportunity),
      this.validatePriceImpact(opportunity),
      this.validateConcurrency(),
      this.validateInventory(opportunity),
      this.validateBridgeHealth(),
      this.validateDailyLoss()
    ]);
    
    return {
      isValid: validations.every(v => v.isValid),
      violations: validations.filter(v => !v.isValid),
      riskScore: this.calculateRiskScore(validations)
    };
  }
  
  private async validateMinimumEdge(opportunity: ArbitrageOpportunity): Promise<ValidationResult> {
    const minEdge = this.config.minEdgeThreshold;
    return {
      isValid: opportunity.netEdge >= minEdge,
      message: `Edge ${opportunity.netEdge} below minimum ${minEdge}`
    };
  }
  
  // Easy configuration updates
  updateRiskBuffer(newBuffer: number): void {
    this.config.riskBuffer = newBuffer;
    this.logger.info(`Risk buffer updated to ${newBuffer}`);
  }
  
  updateMinEdgeThreshold(newThreshold: number): void {
    this.config.minEdgeThreshold = newThreshold;
    this.logger.info(`Min edge threshold updated to ${newThreshold}`);
  }
}
```

**Acceptance Criteria:**
- [ ] Validates all trades against risk parameters
- [ ] Implements price impact limits correctly
- [ ] Enforces minimum edge thresholds
- [ ] Manages concurrency limits
- [ ] Provides circuit breaker functionality
- [ ] Supports emergency stop operations
- [ ] Logs all risk decisions

#### 5.2 Guardrails Implementation

**Objective:** Implement specific guardrails from PRD

**Key Guardrails:**
- **Slippage Protection**: Maximum 5% slippage per leg
- **Deadline Enforcement**: 30-second maximum execution time
- **Bridge Health Monitoring**: Pause if bridge delays exceed tolerance
- **Inventory Minimums**: Maintain working balances
- **Cooldown Periods**: Prevent rapid re-entry on same routes

**Implementation Details:**
```typescript
// src/core/guardrails.ts
export class Guardrails {
  async validateSlippage(leg: TradeLeg, maxSlippage: number): Promise<boolean> {
    const actualSlippage = this.calculateSlippage(leg);
    return actualSlippage <= maxSlippage;
  }
  
  async validateDeadline(startTime: number, maxDuration: number): Promise<boolean> {
    const elapsed = Date.now() - startTime;
    return elapsed <= maxDuration;
  }
  
  async validateBridgeHealth(token: string): Promise<boolean> {
    const bridgeHealth = await this.bridgeMonitor.getBridgeHealth(token);
    return bridgeHealth.isHealthy && bridgeHealth.avgDelay < this.maxBridgeDelay;
  }
}
```

**Acceptance Criteria:**
- [ ] Enforces slippage limits on all trades
- [ ] Implements deadline enforcement
- [ ] Monitors bridge health continuously
- [ ] Maintains inventory minimums
- [ ] Applies cooldown periods correctly
- [ ] Provides detailed guardrail logs

---

### Phase 6: Monitoring & Dashboard (Week 7)

#### 6.1 Telemetry System

**Objective:** Track PnL, metrics, and performance in GALA terms

**Key Components:**
- **PnL Tracking**: Real-time profit/loss in GALA
- **Performance Metrics**: Win rate, average edge, trade counts
- **Inventory Tracking**: Balance movements and drift
- **Bridge Metrics**: ETA distributions and completion rates

**Implementation Details:**
```typescript
// src/monitoring/telemetry.ts
export class Telemetry {
  private pnlTracker: PnLTracker;
  private metricsCollector: MetricsCollector;
  
  async recordTradeExecution(result: ExecutionResult): Promise<void> {
    const pnl = this.calculatePnL(result);
    await this.pnlTracker.recordTrade(pnl);
    
    const metrics = this.extractMetrics(result);
    await this.metricsCollector.recordMetrics(metrics);
  }
  
  async getDashboardData(): Promise<DashboardData> {
    return {
      totalPnL: await this.pnlTracker.getTotalPnL(),
      winRate: await this.metricsCollector.getWinRate(),
      avgEdge: await this.metricsCollector.getAverageEdge(),
      tradeCount: await this.metricsCollector.getTradeCount(),
      inventoryStatus: await this.inventoryManager.getInventoryStatus(),
      bridgeStatus: await this.bridgeMonitor.getBridgeStatus()
    };
  }
}
```

**Acceptance Criteria:**
- [ ] Tracks PnL in GALA terms accurately
- [ ] Records all performance metrics
- [ ] Provides real-time dashboard data
- [ ] Maintains historical performance data
- [ ] Handles telemetry failures gracefully
- [ ] Exports data for external analysis

#### 6.2 Slack Alerting System

**Objective:** Provide real-time alerts for critical events

**Key Alerts:**
- **Trade Alerts**: Successful trades with PnL details
- **Risk Alerts**: Slippage breaches, circuit breakers
- **Bridge Alerts**: Bridge delays, failures, completions
- **System Health**: RPC failures, API errors, etc.

**Implementation Details:**
```typescript
// src/monitoring/slackAlerts.ts
export class SlackAlerts {
  private webhook: string;
  
  async sendTradeAlert(trade: ExecutionResult): Promise<void> {
    const message = {
      text: `🔄 Trade Executed`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Token:* ${trade.token}\n*PnL:* ${trade.realizedPnL.toFixed(4)} GALA\n*Edge:* ${trade.netEdge.toFixed(4)}\n*Status:* ${trade.success ? '✅ Success' : '❌ Failed'}`
          }
        }
      ]
    };
    
    await axios.post(this.webhook, message);
  }
  
  async sendRiskAlert(alert: RiskAlert): Promise<void> {
    const message = {
      text: `⚠️ Risk Alert`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn", 
            text: `*Alert:* ${alert.type}\n*Message:* ${alert.message}\n*Severity:* ${alert.severity}`
          }
        }
      ]
    };
    
    await axios.post(this.webhook, message);
  }
  
  async sendBridgeAlert(bridge: BridgeAlert): Promise<void> {
    const message = {
      text: `🌉 Bridge Alert`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Token:* ${bridge.token}\n*Amount:* ${bridge.amount}\n*Status:* ${bridge.status}\n*ETA:* ${bridge.eta}`
          }
        }
      ]
    };
    
    await axios.post(this.webhook, message);
  }
}
```

**Acceptance Criteria:**
- [ ] Sends alerts for successful trades with PnL
- [ ] Monitors and alerts on slippage breaches
- [ ] Alerts on bridge delays and failures
- [ ] Provides system health monitoring
- [ ] Supports multiple alert channels
- [ ] Prevents alert spam with rate limiting

#### 6.3 Local Development Dashboard

**Objective:** Provide real-time monitoring dashboard for local development

**Key Features:**
- **Real-time PnL**: Current and historical profit/loss
- **Trade Activity**: Recent trades and execution status
- **Inventory Status**: Current balances on both chains
- **Bridge Status**: Pending bridges and completion rates
- **System Health**: Overall bot health and alerts
- **Configuration Updates**: Runtime configuration changes

**Implementation Details:**
```typescript
// src/monitoring/localDashboard.ts
export class LocalDashboard {
  private server: express.Application;
  
  async startDashboard(port: number = 3000): Promise<void> {
    this.server = express();
    this.server.use(express.static('public'));
    
    // Real-time dashboard endpoint
    this.server.get('/api/status', async (req, res) => {
      const status = await this.getSystemStatus();
      res.json(status);
    });
    
    // Trade history endpoint
    this.server.get('/api/trades', async (req, res) => {
      const trades = await this.getRecentTrades();
      res.json(trades);
    });
    
    // Configuration update endpoint
    this.server.post('/api/config', async (req, res) => {
      await this.updateConfiguration(req.body);
      res.json({ success: true });
    });
    
    this.server.listen(port, () => {
      console.log(`📊 Dashboard running at http://localhost:${port}`);
    });
  }
}
```

**Acceptance Criteria:**
- [ ] Provides real-time dashboard data
- [ ] Shows current PnL and performance metrics
- [ ] Displays recent trade activity
- [ ] Shows inventory and bridge status
- [ ] Provides system health indicators
- [ ] Updates data in real-time
- [ ] Handles dashboard errors gracefully
- [ ] Supports runtime configuration updates

---

### Phase 7: Testing & Validation (Week 8)

#### 7.1 Unit Testing

**Objective:** Comprehensive unit tests for all modules

**Test Coverage:**
- **Core Modules**: Price discovery, inventory management, bridge monitoring
- **Execution Engine**: Dual-leg execution, individual chain executors
- **Risk Controls**: Risk validation, guardrails, circuit breakers
- **Monitoring**: Telemetry, alerting, dashboard

**Implementation Details:**
```typescript
// tests/core/priceDiscovery.test.ts
describe('PriceDiscovery', () => {
  it('should calculate net edge correctly', async () => {
    const priceDiscovery = new PriceDiscovery();
    const opportunity = await priceDiscovery.discoverOpportunities();
    
    expect(opportunity.netEdge).toBeGreaterThan(0);
    expect(opportunity.gcSellPrice).toBeGreaterThan(opportunity.solBuyPrice);
  });
  
  it('should handle price feed failures gracefully', async () => {
    // Mock price feed failure
    // Verify graceful error handling
  });
});
```

**Acceptance Criteria:**
- [ ] 90%+ test coverage for all modules
- [ ] All unit tests pass consistently
- [ ] Tests cover error conditions
- [ ] Tests are maintainable and readable
- [ ] Tests run in CI/CD pipeline

#### 7.2 Integration Testing

**Objective:** Test module interactions and end-to-end flows

**Test Scenarios:**
- **Full Trade Cycle**: Price discovery → execution → bridge → reconciliation
- **Error Handling**: Network failures, partial fills, bridge delays
- **Risk Controls**: Slippage breaches, circuit breakers, emergency stops
- **Monitoring**: Telemetry collection, alerting, dashboard updates

**Implementation Details:**
```typescript
// tests/integration/fullTradeCycle.test.ts
describe('Full Trade Cycle', () => {
  it('should execute complete arbitrage cycle', async () => {
    // 1. Mock price discovery finding opportunity
    // 2. Execute dual-leg trade
    // 3. Verify inventory updates
    // 4. Trigger bridge
    // 5. Simulate bridge completion
    // 6. Verify final state
  });
});
```

**Acceptance Criteria:**
- [ ] All integration tests pass
- [ ] Tests cover complete trade cycles
- [ ] Tests verify error handling
- [ ] Tests validate risk controls
- [ ] Tests check monitoring systems

#### 7.3 Performance Testing

**Objective:** Validate system performance under load

**Test Scenarios:**
- **Price Discovery Performance**: Response times for price updates
- **Execution Performance**: Trade execution latency
- **Bridge Performance**: Bridge initiation and tracking
- **Monitoring Performance**: Dashboard response times

**Acceptance Criteria:**
- [ ] Price discovery updates within 10 seconds
- [ ] Trade execution completes within 30 seconds
- [ ] Dashboard responds within 1 second
- [ ] System handles 100+ concurrent operations
- [ ] Memory usage remains stable

#### 7.4 Security Testing

**Objective:** Validate security measures and access controls

**Test Areas:**
- **Credential Management**: Secure storage of private keys
- **API Security**: Proper authentication and authorization
- **Input Validation**: Protection against malicious inputs
- **Error Handling**: No sensitive data in error messages

**Acceptance Criteria:**
- [ ] Private keys are encrypted at rest
- [ ] API endpoints require proper authentication
- [ ] Input validation prevents injection attacks
- [ ] Error messages don't expose sensitive data
- [ ] Security audit passes

---

## Environment Configuration

### Environment Variables

```bash
# .env file
# GalaChain Configuration
GALA_PRIVATE_KEY=your_gala_private_key_here
GALA_WALLET_ADDRESS=eth|your_wallet_address_here
GALA_RPC_ENDPOINT=https://mainnet.galachain.io

# Solana Configuration  
SOLANA_PRIVATE_KEY=your_solana_private_key_here
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com

# Bridge Configuration
GALACHAIN_BRIDGE_API=https://bridge.galachain.io
BRIDGE_API_KEY=your_bridge_api_key_here

# Slack Configuration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# Development/Production
NODE_ENV=development
LOG_LEVEL=info
DASHBOARD_PORT=3000
```

### Environment-Specific Configuration

```typescript
// src/config/environment.ts
export class EnvironmentConfig {
  static isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }
  
  static isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }
  
  static getSolanaNetwork(): 'mainnet-beta' | 'devnet' {
    return this.isDevelopment() ? 'devnet' : 'mainnet-beta';
  }
  
  static getGalaChainNetwork(): 'mainnet' | 'testnet' {
    return this.isDevelopment() ? 'testnet' : 'mainnet';
  }
}
```

---

## Deployment & Operations

### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sol-bot',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### Docker Configuration

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY config/ ./config/

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

---

## Validation Checklist

### MVP Acceptance Criteria

**Core Functionality:**
- [ ] System continuously computes net edges for GALA, FARTCOIN, TRUMP, SOL
- [ ] Uses GalaChain Bridge for SOL ↔ GC transfers
- [ ] Calculates bridge costs dynamically (default $1.25)
- [ ] Executes paired trades (GC sell + SOL buy) when guardrails pass
- [ ] Handles timeouts and partial fills correctly
- [ ] Performs batch bridges every 30 minutes or on threshold
- [ ] Reconciles bridge arrivals and maintains inventory
- [ ] Maintains PnL accounting in GALA terms
- [ ] Sends Slack alerts for trades and risks
- [ ] Supports local development and VPS deployment

**Risk Management (Conservative Defaults):**
- [ ] 2% minimum edge threshold (configurable)
- [ ] 3% maximum price impact
- [ ] 2 concurrent trades maximum
- [ ] 1% risk buffer (configurable)
- [ ] Circuit breaker after 3 failures
- [ ] $500 maximum daily loss

**Monitoring:**
- [ ] Real-time PnL tracking in GALA
- [ ] Slack alerts for trades, risks, and bridges
- [ ] Local dashboard for development
- [ ] Bridge status and ETA tracking
- [ ] Configuration updates via API

---

## Next Steps

1. **Start with Prerequisites**: Set up Solana development environment
2. **Create Project Structure**: Initialize TypeScript project with dependencies
3. **Implement Core Modules**: Begin with price discovery and inventory management
4. **Add Token Support**: Implement specific logic for GALA, FARTCOIN, TRUMP, SOL
5. **Build Execution Engine**: Create dual-leg execution with GalaChain Bridge
6. **Add Monitoring**: Implement Slack alerts and local dashboard
7. **Test Locally**: Validate all functionality in development environment
8. **Deploy to VPS**: Move to production environment

---

## Implementation Progress Update (October 3, 2025)

### ✅ Completed: Phase 1 & 2 (Foundation + Core Modules)

**Phase 1: Foundation** - 100% Complete
- Project structure, build system, configuration
- Logging, state management, type definitions

**Phase 2: Core Modules** - 100% Complete
- ✅ **Modular Price Discovery System**
  - Plugin-based architecture for easy network addition
  - GalaChain provider with DEX v3 local quoting
  - Solana provider with Jupiter Lite API
  - Real-time pricing for GFARTCOIN, GTRUMP, GSOL
  - Tested and verified working
- ✅ **Inventory Manager**
  - Dual-chain balance tracking
  - Trade feasibility validation
  - Inventory drift monitoring
- ✅ **Bridge Monitor**
  - Bridge configuration loading
  - Health monitoring and metrics
  - Transaction tracking by hash
  - Status checking via GalaChain API
  - ETA calculation and historical data
  - Tested and verified working

### 🚀 Next Steps: Phase 3-7

**Immediate Next (Phase 2 Completion & Phase 3):**
1. Risk Manager - Comprehensive risk controls and guardrails
2. Main Entry Point - Orchestrate all core modules
3. Execution Engine - GalaChain and Solana trade execution

**See ARCHITECTURE.md** for detailed information about the modular price provider system and how to add new networks.

---

## Questions for Clarification

Before proceeding with execution engine implementation:

1. **Bridge Service**: Which specific bridge service should be used for SOL ↔ GC transfers? (Wormhole, LayerZero, etc.)

2. **Bridge Costs**: How should bridge amortization costs be calculated? Is there a specific formula or API to use?

3. **Risk Buffer**: What should be the default risk buffer percentage for non-atomicity and ETA variance?

4. **Deployment Environment**: Will this run on a VPS, cloud instance, or local machine? This affects monitoring and alerting setup.

5. **Alert Channels**: What alert channels are preferred? (Slack, Discord, Email, etc.)

Please provide these details so I can proceed with execution engine development.
