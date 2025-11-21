# Price Providers

This directory contains modular price discovery providers that fetch token prices from different blockchain networks and DEXs.

## Architecture

The price discovery system uses a **provider pattern** that allows you to easily plug in new networks or exchanges as needed.

### Core Components

1. **`base.ts`** - Defines the `IPriceProvider` interface and `BasePriceProvider` abstract class
2. **`galachain.ts`** - GalaChain DEX v3 price provider
3. **`solana.ts`** - Solana DEX price provider (via Jupiter aggregator)
4. **`index.ts`** - Exports all providers

## How It Works

### Provider Interface

All price providers must implement the `IPriceProvider` interface:

```typescript
interface IPriceProvider {
  initialize(): Promise<void>;
  updatePrices(tokens: TokenConfig[]): Promise<void>;
  getPrice(symbol: string): TokenPrice | undefined;
  getAllPrices(): Map<string, TokenPrice>;
  getName(): string;
}
```

### Using Providers

The main `PriceDiscovery` class orchestrates multiple providers:

```typescript
import { PriceDiscovery } from './core/priceDiscovery';

const priceDiscovery = new PriceDiscovery();
await priceDiscovery.initialize();

// Fetch prices from all providers
await priceDiscovery.discoverOpportunities();

// Get prices from specific provider
const gcPrice = priceDiscovery.getGalaChainPrice('GTRUMP');
const solPrice = priceDiscovery.getSolanaPrice('GTRUMP');
```

## Built-in Providers

### GalaChain Provider

Fetches prices from GalaChain DEX v3 using local quoting:

- **Pools supported**: GALA pairs and GUSDC pairs
- **Features**: 
  - Local quote execution (no on-chain transactions)
  - Automatic token ordering
  - GALA/USD conversion via GALA/GUSDC pool
- **Configuration**: Set `gcQuoteVia` in `tokens.json` to "GALA" or "GUSDC"

### Solana Provider

Fetches prices from Solana DEXs via Jupiter aggregator:

- **API**: Jupiter Lite API (no key required)
- **Market data**: CoinGecko for SOL/USD price
- **Features**:
  - Aggregated liquidity across Solana DEXs
  - Real-time market prices
  - USD price conversion

## Adding a New Provider

To add support for a new blockchain or exchange:

### 1. Create Provider Class

Create a new file (e.g., `ethereum.ts`):

```typescript
import { BasePriceProvider } from './base';
import { TokenPrice, TokenConfig } from '../../types';
import { logger } from '../../utils/logger';

export class EthereumPriceProvider extends BasePriceProvider {
  private uniswapApiUrl = 'https://api.uniswap.org/v1';

  async initialize(): Promise<void> {
    // Setup connections, load configs, etc.
    logger.info('Ethereum price provider initialized');
  }

  getName(): string {
    return 'ethereum';
  }

  async updatePrices(tokens: TokenConfig[]): Promise<void> {
    for (const tokenConfig of tokens) {
      try {
        // Fetch price for each token
        const price = await this.fetchEthereumPrice(tokenConfig);
        
        if (price) {
          this.setPrice(tokenConfig.symbol, {
            token: tokenConfig.symbol,
            price: price.ethPrice,
            priceUSD: price.usdPrice,
            liquidity: price.liquidity,
            timestamp: Date.now(),
            source: 'ethereum'
          });
        }
      } catch (error) {
        logger.error(`Failed to fetch Ethereum price for ${tokenConfig.symbol}`, { error });
      }
    }
    
    this.updateTimestamp();
  }

  private async fetchEthereumPrice(token: TokenConfig): Promise<any> {
    // Your implementation here
  }
}
```

### 2. Export from Index

Add to `index.ts`:

```typescript
export { EthereumPriceProvider } from './ethereum';
```

### 3. Register Provider

In your application code:

```typescript
import { PriceDiscovery } from './core/priceDiscovery';
import { EthereumPriceProvider } from './core/priceProviders';

const priceDiscovery = new PriceDiscovery();

// Add custom provider
const ethereumProvider = new EthereumPriceProvider();
priceDiscovery.addProvider(ethereumProvider);

await priceDiscovery.initialize();
```

### 4. Configure Tokens

Add Ethereum configuration to your tokens in `config/tokens.json`:

```json
{
  "symbol": "USDC",
  "galaChainMint": "GUSDC|Unit|none|none",
  "ethereumAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "decimals": 6,
  "minTradeSize": 10,
  "maxTradeSize": 1000,
  "enabled": true
}
```

## Provider Methods

### Required Methods

- **`initialize()`** - Called once when the provider is first set up
- **`updatePrices(tokens)`** - Fetch prices for all enabled tokens
- **`getName()`** - Return unique identifier for this provider

### Inherited from BasePriceProvider

- **`getPrice(symbol)`** - Get price for a specific token
- **`getAllPrices()`** - Get all prices from this provider
- **`setPrice(symbol, price)`** - Store a token price
- **`updateTimestamp()`** - Update the last update timestamp

## Best Practices

1. **Error Handling**: Always catch and log errors for individual tokens
2. **Timeouts**: Set reasonable timeouts for API calls
3. **Rate Limiting**: Respect API rate limits
4. **Fallbacks**: Implement fallback prices for critical operations
5. **Logging**: Use structured logging with context
6. **Parallel Fetching**: Fetch multiple token prices in parallel when possible

## Example: Multi-Chain Arbitrage

```typescript
const priceDiscovery = new PriceDiscovery();

// Add multiple providers
priceDiscovery.addProvider(new EthereumPriceProvider());
priceDiscovery.addProvider(new PolygonPriceProvider());
priceDiscovery.addProvider(new AvalanchePriceProvider());

await priceDiscovery.initialize();

// Discover opportunities across all chains
const opportunities = await priceDiscovery.discoverOpportunities();

// Get prices from specific chains
const providers = priceDiscovery.getProviderNames(); // ['galachain', 'solana', 'ethereum', ...]
const ethPrices = priceDiscovery.getPricesFromProvider('ethereum');
```

## Testing

Test your provider with:

```bash
npm run test:price-discovery
```

Or create a specific test file:

```typescript
import { EthereumPriceProvider } from './core/priceProviders';
import { config } from './utils/config';

async function testEthereumProvider() {
  const provider = new EthereumPriceProvider();
  await provider.initialize();
  
  const tokens = config.getEnabledTokens();
  await provider.updatePrices(tokens);
  
  const prices = provider.getAllPrices();
  console.log('Ethereum prices:', prices);
}

testEthereumProvider();
```

## Future Enhancements

Potential improvements to the provider system:

- **Price aggregation** - Average prices across multiple providers
- **Health monitoring** - Track provider uptime and reliability
- **Dynamic provider selection** - Choose provider based on liquidity/fees
- **Caching layer** - Cache prices with TTL to reduce API calls
- **WebSocket support** - Real-time price updates
- **Historical data** - Track price history for analysis

