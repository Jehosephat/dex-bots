/**
 * Test Script: Live Balance Fetching
 * Tests real balance fetching from GalaChain and Solana
 */

import { InventoryManager } from './core/inventoryManager';
import { logger } from './utils/logger';
import { config } from './utils/config';

async function testBalances() {
  console.log('\n=== Testing Live Balance Fetching ===\n');
  console.log('ℹ️  Note: Using free public Solana RPC with 300ms delays between requests');
  console.log('   to stay within rate limits (~100 req/10s).\n');

  try {
    const inventoryManager = new InventoryManager();
    
    console.log('📊 Configuration:');
    console.log(`  GalaChain Wallet: ${config.getGalaWalletAddress()}`);
    console.log(`  Solana RPC: ${config.getSolanaRpcEndpoint()}`);
    console.log(`  Enabled Tokens: ${config.getEnabledTokens().map(t => t.symbol).join(', ')}\n`);

    console.log('🔄 Fetching balances from both chains...\n');
    
    await inventoryManager.updateBalances();
    
    const inventory = inventoryManager.getInventoryStatus();
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('              LIVE BALANCE REPORT                      ');
    console.log('═══════════════════════════════════════════════════════\n');
    
    console.log('🌟 GalaChain Balances:');
    console.log('───────────────────────────────────────────────────────');
    const gcTokens = Object.entries(inventory.gcBalances);
    if (gcTokens.length > 0) {
      gcTokens.forEach(([token, balance]) => {
        console.log(`  ${token.padEnd(12)} ${parseFloat(balance as any).toFixed(4).padStart(12)}`);
      });
    } else {
      console.log('  (No balances found)');
    }
    
    console.log('\n🔷 Solana Balances:');
    console.log('───────────────────────────────────────────────────────');
    const solTokens = Object.entries(inventory.solBalances);
    if (solTokens.length > 0) {
      solTokens.forEach(([token, balance]) => {
        console.log(`  ${token.padEnd(12)} ${parseFloat(balance as any).toFixed(4).padStart(12)}`);
      });
    } else {
      console.log('  (No balances found)');
    }
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('\n📈 Summary:');
    console.log(`  Total Value: ${inventory.totalValueGALA.toFixed(2)} GALA`);
    console.log(`  Drift: ${inventory.driftDirection}`);
    
    if (inventory.recommendations.length > 0) {
      console.log('\n⚠️  Recommendations:');
      inventory.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }
    
    console.log('\n✅ Balance fetching test completed!\n');

  } catch (error: any) {
    logger.error('Error during balance test', { error: error.message || error });
    console.log('\n❌ Balance fetching test failed!');
    console.error(error);
    process.exit(1);
  }
}

testBalances();

