# SOL Arbitrage Bot

Cross-chain arbitrage bot that detects price discrepancies between GalaChain and Solana, executes paired trades, and bridges tokens back to GalaChain.

## Overview

This bot implements the "Arb-MVP" strategy as defined in the PRD:
- Detects clear price discrepancies between GalaChain and Solana
- Executes paired trades: sell on GalaChain, buy on Solana
- Bridges accumulated tokens from Solana back to GalaChain
- Maintains inventory mode with minimal risk exposure

## Features

- **Price Discovery**: Real-time price comparison between chains
- **Dual-Leg Execution**: Near-simultaneous GC sell + SOL buy
- **Automatic Bridging**: Periodic SOL→GC token transfers
- **Risk Management**: Slippage protection, cooldowns, inventory floors
- **Monitoring**: PnL tracking, inventory management, alerting

## Supported Tokens

- FARTCOIN
- TRUMP
- SOL
- GALA

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure the bot:
   ```bash
   cp config/config.example.json config/config.json
   # Edit config.json with your settings
   ```

3. Set environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and wallet addresses
   ```

4. Build and run:
   ```bash
   npm run build
   npm start
   ```

## Development

```bash
# Development mode with hot reload
npm run dev

# Watch mode for TypeScript compilation
npm run watch

# Run tests
npm test

# Lint code
npm run lint
```

## Configuration

See `config/config.json` for bot configuration options including:
- Enabled tokens and trade sizes
- Risk parameters (edge thresholds, slippage tolerance)
- Bridge settings (frequency, thresholds)
- Monitoring and alerting settings

## Architecture

- **Core**: Quote calculation, decision logic, PnL tracking
- **Execution**: Dual-leg trade execution (GC + SOL)
- **Bridging**: SOL→GC token transfers
- **Monitoring**: Alerts, inventory tracking, dashboard

## License

MIT
