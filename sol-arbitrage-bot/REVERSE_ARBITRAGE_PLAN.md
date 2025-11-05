# Reverse Arbitrage Implementation Plan

## Overview

This plan outlines the implementation of **bidirectional arbitrage** support, allowing the bot to evaluate and execute trades in both forward and reverse directions. Forward arbitrage remains the default, but reverse arbitrage can be enabled and evaluated alongside it.

## Current State Analysis

### Forward Arbitrage (Current)
- **Direction**: SELL on GalaChain → BUY on Solana
- **Flow**: 
  1. Sell token on GalaChain → Receive GALA
  2. Buy token on Solana → Spend SOL/USDC
  3. Net: Increase GALA inventory on GalaChain
- **Edge Calculation**: `GC Proceeds (GALA) - SOL Cost (GALA) - Bridge - Buffer`

### Reverse Arbitrage (To Be Implemented)
- **Direction**: BUY on GalaChain → SELL on Solana
- **Flow**:
  1. Buy token on GalaChain → Spend GALA
  2. Sell token on Solana → Receive SOL/USDC
  3. Net: Increase SOL/USDC inventory on Solana
- **Edge Calculation**: `SOL Proceeds (GALA) - GC Cost (GALA) - Bridge - Buffer`

### Existing Infrastructure

✅ **Already in Place:**
- Config schema has `enableReverseArbitrage`, `reverseArbitrageMinEdgeBps`, `arbitrageDirection`
- Price providers support `reverse` parameter in `getQuote()`
- `ReverseEdgeCalculator` exists (needs refactoring)
- Balance checker has some reverse trade awareness

❌ **Needs Implementation:**
- TokenEvaluator only evaluates forward direction
- TradeExecutor hardcoded to forward
- DualLegCoordinator only executes forward
- RiskManager only evaluates forward edge
- No direction selection logic
- No reverse execution path in executors

---

## Implementation Plan

### Phase 1: Type Definitions & Direction Enum

**Files to Create/Modify:**
- `src/types/direction.ts` (new) - Define direction types and enums

**Changes:**
```typescript
export type ArbitrageDirection = 'forward' | 'reverse';

export interface DirectionConfig {
  enabled: boolean;
  minEdgeBps: number;
  priority?: 'forward' | 'reverse' | 'best';
}

export interface DirectionalQuote {
  direction: ArbitrageDirection;
  gcQuote: GalaChainQuote | null;
  solQuote: SolanaQuote | null;
}
```

**Benefits:**
- Type-safe direction handling
- Clear direction semantics
- Easy to extend in future

---

### Phase 2: Update TokenEvaluator for Bidirectional Evaluation

**File:** `src/core/tokenEvaluator.ts`

**Changes:**

1. **Add Direction Evaluation Method**
   ```typescript
   async evaluateToken(token: TokenConfig): Promise<TokenEvaluationResult> {
     // Check config for direction preference
     const tradingConfig = this.configService.getTradingConfig();
     const directionConfig = this.getDirectionConfig(tradingConfig);
     
     // Evaluate forward (always)
     const forwardEvaluation = await this.evaluateDirection(
       token, 
       'forward'
     );
     
     // Evaluate reverse (if enabled)
     let reverseEvaluation: TokenEvaluationResult | null = null;
     if (directionConfig.reverse.enabled) {
       reverseEvaluation = await this.evaluateDirection(
         token, 
         'reverse'
       );
     }
     
     // Select best direction based on config
     return this.selectBestDirection(
       forwardEvaluation,
       reverseEvaluation,
       directionConfig
     );
   }
   ```

2. **Add Direction-Specific Evaluation**
   ```typescript
   private async evaluateDirection(
     token: TokenConfig,
     direction: ArbitrageDirection
   ): Promise<TokenEvaluationResult> {
     // Fetch quotes for direction
     const reverse = direction === 'reverse';
     const [gcQuote, solQuote] = await Promise.all([
       this.gcProvider.getQuote(token.symbol, token.tradeSize, reverse),
       this.solProvider.getQuote(token.symbol, token.tradeSize, reverse)
     ]);
     
     // Convert quote currency to GALA
     const rateConversion = await this.rateConverter.convertQuoteCurrencyToGala(...);
     
     // Evaluate risk (direction-aware)
     const riskResult = await this.riskManager.evaluateDirection(
       token,
       gcQuote,
       solQuote,
       rateConversion,
       direction
     );
     
     return {
       token,
       direction, // Add direction to result
       success: !!gcQuote && !!solQuote,
       gcQuote,
       solQuote,
       rateConversion,
       riskResult
     };
   }
   ```

3. **Add Direction Selection Logic**
   ```typescript
   private selectBestDirection(
     forward: TokenEvaluationResult,
     reverse: TokenEvaluationResult | null,
     config: DirectionConfig
   ): TokenEvaluationResult {
     // If direction is forced, return that
     if (config.priority === 'forward') return forward;
     if (config.priority === 'reverse' && reverse) return reverse;
     
     // If "best", compare edges
     if (config.priority === 'best') {
       const forwardEdge = forward.riskResult?.edge?.netEdgeBps || -Infinity;
       const reverseEdge = reverse?.riskResult?.edge?.netEdgeBps || -Infinity;
       
       // Prefer forward if both equal (default)
       if (forwardEdge >= reverseEdge && forward.riskResult?.shouldProceed) {
         return forward;
       }
       if (reverseEdge > forwardEdge && reverse?.riskResult?.shouldProceed) {
         return { ...reverse, direction: 'reverse' };
       }
     }
     
     // Default to forward
     return forward;
   }
   ```

**Dependencies:**
- Update `TokenEvaluationResult` interface to include `direction`

---

### Phase 3: Refactor Edge Calculators

**Files:**
- `src/core/edgeCalculator.ts`
- `src/core/reverseEdgeCalculator.ts`

**Changes:**

1. **Unify Edge Calculation Interface**
   - Both calculators should implement same interface
   - Use `IConfigService` instead of global config
   - Make `ReverseEdgeCalculator` accept `IConfigService` in constructor

2. **Create Edge Calculator Factory**
   ```typescript
   // In edgeCalculator.ts or new file
   export function createEdgeCalculator(
     direction: ArbitrageDirection,
     configService: IConfigService
   ): EdgeCalculator | ReverseEdgeCalculator {
     if (direction === 'reverse') {
       return new ReverseEdgeCalculator(configService);
     }
     return new EdgeCalculator(configService);
   }
   ```

3. **Update ReverseEdgeCalculator**
   - Remove global config access
   - Accept `IConfigService` in constructor
   - Match `EdgeCalculator` interface

**Benefits:**
- Consistent interface
- Easy to swap calculators
- Testable with DI

---

### Phase 4: Update RiskManager for Direction Support

**File:** `src/execution/riskManager.ts`

**Changes:**

1. **Add Direction-Aware Evaluation**
   ```typescript
   evaluateDirection(
     token: TokenConfig,
     galaChainQuote: GalaChainQuote,
     solanaQuote: SolanaQuote,
     solToGalaRate: BigNumber,
     direction: ArbitrageDirection,
     galaUsdPrice?: number
   ): RiskCheckResult {
     // Use appropriate edge calculator
     const edgeCalculator = direction === 'reverse'
       ? new ReverseEdgeCalculator(this.configService)
       : new EdgeCalculator(this.configService);
     
     // Calculate edge
     const edge = direction === 'reverse'
       ? edgeCalculator.calculateReverseEdge(...)
       : edgeCalculator.calculateEdge(...);
     
     // Apply direction-specific thresholds
     const minEdgeBps = direction === 'reverse'
       ? (this.trading.reverseArbitrageMinEdgeBps || this.trading.minEdgeBps)
       : this.trading.minEdgeBps;
     
     // ... rest of risk checks
   }
   ```

2. **Keep Backward Compatibility**
   ```typescript
   // Keep existing method for backward compatibility
   evaluate(...): RiskCheckResult {
     return this.evaluateDirection(..., 'forward');
   }
   ```

---

### Phase 5: Update TradeExecutor for Direction

**File:** `src/core/tradeExecutor.ts`

**Changes:**

1. **Add Direction to TradeExecutionResult**
   ```typescript
   export interface TradeExecutionResult {
     direction: ArbitrageDirection;
     executed: boolean;
     success?: boolean;
     // ... rest
   }
   ```

2. **Update executeTrade Method**
   ```typescript
   async executeTrade(
     evaluation: TokenEvaluationResult,
     runMode: 'live' | 'dry_run'
   ): Promise<TradeExecutionResult> {
     const direction = evaluation.direction || 'forward';
     
     // Pass direction to coordinator
     const result = await this.coordinator.executeTrade(
       evaluation.token,
       evaluation.gcQuote!,
       evaluation.solQuote!,
       direction,
       runMode
     );
     
     return {
       direction,
       ...result
     };
   }
   ```

3. **Update Logging**
   - Log direction clearly
   - Show direction-specific execution details

---

### Phase 6: Update DualLegCoordinator for Reverse Execution

**File:** `src/execution/dualLegCoordinator.ts`

**Changes:**

1. **Add Direction Parameter to Methods**
   ```typescript
   async executeLive(
     symbol: string,
     direction: ArbitrageDirection = 'forward'
   ): Promise<{ gc: GalaChainExecutionResult; sol: SolanaExecutionResult }> {
     // Fetch quotes with direction
     const reverse = direction === 'reverse';
     const [gcQuote, solQuote] = await Promise.all([
       this.gcProvider.getQuote(symbol, token.tradeSize, reverse),
       this.solProvider.getQuote(symbol, token.tradeSize, reverse)
     ]);
     
     // Execute based on direction
     if (direction === 'reverse') {
       return await this.executeReverseLive(gcQuote, solQuote, token);
     } else {
       return await this.executeForwardLive(gcQuote, solQuote, token);
     }
   }
   ```

2. **Add Reverse Execution Method**
   ```typescript
   private async executeReverseLive(
     gcQuote: GalaChainQuote,
     solQuote: SolanaQuote,
     token: TokenConfig
   ): Promise<{ gc: GalaChainExecutionResult; sol: SolanaExecutionResult }> {
     // REVERSE: BUY on GC first, then SELL on SOL
     
     // Execute GC buy (spend GALA to get token)
     const gc = await this.gcExecutor!.executeBuyFromQuoteLive(
       token.symbol,
       token.tradeSize,
       gcQuote
     );
     
     // Execute SOL sell (spend token to get USDC/SOL)
     const sol = await this.solExecutor!.executeSellFromQuoteLive(
       token.symbol,
       token.tradeSize,
       solQuote
     );
     
     return { gc, sol };
   }
   ```

3. **Update Forward Execution**
   - Extract to separate method for clarity
   - Keep existing logic

4. **Update Dry Run**
   - Add direction parameter
   - Support reverse dry-run

---

### Phase 7: Update Executors for Reverse Operations

**Files:**
- `src/execution/galaChainExecutor.ts`
- `src/execution/solanaExecutor.ts`

**Changes:**

1. **GalaChainExecutor - Add Buy Method**
   ```typescript
   /**
    * Execute a live GALA→token buy using the GSwap SDK.
    * REVERSE: Spend GALA to buy token
    */
   async executeBuyFromQuoteLive(
     symbol: string,
     tradeSize: number,
     quote: GalaChainQuote
   ): Promise<GalaChainExecutionResult> {
     const tokenCfg = getTokenConfig(symbol);
     const params: GalaChainExecutionParams = {
       symbol,
       tradeSize,
       expectedProceedsGala: new BigNumber(0), // For reverse, this is the cost
       minProceedsGala: new BigNumber(0),
       deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
     };

     try {
       // Setup same as executeFromQuoteLive
       const priv = process.env.GALACHAIN_PRIVATE_KEY;
       const wallet = process.env.GALACHAIN_WALLET_ADDRESS;
       if (!priv || !wallet) {
         throw new Error('GALACHAIN_PRIVATE_KEY and GALACHAIN_WALLET_ADDRESS are required');
       }
       if (!tokenCfg?.galaChainMint) throw new Error(`No GalaChain mint for ${symbol}`);

       if (!this.gswap) {
         const signer = new PrivateKeySigner(priv);
         this.gswap = new GSwap({ signer });
       }

       // REVERSE: tokenIn = GALA, tokenOut = token
       const tokenIn = 'GALA|Unit|none|none';
       const tokenOut = tokenCfg.galaChainMint;

       // Calculate GALA cost from quote (quote.price is GALA per token)
       const galaCost = quote.price.multipliedBy(tradeSize);
       
       // Get fresh quote for buying (spending GALA to get token)
       const q = await this.gswap.quoting.quoteExactInput(
         tokenIn,
         tokenOut,
         galaCost.toNumber()
       );
       
       const expectedTokens = new BigNumber(q.outTokenAmount.toString());
       const minTokens = expectedTokens.multipliedBy(1 - this.maxSlippageBps / 10000);

       // Update params (for reverse, expectedProceedsGala is actually the cost)
       params.expectedProceedsGala = galaCost;
       params.minProceedsGala = galaCost.multipliedBy(1 + this.maxSlippageBps / 10000); // Max cost
       params.feeTier = q.feeTier;

       // Execute swap: spend GALA, get token
       const result = await this.gswap.swaps.swap(
         tokenIn,
         tokenOut,
         q.feeTier,
         {
           exactIn: galaCost.toNumber(),
           amountOutMinimum: minTokens.toNumber()
         },
         wallet
       );

       logger.execution('✅ GalaChain buy executed (REVERSE)', { 
         symbol, 
         transactionId: result.transactionId,
         galaCost: galaCost.toString(),
         tokensReceived: expectedTokens.toString()
       });
       return { success: true, params, txHash: result.transactionId };
     } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
       logger.error('❌ GalaChain buy execution failed (REVERSE)', { symbol, error: message });
       return { success: false, params, error: message };
     }
   }
   ```

2. **SolanaExecutor - Add Sell Method**
   ```typescript
   /**
    * Execute a live token→USDC/SOL sell using Jupiter.
    * REVERSE: Sell token to get quote currency
    */
   async executeSellFromQuoteLive(
     symbol: string,
     tradeSize: number,
     quote: SolanaQuote
   ): Promise<SolanaExecutionResult> {
     const params: SolanaExecutionParams = {
       symbol,
       tradeSize,
       quoteCurrency: quote.currency,
       expectedCostInQuote: new BigNumber(0), // For reverse, this is proceeds
       maxCostInQuote: new BigNumber(0),
       route: quote.jupiterRoute,
       deadlineMs: Date.now() + this.defaultDeadlineSeconds * 1000
     };

     try {
       // Setup connection and wallet (same as executeFromQuoteLive)
       const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
       const priv = process.env.SOLANA_PRIVATE_KEY;
       if (!priv) {
         throw new Error('SOLANA_PRIVATE_KEY not set');
       }
       this.connection = new Connection(rpcUrl, 'confirmed');
       const secret = bs58.decode(priv);
       this.wallet = Keypair.fromSecretKey(secret);

       // Determine mints
       const tokenCfg = getTokenConfig(symbol);
       if (!tokenCfg?.solanaMint) throw new Error(`No Solana mint for token ${symbol}`);
       const quoteCfg = getQuoteTokenConfig(tokenCfg.solQuoteVia);
       if (!quoteCfg?.solanaMint) throw new Error(`No Solana mint for quote token ${tokenCfg.solQuoteVia}`);

       // REVERSE: inputMint = token, outputMint = quote currency
       const inputMint = tokenCfg.solanaMint; // token
       const outputMint = quoteCfg.solanaMint; // USDC/SOL

       // Use ExactIn: sell exact amount of token
       const inAmountRaw = new BigNumber(tradeSize)
         .multipliedBy(new BigNumber(10).pow(tokenCfg.decimals))
         .integerValue(BigNumber.ROUND_DOWN)
         .toString();

       // Get quote (ExactIn mode)
       let quoteRes: any;
       let lastErr: any;
       for (const base of this.jupiterApiBases) {
         try {
           quoteRes = await axios.get(`${base}/quote`, {
             params: {
               inputMint,
               outputMint,
               amount: inAmountRaw,
               slippageBps: this.maxSlippageBps,
               swapMode: 'ExactIn' // REVERSE: selling exact amount
             },
             timeout: 15000
           });
           break;
         } catch (e) {
           lastErr = e;
           logger.warn('Jupiter /quote failed on host', { base, error: e instanceof Error ? e.message : String(e) });
         }
       }
       if (!quoteRes?.data) throw (lastErr || new Error('All Jupiter /quote hosts failed'));

       const expectedProceeds = new BigNumber(quoteRes.data.outAmount);
       const minProceeds = expectedProceeds.multipliedBy(1 - this.maxSlippageBps / 10000);

       params.expectedCostInQuote = expectedProceeds; // For reverse, this is proceeds
       params.maxCostInQuote = expectedProceeds.multipliedBy(1 + this.maxSlippageBps / 10000);

       // Build and execute swap (same as executeFromQuoteLive)
       // ... swap execution code ...

       logger.execution('✅ Solana sell executed (REVERSE)', { 
         symbol, 
         signature: sig,
         tokensSold: tradeSize,
         proceeds: expectedProceeds.toString()
       });
       return { success: true, params, txSig: sig };
     } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
       logger.error('❌ Solana sell execution failed (REVERSE)', { symbol, error: message });
       return { success: false, params, error: message };
     }
   }
   ```

**Note:** 
- Keep existing methods for backward compatibility
- For GalaChain: Current method is SELL (token→GALA), new method is BUY (GALA→token)
- For Solana: Current method is BUY (USDC/SOL→token), new method is SELL (token→USDC/SOL)
- Both use same SDK/API but with swapped input/output mints

---

### Phase 8: Update Balance Checker

**File:** `src/core/balanceChecker.ts`

**Changes:**

1. **Direction-Aware Balance Checks**
   ```typescript
   async checkBalances(
     direction: ArbitrageDirection = 'forward',
     usePriceQuotes: boolean = true,
     forceCheck: boolean = false
   ): Promise<BalanceCheckResult> {
     // Forward: Need GALA on GC, SOL/USDC on SOL
     // Reverse: Need GALA on GC, Token on SOL
     
     if (direction === 'reverse') {
       return await this.checkReverseBalances(usePriceQuotes, forceCheck);
     }
     
     return await this.checkForwardBalances(usePriceQuotes, forceCheck);
   }
   ```

2. **Add Reverse Balance Check Method**
   - Check GALA balance on GalaChain (for buying)
   - Check token balance on Solana (for selling)

---

### Phase 9: Update Logging & Reporting

**Files:**
- `src/core/tokenEvaluator.ts` (logEvaluationResults)
- `src/core/tradeExecutor.ts` (logging)
- `src/mainLoop.ts` (summary logging)

**Changes:**

1. **Direction-Aware Logging**
   ```typescript
   logEvaluationResults(result: TokenEvaluationResult): void {
     const direction = result.direction || 'forward';
     const directionLabel = direction === 'reverse' ? 'REVERSE' : 'FORWARD';
     
     logger.info(`📊 EVALUATING ${directionLabel}: ${token.symbol}`);
     
     // Log direction-specific details
     if (direction === 'reverse') {
       logger.info(`   🔷 GalaChain (BUY): Spend GALA to get ${token.symbol}`);
       logger.info(`   🔸 Solana (SELL): Sell ${token.symbol} for ${solQuote.currency}`);
     } else {
       logger.info(`   🔷 GalaChain (SELL): Sell ${token.symbol} for GALA`);
       logger.info(`   🔸 Solana (BUY): Buy ${token.symbol} with ${solQuote.currency}`);
     }
   }
   ```

2. **Trade Execution Logging**
   - Show direction in execution logs
   - Log direction-specific success/failure messages

---

### Phase 10: Configuration Updates

**File:** `src/config/configSchema.ts`

**Changes:**

1. **Ensure Reverse Config is Validated**
   ```typescript
   TradingConfig: z.object({
     // ... existing fields
     enableReverseArbitrage: z.boolean().optional().default(false),
     reverseArbitrageMinEdgeBps: bpsSchema.optional(),
     arbitrageDirection: z.enum(['forward', 'reverse', 'best']).optional().default('forward')
   })
   ```

2. **Add Helper Methods**
   ```typescript
   // In ConfigService
   getDirectionConfig(): DirectionConfig {
     const trading = this.getTradingConfig();
     return {
       forward: {
         enabled: true, // Always enabled
         minEdgeBps: trading.minEdgeBps
       },
       reverse: {
         enabled: trading.enableReverseArbitrage || false,
         minEdgeBps: trading.reverseArbitrageMinEdgeBps || trading.minEdgeBps
       },
       priority: trading.arbitrageDirection || 'forward'
     };
   }
   ```

---

## Implementation Order

### Step 1: Foundation (Types & Interfaces)
1. Create `src/types/direction.ts` with direction types
2. Update `TokenEvaluationResult` to include `direction`
3. Update `TradeExecutionResult` to include `direction`

### Step 2: Edge Calculation
4. Refactor `ReverseEdgeCalculator` to use `IConfigService`
5. Create unified edge calculator interface/factory
6. Test edge calculations for both directions

### Step 3: Evaluation
7. Update `TokenEvaluator.evaluateToken()` to support both directions
8. Update `RiskManager` to support direction-aware evaluation
9. Test bidirectional evaluation

### Step 4: Execution
10. Update `DualLegCoordinator` for reverse execution
11. Add buy/sell methods to executors
12. Update `TradeExecutor` to handle direction
13. Test reverse execution (dry-run first)

### Step 5: Balance & Logging
14. Update `BalanceChecker` for reverse balances
15. Update all logging to show direction
16. Test end-to-end with both directions

---

## Testing Strategy

### Unit Tests
- Test edge calculations for forward vs reverse
- Test direction selection logic
- Test quote fetching for both directions

### Integration Tests
- Test bidirectional evaluation
- Test direction selection ("best" mode)
- Test reverse execution (dry-run)

### Manual Testing
- Enable reverse arbitrage in config
- Test with "forward" mode (should only forward)
- Test with "reverse" mode (should only reverse)
- Test with "best" mode (should choose best)

---

## Configuration Example

```json
{
  "trading": {
    "minEdgeBps": 30,
    "enableReverseArbitrage": true,
    "reverseArbitrageMinEdgeBps": 35,
    "arbitrageDirection": "best"
  }
}
```

**Behavior:**
- `"best"`: Evaluates both, chooses highest edge
- `"forward"`: Only evaluates and executes forward
- `"reverse"`: Only evaluates and executes reverse

---

## Risk Considerations

### Forward vs Reverse Balance Requirements
- **Forward**: Need token inventory on GalaChain, SOL/USDC on Solana
- **Reverse**: Need GALA on GalaChain, token inventory on Solana

### Execution Order
- **Forward**: SELL GC → BUY SOL (simultaneous)
- **Reverse**: BUY GC → SELL SOL (could be sequential or simultaneous)

### Edge Calculation Differences
- Forward: GC proceeds minus SOL costs
- Reverse: SOL proceeds minus GC costs
- Both need proper rate conversion

---

## Backward Compatibility

- Default behavior: Forward only (if `enableReverseArbitrage` not set)
- Existing code continues to work
- New features opt-in via configuration
- No breaking changes to existing interfaces (optional direction parameter)

---

## Success Criteria

✅ **Phase 1 Complete When:**
- Types are defined
- Build passes
- No breaking changes

✅ **Phase 2 Complete When:**
- TokenEvaluator can evaluate both directions
- Direction selection works correctly
- Tests pass

✅ **Phase 3 Complete When:**
- Reverse execution works (dry-run)
- Both directions can be executed
- Logging shows direction clearly

✅ **Phase 4 Complete When:**
- Live reverse execution works
- Balance checks work for both directions
- End-to-end test passes

---

## Future Enhancements (Post-Implementation)

1. **Per-Token Direction Configuration**
   - Allow setting direction per token
   - Some tokens may only support one direction

2. **Directional Cooldowns**
   - Separate cooldowns for forward vs reverse
   - Avoid rapid switching between directions

3. **Inventory-Based Direction Selection**
   - Automatically choose direction based on inventory levels
   - Balance GALA and SOL/USDC inventories

4. **Directional Statistics**
   - Track profitability by direction
   - Separate metrics for forward vs reverse trades

---

## Summary

### Key Design Decisions

1. **Direction as First-Class Concept**
   - `ArbitrageDirection` type throughout codebase
   - Direction included in evaluation and execution results
   - Clear separation between forward and reverse logic

2. **Backward Compatibility**
   - Forward remains default
   - Existing code continues to work
   - Reverse is opt-in via configuration

3. **Modular Approach**
   - Separate edge calculators for each direction
   - Direction-aware methods in executors
   - Clean separation of concerns

4. **Configuration-Driven**
   - `enableReverseArbitrage`: Master switch
   - `arbitrageDirection`: "forward" | "reverse" | "best"
   - `reverseArbitrageMinEdgeBps`: Separate threshold for reverse

### Files That Need Changes

**Core Evaluation:**
- `src/core/tokenEvaluator.ts` - Bidirectional evaluation
- `src/core/rateConverter.ts` - Works for both (already direction-agnostic)
- `src/core/edgeCalculator.ts` - Already supports forward
- `src/core/reverseEdgeCalculator.ts` - Refactor to use IConfigService
- `src/execution/riskManager.ts` - Direction-aware risk checks

**Execution:**
- `src/core/tradeExecutor.ts` - Pass direction to coordinator
- `src/execution/dualLegCoordinator.ts` - Support reverse execution
- `src/execution/galaChainExecutor.ts` - Add buy method
- `src/execution/solanaExecutor.ts` - Add sell method

**Infrastructure:**
- `src/core/balanceChecker.ts` - Direction-aware balance checks
- `src/types/direction.ts` - New type definitions
- `src/types/core.ts` - Update result interfaces

**Configuration:**
- `src/config/configSchema.ts` - Already has fields, ensure validation

### Critical Implementation Details

1. **Quote Direction Logic**
   - Forward GC: `reverse=false` → Sell token for GALA
   - Reverse GC: `reverse=true` → Buy token with GALA
   - Forward SOL: `reverse=false` → Buy token with SOL/USDC
   - Reverse SOL: `reverse=true` → Sell token for SOL/USDC

2. **Edge Calculation Differences**
   - Forward: GC proceeds - SOL cost - bridge - buffer
   - Reverse: SOL proceeds - GC cost - bridge - buffer
   - Both need proper rate conversion (SOL/USDC → GALA)

3. **Execution Order**
   - Forward: SELL GC → BUY SOL (simultaneous)
   - Reverse: BUY GC → SELL SOL (simultaneous or sequential)
   - Consider execution timing for reverse

4. **Balance Requirements**
   - Forward: Token on GC, SOL/USDC on SOL
   - Reverse: GALA on GC, Token on SOL

### Testing Checklist

- [ ] Forward evaluation still works (regression test)
- [ ] Reverse evaluation works (new test)
- [ ] Direction selection ("best" mode) works
- [ ] Reverse dry-run works
- [ ] Reverse live execution works
- [ ] Balance checks work for both directions
- [ ] Logging shows direction correctly
- [ ] Configuration validation works

### Migration Path

1. **Phase 1-2**: Types and evaluation (no execution changes)
2. **Phase 3**: Edge calculation refactoring
3. **Phase 4-5**: Execution infrastructure (dry-run first)
4. **Phase 6-7**: Live execution support
5. **Phase 8-9**: Balance checks and logging
6. **Phase 10**: Configuration finalization

Each phase can be tested independently before moving to next.

---

## Notes

- This plan maintains forward as default
- All changes are backward compatible
- Reverse arbitrage is opt-in via configuration
- Testing should be done incrementally per phase
- Consider dry-run testing extensively before live reverse trades
- The existing `ReverseEdgeCalculator` needs to be updated to use `IConfigService` instead of global config access

