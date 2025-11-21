# 🔍 Dry Run Mode Guide

## What is Dry Run Mode?

Dry Run Mode allows you to run the bot **without executing any actual trades**. The bot will:
- ✅ Discover real arbitrage opportunities
- ✅ Validate them against all risk parameters
- ✅ Check bridge health
- ✅ Show exactly what it would execute
- ❌ NOT send any transactions to either blockchain
- ❌ NOT spend any tokens or fees

This is perfect for:
- Testing the bot's logic
- Seeing what opportunities exist in the market
- Understanding the execution flow
- Verifying configuration before going live

---

## How to Enable Dry Run Mode

### Step 1: Set Configuration

Edit `config/config.json`:

```json
{
  "trading": {
    "dryRun": true,    ← Set this to true
    "minEdgeThreshold": 0.02,
    ...
  }
}
```

### Step 2: Run the Dry Run Test

**On Windows:**
```bash
cd sol-bot
run-dry-run.bat
```

**On Mac/Linux:**
```bash
cd sol-bot
./run-dry-run.sh
```

**Or manually:**
```bash
cd sol-bot
npx tsx src/test-bot-live-dry-run.ts
```

This will:
1. Verify dry run mode is enabled
2. Start the bot
3. Run for 2 minutes
4. Show any opportunities found
5. Stop automatically
6. Display summary

---

## What You'll See

### When an Opportunity is Found:

```
================================================================================
🔍 DRY RUN - ARBITRAGE OPPORTUNITY FOUND
================================================================================
Token: GFARTCOIN
Trade Size: 2000
Net Edge: 3.45%

📤 STEP 1: GalaChain (SELL)
  Action: Sell 2000 GFARTCOIN
  Price: 0.003000 GALA per token
  Expected: ~6.00 GALA

📥 STEP 2: Solana (BUY)
  Action: Buy 2000 GFARTCOIN
  Price: 0.000650 SOL per token
  Cost: ~1.3000 SOL

💰 EXPECTED PROFIT:
  Gross Profit: 21.25 GALA
  Bridge Cost: 20.00 GALA
  Net Profit: 1.25 GALA
================================================================================
```

### If No Opportunities:

```
ℹ️  No arbitrage opportunities found during this test run.
   This is normal if markets are balanced or edges are below threshold.
```

---

## Configuration Validation

The bot checks:
- ✅ `dryRun` is set to `true`
- ✅ All risk parameters are configured
- ✅ Token configurations are valid
- ✅ Bridge monitor is operational

If dry run is **disabled**, the test script will exit with a warning.

---

## Understanding the Output

### Logs You'll See:

1. **Bot Startup:**
   ```
   ╔════════════════════════════════════════════════════════════╗
   ║        GalaChain-Solana Arbitrage Bot v1.0.0              ║
   ║                  🔍 DRY RUN MODE                          ║
   ╚════════════════════════════════════════════════════════════╝
   
   ⚠️  DRY RUN: Will show opportunities but NOT execute trades
   ```

2. **Price Discovery:**
   ```
   📊 GalaChain prices updated for 4 tokens
   📊 Solana prices updated for 4 tokens
   ```

3. **Opportunity Found:**
   ```
   Found 1 potential opportunities
   ✅ Opportunity validated for GFARTCOIN
   🔍 DRY RUN - Would execute arbitrage trade
   ```

4. **Status Updates (every 20 cycles):**
   ```
   📊 Bot Status
     uptime: 1m 23s
     cycles: 20
     opportunitiesFound: 3
     tradesExecuted: 0
   ```

---

## Switching to Live Trading

⚠️ **Only do this when you're ready!**

### Step 1: Verify Everything Works in Dry Run

Run dry run mode multiple times and verify:
- Opportunities are detected correctly
- Prices make sense
- Risk validation works
- No errors in logs

### Step 2: Implement GalaChain Signing

The placeholder signing in `galaChainExecutor.ts` must be replaced with real signing:

```typescript
// In src/execution/galaChainExecutor.ts
private async signPayload(payload: any): Promise<string> {
  // TODO: Replace this with real signing!
  const privateKey = config.getGalaPrivateKey();
  const signature = await sign(payload, privateKey);
  return signature;
}
```

### Step 3: Fund Wallets

- GalaChain: GALA + tokens you want to trade
- Solana: SOL + tokens you want to trade

### Step 4: Disable Dry Run

Edit `config/config.json`:

```json
{
  "trading": {
    "dryRun": false,    ← Set to false for live trading
    ...
  }
}
```

### Step 5: Start with Small Amounts

Lower the trade sizes in `config/tokens.json`:

```json
{
  "symbol": "GFARTCOIN",
  "minTradeSize": 10,    ← Start small!
  "maxTradeSize": 100,   ← Keep it conservative
  ...
}
```

### Step 6: Monitor Closely

Watch the first few trades carefully:
- Check transaction results
- Verify balances
- Monitor PnL
- Ensure everything works as expected

---

## Dry Run Best Practices

### 1. Run Multiple Times
Markets change, so run dry run mode at different times to see various conditions.

### 2. Check Different Configurations
Test with different `minEdgeThreshold` values to see how it affects opportunities:
- 1% (more aggressive, more opportunities)
- 2% (balanced, default)
- 3% (conservative, fewer opportunities)

### 3. Monitor Logs
Check `logs/combined.log` for detailed information:
```bash
tail -f logs/combined.log
```

### 4. Test Edge Cases
- Run during high volatility
- Run during low volume
- Run with low inventory balances
- Test circuit breaker by forcing failures

---

## FAQ

### Q: Does dry run mode consume resources?
**A:** Yes, it still:
- Fetches real prices from APIs
- Checks bridge status
- Validates risks
- Logs to files

But it does NOT:
- Send transactions
- Consume gas fees
- Move tokens

### Q: Are the opportunities real?
**A:** Yes! Prices are real-time from:
- GalaChain: DEX v3 local quoting
- Solana: Jupiter Lite API

The opportunities shown are what the bot would execute in live mode.

### Q: How accurate are the profit estimates?
**A:** Very accurate for discovery, but execution may differ due to:
- Slippage during actual execution
- Price movement between validation and execution
- Network congestion affecting gas fees
- Other traders taking the same opportunity

### Q: Can I leave it running indefinitely?
**A:** Yes, dry run mode is safe to run continuously. It's a great way to:
- Monitor market conditions
- Track opportunity frequency
- Test bot stability

### Q: Does it track "virtual" PnL?
**A:** No, since no trades execute, `totalPnL` stays at 0. But `opportunitiesFound` counts how many would have executed.

---

## Example Output

```bash
$ npx tsx src/test-bot-live-dry-run.ts

=== Live Dry Run Test ===

This will run the bot in dry run mode for 2 minutes.
It will discover real opportunities and show what it would execute,
but will NOT actually execute any trades.

✅ Dry run mode confirmed: dryRun = true
Starting bot in 3 seconds...

🚀 Initializing GalaChain-Solana Arbitrage Bot...
✅ Price Discovery initialized
✅ Inventory Manager initialized
✅ Bridge Monitor initialized
✅ Risk Manager initialized
🎉 All modules initialized successfully!

╔════════════════════════════════════════════════════════════╗
║        GalaChain-Solana Arbitrage Bot v1.0.0              ║
║                  🔍 DRY RUN MODE                          ║
╚════════════════════════════════════════════════════════════╝

⚠️  DRY RUN: Will show opportunities but NOT execute trades

📊 Configuration:
  • Enabled Tokens: GFARTCOIN, GTRUMP, GPENGU, GSOL
  • Min Edge Threshold: 2.0%
  • Max Concurrent Trades: 2
  • Cooldown Period: 60s

[... bot runs for 2 minutes ...]

================================================================================
🔍 DRY RUN - ARBITRAGE OPPORTUNITY FOUND
================================================================================
Token: GFARTCOIN
Trade Size: 2000
Net Edge: 3.45%

📤 STEP 1: GalaChain (SELL)
  Action: Sell 2000 GFARTCOIN
  Price: 0.003000 GALA per token
  Expected: ~6.00 GALA

📥 STEP 2: Solana (BUY)
  Action: Buy 2000 GFARTCOIN
  Price: 0.000650 SOL per token
  Cost: ~1.3000 SOL

💰 EXPECTED PROFIT:
  Gross Profit: 21.25 GALA
  Bridge Cost: 20.00 GALA
  Net Profit: 1.25 GALA
================================================================================

⏰ 2 minutes elapsed. Stopping bot...

📊 Dry Run Test Results:

  Runtime: 120s
  Cycles Completed: 12
  Opportunities Found: 3
  Opportunities That Would Execute: 3
  Actual Trades Executed: 0 (should be 0 in dry run)

💎 Found 3 arbitrage opportunities!
   Check the output above for detailed execution plans.
   These would be executed if dryRun was set to false.

✅ Dry run test completed successfully!

💡 To enable live trading:
   1. Set "dryRun": false in config/config.json
   2. Ensure wallets are funded
   3. Implement real GalaChain signing
   4. Test with small amounts first!
```

---

## Safety Reminders

✅ Dry run mode is **100% safe** - no transactions are sent  
✅ Keep `dryRun: true` until you're fully ready to trade  
✅ Test with small amounts first in live mode  
✅ Implement real signing before going live  
✅ Monitor closely during first trades  
✅ Start with higher `minEdgeThreshold` to be conservative  

---

**Ready to see what the bot would do? Run the dry run test!**

**Windows:**
```bash
cd sol-bot
run-dry-run.bat
```

**Mac/Linux:**
```bash
cd sol-bot
chmod +x run-dry-run.sh
./run-dry-run.sh
```

