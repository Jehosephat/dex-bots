# Follow Bot - GalaChain DEX Trading Bot

A sophisticated trading bot that monitors target wallets on GalaChain and automatically copies their trading strategies in real-time using WebSocket connections to the GalaChain explorer.

## 🚀 Features

- **Real-time Monitoring**: WebSocket connection to GalaChain explorer for instant transaction detection
- **Multi-Wallet Support**: Monitor up to 50+ target wallets simultaneously with custom names
- **Smart Trade Analysis**: Risk assessment, confidence scoring, and intelligent trade sizing
- **Position Management**: Track copied positions, performance metrics, and risk management
- **Auto-Execution**: Automated trade execution using GSwap SDK with slippage protection
- **Comprehensive Logging**: Detailed logs with wallet names for easy identification
- **Health Monitoring**: Built-in health checks and error handling
- **Configuration Management**: Flexible configuration via JSON and environment variables

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn
- GalaChain wallet with private key
- Target wallets to monitor (Ethereum or Client addresses)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Jehosephat/dex-bots
   cd follow-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   PRIVATE_KEY=your_gala_private_key_here
   WALLET_ADDRESS=your_gala_wallet_address_here
   TARGET_WALLETS=eth|wallet1,eth|wallet2,client|wallet3
   ```

4. **Configure target wallets**
   Edit `config.json` to add your target wallets and trading parameters.

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PRIVATE_KEY` | Your GalaChain wallet private key | ✅ | - |
| `WALLET_ADDRESS` | Your GalaChain wallet address | ✅ | - |
| `TARGET_WALLETS` | Comma-separated list of target wallets | ✅ | - |
| `ENABLE_AUTO_TRADING` | Enable automatic trade execution | ❌ | `false` |
| `COPY_MODE` | Trading mode: `exact` or `proportional` | ❌ | `proportional` |
| `GALA_MINIMUM_THRESHOLD` | Minimum GALA amount for swaps involving GALA | ❌ | `500` |
| `MAX_POSITION_SIZE` | Maximum position size (0.0-1.0) | ❌ | `0.1` |
| `EXECUTION_DELAY` | Delay before execution (seconds) | ❌ | `30` |
| `COOLDOWN_MINUTES` | Cooldown between trades (minutes) | ❌ | `5` |
| `SLIPPAGE_TOLERANCE` | Maximum slippage tolerance | ❌ | `0.05` |
| `MAX_DAILY_TRADES` | Maximum trades per day | ❌ | `50` |

### Config.json Structure

```json
{
  "targetWallets": [
    {
      "address": "eth|D1499B10A0e1F4912FD1d771b183DfDfBDF766DC",
      "name": "Professional Trader",
      "maxCopyAmount": 1000,
      "enabled": true,
      "priority": 1,
      "type": "ethereum"
    }
  ],
  "globalSettings": {
    "maxTotalExposure": 0.3,
    "blacklistedTokens": [],
    "whitelistedTokens": ["GALA", "GWETH", "GUSDC"],
    "copyMode": "proportional",
    "executionDelay": 30,
    "cooldownMinutes": 5,
    "slippageTolerance": 0.05,
    "enableAutoTrading": true,
    "maxDailyTrades": 50,
    "galaMinimumThreshold": 50
  }
}
```

### Target Wallet Configuration

| Field | Description | Example |
|-------|-------------|---------|
| `address` | Wallet address (eth\| or client\| prefix) | `eth|0x123...` |
| `name` | Human-readable name | `"Professional Trader"` |
| `maxCopyAmount` | Maximum amount to copy per trade | `1000` |
| `enabled` | Whether to monitor this wallet | `true` |
| `priority` | Priority level (1=highest) | `1` |
| `type` | Wallet type: `ethereum` or `client` | `"ethereum"` |

## 🎯 How It Works

### 1. WebSocket Connection
- Connects to GalaChain explorer WebSocket
- Monitors new blocks in real-time
- Filters for DEX transactions (Swaps, AddLiquidity, RemoveLiquidity)

### 2. Transaction Processing
- Detects `BatchSubmit` transactions from target wallets
- Extracts swap details (tokens, amounts, direction)
- Validates transaction data and amounts

### 3. Wallet Monitoring
- Tracks wallet performance metrics
- Calculates risk scores and success rates
- Monitors trading patterns and frequency

### 4. Trade Analysis
- Validates trade parameters
- Assesses risk and confidence scores
- Determines trade size and execution strategy
- Applies token filtering and blacklist checks

### 5. Position Management
- Creates positions for approved trades
- Tracks position performance and PnL
- Monitors risk metrics and alerts

### 6. Trade Execution
- Executes approved trades using GSwap SDK
- Applies slippage protection and retry logic
- Handles execution timing and delays

## 🚀 Usage

### Start the Bot

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run build
npm start

# Run tests
npm test
```

### Monitor the Bot

The bot provides comprehensive logging:

```
🎯 Processing BatchSubmit from wallet eth|d1499b10a0e1f4912fd1d771b183dfdfbdf766dc (Real Trader from Block 8667731) in block 8670528
📥 Added transaction to queue: c112ae0e-5325-44f4-92f1-f16302acf786 (swap)
   Wallet: eth|d1499b10a0e1f4912fd1d771b183dfdfbdf766dc (Real Trader from Block 8667731)
   Method: Swap
   Tokens: GUSDC → GALA
📈 Trade added: buy 5 GUSDC → 322.87298324725003 GALA
🔍 Analyzing wallet activity: eth|d1499b10a0e1f4912fd1d771b183dfdfbdf766dc (Real Trader from Block 8667731) - swap
🔍 Trade analysis completed: approved
   Risk Score: 0.10
   Confidence Score: 0.90
   Action: execute
✅ Trade approved for execution: analysis_123
🚀 Trade execution queued: exec_123
📊 Slippage analysis:
   expectedAmountOut: 322.87
   actualAmountOut: 315.42
   actualSlippage: 2.31%
   maxSlippage: 5.00%
   isValid: true
✅ Trade execution completed: exec_123
```

### Key Log Messages

| Message | Description |
|---------|-------------|
| `🎯 Processing BatchSubmit` | New transaction detected |
| `📈 Trade added` | Trade queued for analysis |
| `🔍 Trade analysis completed` | Analysis result (approved/rejected) |
| `✅ Trade approved` | Trade ready for execution |
| `🚀 Trade execution started` | Execution in progress |
| `📊 Slippage analysis` | Slippage details for trade execution |
| `✅ Trade execution completed` | Trade successfully executed |
| `❌ Trade rejected` | Trade rejected with reason |
| `❌ Trade execution failed` | Execution failed with detailed error |

## 🔧 Advanced Configuration

### Risk Management

The bot includes sophisticated risk management:

- **Wallet Risk Scoring**: Based on trade frequency, size, and success rate
- **Token Risk Assessment**: Blacklist checks, liquidity analysis, volatility
- **Position Size Limits**: Maximum exposure per trade and total portfolio
- **Daily Trade Limits**: Prevents overtrading

### Trading Modes

#### Proportional Mode (Default)
- Copies trades proportionally based on your wallet size
- Maintains consistent risk exposure
- Example: If target trades 100 GALA, you trade 10 GALA (10% of their size)

#### Exact Mode
- Copies exact trade amounts
- Higher risk but higher potential returns
- Requires sufficient wallet balance

### Token Filtering

- **Whitelist**: Only trade whitelisted tokens (default: GALA, GWETH, GUSDC)
- **Blacklist**: Never trade blacklisted tokens
- **Liquidity Checks**: Ensures sufficient liquidity before trading
- **GALA Minimum Threshold**: Filters out small GALA trades (default: 50 GALA minimum)

## 📊 Monitoring and Analytics

### Wallet Performance Metrics

- **Total Trades**: Number of trades executed
- **Success Rate**: Percentage of profitable trades
- **Average Trade Size**: Mean trade amount
- **Performance Score**: Overall wallet performance (0-100)
- **Risk Score**: Calculated risk level (0-100)

### Position Tracking

- **Open Positions**: Currently active positions
- **Closed Positions**: Historical position data
- **PnL Tracking**: Profit/loss per position
- **Performance Analytics**: Returns, fees, and risk metrics

### Health Monitoring

- **WebSocket Status**: Connection health
- **Transaction Processing**: Queue status and processing times
- **Error Tracking**: Failed transactions and retry attempts
- **System Health**: Overall bot health and performance

## 🚨 Troubleshooting

### Common Issues

#### "Auto-trading is disabled"
- Check `enableAutoTrading` in config.json
- Verify environment variable `ENABLE_AUTO_TRADING=true`

#### "No wallet stats found"
- Ensure target wallet is in config.json
- Check wallet address format (case-sensitive)
- Verify wallet is enabled

#### "Invalid input amount"
- Check transaction parsing
- Verify amount extraction from blockchain data
- Ensure positive amounts

#### "Slippage exceeds maximum tolerance"
- Check current market conditions and liquidity
- Consider increasing `slippageTolerance` in config.json
- Review the actual vs expected slippage in logs
- Example: `Actual: 8.5%, Max: 5.0%` - increase max to 10%

#### "GALA amount below minimum threshold"
- Check if the trade involves GALA and the amount is below the threshold
- Adjust `galaMinimumThreshold` in config.json if needed
- Example: `GALA input amount (25) below minimum threshold (50)` - increase threshold or accept smaller trades

#### WebSocket disconnections
- Check network connectivity
- Verify GalaChain explorer availability
- Review reconnection settings

### Debug Mode

Enable detailed logging:

```bash
# Set log level to debug
export LOG_LEVEL=debug
npm run dev
```

### Health Checks

Monitor bot health:

```bash
# Check system health
curl http://localhost:3000/health

# View wallet statistics
curl http://localhost:3000/wallets

# Check position summary
curl http://localhost:3000/positions
```

## 🔒 Security Best Practices

1. **Private Key Security**
   - Never commit private keys to version control
   - Use environment variables for sensitive data
   - Consider using hardware wallets for production

2. **Risk Management**
   - Start with small amounts
   - Set conservative position limits
   - Monitor performance regularly

3. **Network Security**
   - Use secure connections
   - Monitor for suspicious activity
   - Keep software updated

## 📈 Performance Optimization

### Recommended Settings

For **Conservative Trading**:
```json
{
  "maxTotalExposure": 0.1,
  "slippageTolerance": 0.03,
  "executionDelay": 60,
  "cooldownMinutes": 10
}
```

For **Aggressive Trading**:
```json
{
  "maxTotalExposure": 0.3,
  "slippageTolerance": 0.08,
  "executionDelay": 15,
  "cooldownMinutes": 2
}
```

### Monitoring Recommendations

- **Daily**: Check trade execution and performance
- **Weekly**: Review wallet performance and adjust priorities
- **Monthly**: Analyze overall strategy and risk metrics

## 🤝 Support

### Getting Help

1. **Check Logs**: Review detailed logs for error messages
2. **Validate Config**: Use `npm run validate-config` to check configuration
3. **Test Connection**: Verify WebSocket connectivity
4. **Review Documentation**: Check this README and code comments

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## ⚠️ Disclaimer

This software is for educational and research purposes. Trading cryptocurrencies involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this software. Always do your own research and trade responsibly.

---

**Happy Trading! 🚀**
