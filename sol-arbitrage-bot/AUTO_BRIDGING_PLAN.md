# Auto-Bridging Feature Plan

## Overview
Automatically rebalance token inventories across GalaChain and Solana when one chain has >80% of total supply and the other has <20%. The system will bridge tokens to achieve a 50/50 split.

## Example
- Total GALA: 100,000
- GalaChain: 82,000 (82%)
- Solana: 18,000 (18%)
- **Action**: Bridge 32,000 GALA from GalaChain → Solana
- **Result**: 50,000 GALA on each chain (50/50)

---

## Phase 1: Validation & Testing

### 1.1 Validate Existing Bridging Infrastructure
**Goal**: Ensure current bridging system works correctly before automation

**Tasks**:
1. **Test Bridge Execution Flow**
   - Review `test-bridge-roundtrip.ts` to understand full flow
   - Verify `BridgeManager`, `GalaConnectClient`, and `galaSign` integration
   - Test a manual bridge (GalaChain → Solana) for a small amount
   - Verify bridge status polling works correctly
   - Document any issues or missing functionality

2. **Test Bridge Fee Estimation**
   - Verify `BridgeManager.estimateFee()` returns accurate fees
   - Test with multiple tokens (GALA, MEW, USDUC)
   - Verify fee is in GALA and reasonable

3. **Test Bridge Status Tracking**
   - Verify `BridgeManager.getBridgeStatus()` works
   - Test status polling until completion
   - Handle timeout scenarios gracefully

4. **Test Solana → GalaChain Bridge** (if needed)
   - Review `solanaBridge.ts` for Solana → GC bridging
   - Test if reverse direction is needed for rebalancing
   - Document supported directions

**Deliverable**: Validation report with test results and any required fixes

---

## Phase 2: Configuration

### 2.1 Add Auto-Bridging Configuration
**File**: `config/config.json` and `src/config/configSchema.ts`

**New Configuration Section**:
```json
{
  "autoBridging": {
    "enabled": false,
    "imbalanceThresholdPercent": 80,
    "targetSplitPercent": 50,
    "minRebalanceAmount": 100,
    "checkIntervalMinutes": 60,
    "cooldownMinutes": 30,
    "maxBridgesPerDay": 10,
    "enabledTokens": ["GALA", "MEW", "USDUC"],
    "skipTokens": []
  }
}
```

**Configuration Fields**:
- `enabled`: Master switch to enable/disable auto-bridging
- `imbalanceThresholdPercent`: Trigger rebalance when one chain has >X% (default: 80)
- `targetSplitPercent`: Target distribution percentage (default: 50 = 50/50 split)
- `minRebalanceAmount`: Minimum amount to bridge (prevents tiny bridges)
- `checkIntervalMinutes`: How often to check for imbalances
- `cooldownMinutes`: Wait time after a bridge before checking again
- `maxBridgesPerDay`: Rate limit to prevent excessive bridging
- `enabledTokens`: List of tokens to monitor (empty = all enabled tokens)
- `skipTokens`: Tokens to exclude from auto-bridging

**Schema Updates**:
- Add `autoBridgingConfigSchema` to `configSchema.ts`
- Add to `botConfigSchema`
- Update `IConfigService` interface with `getAutoBridgingConfig()`

---

## Phase 3: Balance Monitoring & Imbalance Detection

### 3.1 Create Auto-Bridge Service
**File**: `src/bridging/autoBridgeService.ts`

**Responsibilities**:
1. Monitor token balances across both chains
2. Calculate imbalance percentages
3. Determine if rebalancing is needed
4. Calculate bridge amount
5. Execute bridge operations
6. Track bridge history and rate limits

**Key Methods**:
```typescript
class AutoBridgeService {
  // Check if rebalancing is needed for a token
  async checkImbalance(token: TokenConfig): Promise<ImbalanceResult>
  
  // Calculate required bridge amount to reach target split
  calculateBridgeAmount(
    totalBalance: BigNumber,
    gcBalance: BigNumber,
    solBalance: BigNumber,
    targetPercent: number
  ): BridgeAmount
  
  // Execute bridge operation
  async executeBridge(
    token: TokenConfig,
    amount: BigNumber,
    direction: 'galaChain->solana' | 'solana->galaChain'
  ): Promise<BridgeResult>
  
  // Check rate limits and cooldowns
  canBridge(token: string): boolean
}
```

### 3.2 Imbalance Detection Logic
**Algorithm**:
1. Fetch balances for token on both chains
2. Calculate total: `total = gcBalance + solBalance`
3. Calculate percentages:
   - `gcPercent = (gcBalance / total) * 100`
   - `solPercent = (solBalance / total) * 100`
4. Check imbalance:
   - If `gcPercent > threshold` AND `solPercent < (100 - threshold)` → Bridge GC → SOL
   - If `solPercent > threshold` AND `gcPercent < (100 - threshold)` → Bridge SOL → GC
5. Calculate bridge amount:
   - Target: `targetAmount = total * (targetSplitPercent / 100)`
   - If bridging GC → SOL: `bridgeAmount = gcBalance - targetAmount`
   - If bridging SOL → GC: `bridgeAmount = solBalance - targetAmount`
6. Validate:
   - `bridgeAmount >= minRebalanceAmount`
   - Not in cooldown period
   - Under daily rate limit

---

## Phase 4: Bridge Execution

### 4.1 Extend BridgeManager
**File**: `src/bridging/bridgeManager.ts`

**New Methods**:
```typescript
class BridgeManager {
  // Execute GalaChain → Solana bridge
  async executeBridgeOut(params: {
    symbol: string;
    amount: BigNumber;
    recipient?: string;
  }): Promise<BridgeExecutionResult>
  
  // Poll bridge status until completion
  async waitForBridgeCompletion(
    hash: string,
    timeoutMinutes: number
  ): Promise<BridgeStatus>
}
```

**Implementation Details**:
1. Use existing `buildBridgeOutParams()` to get fee estimate
2. Sign bridge payload using `galaSign.signBridgePayload()`
3. Call `GalaConnectClient.requestBridgeOut()`
4. Call `GalaConnectClient.bridgeTokenOut()`
5. Poll `getBridgeStatus()` until completion (status >= 5)
6. Handle errors and retries

### 4.2 Bridge Execution Flow
**GalaChain → Solana**:
1. Get fee estimate via `BridgeManager.estimateFee()`
2. Build bridge payload with:
   - Token descriptor (from `tokenConfig.galaChainMint`)
   - Amount to bridge
   - Destination: Solana
   - Recipient: `SOLANA_WALLET_ADDRESS`
   - Fee estimate
3. Sign payload using `galaSign.signBridgePayload()`
4. Submit via `GalaConnectClient.requestBridgeOut()`
5. Execute via `GalaConnectClient.bridgeTokenOut()`
6. Poll status until completion

**Solana → GalaChain** (if needed):
- Use `bridgeOutNativeSol()` from `solanaBridge.ts` for SOL
- For SPL tokens, may need additional implementation
- Document supported tokens for reverse direction

---

## Phase 5: Integration & State Management

### 5.1 Integrate with Main Loop
**File**: `src/mainLoop.ts`

**Integration Points**:
1. **Initialization**: Create `AutoBridgeService` instance
2. **Periodic Checks**: Run imbalance check at configured interval
3. **After Trade Execution**: Optionally check for imbalances after trades
4. **Error Handling**: Log bridge failures, don't crash main loop

**Flow**:
```typescript
// In main loop, after balance check
if (autoBridgingConfig.enabled) {
  const imbalanceCheck = await autoBridgeService.checkAllTokens();
  if (imbalanceCheck.needsRebalancing) {
    await autoBridgeService.rebalance(imbalanceCheck.token, imbalanceCheck.amount);
  }
}
```

### 5.2 State Tracking
**File**: `src/bridging/bridgeStateTracker.ts` (new)

**Track**:
- Last bridge time per token
- Daily bridge count
- Pending bridges (hash → status)
- Bridge history

**Storage**: Use `state.json` or separate `bridge-state.json`

**Methods**:
```typescript
class BridgeStateTracker {
  recordBridge(token: string, amount: BigNumber, direction: string, hash: string): void
  getLastBridgeTime(token: string): number | null
  getBridgesToday(): number
  isInCooldown(token: string, cooldownMinutes: number): boolean
  updateBridgeStatus(hash: string, status: BridgeStatus): void
}
```

### 5.3 Update Inventory Tracker
**File**: `src/bridging/inventoryTracker.ts`

**Enhancement**: After successful bridge, update inventory snapshot
- Call `reconcileAfterBridge()` with bridge details
- Ensure balances are updated immediately (optimistic update)
- Reconcile with actual balances on next check

---

## Phase 6: Logging & Monitoring

### 6.1 Enhanced Logging
**Log Events**:
- Imbalance detected: `🔍 Imbalance detected: GALA - GC: 82%, SOL: 18%`
- Bridge initiated: `🌉 Initiating bridge: 32,000 GALA from GalaChain → Solana`
- Bridge in progress: `⏳ Bridge pending: hash=xxx, status=pending`
- Bridge completed: `✅ Bridge completed: 32,000 GALA bridged successfully`
- Bridge failed: `❌ Bridge failed: reason`

### 6.2 Metrics Tracking
**Track**:
- Number of bridges executed
- Total amount bridged per token
- Average bridge time
- Success/failure rate
- Cost in GALA fees

### 6.3 Alerts
**Send alerts for**:
- Bridge failures
- Repeated failures for same token
- Rate limit reached
- Unexpected bridge amounts

---

## Phase 7: Safety & Validation

### 7.1 Pre-Bridge Validation
**Checks**:
1. **Balance Verification**: Ensure sufficient balance on source chain
2. **Minimum Amount**: Bridge amount >= `minRebalanceAmount`
3. **Cooldown**: Not in cooldown period
4. **Rate Limit**: Under `maxBridgesPerDay`
5. **Token Enabled**: Token in `enabledTokens` list (if specified)
6. **Token Not Skipped**: Token not in `skipTokens` list
7. **Fee Check**: Ensure sufficient GALA for bridge fees

### 7.2 Dry-Run Mode
**Support dry-run**:
- Calculate bridge amounts without executing
- Log what would be bridged
- Useful for testing and validation

### 7.3 Error Recovery
**Handle**:
- Bridge submission failures → Retry with exponential backoff
- Status polling timeouts → Mark as pending, check later
- Insufficient balance → Skip and log warning
- Network errors → Retry or skip

---

## Phase 8: Testing

### 8.1 Unit Tests
**Test**:
- Imbalance detection logic
- Bridge amount calculation
- Rate limiting
- Cooldown logic
- State tracking

### 8.2 Integration Tests
**Test**:
- Full bridge execution flow
- Status polling
- Inventory reconciliation
- Error scenarios

### 8.3 Manual Testing
**Test Scenarios**:
1. Create artificial imbalance (manual transfer)
2. Enable auto-bridging
3. Verify bridge is triggered
4. Verify bridge completes
5. Verify balances are rebalanced
6. Test with multiple tokens
7. Test rate limiting
8. Test cooldown periods

---

## Implementation Order

1. **Phase 1**: Validate existing bridging (CRITICAL - do this first)
2. **Phase 2**: Add configuration schema
3. **Phase 3**: Create `AutoBridgeService` with imbalance detection
4. **Phase 4**: Extend `BridgeManager` with execution methods
5. **Phase 5**: Integrate with main loop and state management
6. **Phase 6**: Add logging and monitoring
7. **Phase 7**: Add safety validations
8. **Phase 8**: Testing

---

## Dependencies

**Existing Components**:
- `BridgeManager` - Fee estimation, parameter building
- `GalaConnectClient` - API communication
- `galaSign` - Payload signing
- `InventoryTracker` - Balance tracking
- `BalanceChecker` - Balance fetching
- `ConfigManager` - Configuration access

**New Components**:
- `AutoBridgeService` - Main orchestration
- `BridgeStateTracker` - State management
- Enhanced `BridgeManager` - Execution methods

**Environment Variables**:
- `GALACHAIN_WALLET_ADDRESS` (required)
- `BRIDGE_PRIVATE_KEY` (required for signing)
- `SOLANA_WALLET_ADDRESS` (required for recipient)
- `GALA_CONNECT_BASE_URL` (optional, has default)
- `GALACHAIN_API_BASE_URL` (optional, has default)

---

## Configuration Example

```json
{
  "autoBridging": {
    "enabled": true,
    "imbalanceThresholdPercent": 80,
    "targetSplitPercent": 50,
    "minRebalanceAmount": 100,
    "checkIntervalMinutes": 60,
    "cooldownMinutes": 30,
    "maxBridgesPerDay": 10,
    "enabledTokens": ["GALA", "MEW", "USDUC"],
    "skipTokens": []
  }
}
```

---

## Notes

1. **Bridge Direction**: Currently, GalaChain → Solana is well-supported. Solana → GalaChain may need additional work for SPL tokens (SOL bridging exists).

2. **Bridge Fees**: All bridges cost GALA. Ensure sufficient GALA balance before initiating bridges.

3. **Bridge Time**: Bridges can take several minutes. Use async status polling, don't block main loop.

4. **Inventory Reconciliation**: After bridge, update inventory tracker optimistically, then reconcile with actual balances.

5. **Rate Limiting**: Implement per-token and global rate limits to prevent excessive bridging.

6. **Error Handling**: Bridges can fail. Implement retry logic and graceful degradation.

