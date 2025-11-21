# Services Module

## Overview

The services module provides unified interfaces for external service integrations, primarily focused on Jupiter (Solana DEX aggregator) functionality. It supports both direct API calls and MCP (Model Context Protocol) server integration.

## Architecture

The services module consists of:

1. **JupiterService**: High-level unified interface for Jupiter operations
2. **JupiterMcpClient**: MCP server client for Jupiter (optional)
3. **index.ts**: Module exports

---

## Core Components

### JupiterService

**Purpose**: Provides a unified interface for Jupiter swap operations, abstracting away the differences between direct API calls and MCP server integration.

**Key Features**:
- Automatic fallback between MCP and direct API
- Quote fetching with price impact
- Swap transaction generation
- Error handling and retry logic
- Support for both ExactIn and ExactOut swap modes

**Public API**:

```typescript
class JupiterService {
  // Initialize the service (connect to MCP if enabled)
  async initialize(): Promise<void>

  // Close the service (disconnect from MCP if connected)
  async close(): Promise<void>

  // Get a swap quote from Jupiter
  async getQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult | null>

  // Generate a swap transaction
  async getSwapTransaction(params: JupiterSwapParams): Promise<JupiterSwapResult | null>
}
```

**Interfaces**:

```typescript
interface JupiterQuoteParams {
  inputMint: string;        // Solana mint address
  outputMint: string;       // Solana mint address
  amount: string;           // Raw amount in base units
  slippageBps: number;      // Slippage in basis points
  swapMode?: 'ExactIn' | 'ExactOut';
}

interface JupiterQuoteResult {
  inAmount: string;         // Input amount (raw)
  outAmount: string;        // Output amount (raw)
  priceImpact?: number;     // Price impact percentage
  routePlan?: any;          // Route details
  priceImpactPct?: number;  // Price impact as percentage
}

interface JupiterSwapParams {
  quoteResponse: any;       // Quote response from getQuote
  userPublicKey: string;    // User's Solana public key
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: string;
}

interface JupiterSwapResult {
  swapTransaction: string;  // Base64 encoded transaction
}
```

**Usage Example**:

```typescript
import { JupiterService } from './services/jupiterService';

const jupiterService = new JupiterService();
await jupiterService.initialize();

// Get a quote
const quote = await jupiterService.getQuote({
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  outputMint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', // MEW
  amount: '150000000', // 1500 MEW (5 decimals) in base units
  slippageBps: 50, // 0.5% slippage
  swapMode: 'ExactOut'
});

if (quote) {
  console.log(`Will receive ${quote.outAmount} tokens`);
  console.log(`Price impact: ${quote.priceImpactPct}%`);

  // Generate swap transaction
  const swapTx = await jupiterService.getSwapTransaction({
    quoteResponse: quote,
    userPublicKey: 'YOUR_SOLANA_PUBLIC_KEY',
    wrapAndUnwrapSol: true
  });

  if (swapTx) {
    // swapTx.swapTransaction is base64 encoded, ready to sign and send
  }
}

await jupiterService.close();
```

**Configuration**:

The service automatically detects which mode to use:

- **MCP Mode**: Set `USE_JUPITER_MCP=true` in environment
- **Direct API Mode**: Default (uses Jupiter Lite API)

**Environment Variables**:

```bash
# MCP Mode
USE_JUPITER_MCP=true
JUPITER_MCP_SERVER_PATH=/path/to/mcp/server

# Direct API Mode (default)
JUPITER_API_BASE=https://lite-api.jup.ag/swap/v1
JUPITER_API_KEY=your_api_key_here  # Optional, for v6 API
```

---

### JupiterMcpClient

**Purpose**: Low-level client for communicating with the Jupiter Swap MCP server. This is an optional component that provides an alternative to direct API calls.

**Key Features**:
- Connects to MCP server via stdio transport
- Provides quote and swap execution via MCP protocol
- Automatic connection management
- Error handling and reconnection

**Public API**:

```typescript
class JupiterMcpClient {
  // Connect to MCP server
  async connect(): Promise<void>

  // Disconnect from MCP server
  async disconnect(): Promise<void>

  // Get swap quote via MCP
  async getSwapQuote(params: JupiterMcpSwapQuoteParams): Promise<JupiterMcpSwapQuoteResult>

  // Execute swap via MCP
  async executeSwap(params: JupiterMcpSwapExecuteParams): Promise<JupiterMcpSwapExecuteResult>
}
```

**Interfaces**:

```typescript
interface JupiterMcpSwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;        // in lamports/base units
  slippageBps?: number;
}

interface JupiterMcpSwapQuoteResult {
  inAmount: string;
  outAmount: string;
  priceImpact?: number;
  route?: any;
}

interface JupiterMcpSwapExecuteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}

interface JupiterMcpSwapExecuteResult {
  signature?: string;
  error?: string;
}
```

**Usage Example**:

```typescript
import { JupiterMcpClient } from './services/jupiterMcpClient';

const mcpClient = new JupiterMcpClient('/path/to/mcp/server');
await mcpClient.connect();

try {
  const quote = await mcpClient.getSwapQuote({
    inputMint: 'USDC_MINT',
    outputMint: 'MEW_MINT',
    amount: '150000000',
    slippageBps: 50
  });

  if (quote) {
    const result = await mcpClient.executeSwap({
      inputMint: 'USDC_MINT',
      outputMint: 'MEW_MINT',
      amount: '150000000',
      slippageBps: 50
    });
  }
} finally {
  await mcpClient.disconnect();
}
```

**Dependencies**:

- `@modelcontextprotocol/sdk`: MCP SDK (optional dependency)
- MCP server must be installed and built separately

**MCP Server Setup**:

See: https://github.com/techsavvy5416/solana-jupiter-swap-mcp

---

## Integration with Other Modules

### With SolanaPriceProvider

The `JupiterService` is used internally by `SolanaPriceProvider`:

```typescript
// In SolanaPriceProvider
const jupiterService = new JupiterService();
await jupiterService.initialize();

const quote = await jupiterService.getQuote({
  inputMint: quoteTokenMint,
  outputMint: tokenMint,
  amount: rawAmount,
  slippageBps: 50,
  swapMode: 'ExactOut'
});
```

### With SolanaExecutor

The `JupiterService` is used to generate swap transactions:

```typescript
// In SolanaExecutor
const swapTx = await jupiterService.getSwapTransaction({
  quoteResponse: quote,
  userPublicKey: wallet.publicKey.toBase58(),
  wrapAndUnwrapSol: true
});
```

---

## Error Handling

Both `JupiterService` and `JupiterMcpClient` include comprehensive error handling:

- **Network errors**: Retried with exponential backoff
- **API errors**: Logged with full context
- **MCP connection errors**: Falls back to direct API if MCP fails
- **Invalid quotes**: Returns `null` with error logged

---

## MCP vs Direct API

### MCP Mode Advantages

- Potentially better rate limiting
- Local processing
- Custom routing logic

### Direct API Mode Advantages

- No additional setup required
- Simpler deployment
- Standard Jupiter API features

**Recommendation**: Use direct API mode unless you have specific requirements for MCP.

---

## Rate Limiting

Jupiter API has rate limits. The service includes:

- Automatic retry with exponential backoff
- Quote caching (handled by price providers)
- Sequential strategy evaluation with delays

**Best Practices**:
- Cache quotes when possible
- Add delays between multiple quote requests
- Use MCP mode if rate limits become an issue

---

## Common Patterns

### Getting a Quote

```typescript
const jupiterService = new JupiterService();
await jupiterService.initialize();

const quote = await jupiterService.getQuote({
  inputMint: 'USDC_MINT',
  outputMint: 'TOKEN_MINT',
  amount: '1000000000', // 1 token (9 decimals)
  slippageBps: 50,
  swapMode: 'ExactOut'
});

if (!quote) {
  console.error('Failed to get quote');
  return;
}

console.log(`Quote: ${quote.inAmount} → ${quote.outAmount}`);
console.log(`Price impact: ${quote.priceImpactPct}%`);
```

### Generating Swap Transaction

```typescript
const swapTx = await jupiterService.getSwapTransaction({
  quoteResponse: quote,
  userPublicKey: wallet.publicKey.toBase58(),
  wrapAndUnwrapSol: true,
  dynamicComputeUnitLimit: true
});

if (!swapTx) {
  console.error('Failed to generate swap transaction');
  return;
}

// Decode and sign transaction
const transaction = VersionedTransaction.deserialize(
  Buffer.from(swapTx.swapTransaction, 'base64')
);
transaction.sign([wallet]);

// Send transaction
const signature = await connection.sendTransaction(transaction);
```

---

## Module Exports

The `index.ts` file exports all public types and classes:

```typescript
import {
  JupiterService,
  JupiterMcpClient,
  JupiterQuoteParams,
  JupiterQuoteResult,
  JupiterSwapParams,
  JupiterSwapResult
} from './services';
```

---

## Dependencies

- `axios`: HTTP client for direct API calls
- `@modelcontextprotocol/sdk`: MCP SDK (optional)
- `bignumber.js`: Number handling (used by consumers)

---

## Testing

The service can be tested independently:

```typescript
import { JupiterService } from './services/jupiterService';

const service = new JupiterService();
await service.initialize();

// Test quote
const quote = await service.getQuote({
  inputMint: 'USDC_MINT',
  outputMint: 'MEW_MINT',
  amount: '150000000',
  slippageBps: 50
});

console.log('Quote result:', quote);
```

---

## Troubleshooting

### MCP Connection Issues

- Ensure MCP server is installed and built
- Check `JUPITER_MCP_SERVER_PATH` is correct
- Verify `@modelcontextprotocol/sdk` is installed
- Check MCP server logs for errors

### Rate Limiting

- Reduce quote frequency
- Implement quote caching
- Use MCP mode if available
- Consider upgrading to Jupiter v6 API (requires API key)

### Quote Failures

- Verify mint addresses are correct
- Check token has sufficient liquidity
- Ensure amount is in correct base units (with decimals)
- Try different swap modes (ExactIn vs ExactOut)

