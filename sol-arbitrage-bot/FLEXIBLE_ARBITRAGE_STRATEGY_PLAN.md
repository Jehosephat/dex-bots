# Flexible Arbitrage Strategy Plan

## Overview

Enable the bot to evaluate and execute multiple arbitrage strategies for each token, where strategies can use different quote currencies on each chain. This allows for more sophisticated arbitrage opportunities beyond simple forward/reverse with fixed quote currencies.

## Current Limitations

Currently, each token has:
- Fixed `gcQuoteVia`: Quote currency on GalaChain (usually "GALA")
- Fixed `solQuoteVia`: Quote currency on Solana (usually "SOL" or "GALA")
- Two directions: forward and reverse

This limits arbitrage to:
- **Forward**: SELL token on GC (get GALA) → BUY token on SOL (spend SOL/GALA)
- **Reverse**: BUY token on GC (spend GALA) → SELL token on SOL (get SOL/GALA)

## Desired Capabilities

Support strategies like:
- **Strategy A**: BUY MEW with USDC on Solana → SELL MEW for GALA on GalaChain
- **Strategy B**: BUY MEW with SOL on Solana → SELL MEW for GALA on GalaChain
- **Strategy C**: SELL MEW for GALA on GalaChain → BUY MEW with USDC on Solana
- **Strategy D**: SELL MEW for GALA on GalaChain → BUY MEW with SOL on Solana

And evaluate all applicable strategies to find the best opportunity.

## Architecture

### Phase 1: Strategy Definition System

#### 1.1 Create Strategy Types

**File**: `src/core/strategies/arbitrageStrategy.ts`

```typescript
/**
 * Arbitrage Strategy Definition
 * 
 * Defines a specific arbitrage path between two chains
 */
export interface ArbitrageStrategy {
  /** Unique strategy identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Strategy description */
  description: string;
  
  /** GalaChain side configuration */
  galaChainSide: ChainSideConfig;
  
  /** Solana side configuration */
  solanaSide: ChainSideConfig;
  
  /** Whether this strategy is enabled */
  enabled: boolean;
  
  /** Minimum edge threshold in basis points (optional, uses global default if not set) */
  minEdgeBps?: number;
  
  /** Priority order (lower = higher priority) */
  priority?: number;
}

/**
 * Chain-side configuration for a strategy
 */
export interface ChainSideConfig {
  /** Chain name */
  chain: 'galaChain' | 'solana';
  
  /** Quote currency to use */
  quoteCurrency: string;
  
  /** Operation: 'buy' or 'sell' */
  operation: 'buy' | 'sell';
  
  /** What we're trading */
  token: string;
  
  /** What we're getting (for buy) or giving (for sell) */
  quoteToken: string;
}

/**
 * Strategy evaluation result
 */
export interface StrategyEvaluationResult {
  /** Strategy that was evaluated */
  strategy: ArbitrageStrategy;
  
  /** Whether evaluation was successful */
  success: boolean;
  
  /** GalaChain quote (if available) */
  gcQuote: GalaChainQuote | null;
  
  /** Solana quote (if available) */
  solQuote: SolanaQuote | null;
  
  /** Rate conversion result (if available) */
  rateConversion: RateConversionResult | null;
  
  /** Risk evaluation result (if available) */
  riskResult: RiskCheckResult | null;
  
  /** Edge calculation result (if available) */
  edge?: EdgeCalculationResult;
  
  /** Error message if evaluation failed */
  error?: string;
}
```

#### 1.2 Strategy Registry

**File**: `src/core/strategies/strategyRegistry.ts`

```typescript
/**
 * Strategy Registry
 * 
 * Manages and evaluates multiple arbitrage strategies
 */
export class StrategyRegistry {
  private strategies: Map<string, ArbitrageStrategy> = new Map();
  
  /**
   * Register a strategy
   */
  register(strategy: ArbitrageStrategy): void;
  
  /**
   * Get all enabled strategies for a token
   */
  getStrategiesForToken(tokenSymbol: string): ArbitrageStrategy[];
  
  /**
   * Get all enabled strategies
   */
  getAllEnabledStrategies(): ArbitrageStrategy[];
  
  /**
   * Load strategies from config
   */
  loadFromConfig(config: any): void;
}
```

### Phase 2: Strategy Configuration

#### 2.1 Update Config Schema

**File**: `src/config/configSchema.ts`

Add strategy configuration schema:

```typescript
export const arbitrageStrategySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  galaChainSide: z.object({
    quoteCurrency: z.string().min(1),
    operation: z.enum(['buy', 'sell']),
  }),
  solanaSide: z.object({
    quoteCurrency: z.string().min(1),
    operation: z.enum(['buy', 'sell']),
  }),
  enabled: z.boolean(),
  minEdgeBps: bpsSchema.optional(),
  priority: z.number().int().optional(),
});

export const botConfigSchema = z.object({
  // ... existing fields ...
  strategies: z.record(z.string(), arbitrageStrategySchema).optional(),
});
```

#### 2.2 Example Config

**File**: `config/strategies.json` (new file)

```json
{
  "strategies": {
    "forward-gala-usdc": {
      "id": "forward-gala-usdc",
      "name": "Forward: GALA on GC, USDC on SOL",
      "description": "SELL token for GALA on GalaChain → BUY token with USDC on Solana",
      "galaChainSide": {
        "quoteCurrency": "GALA",
        "operation": "sell"
      },
      "solanaSide": {
        "quoteCurrency": "USDC",
        "operation": "buy"
      },
      "enabled": true,
      "priority": 1
    },
    "reverse-gala-usdc": {
      "id": "reverse-gala-usdc",
      "name": "Reverse: GALA on GC, USDC on SOL",
      "description": "BUY token with GALA on GalaChain → SELL token for USDC on Solana",
      "galaChainSide": {
        "quoteCurrency": "GALA",
        "operation": "buy"
      },
      "solanaSide": {
        "quoteCurrency": "USDC",
        "operation": "sell"
      },
      "enabled": true,
      "priority": 2
    },
    "forward-gala-sol": {
      "id": "forward-gala-sol",
      "name": "Forward: GALA on GC, SOL on SOL",
      "description": "SELL token for GALA on GalaChain → BUY token with SOL on Solana",
      "galaChainSide": {
        "quoteCurrency": "GALA",
        "operation": "sell"
      },
      "solanaSide": {
        "quoteCurrency": "SOL",
        "operation": "buy"
      },
      "enabled": true,
      "priority": 3
    },
    "reverse-gala-sol": {
      "id": "reverse-gala-sol",
      "name": "Reverse: GALA on GC, SOL on SOL",
      "description": "BUY token with GALA on GalaChain → SELL token for SOL on Solana",
      "galaChainSide": {
        "quoteCurrency": "GALA",
        "operation": "buy"
      },
      "solanaSide": {
        "quoteCurrency": "SOL",
        "operation": "sell"
      },
      "enabled": true,
      "priority": 4
    }
  }
}
```

### Phase 3: Strategy Evaluator

#### 3.1 Create Strategy Evaluator

**File**: `src/core/strategies/strategyEvaluator.ts`

```typescript
/**
 * Strategy Evaluator
 * 
 * Evaluates multiple arbitrage strategies for a token and selects the best one
 */
export class StrategyEvaluator {
  constructor(
    private configService: IConfigService,
    private gcProvider: GalaChainPriceProvider,
    private solProvider: SolanaPriceProvider,
    private rateConverter: RateConverter,
    private riskManager: RiskManager,
    private strategyRegistry: StrategyRegistry
  ) {}
  
  /**
   * Evaluate all enabled strategies for a token
   */
  async evaluateStrategies(token: TokenConfig): Promise<StrategyEvaluationResult[]>;
  
  /**
   * Select the best strategy from evaluation results
   */
  selectBestStrategy(results: StrategyEvaluationResult[]): StrategyEvaluationResult | null;
  
  /**
   * Evaluate a single strategy
   */
  private async evaluateStrategy(
    token: TokenConfig,
    strategy: ArbitrageStrategy
  ): Promise<StrategyEvaluationResult>;
}
```

#### 3.2 Strategy Evaluation Logic

For each strategy:
1. **Determine quote direction**:
   - GC side: If `operation === 'sell'` → reverse=false, else reverse=true
   - SOL side: If `operation === 'buy'` → reverse=false, else reverse=true
   
2. **Create temporary token config with strategy quote currencies**:
   - Create a temporary `TokenConfig` object with:
     - `gcQuoteVia` = strategy's `galaChainSide.quoteCurrency`
     - `solQuoteVia` = strategy's `solanaSide.quoteCurrency`
   - Or modify price providers to accept optional quote currency override
   
3. **Fetch quotes**:
   - GC quote: `gcProvider.getQuote(token.symbol, tradeSize, gcReverse)` 
     - Uses strategy's quote currency (via temporary config or parameter)
   - SOL quote: `solProvider.getQuote(token.symbol, tradeSize, solReverse)`
     - Uses strategy's quote currency (via temporary config or parameter)
   - **Alternative**: Add `getQuoteForStrategy()` methods that accept quote currency directly

4. **Convert to common currency** (GALA):
   - Convert SOL quote currency to GALA (already implemented)
   - Convert USDC quote currency to GALA (already implemented)
   - Use existing `RateConverter.convertQuoteCurrencyToGala()`

5. **Calculate edge**:
   - Use appropriate edge calculator based on strategy operation
   - Forward-like: GC proceeds - SOL cost - bridge - buffer
   - Reverse-like: SOL proceeds - GC cost - bridge - buffer
   - Calculate net edge in GALA

6. **Evaluate risk**:
   - Check balances for required currencies (strategy-specific)
   - Check price impact on both sides
   - Check edge thresholds (strategy-specific if configured)

### Phase 4: Enhance Rate Converter

#### 4.1 Support Multiple Quote Currencies

**File**: `src/core/rateConverter.ts`

Add support for converting USDC→GALA, SOL→GALA, etc.

```typescript
/**
 * Convert any quote currency to GALA
 */
async convertToGala(
  quoteCurrency: string,
  amount: BigNumber,
  source?: 'solana' | 'galachain'
): Promise<BigNumber>;
```

### Phase 5: Update Token Evaluator

#### 5.1 Replace Direction Logic with Strategy Logic

**File**: `src/core/tokenEvaluator.ts`

Replace `evaluateToken()` to:
1. Get all enabled strategies from registry
2. Evaluate each strategy
3. Select best strategy
4. Return result with strategy information

### Phase 6: Update Executors

#### 6.1 Strategy-Aware Execution

**File**: `src/core/tradeExecutor.ts`

Update to:
- Accept `StrategyEvaluationResult` instead of `TokenEvaluationResult`
- Extract strategy information
- Execute trades based on strategy's operation definitions

### Phase 7: Update Balance Checker

#### 7.1 Strategy-Aware Balance Checks

**File**: `src/core/balanceChecker.ts`

Update to check balances for:
- Required quote currencies on each chain
- Token balances on each chain
- Based on strategy's operation requirements

## Implementation Phases

### Phase 1: Core Strategy Types (Foundation)
- [ ] Create `ArbitrageStrategy` interface
- [ ] Create `ChainSideConfig` interface
- [ ] Create `StrategyEvaluationResult` interface
- [ ] Create `StrategyRegistry` class

### Phase 2: Configuration System
- [ ] Add strategy schema to config
- [ ] Create example strategies.json
- [ ] Update config loader to load strategies
- [ ] Validate strategy configurations

### Phase 3: Strategy Evaluator
- [ ] Create `StrategyEvaluator` class
- [ ] Implement strategy evaluation logic
- [ ] Implement best strategy selection
- [ ] Handle quote currency conversion

### Phase 4: Price Provider Enhancements
- [ ] Update `getQuote()` methods to accept optional `quoteCurrency` parameter
- [ ] Or create strategy-aware quote methods that accept quote currency
- [ ] Ensure quote currency can override token config temporarily
- [ ] Test with USDC, SOL, and GALA quote currencies

### Phase 5: Rate Converter Enhancements
- [x] USDC→GALA conversion (already implemented)
- [x] SOL→GALA conversion (already implemented)
- [ ] Cache conversion rates for better performance

### Phase 6: Integration
- [ ] Update `TokenEvaluator` to use strategies
- [ ] Update `TradeExecutor` for strategy execution
- [ ] Update `DualLegCoordinator` for strategy operations
- [ ] Update balance checker for strategy requirements

### Phase 7: Logging & Monitoring
- [ ] Add strategy logging
- [ ] Show strategy comparison
- [ ] Log selected strategy
- [ ] Track strategy performance

## Example Strategy Flow

### Strategy: "Buy MEW with USDC on Solana → Sell MEW for GALA on GalaChain"

1. **Fetch Quotes**:
   - GC: Get quote for SELLING MEW (reverse=false) → get GALA
   - SOL: Get quote for BUYING MEW (reverse=false) → spend USDC

2. **Convert to GALA**:
   - GC quote: Already in GALA
   - SOL quote: Convert USDC amount to GALA using USDC/USD and GALA/USD rates

3. **Calculate Edge**:
   - GC proceeds: GALA received from selling MEW
   - SOL cost: GALA equivalent of USDC spent
   - Net edge: GC proceeds - SOL cost - bridge - buffer

4. **Evaluate Risk**:
   - Check: MEW balance on GalaChain (to sell)
   - Check: USDC balance on Solana (to buy)
   - Check: Price impact on both sides
   - Check: Edge meets threshold

5. **Execute** (if profitable):
   - GC: SELL MEW → get GALA
   - SOL: BUY MEW → spend USDC

## Benefits

1. **More Opportunities**: Can find arbitrage across different quote currency pairs
2. **Better Edge**: Can select the best quote currency combination
3. **Flexibility**: Easy to add new strategies via configuration
4. **Modularity**: Strategy logic separated from execution logic
5. **Reusability**: Existing components (quotes, executors, etc.) can be reused

## Migration Path

1. **Phase 1-2**: Create strategy system without breaking existing code
2. **Phase 3**: Add strategy evaluator alongside existing evaluator
3. **Phase 4**: Enhance rate converter to support multiple currencies
4. **Phase 5**: Gradually migrate token evaluator to use strategies
5. **Phase 6**: Make strategies the primary evaluation method

## Backward Compatibility

- Keep existing `solQuoteVia` and `gcQuoteVia` for backward compatibility
- Auto-generate strategies from existing token config if no strategies.json exists
- Default to current behavior if strategy system not enabled

## Testing Strategy

1. **Unit Tests**: Test strategy evaluation logic
2. **Integration Tests**: Test strategy with real quotes
3. **Edge Cases**: Test with missing quote currencies, invalid strategies
4. **Performance**: Ensure strategy evaluation doesn't slow down bot significantly

