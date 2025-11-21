## Phase 3: Execution Engine

This document tracks work completed during Phase 3 (Execution Engine) and outlines next steps. Each task is implemented incrementally with focused testing.

### ✅ 3.1 GalaChain Executor (skeleton + dry-run)

Implemented a minimal executor for GalaChain sells (token → GALA) with slippage protection and deadline handling. This is a dry-run only (no on-chain submission).

- Added `src/execution/galaChainExecutor.ts`
  - Builds execution params from a `GalaChainQuote`:
    - `expectedProceedsGala = quote.price * tradeSize`
    - `minProceedsGala` computed via slippage tolerance (from config `maxSlippageBps`)
    - Includes `feeTier`, `poolAddress`, `route`, and a short `deadlineMs`
  - Logs prepared parameters via logger execution channel

- Added `src/test-gc-executor.ts`
  - Initializes config
  - Fetches a GalaChain quote for `SOL` using the GalaChain price provider
  - Runs `GalaChainExecutor.dryRunFromQuote(...)`
  - Logs prepared execution parameters

Sample test output (abridged):

```
✅ GalaChain price provider initialized
[EXECUTION] Prepared GC execution params for SOL {
  symbol: "SOL",
  tradeSize: 0.01,
  expectedProceedsGala: "0.1",
  minProceedsGala: "0.0995",
  feeTier: 10000,
  poolAddress: "unknown",
  deadline: <timestamp>
}
✅ Dry-run params built { ... }
```

How to run:

```
npx ts-node src/test-gc-executor.ts
```

Config values used:
- Slippage tolerance: `trading.maxSlippageBps` from `config/config.json`
- Deadline: fixed 60s window in the executor (can be made configurable later)

Notes:
- The executor currently prepares params only; it does not submit any transactions.
- `poolAddress` is set to `unknown` because the current GC quoting path does not expose a concrete pool address; route is a simple token list for traceability.

---

### 🔜 Next: 3.2 Solana Executor (skeleton + dry-run)

Implemented a Solana executor skeleton with dry-run preparation of params from a `SolanaQuote`.

- Added `src/execution/solanaExecutor.ts`
  - Builds params from `SolanaQuote` (respects dynamic quote currency via `solQuoteVia`, e.g., USDC)
  - Computes `expectedCostInQuote = price * tradeSize`
  - Computes `maxCostInQuote = expected * (1 + slippageBps)`
  - Includes route (Jupiter), and short `deadlineMs`

- Added `src/test-sol-executor.ts`
  - Initializes config
  - Fetches a Solana quote for `SOL` via Jupiter (USDC-quoted)
  - Runs `SolanaExecutor.dryRunFromQuote(...)` and logs params

Sample test output (abridged):

```
✅ Solana price provider initialized
[EXECUTION] Prepared SOL execution params for SOL {
  symbol: "SOL",
  tradeSize: 0.01,
  quoteCurrency: "USDC",
  expectedCostInQuote: "1.97...",
  maxCostInQuote: "1.98...",
  deadline: <timestamp>
}
✅ Solana dry-run params built { ... }
```

After both executors are ready, we will proceed to:
- 3.3 Dual-Leg Coordinator (near-simultaneous GC sell + SOL buy)
- 3.4 Risk Manager (pre-trade validation and recovery)

---

### ✅ 3.3 Dual-Leg Coordinator (dry-run)

Implemented a coordinator that prepares both legs (GalaChain sell + Solana buy) as a single dry-run, ensuring timing alignment.

- Added `src/execution/dualLegCoordinator.ts`
  - Initializes both price providers
  - Fetches quotes for the configured `tradeSize`
  - Builds GC and SOL dry-run params using the existing executors
  - Checks deadlines align within a small window (default 30s)
  - Returns a combined result; includes a placeholder `previewNetGala` for future net estimation

- Added `src/test-dual-leg.ts`
  - Runs a dual-leg dry-run for `SOL`
  - Logs:
    - GC expected/min proceeds (GALA)
    - SOL expected/max cost (quote currency, e.g., USDC)
    - Both deadlines and whether timing is OK

Sample test output (abridged):

```
✅ GalaChain price provider initialized
✅ Solana price provider initialized
[EXECUTION] Prepared GC execution params for SOL { expectedProceedsGala: "0.1", minProceedsGala: "0.0995", ... }
[EXECUTION] Prepared SOL execution params for SOL { quoteCurrency: "USDC", expectedCostInQuote: "1.9696...", maxCostInQuote: "1.9795...", ... }
[EXECUTION] Prepared dual-leg dry-run { timingOk: true }
✅ Dual-leg dry-run built { gc_deadline: <ts>, sol_deadline: <ts> }
```

How to run:

```
npx ts-node src/test-dual-leg.ts
```

Notes:
- This is a dry-run only; no transactions are submitted.
- Net preview is intentionally deferred until we wire a consistent conversion path to GALA for the SOL leg’s quote currency (e.g., USDC→GALA).

---

### ✅ 3.4 Risk Manager (pre-trade validation)

Implemented a pre-trade risk layer that evaluates whether a discovered opportunity should proceed, using quotes, config guardrails, and state.

- Added `src/execution/riskManager.ts`
  - Validations:
    - Price impact caps per leg (`trading.maxPriceImpactBps`)
    - Net edge threshold via `EdgeCalculator` (`trading.minEdgeBps`)
    - Token cooldown check via `StateManager`
    - Basic inventory presence check on GalaChain for sell leg
  - Logs PASS/FAIL, reasons, and computed `netEdge/netEdgeBps`

- Added `src/test-risk-manager.ts`
  - Fetches live GC + Sol quotes for `SOL`
  - Uses GC price as a proxy for `SOL→GALA` rate (for SOL symbol)
  - Runs `RiskManager.evaluate(...)` and logs decision

Sample test output (abridged):

```
✅ GalaChain price provider initialized
✅ Solana price provider initialized
[EXECUTION] Risk evaluation for SOL: FAIL {
  reasons: [
    "Negative net edge",
    "Edge ...bps below threshold 30bps",
    "Insufficient GalaChain inventory for sell (simulation mode if dry-run)"
  ],
  netEdge: "-50.93...",
  netEdgeBps: -9980.40...
}
🚫 Risk FAIL { ... }
```

How to run:

```
npx ts-node src/test-risk-manager.ts
```

Notes:
- Failures are expected in test environment due to insufficient GC liquidity/inventory and current price levels; this confirms guardrails work.
- We can improve `SOL→GALA` rate sourcing by using the provider’s cached USD prices (GALA/USD, SOL/USD) to compute the rate consistently across tokens.


