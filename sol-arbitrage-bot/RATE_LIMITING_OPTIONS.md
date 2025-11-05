# Rate Limiting Solutions for Jupiter API

## Problem
Getting 429 (Too Many Requests) errors from Jupiter API when evaluating multiple strategies. With 6 strategies per token, we're making 12+ quote requests per token evaluation cycle.

## Solutions Implemented

### 1. ✅ Quote Caching (Implemented)
- **Location**: `StrategyEvaluator.quoteCache`
- **How it works**: Caches quotes within a 5-second window
- **Benefit**: If multiple strategies use the same quote currency/direction, reuse the cached quote
- **Impact**: Reduces duplicate requests for identical quote parameters

### 2. ✅ Sequential Evaluation with Delays (Implemented)
- **Location**: `StrategyEvaluator.evaluateStrategies()`
- **How it works**: Evaluate strategies sequentially with 100ms delay between each
- **Benefit**: Spreads requests over time instead of all at once
- **Impact**: Reduces burst rate, helps avoid rate limits

## Alternative Solutions (Not Yet Implemented)

### 3. Use Jupiter API v6 (Recommended)
Jupiter v6 API has higher rate limits and better performance:
- **Current**: `https://lite-api.jup.ag/swap/v1` (v1)
- **Alternative**: `https://quote-api.jup.ag/v6/quote`
- **Benefits**:
  - Higher rate limits (100+ requests/second)
  - Better caching on Jupiter's side
  - More efficient routing
- **Implementation**: Update `jupiterApiUrl` in `SolanaPriceProvider`

### 4. Use Jupiter MCP SDK (If Available)
- **Location**: `src/services/jupiterMcpClient.ts`
- **Status**: Optional dependency, already implemented
- **Benefit**: May have different rate limits or better connection pooling
- **Requires**: Installing `@modelcontextprotocol/sdk`

### 5. Reduce Strategy Evaluation
- **Option A**: Evaluate strategies in priority order, stop after first profitable one
- **Option B**: Only evaluate top N strategies by priority
- **Option C**: Disable less promising strategies
- **Trade-off**: May miss better opportunities

### 6. Increase Delays Between Requests
- **Current**: 100ms between strategies
- **Options**: 200ms, 500ms, or configurable delay
- **Trade-off**: Slower evaluation, but fewer rate limit errors

### 7. Exponential Backoff on 429 Errors
- **Status**: Already implemented in `ErrorHandler` and `CircuitBreaker`
- **Enhancement**: Could add strategy-level backoff to wait longer before retrying

### 8. Batch Quote Requests (If Jupiter Supports)
- **Status**: Jupiter API doesn't support batch quotes
- **Alternative**: Use Jupiter's price API for spot prices (less accurate but faster)

### 9. Use Alternative Aggregators
- **Raydium**: Direct API access
- **Orca**: Aggregator API
- **1inch**: Cross-chain aggregator
- **Trade-off**: Different APIs, different rate limits, need to implement new providers

### 10. Reduce Number of Strategies
- **Current**: 6 enabled strategies
- **Options**: Enable only 2-3 most promising strategies
- **Quick Win**: Disable strategies that rarely win

## Recommended Next Steps

1. **Immediate**: Current implementation (caching + delays) should help
2. **Short-term**: Upgrade to Jupiter v6 API (`https://quote-api.jup.ag/v6/quote`)
3. **Medium-term**: Make delay configurable and adjust based on rate limit behavior
4. **Long-term**: Consider alternative aggregators or reducing strategy count

## Configuration Options to Add

```typescript
// In config schema
{
  "trading": {
    "strategyEvaluationDelayMs": 100, // Delay between strategy evaluations
    "quoteCacheTtlMs": 5000, // Quote cache TTL
    "maxStrategiesPerToken": 6, // Limit number of strategies to evaluate
    "jupiterApiVersion": "v6" // Use v6 API
  }
}
```

