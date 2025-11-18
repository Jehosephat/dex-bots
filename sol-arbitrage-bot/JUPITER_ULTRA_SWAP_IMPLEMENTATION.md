# Jupiter Ultra Swap API Implementation Plan

## Overview

Jupiter's Ultra Swap API offers:
- **Dynamic rate limits** that scale with swap volume
- **No Pro plans or payment** - just need an API key
- **Better rate limits** than v1 API
- **Same functionality** as current implementation

## Key Differences from Current API

### Current (v1):
- `/quote` - GET request for quotes
- `/swap` - POST request to build swap transaction

### Ultra Swap:
- `/ultra/order` - POST request for quotes + swap transaction
- `/ultra/execute` - POST request to execute swap (or sign locally)

## Implementation Steps

1. **Create Ultra Swap Client** (`src/services/jupiterUltraClient.ts`)
   - Handle API key authentication
   - Implement Get Order endpoint
   - Implement Execute Order endpoint
   - Handle rate limiting and errors

2. **Update SolanaPriceProvider**
   - Add option to use Ultra Swap for quotes
   - Fallback to current API if Ultra Swap fails
   - Configurable via environment variable

3. **Update SolanaExecutor**
   - Use Ultra Swap for swap execution
   - Fallback to current API if needed

4. **Configuration**
   - Add `JUPITER_ULTRA_API_KEY` to env
   - Add `USE_JUPITER_ULTRA=true` flag
   - Keep current API as fallback

## API Endpoints

### Get Order (Quote + Swap Transaction)
```
POST https://api.jup.ag/ultra/order
Headers:
  Authorization: Bearer {API_KEY}
  Content-Type: application/json

Body:
{
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "1000000000",
  "slippageBps": 50,
  "swapMode": "ExactIn" | "ExactOut",
  "userPublicKey": "...",
  "wrapAndUnwrapSol": true,
  "dynamicComputeUnitLimit": true
}
```

### Execute Order
```
POST https://api.jup.ag/ultra/execute
Headers:
  Authorization: Bearer {API_KEY}
  Content-Type: application/json

Body:
{
  "orderId": "...",
  "signedTransaction": "..."
}
```

## Benefits

1. **Dynamic Rate Limits** - Scales with your swap volume
2. **No Payment Required** - Free API key from portal
3. **Better Reliability** - Less likely to hit rate limits
4. **Backward Compatible** - Can keep current API as fallback

## Migration Strategy

1. Implement Ultra Swap client
2. Add feature flag to enable/disable
3. Test with both APIs side-by-side
4. Gradually migrate to Ultra Swap
5. Keep v1 API as fallback for safety

