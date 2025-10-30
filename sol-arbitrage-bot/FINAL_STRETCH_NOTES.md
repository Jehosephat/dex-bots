## Final Stretch Notes

This document tracks the last mile to a fully working live arbitrage bot (bridging deferred).

### Status Snapshot
- Solana live executor: ✅ Implemented and smoke-tested
  - File: `src/execution/solanaExecutor.ts`
  - Test: `src/test-sol-exec-live.ts`
- GalaChain live executor: ✅ Implemented and smoke-tested
  - File: `src/execution/galaChainExecutor.ts`
  - Test: `src/test-gc-exec-live.ts`
- Bridging: ⏸ Deferred (manual for now)

### Remaining Todos
1) Upgrade Dual-Leg execution (pending)
   - Orchestrate GC sell + SOL buy with shared deadline window
   - Failure handling: if one leg fails, abort counterpart and cooldown token
   - Record tx ids, realized amounts, slippage, timing

2) Risk and safety config (pending)
   - Env-driven: `RUN_MODE`, `MIN_EDGE_BPS`, `MAX_PRICE_IMPACT_BPS`, `MAX_SLIPPAGE_BPS`, `COOLDOWN_MINUTES`
   - Notional caps: `MAX_NOTIONAL_PER_TRADE`, `MAX_NOTIONAL_PER_DAY` (USD default)
   - Trade window + pause: `TRADE_WINDOW_START`, `TRADE_WINDOW_END`, `PAUSE`

3) Main loop (pending)
   - Discover opportunities → Risk gate → Execute → Persist state
   - Single-iteration smoke mode for cautious go-live

4) Logging and alerts (pending)
   - Structured execution logs (success/failure)
   - Optional Slack/Discord webhook for alerts

5) Inventory checks and state (pending)
   - Pre-trade on-chain balance checks (GC + SOL)
   - Post-trade updates to `state.json` and simple PnL tallies

6) Validation tests (pending)
   - Live quote parity/diff: `src/test-price-discovery.ts`
   - Risk gate test: `src/test-risk-manager.ts`
   - Single live trade smoke: new `src/test-live-smoke.ts` (to add)

### How to Run Current Live Tests
- Solana live swap (tiny):
  - Env: `SOLANA_RPC_URL`, `SOLANA_PRIVATE_KEY` (base58), optional `TEST_SYMBOL`, `TEST_TRADE_SIZE`
  - Command: `npx ts-node src/test-sol-exec-live.ts`

- GalaChain live swap (tiny):
  - Env: `GALACHAIN_PRIVATE_KEY`, `GALACHAIN_WALLET_ADDRESS`, optional `TEST_GC_SYMBOL`, `TEST_GC_TRADE_SIZE`
  - Command: `npx ts-node src/test-gc-exec-live.ts`

### Environment Expectations
- Notional caps are interpreted in USD by default (no units needed)
- Jupiter API base can be overridden via `JUPITER_API_BASE` (defaults to `https://lite-api.jup.ag/swap/v1`)

### Near-Term Implementation Order (suggested)
1) Dual-Leg live coordinator with deadlines and failure handling
2) Risk and safety wiring from env (including notional caps and pause/window)
3) Main loop single-iteration runner → then interval runner
4) Alerts + inventory pre/post checks
5) Add `test-live-smoke.ts` and finalize docs


