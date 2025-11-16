# Reset State for New Wallets

This guide explains how to safely reset bot state when switching to new wallets.

## Quick Reset

Run the reset script:

```bash
node reset-state.js
```

This will:
- ✅ Backup existing `state.json` and `bridge-state.json` files
- ✅ Reset both files to default empty state
- ✅ Preserve your backups with timestamps

## Options

### Skip Backups (Not Recommended)

```bash
node reset-state.js --no-backup
```

⚠️ **Warning**: This will permanently delete your current state without backup!

### Also Clear Logs

```bash
node reset-state.js --include-logs
```

This will also delete all `.log` files in the `logs/` directory.

## Manual Reset

If you prefer to reset manually:

### 1. Backup Current State (Recommended)

```bash
# Windows PowerShell
Copy-Item state.json state.json.backup.$(Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item bridge-state.json bridge-state.json.backup.$(Get-Date -Format "yyyyMMdd-HHmmss")

# Linux/Mac
cp state.json state.json.backup.$(date +%s)
cp bridge-state.json bridge-state.json.backup.$(date +%s)
```

### 2. Delete State Files

```bash
# Windows PowerShell
Remove-Item state.json
Remove-Item bridge-state.json

# Linux/Mac
rm state.json bridge-state.json
```

The bot will automatically create fresh default state files on next startup.

### 3. Update Environment Variables

Update your `.env` file (or `bot1.env`) with new wallet addresses:

```env
GALACHAIN_WALLET_ADDRESS=<new-gc-address>
SOLANA_WALLET_ADDRESS=<new-sol-address>
GALACHAIN_PRIVATE_KEY=<new-gc-key>
SOLANA_PRIVATE_KEY=<new-sol-key>
```

### 4. Verify Configuration

Check `config/tokens.json` to ensure token settings are correct for your new wallets.

## What Gets Reset

### `state.json`
- ✅ Inventory balances (GalaChain & Solana)
- ✅ Token cooldowns
- ✅ Daily trade counts
- ✅ Recent trades history
- ✅ Pending bridges
- ✅ Last bridge times

### `bridge-state.json`
- ✅ Bridge transaction history
- ✅ Last bridge times per token
- ✅ Daily bridge counts

### What's NOT Reset
- ❌ Configuration files (`config/tokens.json`, `config/strategies.json`)
- ❌ Environment variables (`.env` files)
- ❌ Log files (unless using `--include-logs`)

## Restoring from Backup

If you need to restore a backup:

```bash
# Windows PowerShell
Copy-Item state.json.backup.<timestamp> state.json
Copy-Item bridge-state.json.backup.<timestamp> bridge-state.json

# Linux/Mac
cp state.json.backup.<timestamp> state.json
cp bridge-state.json.backup.<timestamp> bridge-state.json
```

## After Reset

1. **Start the bot** - It will automatically:
   - Create fresh state files if they don't exist
   - Fetch current balances from both chains
   - Initialize with empty cooldowns and trade history

2. **Verify balances** - Check that balances are correct:
   ```bash
   npm run check-balances
   ```

3. **Monitor first trades** - Watch the logs to ensure everything works correctly

## Troubleshooting

### Bot won't start after reset
- Check that `.env` file has correct wallet addresses
- Verify wallet addresses are valid
- Check that private keys match the wallet addresses

### Balances not updating
- Ensure RPC endpoints are working
- Check network connectivity
- Verify wallet addresses in `.env` match the actual wallets

### State file errors
- Delete corrupted state files and restart bot
- Bot will create fresh default state automatically

