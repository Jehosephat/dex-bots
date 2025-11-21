# SOL Arbitrage Bot - Refactoring Plan

## Executive Summary

This document outlines a comprehensive refactoring plan for the SOL Arbitrage Bot to improve reliability, readability, and ease of maintenance. The bot currently implements forward arbitrage (BUY GALA on Solana, SELL GALA on GalaChain) for configured token pairs.

**Current Status**: Working forward arbitrage implementation with basic error handling and state management.

**Refactoring Goals**:
- Improve code organization and separation of concerns
- Enhance error handling and recovery mechanisms
- Strengthen type safety and reduce runtime errors
- Simplify complex business logic
- Improve testability and maintainability
- Add proper dependency injection
- Standardize logging and monitoring

---

## Project Architecture Overview

### Current Component Structure

```
sol-arbitrage-bot/
├── src/
│   ├── index.ts                    # Main entry (stub)
│   ├── run-bot.ts                  # Bot runner (actual entry)
│   ├── mainLoop.ts                 # Main trading cycle
│   ├── config/                     # Configuration management
│   ├── core/                       # Core business logic
│   │   ├── priceProviders/        # Price quote providers
│   │   ├── edgeCalculator.ts      # Edge calculation
│   │   ├── stateManager.ts        # State persistence
│   │   ├── balanceChecker.ts      # Balance validation
│   │   └── inventoryRefresher.ts  # Inventory sync
│   ├── execution/                  # Trade execution
│   │   ├── dualLegCoordinator.ts  # Dual-leg orchestration
│   │   ├── riskManager.ts         # Risk evaluation
│   │   ├── galaChainExecutor.ts   # GC execution
│   │   └── solanaExecutor.ts       # SOL execution
│   ├── bridging/                   # Bridge management
│   ├── services/                   # External services
│   ├── utils/                      # Utilities
│   └── types/                      # Type definitions
└── config/                         # Configuration files
```

### Data Flow

1. **Price Discovery** → Price Providers (GalaChain + Solana)
2. **Edge Calculation** → EdgeCalculator (profitability analysis)
3. **Risk Evaluation** → RiskManager (guardrails)
4. **Execution** → DualLegCoordinator → Executors (GC + SOL)
5. **State Management** → StateManager (persistence)
6. **Bridging** → BridgeManager (periodic token transfers)

---

## Component Breakdown & Refactoring Opportunities

### 1. Configuration Management (`config/`)

**Current State**:
- `configManager.ts` handles all configuration loading
- Mixed initialization patterns (some eager, some lazy)
- Global state access via `getConfig()` functions
- No validation on startup

**Issues**:
- Global state makes testing difficult
- No clear configuration schema
- Configuration errors only discovered at runtime
- No environment-specific overrides

**Refactoring Recommendations**:

1. **Create Configuration Schema**
   - Define TypeScript interfaces for all config structures
   - Use Zod or similar for runtime validation
   - Validate on startup with clear error messages

2. **Dependency Injection**
   - Pass config objects through constructors instead of global access
   - Create a `ConfigService` that can be mocked in tests
   - Remove global `getConfig()` functions

3. **Configuration Loading**
   - Single initialization point with validation
   - Support for environment variable overrides
   - Configuration validation on startup

4. **Token Configuration**
   - Stronger typing for token configurations
   - Validation of mint addresses and decimals
   - Runtime checks for enabled tokens

**Priority**: High (affects all components)

---

### 2. Price Providers (`core/priceProviders/`)

**Current State**:
- `GalaChainPriceProvider` and `SolanaPriceProvider` extend `BasePriceProvider`
- Mixed concerns: price fetching, rate conversion, caching
- Complex logic in `getQuote()` methods (especially Solana provider)
- Inconsistent error handling

**Issues**:
- `SolanaPriceProvider.getQuote()` has 400+ lines with multiple special cases
- Price conversion logic scattered across providers
- USD price caching mixed with quote logic
- No retry mechanism for failed API calls
- Quote freshness not validated consistently

**Refactoring Recommendations**:

1. **Extract Quote Strategy Pattern**
   - Create separate strategy classes for different quote types:
     - `TokenToGalaQuoteStrategy` (GalaChain)
     - `TokenToSolQuoteStrategy` (Solana)
     - `TokenToGalaOnSolanaStrategy` (special case)
   - Each strategy handles one clear responsibility

2. **Separate Rate Conversion**
   - Create `RateConverter` service for SOL→GALA, USDC→GALA conversions
   - Remove conversion logic from price providers
   - Centralize rate fetching and caching

3. **Extract Price Caching**
   - Create `PriceCache` service with TTL support
   - Separate USD price caching from quote caching
   - Clear cache invalidation strategy

4. **Simplify Solana Provider**
   - Break down `getQuote()` into smaller methods:
     - `getQuoteForGalaToken()` (SOL→GALA, Token→GALA)
     - `getQuoteForToken()` (SOL/USDC→Token)
     - `getJupiterQuote()` (already exists, but needs cleanup)
   - Extract special case handling into separate methods

5. **Add Retry Logic**
   - Implement retry with exponential backoff for API calls
   - Circuit breaker pattern for external APIs
   - Graceful degradation when APIs fail

6. **Quote Validation**
   - Create `QuoteValidator` to check freshness, completeness
   - Reject stale quotes automatically
   - Validate quote structure before returning

**Priority**: High (core functionality, affects reliability)

---

### 3. Edge Calculator (`core/edgeCalculator.ts`)

**Current State**:
- Single class with multiple responsibilities
- Mixed calculation and validation logic
- Hard to test individual calculations
- Bridge cost calculation buried in private methods

**Issues**:
- Methods are too long and do multiple things
- Calculation logic not easily reusable
- No separation between calculation and validation
- Hard to test edge cases

**Refactoring Recommendations**:

1. **Extract Calculation Services**
   - `BridgeCostCalculator`: Bridge cost calculation
   - `RiskBufferCalculator`: Risk buffer calculation
   - `EdgeCalculator`: Core edge calculation (simplified)
   - `PriceImpactValidator`: Price impact validation

2. **Separate Concerns**
   - Split `calculateEdge()` into:
     - `calculateGrossEdge()`: Raw profit calculation
     - `applyCosts()`: Apply bridge cost, risk buffer
     - `validateEdge()`: Threshold and impact validation

3. **Improve Testability**
   - Make calculations pure functions where possible
   - Inject dependencies (config, converters)
   - Add unit tests for each calculation

4. **Better Error Handling**
   - Return `Result<T, Error>` types instead of throwing
   - Provide detailed error messages for debugging
   - Log calculation steps for troubleshooting

**Priority**: Medium (works but could be cleaner)

---

### 4. Risk Manager (`execution/riskManager.ts`)

**Current State**:
- Single `evaluate()` method that does multiple checks
- Mixed validation logic
- Hard-coded checks make it difficult to extend

**Issues**:
- All risk checks in one method
- No way to add new risk checks without modifying core
   - Hard to test individual risk factors
   - No prioritization of risk factors

**Refactoring Recommendations**:

1. **Strategy Pattern for Risk Checks**
   - Create `RiskCheck` interface
   - Implement individual checks:
     - `PriceImpactRiskCheck`
     - `EdgeThresholdRiskCheck`
     - `CooldownRiskCheck`
     - `InventoryRiskCheck`
     - `QuoteFreshnessRiskCheck`
   - Chain of responsibility pattern for sequential checks

2. **Risk Check Registry**
   - Register risk checks dynamically
   - Enable/disable checks via configuration
   - Priority-based execution

3. **Better Result Types**
   - Return structured `RiskAssessment` with:
     - Individual check results
     - Overall risk score
     - Recommendations
     - Blocking vs warning issues

4. **Separate Concerns**
   - Remove inventory checking from RiskManager (move to BalanceChecker)
   - Remove edge calculation from RiskManager (use EdgeCalculator)

**Priority**: Medium (works but extensibility is limited)

---

### 5. Main Loop (`mainLoop.ts`)

**Current State**:
- 400+ line function with complex nested logic
- Mixed concerns: orchestration, logging, execution
- Hard to test in isolation
- Error handling mixed with business logic

**Issues**:
- Too many responsibilities in one function
- Complex nested conditionals
- Excessive logging mixed with logic
- Hard to understand control flow

**Refactoring Recommendations**:

1. **Extract Token Evaluation**
   - Create `TokenEvaluator` class:
     - `evaluateToken()`: Single responsibility per token
     - Returns structured `TokenEvaluationResult`
   - Move quote fetching, edge calculation, risk evaluation here

2. **Separate Execution Logic**
   - Create `TradeExecutor` that handles:
     - Dry-run execution
     - Live execution
     - Result logging
   - Remove execution logic from main loop

3. **Simplify Main Loop**
   - Main loop should only:
     - Iterate over tokens
     - Call `TokenEvaluator`
     - Call `TradeExecutor` if needed
     - Handle errors at high level

4. **Extract Logging**
   - Create `TradeLogger` service (already exists but needs enhancement)
   - Move all logging to dedicated methods
   - Structured logging with consistent format

5. **Better Error Handling**
   - Per-token error handling (continue on error)
   - Aggregate errors for reporting
   - Don't let one token failure stop others

6. **Rate Conversion Logic**
   - Move SOL→GALA rate calculation to `RateConverter` service
   - Remove complex rate logic from main loop

**Priority**: High (readability and maintainability)

---

### 6. Dual-Leg Coordinator (`execution/dualLegCoordinator.ts`)

**Current State**:
- Orchestrates both execution legs
- Handles safety checks (pause, trade window, notional caps)
- Basic error handling with `Promise.allSettled`

**Issues**:
- Safety checks mixed with execution logic
- No retry mechanism for failed legs
- Partial failure handling is basic
- No transaction monitoring

**Refactoring Recommendations**:

1. **Extract Safety Checks**
   - Create `ExecutionGuard` service:
     - `checkPauseStatus()`
     - `checkTradeWindow()`
     - `checkNotionalCaps()`
   - Validate before execution starts

2. **Improve Partial Failure Handling**
   - Create `PartialFailureHandler`:
     - Detect which leg failed
     - Determine if reversal is needed
     - Handle compensation logic
   - Better logging and alerting

3. **Add Transaction Monitoring**
   - Monitor transaction status after submission
   - Handle confirmation failures
   - Track transaction lifecycle

4. **Retry Logic**
   - Implement retry for transient failures
   - Different retry strategies per leg
   - Circuit breaker for persistent failures

5. **Better Error Types**
   - Create specific error types:
     - `GalaChainExecutionError`
     - `SolanaExecutionError`
     - `PartialExecutionError`
   - Better error messages and context

**Priority**: Medium (works but could be more robust)

---

### 7. Executors (`execution/galaChainExecutor.ts`, `execution/solanaExecutor.ts`)

**Current State**:
- Separate executors for each chain
- Dry-run and live execution methods
- Basic error handling

**Issues**:
- Duplicated logic between executors
- No common interface or base class
- Error handling is inconsistent
- Transaction building logic is complex

**Refactoring Recommendations**:

1. **Create Common Executor Interface**
   ```typescript
   interface ChainExecutor {
     dryRunFromQuote(symbol: string, tradeSize: number, quote: Quote): ExecutionResult;
     executeFromQuoteLive(symbol: string, tradeSize: number, quote: Quote): Promise<ExecutionResult>;
   }
   ```

2. **Extract Transaction Building**
   - Create `TransactionBuilder` service for each chain
   - Separate transaction construction from submission
   - Better error messages for build failures

3. **Standardize Error Handling**
   - Common error types
   - Consistent error messages
   - Proper error propagation

4. **Add Execution Metrics**
   - Track execution time
   - Monitor success rates
   - Alert on failures

5. **Transaction Confirmation**
   - Add confirmation logic
   - Handle confirmation timeouts
   - Retry confirmation if needed

**Priority**: Medium (works but consistency needed)

---

### 8. State Manager (`core/stateManager.ts`)

**Current State**:
- Handles state persistence to JSON file
- Auto-save every 30 seconds
- BigNumber serialization/deserialization

**Issues**:
- File-based storage (not scalable)
- No transaction support
- BigNumber conversion is fragile
- No schema validation on load

**Refactoring Recommendations**:

1. **Add State Repository Interface**
   - Create `IStateRepository` interface
   - Implement file-based and future database implementations
   - Easy to swap storage backends

2. **Improve BigNumber Handling**
   - Use proper serialization library
   - Validate on load
   - Handle conversion errors gracefully

3. **Add State Validation**
   - Validate state structure on load
   - Migrate old state formats
   - Handle corrupted state files

4. **Transaction Support**
   - Batch updates
   - Atomic writes
   - Rollback on errors

5. **State Compression**
   - Compress old trades
   - Archive historical data
   - Limit in-memory state size

6. **Backup Strategy**
   - Automatic backups
   - Version history
   - Recovery from backups

**Priority**: Low (works but could be more robust)

---

### 9. Balance Checker (`core/balanceChecker.ts`)

**Current State**:
- Complex balance checking logic
- Mixed with price provider initialization
- Cooldown mechanism for paused state

**Issues**:
- Very long file (700+ lines)
- Multiple responsibilities
- Complex conditional logic
- Hard to test

**Refactoring Recommendations**:

1. **Extract Balance Fetching**
   - Create `BalanceFetcher` service:
     - `fetchGalaChainBalance()`
     - `fetchSolanaBalance()`
   - Separate from validation logic

2. **Extract Validation Logic**
   - Create `BalanceValidator`:
     - `validateSufficientBalance()`
     - `checkMinimumThresholds()`
   - Pure validation functions

3. **Simplify Main Method**
   - Break down `checkBalances()` into smaller methods
   - Clear separation of concerns
   - Better error handling

4. **Improve Cooldown Logic**
   - Extract to separate `CooldownManager`
   - Clear state management
   - Better logging

5. **Better Result Types**
   - Structured result with all checked balances
   - Clear insufficient fund details
   - Actionable recommendations

**Priority**: Medium (complexity affects maintainability)

---

### 10. Bridge Manager (`bridging/bridgeManager.ts`)

**Current State**:
- Handles bridge fee estimation
- Builds bridge parameters
- Basic error handling

**Issues**:
- Limited error handling
- No retry logic
- No status monitoring
- Hard to test

**Refactoring Recommendations**:

1. **Add Bridge Status Monitoring**
   - Poll bridge status
   - Handle timeouts
   - Alert on failures

2. **Retry Logic**
   - Retry failed bridges
   - Exponential backoff
   - Max retry limits

3. **Better Error Handling**
   - Specific error types
   - Better error messages
   - Recovery strategies

4. **Bridge Scheduler Integration**
   - Coordinate with bridge scheduler
   - Prevent duplicate bridges
   - Optimize bridge timing

**Priority**: Low (not critical path)

---

### 11. Utilities (`utils/`)

**Current State**:
- `logger.ts`: Winston-based logging
- `calculations.ts`: Math utilities
- `alerts.ts`: Alert sending
- `tradeLogger.ts`: Trade logging

**Issues**:
- Logger is global singleton (hard to test)
- Calculations could be better organized
- Alert service is basic

**Refactoring Recommendations**:

1. **Logger Improvements**
   - Support dependency injection
   - Create logger factory
   - Better structured logging
   - Log levels per component

2. **Calculations Organization**
   - Group related calculations
   - Add unit tests
   - Document edge cases

3. **Alert Service Enhancements**
   - Multiple alert channels
   - Alert prioritization
   - Rate limiting
   - Alert history

**Priority**: Low (works adequately)

---

### 12. Type System (`types/`)

**Current State**:
- Well-defined types in `types/core.ts`
- Good separation of concerns
- Some optional fields could be required

**Issues**:
- Some types are too permissive (optional fields)
- Missing validation types
- No discriminated unions for result types

**Refactoring Recommendations**:

1. **Stricter Types**
   - Make required fields non-optional where possible
   - Use branded types for IDs
   - Add validation types

2. **Result Types**
   - Use `Result<T, E>` pattern for operations that can fail
   - Discriminated unions for different states
   - Better type narrowing

3. **Configuration Types**
   - Stronger typing for configuration
   - Runtime validation types
   - Environment-specific types

**Priority**: Low (types are generally good)

---

## Cross-Cutting Concerns

### Error Handling

**Current State**: Basic try-catch with logging. No centralized error handling.

**Issues**:
- Inconsistent error handling patterns
- Errors swallowed in some places
- No error recovery strategies
- No error categorization

**Refactoring Recommendations**:

1. **Centralized Error Handler**
   - Create `ErrorHandler` service
   - Categorize errors (Network, Validation, Execution, etc.)
   - Implement recovery strategies
   - Track error rates

2. **Error Types**
   - Create specific error classes
   - Better error messages
   - Error context preservation

3. **Circuit Breaker Pattern**
   - For external API calls
   - Prevent cascading failures
   - Automatic recovery

4. **Retry Logic**
   - Configurable retry policies
   - Exponential backoff
   - Max retry limits

**Priority**: High (affects reliability)

---

### Logging

**Current State**: Winston logger with custom methods. Some inconsistent usage.

**Issues**:
- Global logger instance (hard to test)
- Inconsistent log levels
- Too much logging in some places, not enough in others
- No structured logging standards

**Refactoring Recommendations**:

1. **Structured Logging**
   - Consistent log format
   - Include context (token, chain, etc.)
   - Log levels per component

2. **Logger Factory**
   - Create logger instances per component
   - Support dependency injection
   - Easy to mock in tests

3. **Log Filtering**
   - Filter sensitive data
   - Configurable verbosity
   - Component-level filtering

4. **Log Aggregation**
   - Support for log aggregation services
   - Better log retention
   - Log analysis tools

**Priority**: Medium (works but could be better)

---

### Testing

**Current State**: Many test files exist but coverage is unclear.

**Issues**:
- No clear testing strategy
- Hard to test due to global state
- No integration tests visible

**Refactoring Recommendations**:

1. **Unit Tests**
   - Test each component in isolation
   - Mock dependencies
   - High coverage (>80%)

2. **Integration Tests**
   - Test component interactions
   - Test with real configs (testnet)
   - Test error scenarios

3. **Test Utilities**
   - Test fixtures
   - Mock factories
   - Test helpers

4. **CI/CD Integration**
   - Run tests on every commit
   - Coverage reporting
   - Test failure notifications

**Priority**: High (improves reliability)

---

### Dependency Injection

**Current State**: Most classes instantiate dependencies directly. No DI container.

**Issues**:
- Hard to test (can't mock dependencies)
- Tight coupling
- No way to swap implementations

**Refactoring Recommendations**:

1. **Dependency Injection Container**
   - Use lightweight DI library (e.g., `inversify`, `tsyringe`)
   - Register all services
   - Inject dependencies

2. **Interface-Based Design**
   - Create interfaces for all services
   - Implement interfaces
   - Easy to swap implementations

3. **Factory Pattern**
   - Create factories for complex objects
   - Centralize creation logic
   - Better error handling

**Priority**: High (affects testability and maintainability)

---

## Refactoring Priority Matrix

### High Priority (Do First)

1. **Configuration Management** - Affects all components
2. **Error Handling** - Critical for reliability
3. **Main Loop Simplification** - Core business logic
4. **Price Provider Refactoring** - Core functionality
5. **Dependency Injection** - Enables testing

### Medium Priority (Do Next)

1. **Risk Manager Extensibility** - Add new checks easily
2. **Balance Checker Simplification** - Reduce complexity
3. **Dual-Leg Coordinator Improvements** - Better failure handling
4. **Executor Standardization** - Consistency
5. **Logging Improvements** - Better observability

### Low Priority (Nice to Have)

1. **State Manager Enhancements** - Works but could be better
2. **Bridge Manager Improvements** - Not critical path
3. **Utility Enhancements** - Works adequately
4. **Type System Improvements** - Types are generally good

---

## Implementation Strategy

### Phase 1: Foundation (Weeks 1-2)

1. Set up dependency injection container
2. Refactor configuration management
3. Create centralized error handler
4. Improve logging infrastructure

### Phase 2: Core Components (Weeks 3-4)

1. Refactor price providers
2. Simplify main loop
3. Extract rate conversion service
4. Improve edge calculator

### Phase 3: Execution Layer (Weeks 5-6)

1. Standardize executors
2. Improve dual-leg coordinator
3. Enhance risk manager
4. Simplify balance checker

### Phase 4: Polish & Testing (Weeks 7-8)

1. Add comprehensive unit tests
2. Add integration tests
3. Improve error handling
4. Documentation updates

---

## Success Metrics

1. **Code Quality**
   - Reduced cyclomatic complexity
   - Increased test coverage (>80%)
   - Reduced code duplication

2. **Reliability**
   - Fewer runtime errors
   - Better error recovery
   - Improved uptime

3. **Maintainability**
   - Easier to add new features
   - Clearer code structure
   - Better documentation

4. **Performance**
   - No performance degradation
   - Faster error recovery
   - Better resource usage

---

## Risks & Mitigations

### Risk 1: Breaking Changes
- **Mitigation**: Incremental refactoring, comprehensive testing, feature flags

### Risk 2: Performance Impact
- **Mitigation**: Performance testing, benchmarking, monitoring

### Risk 3: Extended Downtime
- **Mitigation**: Phased rollout, rollback plan, extensive testing

---

## Conclusion

This refactoring plan addresses the main areas for improvement in the SOL Arbitrage Bot. The focus is on:

1. **Reliability**: Better error handling, retry logic, circuit breakers
2. **Readability**: Smaller functions, clearer naming, better organization
3. **Maintainability**: Dependency injection, testability, extensibility

The plan is structured to be implemented incrementally, allowing for continuous improvement while maintaining system stability.

**Next Steps**:
1. Review and prioritize refactoring tasks
2. Create detailed implementation tickets
3. Set up testing infrastructure
4. Begin Phase 1 implementation

---

*Document Version: 1.0*  
*Last Updated: 2025-01-XX*

