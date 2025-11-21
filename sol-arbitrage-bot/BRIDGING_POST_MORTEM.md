# Bridging Post-Mortem: GalaChain ↔ Solana

## Overview

This document consolidates learnings from implementing automated bridging between GalaChain and Solana. It covers both directions (GC→SOL and SOL→GC), endpoint usage, common pitfalls, and best practices for developers and AI agents implementing bridging automation.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [GalaChain → Solana Bridging](#galachain--solana-bridging)
3. [Solana → GalaChain Bridging](#solana--galachain-bridging)
4. [Status Checking](#status-checking)
5. [Balance Verification](#balance-verification)
6. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
7. [Endpoint Reference](#endpoint-reference)
8. [Code Examples](#code-examples)

---

## Architecture Overview

Bridging between GalaChain and Solana is **asymmetric** - each direction uses different mechanisms:

- **GC→SOL**: Uses GalaChain DEX API endpoints with signed DTOs
- **SOL→GC**: Uses Solana program instructions (on-chain transactions)

Both directions require:
- Proper fee estimation
- Transaction signing
- Status monitoring (different approaches per direction)
- Balance verification

---

## GalaChain → Solana Bridging

### Flow Overview

1. Fetch bridge fee
2. Build and sign `RequestTokenBridgeOutDto`
3. Submit `RequestTokenBridgeOut` → get `bridgeRequestId`
4. Submit `BridgeTokenOut` → get transaction `hash`
5. Poll status using the `hash`

### Step-by-Step Implementation

#### 1. Fetch Bridge Fee

**Endpoint**: `POST /v1/bridge/fee` (DEX API)

**Base URL**: `https://dex-api-platform-dex-prod-gala.gala.com`

**Request**:
```json
{
  "chainId": "Solana",
  "bridgeToken": {
    "collection": "GALA",
    "category": "Unit",
    "type": "none",
    "additionalKey": "none"
  }
}
```

**Response**: `OracleBridgeFeeAssertionDto`
```typescript
{
  estimatedTotalTxFeeInGala: BigNumber;
  estimatedPricePerTxFeeUnit: BigNumber;
  bridgeToken: BridgeTokenDescriptor;
  // ... other fields
}
```

**Important**: The fee is returned as a DTO that must be used directly in the bridge request. Do not modify it.

#### 2. Build RequestTokenBridgeOutDto

Use `@gala-chain/api` DTOs:

```typescript
import { RequestTokenBridgeOutDto, TokenInstanceKey, TokenClassKey } from '@gala-chain/api';
import { instanceToPlain } from 'class-transformer';

const tokenClass = new TokenClassKey();
tokenClass.collection = 'GALA';
tokenClass.category = 'Unit';
tokenClass.type = 'none';
tokenClass.additionalKey = 'none';

const tokenInstance = TokenInstanceKey.fungibleKey(tokenClass);

const dto = new RequestTokenBridgeOutDto();
dto.destinationChainId = 1002; // Solana chain ID
dto.tokenInstance = tokenInstance;
dto.quantity = new BigNumber('10'); // Amount to bridge
dto.recipient = 'SOLANA_WALLET_ADDRESS'; // Solana wallet address
dto.destinationChainTxFee = fee; // From step 1
dto.uniqueKey = `galaswap-operation-${Date.now()}-${Math.random().toString(36).substring(7)}`;
```

**Critical**: The `uniqueKey` **must** start with `"galaswap-operation-"` or validation will fail.

#### 3. Sign the DTO

```typescript
const privateKey = bridgePriv.trim().startsWith('0x') 
  ? bridgePriv.trim() 
  : `0x${bridgePriv.trim()}`;

dto.sign(privateKey); // Built-in method from @gala-chain/api
```

#### 4. Serialize and Fix BigNumber Format

**Critical Issue**: The API rejects exponential notation (e.g., `"1e-9"`). All numbers must be in fixed notation.

```typescript
const fixBigNumberSerialization = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof BigNumber) {
    return obj.toFixed().replace(/\.?0+$/, ''); // Remove trailing zeros
  }
  if (typeof obj === 'string' && /^[\d.]+[eE][+-]?\d+$/.test(obj)) {
    const bn = new BigNumber(obj);
    return bn.toFixed().replace(/\.?0+$/, '');
  }
  if (Array.isArray(obj)) {
    return obj.map(fixBigNumberSerialization);
  }
  if (typeof obj === 'object' && obj.constructor === Object) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = fixBigNumberSerialization(value);
    }
    return result;
  }
  return obj;
};

const dtoPayload = instanceToPlain(dto, {
  enableImplicitConversion: true,
  exposeDefaultValues: true,
}) as any;

const fixedPayload = fixBigNumberSerialization(dtoPayload);
```

#### 5. Submit RequestTokenBridgeOut

**Endpoint**: `POST /v1/RequestTokenBridgeOut` (DEX API)

**Request**: The fixed payload from step 4

**Response**: 
```typescript
{
  Data?: string;        // bridgeRequestId (preferred)
  data?: string | {    // Alternative formats
    Data?: string;
  };
  // ... other fields
}
```

**Extract bridgeRequestId**:
```typescript
let bridgeRequestId: string | undefined;
if (typeof req === 'object' && req !== null) {
  const request = req as any;
  if (typeof request.Data === 'string') {
    bridgeRequestId = request.Data;
  } else if (request.data != null) {
    if (typeof request.data === 'string') {
      bridgeRequestId = request.data;
    } else if (typeof request.data === 'object') {
      const dataObj = request.data as { Data?: unknown };
      if (typeof dataObj.Data === 'string') {
        bridgeRequestId = dataObj.Data;
      }
    }
  }
}
```

#### 6. Submit BridgeTokenOut

**Endpoint**: `POST /v1/BridgeTokenOut` (DEX API)

**Request**:
```json
{
  "bridgeFromChannel": "asset",
  "bridgeRequestId": "<from step 5>"
}
```

**Response**:
```typescript
{
  Hash?: string;    // Transaction hash (preferred)
  hash?: string;    // Alternative format
  // ... other fields
}
```

**Extract hash**:
```typescript
const hash = (out as any)?.Hash || (out as any)?.hash;
```

#### 7. Poll Status

See [Status Checking](#status-checking) section below.

---

## Solana → GalaChain Bridging

### Flow Overview

1. Build Solana transaction with bridge instruction
2. Sign and send transaction
3. Confirm transaction on Solana
4. (Optional) Register transaction with Gala (often fails, not required)

### Step-by-Step Implementation

#### 1. Native SOL Bridging

**Program**: Gala Solana Bridge Program (from `GC_SOL_BRIDGE_PROGRAM` env var)

**Instruction Discriminator**: `[243, 44, 75, 224, 249, 206, 98, 79]`

**Accounts Required**:
- User (signer, writable)
- Bridge Token Authority (PDA: `['bridge_token_authority']`)
- Native Bridge PDA (PDA: `['native_sol_bridge']`)
- Config PDA (PDA: `['configv1']`)
- System Program

**Instruction Data**:
```typescript
const amountLamports = BigInt(Math.floor(amountSol * 1_000_000_000));
const amountBuffer = Buffer.alloc(8);
amountBuffer.writeBigUInt64LE(amountLamports);

const recipientBytes = Buffer.from(galaWalletIdentity, 'utf8');
const recipientLength = Buffer.alloc(4);
recipientLength.writeUInt32LE(recipientBytes.length);

const instructionData = Buffer.concat([
  BRIDGE_OUT_NATIVE_DISCRIMINATOR,
  amountBuffer,
  recipientLength,
  recipientBytes,
]);
```

**Transaction Construction**:
```typescript
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

const connection = new Connection(rpcUrl, 'confirmed');
const keypair = Keypair.fromSecretKey(bs58.decode(solanaPrivateKeyBase58));
const programId = new PublicKey(galaBridgeProgramId);

// Derive PDAs
const [bridgeTokenAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('bridge_token_authority')],
  programId,
);
const [nativeBridgePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('native_sol_bridge')],
  programId,
);
const [configPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('configv1')],
  programId,
);

const ix = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: bridgeTokenAuthority, isSigner: false, isWritable: true },
    { pubkey: nativeBridgePda, isSigner: false, isWritable: false },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: instructionData,
});

const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  ix,
);

tx.feePayer = keypair.publicKey;
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
tx.recentBlockhash = blockhash;
tx.sign(keypair);

const signature = await connection.sendRawTransaction(tx.serialize(), {
  skipPreflight: false,
  preflightCommitment: 'confirmed',
});

await connection.confirmTransaction(
  { signature, blockhash, lastValidBlockHeight },
  'confirmed'
);
```

#### 2. SPL Token Bridging

**Instruction Discriminator**: `[27, 194, 57, 119, 215, 165, 247, 150]`

**Additional Accounts Required**:
- User Token Account (associated token account)
- Token Mint
- Mint Lookup PDA (PDA: `['mint_lookup_v1', mint.toBuffer()]`)
- Token Bridge (from mint lookup account data)
- Bridge Token Account (associated token account for bridge)
- Token Program

**Mint Lookup**:
```typescript
const [mintLookup] = PublicKey.findProgramAddressSync(
  [Buffer.from('mint_lookup_v1'), mint.toBuffer()],
  programId,
);

const lookupAccount = await connection.getAccountInfo(mintLookup, 'confirmed');
if (!lookupAccount) {
  throw new Error(`Mint lookup account not found for ${mint.toBase58()}`);
}

// Extract token bridge from lookup account (bytes 8-40)
const tokenBridge = new PublicKey(lookupAccount.data.slice(8, 40));
```

**Instruction Data**:
```typescript
const recipientBytes = Buffer.from(galaWalletIdentity, 'utf8');
const amountBuffer = Buffer.alloc(8);
amountBuffer.writeBigUInt64LE(amountBaseUnits);
const recipientLength = Buffer.alloc(4);
recipientLength.writeUInt32LE(recipientBytes.length);

const instructionData = Buffer.concat([
  BRIDGE_OUT_DISCRIMINATOR,
  amountBuffer,
  recipientLength,
  recipientBytes,
]);
```

#### 3. Transaction Registration (Optional, Often Fails)

**Endpoint**: `POST /v1/bridge/transaction` (GalaConnect API)

**Note**: This endpoint frequently returns 403 errors from CloudFront. The bridge will process **regardless** of registration success. Since we don't use status polling for Solana bridges, registration can be skipped entirely.

If you do attempt registration:
```typescript
try {
  await client.registerBridgeTransaction({
    quantity: amount.toString(),
    tokenInstance: {
      collection: 'GSOL', // or token descriptor
      category: 'Unit',
      type: 'none',
      additionalKey: 'none',
      instance: '0',
    },
    fromChain: 'Solana',
    toChain: 'GC',
    hash: signature,
  });
} catch (error) {
  // Registration failure is non-fatal - bridge will still process
  console.warn('Registration failed (non-fatal):', error);
}
```

---

## Status Checking

### GalaChain → Solana

**Endpoint**: `POST /v1/bridge/status` (DEX API)

**Base URL**: `https://dex-api-platform-dex-prod-gala.gala.com`

**Request**:
```json
{
  "hash": "<transaction_hash_from_BridgeTokenOut>"
}
```

**Response**:
```typescript
{
  data?: {
    status: number;              // 5 = completed, <5 = in progress
    statusDescription: string;
    fromChain: string;
    toChain: string;
    quantity: string;
    emitterTransactionHash?: string;
    receiverTransactionHash?: string;
  };
  status?: number;              // Alternative format
  statusDescription?: string;
}
```

**Polling Logic**:
```typescript
async function pollBridgeStatus(hash: string, timeoutMs = 30 * 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await client.getBridgeStatus(hash);
      const s = status?.data?.status ?? status?.status;
      const desc = status?.data?.statusDescription ?? status?.statusDescription;
      
      if (s >= 5) {
        if (s === 5) {
          console.log('Bridge completed successfully');
        } else {
          console.log(`Bridge failed (status ${s})`);
        }
        break;
      }
    } catch (error: any) {
      // Handle 404 as "not yet available"
      if (error?.status === 404) {
        console.log('Status not yet available (404), waiting...');
      } else {
        console.error('Error checking status:', error);
      }
    }
    await new Promise((r) => setTimeout(r, 15_000)); // Poll every 15 seconds
  }
}
```

### Solana → GalaChain

**Important**: Status checking for Solana bridges is **not reliable**. The Solana transaction signature is not recognized by the status endpoint (returns 400 `INVALID_TRANSACTION_HASH`).

**Recommended Approach**: 
- Skip status polling for Solana bridges
- Verify completion by checking balances after a delay (60+ seconds)
- The bridge processes asynchronously on GalaChain side

---

## Balance Verification

### GalaChain Balances

**Endpoint**: `POST /v1/FetchBalances` (DEX API or GalaConnect API)

**Request**:
```json
{
  "owner": "<GALACHAIN_WALLET_ADDRESS>"
}
```

**Response Normalization**:
```typescript
let balancesList: any[] = [];
if (Array.isArray(resp?.balances)) {
  balancesList = resp.balances;
} else if (Array.isArray(resp?.data?.balances)) {
  balancesList = resp.data.balances;
} else if (Array.isArray(resp?.Data)) {
  balancesList = resp.Data;
} else if (Array.isArray(resp)) {
  balancesList = resp;
}
```

**Token Key Format**: `"collection|category|type|additionalKey"`

### Solana Balances

#### Native SOL

```typescript
const connection = new Connection(rpcUrl, 'confirmed');
const ownerPk = new PublicKey(walletAddress);
const lamports = await connection.getBalance(ownerPk, 'confirmed');
const solBalance = new BigNumber(lamports).dividedBy(1_000_000_000);
```

#### SPL Tokens

**Critical**: Use `programId` filter, **not** `mint` filter. Filtering by `mint` requires premium RPC tier and will return 403 on free tiers.

**Correct Approach**:
```typescript
// Get all token accounts (works on free tier RPCs)
const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
  ownerPk,
  { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
);

// Filter by mint in code
for (const acc of tokenAccounts.value) {
  const data = acc.account.data;
  if ((data as any).program === 'spl-token') {
    const info = (data as any).parsed.info;
    if (info.mint === tokenMint) {
      const uiAmount = info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0;
      return new BigNumber(uiAmount);
    }
  }
}
```

**Incorrect Approach** (requires premium tier):
```typescript
// ❌ DON'T DO THIS - requires premium RPC tier
const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
  ownerPk,
  { mint: new PublicKey(tokenMint) }  // This will fail with 403 on free tiers
);
```

---

## Common Pitfalls & Solutions

### 1. BigNumber Serialization

**Problem**: API rejects exponential notation (`"1e-9"`)

**Solution**: Always convert to fixed notation and remove trailing zeros:
```typescript
const fixBigNumberSerialization = (obj: any): any => {
  // ... (see GalaChain → Solana section above)
};
```

### 2. uniqueKey Validation

**Problem**: `uniqueKey` must start with `"galaswap-operation-"`

**Solution**:
```typescript
const uniqueKey = `galaswap-operation-${Date.now()}-${Math.random().toString(36).substring(7)}`;
```

### 3. Status Endpoint for Solana Bridges

**Problem**: Solana transaction signatures are not recognized by status endpoint

**Solution**: Skip status polling, verify via balance checks after delay

### 4. Registration Endpoint 403 Errors

**Problem**: `POST /v1/bridge/transaction` returns 403 CloudFront errors

**Solution**: Registration is optional - bridge processes regardless. Skip it if not needed.

### 5. SPL Token Balance Fetching

**Problem**: Using `mint` filter requires premium RPC tier

**Solution**: Use `programId` filter and filter in code (see Balance Verification section)

### 6. Endpoint Confusion

**Problem**: Multiple base URLs (connect.gala.com vs dex-api-platform-dex-prod-gala.gala.com)

**Solution**:
- **Bridge operations** (fee, request, status): Use DEX API (`dex-api-platform-dex-prod-gala.gala.com`)
- **Registration** (optional): Use GalaConnect API (`connect.gala.com`) - but often fails
- **Balances**: Can use either, but DEX API is more reliable

### 7. Response Format Variations

**Problem**: API responses have inconsistent field names (`Data` vs `data`, `Hash` vs `hash`)

**Solution**: Always check multiple possible field names:
```typescript
const bridgeRequestId = request.Data || request.data || request.data?.Data;
const hash = response.Hash || response.hash;
```

---

## Endpoint Reference

### DEX API Base URL
`https://dex-api-platform-dex-prod-gala.gala.com`

### GalaConnect API Base URL
`https://connect.gala.com`

### Endpoints

| Endpoint | Method | Base | Purpose | Required |
|----------|--------|------|---------|----------|
| `/v1/bridge/fee` | POST | DEX API | Get bridge fee | ✅ |
| `/v1/RequestTokenBridgeOut` | POST | DEX API | Request bridge (GC→SOL) | ✅ |
| `/v1/BridgeTokenOut` | POST | DEX API | Execute bridge (GC→SOL) | ✅ |
| `/v1/bridge/status` | POST | DEX API | Check bridge status (GC→SOL) | ✅ |
| `/v1/bridge/transaction` | POST | GalaConnect | Register Solana bridge | ❌ (optional, often fails) |
| `/v1/FetchBalances` | POST | DEX API or GalaConnect | Get GalaChain balances | ✅ |

### Solana RPC Endpoints

- Use `SOLANA_BALANCE_RPC_URL` for balance checks (if available)
- Fall back to `SOLANA_RPC_URL` or public RPC
- For balance checks, prefer dedicated balance RPC to avoid rate limits

---

## Code Examples

### Complete GC→SOL Bridge Example

See `src/test-bridge-out.ts` for a complete working example.

### Complete SOL→GC Bridge Example

See `src/test-bridge-in.ts` for a complete working example.

### Complete Round-Trip Example

See `src/test-bridge-roundtrip.ts` for a complete round-trip example with balance verification.

---

## Testing Checklist

When implementing bridging, verify:

- [ ] Bridge fee is fetched correctly
- [ ] DTO is signed properly
- [ ] BigNumber serialization fixes exponential notation
- [ ] `uniqueKey` starts with `"galaswap-operation-"`
- [ ] Bridge request ID is extracted correctly (check multiple response formats)
- [ ] Bridge hash is extracted correctly (check multiple response formats)
- [ ] Status polling works for GC→SOL bridges
- [ ] Balance checks use `programId` filter (not `mint` filter) for SPL tokens
- [ ] Balance verification shows expected changes after bridge
- [ ] Error handling for optional steps (registration) doesn't block bridge execution

---

## Environment Variables

Required for bridging:

```bash
# GalaChain → Solana
GALACHAIN_WALLET_ADDRESS=<gala_wallet>
BRIDGE_PRIVATE_KEY=<ethereum_private_key>
SOLANA_WALLET_ADDRESS=<solana_wallet>

# Solana → GalaChain
SOLANA_PRIVATE_KEY=<base58_encoded_solana_key>
GC_SOL_BRIDGE_PROGRAM=<gala_bridge_program_id>
SOLANA_RPC_URL=<solana_rpc_endpoint>
SOLANA_BALANCE_RPC_URL=<optional_dedicated_balance_rpc>

# Optional
GALA_CONNECT_BASE_URL=https://connect.gala.com
GALACHAIN_API_BASE_URL=https://api.galachain.io
```

---

## Summary

Key takeaways:

1. **GC→SOL**: Use DEX API endpoints with signed DTOs. Status polling works.
2. **SOL→GC**: Use Solana program instructions. Status polling doesn't work - verify via balances.
3. **BigNumber serialization**: Always convert to fixed notation, remove trailing zeros.
4. **SPL token balances**: Use `programId` filter, filter in code.
5. **Registration**: Optional and often fails - can be skipped.
6. **Response formats**: Always check multiple possible field names.
7. **Balance verification**: Best way to confirm bridge completion, especially for SOL→GC.

---

## Related Files

- `src/bridging/galaConnectClient.ts` - Gala API client
- `src/bridging/solanaBridge.ts` - Solana bridge functions
- `src/bridging/bridgeManager.ts` - High-level bridge manager
- `src/bridging/galaEndpoints.ts` - Endpoint configuration
- `src/test-bridge-out.ts` - GC→SOL test
- `src/test-bridge-in.ts` - SOL→GC test
- `src/test-bridge-roundtrip.ts` - Round-trip test with balance verification

---

*Last Updated: Based on implementation experience through 2025*

