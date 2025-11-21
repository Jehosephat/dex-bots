# Arbitrage Bot Architecture Overview

## Executive Summary

This bot implements a **cross-chain arbitrage strategy** between GalaChain and Solana. It identifies price discrepancies, executes paired trades (sell on GC, buy on SOL), and periodically bridges tokens back to GalaChain. All profits are denominated and accumulated in **GALA** on GalaChain.

---

## Core Strategy: "Inventory Mode Arbitrage"

### The Arbitrage Concept

1. **Detect price difference**: Token is cheaper on Solana than what we can sell it for on GalaChain
2. **Execute paired trades**: Simultaneously sell token on GC → GALA, and buy same token on SOL
3. **Capture spread**: The difference between GC proceeds and SOL cost (minus fees) = net profit
4. **Bridge back**: Periodically bridge accumulated tokens from SOL → GC to replenish inventory

**Formula for Net Edge (in GALA):**
```
Net Edge = (GC Sell Proceeds in GALA) 
         - (SOL Buy Cost converted to GALA) 
         - (Bridge Cost ~$1.25 USD) 
         - (Risk Buffer ~5-10 bps)
```

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      RUN-BOT.TS (Main Entry Point)              │
│  - Initializes config, inventory refresher                       │
│  - Starts main trading loop (15s interval)                        │
│  - Periodic inventory refresh (5min interval)                   │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN LOOP (runMainCycle)                   │
│  For each enabled token:                                        │
│    1. Fetch quotes from both chains                             │
│    2. Evaluate risk/edge                                         │
│    3. Execute if profitable                                     │
└────────────────────────────┬──────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                        │
        ▼                                        ▼
┌───────────────────────┐          ┌───────────────────────┐
│  PRICE DISCOVERY      │          │    RISK EVALUATION   │
│                       │          │                       │
│  GalaChainProvider    │──────────▶│   RiskManager       │
│  SolanaProvider       │          │   EdgeCalculator     │
└───────────────────────┘          └───────────────────────┘
        │                                        │
        │                                        ▼
        │                          ┌───────────────────────┐
        │                          │  DUAL-LEG COORDINATOR │
        │                          │                       │
        └──────────────────────────▶│  executeLive()      │
                                   │  dryRun()            │
                                   └──────┬──────┬─────────┘
                                          │      │
                          ┌───────────────┘      └───────────────┐
                          │                                      │
                          ▼                                      ▼
              ┌─────────────────────┐              ┌─────────────────────┐
              │ GalaChainExecutor   │              │  SolanaExecutor     │
              │                     │              │                      │
              │ executeFromQuote()  │              │ executeFromQuote()  │
              └─────────────────────┘              └─────────────────────┘
                          │                                      │
                          └──────────────┬───────────────────────┘
                                         │
                                         ▼
                           ┌───────────────────────┐
                           │   STATE MANAGER      │
                           │  - Track inventory   │
                           │  - Cooldowns         │
                           │  - PnL               │
                           └───────────────────────┘
```

---

## Component Details

### 1. **Price Discovery Layer** (`core/priceProviders/`)

**Purpose**: Fetch size-aware, executable quotes from both chains

#### GalaChainPriceProvider
- **Quote Strategy**: Token → GALA (through DEX v3 pools)
- **Features**:
  - Size-aware quoting (accounts for price impact)
  - Multi-hop routing (e.g., FARTCOIN → USDC → GALA)
  - Calculates 1 GALA fee per hop + pool fees
  - Returns `GalaChainQuote` with price, impact, fees

#### SolanaPriceProvider  
- **Quote Strategy**: SOL/USDC → Token (using Jupiter aggregator)
- **Features**:
  - Jupiter API integration for best routes
  - Priority fee estimation based on price impact
  - SOL/USD price from CoinGecko
  - Returns `SolanaQuote` with price, impact, route info

**Key Design**: Quotes are **fresh** (fetched each cycle) and **size-aware** (reflect actual execution cost for configured trade size)

---

### 2. **Edge Calculation** (`core/edgeCalculator.ts`)

**Purpose**: Calculate net profitability of arbitrage opportunity

**Calculations**:
```typescript
GC Proceeds = quote.price × tradeSize (in GALA)
SOL Cost = quote.price × tradeSize (in SOL/USDC)
SOL Cost (GALA) = SOL Cost × SOL→GALA rate
Bridge Cost = ~$1.25 USD / GALA price
Risk Buffer = proceeds × (riskBufferBps / 10000)

Net Edge = GC Proceeds - SOL Cost (GALA) - Bridge Cost - Risk Buffer
Net Edge (bps) = (Net Edge / Total Cost) × 10000
```

**Validation**:
- Price impact < max threshold (e.g., 50 bps)
- Net edge > minimum threshold (e.g., 30-50 bps)
- Prices are valid and positive

---

### 3. **Risk Management** (`execution/riskManager.ts`)

**Purpose**: Multi-layer validation before execution

**Checks**:
1. **Price Impact**: Both legs < max price impact cap
2. **Edge Threshold**: Net edge meets minimum bps requirement
3. **Cooldown**: Token not recently traded (prevents churn)
4. **Inventory**: Sufficient balances on both chains
5. **Quote Freshness**: Quotes are recent (< stale threshold)

**Output**: `RiskCheckResult` with `shouldProceed: boolean` and reasons if blocked

---

### 4. **Dual-Leg Coordinator** (`execution/dualLegCoordinator.ts`)

**Purpose**: Orchestrate simultaneous execution on both chains

**Flow**:
```typescript
async executeLive(symbol: string) {
  // 1. Get fresh quotes (re-quote at execution time)
  const [gcQuote, solQuote] = await Promise.all([
    gcProvider.getQuote(symbol, tradeSize),
    solProvider.getQuote(symbol, tradeSize)
  ]);

  // 2. Safety checks (pause, trade window, notional caps)
  
  // 3. Execute BOTH legs concurrently (Promise.allSettled)
  const [gcResult, solResult] = await Promise.allSettled([
    gcExecutor.executeFromQuoteLive(symbol, tradeSize, gcQuote),
    solExecutor.executeFromQuoteLive(symbol, tradeSize, solQuote)
  ]);

  // 4. Handle partial failures (one leg fails, other succeeds)
  // 5. Log results and send alerts
}
```

**Key Design**:
- **Near-simultaneous execution**: Both legs fire concurrently to minimize exposure
- **Independent failure handling**: Uses `Promise.allSettled` to handle partial failures
- **Fresh quotes at execution**: Re-quotes immediately before execution (not using stale quotes from discovery)

---

### 5. **Executors** (`execution/`)

#### GalaChainExecutor
- **Strategy**: Sell Token → Receive GALA
- **Implementation**: GalaChain DEX v3 swap
- **Slippage Protection**: Min proceeds GALA (expected × (1 - slippage))
- **Deadline**: Short expiry (e.g., 60s)
- **Returns**: Transaction hash, proceeds realized

#### SolanaExecutor
- **Strategy**: Buy Token using SOL/USDC
- **Implementation**: Jupiter aggregator swap
- **Mode**: ExactOut (buy exact tradeSize of token)
- **Slippage Protection**: Max cost in quote currency
- **Transaction**: Builds, signs, submits, confirms
- **Returns**: Transaction signature, cost realized

**Key Design**: Both executors use **dry-run** mode for testing (build params without submitting)

---

### 6. **Inventory Management** (`core/inventoryRefresher.ts`, `bridging/`)

**Purpose**: Track balances on both chains and manage bridging

#### InventoryRefresher
- **Refresh Cycle**: Every 5 minutes (or on demand)
- **Sources**:
  - GalaChain: Via GalaConnect API (`FetchBalances`)
  - Solana: Direct RPC calls to token accounts
- **Updates**: StateManager inventory state

#### BridgeManager
- **Purpose**: Bridge tokens SOL → GC (replenish inventory)
- **Triggers**:
  - Time-based: Every N minutes
  - Threshold-based: When SOL balance exceeds threshold
- **Process**:
  1. Request bridge out (GalaConnect API)
  2. Monitor bridge status
  3. Update inventory on arrival

#### BridgeScheduler
- **Purpose**: Automated bridging coordination
- **Decisions**: When to bridge, how much to bridge
- **Safety**: Prevents bridging if bridge is unhealthy/recently failed

---

### 7. **State Management** (`core/stateManager.ts`)

**Purpose**: Persistent state tracking

**Tracks**:
- **Inventory**: Balances by chain/token
- **Cooldowns**: Per-token cooldown timestamps
- **Trade History**: Recent trades, PnL
- **Status**: Bot status, last refresh times

**Persistence**: Saves to `state.json` for crash recovery

---

### 8. **Main Loop Flow** (`mainLoop.ts`)

**Execution Cycle** (runs every 15s by default):

```
For each enabled token:
  1. Parallel quote fetch (GC + SOL) ────────┐
                                              │
  2. SOL→GALA rate calculation                │
                                              │
  3. Risk evaluation (edge calc + checks) ────┐
                                              │
  4. If PASS and live mode:                   │
     - DualLegCoordinator.executeLive()       │
     - Execute GC sell + SOL buy              │
     - Handle results/partial failures        │
                                              │
  5. If PASS and dry-run mode:                 │
     - DualLegCoordinator.dryRun()            │
     - Log what would happen                  │
```

**Design Principles**:
- **Fail-fast**: Skip token if quotes fail or risk checks fail
- **Parallel where safe**: Quote fetching is parallelized
- **Independent tokens**: Each token evaluated separately

---

## Data Flow: Complete Trade Cycle

```
┌─────────────────────────────────────────────────────────────┐
│ 1. PRICE DISCOVERY                                          │
│    ├─ GalaChain: "Sell 1000 FARTCOIN → GALA"               │
│    │  Quote: 1000 FARTCOIN = 150 GALA                       │
│    │  Impact: -10 bps                                       │
│    └─ Solana: "Buy 1000 FARTCOIN with SOL"                  │
│       Quote: 1000 FARTCOIN = 0.05 SOL                       │
│       Impact: +5 bps                                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. EDGE CALCULATION                                         │
│    GC Proceeds: 150 GALA                                    │
│    SOL Cost: 0.05 SOL                                       │
│    SOL→GALA Rate: 1 SOL = 2800 GALA                         │
│    SOL Cost (GALA): 0.05 × 2800 = 140 GALA                  │
│    Bridge Cost: ~31.25 GALA ($1.25 / $0.04)                │
│    Risk Buffer: 1.5 GALA (1% of proceeds)                   │
│                                                              │
│    Net Edge: 150 - 140 - 31.25 - 1.5 = -22.75 GALA ❌       │
│    Net Edge BPS: Negative (not profitable)                 │
│                                                              │
│    Result: SKIP (edge below threshold)                     │
└─────────────────────────────────────────────────────────────┘

                          │
                          ▼ (If edge was positive)
┌─────────────────────────────────────────────────────────────┐
│ 3. RISK VALIDATION                                          │
│    ✓ Price impact OK (GC: -10bps, SOL: +5bps < 50bps)      │
│    ✓ Edge meets threshold (e.g., >30bps)                   │
│    ✓ Not in cooldown                                        │
│    ✓ Inventory sufficient (GC has FARTCOIN, SOL has SOL)   │
│                                                              │
│    Result: PROCEED ✅                                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. EXECUTION (Dual-Leg)                                     │
│                                                              │
│    Parallel execution:                                      │
│    ┌─────────────────────┐  ┌─────────────────────┐        │
│    │ GalaChainExecutor  │  │ SolanaExecutor      │        │
│    │                    │  │                     │        │
│    │ Sell: 1000 FARTCOIN│  │ Buy: 1000 FARTCOIN  │        │
│    │ → 150 GALA         │  │ ← 0.05 SOL         │        │
│    │                     │  │                     │        │
│    │ Tx Hash: 0xabc...   │  │ Tx Sig: 5xYz...     │        │
│    │ Status: ✅ Success   │  │ Status: ✅ Success   │        │
│    └─────────────────────┘  └─────────────────────┘        │
│                                                              │
│    Result: Both legs successful ✅                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. POST-TRADE                                              │
│    - Update inventory (GC: +150 GALA, -1000 FARTCOIN)    │
│    - Update inventory (SOL: -0.05 SOL, +1000 FARTCOIN)   │
│    - Set cooldown for FARTCOIN (e.g., 5 minutes)         │
│    - Log trade to state.json                              │
│    - Send alert (Slack/Discord)                           │
│                                                              │
│    Net Result: +10 GALA profit (example)                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. BRIDGING (Periodic, Separate Process)                   │
│    When SOL balance of FARTCOIN > threshold OR             │
│    When bridge interval (30min) elapsed:                    │
│                                                              │
│    - Bridge 1000 FARTCOIN: SOL → GC                        │
│    - Monitor bridge status                                 │
│    - On arrival: Update GC inventory                       │
│                                                              │
│    Result: Inventory replenished for next cycle            │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration System

### Token Configuration (`config/tokens.json`)
```json
{
  "FARTCOIN": {
    "symbol": "FARTCOIN",
    "galaChainMint": "GFARTCOIN|Unit|none|none",
    "solanaMint": "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    "tradeSize": 1000,
    "enabled": true,
    "gcQuoteVia": "GALA",
    "solQuoteVia": "SOL"
  }
}
```

### Trading Parameters (via `config.json` or env vars)
- `minEdgeBps`: Minimum edge threshold (e.g., 30 bps)
- `maxSlippageBps`: Max acceptable slippage (e.g., 50 bps)
- `maxPriceImpactBps`: Max price impact per leg (e.g., 50 bps)
- `riskBufferBps`: Risk buffer percentage (e.g., 100 bps = 1%)
- `cooldownMinutes`: Per-token cooldown after trade

---

## Safety Mechanisms

### 1. **Guardrails**
- Minimum edge threshold (prevents unprofitable trades)
- Maximum price impact (prevents market manipulation)
- Slippage protection (limits downside)
- Trade window (UTC time window for trading)
- Notional caps (max USD per trade)

### 2. **Failure Handling**
- Partial leg failures (one succeeds, one fails) → alerts + cooldown
- Quote failures → skip token, retry next cycle
- Bridge failures → pause affected token, alert operator

### 3. **Inventory Protection**
- Floor checks (prevent trading below minimum balance)
- Bridge thresholds (prevent excessive bridging)
- Balance reconciliation (refresh every 5 min)

### 4. **Operational Controls**
- `PAUSE=true` env var (global pause)
- Per-token cooldowns (prevent churn)
- Manual intervention hooks (alerts for review)

---

## Key Design Decisions

### Why Inventory Mode?
- **Simplicity**: No complex hedging or position management
- **Low Risk**: Matched buy/sell minimizes exposure
- **Clear PnL**: All profits in GALA on GC

### Why Paired Execution?
- **Minimize Exposure**: Both legs execute near-simultaneously
- **Price Lock-in**: Fresh quotes at execution time
- **Atomic-like Behavior**: If one fails, alerts allow manual intervention

### Why Size-Aware Quotes?
- **Realistic Pricing**: Accounts for actual execution cost
- **Impact Protection**: Prevents trades with excessive slippage
- **Better Edge Calculation**: Net edge reflects realizable profit

### Why GALA Denomination?
- **Unified Currency**: All costs/profits in same unit
- **Clear Metrics**: PnL always in GALA (easy to track)
- **GC Native**: Fits GalaChain ecosystem

---

## Operational Workflow

### Startup Sequence
1. Load config (`config.json`, `tokens.json`)
2. Initialize state manager (load `state.json`)
3. Initialize price providers (GC + SOL)
4. Refresh inventory (initial balances)
5. Start main loop (15s cycles)
6. Start inventory refresher (5min cycles)
7. Start bridge scheduler (if enabled)

### Trading Cycle (Every 15s)
1. Get enabled tokens
2. For each token:
   - Fetch quotes (parallel)
   - Calculate edge
   - Evaluate risk
   - Execute if pass (or dry-run)
3. Log results
4. Wait interval

### Bridge Cycle (Every 30min or on threshold)
1. Check SOL inventory per token
2. If > threshold: bridge out
3. Monitor bridge status
4. Update inventory on arrival

---

## Monitoring & Alerts

### Metrics Tracked
- **PnL**: Cumulative profit in GALA
- **Trade Count**: Successful trades, skipped trades
- **Inventory**: Balances by chain/token
- **Bridge Status**: Last bridge, pending bridges
- **Edge History**: Net edge over time

### Alerts Triggered
- Dual-leg trade success/failure
- Slippage breach
- Bridge delay/failure
- Inventory below floor
- Risk gate blocks
- Quote failures

---

## Summary

The arbitrage bot follows a **simple but robust** design:

1. **Discover** prices on both chains (size-aware)
2. **Calculate** net edge (GC proceeds - SOL cost - fees - buffer)
3. **Validate** with risk manager (impact, threshold, cooldown, inventory)
4. **Execute** paired trades (GC sell + SOL buy simultaneously)
5. **Bridge** back periodically (replenish inventory)
6. **Track** everything in GALA (clear PnL)

All components work together through a **well-defined flow** with **clear responsibilities** and **fail-safe mechanisms** at each step.

