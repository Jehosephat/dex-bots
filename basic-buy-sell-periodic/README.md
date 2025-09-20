# GalaSwap V3 Periodic Trading Bot

A Node.js bot that implements a periodic buy-sell strategy for GALA/GUSDC trading on GalaSwap V3 using the official GSwap SDK.

## Features

- **Periodic Trading**: Alternates between buying GALA with GUSDC and selling GALA for GUSDC
- **GSwap SDK Integration**: Uses the official `@gala-chain/gswap-sdk` for reliable trading
- **Configurable Parameters**: Trade amount, frequency, and duration are all configurable
- **Slippage Protection**: Built-in slippage tolerance to protect against price movements
- **Automatic Fee Tier Selection**: SDK automatically finds the best fee tier for each trade
- **Comprehensive Logging**: Detailed logs with timestamps for monitoring
- **Graceful Shutdown**: Handles SIGINT for clean shutdown

## Configuration

The bot can be configured using environment variables:

### Required Configuration

```bash
# Your wallet private key (keep this secure!)
PRIVATE_KEY=0x...

# Your wallet address
WALLET_ADDRESS=eth|0x...
```

### Trading Parameters

```bash
# Amount to trade in each transaction (default: 10)
TRADE_AMOUNT=10

# Time between trades in milliseconds (default: 30000 = 30 seconds)
TRADE_FREQUENCY=30000

# Duration of each buy/sell phase in milliseconds (default: 300000 = 5 minutes)
TRADE_DURATION=300000
```

### Optional Configuration

```bash
# Slippage tolerance (default: 0.05 = 5%)
SLIPPAGE_TOLERANCE=0.05
```

**Note**: The bot uses the GSwap SDK which automatically selects the best fee tier (500, 3000, or 10000) for each trade based on available liquidity.

**SDK Version**: This bot is tested with `@gala-chain/gswap-sdk` version 0.0.7. The API structure may differ in other versions.

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the project directory:
```bash
# Create .env file with your configuration
cat > .env << EOF
# Trading Parameters
TRADE_AMOUNT=10
TRADE_FREQUENCY=30000
TRADE_DURATION=300000

# Wallet Configuration (REQUIRED)
PRIVATE_KEY=0x...
WALLET_ADDRESS=eth|0x...

# Optional: Override default settings
# SLIPPAGE_TOLERANCE=0.05
EOF
```

Or set environment variables directly:
```bash
export PRIVATE_KEY="0x..."
export WALLET_ADDRESS="eth|0x..."
export TRADE_AMOUNT="10"
export TRADE_FREQUENCY="30000"
export TRADE_DURATION="300000"
export SLIPPAGE_TOLERANCE="0.05"
```

## Usage

### Start the bot:
```bash
npm start
```

### Development mode with debugging:
```bash
npm run dev
```

## How It Works

1. **Buy Phase**: The bot buys GALA with GUSDC for the specified duration
   - Executes trades every `TRADE_FREQUENCY` milliseconds
   - Each trade uses `TRADE_AMOUNT` of GUSDC
   - Continues for `TRADE_DURATION` milliseconds

2. **Sell Phase**: The bot sells GALA for GUSDC for the same duration
   - Executes trades every `TRADE_FREQUENCY` milliseconds
   - Each trade uses `TRADE_AMOUNT` of GALA
   - Continues for `TRADE_DURATION` milliseconds

3. **Cycle Repeat**: The bot alternates between buy and sell phases indefinitely

## Example Output

```
[2024-01-15T10:30:00.000Z] 🤖 Starting GalaSwap V3 Periodic Trading Bot
[2024-01-15T10:30:00.001Z] Configuration:
[2024-01-15T10:30:00.002Z]   Trade Amount: 10
[2024-01-15T10:30:00.003Z]   Trade Frequency: 30s
[2024-01-15T10:30:00.004Z]   Trade Duration: 300s per phase
[2024-01-15T10:30:00.005Z]   Slippage Tolerance: 5%
[2024-01-15T10:30:00.006Z]   Wallet: eth|0x...
[2024-01-15T10:30:00.007Z] ✅ GSwap SDK initialized successfully

[2024-01-15T10:30:00.008Z] 🔄 Starting cycle 1
[2024-01-15T10:30:00.009Z] 🚀 Starting BUY phase for 300 seconds
[2024-01-15T10:30:00.010Z] Executing BUY trade: 10 GUSDC -> GALA
[2024-01-15T10:30:00.011Z] Best rate found on 500 fee tier pool
[2024-01-15T10:30:00.012Z] Expected output: 25.5 GALA
[2024-01-15T10:30:00.013Z] Min output (5% slippage): 24.225
[2024-01-15T10:30:02.000Z] ✅ BUY trade completed successfully!
```

## Safety Features

- **Slippage Protection**: Each trade includes a minimum output amount based on slippage tolerance
- **SDK Integration**: Uses the official GSwap SDK for reliable transaction handling
- **Automatic Fee Tier Selection**: SDK automatically finds the best available liquidity
- **Error Handling**: Comprehensive error handling with retry logic
- **Graceful Shutdown**: Handles Ctrl+C for clean shutdown

## Security Notes

- **Never commit your private key** to version control
- **Use environment variables** or secure key management
- **Test with small amounts** first
- **Monitor your trades** regularly
- **Keep your private key secure** and never share it

## SDK Reference

The bot uses the official GSwap SDK (`@gala-chain/gswap-sdk`):

- `gSwap.quoting.quoteExactInput()` - Get trading quotes with automatic fee tier selection
- `gSwap.swaps.swap()` - Execute swaps with built-in transaction handling
- `PrivateKeySigner` - Secure private key management

## Troubleshooting

### Common Issues

1. **"PRIVATE_KEY and WALLET_ADDRESS must be set"**
   - Make sure you've set the required environment variables

2. **"GSwap SDK initialization failed"**
   - Check your private key format (should start with 0x)
   - Verify your wallet address format (should be eth|0x...)
   - Ensure you have sufficient balance

3. **"Quote failed"**
   - Check your internet connection
   - Ensure you have sufficient balance for the trade
   - Verify token symbols are correct

4. **"Swap failed"**
   - Check your wallet balance
   - Verify slippage tolerance settings
   - Check for network congestion

5. **"gSwap.swap is not a function"**
   - This indicates an SDK version mismatch
   - Ensure you're using `@gala-chain/gswap-sdk` version 0.0.7
   - The correct method is `gSwap.swaps.swap()`, not `gSwap.swap()`

### Getting Help

- Check the [GalaSwap V3 Guide](../galaswap-v3-guide.md) for API documentation
- Review the [GSWAP SDK README](gswap-sdk/GSWAP_README.md) for SDK usage
- Monitor the logs for detailed error messages

## License

MIT License - see package.json for details.