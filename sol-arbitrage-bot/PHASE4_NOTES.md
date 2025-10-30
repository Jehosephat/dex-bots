## Phase 4: Bridging System

This document tracks work completed during Phase 4 (Bridging System) with verification steps for each task.

### 4.1 Bridge Manager (live fee + dry-run params)

Replaced the mocked fee with live fee retrieval from GalaConnect/GalaChain APIs. The Bridge Manager now resolves the correct bridge token descriptor (handles missing 'G' prefix) and fetches the current estimated fee in GALA.

- Added `src/bridging/bridgeManager.ts`
  - `initialize()` logs active RPCs and initializes GalaConnect client
  - `estimateFee()` queries real fee via `/v1/bridge/fee`
  - `buildBridgeOutParams()` assembles dry-run params: symbol, amount, destination, recipient, deadline, fee
- Added `src/bridging/galaConnectClient.ts` (minimal client with `getBridgeConfigurations` and `fetchBridgeFee`)

- Verification
  - Script: `src/test-bridge-manager.ts`
  - Run:
    ```
    npx ts-node src/test-bridge-manager.ts
    ```
  - Expected output (abridged):
    - "BridgeManager initialized" with gala/sol RPC URLs and GalaConnect endpoints
    - "Prepared bridge-out params" including live `feeGala` (> 0), deadline, recipient

Config required:
- `GALACHAIN_WALLET_ADDRESS` (already present)
- `GALA_CONNECT_BASE_URL` (default `https://connect.gala.com`)
- `GALACHAIN_API_BASE_URL` (default `https://dex-api-platform-dex-prod-gala.gala.com`)

Notes:
- This remains a dry-run for parameter building; submission, signing, and status polling will be added next.

---

### 4.2 Bridge Scheduler (time/threshold rules)

Implements decision logic for when to bridge based on a time interval and an inventory USD threshold.

- Added `src/bridging/bridgeScheduler.ts`
  - Consumes `bridging.intervalMinutes` and `bridging.thresholdUsd` from config
  - `decide()` returns `shouldBridge`, reasons, and `nextEligibleAtMs`

- Verification
  - Script: `src/test-bridge-scheduler.ts`
  - Run:
    ```
    npx ts-node src/test-bridge-scheduler.ts
    ```
  - Expected output: two decisions showing (a) low-inventory -> shouldBridge=false; (b) high-inventory with interval elapsed -> shouldBridge=true

---

### 4.3 Inventory Reconciliation

Tracks simple per-symbol balances across GalaChain and Solana in `state.json` and updates them after a simulated bridge.

- Added `src/bridging/inventoryTracker.ts`
  - `load()/save()` snapshot
  - `reconcileAfterBridge()` moves balance from source chain to destination

- Verification
  - Script: `src/test-inventory-reconcile.ts`
  - Run:
    ```
    npx ts-node src/test-inventory-reconcile.ts
    ```
  - Expected output: updated balances where `from` chain decreases and `to` chain increases by the bridged amount

---

### Next Steps (Phase 4 live wiring)

- Replace mocked fee in `BridgeManager.estimateFee()` with real calls via a lightweight GalaConnect client (reuse shapes from `bridge_round_trip`).
- Add status polling and timeout handling (mirroring the RoundTrip runner) once we enable real submissions.
- Connect InventoryTracker to real balance reads when available.


