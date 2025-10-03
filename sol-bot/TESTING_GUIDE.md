# SOL BOT - Testing Guide

This guide covers all the tests you can run at the current implementation stage.

## ✅ Prerequisites

Before running tests, ensure you have:

1. ✅ **Installed dependencies**: `npm install`
2. ✅ **Created `.env` file** with your credentials
3. ✅ **Updated token mint addresses** in `config/tokens.json`
4. ✅ **Configured Slack webhook** in `.env`

## 🧪 Available Tests

### 1. Configuration Test

**What it tests:**
- Configuration files load correctly
- Environment variables are set
- Token configurations are valid
- Dynamic configuration updates work

**How to run:**
```bash
npm run build
node dist/test-config.js
```

**Expected output:**
- ✓ All configuration values displayed
- ✓ Environment variables confirmed
- ✓ Token details (including FARTCOIN and TRUMP mint addresses)
- ✓ Dynamic config update demonstration

**What to check:**
- All required environment variables show "✓ Set"
- Token mint addresses are correct
- FARTCOIN: `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump`
- TRUMP: `6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN`

---

### 2. Price Discovery Test

**What it tests:**
- Fetching prices from GalaChain (via GSwap SDK)
- Fetching prices from Solana (via Jupiter API)
- Cross-chain price comparison
- Opportunity identification
- Net edge calculation

**How to run:**
```bash
npm run build
node dist/test-price-discovery.js
```

**Expected output:**
- GalaChain prices for available tokens
- Solana prices for tokens with valid mint addresses
- List of arbitrage opportunities (if edge > 2%)
- Price comparison analysis

**What to check:**
- ✓ GalaChain prices appear (confirms GSwap SDK working)
- ✓ Solana prices appear (confirms Jupiter API working)
- ✓ Opportunities are calculated (if prices differ)
- ✓ Net edge percentages make sense

**Note:** This test makes real API calls and may take 10-30 seconds.

**Possible issues:**
- If GalaChain prices fail: Check `GALA_PRIVATE_KEY` and `GALA_WALLET_ADDRESS`
- If Solana prices fail: Check `SOLANA_RPC_ENDPOINT` and mint addresses
- If no opportunities: Price difference < 2% (this is normal)

---

### 3. Inventory Manager Test

**What it tests:**
- Balance tracking on both chains
- Inventory status reporting
- Trade feasibility checks
- Manual balance updates
- Drift direction calculation

**How to run:**
```bash
npm run build
node dist/test-inventory.js
```

**Expected output:**
- Current balances on GalaChain and Solana
- Inventory status and recommendations
- Trade feasibility for each token
- Manual balance update demonstration

**What to check:**
- ✓ Balances are displayed (currently using placeholders)
- ✓ Inventory status calculated
- ✓ Trade feasibility checks work
- ✓ Manual updates function correctly

**Note:** Currently uses placeholder values since actual balance fetching requires additional API integration.

---

### 4. State Manager Test

**What it tests:**
- Persistent state storage
- PnL tracking
- Trade counting
- Failure tracking
- Circuit breaker functionality
- Pause/resume operations
- Bridge transaction tracking

**How to run:**
```bash
npm run build
node dist/test-state.js
```

**Expected output:**
- Current state display
- State update demonstrations
- PnL tracking
- Failure and bridge tracking
- State file creation (`state.json`)

**What to check:**
- ✓ State updates work correctly
- ✓ PnL calculations accurate
- ✓ `state.json` file created in project root
- ✓ Auto-save functionality working

---

## 🎯 Quick Test All

Run all tests in sequence:

```bash
npm run build

echo "=== Test 1: Configuration ==="
node dist/test-config.js

echo "\n=== Test 2: Price Discovery ==="
node dist/test-price-discovery.js

echo "\n=== Test 3: Inventory Manager ==="
node dist/test-inventory.js

echo "\n=== Test 4: State Manager ==="
node dist/test-state.js
```

Or use PowerShell:
```powershell
npm run build

Write-Host "`n=== Test 1: Configuration ===" -ForegroundColor Cyan
node dist/test-config.js

Write-Host "`n=== Test 2: Price Discovery ===" -ForegroundColor Cyan
node dist/test-price-discovery.js

Write-Host "`n=== Test 3: Inventory Manager ===" -ForegroundColor Cyan
node dist/test-inventory.js

Write-Host "`n=== Test 4: State Manager ===" -ForegroundColor Cyan
node dist/test-state.js
```

---

## 📊 Understanding Test Results

### Configuration Test Results

**Success indicators:**
- All environment variables show "✓ Set"
- Token configurations display correctly
- Risk parameters are reasonable (2% edge, 3% impact, etc.)
- Dynamic updates work without errors

**Red flags:**
- Missing environment variables
- Invalid token configurations
- Error loading config files

### Price Discovery Test Results

**Success indicators:**
- Prices fetched from at least one chain
- Price values are reasonable (not 0 or extreme)
- Opportunities identified (or explained why not)
- No API errors

**Red flags:**
- All prices fail to fetch
- API authentication errors
- RPC endpoint errors
- Extreme price values

**Understanding opportunities:**
```
Net Edge: 3.5%               ← Must be > 2% to show up
GC Sell Price: 0.045 GALA    ← What you'd get selling on GalaChain
SOL Buy Price: 0.042 SOL     ← What you'd pay buying on Solana
Bridge Cost: 31.25 GALA      ← Cost to bridge tokens back
```

If edge is negative or < 2%, no opportunity will be listed.

### Inventory Manager Test Results

**Success indicators:**
- Balances displayed for both chains
- Trade feasibility calculated
- Inventory drift direction determined
- Manual updates work

**Note:** Since actual balance APIs aren't fully integrated yet, you'll see placeholder values (1000 GALA, 5 SOL, etc.). This is expected.

### State Manager Test Results

**Success indicators:**
- State updates reflected immediately
- `state.json` file created
- PnL calculations correct
- No file write errors

**Check the state.json file:**
```json
{
  "isRunning": true,
  "isPaused": false,
  "totalPnL": 5.00,
  "tradeCount": 2,
  ...
}
```

---

## 🔍 Debugging Failed Tests

### Check Logs

All tests write to logs:
```bash
# View most recent logs
cat logs/combined.log | tail -50

# View errors only
cat logs/error.log | tail -20
```

Windows PowerShell:
```powershell
Get-Content logs/combined.log | Select-Object -Last 50
Get-Content logs/error.log | Select-Object -Last 20
```

### Common Issues

**1. "Cannot find module" errors**
- Solution: Run `npm run build` first

**2. "Missing required environment variables"**
- Solution: Check your `.env` file
- Verify all required variables are set
- Check for typos in variable names

**3. "Failed to fetch GalaChain price"**
- Check `GALA_PRIVATE_KEY` is correct
- Check `GALA_WALLET_ADDRESS` format (should be `eth|...`)
- Verify wallet has GALA balance
- Check RPC endpoint is accessible

**4. "Failed to fetch Solana price"**
- Check token mint addresses are correct
- Verify `SOLANA_RPC_ENDPOINT` is accessible
- Some tokens may not have liquidity on Jupiter

**5. "Configuration file not found"**
- Ensure you're running from the `sol-bot` directory
- Check `config/config.json` and `config/tokens.json` exist

---

## 🎓 What Each Test Validates

| Test | Validates | Ready for Production? |
|------|-----------|----------------------|
| Configuration | Config loading, env vars | ✅ Yes |
| Price Discovery | API integration, price fetching | 🟡 Partial* |
| Inventory Manager | Balance tracking logic | 🔴 No** |
| State Manager | State persistence | ✅ Yes |

\* Price Discovery works but needs real testing with live data  
\** Inventory Manager uses placeholders, needs actual API integration

---

## 📝 Test Output Files

After running tests, you'll have:

```
sol-bot/
├── state.json              ← State from state manager test
├── logs/
│   ├── combined.log        ← All log output
│   ├── error.log          ← Errors only
│   └── trades.log         ← Trade-specific logs
```

You can safely delete `state.json` after testing or let the bot use it when running.

---

## 🚀 Next Steps After Testing

Once all tests pass:

1. **Verify Price Discovery** - Check that prices look reasonable
2. **Monitor Logs** - Look for any warnings or errors
3. **Check Network Connectivity** - Both GalaChain and Solana RPCs working
4. **Validate Wallet Setup** - Ensure private keys grant proper access

**Not ready yet:**
- ❌ Actual trade execution (execution engine not implemented)
- ❌ Bridge transactions (bridge integration not implemented)
- ❌ Risk controls (risk manager not implemented)
- ❌ Monitoring/alerts (monitoring system not implemented)

**Can test now:**
- ✅ Configuration management
- ✅ Price fetching from both chains
- ✅ Opportunity identification
- ✅ State persistence
- ✅ Logging system

---

## 💡 Tips

1. **Start with Configuration Test** - If this fails, others will too
2. **Price Discovery takes time** - Be patient, it makes multiple API calls
3. **Check logs frequently** - Especially if tests fail
4. **Test incrementally** - Run one test at a time initially
5. **Save successful output** - Helps compare future test runs

---

## 🆘 Getting Help

If tests fail consistently:

1. Check the logs in `logs/` directory
2. Verify `.env` configuration
3. Test RPC endpoints manually:
   - GalaChain: Try accessing the RPC URL
   - Solana: Try https://api.mainnet-beta.solana.com
4. Verify wallet addresses are correct format
5. Check token mint addresses against official sources

---

**Ready to test? Start with:**
```bash
npm run build
node dist/test-config.js
```

Good luck! 🚀

