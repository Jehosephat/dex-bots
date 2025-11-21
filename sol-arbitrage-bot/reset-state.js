#!/usr/bin/env node
/**
 * Reset State Script
 * 
 * Safely resets bot state files for new wallets.
 * Creates backups before resetting.
 * 
 * Usage:
 *   node reset-state.js [--no-backup] [--include-logs]
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');
const BRIDGE_STATE_FILE = path.join(__dirname, 'bridge-state.json');
const LOGS_DIR = path.join(__dirname, 'logs');

// Default state structure
const DEFAULT_STATE = {
  inventory: {
    galaChain: {
      tokens: {},
      native: "0",
      totalValueUsd: "0",
      lastUpdated: Date.now()
    },
    solana: {
      tokens: {},
      native: "0",
      totalValueUsd: "0",
      lastUpdated: Date.now()
    },
    lastUpdated: Date.now(),
    version: 1
  },
  pendingBridges: [],
  recentTrades: [],
  tokenCooldowns: {},
  dailyTradeCounts: {},
  lastBridgeTimes: {},
  status: "stopped",
  lastHeartbeat: Date.now(),
  version: 1,
  lastSaved: Date.now()
};

const DEFAULT_BRIDGE_STATE = {
  bridges: [],
  lastBridgeTime: {},
  dailyBridgeCount: {},
  lastResetDate: new Date().toISOString().split('T')[0]
};

function backupFile(filePath, createBackup = true) {
  if (!fs.existsSync(filePath)) {
    console.log(`   ⏭️  ${path.basename(filePath)} doesn't exist, skipping backup`);
    return null;
  }

  if (!createBackup) {
    console.log(`   ⏭️  Skipping backup for ${path.basename(filePath)} (--no-backup flag)`);
    return null;
  }

  const timestamp = Date.now();
  const backupPath = `${filePath}.backup.${timestamp}`;
  
  try {
    fs.copyFileSync(filePath, backupPath);
    console.log(`   ✅ Backed up ${path.basename(filePath)} → ${path.basename(backupPath)}`);
    return backupPath;
  } catch (error) {
    console.error(`   ❌ Failed to backup ${path.basename(filePath)}:`, error.message);
    return null;
  }
}

function resetStateFile(filePath, defaultContent, createBackup = true) {
  console.log(`\n📄 Processing ${path.basename(filePath)}...`);
  
  // Backup existing file
  backupFile(filePath, createBackup);
  
  // Write new default state
  try {
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2), 'utf8');
    console.log(`   ✅ Reset ${path.basename(filePath)} to default state`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to reset ${path.basename(filePath)}:`, error.message);
    return false;
  }
}

function clearLogs() {
  if (!fs.existsSync(LOGS_DIR)) {
    console.log(`\n📁 Logs directory doesn't exist, skipping`);
    return;
  }

  console.log(`\n📁 Clearing logs directory...`);
  try {
    const files = fs.readdirSync(LOGS_DIR);
    let cleared = 0;
    
    files.forEach(file => {
      const filePath = path.join(LOGS_DIR, file);
      try {
        if (fs.statSync(filePath).isFile() && file.endsWith('.log')) {
          fs.unlinkSync(filePath);
          cleared++;
        }
      } catch (error) {
        console.log(`   ⚠️  Could not delete ${file}: ${error.message}`);
      }
    });
    
    console.log(`   ✅ Cleared ${cleared} log file(s)`);
  } catch (error) {
    console.error(`   ❌ Failed to clear logs:`, error.message);
  }
}

function main() {
  const args = process.argv.slice(2);
  const noBackup = args.includes('--no-backup');
  const includeLogs = args.includes('--include-logs');

  console.log('🔄 Bot State Reset Script');
  console.log('═══════════════════════════════════════════');
  
  if (noBackup) {
    console.log('⚠️  WARNING: Running without backups!');
  } else {
    console.log('📦 Backups will be created before reset');
  }
  
  if (includeLogs) {
    console.log('📁 Logs will be cleared');
  }

  // Confirm before proceeding
  if (!noBackup) {
    console.log('\n💡 Tip: Backups are saved with .backup.<timestamp> extension');
  }
  console.log('\nStarting reset...\n');

  let success = true;

  // Reset main state file
  success = resetStateFile(STATE_FILE, DEFAULT_STATE, !noBackup) && success;

  // Reset bridge state file
  success = resetStateFile(BRIDGE_STATE_FILE, DEFAULT_BRIDGE_STATE, !noBackup) && success;

  // Clear logs if requested
  if (includeLogs) {
    clearLogs();
  }

  console.log('\n═══════════════════════════════════════════');
  if (success) {
    console.log('✅ State reset complete!');
    console.log('\n📋 Next steps:');
    console.log('   1. Update your .env file with new wallet addresses');
    console.log('   2. Verify your config/tokens.json settings');
    console.log('   3. Start the bot - it will refresh balances automatically');
    if (!noBackup) {
      console.log('\n💾 Backups are available if you need to restore anything');
    }
  } else {
    console.log('❌ Reset completed with errors. Check the output above.');
    process.exit(1);
  }
}

main();

