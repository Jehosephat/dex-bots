# Bollinger Bot - GALA Trading Strategy

A sophisticated algorithmic trading bot for GALA (Ethereum v2) token using Bollinger Bands with advanced filtering and multi-source price validation.

## 🎯 Overview

This bot implements a mean reversion strategy using Bollinger Bands on 1-hour timeframes, specifically designed for GALA v2 token trading. It provides manual trading signals with comprehensive risk management and price validation.

## 🏗️ Architecture

### Core Components
- **`index.ts`** - Main live trading bot
- **`backtest.ts`** - Comprehensive backtesting engine  
- **`priceSources.ts`** - Multi-source price validation system
- **`query-api-queries.ts`** - GalaChain DEX integration utilities

### Strategy Details
- **Timeframe**: 1-hour candles (CoinGecko data)
- **Bollinger Bands**: 20-period SMA, 2.0 standard deviation
- **Target**: GALA v2 (ERC-20) on Ethereum
- **Entry Modes**: Re-entry, Touch, or Both
- **Risk Management**: Cooldown periods, bandwidth filters, trend filters

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (built-in fetch support)
- TypeScript (for development)

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd bollinger-bot

# Install dependencies
npm install

# Copy the example environment file
cp .env.example .env

# Edit the .env file with your preferred settings
# (Optional - defaults are already set to match backtest results)

# Build the project (optional - can run directly with tsx)
npm run build
```

### Basic Usage

#### Run Live Bot
```bash
# Run with default settings (compiled)
npm start

# Or run TypeScript directly (development)
npm run dev

# Or run manually
node dist/index.js
```

#### Run Backtest
```bash
# Backtest with default parameters
npm run backtest

# Or compile and run
npm run backtest:build
```

## 📜 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled bot |
| `npm run dev` | Run bot directly with tsx (development) |
| `npm run backtest` | Run backtest with tsx |
| `npm run backtest:build` | Compile and run backtest |
| `npm run clean` | Remove build artifacts |
| `npm run lint` | Run ESLint on source code |

## ⚙️ Configuration

### Environment File Setup

The bot uses a `.env` file for configuration, making it easy to adjust settings without modifying code or using export commands.

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit the `.env` file** with your preferred settings:
   ```bash
   # Example .env file
   VS=eth
   DAYS=90
   BB_N=20
   BB_K=2.0
   ENTRY_MODE=touch_or_reentry
   TREND_FILTER_MODE=shorts_only
   COOLDOWN_HOURS=2
   # ... and more
   ```

3. **Run the bot** - it will automatically load your settings:
   ```bash
   npm run dev
   ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VS` | `eth` | Quote currency (`eth` or `usd`) |
| `DAYS` | `30` | Data lookback period (2-90 days) |
| `BB_N` | `20` | Bollinger Band period |
| `BB_K` | `2.0` | Standard deviation multiplier |
| `ENTRY_MODE` | `touch_or_reentry` | Entry logic (`reentry`, `touch`, `touch_or_reentry`) |
| `TREND_FILTER_MODE` | `shorts_only` | Trend filter scope (`both`, `longs_only`, `shorts_only`, `off`) |
| `EMA_N` | `150` | EMA period for trend filter |
| `OVERSHOOT_B` | `0.05` | Overshoot requirement (5% of band width) |
| `BW_MAX` | `0.16` | Max relative bandwidth (16%) |
| `COOLDOWN_HOURS` | `3` | Hours between signals |
| `CG_KEY` | - | CoinGecko API key (optional) |
| `PRIVATE_KEY` | - | Private key for GSwap SDK (required for price comparison and trading) |
| `WALLET_ADDRESS` | - | Your wallet address (eth\|0x...) |
| `ENABLE_AUTO_TRADING` | `false` | Enable automatic trade execution |
| `BUY_AMOUNT` | `10` | Amount of GUSDC to spend on BUY trades |
| `SELL_AMOUNT` | `1000` | Amount of GALA to sell on SELL trades |
| `SLIPPAGE_TOLERANCE` | `0.05` | Slippage tolerance (5%) |

### Example Configuration

**Option 1: Using .env file (Recommended)**
```bash
# Edit .env file
VS=usd
BB_N=20
BB_K=2.0
ENTRY_MODE=touch_or_reentry
TREND_FILTER_MODE=shorts_only
COOLDOWN_HOURS=2

# Run with custom settings
npm run dev
```

**Option 2: Using export commands**
```bash
# Set custom parameters
export VS=usd
export BB_N=20
export BB_K=2.0
export ENTRY_MODE=touch_or_reentry
export TREND_FILTER_MODE=shorts_only
export COOLDOWN_HOURS=2

# Run with custom settings
npm run dev
```

## 📊 Strategy Logic

### Entry Conditions

#### Re-entry Mode
- Previous bar outside Bollinger Band
- Current bar re-enters the band
- Requires overshoot beyond band by specified percentage

#### Touch Mode  
- Current close touches or breaks Bollinger Band
- Requires overshoot beyond band by specified percentage

#### Touch or Re-entry Mode (Default)
- Either re-entry OR touch condition triggers entry
- Most flexible entry approach

### Filters

#### 1. Overshoot Filter
- Requires price to extend beyond band by 5% of band width
- Prevents weak signals near band edges

#### 2. Bandwidth Filter
- Skips trades when relative bandwidth > 16%
- Avoids trading in highly volatile/trending conditions

#### 3. Trend Filter
- Uses EMA(150) to determine trend direction
- Configurable scope:
  - `both`: Filters both long and short signals
  - `longs_only`: Only filters long positions
  - `shorts_only`: Only filters short positions (default)
  - `off`: No trend filtering

### Exit Conditions
1. **Mean Reversion**: Cross of middle band (primary target)
2. **Opposite Signal**: Opposite filtered entry signal
3. **Time Cap**: Maximum 72-hour hold period

## 🔍 Price Validation

### Multi-Source Comparison
- **Primary**: CoinGecko (default)
- **Secondary**: GSwap SDK (GalaChain DEX)
- **Tertiary**: Binance
- **Threshold**: 2% maximum discrepancy
- **Action**: Blocks trades if sources disagree

### Configuration
```bash
export ENABLE_PRICE_COMPARISON=true
export PRIMARY_PRICE_SOURCE=coingecko
export SECONDARY_PRICE_SOURCE=gswap
export PRICE_DISCREPANCY_THRESHOLD=0.02
export PRIVATE_KEY=0xYourPrivateKeyHere
```

## 📈 Backtesting

### Running Backtests
```bash
# Default 90-day backtest
npx tsx backtest.ts

# Custom parameters
export DAYS=30
export ENTRY_MODE=reentry
export TREND_FILTER_MODE=both
npx tsx backtest.ts
```

### Backtest Output
- Total trades and win rate
- Profit factor and average PnL
- Maximum drawdown
- Trade-by-trade analysis
- Performance metrics

### Key Metrics
- **Win Rate**: Percentage of profitable trades
- **Profit Factor**: Gross profit / Gross loss
- **Max Drawdown**: Largest peak-to-trough decline
- **Trades per Week**: Signal frequency

## 🕐 Scheduling

### Automated Execution
- Runs immediately on startup
- Schedules to run at the top of every hour
- Maintains cooldown state in `state.json`
- Provides manual trading suggestions

## 🤖 Trade Execution

### Manual Mode (Default)
The bot runs in manual mode by default, providing trading signals that you can execute manually:
- Logs current market conditions
- Shows band values and price levels
- Indicates filter status and reasoning
- Provides final actionable recommendation

### Automatic Trading Mode
Enable automatic trade execution by setting `ENABLE_AUTO_TRADING=true` in your `.env` file:

```bash
# Enable automatic trading
ENABLE_AUTO_TRADING=true
PRIVATE_KEY=0xYourPrivateKeyHere
WALLET_ADDRESS=eth|0xYourWalletAddressHere
BUY_AMOUNT=10
SELL_AMOUNT=1000
SLIPPAGE_TOLERANCE=0.05
```

### Trade Execution Features
- **Automatic BUY/SELL**: Executes trades when signals are generated
- **Slippage Protection**: Configurable slippage tolerance (default 5%)
- **Price Validation**: Only trades when price sources agree
- **Cooldown Respect**: Respects cooldown periods between trades
- **Error Handling**: Graceful error handling with detailed logging
- **Transaction Tracking**: Logs transaction hashes and amounts

### Safety Features
- **Manual by Default**: Auto-trading is disabled by default
- **Configuration Required**: Must provide private key and wallet address
- **Price Validation**: Blocks trades on significant price discrepancies
- **Cooldown Protection**: Prevents over-trading
- **Slippage Protection**: Protects against unfavorable price movements


## 🛡️ Risk Management

### Built-in Protections
- **Cooldown Periods**: Prevents over-trading
- **Bandwidth Filters**: Avoids volatile conditions
- **Trend Filters**: Prevents counter-trend trades
- **Price Validation**: Ensures data integrity
- **Time Caps**: Limits maximum hold periods

### Fee Structure
- **Entry Fee**: 0.1% (10 bps)
- **Exit Fee**: 0.1% (10 bps)
- **Total Cost**: 0.2% per round trip

## 🔧 GalaChain Integration

### DEX Queries
The bot includes utilities for GalaChain DEX integration:
- Pool data retrieval
- Token balance queries
- Liquidity analysis
- Tick data access

### Usage
```typescript
import { getPoolData } from './src/query-api-queries';

// Get pool information
const poolData = await getPoolData('GUSDC$Unit$none$none', 'GWETH$Unit$none$none', 10000);
```

## 📝 Output Example

```
=======================================
Time (ET):         12/15/2023 14:00:00  [on-the-hour]
Pair:              GALA (ERC-20 v2) / ETH
Period/Params:     1h  N=20  K=2.0  Entry=touch_or_reentry
Trend filter:      EMA(150) scope=shorts_only
Filters:           Overshoot=0.05  BW_MAX=0.16  Cooldown=3h
Closes:            prev=0.00012345  curr=0.00012456
Bands:             mid=0.00012300  upper=0.00012500  lower=0.00012100
Rel bandwidth:     3.25%
Price comparison:  ✅ VALID | coingecko: $0.00012456 | quoteexactamount: $0.00012450 | Diff: 0.05%
Suggested Action:  BUY (re-entry/touch qualified)
State file:        /path/to/state.json
=======================================
```

## 🚨 Important Notes

### Manual Trading Only
- This bot provides **signals only**
- **No automated execution** - requires manual intervention
- Always verify signals before trading
- Consider additional risk management

### Data Dependencies
- Requires internet connection for CoinGecko API
- Optional API keys for higher rate limits
- Fallback mechanisms for price validation

### Risk Disclaimer
- **Not financial advice**
- Past performance doesn't guarantee future results
- Cryptocurrency trading involves significant risk
- Only trade with funds you can afford to lose

## 🐛 Troubleshooting

### Common Issues

#### API Rate Limits
```bash
# Add CoinGecko API key
export CG_KEY=your_api_key_here
```

#### Insufficient Data
```bash
# Increase lookback period
export DAYS=60
```

#### No Signals
- Check if filters are too restrictive
- Verify market conditions
- Review cooldown status in `state.json`

### Debug Mode
```bash
# Enable verbose logging
export DEBUG=true
node index.js
```

## 📚 Further Reading

- [Bollinger Bands Strategy Guide](https://www.investopedia.com/articles/technical/102201.asp)
- [Mean Reversion Trading](https://www.investopedia.com/terms/m/meanreversion.asp)
- [GALA Token Documentation](https://docs.gala.games/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

[Add your license information here]

---

**⚠️ Disclaimer**: This software is for educational and research purposes only. Trading cryptocurrencies involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this software.
