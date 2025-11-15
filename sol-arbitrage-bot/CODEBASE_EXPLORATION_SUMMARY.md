# Solana Arbitrage Codebase - Comprehensive Architecture Overview

## 1. PROJECT OVERVIEW

**Purpose**: Cross-chain arbitrage bot between GalaChain and Solana that identifies price discrepancies and executes paired trades to capture spreads.

**Core Strategy**: "Inventory Mode Arbitrage"
- FORWARD: SELL token on GalaChain → BUY same token on Solana (default)
- REVERSE: BUY token on GalaChain → SELL same token on Solana (enabled via config)
- All profits accumulated in **GALA** on GalaChain

**Key Tech Stack**:
- TypeScript/Node.js
- GalaChain SDK (@gala-chain/dex, @gala-chain/gswap-sdk)
- Solana Web3.js + Jupiter Aggregator API
- BigNumber.js for precision arithmetic
- Winston for logging

---

## 2. PROJECT STRUCTURE

```
gc-solana-arbitrage/
├── src/
│   ├── index.ts                 # Entry point
│   ├── run-bot.ts               # Main runner with loop scheduling
│   ├── mainLoop.ts              # Core trading cycle orchestrator
│   ├── monitor-prices.ts        # Price monitoring utility
│   ├── analyze-trades.ts        # Trade analysis tool
│   ├── check-balances.ts        # Balance checking utility
│   │
│   ├── types/                   # Type definitions
│   │   ├── core.ts              # Core data structures (quotes, execution, inventory)
│   │   ├── direction.ts         # Arbitrage direction types (forward/reverse)
│   │   ├── config.ts            # Configuration interfaces
│   │   └── index.ts
│   │
│   ├── config/                  # Configuration management
│   │   ├── index.ts             # Public API
│   │   ├── configManager.ts     # Config loading & caching
│   │   ├── configService.ts     # Config service interface
│   │   └── configSchema.ts      # Config validation
│   │
│   ├── core/                    # Core arbitrage logic
│   │   ├── tokenEvaluator.ts    # Token evaluation (quotes → risk check)
│   │   ├── edgeCalculator.ts    # Forward arbitrage edge calculation
│   │   ├── reverseEdgeCalculator.ts # Reverse arbitrage edge calculation
│   │   ├── rateConverter.ts     # Currency rate conversion (SOL/USDC → GALA)
│   │   ├── tradeExecutor.ts     # Trade execution orchestrator
│   │   ├── stateManager.ts      # Persistent state (inventory, cooldowns)
│   │   ├── inventoryRefresher.ts # Balance synchronization
│   │   ├── balanceChecker.ts    # Pre-trade balance validation
│   │   ├── quoteManager.ts      # Quote caching & management
│   │   ├── quoteValidator.ts    # Quote validation logic
│   │   ├── priceCache.ts        # Price caching service
│   │   │
│   │   ├── priceProviders/      # Chain-specific price quoters
│   │   │   ├── base.ts          # Base provider interface
│   │   │   ├── galachain.ts     # GalaChain DEX v3 quoting
│   │   │   ├── solana.ts        # Solana Jupiter aggregator quoting
│   │   │   └── strategies/      # Quote strategy overrides
│   │   │       ├── quoteStrategy.ts
│   │   │       ├── strategyManager.ts
│   │   │       ├── solanaStandardQuoteStrategy.ts
│   │   │       ├── solanaSolToGalaStrategy.ts
│   │   │       └── solanaTokenToGalaStrategy.ts
│   │   │
│   │   └── strategies/          # Arbitrage strategies (forward/reverse comparison)
│   │       ├── arbitrageStrategy.ts
│   │       ├── strategyRegistry.ts
│   │       └── strategyEvaluator.ts
│   │
│   ├── execution/               # Trade execution engines
│   │   ├── riskManager.ts       # Risk validation before execution
│   │   ├── dualLegCoordinator.ts # Orchestrates GC + SOL execution
│   │   ├── galaChainExecutor.ts # Executes token→GALA sell on GalaChain
│   │   └── solanaExecutor.ts    # Executes token buy on Solana (Jupiter)
│   │
│   ├── bridging/                # Cross-chain bridging
│   │   ├── bridgeManager.ts     # Bridge orchestration & status tracking
│   │   ├── bridgeScheduler.ts   # Scheduled bridging logic
│   │   ├── bridgeStateTracker.ts # Bridge operation state
│   │   ├── autoBridgeService.ts # Automatic rebalancing
│   │   ├── solanaBridge.ts      # Solana→GalaChain bridge interface
│   │   ├── galaConnectClient.ts # GalaConnect API client
│   │   ├── galaConnect*.ts      # Signing & signing utilities
│   │   └── inventoryTracker.ts  # Bridge inventory tracking
│   │
│   ├── services/                # External service integrations
│   │   ├── index.ts
│   │   ├── jupiterService.ts    # Jupiter aggregator interface
│   │   └── jupiterMcpClient.ts  # Jupiter MCP protocol client
│   │
│   ├── utils/                   # Utility functions
│   │   ├── logger.ts            # Winston logger setup
│   │   ├── tradeLogger.ts       # Trade-specific logging
│   │   ├── alerts.ts            # Slack/Discord alerts
│   │   ├── errorHandler.ts      # Centralized error handling
│   │   ├── errors.ts            # Custom error types
│   │   ├── calculations.ts      # Math utilities (edge, impact, etc.)
│   │   ├── retry.ts             # Retry logic
│   │   └── circuitBreaker.ts    # Circuit breaker pattern
│   │
│   └── test-*.ts files          # Standalone test scripts
│
├── application/
│   ├── api-server/              # REST API for monitoring
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/          # API endpoints
│   │   │   └── services/        # API business logic
│   │   └── package.json
│   │
│   └── vue-frontend/            # Web UI for monitoring
│       ├── src/
│       │   ├── stores/          # Pinia state management
│       │   ├── services/        # API client
│       │   └── router/          # Vue Router config
│       └── package.json
│
├── config/
│   ├── config.json              # Trading parameters
│   ├── tokens.json              # Token configurations
│   ├── strategies.json          # Strategy definitions
│   └── original.tokens.json
│
├── ARBITRAGE_ARCHITECTURE.md    # Detailed architecture docs
├── README.md
└── package.json
```

---

## 3. MAIN ENTRY POINTS & EXECUTION FLOW

### A. Entry Point: `run-bot.ts`

```typescript
main()
  ├─ initializeConfig()           // Load config.json + tokens.json + env vars
  ├─ createConfigService()        // Create IConfigService instance
  ├─ new InventoryRefresher()     // Initialize balance tracker
  ├─ refreshAll()                 // Initial balance sync
  ├─ setInterval(refreshAll, 5min) // Periodic refresh every 5 minutes
  │
  └─ Main Loop (every 15s):
     └─ runMainCycle(runMode, configService)
```

### B. Main Trading Cycle: `mainLoop.ts` → `runMainCycle()`

```
┌─────────────────────────────────────────────────────────────┐
│ CYCLE START (every 15 seconds)                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌────────────────────────┐          ┌───────────────────┐
│ CHECK INITIAL BALANCES │          │ CHECK AUTO-BRIDGE │
│                        │          │   OPPORTUNITIES   │
│ - GalaChain funds      │          │                   │
│ - Solana funds         │          │ If enabled: auto  │
│ - Pause if insufficient│          │ rebalance tokens  │
└────────────────────────┘          └───────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ FOR EACH ENABLED TOKEN:                                     │
│                                                              │
│  1. tokenEvaluator.evaluateToken()                          │
│     ├─ Fetch GalaChain quote (via price provider)           │
│     ├─ Fetch Solana quote (via Jupiter)                     │
│     ├─ Convert rates (SOL/USDC → GALA)                      │
│     ├─ Calculate edge (forward & reverse if enabled)        │
│     └─ Risk check (impact, edge threshold, cooldown, etc.)  │
│                                                              │
│  2. If evaluation passes:                                   │
│     └─ tradeExecutor.executeTrade()                         │
│        ├─ DualLegCoordinator.dryRun() [dry_run mode]        │
│        │  └─ Build execution params (no submission)         │
│        │                                                    │
│        └─ DualLegCoordinator.executeLive() [live mode]      │
│           ├─ GalaChainExecutor.executeFromQuoteLive()       │
│           │  └─ Submit token→GALA swap (GSwap SDK)          │
│           │                                                  │
│           └─ SolanaExecutor.executeFromQuoteLive()          │
│              └─ Submit token buy (Jupiter swap)             │
│                                                              │
│  3. Post-execution (live only):                             │
│     ├─ Set cooldown for token                               │
│     └─ Check balances (stop if insufficient funds)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. QUOTES & SWAPS HANDLING

### Quote Fetching System

#### GalaChain Quote (`GalaChainPriceProvider`)
- **Purpose**: Get executable price for selling token → GALA on GalaChain
- **Source**: GalaChain DEX v3 (local quoting via @gala-chain/dex SDK)
- **Quote Direction**:
  - FORWARD: Sell token, receive GALA
  - REVERSE: Spend GALA, receive token
- **Features**:
  - Size-aware (accounts for price impact)
  - Multi-hop routing support
  - Includes pool fees + 1 GALA fee per hop
  - Returns: `GalaChainQuote` with `price`, `priceImpactBps`, `currency: 'GALA'`

#### Solana Quote (`SolanaPriceProvider`)
- **Purpose**: Get executable price for buying/selling token on Solana
- **Source**: Jupiter Aggregator API
- **Quote Currency**: SOL or USDC (configurable per token via `solQuoteVia`)
- **Strategy System**: Can override quote currency per token/strategy
- **Features**:
  - Size-aware via Jupiter
  - Priority fee estimation
  - SOL/USD price from CoinGecko
  - Returns: `SolanaQuote` with `price`, `currency`, `jupiterRoute`, `priceImpactBps`

#### Quote Types (`types/core.ts`)

```typescript
interface PriceQuote {
  symbol: string;
  price: BigNumber;           // Price per token in quote currency
  currency: string;           // GALA, SOL, USDC
  tradeSize: number;
  priceImpactBps: number;
  provider: string;
  timestamp: number;
  expiresAt: number;
  isValid: boolean;
}

interface GalaChainQuote extends PriceQuote {
  currency: 'GALA';
  galaFee: BigNumber;
  feeTier: number;
  route?: string[];           // Multi-hop route
}

interface SolanaQuote extends PriceQuote {
  currency: string;           // SOL or USDC
  priorityFee: BigNumber;
  jupiterRoute?: JupiterRoute;
}
```

### Rate Conversion (`RateConverter`)

**Problem**: GalaChain quotes are in GALA, but Solana quotes may be in SOL or USDC
**Solution**: Convert all to GALA for edge calculation

```typescript
// If Solana quote is in SOL:
solToGalaRate = getSOLToGALARate()
solanaCostGala = solanaCost_SOL × solToGalaRate

// If Solana quote is in USDC:
usdcToGalaRate = getUSDCToGALARate()
solanaCostGala = solanaCost_USDC × usdcToGalaRate
```

**Rate Sources**:
1. **Pool-based**: Query GalaChain SOL/GALA or USDC/GALA pool for live rate
2. **USD-based**: Convert via CoinGecko USD prices (USDC/USD → GALA/USD)

---

## 5. EDGE CALCULATION & DIRECTIONALITY LOGIC

### Forward Arbitrage (`edgeCalculator.ts`)

**Direction**: SELL on GalaChain → BUY on Solana

```typescript
// 1. Calculate proceeds from GalaChain sell
galaProceeds = gcQuote.price × tradeSize  // in GALA

// 2. Calculate Solana buy cost
solCostInQuoteCurrency = solQuote.price × tradeSize  // in SOL/USDC
solCostGala = solCostInQuoteCurrency × solToGalaRate  // convert to GALA

// 3. Deduct costs
bridgeCost = ~$1.25 USD / galaUsdPrice  // amortized per trade
riskBuffer = galaProceeds × (riskBufferBps / 10000)

// 4. Calculate net edge
netEdge = galaProceeds - solCostGala - bridgeCost - riskBuffer
netEdgeBps = (netEdge / solCostGala) × 10000

// 5. Validation
isProfitable = netEdge > 0
meetsThreshold = netEdgeBps >= minEdgeBps (typically 30 bps)
priceImpactOK = gcPriceImpact < maxPriceImpact AND solPriceImpact < maxPriceImpact
```

### Reverse Arbitrage (`reverseEdgeCalculator.ts`)

**Direction**: BUY on GalaChain → SELL on Solana

```typescript
// 1. Calculate cost on GalaChain (buying token)
galaCost = gcQuote.price × tradeSize  // cost in GALA to BUY token

// 2. Calculate proceeds on Solana (selling token)
solProceedsInQuoteCurrency = solQuote.price × tradeSize  // in SOL/USDC
solProceedsGala = solProceedsInQuoteCurrency × quoteToGalaRate  // convert to GALA

// 3. Deduct costs (same as forward)
bridgeCost = ~$1.25 USD / galaUsdPrice
riskBuffer = solProceedsGala × (riskBufferBps / 10000)

// 4. Calculate net edge
netEdge = solProceedsGala - galaCost - bridgeCost - riskBuffer
netEdgeBps = (netEdge / galaCost) × 10000

// 5. Validation
isProfitable = netEdge > 0
meetsThreshold = netEdgeBps >= reverseArbitrageMinEdgeBps
```

### Strategy System (`core/strategies/`)

**Purpose**: Allow complex multi-strategy comparison (forward vs. reverse vs. custom)

```typescript
// Example: Compare best of forward, reverse, and custom strategies
const comparison = await strategyEvaluator.compareStrategies(token);
// Returns: { bestStrategy, strategies: [forward, reverse, ...] }
// Uses best strategy if it meets profitability threshold
```

---

## 6. SWAP EXECUTION

### GalaChain Executor (`galaChainExecutor.ts`)

**What it does**: Execute token→GALA swap on GalaChain DEX v3

```typescript
// DRY-RUN: Just build params
dryRunFromQuote(symbol, tradeSize, quote) {
  expectedProceeds = quote.price × tradeSize
  minProceeds = expectedProceeds × (1 - maxSlippageBps/10000)
  return {
    params: {
      symbol, tradeSize, expectedProceeds, minProceeds,
      feeTier, poolAddress, route, deadlineMs
    }
  }
}

// LIVE: Actually submit swap
async executeFromQuoteLive(symbol, tradeSize, quote) {
  // 1. Setup GSwap SDK with private key
  // 2. Define swap direction:
  //    tokenIn = token we're SELLING
  //    tokenOut = GALA (what we're receiving)
  // 3. Build swap instruction
  // 4. Sign transaction with GALACHAIN_PRIVATE_KEY
  // 5. Submit and wait for confirmation
  // 6. Return txHash and actual proceeds
}
```

**Slippage Protection**: Uses `minProceedsGala = expected × (1 - slippageBps/10000)`
**Deadline**: 60 seconds from execution

### Solana Executor (`solanaExecutor.ts`)

**What it does**: Execute token buy on Solana via Jupiter aggregator

```typescript
// DRY-RUN: Just build params
dryRunFromQuote(symbol, tradeSize, quote) {
  expectedCost = quote.price × tradeSize
  maxCost = expectedCost × (1 + maxSlippageBps/10000)
  return {
    params: {
      symbol, tradeSize, quoteCurrency: quote.currency,
      expectedCost, maxCost, route, deadlineMs
    }
  }
}

// LIVE: Submit swap via Jupiter
async executeFromQuoteLive(symbol, tradeSize, quote) {
  // 1. Setup Solana connection and keypair
  // 2. Determine mints from token config or quote currency
  // 3. Build Jupiter swap instruction (ExactOut for buying tradeSize)
  // 4. Sign with SOLANA_PRIVATE_KEY
  // 5. Submit and wait for confirmation
  // 6. Return txSig and actual cost
}
```

**Mode**: ExactOut (buy exact amount of token, accept variable SOL/USDC cost)
**Slippage**: `maxCost = expected × (1 + slippageBps/10000)`
**Quote Currency**: Uses quote.currency (respects strategy overrides)

### Dual-Leg Coordinator (`dualLegCoordinator.ts`)

**Purpose**: Orchestrate simultaneous execution on both chains

```typescript
async executeLive(symbol, direction, gcQuote, solQuote) {
  // 1. Validate direction (forward/reverse)
  // 2. Get fresh quotes (or use provided)
  // 3. Execute BOTH legs concurrently:
  const [gcResult, solResult] = await Promise.allSettled([
    gcExecutor.executeFromQuoteLive(symbol, tradeSize, gcQuote),
    solExecutor.executeFromQuoteLive(symbol, tradeSize, solQuote)
  ]);
  // 4. Handle partial failures
  // 5. Return both results
}
```

**Key Design**:
- Near-simultaneous execution minimizes exposure
- Uses `Promise.allSettled()` to handle partial failures
- Fresh quotes fetched at execution time
- Quotes can be overridden by caller (strategy system)

---

## 7. KEY DATA STRUCTURES & TYPES

### Core Quote Types

```typescript
interface GalaChainQuote extends PriceQuote {
  currency: 'GALA';
  galaFee: BigNumber;
  feeTier: number;
  route?: string[];
}

interface SolanaQuote extends PriceQuote {
  currency: string;  // SOL or USDC
  priorityFee: BigNumber;
  jupiterRoute?: JupiterRoute;
}

interface JupiterRoute {
  routeId: string;
  inputMint: string;
  outputMint: string;
  steps: JupiterRouteStep[];
  totalPriceImpact: number;
  totalFee: number;
}
```

### Execution Results

```typescript
interface ExecutionResult {
  id: string;
  tokenSymbol: string;
  success: boolean;
  galaChainTx?: TransactionResult;
  solanaTx?: TransactionResult;
  actualGalaChainProceeds: BigNumber;
  actualSolanaCost: BigNumber;
  actualSolanaCostGala: BigNumber;
  actualNetEdge: BigNumber;
  actualNetEdgeBps: number;
  galaChainSlippageBps: number;
  solanaSlippageBps: number;
  totalFees: BigNumber;
  durationMs: number;
  error?: string;
  partialFill?: PartialFillInfo;
}
```

### Inventory State

```typescript
interface InventoryState {
  galaChain: ChainInventory;  // GalaChain balances
  solana: ChainInventory;     // Solana balances
  lastUpdated: number;
  version: number;
}

interface ChainInventory {
  tokens: Record<string, TokenBalance>;
  native: BigNumber;  // GALA or SOL
  totalValueUsd: BigNumber;
  lastUpdated: number;
}

interface TokenBalance {
  symbol: string;
  mint: string;
  rawBalance: BigNumber;
  balance: BigNumber;
  decimals: number;
  valueUsd: BigNumber;
  lastUpdated: number;
}
```

### Configuration Types

```typescript
interface TokenConfig {
  symbol: string;
  galaChainMint: string;
  solanaMint: string;
  solanaSymbol: string;
  decimals: number;
  tradeSize: number;
  enabled: boolean;
  gcQuoteVia: string;      // Usually 'GALA'
  solQuoteVia: string;     // Usually 'SOL' or 'USDC'
}

interface TradingConfig {
  minEdgeBps: number;      // e.g., 30
  maxSlippageBps: number;  // e.g., 50
  riskBufferBps: number;   // e.g., 10 (0.1%)
  maxPriceImpactBps: number; // e.g., 250 (2.5%)
  cooldownMinutes: number;
  maxDailyTrades: number;
  enableReverseArbitrage?: boolean;
  reverseArbitrageMinEdgeBps?: number;
  arbitrageDirection?: 'forward' | 'reverse' | 'best';
}
```

### Direction Types

```typescript
type ArbitrageDirection = 'forward' | 'reverse';

interface DirectionConfig {
  forward: { enabled: boolean; minEdgeBps: number };
  reverse: { enabled: boolean; minEdgeBps: number };
  priority?: 'forward' | 'reverse' | 'best';
}
```

---

## 8. RISK MANAGEMENT & VALIDATION

### Risk Manager (`riskManager.ts`)

**Validates before execution**:

```typescript
evaluate(token, gcQuote, solQuote, solToGalaRate) {
  const reasons = [];

  // 1. Price impact checks
  if (Math.abs(gcQuote.priceImpactBps) > maxPriceImpactBps) {
    reasons.push("GalaChain price impact too high");
  }
  if (Math.abs(solQuote.priceImpactBps) > maxPriceImpactBps) {
    reasons.push("Solana price impact too high");
  }

  // 2. Cooldown check
  if (stateManager.isTokenInCooldown(token.symbol)) {
    reasons.push("Token is in cooldown");
  }

  // 3. Edge calculation
  edge = edgeCalculator.calculateEdge(...);
  if (!edge.isProfitable || !edge.meetsThreshold) {
    reasons.push(...edge.invalidationReasons);
  }

  // 4. Inventory check
  if (!hasSufficientInventory(token)) {
    reasons.push("Insufficient inventory");
  }

  return {
    shouldProceed: reasons.length === 0,
    reasons,
    edge
  };
}
```

### Balance Checker (`balanceChecker.ts`)

**Pre-trade inventory validation**:
- Checks GalaChain token balance
- Checks Solana SOL balance
- Tracks per-token requirements
- Pauses trading if insufficient funds detected
- Can be resumed after replenishment

---

## 9. BRIDGING SYSTEM

### Auto-Bridge Service (`autoBridgeService.ts`)

**Purpose**: Automatically rebalance inventory between chains

**Triggers**:
- Imbalance threshold exceeded (e.g., 80/20 split)
- Scheduled interval (every N minutes)

**Flow**:
1. Check inventory on both chains
2. Detect imbalance (e.g., too much on Solana)
3. Bridge excess tokens back to GalaChain
4. Monitor bridge status
5. Update inventory on completion

### Bridge Manager (`bridgeManager.ts`)

**Responsibilities**:
- Request bridge out via GalaConnect API
- Monitor bridge status (pending → confirmed → completed)
- Retry failed bridges
- Handle partial completions

---

## 10. CONFIGURATION SYSTEM

### Config Files

**config/config.json** - Trading parameters
```json
{
  "trading": {
    "minEdgeBps": 30,
    "maxSlippageBps": 50,
    "maxPriceImpactBps": 250,
    "cooldownMinutes": 5,
    "enableReverseArbitrage": true,
    "arbitrageDirection": "best"
  },
  "bridging": {
    "intervalMinutes": 30,
    "thresholdUsd": 100,
    "bridgeCostUsd": 1.25
  },
  "autoBridging": {
    "enabled": true,
    "imbalanceThresholdPercent": 80
  }
}
```

**config/tokens.json** - Token definitions
```json
{
  "USDUC": {
    "symbol": "USDUC",
    "galaChainMint": "GUSDUC|Unit|none|none",
    "solanaMint": "EPjFWaJrgxlzrxLj1UNY8FqduoU4cEjj2BTbYW8S5YJY",
    "tradeSize": 5000,
    "enabled": true,
    "gcQuoteVia": "GALA",
    "solQuoteVia": "USDC"
  }
}
```

### Environment Variables

```
# GalaChain
GALACHAIN_PRIVATE_KEY=...
GALACHAIN_WALLET_ADDRESS=...

# Solana
SOLANA_PRIVATE_KEY=...
SOLANA_WALLET_ADDRESS=...

# Bridge
BRIDGE_PRIVATE_KEY=...
BRIDGE_WALLET_ADDRESS=...

# APIs
COINGECKO_API_KEY=...
JUPITER_API_KEY=...
SLACK_WEBHOOK_URL=...

# Overrides
MIN_EDGE_BPS=30
MAX_SLIPPAGE_BPS=50
RUN_MODE=dry_run|live
PAUSE=true|false
```

---

## 11. EXECUTION FLOW: COMPLETE EXAMPLE

```
┌─────────────────────────────────────────────────────────────┐
│ 1. MAIN LOOP STARTS (every 15s)                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ 2. FOR EACH ENABLED TOKEN (e.g., "USDUC")                   │
│                                                              │
│    tokenEvaluator.evaluateToken("USDUC")                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌──────────────────────┐        ┌──────────────────────┐
│ GalaChain Quote      │        │ Solana Quote         │
│                      │        │                      │
│ Sell 5000 USDUC      │        │ Buy 5000 USDUC       │
│ → ~150 GALA          │        │ ← ~5 USDC            │
│ Impact: -10 bps      │        │ Impact: +5 bps       │
└──────────────────────┘        └──────────────────────┘
        │                                     │
        └──────────────────┬──────────────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │ Rate Conversion      │
                │                      │
                │ 5 USDC × 0.95 = 4.75│  (USDC→GALA rate)
                │ (USDC/USD × USD/GALA)
                └──────────────────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │ Edge Calculation     │
                │                      │
                │ GC Proceeds: 150 GALA
                │ SOL Cost: 4.75 GALA  │
                │ Bridge Cost: 1.25 GALA
                │ Risk Buffer: 1.5 GALA │
                │ ─────────────────────
                │ Net Edge: 142.5 GALA │
                │ Net Edge: ~3000 bps  │
                │ → PROFITABLE ✓       │
                └──────────────────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │ Risk Manager Check   │
                │                      │
                │ ✓ Prices valid       │
                │ ✓ Impact OK (<250bps)│
                │ ✓ Edge sufficient    │
                │ ✓ Not in cooldown    │
                │ ✓ Inventory OK       │
                │ → PASS ✓             │
                └──────────────────────┘
                           │
                           ▼
        ┌──────────────────┴──────────────────┐
        │                                     │
   [DRY_RUN]                            [LIVE MODE]
        │                                     │
        ▼                                     ▼
┌─────────────────────┐        ┌──────────────────────────┐
│ Build params only   │        │ DualLegCoordinator.      │
│ Log what would      │        │   executeLive()          │
│ happen              │        │                          │
│                     │        │ Execute BOTH legs        │
│ Output:             │        │ concurrently             │
│ - GC params         │        └──────────────────────────┘
│ - SOL params        │                │
│ - Preview edge      │                ├─────────────┬─────────────┐
└─────────────────────┘                │             │             │
                                       ▼             ▼             ▼
                            ┌──────────────┐ ┌────────────┐ ┌──────────────┐
                            │ GC Executor  │ │ SOL Exec   │ │ Error Handling
                            │              │ │            │ │
                            │ Execute:     │ │ Execute:   │ │ If one fails:
                            │ Sell USDUC   │ │ Buy USDUC  │ │ - Log failure
                            │ Get GALA     │ │ with USDC  │ │ - Alert operator
                            │              │ │            │ │ - Set cooldown
                            │ TxHash: 0x.. │ │ Sig: 5x..  │ │
                            │ Status: ✅    │ │ Status: ✅  │ │
                            └──────────────┘ └────────────┘ └──────────────┘
                                       │             │
                                       └──────┬──────┘
                                              │
                                              ▼
                            ┌──────────────────────────┐
                            │ Post-Trade:              │
                            │                          │
                            │ 1. Update inventory      │
                            │ 2. Record execution      │
                            │ 3. Set cooldown (1 min)  │
                            │ 4. Check balance suffic. │
                            │ 5. Send alert (Slack)    │
                            │                          │
                            │ Result: +142.5 GALA PnL  │
                            └──────────────────────────┘
```

---

## 12. KEY COMPONENTS SUMMARY

| Component | Purpose | Location |
|-----------|---------|----------|
| **TokenEvaluator** | Evaluates all tokens for opportunities | `core/tokenEvaluator.ts` |
| **EdgeCalculator** | Calculates forward arbitrage edge | `core/edgeCalculator.ts` |
| **ReverseEdgeCalculator** | Calculates reverse arbitrage edge | `core/reverseEdgeCalculator.ts` |
| **RateConverter** | Converts currencies to GALA | `core/rateConverter.ts` |
| **RiskManager** | Validates trades before execution | `execution/riskManager.ts` |
| **DualLegCoordinator** | Orchestrates paired execution | `execution/dualLegCoordinator.ts` |
| **GalaChainExecutor** | Executes GC swaps | `execution/galaChainExecutor.ts` |
| **SolanaExecutor** | Executes Solana swaps | `execution/solanaExecutor.ts` |
| **GalaChainPriceProvider** | Fetches GC quotes | `core/priceProviders/galachain.ts` |
| **SolanaPriceProvider** | Fetches Solana quotes | `core/priceProviders/solana.ts` |
| **StateManager** | Manages persistent state | `core/stateManager.ts` |
| **InventoryRefresher** | Synchronizes balances | `core/inventoryRefresher.ts` |
| **BalanceChecker** | Validates inventory levels | `core/balanceChecker.ts` |
| **BridgeManager** | Orchestrates bridging | `bridging/bridgeManager.ts` |
| **AutoBridgeService** | Automatic rebalancing | `bridging/autoBridgeService.ts` |

---

## 13. IMPORTANT DESIGN PATTERNS

### 1. **Fail-Fast Strategy**
- Skip token if quotes fail
- Skip if risk checks fail
- Continue with next token

### 2. **Parallel Execution**
- Quote fetching is parallelized
- Both legs execute concurrently
- Using `Promise.allSettled()` for partial failure handling

### 3. **Fresh Quotes at Execution**
- Quotes fetched during discovery
- Quotes re-fetched at execution time
- Prevents stale quote execution

### 4. **Direction Agnosticism**
- Same quote and execution flow for forward/reverse
- Direction determined by edge calculation
- Strategy system can compare multiple directions

### 5. **Inventory Protection**
- Pre-flight balance checks
- Floor checks to prevent over-trading
- Post-trade balance verification
- Auto-pause on insufficient funds

---

## 14. LOGGING & MONITORING

### Logger Types

- **Main Logger**: Winston-based, includes all bot activity
- **Execution Logger**: Trade-specific execution details
- **Trade Logger**: Structured trade records (JSON)
- **Error Handler**: Centralized error handling with alerts

### Alerts

- **Slack/Discord**: Trade success/failure notifications
- **Email**: Critical errors
- **Log Files**: Structured trade logs

---

## 15. TESTING & DEVELOPMENT

### Test Scripts

- `test-edge-calculator.ts` - Edge calculation
- `test-dual-leg.ts` - Dual-leg dry-run
- `test-gc-executor.ts` - GalaChain execution
- `test-sol-executor.ts` - Solana execution
- `test-quote-manager.ts` - Quote management
- `test-price-discovery.ts` - Price provider testing
- `test-bridge-roundtrip.ts` - Bridge testing

### Development Commands

```bash
npm run dev              # Run in development
npm run build           # Compile TypeScript
npm run start           # Run compiled bot
npm run lint            # Linting
npm run test            # Run tests
npm run balances        # Check current balances
npm run analyze         # Analyze trade history
```

---

## 16. CRITICAL CONFIGURATION PARAMETERS

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `minEdgeBps` | 30 | Minimum edge required |
| `maxSlippageBps` | 50 | Max slippage tolerance |
| `maxPriceImpactBps` | 250 | Max price impact per leg |
| `riskBufferBps` | 10 | Risk buffer (0.1%) |
| `cooldownMinutes` | 5 | Per-token cooldown after trade |
| `enableReverseArbitrage` | true | Enable reverse direction |
| `arbitrageDirection` | "best" | Direction priority (forward/reverse/best) |
| `bridgeCostUsd` | 1.25 | Estimated bridge cost |

---

## SUMMARY

This codebase implements a **sophisticated cross-chain arbitrage bot** with:

1. **Dual-direction trading** (forward & reverse)
2. **Multi-strategy evaluation** (compare opportunities)
3. **Robust risk management** (multi-layer validation)
4. **Paired execution** (near-simultaneous swaps)
5. **Inventory management** (auto-bridging & rebalancing)
6. **Comprehensive monitoring** (alerts, logging, analytics)
7. **Fail-safe mechanisms** (circuit breakers, pauses, cooldowns)

The architecture prioritizes **safety, precision, and clarity** through well-defined responsibilities at each component layer.
