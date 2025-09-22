# PM2 Setup Guide for Buy/Sell Periodic Bot

This guide shows you how to run the Buy/Sell Periodic Bot using PM2 for production deployment with automatic restarts, logging, and monitoring.

## 📋 Prerequisites

1. **Install PM2 globally**:
   ```bash
   npm install -g pm2
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables** (create `.env` file):
   ```bash
   # Copy the example file
   cp env.example .env
   
   # Edit the .env file with your values
   nano .env
   ```

## 🚀 Quick Start

### 1. Create your `.env` file
```bash
# REQUIRED: Your wallet address (format: eth|0x...)
WALLET_ADDRESS=eth|0xYourWalletAddressHere

# REQUIRED: Your private key (format: 0x...)
PRIVATE_KEY=0xYourPrivateKeyHere

# OPTIONAL: Buy amount in GUSDC (default: 10)
BUY_AMOUNT=10

# OPTIONAL: Sell amount in GALA (default: 10)
SELL_AMOUNT=10

# OPTIONAL: Duration of each buy/sell phase in milliseconds (default: 300000 = 5 minutes)
TRADE_DURATION=300000

# OPTIONAL: Frequency of trades in milliseconds (default: 30000 = 30 seconds)
TRADE_FREQUENCY=30000

# OPTIONAL: Slippage tolerance (default: 0.05 = 5%)
SLIPPAGE_TOLERANCE=0.05
```

### 2. Start the Bot
```bash
# Start in production mode
npm run pm2:start:prod

# Or start with default settings
npm run pm2:start
```

### 3. Check Status
```bash
npm run pm2:status
```

### 4. View Logs
```bash
# View recent logs
npm run pm2:logs

# Follow logs in real-time
npm run pm2:logs:follow
```

## 🔧 PM2 Commands

### Basic Operations
```bash
# Start the bot
npm run pm2:start

# Stop the bot
npm run pm2:stop

# Restart the bot
npm run pm2:restart

# Reload the bot (zero-downtime restart)
npm run pm2:reload

# Delete the bot from PM2
npm run pm2:delete
```

### Monitoring
```bash
# Check status
npm run pm2:status

# Open PM2 monitoring dashboard
npm run pm2:monit

# View logs
npm run pm2:logs
```

## 📁 File Structure

```
basic-buy-sell-periodic/
├── ecosystem.config.js      # PM2 configuration
├── buy-sell-periodic.mjs    # Main bot script
├── package.json             # Dependencies and scripts
├── .env                     # Environment variables (create this)
├── env.example              # Environment variables template
├── logs/                    # PM2 log files (auto-created)
│   ├── buy-sell-periodic.log
│   ├── buy-sell-periodic-out.log
│   └── buy-sell-periodic-error.log
└── PM2_SETUP.md            # This guide
```

## ⚙️ PM2 Configuration Features

The `ecosystem.config.js` includes:

- **Auto-restart**: Automatically restarts on crashes
- **Memory limit**: Restarts if memory usage exceeds 1GB
- **Daily restart**: Restarts daily at 2 AM for stability
- **Logging**: Separate files for output, errors, and combined logs
- **Environment support**: Different configs for dev/prod
- **Watch mode**: Can watch for file changes (disabled by default)

## 🔍 Monitoring & Logs

### Log Files
- `logs/buy-sell-periodic.log` - Combined logs
- `logs/buy-sell-periodic-out.log` - Standard output
- `logs/buy-sell-periodic-error.log` - Error logs

### Real-time Monitoring
```bash
# Follow logs in real-time
pm2 logs buy-sell-periodic-bot --follow

# Monitor system resources
pm2 monit

# Check detailed status
pm2 show buy-sell-periodic-bot
```

## 🛠️ Advanced Configuration

### Custom Environment Variables
You can override any setting by setting environment variables:

```bash
export BUY_AMOUNT="20"
export SELL_AMOUNT="600"
export TRADE_FREQUENCY="60000"
export SLIPPAGE_TOLERANCE="0.08"
npm run pm2:start:prod
```

### Multiple Instances
To run multiple instances (not recommended for this bot):

```bash
pm2 start ecosystem.config.js -i 2  # Run 2 instances
```

### Custom Restart Schedule
Edit `ecosystem.config.js` to change the restart schedule:

```javascript
cron_restart: '0 2 * * *',  // Daily at 2 AM
// Or disable: cron_restart: false,
```

## 🚨 Troubleshooting

### Bot Won't Start
1. Check if PM2 is installed: `pm2 --version`
2. Verify dependencies: `npm install`
3. Check environment variables: `pm2 env 0`
4. View error logs: `pm2 logs buy-sell-periodic-bot --err`

### Bot Keeps Restarting
1. Check error logs: `pm2 logs buy-sell-periodic-bot --err`
2. Verify your `.env` file has correct values
3. Check memory usage: `pm2 monit`
4. Review restart settings in `ecosystem.config.js`

### Logs Not Appearing
1. Check log directory permissions
2. Verify log file paths in `ecosystem.config.js`
3. Check PM2 log location: `pm2 logs --lines 100`

## 🔄 Auto-Start on System Boot

To start the bot automatically when the system boots:

```bash
# Save current PM2 processes
pm2 save

# Generate startup script
pm2 startup

# Follow the instructions provided by the startup command
```

## 📊 Performance Monitoring

### Key Metrics to Monitor
- **Memory usage**: Should stay under 1GB
- **CPU usage**: Should be low during normal operation
- **Restart count**: Should be minimal
- **Uptime**: Should be high (99%+)

### Health Checks
```bash
# Check if bot is responding
pm2 ping

# Get detailed process info
pm2 show buy-sell-periodic-bot

# Monitor in real-time
pm2 monit
```

## 🎯 Best Practices

1. **Always test first**: Run with small amounts initially
2. **Use production environment**: `npm run pm2:start:prod`
3. **Monitor logs regularly**: `npm run pm2:logs:follow`
4. **Set up log rotation**: Configure logrotate for log files
5. **Backup configuration**: Keep `.env` file backed up
6. **Test restarts**: Verify the bot recovers properly after restarts

## 🔐 Security Notes

- Never commit `.env` files with private keys
- Use environment variables for sensitive data
- Regularly rotate private keys
- Monitor for unauthorized access attempts
- Keep PM2 and Node.js updated

## 📞 Support

If you encounter issues:

1. Check the logs: `npm run pm2:logs`
2. Verify your `.env` file configuration
3. Review this guide and the main README
4. Check PM2 documentation: https://pm2.keymetrics.io/docs/

## 🚀 Quick Deployment Checklist

- [ ] Install PM2: `npm install -g pm2`
- [ ] Install dependencies: `npm install`
- [ ] Create `.env` file from `env.example`
- [ ] Set your `WALLET_ADDRESS` and `PRIVATE_KEY`
- [ ] Configure trading parameters (optional)
- [ ] Start the bot: `npm run pm2:start:prod`
- [ ] Check status: `npm run pm2:status`
- [ ] Monitor logs: `npm run pm2:logs:follow`
- [ ] Set up auto-start: `pm2 save && pm2 startup`
