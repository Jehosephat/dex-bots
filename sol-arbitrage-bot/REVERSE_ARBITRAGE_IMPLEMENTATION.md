# Reverse Arbitrage Implementation

## Overview

The bot now supports **bidirectional arbitrage** - evaluating both forward and reverse directions and executing the best opportunity.

## Configuration

Added to `config/config.json`:

```json
{
  "trading": {
    "enableReverseArbitrage": true,           // Enable/disable reverse arbitrage
    "reverseArbitrageMinEdgeBps": 30,         // Min edge for reverse (defaults to minEdgeBps)
    "arbitrageDirection": "best"              // "forward", "reverse", or "best"
  }
}
```

### Configuration Options:

- **`enableReverseArbitrage`**: `true`/`false` - Master switch for reverse arbitrage
- **`reverseArbitrageMinEdgeBps`**: Minimum edge threshold for reverse trades (defaults to `minEdgeBps`)
- **`arbitrageDirection`**: 
  - `"forward"`: Only execute forward trades (SELL GC → BUY SOL)
  - `"reverse"`: Only execute reverse trades (BUY GC → SELL SOL)
  - `"best"`: Evaluate both and choose the best edge

## How It Works

### 1. Quote Fetching

**Forward Quotes** (always fetched):
- GalaChain: Selling token for GALA
- Solana: Buying token with SOL/USDC

**Reverse Quotes** (if enabled):
- GalaChain: Buying token with GALA
- Solana: Selling token for SOL/USDC

### 2. Edge Calculation

**Forward Edge** (normal):
```
Net Edge = GC Proceeds - SOL Cost (GALA) - Bridge - Buffer
```

**Reverse Edge** (new):
```
Net Edge = SOL Proceeds (GALA) - GC Cost (GALA) - Bridge - Buffer
```

### 3. Direction Selection

When `arbitrageDirection = "best"`:
- Evaluates both directions
- Compares edge (in bps)
- Selects direction with highest edge (if both meet threshold)
- If only one meets threshold, uses that one
- If neither meets threshold, skips token

### 4. Logging

Enhanced logging shows:
- Prices for both directions
- Edge comparison
- Selected direction
- Direction-specific execution details

## Implementation Status

### ✅ Completed:
- [x] Config flags for reverse arbitrage
- [x] Reverse quote methods (buy GC, sell SOL)
- [x] Reverse edge calculator
- [x] Bidirectional evaluation in mainLoop
- [x] Direction selection logic
- [x] Enhanced logging for both directions

### ⏳ Pending:
- [ ] Reverse execution logic (live trades in reverse direction)
  - Currently: Reverse trades are evaluated and logged but not executed in live mode
  - Dry-run: Works for both directions

## Current Behavior

### Dry-Run Mode:
- ✅ Evaluates both directions
- ✅ Selects best opportunity
- ✅ Logs all details

### Live Mode:
- ✅ Evaluates both directions
- ✅ Selects best opportunity
- ✅ **Forward trades**: Execute normally
- ⚠️ **Reverse trades**: Evaluated but skipped with warning (execution not yet implemented)

## Example Output

```
📊 EVALUATING: SOL | Trade Size: 0.01

💰 MARKET PRICES (FORWARD: SELL GC → BUY SOL)
   🔷 GalaChain (SELL)
      Price:    17814.46515400 GALA per SOL
      ...
   🔸 Solana (BUY)
      Price:    187.12780000 USDC per SOL
      ...

💰 MARKET PRICES (REVERSE: BUY GC → SELL SOL)
   🔷 GalaChain (BUY)
      Price:    17814.46515400 GALA per SOL
      ...
   🔸 Solana (SELL)
      Price:    187.12780000 USDC per SOL
      ...

🔀 DIRECTION COMPARISON
   📈 FORWARD Edge:  -552.16 bps ❌
   📉 REVERSE Edge:  410.25 bps ✅
   🎯 SELECTED: REVERSE (410.25 bps)

🧮 EDGE CALCULATION (REVERSE)
   📥 INCOME:
      🔸 Solana Proceeds:    187.12780000 GALA
   📤 COSTS:
      🔷 GalaChain Cost:      178.14465154 GALA
      ...
   💵 NET EDGE:              +7.74 GALA (410.25 bps)
```

## Next Steps

To complete reverse arbitrage:
1. **Implement reverse execution** in `DualLegCoordinator`:
   - Buy on GalaChain (spend GALA, get token)
   - Sell on Solana (spend token, get USDC/SOL)

2. **Update inventory checks**:
   - Forward: Check token inventory on GalaChain
   - Reverse: Check GALA inventory on GalaChain

3. **Update state tracking**:
   - Track direction in trade logs
   - Adjust inventory updates based on direction

For now, the bot can **evaluate and compare both directions**, showing you which would be more profitable, even if reverse execution isn't fully implemented yet.

