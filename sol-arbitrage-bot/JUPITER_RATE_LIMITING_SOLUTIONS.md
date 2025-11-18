# Jupiter API Rate Limiting Solutions

## Current Situation

The bot is hitting Jupiter API rate limits more frequently, causing circuit breakers to open. The circuit breaker opens after **5 failures in 60 seconds** and stays open for **30 seconds** before attempting recovery.

**Current Configuration:**
- Using Jupiter v1 API: `https://lite-api.jup.ag/swap/v1` (lower rate limits)
- Delay between strategies: **100ms**
- Circuit breaker: Opens after 5 failures in 60s window
- Strategies per token: 2 (forward + reverse)
- Quote cache TTL: 5 seconds

## Solutions (Ranked by Impact)

### 1. ⭐ Upgrade to Jupiter v6 API (HIGHEST IMPACT - RECOMMENDED)

**Impact:** 10x+ higher rate limits, better caching, more efficient routing

**Implementation:**
```typescript
// In solana.ts, change:
private jupiterApiUrl = process.env.JUPITER_API_BASE || 'https://quote-api.jup.ag/v6/quote';
```

**Benefits:**
- 100+ requests/second (vs ~10-20 for v1)
- Better caching on Jupiter's side
- More efficient routing
- Same API structure, minimal code changes

**Effort:** ⭐ Low (single line change + test)

---

### 2. ⭐ Increase Delays Between Requests (IMMEDIATE FIX)

**Impact:** Reduces burst rate, prevents hitting limits

**Current:** 100ms delay between strategies

**Options:**
- **200ms** - Moderate reduction (2x slower evaluation)
- **500ms** - Significant reduction (5x slower, but much safer)
- **1000ms** - Very conservative (10x slower, minimal rate limit issues)

**Implementation:**
```typescript
// In strategyEvaluator.ts, line 76:
await new Promise(resolve => setTimeout(resolve, 500)); // Increase from 100ms
```

**Or make it configurable:**
```json
// config.json
{
  "trading": {
    "strategyEvaluationDelayMs": 500
  }
}
```

**Effort:** ⭐ Very Low (1 line change)

---

### 3. ⭐ Make Delays Configurable (RECOMMENDED)

**Impact:** Allows tuning without code changes

**Implementation:**
- Add `strategyEvaluationDelayMs` to config schema
- Read from config in `strategyEvaluator.ts`
- Default to 200ms (safer than current 100ms)

**Effort:** ⭐ Low (config + code change)

---

### 4. ⭐ Adjust Circuit Breaker Thresholds (QUICK FIX)

**Impact:** More tolerant of temporary failures

**Current:**
- Opens after 5 failures in 60 seconds
- 30 second timeout before half-open

**Options:**
- Increase `failureThreshold` to 8-10 (more failures before opening)
- Increase `timeout` to 60 seconds (longer wait before retry)
- Increase `failureWindow` to 120 seconds (spread failures over longer period)

**Implementation:**
```typescript
// In errorHandler.ts or where circuit breaker is created:
circuitBreakerRegistry.get('jupiter-api', {
  failureThreshold: 10,  // Was 5
  timeout: 60000,         // Was 30000 (60s instead of 30s)
  failureWindow: 120000  // Was 60000 (2min instead of 1min)
});
```

**Effort:** ⭐ Low (config change)

---

### 5. ⭐ Skip Tokens That Frequently Fail (SMART FILTERING)

**Impact:** Avoids wasting requests on problematic tokens

**Implementation:**
- Track tokens that frequently cause circuit breaker failures
- Skip evaluation for tokens that have failed N times in last M minutes
- Add cooldown period for problematic tokens

**Example:**
```typescript
// Track failures per token
private tokenFailureCounts = new Map<string, { count: number; lastFailure: number }>();

// Before evaluating token:
if (this.tokenFailureCounts.get(token.symbol)?.count > 3) {
  logger.debug(`Skipping ${token.symbol} - too many recent failures`);
  continue;
}
```

**Effort:** ⭐ Medium (new tracking logic)

---

### 6. ⭐ Improve Quote Caching (REDUCE REQUESTS)

**Impact:** Fewer duplicate requests

**Current:** 5 second TTL

**Options:**
- Increase cache TTL to 10-15 seconds for stable tokens
- Cache quotes per (token, amount, direction, quoteCurrency) tuple
- Share cache across strategies for same token/direction

**Implementation:**
```typescript
// In strategyEvaluator.ts:
this.quoteCache.get(key, 15000); // 15 second TTL instead of 5
```

**Effort:** ⭐ Low (config change)

---

### 7. ⭐ Stop After First Profitable Strategy (REDUCE EVALUATIONS)

**Impact:** Fewer requests per token

**Current:** Evaluates all strategies even if first one is profitable

**Implementation:**
```typescript
// In strategyEvaluator.ts:
for (const strategy of strategies) {
  const result = await this.evaluateStrategy(token, strategy);
  results.push(result);
  
  // If this strategy is profitable, skip remaining strategies
  if (result.success && result.riskResult?.shouldProceed && result.edge?.isProfitable) {
    logger.debug(`Found profitable strategy for ${token.symbol}, skipping remaining strategies`);
    break;
  }
}
```

**Trade-off:** May miss better opportunities, but reduces API calls

**Effort:** ⭐ Low (logic change)

---

### 8. ⭐ Use Jupiter Price API for Spot Prices (ALTERNATIVE)

**Impact:** Faster, less accurate, but avoids quote API rate limits

**When to use:** For price discovery, not execution quotes

**Implementation:**
- Use Jupiter price API for initial price checks
- Only use quote API when trade is actually profitable

**Effort:** ⭐ Medium (new API integration)

---

### 9. ⭐ Add Request Queue/Throttling (ADVANCED)

**Impact:** Smooths out request bursts

**Implementation:**
- Queue all Jupiter API requests
- Process at fixed rate (e.g., 5 requests/second max)
- Prevents bursts that trigger rate limits

**Effort:** ⭐ High (new infrastructure)

---

### 10. ⭐ Use Alternative Aggregators (FALLBACK)

**Impact:** Different rate limits, redundancy

**Options:**
- Raydium API (direct DEX access)
- Orca API (aggregator)
- 1inch (cross-chain aggregator)

**Implementation:** Add as fallback when Jupiter circuit breaker is open

**Effort:** ⭐ High (new integrations)

---

## Recommended Immediate Actions

### Quick Wins (Do Today):
1. **Increase delay to 500ms** (line 76 in `strategyEvaluator.ts`)
2. **Upgrade to Jupiter v6 API** (line 35 in `solana.ts`)
3. **Increase circuit breaker threshold to 10** (in `errorHandler.ts`)

### Short-term (This Week):
4. **Make delays configurable** (add to config.json)
5. **Increase quote cache TTL to 15 seconds**
6. **Stop after first profitable strategy**

### Medium-term (Next Sprint):
7. **Add token failure tracking** (skip problematic tokens)
8. **Add request queue/throttling** (if still needed)

## Configuration Example

```json
{
  "trading": {
    "strategyEvaluationDelayMs": 500,
    "quoteCacheTtlMs": 15000,
    "stopAfterFirstProfitable": true,
    "jupiterApiVersion": "v6"
  },
  "circuitBreakers": {
    "jupiter-api": {
      "failureThreshold": 10,
      "timeout": 60000,
      "failureWindow": 120000
    }
  }
}
```

## Testing

After implementing changes:
1. Monitor circuit breaker status in logs
2. Track 429 error frequency
3. Measure evaluation cycle time
4. Verify trades still execute correctly

## Monitoring

Watch for these metrics:
- Circuit breaker open frequency
- Average requests per evaluation cycle
- Time between evaluation cycles
- 429 error rate

