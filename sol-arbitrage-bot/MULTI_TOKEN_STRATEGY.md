# Multi-Token Arbitrage Strategy Guide

## Overview

This guide explains how to expand your arbitrage bot to handle multiple token pairs on both GalaChain and Solana for a more robust and diversified arbitrage strategy.

## Current Architecture

The bot currently:
- Iterates through enabled tokens from `config/tokens.json`
- For each token, gets quotes from GalaChain (selling for GALA) and Solana (buying with SOL/USDC)
- Calculates edge and executes if profitable

## Key Considerations

### GalaSwap Limitations (No Routing)

**GalaSwap requires direct pairs** - You can only quote tokens that have a direct liquidity pool:
- ✅ **TOKEN/GALA** pool exists → Can quote selling TOKEN for GALA
- ✅ **TOKEN/GUSDC** pool exists → Can quote selling TOKEN for GUSDC
- ❌ No TOKEN/GALA pool → Cannot quote (even if TOKEN/OTHER and OTHER/GALA exist)

**What this means:**
- You need to identify which tokens have direct pools on GalaSwap
- You can configure multiple quote paths per token (`gcQuoteVia: "GALA"` or `"GUSDC"`)
- The bot will use the configured quote path

### Solana Advantages (Jupiter Routing)

**Solana/Jupiter supports routing** - Automatically finds best path through multiple pools:
- Can route: TOKEN → USDC → SOL
- Can route: TOKEN → SOL directly
- Can route through multiple intermediate tokens

**What this means:**
- Jupiter automatically finds the best route
- You can specify preferred quote tokens (`solQuoteVia: "SOL"` or `"USDC"`)
- Jupiter will find liquidity even if direct pairs don't exist

## Adding More Token Pairs

### Step 1: Identify Available Pools on GalaSwap

First, identify which tokens have direct liquidity pools on GalaSwap:

```typescript
// Research available pools
// Common patterns:
// - TOKEN/GALA pools (most common)
// - TOKEN/GUSDC pools (for stablecoin pairs)
// - TOKEN/GWBTC pools (for BTC pairs)

// Example tokens that might have pools:
// - BONK, WIF, POPCAT, BOME, TRUMP, FARTCOIN, etc.
```

### Step 2: Add Tokens to Configuration

Update `config/tokens.json` to add new token pairs:

```json
{
  "tokens": {
    "SOL": { ... },
    "TRUMP": { ... },
    "FARTCOIN": { ... },
    
    // NEW: Add BONK
    "BONK": {
      "symbol": "BONK",
      "galaChainMint": "GBONK|Unit|none|none",
      "solanaMint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "solanaSymbol": "BONK",
      "decimals": 5,
      "tradeSize": 1000000,  // Adjust based on token price
      "enabled": true,
      "gcQuoteVia": "GALA",  // Must have BONK/GALA pool
      "solQuoteVia": "SOL"   // Jupiter will route
    },
    
    // NEW: Add WIF
    "WIF": {
      "symbol": "WIF",
      "galaChainMint": "GWIF|Unit|none|none",
      "solanaMint": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      "solanaSymbol": "WIF",
      "decimals": 6,
      "tradeSize": 1,  // Adjust based on token price
      "enabled": true,
      "gcQuoteVia": "GALA",
      "solQuoteVia": "USDC"  // Can use USDC or SOL
    }
  },
  
  "quoteTokens": {
    // Add any new quote tokens if needed
    "GUSDT": {
      "galaChainMint": "GUSDT|Unit|none|none",
      "solanaMint": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      "decimals": 6
    }
  }
}
```

### Step 3: Configure Trade Sizes

**Important**: Set appropriate `tradeSize` based on token price and liquidity:

```typescript
// Low-price tokens (e.g., BONK ~$0.00001)
tradeSize: 1000000  // 1M tokens = $10-100

// Medium-price tokens (e.g., TRUMP ~$10)
tradeSize: 0.01     // 0.01 tokens = $0.10

// High-price tokens (e.g., SOL ~$180)
tradeSize: 0.01     // 0.01 SOL = $1.80
```

### Step 4: Support Multiple Quote Paths (GalaSwap)

To handle tokens that might quote via GALA or GUSDC, you can:

**Option A: Configure one quote path per token**
```json
{
  "gcQuoteVia": "GALA"  // Primary path
}
```

**Option B: Enhance code to try multiple quote paths**
```typescript
// In GalaChainPriceProvider.getQuote()
// Try primary quote path, fallback to secondary if available
const quoteVia = tokenConfig.gcQuoteVia || 'GALA';
const fallbackQuoteVia = tokenConfig.gcQuoteViaFallback; // New config field

try {
  quote = await this.getLocalQuote(symbol, quoteVia, amount, fee);
} catch (error) {
  if (fallbackQuoteVia) {
    quote = await this.getLocalQuote(symbol, fallbackQuoteVia, amount, fee);
  }
}
```

### Step 5: Support Multiple Quote Tokens (Solana)

For Solana, you can already specify different quote tokens:

```json
{
  "solQuoteVia": "SOL",   // Buy with SOL
  // OR
  "solQuoteVia": "USDC"   // Buy with USDC
}
```

**Note**: The bot automatically converts both to GALA for edge calculation.

## Enhanced Strategy: Opportunity Ranking

Currently, the bot evaluates tokens sequentially. You could enhance it to:

1. **Evaluate all tokens first**
2. **Rank opportunities by edge**
3. **Execute best opportunity first**

```typescript
// In mainLoop.ts
const opportunities: Array<{
  token: TokenConfig;
  edge: EdgeCalculationResult;
  riskResult: RiskCheckResult;
}> = [];

// Evaluate all tokens
for (const token of enabled) {
  // ... get quotes and calculate edge ...
  if (riskResult.shouldProceed && edge.isProfitable) {
    opportunities.push({ token, edge, riskResult });
  }
}

// Sort by edge (highest first)
opportunities.sort((a, b) => 
  b.edge.netEdgeBps - a.edge.netEdgeBps
);

// Execute best opportunities first
for (const opp of opportunities) {
  // ... execute trade ...
}
```

## Strategy Considerations

### 1. Liquidity Requirements

**GalaSwap:**
- Need sufficient liquidity in direct TOKEN/GALA (or TOKEN/GUSDC) pool
- Small pools = high price impact = less profitable
- Monitor pool sizes

**Solana:**
- Jupiter aggregates liquidity across multiple DEXs
- Generally more liquid
- Can route through multiple pools

### 2. Token Selection Criteria

Prioritize tokens that:
- ✅ Have high liquidity on both chains
- ✅ Show price discrepancies frequently
- ✅ Have stable prices (less volatility risk)
- ✅ Have reasonable price impact at your trade size

### 3. Trade Size Optimization

Different tokens need different trade sizes:
- **Small-cap tokens**: Larger sizes (more tokens, less USD value)
- **Large-cap tokens**: Smaller sizes (fewer tokens, more USD value)
- **Test and adjust** based on:
  - Price impact
  - Available liquidity
  - Minimum profitable edge

### 4. Inventory Management

With multiple tokens, you need to:
- Track inventory for each token on both chains
- Ensure sufficient inventory before attempting trade
- Bridge tokens back periodically
- Balance inventory across tokens

### 5. Risk Diversification

Multiple tokens provide:
- **Diversification**: Not dependent on one token
- **More opportunities**: Higher chance of finding profitable spreads
- **Risk distribution**: Spread risk across multiple assets

But also:
- **More complexity**: More to monitor and manage
- **Capital allocation**: Need inventory for each token
- **Bridge coordination**: Multiple tokens may need bridging

## Implementation Example

Here's a complete example of adding a new token (BONK):

```json
// config/tokens.json
{
  "tokens": {
    "BONK": {
      "symbol": "BONK",
      "galaChainMint": "GBONK|Unit|none|none",  // Verify this mint address
      "solanaMint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "solanaSymbol": "BONK",
      "decimals": 5,
      "tradeSize": 1000000,  // 1M BONK tokens
      "enabled": true,
      "gcQuoteVia": "GALA",  // Assumes GBONK/GALA pool exists
      "solQuoteVia": "SOL"   // Jupiter will route
    }
  }
}
```

## Testing New Tokens

1. **Enable in config** (`enabled: true`)
2. **Run in dry-run mode** to see quotes and edge calculations
3. **Monitor for several cycles** to observe:
   - Quote success rate
   - Price impact
   - Edge calculations
   - Error rates
4. **Adjust trade size** if price impact is too high
5. **Verify inventory** before enabling live trading

## Common Pitfalls

1. **Missing Pool on GalaSwap**: Token configured but no direct pool exists
   - **Solution**: Check GalaSwap UI for available pools, only add tokens with direct pairs

2. **Incorrect Mint Addresses**: Wrong mint = failed quotes
   - **Solution**: Verify mint addresses from official sources

3. **Wrong Decimals**: Incorrect decimals = wrong trade sizes
   - **Solution**: Verify decimals from token metadata

4. **Trade Size Too Large**: High price impact kills profitability
   - **Solution**: Start small, increase gradually

5. **Trade Size Too Small**: Not enough edge after fixed costs
   - **Solution**: Increase trade size or disable token if not viable

## Future Enhancements

1. **Dynamic Pool Discovery**: Automatically detect available pools on GalaSwap
2. **Multi-Path Quoting**: Try multiple quote paths (GALA, GUSDC) and use best
3. **Cross-Token Opportunities**: Triangular arbitrage (TokenA → GALA → TokenB → TokenA)
4. **Opportunity Prioritization**: Execute best opportunities first
5. **Token Performance Tracking**: Monitor which tokens are most profitable

## Summary

To add more token pairs:

1. ✅ **GalaSwap**: Only tokens with direct pools (TOKEN/GALA or TOKEN/GUSDC)
2. ✅ **Solana**: Any token Jupiter can route (more flexible)
3. ✅ **Config**: Add to `tokens.json` with correct mint addresses and decimals
4. ✅ **Trade Sizes**: Set appropriate sizes based on token price
5. ✅ **Testing**: Enable in dry-run, monitor, then go live

The bot architecture already supports multiple tokens - you just need to add them to the configuration!

