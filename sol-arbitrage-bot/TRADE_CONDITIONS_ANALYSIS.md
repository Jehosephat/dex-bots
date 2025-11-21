# Trade Conditions Analysis

## Current Situation (Not Trading)

Based on the terminal output, here's the current state:

### Current Metrics:
- **GalaChain Price**: 17,815.17 GALA per SOL
- **Solana Price**: 184.16 USDC per SOL  
- **Exchange Rate**: 1 USDC = 98.43 GALA
- **Trade Size**: 0.01 SOL
- **GALA/USD Price**: $0.0102 USD

### Income & Costs:
- **GalaChain Proceeds**: 178.15 GALA
- **Solana Cost**: 181.26 GALA (1.84 USDC)
- **Bridge Cost (amortized)**: 1.23 GALA (amortized across 100 trades)
- **Risk Buffer**: 0.18 GALA
- **Total Cost**: 182.67 GALA

### Edge Calculation:
- **Net Edge**: -4.52 GALA
- **Net Edge BPS**: -247.50 bps (negative!)
- **Threshold Required**: 30 bps minimum
- **Price Impact**: ✅ Acceptable (19.69 bps GC, -0.44 bps SOL, max 50 bps)

### Bridge Cost Amortization:
With `tradesPerBridge: 100`, the bridge cost is now amortized:
- **Full Bridge Cost**: ~123.03 GALA ($1.25 USD / $0.0102 GALA)
- **Amortized per Trade**: 1.23 GALA (123.03 / 100 trades)
- **Impact**: Bridge cost reduced from 17.5% of proceeds to 0.69% of proceeds

## What Needs to Change for a Trade to Execute

For the algorithm to execute a trade, **all** of the following conditions must be met:

### 1. Net Edge Must Be Positive
```
Net Edge = GalaChain Proceeds - Total Cost
Net Edge > 0
```
Currently: `178.15 - 182.67 = -4.52` ❌ (much closer to positive!)

### 2. Net Edge BPS Must Meet Minimum Threshold
```
Net Edge BPS = (Net Edge / Total Cost) × 10,000
Net Edge BPS ≥ 30 bps
```
Currently: `-247.50 bps` ❌ (needs to be at least `+30 bps`)
- To reach 30 bps: Need net edge of at least `+5.48 GALA` (currently -4.52, so need +9.98 GALA improvement)

### 3. Price Impact Must Be Acceptable
```
GC Price Impact ≤ 50 bps AND Solana Price Impact ≤ 50 bps
```
Currently: `19.69 bps` and `-0.44 bps` ✅ (already acceptable)

## Required Changes to Make a Trade Profitable

With bridge cost amortization, we're much closer! To get from **-4.52 GALA** (loss) to **+profit with 30 bps threshold**, we need one of these scenarios:

### Scenario A: Improve Price Spread
The spread between GalaChain and Solana needs to widen slightly.

**Current spread analysis:**
- Selling 0.01 SOL on GalaChain: Get 178.15 GALA
- Buying 0.01 SOL on Solana: Costs 181.26 GALA (before bridge/fees)
- **Gap needed**: Need at least 4.52 GALA more proceeds OR 4.52 GALA less cost (plus 5.48 GALA for threshold = 10 GALA total)

**Example calculations:**
- If GalaChain price increases by **5.6%** to **18,812 GALA/SOL**: 
  - Proceeds = 188.12 GALA
  - Net Edge = 188.12 - 182.67 = 5.45 GALA
  - Net Edge BPS = (5.45 / 182.67) × 10,000 = **298 bps** ✅

- If Solana price decreases by **5.4%** to **174.20 USDC/SOL**:
  - Cost = 174.20 USDC = 171.45 GALA (at 98.43 rate)
  - Total Cost = 171.45 + 1.23 + 0.18 = 172.86 GALA
  - Net Edge = 178.15 - 172.86 = 5.29 GALA
  - Net Edge BPS = (5.29 / 172.86) × 10,000 = **306 bps** ✅

### Scenario B: Improve Exchange Rate
If GALA/USD price increases relative to USDC, the Solana cost in GALA terms decreases.

**Current**: 1 USDC = 98.43 GALA (GALA = $0.0102 USD)

If GALA price increases to **$0.0108 USD** (5.9% increase):
- 1 USDC = 92.59 GALA
- Solana Cost = 1.84 USDC × 92.59 = 170.37 GALA
- Total Cost = 170.37 + 1.23 + 0.18 = 171.78 GALA
- Net Edge = 178.15 - 171.78 = **+6.37 GALA** ✅
- Net Edge BPS = (6.37 / 171.78) × 10,000 = **371 bps** ✅

If GALA price increases to **$0.0115 USD** (13% increase):
- 1 USDC = 86.96 GALA  
- Solana Cost = 1.84 × 86.96 = 160.00 GALA
- Total Cost = 160.00 + 1.23 + 0.18 = 161.41 GALA
- Net Edge = 178.15 - 161.41 = **+16.74 GALA** ✅
- Net Edge BPS = (16.74 / 161.41) × 10,000 = **1,037 bps** ✅

### Scenario C: Reduce Costs
- **Bridge Cost**: Already optimized! Currently 1.23 GALA (amortized) - this was the biggest improvement
  - Without amortization: Would be 123.03 GALA per trade
  - With 100 trades amortization: 1.23 GALA per trade
  - **Impact**: Saved 121.80 GALA per trade!
- **Risk Buffer**: Currently 0.18 GALA (0.1% of proceeds) - minimal impact
- **Price Impact**: Already low, but lower impact = better prices

### Scenario D: Combination
Most realistic scenario combines multiple factors:

**Example (small adjustments):**
- GalaChain price increases by 2%: 18,171 GALA/SOL → Proceeds = 181.71 GALA
- Solana price decreases by 2%: 180.48 USDC/SOL → Cost = 1.80 USDC
- GALA/USD increases by 3%: $0.0105 → 1 USDC = 95.24 GALA → Solana Cost = 171.43 GALA
- Total Cost = 171.43 + 1.23 + 0.18 = 172.84 GALA
- Net Edge = 181.71 - 172.84 = **+8.87 GALA** ✅
- Net Edge BPS = (8.87 / 172.84) × 10,000 = **513 bps** ✅

**More modest combination:**
- GalaChain: 18,500 GALA/SOL (+3.8%) → Proceeds = 185.00 GALA
- Solana: 178 USDC/SOL (-3.3%) → Cost = 1.78 USDC
- GALA: $0.0106 USD (+4%) → 1 USDC = 94.34 GALA → Cost = 167.93 GALA
- Total Cost = 167.93 + 1.23 + 0.19 = 169.35 GALA
- Net Edge = 185.00 - 169.35 = **+15.65 GALA** ✅
- Net Edge BPS = (15.65 / 169.35) × 10,000 = **924 bps** ✅

## Summary: What Must Happen

With bridge cost amortization, we're **much closer to profitability**! For the algorithm to trade, one of these must occur:

1. **GalaChain price increases** by ~5.6% (from 17,815 to ~18,812 GALA/SOL), OR
2. **Solana price decreases** by ~5.4% (from 184.16 to ~174 USDC/SOL), OR  
3. **GALA/USD increases** by ~5.9% (from $0.0102 to ~$0.0108 USD), OR
4. **Combination** of small adjustments (most realistic - 2-4% changes)

### Key Insight
With **bridge cost amortization** (100 trades per bridge), the economics are dramatically improved:

- **Before amortization**: Bridge cost was 123.03 GALA per trade (69% of proceeds!)
- **After amortization**: Bridge cost is 1.23 GALA per trade (0.69% of proceeds)
- **Improvement**: Net edge improved from -35.09 GALA to -4.52 GALA (87% better!)
- **Remaining gap**: Only need ~10 GALA improvement (5.6% better spread) to become profitable

The price spread needed is now **much more realistic** and achievable in normal market conditions.

### Recommendation
1. ✅ **Bridge cost amortization** - Already implemented! This was the key optimization
2. **Monitor for better spreads** - With only a 5-6% spread improvement needed, trades should trigger more frequently
3. **Consider larger trade sizes** - Larger trades have proportionally less impact from fixed costs
4. **Monitor GALA/USD price** - Small movements in GALA price (5-6%) can make trades profitable
5. **Adjust `tradesPerBridge`** - If you bridge more frequently, increase this number. If less frequently, decrease it

