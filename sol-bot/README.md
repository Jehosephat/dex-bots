# SOL BOT - Cross-Chain Arbitrage Bot

Inventory-Mode Cross-Chain Arbitrage Bot that executes trades between Solana and GalaChain.

## 🚀 Quick Start

### Prerequisites

1. **Node.js 18+** installed
2. **Solana CLI** installed (see IMPLEMENTATION.md)
3. **GalaChain wallet** with private key
4. **Solana wallet** with private key
5. **Slack webhook** for notifications (optional)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp env.example .env

# Edit .env with your credentials
nano .env

# Build the project
npm run build

# Run the bot
npm start
```

### Development Mode

```bash
# Run in development mode with auto-reload
npm run dev

# Watch mode for TypeScript compilation
npm run watch

# Run tests
npm test
```

## 📁 Project Structure

```
sol-bot/
├── src/
│   ├── core/                  # Core modules
│   │   ├── priceDiscovery.ts  # ✅ Cross-chain price monitoring
│   │   ├── inventoryManager.ts # ✅ Dual-chain inventory tracking
│   │   ├── bridgeMonitor.ts   # 🚧 Bridge status & ETA tracking
│   │   └── riskManager.ts     # 🚧 Risk controls & guardrails
│   ├── execution/             # Execution engine
│   │   ├── dualLegExecutor.ts # 🚧 GC sell + SOL buy execution
│   │   ├── galaChainExecutor.ts # 🚧 GalaChain trading
│   │   └── solanaExecutor.ts  # 🚧 Solana trading
│   ├── bridging/              # Bridge integration
│   │   ├── galaChainBridge.ts # 🚧 GalaChain Bridge integration
│   │   ├── batchBridgeManager.ts # 🚧 Batch bridging
│   │   └── bridgeReconciler.ts # 🚧 Bridge reconciliation
│   ├── monitoring/            # Monitoring & alerts
│   │   ├── telemetry.ts       # 🚧 PnL & metrics tracking
│   │   ├── slackAlerts.ts     # 🚧 Slack notifications
│   │   └── localDashboard.ts  # 🚧 Development dashboard
│   ├── utils/                 # Utilities
│   │   ├── logger.ts          # ✅ Structured logging
│   │   ├── config.ts          # ✅ Configuration management
│   │   └── stateManager.ts    # ✅ Persistent state
│   ├── types/                 # TypeScript types
│   │   └── index.ts           # ✅ Type definitions
│   └── index.ts               # 🚧 Main orchestrator
├── config/
│   ├── config.json            # ✅ Trading parameters
│   └── tokens.json            # ✅ Supported tokens
├── tests/                     # Test files
├── logs/                      # Log files
└── dist/                      # Compiled output
```

**Legend:**
- ✅ Completed
- 🚧 In Progress
- ⏳ Pending

## 🔧 Configuration

### Supported Tokens

The bot currently supports:
- **GALA** - Native GalaChain token
- **FARTCOIN** - Meme token
- **TRUMP** - Meme token
- **SOL** - Solana native token

Token configurations can be modified in `config/tokens.json`.

### Trading Parameters

Default conservative settings in `config/config.json`:

```json
{
  "trading": {
    "minEdgeThreshold": 0.02,      // 2% minimum edge
    "maxPriceImpact": 0.03,        // 3% max price impact
    "maxConcurrentTrades": 2,      // Max simultaneous trades
    "slippageTolerance": 0.05,     // 5% slippage protection
    "executionTimeout": 30000,     // 30 second timeout
    "riskBuffer": 0.01             // 1% risk buffer
  }
}
```

These can be adjusted based on market conditions.

## 🔐 Environment Variables

Required environment variables in `.env`:

```bash
# GalaChain Configuration
GALA_PRIVATE_KEY=your_gala_private_key_here
GALA_WALLET_ADDRESS=eth|your_wallet_address_here
GALA_RPC_ENDPOINT=https://mainnet.galachain.io

# Solana Configuration
SOLANA_PRIVATE_KEY=your_solana_private_key_here
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com

# Bridge Configuration
GALACHAIN_BRIDGE_API=https://bridge.galachain.io
BRIDGE_API_KEY=your_bridge_api_key_here

# Slack Configuration (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK

# Environment
NODE_ENV=development
LOG_LEVEL=info
DASHBOARD_PORT=3000
```

## 📊 Monitoring

### Logs

Logs are written to the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Errors only
- `trades.log` - Trade execution logs

### Dashboard (Coming Soon)

Local dashboard will be available at `http://localhost:3000` showing:
- Real-time PnL tracking
- Trade history
- Inventory status
- Bridge status
- System health

### Slack Alerts (Coming Soon)

Receive real-time alerts for:
- Trade executions with PnL
- Risk events and circuit breakers
- Bridge status updates
- System errors

## 🛡️ Risk Management

The bot implements multiple layers of risk protection:

1. **Minimum Edge Threshold** - Only executes trades above 2% edge
2. **Price Impact Limits** - Rejects trades with >3% price impact
3. **Slippage Protection** - 5% maximum slippage tolerance
4. **Circuit Breaker** - Pauses after 3 consecutive failures
5. **Daily Loss Limit** - Maximum $500 daily loss
6. **Inventory Minimums** - Maintains minimum working balances
7. **Execution Timeout** - 30 second maximum per trade

## 🔄 Bridge Integration

The bot uses the existing GalaChain Bridge for SOL ↔ GC transfers:

- **Bridge Cost**: $1.25 per transaction (configurable)
- **Bridge Interval**: Every 30 minutes or on threshold
- **Bridge Monitoring**: Tracks all pending bridge transactions
- **Auto-Reconciliation**: Updates inventory on bridge completion

## 📝 Development Status

### Phase 1: Foundation ✅
- [x] Project structure
- [x] TypeScript configuration
- [x] Dependencies installed
- [x] Configuration files
- [x] Environment setup
- [x] Logger implementation
- [x] Config manager
- [x] State manager
- [x] Type definitions

### Phase 2: Core Modules 🚧
- [x] Price discovery module
- [x] Inventory manager
- [ ] Bridge monitor
- [ ] Risk manager
- [ ] Guardrails implementation

### Phase 3: Execution Engine ⏳
- [ ] Dual-leg executor
- [ ] GalaChain executor
- [ ] Solana executor

### Phase 4: Bridge Integration ⏳
- [ ] GalaChain Bridge client
- [ ] Batch bridge manager
- [ ] Bridge reconciler

### Phase 5: Risk Controls ⏳
- [ ] Risk manager implementation
- [ ] Circuit breaker logic
- [ ] Emergency stop

### Phase 6: Monitoring ⏳
- [ ] Telemetry system
- [ ] Slack alerts
- [ ] Local dashboard

### Phase 7: Testing ⏳
- [ ] Unit tests
- [ ] Integration tests
- [ ] Performance tests
- [ ] Security tests

## 🚨 Important Notes

### Security
- Never commit `.env` file or private keys
- Keep private keys encrypted in production
- Use secure RPC endpoints
- Monitor for unusual activity

### Testing
- Always test on devnet first
- Start with small trade sizes
- Verify bridge functionality thoroughly
- Monitor slippage and execution times

### Production Deployment
- Run on a VPS with good uptime
- Set up monitoring and alerts
- Configure automatic restarts (PM2)
- Keep logs and state backed up

## 📚 Documentation

- [PRD.md](./PRD.md) - Product Requirements Document
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - Detailed Implementation Plan

## 🤝 Contributing

This is a private trading bot. Modifications should be tested thoroughly before deployment.

## ⚠️ Disclaimer

This bot is provided for educational purposes. Trading cryptocurrencies involves risk. Always test thoroughly and understand the risks before deploying with real funds.

## 📞 Support

For questions or issues, check the logs in the `logs/` directory or review the implementation documentation.

