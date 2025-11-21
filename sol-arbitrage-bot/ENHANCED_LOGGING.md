# Enhanced Logging Format

The bot now provides explicit, detailed logging for each token evaluation cycle showing:

1. **Prices Found** - Clear display of quotes from both chains
2. **Edge Calculation** - Complete breakdown of profitability
3. **Decision** - Explicit trade/no-trade decision with reasons

## Example Log Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Evaluating FARTCOIN (Trade Size: 1000)

💰 PRICES FOUND: {
  token: 'FARTCOIN',
  '🔷 GalaChain (SELL)': {
    chain: 'GalaChain',
    action: 'SELL',
    price: '0.15000000 GALA per FARTCOIN',
    priceImpact: '-10 bps',
    proceeds: '150.00000000 GALA',
    trade: 'Sell 1000 FARTCOIN on GalaChain → Receive 150.00000000 GALA'
  },
  '🔸 Solana (BUY)': {
    chain: 'Solana',
    action: 'BUY',
    price: '0.00005000 SOL per FARTCOIN',
    priceImpact: '+5 bps',
    cost: '0.05000000 SOL',
    trade: 'Buy 1000 FARTCOIN on Solana ← Spend 0.05000000 SOL'
  }
}

💱 Exchange Rate: {
  solToGala: '1 SOL = 2800.0000 GALA',
  solUsd: '1 SOL = $140.0000',
  galaUsd: '1 GALA = $1.0000 (placeholder)'
}

🧮 EDGE CALCULATION: {
  token: 'FARTCOIN',
  breakdown: {
    '🔷 GalaChain Proceeds (from SELL)': '150.00000000 GALA',
    '🔸 Solana Cost (from BUY)': '140.00000000 GALA (0.05000000 SOL converted from Solana)',
    bridgeCost: '31.25000000 GALA',
    riskBuffer: '1.50000000 GALA',
    totalCost: '172.75000000 GALA'
  },
  netEdge: {
    absolute: '-22.75000000 GALA',
    percentage: '-131 bps',
    threshold: '30 bps (minimum)',
    meetsThreshold: '❌ NO'
  },
  priceImpact: {
    '🔷 GalaChain': '-10 bps',
    '🔸 Solana': '+5 bps',
    maxAllowed: '50 bps',
    acceptable: '✅ YES'
  },
  profitability: '❌ NOT PROFITABLE'
}

❌ DECISION: DO NOT TRADE {
  token: 'FARTCOIN',
  reasons: '1. Negative net edge
   2. Edge -131 bps below threshold 30 bps'
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Successful Trade Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Evaluating SOL (Trade Size: 0.01)

💰 PRICES FOUND: {
  token: 'SOL',
  galaChain: {
    action: 'SELL',
    price: '2800.00000000 GALA per SOL',
    priceImpact: '-2 bps',
    proceeds: '28.00000000 GALA',
    trade: 'Sell 0.01 SOL → Receive 28.00000000 GALA'
  },
  solana: {
    action: 'BUY',
    price: '1.00000000 USDC per SOL',
    priceImpact: '+1 bps',
    cost: '0.01000000 USDC',
    trade: 'Buy 0.01 SOL ← Spend 0.01000000 USDC'
  }
}

💱 Quote Currency: USDC (no conversion needed for edge calc)

🧮 EDGE CALCULATION: {
  token: 'SOL',
  breakdown: {
    galaChainProceeds: '28.00000000 GALA',
    solanaCost: '27.80000000 GALA (0.01000000 USDC converted)',
    bridgeCost: '31.25000000 GALA',
    riskBuffer: '0.28000000 GALA',
    totalCost: '59.33000000 GALA'
  },
  netEdge: {
    absolute: '-31.33000000 GALA',
    percentage: '-52 bps',
    threshold: '30 bps (minimum)',
    meetsThreshold: '❌ NO'
  },
  priceImpact: {
    galaChain: '-2 bps',
    solana: '+1 bps',
    maxAllowed: '50 bps',
    acceptable: '✅ YES'
  },
  profitability: '❌ NOT PROFITABLE'
}

❌ DECISION: DO NOT TRADE {
  token: 'SOL',
  reasons: '1. Negative net edge
   2. Edge -52 bps below threshold 30 bps'
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## When Trade Proceeds

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Evaluating TRUMP (Trade Size: 0.01)

💰 PRICES FOUND: {
  token: 'TRUMP',
  galaChain: {
    action: 'SELL',
    price: '0.00500000 GALA per TRUMP',
    priceImpact: '-3 bps',
    proceeds: '0.00005000 GALA',
    trade: 'Sell 0.01 TRUMP → Receive 0.00005000 GALA'
  },
  solana: {
    action: 'BUY',
    price: '0.00000150 SOL per TRUMP',
    priceImpact: '+2 bps',
    cost: '0.00000002 SOL',
    trade: 'Buy 0.01 TRUMP ← Spend 0.00000002 SOL'
  }
}

💱 Exchange Rate: {
  solToGala: '1 SOL = 2800.0000 GALA',
  solUsd: '1 SOL = $140.0000',
  galaUsd: '1 GALA = $1.0000 (placeholder)'
}

🧮 EDGE CALCULATION: {
  token: 'TRUMP',
  breakdown: {
    galaChainProceeds: '0.00005000 GALA',
    solanaCost: '0.00005600 GALA (0.00000002 SOL converted)',
    bridgeCost: '31.25000000 GALA',
    riskBuffer: '0.00000050 GALA',
    totalCost: '31.25005650 GALA'
  },
  netEdge: {
    absolute: '-31.25000650 GALA',
    percentage: '-100000 bps',
    threshold: '30 bps (minimum)',
    meetsThreshold: '❌ NO'
  },
  priceImpact: {
    galaChain: '-3 bps',
    solana: '+2 bps',
    maxAllowed: '50 bps',
    acceptable: '✅ YES'
  },
  profitability: '❌ NOT PROFITABLE'
}

❌ DECISION: DO NOT TRADE {
  token: 'TRUMP',
  reasons: '1. Negative net edge
   2. Edge -100000 bps below threshold 30 bps'
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Log Format Details

### Chain Identification
All logs now explicitly label which chain each operation is on:
- **🔷 GalaChain (SELL)**: All GalaChain operations (selling token, receiving GALA)
- **🔸 Solana (BUY)**: All Solana operations (buying token, spending SOL/USDC)

### Price Display
- **🔷 GalaChain**: Shows SELL price, impact, total proceeds (with "on GalaChain" in trade description)
- **🔸 Solana**: Shows BUY price, impact, total cost (with "on Solana" in trade description)
- Both include human-readable trade description with explicit chain mention

### Edge Calculation Breakdown
- **🔷 GalaChain Proceeds (from SELL)**: Revenue from selling token on GalaChain
- **🔸 Solana Cost (from BUY)**: Cost converted to GALA for comparison (shows original amount from Solana)
- **Bridge Cost**: Fixed bridge fee (~$1.25 USD)
- **Risk Buffer**: Safety margin
- **Total Cost**: Sum of all costs
- **Net Edge**: Absolute and percentage (bps) profit
- **Threshold Check**: Whether minimum edge requirement met

### Decision Output
- Clear ✅ or ❌ indicator
- Numbered list of reasons if blocked
- Expected net edge shown when proceeding

### Execution Results
- Success: Transaction hashes with explicit chain labels (🔷 GalaChain txHash, 🔸 Solana txSignature)
- Failure: Error messages labeled by chain (🔷 GalaChain error, 🔸 Solana error)
- Partial: Which leg succeeded/failed with chain identification

## Benefits

1. **Transparency**: See exactly what prices were found
2. **Auditability**: Complete edge calculation breakdown
3. **Debugging**: Clear reasons for trade/no-trade decisions
4. **Monitoring**: Easy to spot profitable vs unprofitable opportunities
5. **Optimization**: Identify which components (bridge cost, risk buffer) are blocking trades

