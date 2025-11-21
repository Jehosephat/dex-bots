# Quick Start: Immediate Refactoring Wins

This guide provides step-by-step instructions for implementing the **highest-value, lowest-risk** improvements to the codebase.

## Phase 1: Rename EdgeCalculationResult Fields (2 hours, Zero Risk)

### Problem
Current field names are semantically incorrect in reverse mode:
```typescript
interface EdgeCalculationResult {
  galaChainProceeds: BigNumber;  // Proceeds in forward, COST in reverse
  solanaCostGala: BigNumber;     // Cost in forward, PROCEEDS in reverse
}
```

### Solution
Rename to universal semantic names:

#### Step 1: Update Type Definition

**File**: `src/core/edgeCalculator.ts:26-68`

```typescript
export interface EdgeCalculationResult {
  /** Whether the opportunity is profitable */
  isProfitable: boolean;

  /** Net edge in GALA */
  netEdge: BigNumber;

  /** Net edge in basis points */
  netEdgeBps: number;

  /** Whether edge meets minimum threshold */
  meetsThreshold: boolean;

  /** Price impact on GalaChain */
  galaChainPriceImpactBps: number;

  /** Price impact on Solana */
  solanaPriceImpactBps: number;

  /** Bridge cost in GALA */
  bridgeCost: BigNumber;

  /** Risk buffer in GALA */
  riskBuffer: BigNumber;

  /** Total cost in GALA */
  totalCost: BigNumber;

  // NEW: Universal semantic names
  /** GALA received from sell side (income) */
  income: BigNumber;

  /** GALA spent on buy side (expense) */
  expense: BigNumber;

  /** Which chain we're selling on (income side) */
  sellSide: 'galachain' | 'solana';

  /** Which chain we're buying on (expense side) */
  buySide: 'galachain' | 'solana';

  // DEPRECATED: Keep for backward compatibility during migration
  /** @deprecated Use 'income' instead */
  galaChainProceeds: BigNumber;

  /** @deprecated Use 'expense' instead */
  solanaCostGala: BigNumber;

  /** Quote currency to GALA conversion rate */
  solToGalaRate: BigNumber;

  /** Whether price impact is acceptable */
  priceImpactAcceptable: boolean;

  /** Reasons why opportunity is invalid (if any) */
  invalidationReasons: string[];
}
```

#### Step 2: Update EdgeCalculator Implementation

**File**: `src/core/edgeCalculator.ts:192-207`

```typescript
const result: EdgeCalculationResult = {
  isProfitable,
  netEdge,
  netEdgeBps,
  meetsThreshold,
  galaChainPriceImpactBps,
  solanaPriceImpactBps,
  bridgeCost,
  riskBuffer,
  totalCost,

  // NEW: Universal names (forward direction)
  income: galaChainProceeds,        // ✓ Selling on GalaChain
  expense: solanaCostGala,          // ✓ Buying on Solana
  sellSide: 'galachain',
  buySide: 'solana',

  // DEPRECATED: Keep for compatibility
  galaChainProceeds,
  solanaCostGala,
  solToGalaRate,
  priceImpactAcceptable,
  invalidationReasons
};
```

#### Step 3: Update ReverseEdgeCalculator Implementation

**File**: `src/core/reverseEdgeCalculator.ts:126-141`

```typescript
const result: EdgeCalculationResult = {
  isProfitable,
  netEdge,
  netEdgeBps,
  meetsThreshold,
  galaChainPriceImpactBps,
  solanaPriceImpactBps,
  bridgeCost,
  riskBuffer,
  totalCost,

  // NEW: Universal names (reverse direction)
  income: solanaProceedsGala,       // ✓ Selling on Solana
  expense: galaChainCost,           // ✓ Buying on GalaChain
  sellSide: 'solana',
  buySide: 'galachain',

  // DEPRECATED: Keep for compatibility (confusing names!)
  galaChainProceeds: solanaProceedsGala,  // Still confusing, but marked deprecated
  solanaCostGala: galaChainCost,          // Still confusing, but marked deprecated
  solToGalaRate: quoteToGalaRate,
  priceImpactAcceptable,
  invalidationReasons
};
```

#### Step 4: Update Logging to Use New Fields

**File**: `src/core/tokenEvaluator.ts:656-693`

Replace old field references:
```typescript
// OLD (confusing in reverse mode)
logger.info(`   📥 INCOME:`);
logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);

logger.info(`\n   📤 COSTS:`);
logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA`);
```

With new references:
```typescript
// NEW (clear in all modes)
logger.info(`   📥 INCOME:`);
logger.info(`      ${edge.sellSide === 'galachain' ? '🔷' : '🔸'} ${edge.sellSide.toUpperCase()} Proceeds:  ${edge.income.toFixed(8)} GALA`);

logger.info(`\n   📤 COSTS:`);
logger.info(`      ${edge.buySide === 'galachain' ? '🔷' : '🔸'} ${edge.buySide.toUpperCase()} Cost:         ${edge.expense.toFixed(8)} GALA`);
```

### Testing

Add tests to verify field consistency:

```typescript
// test/core/edgeCalculator.test.ts
describe('EdgeCalculationResult field consistency', () => {
  it('should have income === galaChainProceeds in forward mode', () => {
    const result = edgeCalculator.calculateEdge(/* forward params */);
    expect(result.income.toString()).toBe(result.galaChainProceeds.toString());
    expect(result.expense.toString()).toBe(result.solanaCostGala.toString());
    expect(result.sellSide).toBe('galachain');
    expect(result.buySide).toBe('solana');
  });

  it('should have income === Solana proceeds in reverse mode', () => {
    const result = reverseEdgeCalculator.calculateReverseEdge(/* reverse params */);
    expect(result.income.toString()).toBe(result.galaChainProceeds.toString()); // Confusing name, but value is Solana proceeds
    expect(result.expense.toString()).toBe(result.solanaCostGala.toString());   // Confusing name, but value is GC cost
    expect(result.sellSide).toBe('solana');
    expect(result.buySide).toBe('galachain');
  });

  it('netEdge should always equal income - expense - costs', () => {
    const results = [
      edgeCalculator.calculateEdge(/* forward params */),
      reverseEdgeCalculator.calculateReverseEdge(/* reverse params */)
    ];

    results.forEach(result => {
      const expectedNetEdge = result.income
        .minus(result.expense)
        .minus(result.bridgeCost)
        .minus(result.riskBuffer);

      expect(result.netEdge.toString()).toBe(expectedNetEdge.toString());
    });
  });
});
```

### Migration Plan

1. **Day 1 Morning**: Update type definitions and implementations
2. **Day 1 Afternoon**: Update logging to use new fields
3. **Day 2 Morning**: Add comprehensive tests
4. **Day 2 Afternoon**: Run regression tests, deploy to staging

### Rollback Plan

If issues arise:
1. Deprecated fields still exist, so old code works
2. Revert logging changes (cosmetic only)
3. Remove new fields from type (keep deprecated fields)

---

## Phase 2: Consolidate Edge Calculators (6 hours, Low Risk)

### Problem
`EdgeCalculator` (366 lines) and `ReverseEdgeCalculator` (204 lines) have 80% duplicate code.

### Solution
Create `UnifiedEdgeCalculator` that handles both directions:

#### Step 1: Create Unified Calculator

**File**: `src/core/unifiedEdgeCalculator.ts` (NEW)

```typescript
import BigNumber from 'bignumber.js';
import { GalaChainQuote, SolanaQuote } from '../types/core';
import { TokenConfig } from '../types/config';
import { IConfigService } from '../config';
import logger from '../utils/logger';
import {
  calculateNetEdge,
  calculateNetEdgeBps,
  isNetEdgeSufficient,
  isValidPrice
} from '../utils/calculations';
import { EdgeCalculationResult } from './edgeCalculator';

export class UnifiedEdgeCalculator {
  private tradingConfig: any;
  private bridgingConfig: any;

  constructor(private configService: IConfigService) {
    this.tradingConfig = configService.getTradingConfig();
    this.bridgingConfig = configService.getBridgingConfig();
  }

  /**
   * Calculate edge for any trade direction
   * @param sellSide - Where we're selling (income side)
   * @param buySide - Where we're buying (expense side)
   */
  calculateEdge(
    tokenConfig: TokenConfig,
    sellSide: {
      chain: 'galachain' | 'solana';
      quote: GalaChainQuote | SolanaQuote;
    },
    buySide: {
      chain: 'galachain' | 'solana';
      quote: GalaChainQuote | SolanaQuote;
    },
    quoteToGalaRate: BigNumber,
    galaUsdPrice?: number
  ): EdgeCalculationResult {
    const invalidationReasons: string[] = [];

    try {
      // Validate inputs
      if (!isValidPrice(sellSide.quote.price)) {
        invalidationReasons.push(`Invalid ${sellSide.chain} price`);
      }
      if (!isValidPrice(buySide.quote.price)) {
        invalidationReasons.push(`Invalid ${buySide.chain} price`);
      }
      if (!isValidPrice(quoteToGalaRate)) {
        invalidationReasons.push('Invalid quote to GALA rate');
      }

      if (invalidationReasons.length > 0) {
        return this.createInvalidResult(invalidationReasons);
      }

      // Calculate proceeds and costs
      const sellProceeds = sellSide.quote.price.multipliedBy(tokenConfig.tradeSize);
      const buyCost = buySide.quote.price.multipliedBy(tokenConfig.tradeSize);

      // Convert to GALA
      const sellProceedsGala = sellSide.quote.currency === 'GALA'
        ? sellProceeds
        : sellProceeds.multipliedBy(quoteToGalaRate);

      const buyCostGala = buySide.quote.currency === 'GALA'
        ? buyCost
        : buyCost.multipliedBy(quoteToGalaRate);

      // Universal edge calculation
      const income = sellProceedsGala;
      const expense = buyCostGala;
      const bridgeCost = this.calculateBridgeCost(galaUsdPrice);
      const riskBuffer = this.calculateRiskBuffer(income);

      const netEdge = income.minus(expense).minus(bridgeCost).minus(riskBuffer);
      const totalCost = expense.plus(bridgeCost).plus(riskBuffer);
      const netEdgeBps = calculateNetEdgeBps(netEdge, totalCost);

      // Get appropriate threshold
      const minEdgeBps = sellSide.chain === 'galachain'
        ? this.tradingConfig.minEdgeBps  // Forward
        : (this.tradingConfig.reverseArbitrageMinEdgeBps || this.tradingConfig.minEdgeBps);  // Reverse

      const meetsThreshold = isNetEdgeSufficient(netEdgeBps, minEdgeBps);

      // Price impacts
      const galaChainPriceImpactBps = sellSide.chain === 'galachain'
        ? sellSide.quote.priceImpactBps
        : buySide.quote.priceImpactBps;

      const solanaPriceImpactBps = sellSide.chain === 'solana'
        ? sellSide.quote.priceImpactBps
        : buySide.quote.priceImpactBps;

      const priceImpactAcceptable = this.isPriceImpactAcceptable(
        galaChainPriceImpactBps,
        solanaPriceImpactBps
      );

      const isProfitable = netEdge.isPositive() && meetsThreshold && priceImpactAcceptable;

      if (!isProfitable) {
        if (!netEdge.isPositive()) {
          invalidationReasons.push('Negative net edge');
        }
        if (!meetsThreshold) {
          invalidationReasons.push(`Edge ${netEdgeBps}bps below threshold ${minEdgeBps}bps`);
        }
        if (!priceImpactAcceptable) {
          invalidationReasons.push(`Price impact too high`);
        }
      }

      const result: EdgeCalculationResult = {
        isProfitable,
        netEdge,
        netEdgeBps,
        meetsThreshold,
        galaChainPriceImpactBps,
        solanaPriceImpactBps,
        bridgeCost,
        riskBuffer,
        totalCost,

        // Universal fields
        income,
        expense,
        sellSide: sellSide.chain,
        buySide: buySide.chain,

        // Deprecated fields (for backward compatibility)
        galaChainProceeds: sellSide.chain === 'galachain' ? income : expense,
        solanaCostGala: buySide.chain === 'solana' ? expense : income,
        solToGalaRate: quoteToGalaRate,
        priceImpactAcceptable,
        invalidationReasons
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Edge calculation failed', {
        tokenSymbol: tokenConfig.symbol,
        error: errorMessage
      });
      return this.createInvalidResult([`Calculation error: ${errorMessage}`]);
    }
  }

  private calculateBridgeCost(galaUsdPrice?: number): BigNumber {
    const bridgeCostUsd = this.bridgingConfig.bridgeCostUsd || 1.25;
    const galaPrice = galaUsdPrice || 0.01;
    const fullBridgeCostGala = new BigNumber(bridgeCostUsd).div(galaPrice);
    const tradesPerBridge = this.bridgingConfig.tradesPerBridge || 100;
    return fullBridgeCostGala.div(tradesPerBridge);
  }

  private calculateRiskBuffer(income: BigNumber): BigNumber {
    const riskBufferBps = this.tradingConfig.riskBufferBps;
    return income.multipliedBy(riskBufferBps).div(10000);
  }

  private isPriceImpactAcceptable(gcImpactBps: number, solImpactBps: number): boolean {
    const maxImpactBps = this.tradingConfig.maxPriceImpactBps;
    return Math.abs(gcImpactBps) <= maxImpactBps && Math.abs(solImpactBps) <= maxImpactBps;
  }

  private createInvalidResult(reasons: string[]): EdgeCalculationResult {
    return {
      isProfitable: false,
      netEdge: new BigNumber(0),
      netEdgeBps: 0,
      meetsThreshold: false,
      galaChainPriceImpactBps: 0,
      solanaPriceImpactBps: 0,
      bridgeCost: new BigNumber(0),
      riskBuffer: new BigNumber(0),
      totalCost: new BigNumber(0),
      income: new BigNumber(0),
      expense: new BigNumber(0),
      sellSide: 'galachain',
      buySide: 'solana',
      galaChainProceeds: new BigNumber(0),
      solanaCostGala: new BigNumber(0),
      solToGalaRate: new BigNumber(0),
      priceImpactAcceptable: false,
      invalidationReasons: reasons
    };
  }
}
```

#### Step 2: Update RiskManager to Use Unified Calculator

**File**: `src/execution/riskManager.ts:159-212`

```typescript
evaluateDirection(
  token: TokenConfig,
  galaChainQuote: GalaChainQuote,
  solanaQuote: SolanaQuote,
  solToGalaRate: BigNumber,
  direction: ArbitrageDirection,
  galaUsdPrice?: number
): RiskCheckResult {
  const reasons: string[] = [];

  // Price impact guardrails
  if (Math.abs(galaChainQuote.priceImpactBps) > this.trading.maxPriceImpactBps) {
    reasons.push(`GalaChain price impact too high: ${galaChainQuote.priceImpactBps}bps`);
  }
  if (Math.abs(solanaQuote.priceImpactBps) > this.trading.maxPriceImpactBps) {
    reasons.push(`Solana price impact too high: ${solanaQuote.priceImpactBps}bps`);
  }

  // Cooldown check
  if (this.stateManager.isTokenInCooldown(token.symbol)) {
    reasons.push('Token is in cooldown');
  }

  // Edge calculation using UNIFIED calculator
  let edge: EdgeCalculationResult;
  try {
    // Determine which side is selling vs buying
    const isForward = direction === 'forward';
    const sellSide = {
      chain: isForward ? 'galachain' as const : 'solana' as const,
      quote: isForward ? galaChainQuote : solanaQuote
    };
    const buySide = {
      chain: isForward ? 'solana' as const : 'galachain' as const,
      quote: isForward ? solanaQuote : galaChainQuote
    };

    edge = this.unifiedEdgeCalculator.calculateEdge(
      token,
      sellSide,
      buySide,
      solToGalaRate,
      galaUsdPrice
    );
  } catch (edgeError) {
    logger.error(`❌ ERROR in edge calculation for ${token.symbol} (${direction})`, {
      error: edgeError instanceof Error ? edgeError.message : String(edgeError)
    });
    throw edgeError;
  }

  // Validation (same as before)
  if (!edge.isProfitable) {
    reasons.push(...edge.invalidationReasons);
  }
  // ... rest of validation

  return { shouldProceed: reasons.length === 0, reasons, edge };
}
```

#### Step 3: Add Tests

```typescript
// test/core/unifiedEdgeCalculator.test.ts
describe('UnifiedEdgeCalculator', () => {
  it('should produce same results as EdgeCalculator for forward direction', () => {
    const oldResult = edgeCalculator.calculateEdge(/* params */);
    const newResult = unifiedCalculator.calculateEdge(
      token,
      { chain: 'galachain', quote: gcQuote },
      { chain: 'solana', quote: solQuote },
      rate,
      galaUsdPrice
    );

    expect(newResult.netEdge.toString()).toBe(oldResult.netEdge.toString());
    expect(newResult.netEdgeBps).toBe(oldResult.netEdgeBps);
    expect(newResult.income.toString()).toBe(oldResult.income.toString());
  });

  it('should produce same results as ReverseEdgeCalculator for reverse direction', () => {
    const oldResult = reverseEdgeCalculator.calculateReverseEdge(/* params */);
    const newResult = unifiedCalculator.calculateEdge(
      token,
      { chain: 'solana', quote: solQuote },
      { chain: 'galachain', quote: gcQuote },
      rate,
      galaUsdPrice
    );

    expect(newResult.netEdge.toString()).toBe(oldResult.netEdge.toString());
    expect(newResult.netEdgeBps).toBe(oldResult.netEdgeBps);
    expect(newResult.income.toString()).toBe(oldResult.income.toString());
  });
});
```

#### Step 4: Deprecate Old Calculators

After testing, mark old calculators as deprecated:

```typescript
// src/core/edgeCalculator.ts
/**
 * @deprecated Use UnifiedEdgeCalculator instead
 * This calculator will be removed in v2.0
 */
export class EdgeCalculator { ... }

// src/core/reverseEdgeCalculator.ts
/**
 * @deprecated Use UnifiedEdgeCalculator instead
 * This calculator will be removed in v2.0
 */
export class ReverseEdgeCalculator { ... }
```

### Testing

1. **Unit tests**: Verify unified calculator produces identical results
2. **Integration tests**: Run full trade evaluation for 50+ tokens
3. **Regression tests**: Compare edge calculations from last 100 trades
4. **Performance tests**: Ensure no latency regression

### Migration Plan

1. **Week 1 Day 1-2**: Implement UnifiedEdgeCalculator
2. **Week 1 Day 3**: Add comprehensive tests
3. **Week 1 Day 4-5**: Update RiskManager, test in staging
4. **Week 2 Day 1**: Deploy to production, monitor
5. **Week 2 Day 2-5**: If stable, remove old calculators

### Rollback Plan

1. Old calculators remain in codebase during migration
2. RiskManager can switch back to old calculators with 1-line change
3. Full rollback: revert RiskManager changes, continue using old calculators

---

## Success Metrics

### Phase 1 Success Criteria
- ✅ All tests pass
- ✅ Logging uses new field names
- ✅ Zero production issues
- ✅ Code review approval

### Phase 2 Success Criteria
- ✅ UnifiedEdgeCalculator produces identical results to old calculators
- ✅ 50% reduction in edge calculation code (570 → ~280 lines)
- ✅ All integration tests pass
- ✅ Production monitoring shows no anomalies for 1 week

---

## Next Steps After Quick Wins

Once Phase 1 and 2 are complete and stable:

1. **Introduce CrossChainTrade type** (see SIMPLIFICATION_ANALYSIS.md Phase 3)
2. **Unify executor methods** (see SIMPLIFICATION_ANALYSIS.md Phase 4)
3. **Standardize quote provider interface** (see SIMPLIFICATION_ANALYSIS.md Phase 5)

Each phase builds on the previous, with clear rollback points.
