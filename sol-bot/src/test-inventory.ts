/**
 * Test Script: Inventory Manager
 * Tests balance tracking and inventory management
 */

import { InventoryManager } from './core/inventoryManager';
import { logger } from './utils/logger';
import { config } from './utils/config';

async function testInventoryManager() {
  console.log('\n=== Testing Inventory Manager ===\n');

  try {
    const inventoryManager = new InventoryManager();

    console.log('📦 Updating balances from both chains...');
    console.log('This may take a few seconds...\n');

    await inventoryManager.updateBalances();

    // Get all balances
    const allBalances = inventoryManager.getAllBalances();

    console.log('🔵 GalaChain Balances:');
    Object.entries(allBalances.galaChain).forEach(([token, balance]) => {
      console.log(`  ${token}: ${balance.toFixed(6)}`);
    });

    console.log('\n🟣 Solana Balances:');
    Object.entries(allBalances.solana).forEach(([token, balance]) => {
      console.log(`  ${token}: ${balance.toFixed(6)}`);
    });

    // Get inventory status
    console.log('\n📊 Inventory Status:');
    const status = inventoryManager.getInventoryStatus();
    
    console.log(`  Total Value (GALA): ${status.totalValueGALA.toFixed(2)}`);
    console.log(`  Drift Direction: ${status.driftDirection}`);
    
    if (status.recommendations.length > 0) {
      console.log('\n  📋 Recommendations:');
      status.recommendations.forEach(rec => {
        console.log(`    - ${rec}`);
      });
    } else {
      console.log('\n  ✓ All inventory levels are healthy');
    }

    // Test trade feasibility
    console.log('\n🔍 Testing Trade Feasibility:');
    const tokens = config.getEnabledTokens();
    
    tokens.forEach(token => {
      const gcBalance = inventoryManager.getGCBalance(token.symbol);
      const solBalance = inventoryManager.getSOLBalance('SOL');
      
      console.log(`\n  ${token.symbol}:`);
      console.log(`    GC Balance: ${gcBalance.toFixed(6)}`);
      console.log(`    SOL Balance: ${solBalance.toFixed(6)}`);
      
      // Test with minimum trade size
      const canTrade = inventoryManager.canExecuteTrade(
        token.symbol,
        token.minTradeSize,
        0.1 // Approximate SOL needed
      );
      
      console.log(`    Can execute minimum trade (${token.minTradeSize}): ${canTrade ? '✓ Yes' : '✗ No'}`);
    });

    // Test manual balance updates
    console.log('\n🔧 Testing Manual Balance Updates:');
    const originalGALABalance = inventoryManager.getGCBalance('GALA');
    console.log(`  Original GALA balance: ${originalGALABalance.toFixed(6)}`);
    
    inventoryManager.updateGCBalance('GALA', 100);
    const newGALABalance = inventoryManager.getGCBalance('GALA');
    console.log(`  After adding 100: ${newGALABalance.toFixed(6)}`);
    
    inventoryManager.updateGCBalance('GALA', -100);
    const restoredGALABalance = inventoryManager.getGCBalance('GALA');
    console.log(`  After removing 100: ${restoredGALABalance.toFixed(6)}`);

    console.log('\n✅ Inventory manager test completed!\n');
    return true;

  } catch (error) {
    console.error('❌ Inventory manager test failed:', error);
    logger.error('Inventory manager test failed', { error });
    return false;
  }
}

// Run the test
testInventoryManager()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });

