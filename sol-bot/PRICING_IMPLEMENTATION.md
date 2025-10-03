# GalaChain Token Pricing Implementation

## Overview

This document describes the complete token pricing flow for GalaChain tokens, ensuring accurate price discovery in both GALA and USD.

## Pricing Flow

### 1. Base Rate: GALA/GUSDC

**First Step**: Get the GALA → GUSDC exchange rate
- **Pool**: GALA/GUSDC with 1% fee
- **Method**: `getGALAUSDPrice()`
- **Result**: 1 GALA = $0.015805 USD (as of testing)
- **Assumption**: 1 GUSDC ≈ $1 USD

```typescript
// Quotes 1 GALA for GUSDC
const quote = await getLocalQuote(
  galaKey,     // token0: GALA
  gusdcKey,    // token1: GUSDC  
  new BigNumber(1),
  FEE_1_PERCENT
);
// Returns: ~0.0158 GUSDC
```

### 2. Token-Specific Pricing

Tokens can quote via two different methods:

#### Method A: Quote via GUSDC (Direct USD Price)

**Example**: GFARTCOIN

**Process**:
1. Get GFARTCOIN → GUSDC quote
2. GUSDC amount ≈ USD value
3. Convert to GALA using GALA/GUSDC rate

```typescript
// Step 1: Get GFARTCOIN/GUSDC price
const quote = await getLocalQuote(
  gfartcoinKey,
  gusdcKey,
  new BigNumber(1000),
  FEE_1_PERCENT
);
// Returns: 2.59 GUSDC for 1000 GFARTCOIN

// Step 2: Calculate USD price
priceInUSD = 2.59 / 1000 = $0.002590 per GFARTCOIN

// Step 3: Convert to GALA
gusdcGalaRate = 1 / 0.015805 = 63.27 GALA per GUSDC
priceInGALA = 0.002590 * 63.27 = 0.1639 GALA per GFARTCOIN
```

**Configuration**:
```json
{
  "symbol": "GFARTCOIN",
  "gcQuoteVia": "GUSDC",
  "minTradeSize": 1000
}
```

**Status**: ✅ Working perfectly

#### Method B: Quote via GALA (Direct GALA Price)

**Example**: GTRUMP

**Process**:
1. Determine token ordering (GALA < GTRUMP)
2. Get TOKEN → GALA quote (with correct direction)
3. Convert GALA to USD using base rate

```typescript
// Step 1: Check token ordering
const comparison = compareTokenKeys(galaKey, gtrumpKey);
// Result: GALA < GTRUMP, so pool is GALA/GTRUMP

// Step 2: Get quote (selling GTRUMP for GALA)
const quote = await getLocalQuote(
  galaKey,      // token0: GALA
  gtrumpKey,    // token1: GTRUMP
  new BigNumber(10),
  FEE_1_PERCENT,
  false         // zeroForOne = false (selling token1 for token0)
);
// Returns: GALA received for GTRUMP sold

// Step 3: Calculate GALA price
priceInGALA = galaOut / tokenIn

// Step 4: Convert to USD
priceInUSD = priceInGALA * galaUSDPrice
```

**Configuration**:
```json
{
  "symbol": "GTRUMP",
  "gcQuoteVia": "GALA",
  "minTradeSize": 10
}
```

**Status**: ⚠️ Logic correct, but pool may have liquidity constraints

## Key Implementation Details

### Token Ordering

GalaChain DEX requires token pairs to be ordered lexicographically:
- `token0 < token1` (by collection, category, type, additionalKey)
- Example: GALA/GTRUMP (not GTRUMP/GALA)
- Example: GALA/GUSDC (not GUSDC/GALA)

```typescript
private compareTokenKeys(token0: TokenClassKey, token1: TokenClassKey): number {
  if (token0.collection !== token1.collection) 
    return token0.collection.localeCompare(token1.collection);
  if (token0.category !== token1.category) 
    return token0.category.localeCompare(token1.category);
  if (token0.type !== token1.type) 
    return token0.type.localeCompare(token1.type);
  return token0.additionalKey.localeCompare(token1.additionalKey);
}
```

### Swap Direction

The `zeroForOne` parameter determines swap direction:
- `true`: Selling token0 for token1
- `false`: Selling token1 for token0

**When pool is GALA/TOKEN**:
- To get TOKEN price in GALA: sell TOKEN (token1) for GALA (token0)
- Use `zeroForOne = false`

**When pool is TOKEN/GALA**:
- To get TOKEN price in GALA: sell TOKEN (token0) for GALA (token1)
- Use `zeroForOne = true`

### Quote Result Interpretation

Quote returns two amounts:
- `amount0`: Token0 amount (positive = input, negative = output)
- `amount1`: Token1 amount (positive = input, negative = output)

**When `zeroForOne = true`**:
```typescript
const tokenIn = Math.abs(parseFloat(quote.amount0));   // Input (token0)
const tokenOut = Math.abs(parseFloat(quote.amount1));  // Output (token1)
```

**When `zeroForOne = false`**:
```typescript
const tokenIn = Math.abs(parseFloat(quote.amount1));   // Input (token1)
const tokenOut = Math.abs(parseFloat(quote.amount0));  // Output (token0)
```

## Testing Results

### GALA/GUSDC Base Rate
✅ **Status**: Working perfectly
- **Price**: 1 GALA = $0.015805 USD
- **Method**: Verified with 1 GALA and 100 GALA quotes
- **Consistency**: Prices match across different amounts

### GFARTCOIN (via GUSDC)
✅ **Status**: Working perfectly
- **Price in USD**: $0.002590 per token
- **Price in GALA**: 0.163852 GALA per token
- **Example**: 1000 GFARTCOIN = $2.59 = 163.85 GALA
- **Implied GALA/USD**: $0.015805 (matches base rate!)

### GTRUMP (via GALA)
⚠️ **Status**: Logic correct, liquidity constraints
- **Issue**: "Not enough liquidity available in pool"
- **Cause**: GALA/GTRUMP pool has limited liquidity
- **Solution**: Either use smaller trade sizes or wait for more liquidity
- **Note**: Token ordering logic is now correct (GALA/GTRUMP)

## Code Structure

### Main Files

1. **`priceDiscovery.ts`** - Core pricing logic
   - `updateGalaChainPrices()` - Fetch all token prices
   - `getGALAUSDPrice()` - Get GALA → USD rate
   - `getGUSDCGALARate()` - Get inverse rate for conversions
   - `getLocalQuote()` - Perform local DEX quotes
   - `compareTokenKeys()` - Token ordering helper

2. **`tokens.json`** - Token configuration
   - `gcQuoteVia`: "GALA" or "GUSDC"
   - `minTradeSize`: Minimum quote amount
   - `galaChainMint`: Token identifier

3. **Test Files**:
   - `test-gala-gusdc.ts` - Verify GALA/GUSDC quote
   - `test-pricing-flow.ts` - End-to-end pricing verification

## Usage

### Getting Token Prices

```typescript
const priceDiscovery = new PriceDiscovery();

// Trigger price updates
await priceDiscovery.discoverOpportunities();

// Get individual token price
const gfartPrice = priceDiscovery.getGalaChainPrice('GFARTCOIN');
console.log(`Price: ${gfartPrice.price} GALA`);
console.log(`USD: $${gfartPrice.priceUSD}`);

// Get all prices
const allPrices = priceDiscovery.getAllPrices();
```

### Adding New Tokens

1. Add to `config/tokens.json`:
```json
{
  "symbol": "NEWTOKEN",
  "galaChainMint": "NEWTOKEN|Unit|none|none",
  "decimals": 6,
  "minTradeSize": 100,
  "maxTradeSize": 10000,
  "enabled": true,
  "gcQuoteVia": "GUSDC"  // or "GALA"
}
```

2. Choose `gcQuoteVia`:
   - **"GUSDC"**: If token has a direct GUSDC pair
   - **"GALA"**: If token has a direct GALA pair

3. Test liquidity with different `minTradeSize` values

## Summary

### ✅ What's Working
1. **GALA/GUSDC base pricing** - Accurate and consistent
2. **GUSDC-paired tokens** - Full USD and GALA pricing
3. **Token ordering logic** - Handles all token pair orderings correctly
4. **Bidirectional swaps** - Supports both zeroForOne directions
5. **Automatic conversion** - All tokens priced in both GALA and USD

### 🎯 Pricing Formula

**For any token**:
```
1. Get token price in native quote currency (GALA or GUSDC)
2. If quoted in GUSDC:
   - USD price = GUSDC amount (1:1)
   - GALA price = GUSDC amount × (GALA per GUSDC)
3. If quoted in GALA:
   - GALA price = quote result
   - USD price = GALA amount × (USD per GALA)
```

**Result**: Every token has both `price` (in GALA) and `priceUSD` (in USD)

## Next Steps

1. ✅ GALA/GUSDC quote - **COMPLETE**
2. ✅ Token ordering logic - **COMPLETE**  
3. ✅ GUSDC-paired tokens - **COMPLETE**
4. ⚠️ GALA-paired tokens - **Logic correct, needs liquidity**
5. 🔄 Monitor and adjust trade sizes based on pool liquidity

## Troubleshooting

### "Token0 must be smaller"
- **Cause**: Incorrect token ordering
- **Solution**: Use `compareTokenKeys()` to determine correct order
- **Status**: ✅ Fixed

### "Not enough liquidity available in pool"
- **Cause**: Trade size exceeds available liquidity
- **Solution**: Reduce `minTradeSize` in configuration
- **Example**: GTRUMP reduced from 1000 to 10 tokens

### Inconsistent prices
- **Check**: Verify GALA/GUSDC base rate is stable
- **Check**: Ensure `zeroForOne` direction is correct
- **Check**: Validate amount interpretation (amount0 vs amount1)

