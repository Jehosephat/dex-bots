# PRD — “Arb-MVP”: Absolute Minimum Cross-Chain Arbitrage Bot (SOL → GalaChain)

## 1) One-line Summary

A minimal, reliable service that detects a single clear price discrepancy, **sells on GalaChain (GC)**, **buys on Solana (SOL)**, and **periodically bridges** the bought token from SOL → GC, so profits and inventory accumulate on GC in **GALA**.

---

## 2) Goals & Non-Goals

**Goals (MVP)**

* Capture only the **safest, largest** obvious edges (no scaling, no fancy routing).
* Run in **inventory mode**: paired GC sell + SOL buy executed near-simultaneously.
* End each completed cycle with **more GALA** on GC and/or more GC inventory of the traded token.
* Be robust to common failures (stale quotes, slippage breaches, bridge hiccups).
* Provide clear, minimal telemetry: PnL (in GALA), trades taken/skipped, inventory levels, bridge status.

**Non-Goals**

* No derivatives/hedging, no TWAP/VWAP slicing, no MEV optimization.
* No auto-LP recycling (can be added later).
* No multi-token batching in a single decision; evaluate tokens independently.
* No support for >2 hops per side.

---

## 3) Scope & Assumptions

**In-scope tokens (initial)**

* Bridgeable: **FARTCOIN, TRUMP, SOL, GALA** (PENGU/WBNB optional later).
* Tradable on GC now:

  * FARTCOIN/{GALA, USDC, WEN}
  * TRUMP/GALA
  * SOL/{GALA, WBTC}

**Settlement**: **GALA** (PnL denominated and reported in GALA).

**Costs (planning inputs)**

* Bridge fee per transfer (amortized): ~**$1.25** (batched later).
* GC swap overhead: **1 GALA per hop** (+ LP fee tier 0.05/0.3/1% embedded in pool price).
* SOL side: DEX swap fees & priority fees (treated as part of the SOL quote).

**Operating mode**

* **Inventory mode** only (no hedges).
* **Event-driven** where possible; otherwise short-interval polling acceptable for MVP.

---

## 4) Primary User Stories

1. **As an operator**, I want the bot to **only trade when the edge is clearly positive** after all costs, so it doesn’t churn or bleed.
2. **As an operator**, I want the bot to **sell on GC and buy on SOL within the same decision window**, so exposure is minimized.
3. **As an operator**, I want the bot to **bridge bought tokens from SOL to GC** on a simple schedule/threshold, so GC inventory is replenished.
4. **As an operator**, I want a **simple dashboard/log** showing PnL in GALA, inventory by chain/token, and last bridge status.

---

## 5) Core Concepts

* **Net Edge (in GALA):**
  (Proceeds from **GC sell**) − (Cost of **SOL buy**, converted to GALA) − (Amortized bridge cost) − (Small risk buffer).
  Trade only if Net Edge ≥ **edge threshold** (e.g., 30–50 bps for MVP).
* **Size-aware:** Evaluate a **tiny fixed size** per token (e.g., a single “small” notional chosen once per token) to keep price impact minimal.
* **Batch bridging:** Bridge when SOL-side inventory of a token exceeds a **simple threshold** or **every N minutes**.

---

## 6) System Roles (Minimal)

* **Quoter:** Computes size-aware executable prices on both chains for the chosen size.
* **Decider:** Computes net edge; applies guardrails; authorizes trade or skip.
* **Executor:** Fires GC sell and SOL buy with slippage/deadline guards; handles partial/fail logic.
* **Bridger:** Periodically sends accumulated token from SOL → GC; reconciles on arrival.
* **Bookkeeper:** Tracks inventories, realized PnL in GALA, and simple metrics/alerts.

---

## 7) End-to-End Flow (Happy Path)

1. **Discover opportunity**

   * For each enabled token (e.g., FARTCOIN, TRUMP, SOL) at **one fixed trade size**:

     * Estimate **GC proceeds** for selling `Token → GALA` (include GC 1-GALA hop fee and pool fee).
     * Estimate **SOL cost** to buy `Token` (size-aware; includes SOL venue fees/priority).
     * Convert SOL leg **cost to GALA** using current GC cross-rate(s).
     * Add **amortized bridge cost** for that token/size.
     * Subtract a **small fixed risk buffer** (MVP constant) for non-atomicity noise.
     * Compute **Net Edge** (in GALA).
2. **Pre-trade checks**

   * Inventory present on both chains for required legs (GC has token to sell, SOL has quote to buy).
   * **Price-impact sanity**: projected impact below a fixed cap (e.g., ≤ 50 bps).
   * Quotes fresh; system not paused; per-asset cooldown not active.
3. **Execute paired trade**

   * **Primary:** Sell `Token → GALA` on GC with tight slippage + short deadline.
   * **Secondary (concurrent):** Buy `Token` on SOL with similar protections.
   * If either leg fails pre-fill → cancel the other; if partial → proportionally adjust counterpart leg.
4. **Record & cool down**

   * Record realized proceeds/costs; update inventories; log Net Edge realized; start brief cooldown for this token.
5. **Bridge (periodic/threshold)**

   * When SOL has accumulated `Token` beyond threshold **or** N minutes passed:

     * Bridge `Token` SOL → GC.
     * On arrival, increase GC `Token` inventory; mark batch as settled.

---

## 8) Guardrails (MVP)

* **Minimum Net Edge (post-costs):** fixed threshold (e.g., 30–50 bps).
* **Max price impact per leg:** fixed cap (e.g., 50 bps).
* **Fixed small risk buffer:** constant deduction (e.g., 5–10 bps) instead of VaR modeling.
* **Deadlines:** short expiry on both legs; no retry storms (at most one retry per leg).
* **Cooldowns:** brief per-token cooldown after any attempt (filled or skipped due to breach).
* **Pause conditions:** manual toggle; auto-pause if 2 consecutive bridge attempts for a token exceed a delay threshold or 2 consecutive slippage breaches occur.

---

## 9) Minimal Configuration (Conceptual, not technical)

* **Enabled tokens:** {FARTCOIN, TRUMP, SOL}.
* **Trade size per token:** one small constant amount per token (chosen by operator).
* **Edge threshold:** single value (bps).
* **Impact cap:** single value (bps).
* **Risk buffer:** single value (bps).
* **Bridge policy:** threshold per token **or** time-based (e.g., every 30 minutes), whichever happens first.
* **Inventory floors:** simple minimum balances per chain/token (to avoid stalls).

---

## 10) Telemetry & Reporting (Minimal)

* **Per trade:** token, side sizes, projected edge vs. realized, slippage, result (filled/partial/failed), reason if skipped.
* **Inventory:** GC and SOL balances by token; next bridge ETA/trigger condition.
* **PnL:** cumulative and daily PnL in **GALA**, plus per-token contribution.
* **Alerts:** slippage breach, deadline expiry, bridge delay/fail, inventory below floor, data freshness issue.
* **Daily summary:** trades taken/skipped with reasons, PnL, bridge counts, notable incidents.

---

## 11) Acceptance Criteria (MVP “done”)

1. The bot evaluates **each enabled token** at a **single fixed size** and computes Net Edge in GALA including GC fee, SOL fee estimate, bridge amortization, and risk buffer.
2. It executes **paired legs** (GC sell + SOL buy) only when all guardrails pass; otherwise **skips** with an explicit reason.
3. It **bridges** accumulated tokens from SOL → GC on a simple **time/threshold** rule and reflects arrivals in inventory.
4. It maintains a **running PnL in GALA**, shows **current inventories**, and emits alerts for the listed events.
5. It supports **manual pause/resume** and enforces **per-token cooldowns** after attempts.

---

## 12) Out-of-Scope (Explicit)

* Multi-size optimization, dynamic sizing, or multi-route blending.
* Per-asset VaR/vol modeling or adaptive risk buffers.
* MEV-aware routing, private relays, or complex transaction packing.
* Auto-rebalancing from GC → SOL (except minimal operator-initiated top-ups for fees).

---

## 13) Operational Runbook (MVP)

1. **Enable tokens** and set a **small fixed size** per token (operator choice).
2. Set **edge threshold**, **impact cap**, **risk buffer**, **bridge rule** (time/threshold), and **inventory floors**.
3. Start bot; ensure inventories exist on both chains (token on GC to sell; quote on SOL to buy; GALA on GC for fees).
4. Monitor: PnL (GALA), recent trades and reasons, inventory by chain, last bridge status.
5. If alerts trigger (slippage/bridge), **pause**, investigate, and resume when conditions normalize.

---

## 14) Risks & Mitigations (MVP level)

* **Quote vs. fill drift:** strict slippage + short deadlines; skip on breach.
* **Bridge delays:** simple auto-pause for affected token after repeated delays; operator review.
* **Inventory starvation:** set floors and notify when below; operator tops up.
* **Rogue routes/illiquid paths:** prefer direct pairs on GC; on SOL, restrict to stable, deep venues (policy decision, not technical here).

---

**Outcome:** A lean, dependable arbitrage bot that only takes the clearest wins, keeps logic simple, and steadily moves value into GalaChain—creating a solid foundation for later sophistication (dynamic sizing, VaR, LP recycling, MEV hygiene) without compromising early reliability.
