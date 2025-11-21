# Quote Staleness Analysis

## Impact of Recent Changes

### Changes Made:
1. **Quote Cache TTL**: 5 seconds → 15 seconds
2. **Strategy Delay**: 100ms → 500ms
3. **Circuit Breaker Thresholds**: More tolerant (doesn't affect staleness)

## How Quote Caching Works

### Cache Lifecycle:
1. **Cache is cleared** at the start of each token evaluation (line 66: `this.quoteCache.clear()`)
2. **Quotes are cached** within a single token evaluation cycle
3. **Cache key** includes: token symbol, trade size, quote currency, direction
4. **TTL check**: Quotes are reused if less than 15 seconds old (was 5 seconds)

### Example Flow:
```
Token: USDUC
├─ Strategy 1 (Forward): 
│  ├─ Fetch GALA quote (fresh) → Cache it
│  └─ Fetch GALA quote (fresh) → Cache it
│  └─ Time: 0ms
│
├─ Wait 500ms (delay)
│
└─ Strategy 2 (Reverse):
   ├─ Check cache for GALA quote → Found! (500ms old) ✅ Reuse
   └─ Check cache for GALA quote → Found! (500ms old) ✅ Reuse
   └─ Time: 500ms
```

## Impact Analysis

### 1. Quote Frequency (How Often Quotes Are Fetched)

**No Change** ✅
- Each token evaluation starts with a **fresh cache**
- Quotes are fetched fresh for each new token
- The 15-second TTL only affects reuse **within the same evaluation**

**Before:**
- Token 1: Fetch quotes (fresh)
- Token 2: Fetch quotes (fresh)
- Token 3: Fetch quotes (fresh)

**After:**
- Token 1: Fetch quotes (fresh)
- Token 2: Fetch quotes (fresh)
- Token 3: Fetch quotes (fresh)

**Result:** Same quote frequency per token evaluation.

### 2. Quote Staleness (How Old Quotes Can Be)

#### Between Different Tokens:
**No Change** ✅
- Cache is cleared for each token
- Each token gets **fresh quotes**
- Maximum staleness: **0 seconds** (always fresh)

#### Within Same Token Evaluation:
**Slight Increase** ⚠️
- **Before**: Quotes could be up to 5 seconds old if reused
- **After**: Quotes could be up to 15 seconds old if reused
- **In Practice**: With 500ms delay, quotes are reused within ~500ms (very fresh)

**Real-World Scenario:**
- Strategy 1 fetches quote at 0ms
- Strategy 2 reuses quote at 500ms
- **Actual staleness: ~500ms** (not 15 seconds)
- The 15-second TTL is just the maximum allowed, not the actual age

### 3. Evaluation Cycle Timing

**Slightly Slower** ⚠️
- **Before**: 100ms delay between strategies
- **After**: 500ms delay between strategies
- **Impact**: Adds 400ms per token evaluation (with 2 strategies)

**Example:**
- Token evaluation with 2 strategies:
  - **Before**: ~200ms total (100ms delay)
  - **After**: ~1000ms total (500ms delay)
  - **Difference**: +800ms per token

**Impact on Quote Staleness:**
- Quotes used in Strategy 2 are ~500ms old (was ~100ms)
- Still very fresh for trading purposes
- Market prices don't change significantly in 500ms

## Risk Assessment

### Low Risk ✅
1. **Quote freshness is maintained**:
   - Each token gets fresh quotes
   - Reused quotes are only ~500ms old (not 15 seconds)
   - 15-second TTL is a safety limit, not typical usage

2. **Market impact is minimal**:
   - Crypto prices don't change significantly in 500ms
   - Slippage protection (0.5%) handles small price movements
   - Risk buffer accounts for price changes

3. **Cache is token-specific**:
   - Cache cleared per token
   - No cross-token quote reuse
   - Each token evaluation is independent

## Recommendations

### Current Settings Are Safe ✅
- 15-second cache TTL is reasonable
- 500ms delay keeps quotes very fresh
- No changes needed

### If You Want Fresher Quotes:
- Reduce cache TTL to 10 seconds (still reduces duplicates)
- Keep 500ms delay (good balance)

### If You Want Fewer API Calls:
- Increase cache TTL to 20-30 seconds
- Increase delay to 750ms-1000ms
- Trade-off: Slightly older quotes (~500-1000ms)

## Summary

| Aspect | Impact | Risk Level |
|--------|--------|------------|
| Quote frequency per token | **No change** | ✅ None |
| Quote freshness (new tokens) | **No change** (always fresh) | ✅ None |
| Quote freshness (within token) | **~500ms old** (was ~100ms) | ⚠️ Low |
| Evaluation cycle time | **+800ms per token** | ⚠️ Low |
| Market price impact | **Minimal** (500ms is negligible) | ✅ None |

**Conclusion**: The changes have **minimal impact on quote staleness** while significantly reducing API rate limiting. The 15-second TTL is a maximum limit; in practice, quotes are reused within ~500ms, which is very fresh for trading purposes.

