# Follow Bot - GalaSwap Copy Trading Strategy

## 🎯 Overview

The Follow Bot is an automated trading system that monitors a curated list of successful GalaSwap traders and automatically replicates their trading positions. By copying trades from proven profitable wallets, the bot aims to capture similar returns while maintaining risk management controls.

## 🏗️ Architecture

### Core Components
- **`index.ts`** - Main bot orchestrator and trade execution engine
- **`walletMonitor.ts`** - WebSocket-based monitoring of target wallets
- **`websocketManager.ts`** - GalaChain block explorer WebSocket connection management
- **`tradeAnalyzer.ts`** - Analyzes and validates trades before execution
- **`positionManager.ts`** - Manages position sizing and risk controls
- **`config.json`** - Configuration file for target wallets and parameters
- **`state.json`** - Persistent state storage for VPS deployment

### Strategy Details
- **Target Platform**: GalaSwap V3 DEX
- **Monitoring**: Real-time transaction monitoring via GalaChain Block Explorer WebSocket
- **Execution**: Automated trade replication with configurable delays
- **Risk Management**: Position sizing, cooldown periods, and maximum exposure limits
- **Deployment**: Headless Linux VPS with systemd service management

## 🚀 Core Functionality

### Wallet Monitoring
- **Target Wallet List**: Configurable list of successful trader addresses
- **Transaction Detection**: Real-time monitoring via GalaChain Block Explorer WebSocket
- **Trade Classification**: Identifies buy/sell orders and position changes
- **Filtering**: Excludes non-trading transactions (transfers, approvals, etc.)
- **WebSocket Connection**: Persistent connection to GalaChain block explorer for instant updates

### Trade Replication
- **Exact Copy Mode**: Replicates trades with identical token pairs and directions
- **Proportional Copy Mode**: Scales trade sizes based on available capital
- **Delayed Execution**: Configurable delay to avoid front-running
- **Slippage Protection**: Built-in slippage tolerance for execution

### Position Management
- **Dynamic Sizing**: Adjusts position sizes based on available capital
- **Exposure Limits**: Maximum percentage of portfolio per trade
- **Cooldown Periods**: Prevents over-trading and reduces gas costs
- **Stop Losses**: Optional automatic stop-loss orders

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIVATE_KEY` | - | Your wallet private key (required) |
| `WALLET_ADDRESS` | - | Your wallet address (required) |
| `TARGET_WALLETS` | - | Comma-separated list of wallet addresses to follow |
| `COPY_MODE` | `proportional` | Copy mode (`exact`, `proportional`) |
| `MAX_POSITION_SIZE` | `0.1` | Maximum position size as % of portfolio |
| `EXECUTION_DELAY` | `30` | Delay in seconds before executing copied trades |
| `COOLDOWN_MINUTES` | `5` | Minimum time between trades |
| `SLIPPAGE_TOLERANCE` | `0.05` | Slippage tolerance (5%) |
| `ENABLE_AUTO_TRADING` | `false` | Enable automatic trade execution |
| `MIN_TRADE_AMOUNT` | `10` | Minimum trade amount in GUSDC |
| `MAX_DAILY_TRADES` | `50` | Maximum trades per day |
| `WEBSOCKET_RECONNECT_DELAY` | `5000` | WebSocket reconnection delay in ms |
| `WEBSOCKET_MAX_RETRIES` | `10` | Maximum WebSocket reconnection attempts |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `LOG_FILE` | `/var/log/follow-bot.log` | Log file path for VPS deployment |

### Target Wallet Configuration

```json
{
  "targetWallets": [
    {
      "address": "eth|0x...",
      "name": "Whale Trader 1",
      "maxCopyAmount": 1000,
      "enabled": true,
      "priority": 1
    },
    {
      "address": "eth|0x...",
      "name": "Successful Bot",
      "maxCopyAmount": 500,
      "enabled": true,
      "priority": 2
    }
  ],
  "globalSettings": {
    "maxTotalExposure": 0.3,
    "blacklistedTokens": ["TOKEN1", "TOKEN2"],
    "whitelistedTokens": ["GALA", "GWETH", "GUSDC"]
  }
}
```

## 🔍 Trade Analysis & Validation

### Pre-Execution Checks
- **Token Validation**: Ensures tokens are whitelisted and not blacklisted
- **Size Validation**: Verifies trade size is within configured limits
- **Balance Check**: Confirms sufficient balance for trade execution
- **Market Conditions**: Validates current market liquidity and volatility

### Risk Filters
- **Position Size Limits**: Maximum percentage of portfolio per trade
- **Daily Trade Limits**: Prevents over-trading and excessive gas costs
- **Cooldown Enforcement**: Respects minimum time between trades
- **Exposure Monitoring**: Tracks total portfolio exposure across all positions

## 🤖 Trade Execution

### Execution Modes

#### Exact Copy Mode
- Replicates trades with identical amounts (scaled to available capital)
- Maintains exact same token pairs and trade directions
- Best for following traders with similar capital levels

#### Proportional Copy Mode
- Scales trade sizes based on available capital vs. target wallet
- Maintains same risk profile as target trader
- Recommended for most use cases

### Execution Flow
1. **Transaction Detection**: Monitor target wallets for new GalaSwap transactions
2. **Trade Analysis**: Parse transaction to extract trade details
3. **Validation**: Apply risk filters and validation checks
4. **Sizing**: Calculate appropriate position size based on copy mode
5. **Execution**: Execute trade with configured delay and slippage protection
6. **Tracking**: Log trade details and update position tracking

## 🛡️ Risk Management

### Built-in Protections
- **Position Limits**: Maximum exposure per trade and total portfolio
- **Daily Limits**: Maximum number of trades per day
- **Cooldown Periods**: Minimum time between trades
- **Slippage Protection**: Configurable slippage tolerance
- **Balance Monitoring**: Continuous balance and exposure tracking

### Safety Features
- **Manual Override**: Ability to pause/resume bot operation
- **Emergency Stop**: Immediate halt of all trading activity
- **Position Monitoring**: Real-time tracking of all open positions
- **Error Handling**: Graceful handling of failed transactions

## 📊 Monitoring & Analytics

### Real-time Monitoring
- **Trade Logs**: Detailed logs of all copied trades
- **Performance Tracking**: PnL tracking vs. target wallets
- **Position Status**: Current open positions and exposure
- **Error Reporting**: Failed transactions and retry attempts

### Analytics Dashboard
- **Copy Performance**: Success rate of copied trades
- **Portfolio Tracking**: Total portfolio value and exposure
- **Target Analysis**: Performance comparison with target wallets
- **Risk Metrics**: Current risk exposure and limits

## 🔧 GalaChain Integration

### WebSocket Integration
- **Block Explorer WebSocket**: Real-time transaction monitoring via GalaChain block explorer
- **Connection Management**: Automatic reconnection with exponential backoff
- **Message Filtering**: Filters transactions for target wallets only
- **Error Handling**: Graceful handling of connection drops and API errors

### API Endpoints
- **Transaction Monitoring**: Real-time transaction feed via WebSocket
- **Pool Data**: Liquidity and pricing information
- **Balance Queries**: Wallet balance monitoring
- **Trade Execution**: GSwap SDK integration

### Dependencies
- **GSwap SDK**: Official GalaChain trading SDK
- **GalaChain API**: Transaction and pool data access
- **WebSocket Client**: Persistent connection to block explorer
- **Node.js WebSocket**: Native WebSocket support for real-time data

## 📈 Performance Optimization

### Efficiency Features
- **Batch Processing**: Group multiple trades for gas optimization
- **Smart Routing**: Automatic fee tier selection for best execution
- **Cache Management**: Efficient caching of frequently accessed data
- **Connection Pooling**: Optimized API connection management

### Scalability
- **Multi-wallet Support**: Monitor multiple target wallets simultaneously
- **Async Processing**: Non-blocking trade execution and monitoring
- **Resource Management**: Efficient memory and CPU usage
- **Error Recovery**: Automatic retry and recovery mechanisms

## 🚨 Important Considerations

### Legal & Compliance
- **No Financial Advice**: This bot is for educational purposes only
- **Risk Disclosure**: Cryptocurrency trading involves substantial risk
- **Regulatory Compliance**: Ensure compliance with local regulations
- **Tax Implications**: Consider tax implications of automated trading

### Technical Limitations
- **Network Dependencies**: Requires stable internet and GalaChain connectivity
- **API Rate Limits**: Subject to GalaChain API rate limiting
- **Gas Costs**: Ethereum gas costs affect profitability
- **Slippage**: Market conditions may cause execution slippage

## 🔧 Installation & Setup

### Prerequisites
- Node.js 18+ with TypeScript support
- GalaChain wallet with sufficient balance
- GalaChain API access
- Linux VPS (Ubuntu 20.04+ recommended)

### Local Development Setup
```bash
# Clone repository
git clone <repository-url>
cd follow-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Configure target wallets
cp config.example.json config.json
# Edit config.json with target wallet addresses

# Build and run
npm run build
npm start
```

### VPS Deployment

#### Option 1: Direct Installation
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Clone and setup bot
git clone <repository-url>
cd follow-bot
npm install
npm run build

# Configure environment
cp .env.example .env
# Edit .env with production settings

# Configure target wallets
cp config.example.json config.json
# Edit config.json with target wallet addresses

# Start with PM2
pm2 start dist/index.js --name follow-bot
pm2 save
pm2 startup
```

#### Option 2: Docker Deployment
```bash
# Create Dockerfile
cat > Dockerfile << EOF
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY config.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
EOF

# Build and run
docker build -t follow-bot .
docker run -d --name follow-bot --restart unless-stopped \
  -v /path/to/config:/app/config \
  -v /path/to/logs:/var/log \
  follow-bot
```

#### Option 3: Systemd Service
```bash
# Create systemd service file
sudo tee /etc/systemd/system/follow-bot.service > /dev/null << EOF
[Unit]
Description=Follow Bot - GalaSwap Copy Trading
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/follow-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/home/ubuntu/follow-bot/.env

# Logging
StandardOutput=append:/var/log/follow-bot.log
StandardError=append:/var/log/follow-bot-error.log

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable follow-bot
sudo systemctl start follow-bot

# Check status
sudo systemctl status follow-bot
sudo journalctl -u follow-bot -f
```

## 📝 Example Output

### VPS Headless Operation
```
[2024-01-15T10:30:00.000Z] 🤖 Starting Follow Bot (VPS Mode)
[2024-01-15T10:30:00.001Z] Environment: production
[2024-01-15T10:30:00.002Z] Log file: /var/log/follow-bot.log
[2024-01-15T10:30:00.003Z] 🔌 Connecting to GalaChain Block Explorer WebSocket...
[2024-01-15T10:30:00.500Z] ✅ WebSocket connected successfully
[2024-01-15T10:30:00.501Z] Monitoring 3 target wallets
[2024-01-15T10:30:00.502Z] Copy mode: proportional
[2024-01-15T10:30:00.503Z] Max position size: 10% of portfolio
[2024-01-15T10:30:00.504Z] Execution delay: 30 seconds

[2024-01-15T10:30:15.000Z] 🔍 WebSocket: New transaction detected
[2024-01-15T10:30:15.001Z] From: eth|0x... (Whale Trader 1)
[2024-01-15T10:30:15.002Z] Trade: BUY 1000 GALA with 50 GUSDC
[2024-01-15T10:30:15.003Z] ✅ Trade validated - within limits
[2024-01-15T10:30:15.004Z] 📊 Calculated copy size: 100 GALA (10% of portfolio)
[2024-01-15T10:30:45.000Z] 🚀 Executing copied trade: BUY 100 GALA
[2024-01-15T10:30:47.000Z] ✅ Trade executed successfully!
[2024-01-15T10:30:47.001Z] 📈 Position updated: +100 GALA
[2024-01-15T10:30:47.002Z] 💾 State saved to /var/lib/follow-bot/state.json
```

### WebSocket Connection Management
```
[2024-01-15T10:35:00.000Z] 🔌 WebSocket connection lost, attempting reconnection...
[2024-01-15T10:35:05.000Z] 🔄 Reconnection attempt 1/10
[2024-01-15T10:35:05.500Z] ✅ WebSocket reconnected successfully
[2024-01-15T10:35:05.501Z] 🔄 Resuming transaction monitoring
```

## 🐛 Troubleshooting

### Common Issues

#### VPS Deployment Issues
- **Service won't start**: Check systemd service configuration and file permissions
- **WebSocket connection fails**: Verify firewall settings and network connectivity
- **Log file permissions**: Ensure proper permissions for log directory
- **Memory issues**: Monitor VPS resources and adjust Node.js memory limits

#### WebSocket Issues
- **Connection drops**: Check network stability and WebSocket endpoint availability
- **No transactions detected**: Verify target wallet addresses and WebSocket filters
- **Reconnection loops**: Check WebSocket endpoint and authentication
- **Message parsing errors**: Verify WebSocket message format and parsing logic

#### Trading Issues
- **No trades detected**: Check target wallet addresses and API connectivity
- **Execution failures**: Verify wallet balance and gas settings
- **High slippage**: Adjust slippage tolerance or trade timing
- **API errors**: Check rate limits and network connectivity

### Debug Mode
```bash
# Enable verbose logging
export DEBUG=true
export LOG_LEVEL=debug
npm run dev

# For VPS deployment
sudo systemctl edit follow-bot
# Add:
[Service]
Environment=DEBUG=true
Environment=LOG_LEVEL=debug

# Restart service
sudo systemctl restart follow-bot
sudo journalctl -u follow-bot -f
```

### VPS Monitoring
```bash
# Check service status
sudo systemctl status follow-bot

# View logs
sudo journalctl -u follow-bot -f
tail -f /var/log/follow-bot.log

# Check resource usage
htop
df -h

# Monitor WebSocket connections
netstat -tulpn | grep :443
ss -tulpn | grep :443
```

## 📚 Further Reading

- [GalaSwap V3 Documentation](https://docs.gala.games/)
- [GSwap SDK Guide](../GSWAP_README.md)
- [Copy Trading Best Practices](https://example.com)
- [Risk Management in Automated Trading](https://example.com)

---

**⚠️ Disclaimer**: This software is for educational and research purposes only. Copy trading involves substantial risk of loss. Past performance of target wallets does not guarantee future results. The authors are not responsible for any financial losses incurred through the use of this software.