### SOL BOT

# PRD: Inventory-Mode Cross-Chain Arbitrage (Solana → GalaChain)

## 1) Summary

Build a service that continuously detects and executes low-risk arbitrage opportunities that **sell on GalaChain (GC)** and **buy on Solana (SOL)**, then **batch-bridges purchased inventory from SOL to GC** so that **profits and inventory accumulate on GC**. Settlement and PnL are expressed in **GALA**.

---

## 2) Goals & Non-Goals

**Goals**

* Capture cross-chain price discrepancies for a defined token set available on both chains.
* End each trade cycle with increased GALA on GC and/or increased GC-side inventory of the traded token.
* Keep bridge-latency risk minimal via **inventory mode** (GC sell + SOL buy in near-lockstep).
* Provide clear guardrails (slippage, price-impact, bridge health) and automated pause conditions.
* Offer transparent telemetry in GALA terms.

**Non-Goals (MVP)**

* No hedged mode (perps/derivatives) or cross-venue netting.
* No automated LP recycling (may be added later).

---

## 3) Users & Success Metrics

**Primary user:** Operator seeking to “pull value into GC” while maintaining low operational risk.

**Success metrics**

* Arbitrage PnL (in GALA) per day/week; win rate; average realized edge (bps).
* Share of time system is “available” (not paused) given risk constraints.
* Inventory drift toward GC over time (positive net movement of traded tokens and GALA).
* Low incident rate (failed legs, slippage breaches, bridge delays).

---

## 4) Key Concepts & Definitions

* **Inventory mode:** Maintain working balances on both chains so the destination leg (GC sell) and source leg (SOL buy) can be executed nearly simultaneously; bridge later in batches to refill GC.
* **Settlement asset:** GALA on GC (PnL and decisioning denominated in GALA).
* **Net edge:** Destination proceeds (in GALA) minus source acquisition cost (converted to GALA), minus estimated bridge amortization and latency/risk buffer.
* **Risk buffer:** A conservative deduction that accounts for non-atomicity, bridge ETA variance, and short-term volatility.

---

## 5) Scope

**In-scope**

* Tokens that are bridgeable between SOL and GC **and** tradable on both chains (directly or via reasonable routing) with adequate liquidity.
* Pairs on GC where the token can be sold to GALA in one or two hops.

**Out-of-scope (MVP)**

* Tokens that exist only as incompatible wraps, unsupported mints, or with insufficient liquidity.
* More than two hops on either chain.

---

## 6) End-to-End Process Overview

1. **Discovery & Opportunity Modeling**
   Continuously evaluate candidate tokens and trade sizes to estimate **net edge in GALA** for executing **GC sell** and **SOL buy**, accounting for expected slippage, all swap fees, bridge amortization, and a risk buffer.

2. **Pre-Trade Validation**
   Before firing, confirm: inventory buffers on both chains, projected price impact within limits, fresh quotes, bridge health normal, and per-asset throttles/caps available.

3. **Execution (Dual-Leg Fill)**

   * **Primary (destination) leg:** Execute **sell on GC** (token → GALA).
   * **Secondary (source) leg:** Execute **buy on SOL** (quote asset → token) in near-lockstep.
   * Apply strict slippage/deadline guards on both.

4. **Post-Trade Accounting**
   Record realized proceeds and costs in GALA terms, update inventories on both chains, apply cooldowns per asset/route.

5. **Batch Bridge (SOL → GC)**
   Periodically (threshold/time-based), bridge accumulated purchased tokens from SOL to GC to **refill GC token inventory**. On arrival, reconcile balances and mark inventory available for future cycles.

6. **Rebalancing & Drift Control**
   Maintain minimum/target balances per token on both chains. Prefer **net movement into GC** over time. If SOL-side balances grow beyond thresholds, schedule additional bridges; if GC lacks quote/fee balances, schedule replenishment from SOL.

7. **Monitoring & Safeguards**
   Emit metrics and alerts (PnL, edges, slippage, bridge delays). Apply circuit breakers on repeated anomalies. Allow one-click global pause/resume.

---

## 7) Detailed Flows

### 7.1 Discovery & Opportunity Modeling

* **Inputs (conceptual):**
  Latest destination prices/curves for selling token→GALA on GC; source prices/curves for buying the token on SOL; fee models; bridge ETA characteristics; recent token volatility vs GALA.
* **Per token, per size:**

  1. Estimate GALA proceeds for selling the token on GC at that size (with projected price impact and fees).
  2. Estimate source-chain cost to acquire that token on SOL at that size (with projected price impact and fees).
  3. Convert source cost to GALA terms (using current cross-marks on GC).
  4. Add **bridge amortization** (allocate expected per-unit bridge cost across batch sizing).
  5. Add **risk buffer** for non-atomicity and ETA variance.
  6. Compute **net edge (in GALA)**; compare to minimum threshold.
* **Trigger condition:** Net edge ≥ threshold and all risk constraints satisfied.

### 7.2 Pre-Trade Validation

* **Inventory checks:** Ensure sufficient GC token inventory to sell *or* acceptable alternative (e.g., using freshly bridged arrivals); ensure SOL quote/fee balances sufficient to buy.
* **Liquidity/impact checks:** Projected price impact on **each leg** must be within bounds.
* **Freshness checks:** Quotes based on current reserves; reject stale views.
* **Operational checks:** No active pause; per-asset concurrency/cooldown rules respected; bridge status normal.

### 7.3 Execution (Dual-Leg)

* **Sequence intention:**
  Execute GC sell first to secure the destination premium, with SOL buy launched essentially concurrently (within the same decision window).
* **Guards:**
  Per-leg slippage tolerance and a short time-to-fill deadline. If either leg hard-fails pre-fill, cancel the other. If partial fills occur, scale the counterpart leg accordingly (never leave material unhedged exposure).
* **Result:**

  * GC increases GALA (proceeds) and decreases token inventory.
  * SOL increases token inventory and decreases quote/fee balances.

### 7.4 Post-Trade Accounting & Cooldowns

* Convert realized trade legs into **GALA PnL**; store per asset and aggregate.
* Update on-chain inventories in the internal ledger.
* Apply per-asset cooldowns to avoid immediate re-entry on the same route, unless a significantly larger edge appears.

### 7.5 Batch Bridge (SOL → GC)

* **Triggers:** Time-based (e.g., every N minutes) **or** threshold-based (per-token SOL balances ≥ target).
* **Action:** Initiate bridge of the token(s) from SOL to GC.
* **On arrival:** Credit GC token inventory; reconcile any in-flight accounting; mark tokens trade-ready.
* **Exception handling:** If bridge ETA exceeds expected thresholds or multiple consecutive batches delay/fail, raise alerts and optionally pause new opportunities for the affected token(s).

### 7.6 Rebalancing Policy

* **Targets:** Maintain minimum working balances for each token and GALA on **both** chains to support continuous operation.
* **Directionality:** Favor drift toward GC by default (bridge SOL→GC more frequently than the reverse).
* **Backfill:** If GC lacks fee/quote balances needed for operations, schedule minimal reverse movement from GC→SOL strictly to restore operability (not as a profit strategy).

---

## 8) Guardrails & Risk Controls

* **Price impact limits:** Reject any leg whose projected impact exceeds a defined threshold.
* **Minimum edge:** Only execute if net edge (after all costs/buffers) exceeds threshold.
* **Bridge health:** Pause for a token if bridge delays or failures exceed tolerance.
* **Concurrency & exposure caps:** Limit simultaneous trades and daily notional per token.
* **Deadlines & idempotency:** All orders have near-term expiry; execution is idempotent with safe retries.
* **MEV/ordering hygiene:** Use transaction submission practices that minimize adverse selection (implementation-specific; principle required).
* **Kill switch:** Global and per-asset emergency stop.

---

## 9) Telemetry, Reporting, and Alerts

**Real-time dashboards**

* PnL (in GALA): total, per token, rolling windows.
* Opportunity edges vs realized slippage.
* Trade counts, win rate, average edge (bps), average impact (bps).
* Inventory by chain/token; pending bridges and ETA distributions.

**Alerts**

* Slippage/impact breach, deadline expiry, partial fill without matching counterpart leg.
* Bridge ETA beyond expected percentiles; bridge failures.
* Inventory below minimum working levels.
* Data freshness/RPC failure rates exceeding thresholds.

**Reports**

* Daily summary of PnL, edges captured/ignored (and reasons), inventory movements, incident log.

---

## 10) Operational Considerations

* **Token/mint hygiene:** Only trade tokens with verified mints/wrappings accepted by GC pools and supported by the bridge route.
* **Precision/decimals:** Enforce correct scaling; avoid dust/rounding losses.
* **Time windows:** Prefer execution during periods with stable fees and adequate liquidity.
* **Access & permissions:** Ensure accounts on both chains are funded for fees and authorized for bridge actions.

---

## 11) MVP Scope & Acceptance Criteria

**MVP delivers when:**

1. The system continuously computes net edges (in GALA) for the supported token set and discrete size grid.
2. It executes **paired trades** (GC sell + SOL buy) only when all guardrails pass, with correct handling of timeouts and partial fills.
3. It performs **batch bridges SOL→GC** on schedule/threshold, reconciles arrivals, and keeps inventory sufficient for continued operation.
4. It maintains **PnL accounting in GALA**, per-asset statistics, and exposes a minimal dashboard with alerts for breaches and delays.
5. It supports **global/per-asset pause**, cooldowns, and notional caps.

---

## 12) Future Enhancements (post-MVP)

* **LP recycling policy:** Allocate a fraction of realized GALA PnL to seed/augment GC liquidity in target pools.
* **Dynamic sizing:** Adaptive trade sizing based on recent fills, realized volatility, and queue depth.
* **Hedged mode:** Optional temporary hedges on the source chain to reduce residual exposure during abnormal bridge conditions.
* **TWAP/VWAP execution:** For larger sizes to minimize impact.
* **Multi-bridge routing:** Intelligent selection among multiple bridges based on ETA/fees/reliability.

---

## 13) Glossary

* **Edge (net):** Expected profit after slippage, fees, bridge amortization, and risk buffer, denominated in GALA.
* **Inventory mode:** Dual-leg spot trades with batch bridging to realign inventory, not relying on derivatives.
* **Risk buffer:** Deduction covering latency/volatility/operational uncertainties between non-atomic legs.
* **Price impact:** Projected adverse move from consuming liquidity at the planned size.

---

**Outcome:** A clear, implementation-agnostic process that repeatedly sells at GC, buys at SOL, bridges inventory to GC, and accounts/controls risks so that value accrues on GalaChain in GALA over time.
