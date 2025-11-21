# Architecture Comparison: Current vs. Proposed

## Current Architecture (Complex, Direction-Based)

```
┌─────────────────────────────────────────────────────────────────┐
│                      TokenEvaluator                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  evaluateWithDirections(token)                           │  │
│  │    ├─ evaluateDirection(token, 'forward')  ────┐         │  │
│  │    │    ├─ gcProvider.getQuote(reverse=false)  │         │  │
│  │    │    ├─ solProvider.getQuote(reverse=false) │         │  │
│  │    │    ├─ rateConverter.convert()             │         │  │
│  │    │    └─ riskManager.evaluate() ──────┐      │         │  │
│  │    │         └─ edgeCalculator ◄────┐   │      │         │  │
│  │    │                                │   │      │         │  │
│  │    └─ evaluateDirection(token, 'reverse')      │         │  │
│  │         ├─ gcProvider.getQuote(reverse=true)   │         │  │
│  │         ├─ solProvider.getQuote(reverse=true)  │         │  │
│  │         ├─ rateConverter.convert()             │         │  │
│  │         └─ riskManager.evaluateDirection() ────┼─────┐   │  │
│  │              └─ reverseEdgeCalculator ◄────────┘     │   │  │
│  │                                                       │   │  │
│  │  selectBestDirection(forward, reverse) ──────────────┘   │  │
│  │    └─ Returns: TokenEvaluationResult                     │  │
│  │         ├─ direction: 'forward' | 'reverse'              │  │
│  │         ├─ gcQuote                                       │  │
│  │         ├─ solQuote                                      │  │
│  │         └─ riskResult                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DualLegCoordinator                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  executeLive(symbol, direction, gcQuote, solQuote)       │  │
│  │                                                           │  │
│  │  // Solana leg (branching by direction)                  │  │
│  │  if (direction === 'reverse') {                          │  │
│  │    sol = solExecutor.executeSellFromQuoteLive(...)       │  │
│  │  } else {                                                │  │
│  │    sol = solExecutor.executeFromQuoteLive(...)           │  │
│  │  }                                                        │  │
│  │                                                           │  │
│  │  // GalaChain leg (branching by direction)               │  │
│  │  if (direction === 'reverse') {                          │  │
│  │    gc = gcExecutor.executeBuyFromQuoteLive(...)          │  │
│  │  } else {                                                │  │
│  │    gc = gcExecutor.executeFromQuoteLive(...)             │  │
│  │  }                                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌─────────────────┐                  ┌─────────────────┐
│ GalaChainExecutor                  │ SolanaExecutor  │
│                                    │                 │
│ executeFromQuote()                 │ executeFromQuote() (BUY)
│   ↳ SELL token → GALA              │   ↳ BUY token with quote
│                                    │                 │
│ executeBuyFromQuote()              │ executeSellFromQuote()
│   ↳ BUY token with GALA            │   ↳ SELL token → quote
└─────────────────┘                  └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Edge Calculation (Duplicated)                      │
│  ┌───────────────────────┐    ┌────────────────────────────┐   │
│  │  EdgeCalculator       │    │  ReverseEdgeCalculator     │   │
│  │  (366 lines)          │    │  (204 lines)               │   │
│  ├───────────────────────┤    ├────────────────────────────┤   │
│  │ galaChainProceeds ──┐ │    │ galaChainProceeds ──┐      │   │
│  │   (GALA from GC)    │ │    │   (actually SOL !)  │ ❌   │   │
│  │                     │ │    │                     │      │   │
│  │ solanaCostGala ───┐ │ │    │ solanaCostGala ───┐ │      │   │
│  │   (cost on SOL)   │ │ │    │   (actually GC !) │ │ ❌   │   │
│  │                   │ │ │    │                   │ │      │   │
│  │ netEdge = ────────┼─┼─┼────┤ netEdge = ────────┼─┼──┐   │   │
│  │   proceeds - cost │ │ │    │   proceeds - cost │ │  │   │   │
│  │   - bridge        │ │ │    │   - bridge        │ │  │   │   │
│  │   - risk          │ │ │    │   - risk          │ │  │   │   │
│  └───────────────────┴─┴─┘    └────────────────────┴──┴──┘   │
│                                                                │
│  ⚠️  Same logic, different field semantics = CONFUSION         │
└─────────────────────────────────────────────────────────────────┘
```

**Problems**:
1. 🔴 **Direction branching** at 4 layers (evaluator, risk, coordinator, executors)
2. 🔴 **Confusing field names** (galaChainProceeds means opposite things)
3. 🔴 **Code duplication** (570 lines of edge calculation for 2 directions)
4. 🔴 **Boolean confusion** (`reverse` parameter semantics vary by layer)

---

## Proposed Architecture (Unified, Operation-Based)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TokenEvaluator                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  evaluateToken(token) → CrossChainTrade                  │  │
│  │                                                           │  │
│  │  // Fetch quotes for both possible trade structures      │  │
│  │  Option 1: SELL on GC, BUY on SOL                        │  │
│  │    ├─ gcQuote = gcProvider.getQuote({                    │  │
│  │    │     operation: 'sell', quoteCurrency: 'GALA' })     │  │
│  │    └─ solQuote = solProvider.getQuote({                  │  │
│  │          operation: 'buy', quoteCurrency: 'SOL' })       │  │
│  │                                                           │  │
│  │  Option 2: BUY on GC, SELL on SOL                        │  │
│  │    ├─ gcQuote = gcProvider.getQuote({                    │  │
│  │    │     operation: 'buy', quoteCurrency: 'GALA' })      │  │
│  │    └─ solQuote = solProvider.getQuote({                  │  │
│  │          operation: 'sell', quoteCurrency: 'SOL' })      │  │
│  │                                                           │  │
│  │  // Calculate edge for both (same calculator!)           │  │
│  │  edge1 = unifiedCalculator.calculate(option1)            │  │
│  │  edge2 = unifiedCalculator.calculate(option2)            │  │
│  │                                                           │  │
│  │  // Select best trade                                    │  │
│  │  return edge1 > edge2 ? option1 : option2                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              Returns: CrossChainTrade {
                token: "GUSDC"
                amount: 1500

                galaChain: {
                  operation: "sell"      ✓ Explicit
                  quoteCurrency: "GALA"  ✓ Clear
                  price: 0.001234
                  expectedAmount: 1.851  (GALA proceeds)
                }

                solana: {
                  operation: "buy"       ✓ Explicit
                  quoteCurrency: "SOL"   ✓ Clear
                  price: 0.0001
                  expectedAmount: 0.15   (SOL cost)
                }

                edge: {
                  income: 1.851          ✓ Universal meaning
                  expense: 1.823         ✓ Universal meaning
                  bridgeCost: 0.012
                  riskBuffer: 0.001
                  netEdge: 0.015
                  netEdgeBps: 81
                }
              }
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DualLegCoordinator                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  execute(trade: CrossChainTrade)                         │  │
│  │                                                           │  │
│  │  // No branching! Each leg knows what to do              │  │
│  │  gc = gcExecutor.executeLeg(trade.galaChain)             │  │
│  │  sol = solExecutor.executeLeg(trade.solana)              │  │
│  │                                                           │  │
│  │  return { gc, sol }                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌─────────────────┐                  ┌─────────────────┐
│ GalaChainExecutor                  │ SolanaExecutor  │
│                                    │                 │
│ executeLeg(leg: TradeLeg)          │ executeLeg(leg: TradeLeg)
│   if leg.operation == 'sell':      │   if leg.operation == 'buy':
│     swap(token → quoteCurrency)    │     swap(quoteCurrency → token)
│   else:                            │   else:
│     swap(quoteCurrency → token)    │     swap(token → quoteCurrency)
│                                    │                 │
│ ✓ Single method                    │ ✓ Single method │
│ ✓ Clear logic                      │ ✓ Clear logic   │
└─────────────────┘                  └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Edge Calculation (Unified)                         │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  UnifiedEdgeCalculator (250 lines)                        │ │
│  │                                                            │ │
│  │  calculate(trade: CrossChainTrade) {                      │ │
│  │    // Identify which leg is income vs expense             │ │
│  │    sellLeg = trade.galaChain.operation == 'sell'          │ │
│  │                ? trade.galaChain                          │ │
│  │                : trade.solana                             │ │
│  │                                                            │ │
│  │    buyLeg = trade.galaChain.operation == 'buy'            │ │
│  │               ? trade.galaChain                           │ │
│  │               : trade.solana                              │ │
│  │                                                            │ │
│  │    // Universal calculation                               │ │
│  │    income = convertToGala(sellLeg.expectedAmount)         │ │
│  │    expense = convertToGala(buyLeg.expectedAmount)         │ │
│  │    bridgeCost = calculateBridgeCost()                     │ │
│  │    riskBuffer = calculateRiskBuffer(income)               │ │
│  │                                                            │ │
│  │    netEdge = income - expense - bridgeCost - riskBuffer   │ │
│  │                                                            │ │
│  │    return { income, expense, netEdge, ... }               │ │
│  │  }                                                         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ✓ Single code path for all trade types                       │
│  ✓ Clear semantics (income/expense are universal)             │
│  ✓ 50% less code (570 → 250 lines)                            │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits**:
1. ✅ **No direction parameter** - operations are explicit
2. ✅ **Clear field names** - income/expense have universal meaning
3. ✅ **50% code reduction** - one calculator handles all cases
4. ✅ **Type safety** - impossible to confuse semantics

---

## Data Structure Comparison

### Current: TokenEvaluationResult (Direction-Based)

```typescript
interface TokenEvaluationResult {
  direction?: 'forward' | 'reverse';  // ⚠️ What does this mean?
  gcQuote: GalaChainQuote;            // ⚠️ Buying or selling?
  solQuote: SolanaQuote;              // ⚠️ Buying or selling?
  riskResult: {
    edge: {
      galaChainProceeds: BigNumber;   // ❌ Proceeds in forward, COST in reverse!
      solanaCostGala: BigNumber;      // ❌ Cost in forward, PROCEEDS in reverse!
    }
  }
}

// Usage requires checking direction:
if (result.direction === 'forward') {
  const profit = result.riskResult.edge.galaChainProceeds
                 .minus(result.riskResult.edge.solanaCostGala);
} else {
  // Wait, which field is which now? 🤔
  const profit = result.riskResult.edge.galaChainProceeds  // Actually Solana proceeds!
                 .minus(result.riskResult.edge.solanaCostGala);  // Actually GC cost!
}
```

### Proposed: CrossChainTrade (Operation-Based)

```typescript
interface CrossChainTrade {
  token: string;
  amount: number;

  galaChain: {
    operation: 'buy' | 'sell';      // ✓ Explicit: what we're doing
    quoteCurrency: string;          // ✓ Clear: what we're trading against
    expectedAmount: BigNumber;      // ✓ Universal: quote currency amount
  };

  solana: {
    operation: 'buy' | 'sell';      // ✓ Opposite of GalaChain
    quoteCurrency: string;
    expectedAmount: BigNumber;
  };

  edge: {
    income: BigNumber;              // ✓ Always means GALA received
    expense: BigNumber;             // ✓ Always means GALA spent
    netEdge: BigNumber;             // ✓ Always income - expense - costs
  };
}

// Usage is straightforward:
const profit = trade.edge.income
               .minus(trade.edge.expense)
               .minus(trade.edge.bridgeCost)
               .minus(trade.edge.riskBuffer);

// Or even simpler:
const profit = trade.edge.netEdge;  // Already calculated!
```

---

## Code Metrics Comparison

| Metric | Current | Proposed | Improvement |
|--------|---------|----------|-------------|
| **Edge Calculator LOC** | 570 | 250 | **-56%** |
| **Executor Methods** | 8 (4 per chain) | 2 (1 per chain) | **-75%** |
| **Direction Branches** | 15+ | 0 | **-100%** |
| **Field Name Confusion** | High | None | **Complete** |
| **Type Safety** | Weak | Strong | **Improved** |
| **Test Complexity** | 2 paths × N cases | 1 path × N cases | **-50%** |

---

## Migration Path (Low Risk)

### Phase 1: Add New Types (No Breaking Changes)
```typescript
// Define new types alongside old ones
interface CrossChainTrade { ... }
class UnifiedEdgeCalculator { ... }

// Old code continues to work
```

### Phase 2: Gradual Migration
```typescript
// TokenEvaluator can return both formats
evaluateToken(): TokenEvaluationResult | CrossChainTrade {
  const oldResult = this.evaluateWithDirections();
  const newTrade = this.convertToTrade(oldResult);  // Adapter
  return newTrade;
}
```

### Phase 3: Remove Old Code
```typescript
// Once all consumers updated, delete:
// - EdgeCalculator (366 lines)
// - ReverseEdgeCalculator (204 lines)
// - Direction branching logic (100+ lines)
```

---

## Real-World Example

### Scenario: GUSDC Arbitrage

**Current Code Path** (Forward):
1. `evaluateDirection('GUSDC', 'forward')` → direction parameter
2. `gcProvider.getQuote('GUSDC', 1500, reverse=false)` → boolean confusion
3. `solProvider.getQuote('GUSDC', 1500, reverse=false)` → what does false mean?
4. `EdgeCalculator.calculate()` → galaChainProceeds = 1.851 GALA ✓
5. `RiskManager.evaluate()` → checks inventory for token sell
6. `DualLegCoordinator.executeLive('GUSDC', 'forward')` → if branching
7. `gcExecutor.executeFromQuoteLive()` → correct method
8. `solExecutor.executeFromQuoteLive()` → correct method

**Current Code Path** (Reverse):
1. `evaluateDirection('GUSDC', 'reverse')` → different direction
2. `gcProvider.getQuote('GUSDC', 1500, reverse=true)` → boolean means opposite
3. `solProvider.getQuote('GUSDC', 1500, reverse=true)` → different quote
4. `ReverseEdgeCalculator.calculate()` → galaChainProceeds = 1.823 GALA ❌ (actually Solana proceeds!)
5. `RiskManager.evaluateDirection()` → checks different inventory
6. `DualLegCoordinator.executeLive('GUSDC', 'reverse')` → else branch
7. `gcExecutor.executeBuyFromQuoteLive()` → different method
8. `solExecutor.executeSellFromQuoteLive()` → different method

**Proposed Code Path** (Both Cases):
1. `evaluateToken('GUSDC')` → no direction needed
2. Build trade 1: `{ gc: {op: 'sell'}, sol: {op: 'buy'} }`
3. Build trade 2: `{ gc: {op: 'buy'}, sol: {op: 'sell'} }`
4. `UnifiedCalculator.calculate(trade1)` → income: 1.851, expense: 1.838
5. `UnifiedCalculator.calculate(trade2)` → income: 1.823, expense: 1.851
6. Select best: `trade1` (higher net edge)
7. `coordinator.execute(trade1)` → no branching
8. `gcExecutor.executeLeg(trade1.galaChain)` → single method
9. `solExecutor.executeLeg(trade1.solana)` → single method

**Clarity Improvement**: ✓ No direction parameter, ✓ No boolean confusion, ✓ Clear semantics

---

## Summary

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Mental Model** | "Forward vs. Reverse arbitrage" | "Buy leg + Sell leg = Trade" |
| **Complexity** | 4-layer direction handling | Zero direction handling |
| **Field Semantics** | Context-dependent | Universal |
| **Code Paths** | 2 parallel implementations | 1 unified implementation |
| **Bug Surface** | High (semantic confusion) | Low (type-safe) |
| **Onboarding** | Hours to understand directions | Minutes to understand legs |

**Conclusion**: The unified model is simpler, safer, and more maintainable while providing identical functionality.
