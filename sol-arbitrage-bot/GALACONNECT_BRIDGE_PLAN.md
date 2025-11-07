# GalaConnect Bridge API Integration Plan

## Current State Analysis

### What We're Currently Doing (DEX API)
1. **Endpoints**: Using `/v1/RequestTokenBridgeOut` and `/v1/BridgeTokenOut` (DEX API endpoints)
2. **Signing**: Using EIP-712 typed data signing (ethers.js `signTypedData`) with domain `{ name: 'GalaConnect', chainId: 1 }`
3. **Base URL**: Using `dexApiBaseUrl` (`https://dex-api-platform-dex-prod-gala.gala.com`)
4. **Fee Structure**: Fetching fee from `/v1/bridge/fee` endpoint
5. **Unique Key**: Using `galaswap-operation-` prefix

**Note**: This matches what `bridge_round_trip` uses and appears to be working.

### What GalaConnect API Documentation Shows
Based on [GalaConnect API Documentation](https://connect.gala.com/info/api.html):

1. **Base URL**: `https://api-galaswap.gala.com` (different from DEX API)
2. **Endpoints**: 
   - `/v1/RequestBridgeToken` (POST) - Request to bridge a token
   - `/v1/BridgeToken` (POST) - Bridge a token
3. **Signing Method**: **Completely Different!** Uses secp256k1 signing on keccak256 hash of JSON stringified request body (NOT EIP-712)
4. **Required Headers**: `X-Wallet-Address` (we're already doing this)
5. **Required Body Properties**:
   - `signerPublicKey`: Base64-encoded public key (must be fetched from GalaChain)
   - `signature`: Base64-encoded secp256k1 signature (DER format)
   - `uniqueKey`: Must start with `galaconnect-operation-` (not `galaswap-operation-`)

### Two Different APIs?

It appears there are **two separate APIs** for bridging:

1. **DEX API** (`https://dex-api-platform-dex-prod-gala.gala.com`)
   - Endpoints: `/v1/RequestTokenBridgeOut`, `/v1/BridgeTokenOut`
   - Signing: EIP-712 typed data
   - Used by: `bridge_round_trip` (working)

2. **GalaConnect API** (`https://api-galaswap.gala.com`)
   - Endpoints: `/v1/RequestBridgeToken`, `/v1/BridgeToken`
   - Signing: secp256k1 on keccak256 hash
   - Documented in: GalaConnect API docs

**Question**: Are these two different APIs for the same operation, or do they serve different purposes?

## Key Differences

### 1. Signing Mechanism
- **Current (bridge_round_trip style)**: EIP-712 typed data signing
  ```typescript
  wallet.signTypedData(domain, types, message)
  ```

- **GalaConnect API**: secp256k1 signature on keccak256 hash
  ```typescript
  // 1. Recursively order properties alphabetically
  // 2. Stringify to minimal JSON
  // 3. Calculate keccak256 hash
  // 4. Sign hash with secp256k1
  // 5. Normalize signature (s <= n/2)
  // 6. Encode as base64 DER
  ```

### 2. Endpoint Names
- **Current**: `/v1/RequestTokenBridgeOut`, `/v1/BridgeTokenOut`
- **GalaConnect API**: `/v1/RequestBridgeToken`, `/v1/BridgeToken`

### 3. Base URL
- **Current**: `https://dex-api-platform-dex-prod-gala.gala.com`
- **GalaConnect API**: `https://api-galaswap.gala.com`

### 4. Unique Key Prefix
- **Current**: `galaswap-operation-`
- **GalaConnect API**: `galaconnect-operation-`

## Implementation Plan

### Phase 1: Create GalaConnect-Specific Signing Module

**File**: `src/bridging/galaConnectSign.ts`

Implement the signing mechanism as documented in the API:
- Use `json-stringify-deterministic` for deterministic JSON stringification
- Use `elliptic` or `ethers` for secp256k1 signing
- Implement signature normalization (s <= n/2)
- Return base64-encoded DER signature

**Key Functions**:
```typescript
export function signGalaConnectRequest<T extends object>(
  obj: T,
  privateKey: string
): T & { signature: string; signerPublicKey: string }
```

### Phase 2: Update GalaConnectClient

**File**: `src/bridging/galaConnectClient.ts`

1. **Add new methods** for GalaConnect API endpoints:
   - `requestBridgeToken(payload)`: POST to `/v1/RequestBridgeToken`
   - `bridgeToken(payload)`: POST to `/v1/BridgeToken`

2. **Keep existing methods** for backward compatibility (or deprecate if we fully migrate)

3. **Update base URL handling**:
   - Add `galaConnectBaseUrl` option (default: `https://api-galaswap.gala.com`)
   - Use appropriate base URL based on which API we're calling

### Phase 3: Update BridgeManager

**File**: `src/bridging/bridgeManager.ts`

1. **Add new execution method**: `executeGalaConnectBridge()`
   - Uses GalaConnect API endpoints
   - Uses GalaConnect signing mechanism
   - Follows GalaConnect API flow

2. **Flow**:
   ```
   1. Fetch bridge fee (may need to check if this endpoint exists in GalaConnect API)
   2. Build request payload with:
      - destinationChainId
      - tokenInstance
      - quantity
      - recipient
      - uniqueKey (galaconnect-operation-*)
      - signerPublicKey
   3. Sign payload using GalaConnect signing
   4. POST to /v1/RequestBridgeToken
   5. Extract bridge request ID from response
   6. POST to /v1/BridgeToken with bridgeRequestId
   7. Return transaction hash
   ```

### Phase 4: Public Key Management

**File**: `src/bridging/galaConnectClient.ts` or new utility

Add method to fetch public key from GalaChain:
```typescript
async getPublicKey(walletAddress: string): Promise<string>
```
- Endpoint: `POST /galachain/api/asset/public-key-contract/GetPublicKey`
- Body: `{ user: walletAddress }`
- Returns: Base64-encoded public key

### Phase 5: Configuration Updates

**File**: `src/bridging/galaEndpoints.ts`

Add configuration for GalaConnect API:
- `galaConnectBaseUrl`: `https://api-galaswap.gala.com`
- `pathRequestBridgeToken`: `/v1/RequestBridgeToken`
- `pathBridgeToken`: `/v1/BridgeToken`

### Phase 6: Testing & Validation

1. **Test signing mechanism** matches API documentation example
2. **Test with small amount** to verify end-to-end flow
3. **Compare responses** between old and new methods
4. **Handle errors** appropriately

## Questions to Resolve

1. **Fee Endpoint**: Does GalaConnect API have a fee endpoint, or do we still use `/v1/bridge/fee` from DEX API?
2. **Bridge Status**: Does GalaConnect API have a status endpoint, or do we use the existing one?
3. **Compatibility**: Should we support both methods (old and new) or fully migrate?
4. **Public Key Caching**: Should we cache the public key or fetch it each time?

## Dependencies to Add

```json
{
  "json-stringify-deterministic": "^1.0.12",
  "elliptic": "^6.5.4",  // or use ethers.js if already available
  "js-sha3": "^0.8.0"    // for keccak256
}
```

Or use existing `ethers` library if it supports the required operations.

## Migration Strategy

### Option A: Parallel Implementation
- Keep existing bridge methods
- Add new GalaConnect methods
- Allow configuration to choose which to use
- Gradually migrate to GalaConnect API

### Option B: Full Migration
- Replace existing implementation with GalaConnect API
- Update all callers
- Remove old code

**Recommendation**: Start with Option A to validate the new approach, then migrate to Option B once proven.

