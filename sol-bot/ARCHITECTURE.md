# Sol-Bot Architecture

## Overview

Sol-Bot is a cross-chain arbitrage bot that discovers and executes profitable trades between GalaChain and Solana networks.

## Modular Price Discovery System

The bot uses a **plugin-based architecture** for price discovery, making it easy to add new blockchain networks or DEXs.

### Directory Structure

```
src/
├── core/
│   ├── priceDiscovery.ts          # Main orchestrator
│   ├── priceProviders/
│   │   ├── base.ts                # Provider interface & base class
│   │   ├── galachain.ts           # GalaChain DEX v3 provider
│   │   ├── solana.ts              # Solana/Jupiter provider
│   │   ├── index.ts               # Provider exports
│   │   └── README.md              # Provider documentation
│   └── inventoryManager.ts        # Token inventory management
├── types/
│   └── index.ts                   # TypeScript type definitions
├── utils/
│   ├── config.ts                  # Configuration management
│   └── logger.ts                  # Logging utilities
└── test-price-discovery.ts        # Price discovery test script
```

## Key Components

### 1. Price Discovery (`priceDiscovery.ts`)

The main orchestrator that:
- Manages multiple price providers
- Coordinates price updates across all providers
- Calculates arbitrage opportunities
- Evaluates trade profitability

**Key Methods:**
```typescript
addProvider(provider: IPriceProvider)  // Add new network/DEX
initialize()                           // Initialize all providers
discoverOpportunities()                // Find arbitrage opportunities
```

### 2. Price Providers (`priceProviders/`)

Modular components for fetching prices from different networks:

#### GalaChain Provider
- Fetches prices from GalaChain DEX v3
- Uses local quoting (no on-chain transactions)
- Supports GALA and GUSDC pairs
- Handles token ordering automatically

#### Solana Provider
- Fetches prices via Jupiter aggregator
- Gets SOL/USD price from CoinGecko
- Provides real-time market prices
- No API key required (Lite API)

### 3. Configuration (`config/tokens.json`)

Token configuration with multi-chain support:

```json
{
  "symbol": "GTRUMP",
  "galaChainMint": "GTRUMP|Unit|none|none",
  "solanaMint": "GgVuXEmpPwL9u...",
  "decimals": 9,
  "minTradeSize": 0.01,
  "maxTradeSize": 0.1,
  "enabled": true,
  "gcQuoteVia": "GALA"
}
```

## Pricing Flow

```
1. Initialize PriceDiscovery
   ├── Initialize GalaChain Provider
   └── Initialize Solana Provider
       └── Fetch SOL/USD price

2. Discover Opportunities
   ├── Update Prices (parallel)
   │   ├── GalaChain: Fetch token/GALA or token/GUSDC prices
   │   │   └── Convert to both GALA and USD
   │   └── Solana: Fetch token/SOL prices via Jupiter
   │       └── Convert to USD using SOL/USD price
   │
   └── Evaluate Opportunities
       ├── Calculate GalaChain sell proceeds
       ├── Calculate Solana buy cost (in GALA terms)
       ├── Calculate bridge costs
       ├── Apply risk buffer
       └── Calculate net edge %

3. Return Profitable Opportunities
   └── Sorted by net edge (highest first)
```

## Price Calculation Examples

### GalaChain Price Discovery

**For GALA pairs (e.g., GTRUMP/GALA):**
1. Quote GTRUMP → GALA using local quoting
2. Get GALA → GUSDC quote for USD conversion
3. Result: `priceInGALA` and `priceInUSD`

**For GUSDC pairs (e.g., GFARTCOIN/GUSDC):**
1. Quote GFARTCOIN → GUSDC directly
2. Get GUSDC → GALA rate for GALA price
3. Result: `priceInGALA` and `priceInUSD`

### Solana Price Discovery

**For regular tokens:**
1. Quote token → SOL via Jupiter
2. Get SOL/USD price from CoinGecko
3. Result: `priceInSOL` and `priceInUSD`

**For SOL itself (GSOL):**
1. Skip Jupiter (can't quote SOL → SOL)
2. Use CoinGecko SOL/USD price directly
3. Result: `price = 1 SOL` and `priceInUSD`

## Arbitrage Opportunity Calculation

```typescript
// 1. Sell on GalaChain
gcSellProceeds = size * gcPrice.price  // in GALA

// 2. Buy on Solana (converted to GALA)
costInSOL = size / solPrice.price
solBuyCost = costInSOL * solGalaPrice  // SOL/GALA rate

// 3. Costs
bridgeCostGALA = bridgeCostUSD / galaUSDPrice
riskBuffer = gcSellProceeds * 0.01  // 1%

// 4. Net edge
netEdge = gcSellProceeds - solBuyCost - bridgeCostGALA - riskBuffer
edgePercent = netEdge / gcSellProceeds

// 5. Filter
if (edgePercent >= minEdgeThreshold) {
  // Opportunity!
}
```

## Adding New Networks

To add a new blockchain network (e.g., Ethereum, Polygon, Avalanche):

1. **Create provider class** in `src/core/priceProviders/newchain.ts`
2. **Implement interface** (`IPriceProvider` or extend `BasePriceProvider`)
3. **Export provider** from `src/core/priceProviders/index.ts`
4. **Add to bot** via `priceDiscovery.addProvider(new NewChainProvider())`
5. **Configure tokens** with network-specific addresses

See `src/core/priceProviders/README.md` for detailed guide.

## Configuration

### Bot Config (`config/bot-config.json`)

```json
{
  "trading": {
    "minEdgeThreshold": 0.02,      // 2% minimum profit
    "priceUpdateInterval": 30000,   // 30 seconds
    "riskBuffer": 0.01              // 1% risk buffer
  },
  "bridging": {
    "bridgeCostUSD": 5.0,           // $5 bridge cost
    "bridgeTimeout": 300000         // 5 minutes
  }
}
```

### Token Config (`config/tokens.json`)

Each token can specify:
- `galaChainMint`: Token identifier on GalaChain
- `solanaMint`: Token address on Solana
- `gcQuoteVia`: Quote against "GALA" or "GUSDC"
- Trade size limits
- Enable/disable flag

## Testing

### Price Discovery Test

```bash
npm run test:price-discovery
# or
npx tsx src/test-price-discovery.ts
```

Shows:
- Base exchange rates (GALA/USD, SOL/USD)
- Prices from all providers
- Arbitrage opportunities
- Token-specific analysis

## Current Supported Assets

- **GFARTCOIN**: GalaChain (via GUSDC) ↔ Solana
- **GTRUMP**: GalaChain (via GALA) ↔ Solana
- **GSOL**: GalaChain (via GALA) ↔ Solana (SOL)

## Future Enhancements

1. **Additional Networks**: Ethereum, Polygon, Avalanche, BSC
2. **More DEXs**: Uniswap, SushiSwap, PancakeSwap
3. **Price Aggregation**: Average prices across multiple sources
4. **Real-time Updates**: WebSocket support for live prices
5. **Advanced Strategies**: Multi-hop arbitrage, flash loans
6. **Risk Management**: Dynamic position sizing, stop losses

## Performance

- **Price Updates**: ~2-3 seconds per provider (parallel)
- **Opportunity Discovery**: <100ms once prices are fetched
- **Scalability**: Add providers with minimal overhead
- **API Calls**: Minimal (local quoting for GalaChain, aggregated for Solana)

