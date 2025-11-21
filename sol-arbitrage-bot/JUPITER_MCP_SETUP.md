# Jupiter Swap MCP Integration Setup

This bot now supports integration with the [Solana Jupiter Swap MCP server](https://github.com/techsavvy5416/solana-jupiter-swap-mcp) for enhanced Jupiter swap functionality.

## Overview

The Jupiter Swap MCP integration provides an alternative way to interact with Jupiter aggregator for Solana token swaps. The bot can use either:
- **Direct Jupiter API** (default) - Direct HTTP calls to Jupiter API
- **MCP Server** (optional) - Model Context Protocol server for Jupiter swaps

## Setup Instructions

### 1. Install the MCP Server

The MCP server must be cloned and built separately:

```bash
# Clone the MCP server repository
git clone https://github.com/techsavvy5416/solana-jupiter-swap-mcp.git
cd solana-jupiter-swap-mcp

# Install dependencies
npm install

# Build the server
npm run build
```

The built server will be located at: `solana-jupiter-swap-mcp/build/index.js`

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# Enable MCP mode (set to 'true' to use MCP, 'false' for direct API)
USE_JUPITER_MCP=true

# Path to the built MCP server (required if USE_JUPITER_MCP=true)
JUPITER_MCP_SERVER_PATH=/path/to/solana-jupiter-swap-mcp/build/index.js

# These are already required for Solana operations
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_encoded_private_key
```

### 3. Verify Installation

The bot will automatically:
- Try to connect to the MCP server if `USE_JUPITER_MCP=true`
- Fall back to direct Jupiter API if MCP connection fails
- Log which mode is being used

Check your logs for messages like:
- `🔄 Jupiter Service: Using MCP mode` - MCP is enabled
- `✅ Connected to Jupiter Swap MCP server` - MCP connected successfully
- `⚠️ Failed to initialize MCP client, falling back to direct API` - MCP failed, using direct API

## Usage

Once configured, the bot will automatically use the MCP server for Jupiter swaps when enabled. The integration is transparent - all existing bot functionality works the same way.

### MCP Features Available

The MCP server provides access to:
- `getSwapQuote` - Get best swap quotes from Jupiter
- `executeSwap` - Execute token swaps (returns signature directly)
- `getBalance` - Get SOL balance for an address
- `getMyAddress` - Get wallet address from private key
- `getSplTokenBalances` - Get SPL token balances

## Troubleshooting

### MCP Server Not Found

**Error:** `MCP server not found at [path]`

**Solution:** 
1. Verify the `JUPITER_MCP_SERVER_PATH` points to the correct location
2. Ensure you've built the MCP server with `npm run build`
3. Use an absolute path for `JUPITER_MCP_SERVER_PATH`

### MCP Connection Fails

**Error:** `Failed to connect to Jupiter Swap MCP server`

**Solutions:**
1. Verify `SOLANA_RPC_URL` and `SOLANA_PRIVATE_KEY` are set correctly
2. Check that the MCP server builds without errors
3. The bot will automatically fall back to direct API mode

### Performance Considerations

- **Direct API:** Lower latency, simpler setup
- **MCP Server:** Better isolation, easier to update swap logic independently

## References

- [Jupiter Swap MCP on LobeHub](https://lobehub.com/mcp/techsavvy5416-solana-jupiter-swap-mcp)
- [MCP Server GitHub Repository](https://github.com/techsavvy5416/solana-jupiter-swap-mcp)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)

