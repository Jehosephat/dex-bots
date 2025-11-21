# Bridging Module

## Overview

The bridging module provides comprehensive functionality for bridging tokens between GalaChain and Solana. It includes automated rebalancing, manual bridge execution, state tracking, and low-level bridge operations.

## Architecture

The bridging module is organized into several layers:

1. **High-Level Services**: `AutoBridgeService`, `BridgeManager`
2. **State Management**: `BridgeStateTracker`
3. **API Clients**: `GalaConnectClient`
4. **Low-Level Operations**: `solanaBridge.ts` functions
5. **Utilities**: `galaEndpoints`, `galaSign`, `galaConnectSign`, `inventoryTracker`, `bridgeScheduler`

---

## Core Components

### AutoBridgeService

**Purpose**: Automatically detects and rebalances token inventory imbalances across chains.

**Key Features**:
- Detects when one chain has >80% of total supply (configurable threshold)
- Calculates bridge amounts to achieve 50/50 split (configurable target)
- Respects daily rate limits (no cooldowns - bridging should happen to prevent further imbalance)
- Supports both GalaChain→Solana and Solana→GalaChain directions

**Public API**:

```typescript
class AutoBridgeService {
  // Check if a specific token needs rebalancing
  async checkImbalance(
    token: TokenConfig,
    balances?: { gcBalance: BigNumber; solBalance: BigNumber }
  ): Promise<ImbalanceResult>

  // Check all enabled tokens for imbalances
  async checkAllTokens(
    balanceCheckResult?: BalanceCheckResult
  ): Promise<{
    needsRebalancing: boolean;
    recommendations: ImbalanceResult[];
  }>

  // Execute rebalancing for a detected imbalance
  async rebalance(imbalance: ImbalanceResult): Promise<BridgeResult>

  // Check if bridging is allowed (rate limits only)
  canBridge(token: string): boolean
}
```

**Usage Example**:

```typescript
import { AutoBridgeService } from './bridging/autoBridgeService';
import { BridgeManager } from './bridging/bridgeManager';
import { BridgeStateTracker } from './bridging/bridgeStateTracker';
import { BalanceChecker } from '../core/balanceChecker';

// Initialize dependencies
const bridgeManager = new BridgeManager(configService);
await bridgeManager.initialize();
const bridgeStateTracker = new BridgeStateTracker();
const autoBridgeService = new AutoBridgeService(
  configService,
  balanceChecker,
  bridgeManager,
  bridgeStateTracker,
  gcPriceProvider,
  solPriceProvider
);

// Check for imbalances
const result = await autoBridgeService.checkAllTokens(balanceCheckResult);
if (result.needsRebalancing) {
  for (const imbalance of result.recommendations) {
    await autoBridgeService.rebalance(imbalance);
  }
}
```

**Configuration** (in `config.json`):

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

### BridgeManager

**Purpose**: High-level bridge execution manager. Handles fee estimation, DTO construction, signing, and execution for both directions.

**Key Features**:
- GalaChain → Solana bridging (using DEX API)
- Solana → GalaChain bridging (native SOL and SPL tokens)
- Fee estimation
- Status polling for GC→SOL bridges
- Automatic token descriptor resolution

**Public API**:

```typescript
class BridgeManager {
  // Initialize the bridge manager (must be called first)
  async initialize(): Promise<void>

  // Estimate bridge fee
  async estimateFee(
    symbol: string,
    destination: 'Solana'
  ): Promise<BridgeFeeEstimate>

  // Execute bridge from GalaChain to Solana
  async executeBridgeOut(params: {
    symbol: string;
    amount: number | string | BigNumber;
    recipient?: string;
    destination: 'Solana';
  }): Promise<BridgeExecutionResult>

  // Execute bridge from Solana to GalaChain
  async executeBridgeIn(params: {
    symbol: string;
    amount: number | string | BigNumber;
    recipient?: string;
  }): Promise<BridgeExecutionResult>

  // Poll bridge status until completion
  async waitForBridgeCompletion(
    hash: string,
    timeoutMinutes?: number
  ): Promise<{ status: number; statusDescription: string } | null>

  // Get current bridge status
  async getBridgeStatus(hash: string): Promise<unknown>
}
```

**Usage Example**:

```typescript
import { BridgeManager } from './bridging/bridgeManager';

const bridgeManager = new BridgeManager(configService);
await bridgeManager.initialize();

// Bridge GALA from GalaChain to Solana
const result = await bridgeManager.executeBridgeOut({
  symbol: 'GALA',
  amount: 1000,
  recipient: 'SOLANA_WALLET_ADDRESS',
  destination: 'Solana'
});

if (result.success && result.transactionHash) {
  // Poll for completion
  const status = await bridgeManager.waitForBridgeCompletion(
    result.transactionHash,
    30 // timeout in minutes
  );
}
```

**Environment Variables Required**:
- `GALACHAIN_WALLET_ADDRESS` - GalaChain wallet address
- `BRIDGE_PRIVATE_KEY` - Ethereum-compatible private key (hex, 64 chars)
- `SOLANA_WALLET_ADDRESS` - Solana wallet address (for GC→SOL)
- `SOLANA_PRIVATE_KEY` - Base58 encoded Solana private key (for SOL→GC)
- `GC_SOL_BRIDGE_PROGRAM` - Gala Solana Bridge Program ID (for SOL→GC)

---

### BridgeStateTracker

**Purpose**: Tracks bridge history, daily counts, and rate limiting state.

**Key Features**:
- Records all bridge operations
- Tracks daily bridge counts per token
- Manages bridge status updates
- Persists state to `bridge-state.json`

**Public API**:

```typescript
class BridgeStateTracker {
  // Record a bridge operation
  recordBridge(
    token: string,
    amount: BigNumber,
    direction: 'galaChain->solana' | 'solana->galaChain',
    hash: string
  ): void

  // Update bridge status
  updateBridgeStatus(
    hash: string,
    status: 'pending' | 'completed' | 'failed'
  ): void

  // Get last bridge time for a token
  getLastBridgeTime(token: string): number | null

  // Get daily bridge count for a token
  getBridgesToday(token: string): number

  // Check if token has exceeded daily limit
  hasExceededDailyLimit(token: string, maxBridgesPerDay: number): boolean

  // Get bridge history for a token
  getBridgeHistory(token: string, limit?: number): BridgeRecord[]
}
```

**Usage Example**:

```typescript
import { BridgeStateTracker } from './bridging/bridgeStateTracker';

const tracker = new BridgeStateTracker();

// Record a bridge
tracker.recordBridge('GALA', new BigNumber(1000), 'galaChain->solana', 'tx_hash_123');

// Check rate limits
if (tracker.hasExceededDailyLimit('GALA', 10)) {
  console.log('Daily limit reached');
}

// Get history
const history = tracker.getBridgeHistory('GALA', 5);
```

---

### GalaConnectClient

**Purpose**: Low-level HTTP client for GalaChain bridge APIs.

**Key Features**:
- Fetches bridge fees
- Requests and executes bridge operations
- Gets bridge status
- Fetches bridge configurations
- Handles response format variations

**Public API**:

```typescript
class GalaConnectClient {
  // Fetch bridge fee estimate
  async fetchBridgeFee(params: {
    chainId: string;
    bridgeToken: BridgeTokenDescriptor;
  }): Promise<OracleBridgeFeeAssertionDto>

  // Request bridge out (step 1 of GC→SOL)
  async requestBridgeOut(payload: Record<string, unknown>): Promise<unknown>

  // Execute bridge out (step 2 of GC→SOL)
  async bridgeTokenOut(payload: Record<string, unknown>): Promise<unknown>

  // Get bridge status
  async getBridgeStatus(hash: string): Promise<unknown>

  // Get bridge configurations
  async getBridgeConfigurations(searchPrefix: string): Promise<BridgeConfigurationToken[]>

  // Fetch balances
  async fetchBalances(): Promise<unknown>
}
```

**Usage Example**:

```typescript
import { GalaConnectClient } from './bridging/galaConnectClient';

const client = new GalaConnectClient(
  'https://connect.gala.com',
  'https://dex-api-platform-dex-prod-gala.gala.com',
  'GALACHAIN_WALLET_ADDRESS'
);

// Get bridge fee
const fee = await client.fetchBridgeFee({
  chainId: 'Solana',
  bridgeToken: {
    collection: 'GALA',
    category: 'Unit',
    type: 'none',
    additionalKey: 'none'
  }
});
```

---

### solanaBridge.ts

**Purpose**: Low-level Solana bridge functions for bridging from Solana to GalaChain.

**Key Features**:
- Native SOL bridging
- SPL token bridging
- Direct Solana program interaction
- Transaction construction and signing

**Public Functions**:

```typescript
// Bridge native SOL from Solana to GalaChain
async function bridgeOutNativeSol(params: {
  rpcUrl: string;
  solanaPrivateKeyBase58: string;
  galaBridgeProgramId: string;
  galaWalletIdentity: string;
  amountSol: number;
}): Promise<{ signature: string }>

// Bridge SPL token from Solana to GalaChain
async function bridgeOutSplToken(params: {
  rpcUrl: string;
  solanaPrivateKeyBase58: string;
  galaBridgeProgramId: string;
  galaWalletIdentity: string;
  tokenMintAddress: string;
  amountBaseUnits: bigint;
  tokenDescriptor: BridgeTokenDescriptor;
}): Promise<{ signature: string }>
```

**Usage Example**:

```typescript
import { bridgeOutNativeSol, bridgeOutSplToken } from './bridging/solanaBridge';

// Bridge native SOL
const result = await bridgeOutNativeSol({
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  solanaPrivateKeyBase58: 'base58_encoded_key',
  galaBridgeProgramId: 'GC_SOL_BRIDGE_PROGRAM_ID',
  galaWalletIdentity: 'GALACHAIN_WALLET_ADDRESS',
  amountSol: 0.1
});

// Bridge SPL token (e.g., MEW)
const tokenResult = await bridgeOutSplToken({
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  solanaPrivateKeyBase58: 'base58_encoded_key',
  galaBridgeProgramId: 'GC_SOL_BRIDGE_PROGRAM_ID',
  galaWalletIdentity: 'GALACHAIN_WALLET_ADDRESS',
  tokenMintAddress: 'MEW_MINT_ADDRESS',
  amountBaseUnits: BigInt(1500 * 10**5), // 1500 MEW in base units
  tokenDescriptor: {
    collection: 'GMEW',
    category: 'Unit',
    type: 'none',
    additionalKey: 'none'
  }
});
```

---

## Supporting Components

### galaEndpoints.ts

**Purpose**: Centralized endpoint configuration and resolution.

**Public API**:

```typescript
export function resolveGalaEndpoints(): GalaEndpointsConfig
```

**Usage**: Used internally by other bridging components. Can be used to override endpoints via environment variables.

---

### galaSign.ts / galaConnectSign.ts

**Purpose**: Utilities for signing bridge payloads using EIP-712 typed data.

**Note**: Currently, the module uses `@gala-chain/api` DTOs with built-in `.sign()` methods, so these utilities are legacy/unused.

---

### inventoryTracker.ts

**Purpose**: Tracks token inventory across chains.

**Public API**:

```typescript
class InventoryTracker {
  getSnapshot(): InventorySnapshot
  updateSnapshot(snapshot: InventorySnapshot): void
}
```

---

### bridgeScheduler.ts

**Purpose**: Schedules bridge operations based on trading activity.

**Public API**:

```typescript
class BridgeScheduler {
  shouldBridge(params: {
    tokenSymbol: string;
    tradesSinceLastBridge: number;
    timeSinceLastBridge: number;
  }): BridgeDecision
}
```

---

## Integration with Other Modules

### With Main Loop

Auto-bridging is integrated into the main loop:

```typescript
// In mainLoop.ts
if (autoBridgeService) {
  const lastBalanceCheck = balanceChecker.getLastBalanceCheckResult();
  await checkAutoBridging(autoBridgeService, lastBalanceCheck);
}
```

### With Balance Checker

Auto-bridging reuses balance check results to avoid duplicate API calls:

```typescript
const balanceCheckResult = await balanceChecker.checkBalances();
await autoBridgeService.checkAllTokens(balanceCheckResult);
```

---

## Error Handling

All bridge operations include comprehensive error handling:

- **Network errors**: Retried with exponential backoff
- **API errors**: Logged with full context
- **Validation errors**: Returned in `BridgeExecutionResult.error`
- **Status polling**: Handles 404 as "not yet available"

---

## State Persistence

- **BridgeStateTracker**: Persists to `bridge-state.json`
- **BridgeManager**: No state persistence (stateless)
- **AutoBridgeService**: Uses BridgeStateTracker for persistence

---

## Testing

Test scripts are available:

- `test-bridge-out.ts`: Test GC→SOL bridging
- `test-bridge-in.ts`: Test SOL→GC bridging
- `test-bridge-roundtrip.ts`: Test round-trip bridging

---

## Common Patterns

### Manual Bridge Execution

```typescript
const bridgeManager = new BridgeManager(configService);
await bridgeManager.initialize();

// Get fee estimate
const fee = await bridgeManager.estimateFee('GALA', 'Solana');

// Execute bridge
const result = await bridgeManager.executeBridgeOut({
  symbol: 'GALA',
  amount: 1000,
  destination: 'Solana'
});
```

### Automatic Rebalancing

```typescript
const autoBridgeService = new AutoBridgeService(/* ... */);
const result = await autoBridgeService.checkAllTokens();

if (result.needsRebalancing) {
  for (const imbalance of result.recommendations) {
    await autoBridgeService.rebalance(imbalance);
  }
}
```

### Status Monitoring

```typescript
const status = await bridgeManager.waitForBridgeCompletion(
  transactionHash,
  30 // timeout minutes
);

if (status?.status === 5) {
  console.log('Bridge completed successfully');
}
```

---

## Dependencies

- `@gala-chain/api`: DTOs and signing
- `@solana/web3.js`: Solana transaction construction
- `@solana/spl-token`: SPL token operations
- `class-transformer`: DTO serialization
- `bignumber.js`: Precise number handling

---

## Environment Variables

See `BRIDGING_POST_MORTEM.md` for complete environment variable documentation.

---

## Related Documentation

- `BRIDGING_POST_MORTEM.md`: Comprehensive guide to bridging implementation
- `AUTO_BRIDGING_PLAN.md`: Auto-bridging feature plan

