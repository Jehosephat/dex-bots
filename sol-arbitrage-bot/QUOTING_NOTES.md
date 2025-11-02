# GalaChain DEX Quoting Notes

## Recent Learnings (2024)

### Key Discovery: `quoteExactAmount` Returns Negative Values

The `@gala-chain/dex` `quoteExactAmount` function returns **negative values for input amounts** and positive values for output amounts. This means we must use **absolute values** when extracting the output.

### Amount Format: Human-Readable Values

- **No conversions needed**: Pass human-readable amounts (e.g., `0.01 SOL`) directly to `quoteExactAmount`
- **Internal handling**: The `quoteExactAmount` function handles all internal decimal conversions automatically
- **No raw amounts**: We removed all `toRawAmount` and `toTokenAmount` conversions from the quoting logic
- **Direct BigNumber**: Pass amounts as `BigNumber` instances directly (e.g., `new BigNumber(0.01)`)

### Understanding `zeroForOne` Flag

The `zeroForOne` flag determines the direction of the trade in the pool:

- **`zeroForOne = false`**: Selling `token1` for `token0`
  - `amount0` = output (positive)
  - `amount1` = input (negative)

- **`zeroForOne = true`**: Selling `token0` for `token1`
  - `amount1` = output (positive)
  - `amount0` = input (negative)

### Token Order in Pool

For GALA/SOL (GALA/GSOL) pool:
- `token0` = GALA
- `token1` = GSOL (wrapped SOL)

When selling SOL for GALA:
- Pool structure: `GALA/GSOL`
- We're selling `token1` (GSOL) for `token0` (GALA)
- `zeroForOne = false`
- Output is in `amount0` (GALA)
- **Must use absolute value**: `outputAmount = new BigNumber(quoteResult.amount0 || '0').abs()`

### Correct Implementation Pattern

```typescript
// 1. Determine pool structure and direction
const isToken0Quote = quoteKey < tokenKey; // GALA < GSOL
if (isToken0Quote) {
  token0Key = quoteKey;  // GALA
  token1Key = tokenKey;  // GSOL
  zeroForOne = false;    // Selling token1 (SOL) for token0 (GALA)
}

// 2. Create quote DTO with human-readable amount
const quoteDto = new QuoteExactAmountDto(
  token0Key,
  token1Key,
  fee,
  amount, // Human-readable (e.g., 0.01 SOL)
  zeroForOne,
  compositePoolData
);

// 3. Get quote result
const quoteResult = await quoteExactAmount(null, quoteDto);

// 4. Extract output with absolute value
let outputAmount: BigNumber;
if (zeroForOne) {
  outputAmount = new BigNumber(quoteResult.amount1 || '0');
} else {
  outputAmount = new BigNumber(quoteResult.amount0 || '0');
}

// 5. CRITICAL: Always use absolute value
outputAmount = outputAmount.abs();
```

### Common Pitfalls

1. **Forgetting `.abs()`**: The quote result can be negative, leading to negative prices
2. **Wrong amount extraction**: Using `amount1` when `zeroForOne = false` or vice versa
3. **Converting to raw amounts**: Don't convert - pass human-readable values directly
4. **Wrong `zeroForOne` flag**: Confusing which token is being sold

### Reverse Quote Fallback

When direct quote fails with "Not enough liquidity", we can use a reverse quote:

```typescript
// Estimate amount needed (e.g., ~18,000 GALA per SOL)
const estimatedGalaNeeded = solAmount.multipliedBy(18000);

// Quote selling GALA for SOL
const reverseQuoteDto = new QuoteExactAmountDto(
  token0Key,  // GALA
  token1Key,  // GSOL
  fee,
  estimatedGalaNeeded,
  true, // zeroForOne=true: selling token0 (GALA) for token1 (SOL)
  compositePoolData
);

const reverseQuoteResult = await quoteExactAmount(null, reverseQuoteDto);
const solReceived = new BigNumber(reverseQuoteResult.amount1 || '0').abs();

// Calculate price and expected output
const pricePerSol = estimatedGalaNeeded.div(solReceived);
const expectedOutput = solAmount.multipliedBy(pricePerSol);
```

### Expected Results

For GALA/SOL pool:
- **Expected price**: ~18,000 GALA per SOL
- **Quote size**: Use small amounts like `0.01 SOL` or `0.001 SOL` for testing
- **Price impact**: Should be reasonable (typically < 100 bps for small trades)

### Debugging Tips

1. **Log quote parameters**: Include `token0`, `token1`, `amount`, `zeroForOne`, `sellingToken`, `receivingToken`
2. **Log quote result**: Check both `amount0` and `amount1` values
3. **Verify absolute value**: Ensure output is positive after `.abs()`
4. **Check price calculation**: `price = outputAmount / inputAmount` should yield expected values

### Summary

The key takeaways are:
1. ✅ Use human-readable amounts directly (no conversions)
2. ✅ Always apply `.abs()` to output amounts
3. ✅ Correctly identify which amount field to extract based on `zeroForOne`
4. ✅ Understand pool token order (`token0` vs `token1`)
5. ✅ Use reverse quotes as fallback when direct quotes fail

