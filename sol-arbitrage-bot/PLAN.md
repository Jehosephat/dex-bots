# SOL Arbitrage Bot Implementation Plan

Based on the PRD and analysis of existing codebase components, here's a detailed implementation plan for the "Arb-MVP" cross-chain arbitrage bot:

## **Phase 1: Project Setup & Foundation** 
*Duration: 1-2 days*

### 1.1 Project Structure
- Create `sol-arbitrage-bot/` directory with TypeScript setup
- Copy `tsconfig.json` and `package.json` patterns from `sol-bot`
- Set up logging infrastructure using patterns from `follow-bot`

### 1.2 Configuration System
- Create `config.json` with token configurations (FARTCOIN, TRUMP, SOL)
- Implement configuration management similar to `bollinger-bot/src/config/`
- Add environment variable support for sensitive data

### 1.3 Core Types & Interfaces
- Define `ArbitrageOpportunity`, `ExecutionResult`, `InventoryState` interfaces
- Create token configuration types for supported assets
- Set up state management for inventory tracking

**Reusable Components:**
- Configuration patterns from `bollinger-bot`
- TypeScript setup from `sol-bot`

---

## **Phase 2: Price Discovery & Quoting System**
*Duration: 2-3 days*

### 2.1 GalaChain Price Provider
- **Reuse:** `sol-bot/src/core/priceProviders/galachain.ts` as base
- Implement size-aware quoting for token→GALA swaps
- Add GALA fee calculation (1 GALA per hop + pool fees)

### 2.2 Solana Price Provider  
- **Reuse:** Jupiter integration patterns from `sol-bot/src/execution/solanaExecutor.ts`
- Implement size-aware SOL buy quotes
- Add priority fee estimation

### 2.3 Edge Calculator
- **Reuse:** Price comparison logic from `bollinger-bot/src/priceSources.ts`
- Calculate Net Edge = (GC proceeds) - (SOL cost in GALA) - (bridge cost) - (risk buffer)
- Implement guardrails (minimum edge, price impact caps)

### 2.4 Quote Manager
- Coordinate between GC and SOL price providers
- Handle quote freshness and validation
- Implement cooldown logic per token

**Reusable Components:**
- GalaChain price provider from `sol-bot`
- Jupiter integration from `sol-bot` 
- Price comparison utilities from `bollinger-bot`

---

## **Phase 3: Execution Engine**
*Duration: 3-4 days*

### 3.1 GalaChain Executor
- **Reuse:** `sol-bot/src/execution/galaChainExecutor.ts` as base
- Modify for token→GALA sell operations
- Add slippage protection and deadline management

### 3.2 Solana Executor
- **Reuse:** `sol-bot/src/execution/solanaExecutor.ts` as base  
- Modify for token buy operations using SOL
- Implement transaction confirmation and error handling

### 3.3 Dual-Leg Coordinator
- **Reuse:** `sol-bot/src/execution/dualLegExecutor.ts` patterns
- Implement near-simultaneous GC sell + SOL buy
- Add partial fill handling and counterpart cancellation
- Create execution result tracking

### 3.4 Risk Manager
- **Reuse:** Risk management patterns from `follow-bot/src/analysis/tradeAnalyzer.ts`
- Implement pre-trade validation (inventory, price impact, cooldowns)
- Add execution failure handling and recovery

**Reusable Components:**
- Complete execution engine from `sol-bot`
- Risk analysis patterns from `follow-bot`

---

## **Phase 4: Bridging System**
*Duration: 2-3 days*

### 4.1 Bridge Manager
- **Reuse:** `bridge_round_trip/src/roundTripRunner.ts` as base
- Implement SOL→GC token bridging for accumulated inventory
- Add bridge status tracking and confirmation handling

### 4.2 Bridge Scheduler
- Implement time-based bridging (every N minutes)
- Add threshold-based bridging (when inventory exceeds limit)
- Create bridge queue management

### 4.3 Inventory Reconciliation
- Track token balances on both chains
- Update inventory after successful bridges
- Handle bridge failures and retries

**Reusable Components:**
- Complete bridging infrastructure from `bridge_round_trip`
- GalaConnect client for bridge operations

---

## **Phase 5: Monitoring & Telemetry**
*Duration: 2-3 days*

### 5.1 PnL Tracker
- **Reuse:** Position tracking patterns from `follow-bot/src/positions/positionTracker.ts`
- Calculate realized PnL in GALA
- Track per-token performance and cumulative metrics

### 5.2 Inventory Manager
- Monitor token balances on both chains
- Track bridge status and pending transfers
- Implement inventory floor alerts

### 5.3 Alert System
- **Reuse:** Alert patterns from `follow-bot/src/monitoring/`
- Implement alerts for slippage breaches, bridge delays, inventory issues
- Add manual pause/resume functionality

### 5.4 Dashboard/Logging
- **Reuse:** Logging infrastructure from `follow-bot`
- Create simple dashboard for PnL, inventory, and trade history
- Implement daily summary reports

**Reusable Components:**
- Complete monitoring system from `follow-bot`
- Position tracking and alerting infrastructure

---

## **Phase 6: Integration & Testing**
*Duration: 2-3 days*

### 6.1 End-to-End Testing
- Create test scenarios for complete arbitrage cycles
- Test bridge integration and inventory reconciliation
- Validate error handling and recovery mechanisms

### 6.2 Production Readiness
- Add PM2 configuration for deployment
- Create environment setup documentation
- Implement health checks and monitoring

### 6.3 Performance Optimization
- Optimize quote fetching and execution timing
- Fine-tune cooldown periods and thresholds
- Add performance metrics and monitoring

---

## **Key Reusable Components Summary**

1. **From `sol-bot`:**
   - Complete execution engine (GalaChain + Solana)
   - Price provider infrastructure
   - Configuration management

2. **From `bridge_round_trip`:**
   - Complete SOL→GC bridging system
   - GalaConnect client integration
   - Bridge fee calculation

3. **From `follow-bot`:**
   - Monitoring and alerting system
   - Position tracking and PnL calculation
   - Logging infrastructure

4. **From `bollinger-bot`:**
   - Price comparison utilities
   - Configuration management patterns
   - State persistence

## **Project Structure**
```
sol-arbitrage-bot/
├── src/
│   ├── core/
│   │   ├── quoter.ts           # Edge calculation
│   │   ├── decider.ts          # Trade decision logic
│   │   └── bookkeeper.ts       # PnL & inventory tracking
│   ├── execution/
│   │   ├── galaChainExecutor.ts # GC sell operations
│   │   ├── solanaExecutor.ts    # SOL buy operations
│   │   └── dualLegExecutor.ts   # Coordination
│   ├── bridging/
│   │   ├── bridgeManager.ts     # SOL→GC bridging
│   │   └── inventoryTracker.ts  # Balance tracking
│   ├── monitoring/
│   │   ├── pnlTracker.ts        # PnL calculation
│   │   ├── alertManager.ts      # Alert system
│   │   └── dashboard.ts         # Simple UI
│   └── index.ts                 # Main orchestrator
├── config/
│   ├── config.json             # Token configurations
│   └── tokens.json             # Token definitions
├── state.json                  # Persistent state
└── package.json
```

## **Implementation Notes**

### Core Principles
- **Lightweight & Maintainable**: Leverage existing components to minimize custom code
- **Inventory Mode**: Paired GC sell + SOL buy executed near-simultaneously
- **GALA Settlement**: All PnL denominated and reported in GALA
- **Simple Guardrails**: Fixed thresholds for edge, impact, and risk buffers

### Risk Management
- Minimum Net Edge threshold (30-50 bps)
- Maximum price impact per leg (50 bps)
- Fixed risk buffer (5-10 bps)
- Per-token cooldowns after attempts
- Manual pause/resume functionality

### Success Criteria
1. Evaluates each enabled token at fixed size and computes Net Edge in GALA
2. Executes paired legs only when guardrails pass, otherwise skips with reason
3. Bridges accumulated tokens from SOL→GC on time/threshold rules
4. Maintains running PnL in GALA and current inventories
5. Supports manual pause/resume and per-token cooldowns

This plan leverages the existing codebase effectively while maintaining the lightweight, maintainable approach specified in the PRD. Each phase builds incrementally toward a fully functional arbitrage bot that captures clear cross-chain opportunities while managing risk appropriately.
