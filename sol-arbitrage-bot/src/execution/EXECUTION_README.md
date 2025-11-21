# Execution Module

## Overview

The execution module orchestrates the execution of cross-chain arbitrage trades. It coordinates simultaneous (or sequential) execution on both GalaChain and Solana, manages risk evaluation, and handles the complete trade lifecycle from dry-run to live execution.

## Architecture

The execution module consists of:

1. **DualLegCoordinator**: Orchestrates dual-chain trade execution
2. **SolanaExecutor**: Executes swaps on Solana
3. **GalaChainExecutor**: Executes swaps on GalaChain
4. **RiskManager**: Evaluates risk and calculates edge

---

## Core Components

### DualLegCoordinator

**Purpose**: Orchestrates the execution of dual-leg arbitrage trades across GalaChain and Solana. Handles dry-run preparation, live execution, error handling, and alerting.

**Key Features**:
- Dry-run preparation for both chains
- Sequential execution (GC first, then SOL, or vice versa)
- Comprehensive error handling
- Slack/Discord alerting
- Trade logging
- Deadline synchronization

**Public API**:

```typescript
class DualLegCoordinator {
  // Prepare dry-run for both legs
  async dryRun(
    symbol: string,
    direction?: ArbitrageDirection
  ): Promise<DualLegDryRunResult | null>

  // Execute live trade (sequential execution)
  async executeLive(
    symbol: string,
    gcQuote: GalaChainQuote,
    solQuote: SolanaQuote,
    direction?: ArbitrageDirection
  ): Promise<{
    executed: boolean;
    success: boolean;
    gcResult?: GalaChainExecutionResult;
    solResult?: SolanaExecutionResult;
    error?: string;
  }>
}
```

**Interfaces**:

```typescript
interface DualLegDryRunResult {
  symbol: string;
  tradeSize: number;
  galaChain: GalaChainExecutionResult;
  solana: SolanaExecutionResult;
  previewNetGala?: BigNumber;
}
```

**Usage Example**:

```typescript
import { DualLegCoordinator } from './execution/dualLegCoordinator';
import { GalaChainPriceProvider } from '../core/priceProviders/galachain';
import { SolanaPriceProvider } from '../core/priceProviders/solana';

const coordinator = new DualLegCoordinator(configService);

// Dry-run
const dryRun = await coordinator.dryRun('MEW', 'forward');
if (dryRun) {
  console.log('GC dry-run:', dryRun.galaChain);
  console.log('SOL dry-run:', dryRun.solana);
}

// Live execution
const gcProvider = new GalaChainPriceProvider(configService);
const solProvider = new SolanaPriceProvider(configService);
await gcProvider.initialize();
await solProvider.initialize();

const gcQuote = await gcProvider.getQuote('MEW', 1500, false);
const solQuote = await solProvider.getQuote('MEW', 1500, false);

if (gcQuote && solQuote) {
  const result = await coordinator.executeLive('MEW', gcQuote, solQuote, 'forward');
  
  if (result.executed && result.success) {
    console.log('Trade executed successfully!');
    console.log('GC tx:', result.gcResult?.txHash);
    console.log('SOL tx:', result.solResult?.txSig);
  }
}
```

**Execution Flow**:

1. **Dry-Run Phase**:
   - Fetches quotes from both chains
   - Prepares execution parameters
   - Validates deadlines are synchronized
   - Returns preview of expected outcomes

2. **Live Execution Phase** (Sequential):
   - Executes first leg (GalaChain or Solana based on direction)
   - Waits for confirmation
   - Executes second leg
   - Sends alerts on completion
   - Logs trade details

**Error Handling**:
- If first leg fails, second leg is not executed
- Comprehensive error logging
- Alerts sent for failures
- Trade state tracked for recovery

---

### SolanaExecutor

**Purpose**: Executes token swaps on Solana using Jupiter aggregator.

**Key Features**:
- Buy and sell operations
- Slippage protection
- Priority fee estimation
- Transaction signing and submission
- Confirmation waiting
- Dry-run preparation

**Public API**:

```typescript
class SolanaExecutor {
  // Prepare dry-run execution parameters
  dryRunFromQuote(
    symbol: string,
    tradeSize: number,
    quote: SolanaQuote
  ): SolanaExecutionResult

  // Execute buy operation (live)
  async executeBuyFromQuoteLive(
    symbol: string,
    tradeSize: number,
    quote: SolanaQuote,
    expectedCostInQuote: BigNumber
  ): Promise<SolanaExecutionResult>

  // Execute sell operation (live)
  async executeSellFromQuoteLive(
    symbol: string,
    tradeSize: number,
    quote: SolanaQuote,
    expectedProceedsInQuote: BigNumber
  ): Promise<SolanaExecutionResult>
}
```

**Interfaces**:

```typescript
interface SolanaExecutionParams {
  symbol: string;
  tradeSize: number;
  quoteCurrency: string;        // e.g., USDC, SOL, GALA
  expectedCostInQuote: BigNumber;
  maxCostInQuote: BigNumber;    // Slippage-protected
  route?: any;                   // Jupiter route
  deadlineMs: number;
}

interface SolanaExecutionResult {
  success: boolean;
  params: SolanaExecutionParams;
  txSig?: string;
  error?: string;
}
```

**Usage Example**:

```typescript
import { SolanaExecutor } from './execution/solanaExecutor';
import { SolanaPriceProvider } from '../core/priceProviders/solana';

const executor = new SolanaExecutor();
const provider = new SolanaPriceProvider(configService);
await provider.initialize();

// Get quote
const quote = await provider.getQuote('MEW', 1500, false, 'USDC');
if (!quote) return;

// Dry-run
const dryRun = executor.dryRunFromQuote('MEW', 1500, quote);
console.log('Expected cost:', dryRun.params.expectedCostInQuote.toString());

// Live execution (buy)
const result = await executor.executeBuyFromQuoteLive(
  'MEW',
  1500,
  quote,
  quote.price.multipliedBy(1500)
);

if (result.success && result.txSig) {
  console.log('Swap executed:', result.txSig);
}
```

**Key Implementation Details**:

- **Quote Currency Support**: Supports USDC, SOL, GALA, and other quote currencies
- **Slippage Protection**: Uses `maxSlippageBps` from config
- **Priority Fees**: Automatically calculated based on price impact
- **Transaction Confirmation**: Waits for confirmed status
- **Error Recovery**: Comprehensive error handling with retries

---

### GalaChainExecutor

**Purpose**: Executes token swaps on GalaChain using GSwap SDK.

**Key Features**:
- Token→GALA swaps (sell operations)
- GALA→Token swaps (buy operations)
- Slippage protection
- Pool selection
- Transaction signing and submission
- Dry-run preparation

**Public API**:

```typescript
class GalaChainExecutor {
  // Prepare dry-run execution parameters
  dryRunFromQuote(
    symbol: string,
    tradeSize: number,
    quote: GalaChainQuote
  ): GalaChainExecutionResult

  // Execute sell operation (token → GALA)
  async executeSellFromQuoteLive(
    symbol: string,
    tradeSize: number,
    quote: GalaChainQuote,
    expectedProceedsGala: BigNumber
  ): Promise<GalaChainExecutionResult>

  // Execute buy operation (GALA → token)
  async executeBuyFromQuoteLive(
    symbol: string,
    tradeSize: number,
    quote: GalaChainQuote,
    expectedCostGala: BigNumber
  ): Promise<GalaChainExecutionResult>
}
```

**Interfaces**:

```typescript
interface GalaChainExecutionParams {
  symbol: string;
  tradeSize: number;
  expectedProceedsGala: BigNumber;  // For sells
  minProceedsGala: BigNumber;       // Slippage-protected
  feeTier?: number;
  poolAddress?: string;
  route?: string[];
  deadlineMs: number;
}

interface GalaChainExecutionResult {
  success: boolean;
  params: GalaChainExecutionParams;
  txHash?: string;
  error?: string;
}
```

**Usage Example**:

```typescript
import { GalaChainExecutor } from './execution/galaChainExecutor';
import { GalaChainPriceProvider } from '../core/priceProviders/galachain';

const executor = new GalaChainExecutor();
const provider = new GalaChainPriceProvider(configService);
await provider.initialize();

// Get quote (sell MEW for GALA)
const quote = await provider.getQuote('MEW', 1500, false);
if (!quote) return;

// Dry-run
const dryRun = executor.dryRunFromQuote('MEW', 1500, quote);
console.log('Expected proceeds:', dryRun.params.expectedProceedsGala.toString());

// Live execution (sell)
const result = await executor.executeSellFromQuoteLive(
  'MEW',
  1500,
  quote,
  quote.price.multipliedBy(1500)
);

if (result.success && result.txHash) {
  console.log('Swap executed:', result.txHash);
}
```

**Key Implementation Details**:

- **GSwap SDK**: Uses `@gala-chain/gswap-sdk` for swap execution
- **Pool Selection**: Automatically selects best pool based on quote
- **Slippage Protection**: Uses `maxSlippageBps` from config
- **Transaction Signing**: Uses GalaChain private key from environment
- **Error Recovery**: Comprehensive error handling

---

### RiskManager

**Purpose**: Evaluates trade risk and calculates arbitrage edge. Determines if a trade should proceed based on multiple guardrails.

**Key Features**:
- Edge calculation (forward and reverse)
- Price impact validation
- Cooldown checking
- Inventory validation
- Threshold enforcement
- Risk buffer application

**Public API**:

```typescript
class RiskManager {
  // Evaluate trade risk and edge
  evaluate(
    token: TokenConfig,
    galaChainQuote: GalaChainQuote,
    solanaQuote: SolanaQuote,
    solToGalaRate: BigNumber,
    galaUsdPrice?: number
  ): RiskCheckResult
}
```

**Interfaces**:

```typescript
interface RiskCheckResult {
  shouldProceed: boolean;
  reasons: string[];              // Reasons to reject (if any)
  edge?: EdgeCalculationResult;  // Edge calculation details
}
```

**Usage Example**:

```typescript
import { RiskManager } from './execution/riskManager';
import { RateConverter } from '../core/rateConverter';

const riskManager = new RiskManager(stateManager, configService);
const rateConverter = new RateConverter(gcProvider, solProvider);

// Get quotes
const gcQuote = await gcProvider.getQuote('MEW', 1500, false);
const solQuote = await solProvider.getQuote('MEW', 1500, false);

// Convert SOL quote to GALA
const rateConversion = await rateConverter.convertQuoteCurrencyToGala(
  solQuote.currency,
  solQuote,
  1500
);

// Evaluate risk
const riskResult = riskManager.evaluate(
  tokenConfig,
  gcQuote,
  solQuote,
  rateConversion.rate,
  rateConversion.galaUsdPrice
);

if (riskResult.shouldProceed) {
  console.log('Trade approved!');
  console.log('Edge:', riskResult.edge?.netEdgeBps, 'bps');
} else {
  console.log('Trade rejected:', riskResult.reasons);
}
```

**Validation Checks**:

1. **Price Impact**: Both legs must be below `maxPriceImpactBps`
2. **Cooldown**: Token must not be in cooldown period
3. **Edge Calculation**: Net edge must be positive and above threshold
4. **Price Impact Acceptable**: Combined impact must be acceptable
5. **Inventory**: Sufficient balance on source chain (best-effort check)

**Edge Calculation**:

- **Forward**: `(GC Proceeds) - (SOL Cost in GALA) - (Bridge Cost) - (Risk Buffer)`
- **Reverse**: `(SOL Proceeds in GALA) - (GC Cost) - (Bridge Cost) - (Risk Buffer)`
- **Threshold**: Must meet `minEdgeBps` from config

---

## Integration Patterns

### Complete Trade Flow

```typescript
// 1. Get quotes
const gcQuote = await gcProvider.getQuote('MEW', 1500, false);
const solQuote = await solProvider.getQuote('MEW', 1500, false);

// 2. Convert rates
const rateConversion = await rateConverter.convertQuoteCurrencyToGala(
  solQuote.currency,
  solQuote,
  1500
);

// 3. Evaluate risk
const riskResult = riskManager.evaluate(
  tokenConfig,
  gcQuote,
  solQuote,
  rateConversion.rate
);

// 4. Dry-run
if (riskResult.shouldProceed) {
  const dryRun = await coordinator.dryRun('MEW', 'forward');
  
  // 5. Execute live
  if (dryRun) {
    const result = await coordinator.executeLive('MEW', gcQuote, solQuote, 'forward');
  }
}
```

### Sequential Execution

The coordinator executes trades sequentially:

1. **Forward Trade**: GC sell → SOL buy
   - Execute GC sell first
   - Wait for confirmation
   - Execute SOL buy

2. **Reverse Trade**: GC buy → SOL sell
   - Execute SOL sell first
   - Wait for confirmation
   - Execute GC buy

This ensures the first leg completes before attempting the second leg.

---

## Error Handling

All executors include comprehensive error handling:

- **Network errors**: Retried with exponential backoff
- **Transaction failures**: Logged with full context
- **Slippage exceeded**: Detected and reported
- **Insufficient balance**: Checked before execution
- **Timeout errors**: Handled gracefully

---

## Alerting

The `DualLegCoordinator` sends alerts for:

- **Successful trades**: Full trade details, transaction hashes, amounts
- **Failed trades**: Error details and which leg failed
- **Solana-specific alerts**: Separate channel for Solana trades

**Alert Format**:

```
🌉 Dual-Leg Trade Executed
Token: MEW
Direction: Forward
GalaChain: Sold 1500 MEW → 232.15 GALA (tx: 0x...)
Solana: Bought 1500 MEW for 232.10 GALA (tx: ...)
Net Edge: 0.05 GALA (2.15 bps)
```

---

## State Management

- **Cooldowns**: Managed by `StateManager` (via `RiskManager`)
- **Trade History**: Logged to `state.json`
- **Daily Limits**: Enforced by `StateManager`

---

## Configuration

Execution behavior is controlled by `config.json`:

```json
{
  "trading": {
    "minEdgeBps": 30,
    "maxSlippageBps": 50,
    "riskBufferBps": 10,
    "maxPriceImpactBps": 250,
    "cooldownMinutes": 5,
    "maxDailyTrades": 100
  }
}
```

---

## Dependencies

- `@gala-chain/gswap-sdk`: GalaChain swap execution
- `@solana/web3.js`: Solana transaction handling
- `@solana/spl-token`: SPL token operations
- `bignumber.js`: Precise number handling
- `axios`: HTTP requests (for Jupiter)

---

## Testing

Executors can be tested independently:

```typescript
// Test Solana executor
const executor = new SolanaExecutor();
const dryRun = executor.dryRunFromQuote('MEW', 1500, quote);
console.log('Dry-run result:', dryRun);

// Test GalaChain executor
const gcExecutor = new GalaChainExecutor();
const gcDryRun = gcExecutor.dryRunFromQuote('MEW', 1500, gcQuote);
console.log('GC dry-run result:', gcDryRun);
```

---

## Common Patterns

### Dry-Run Before Live Execution

```typescript
// Always dry-run first
const dryRun = await coordinator.dryRun('MEW', 'forward');
if (!dryRun) {
  console.error('Dry-run failed');
  return;
}

// Validate dry-run results
if (dryRun.galaChain.success && dryRun.solana.success) {
  // Proceed with live execution
  const result = await coordinator.executeLive('MEW', gcQuote, solQuote);
}
```

### Error Recovery

```typescript
try {
  const result = await coordinator.executeLive('MEW', gcQuote, solQuote);
  
  if (!result.executed) {
    console.error('Execution not attempted');
  } else if (!result.success) {
    console.error('Execution failed:', result.error);
    // Handle partial execution if needed
    if (result.gcResult?.success && !result.solResult?.success) {
      // GC succeeded but SOL failed - may need to reverse
    }
  }
} catch (error) {
  console.error('Unexpected error:', error);
}
```

---

## Best Practices

1. **Always dry-run first**: Validate execution parameters before live trades
2. **Check risk evaluation**: Ensure `shouldProceed` is true before executing
3. **Monitor confirmations**: Wait for transaction confirmations
4. **Handle partial failures**: Be prepared for one leg to succeed and the other to fail
5. **Log everything**: Comprehensive logging helps with debugging
6. **Use alerts**: Configure Slack/Discord webhooks for trade notifications

---

## Related Modules

- **Price Providers**: Provide quotes for execution
- **Rate Converter**: Converts quote currencies to GALA
- **Edge Calculator**: Calculates arbitrage edge
- **State Manager**: Tracks trade history and cooldowns
- **Balance Checker**: Validates sufficient balances

