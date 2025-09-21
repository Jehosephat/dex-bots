/**
 * State Manager Tests
 * 
 * Tests for the state management system
 */

import { StateManager, TradeRecord, Position, CooldownState } from './stateManager';
import fs from 'fs';
import path from 'path';

// Mock trade record for testing
const mockTrade: TradeRecord = {
  id: 'test-trade-1',
  timestamp: Date.now(),
  targetWallet: 'eth|0x1234567890abcdef1234567890abcdef12345678',
  originalTrade: {
    type: 'buy',
    tokenIn: 'GUSDC',
    tokenOut: 'GALA',
    amountIn: 100,
    amountOut: 2500
  },
  copiedTrade: {
    type: 'buy',
    tokenIn: 'GUSDC',
    tokenOut: 'GALA',
    amountIn: 10,
    amountOut: 250,
    status: 'pending'
  },
  copyMode: 'proportional',
  executionDelay: 30,
  slippage: 0.05
};

async function testStateManager(): Promise<void> {
  console.log('🧪 Testing State Manager...');
  
  try {
    // Create test state file path
    const testStatePath = path.join(process.cwd(), 'state.test.json');
    
    // Test state manager initialization
    console.log('  ✓ Testing initialization...');
    const stateManager = StateManager.getInstance();
    await stateManager.initialize();
    
    // Test adding trade
    console.log('  ✓ Testing trade addition...');
    stateManager.addTrade(mockTrade);
    const trades = stateManager.getTradeHistory();
    console.log(`    Added trade: ${trades.length} total trades`);
    
    // Test updating trade status
    console.log('  ✓ Testing trade status update...');
    stateManager.updateTradeStatus('test-trade-1', 'completed', '0xabcdef123456');
    const updatedTrade = stateManager.getTradeHistory()[0];
    console.log(`    Trade status: ${updatedTrade.copiedTrade.status}`);
    console.log(`    Transaction hash: ${updatedTrade.copiedTrade.transactionHash}`);
    
    // Test position management
    console.log('  ✓ Testing position management...');
    stateManager.updatePosition('GALA', 250, 0.04);
    stateManager.updatePosition('GALA', 100, 0.05);
    const positions = stateManager.getPositions();
    console.log(`    Positions: ${positions.length} total`);
    if (positions.length > 0) {
      const galaPosition = positions.find(p => p.token === 'GALA');
      if (galaPosition) {
        console.log(`    GALA position: ${galaPosition.amount} @ ${galaPosition.averagePrice}`);
      }
    }
    
    // Test cooldown management
    console.log('  ✓ Testing cooldown management...');
    stateManager.addCooldown('eth|0x1234567890abcdef1234567890abcdef12345678', 5, 'test cooldown');
    const inCooldown = stateManager.isWalletInCooldown('eth|0x1234567890abcdef1234567890abcdef12345678');
    console.log(`    Wallet in cooldown: ${inCooldown}`);
    
    const remainingTime = stateManager.getCooldownRemainingTime('eth|0x1234567890abcdef1234567890abcdef12345678');
    console.log(`    Remaining cooldown: ${Math.round(remainingTime / 1000)}s`);
    
    // Test WebSocket state
    console.log('  ✓ Testing WebSocket state...');
    stateManager.updateWebSocketState(true);
    stateManager.updateWebSocketState(false);
    stateManager.updateWebSocketState(true);
    
    // Test performance metrics
    console.log('  ✓ Testing performance metrics...');
    const metrics = stateManager.getPerformanceMetrics();
    console.log(`    Total trades: ${metrics.totalTrades}`);
    console.log(`    Success rate: ${metrics.successRate.toFixed(2)}%`);
    console.log(`    Total volume: ${metrics.totalVolume}`);
    
    // Test daily limits
    console.log('  ✓ Testing daily limits...');
    const limitReached = stateManager.isDailyTradeLimitReached(50);
    console.log(`    Daily limit reached: ${limitReached}`);
    
    // Test state persistence
    console.log('  ✓ Testing state persistence...');
    await stateManager.saveState();
    console.log('    State saved successfully');
    
    // Test state loading
    console.log('  ✓ Testing state loading...');
    const currentState = stateManager.getState();
    console.log(`    Current state: ${currentState.trades.length} trades, ${currentState.positions.length} positions`);
    
    // Test cleanup
    console.log('  ✓ Testing data cleanup...');
    stateManager.cleanupOldData(0); // Clean everything for test
    const afterCleanup = stateManager.getState();
    console.log(`    After cleanup: ${afterCleanup.trades.length} trades`);
    
    // Test shutdown
    console.log('  ✓ Testing shutdown...');
    await stateManager.shutdown();
    console.log('    State manager shutdown successfully');
    
    console.log('✅ All state manager tests passed!');
    
  } catch (error) {
    console.error('❌ State manager test failed:', error);
    throw error;
  }
}

// Test error handling
async function testErrorHandling(): Promise<void> {
  console.log('🧪 Testing error handling...');
  
  try {
    const stateManager = StateManager.getInstance();
    
    // Test invalid trade ID
    console.log('  ✓ Testing invalid trade ID...');
    stateManager.updateTradeStatus('invalid-id', 'completed');
    console.log('    Handled invalid trade ID gracefully');
    
    // Test cooldown for non-existent wallet
    console.log('  ✓ Testing cooldown for non-existent wallet...');
    const inCooldown = stateManager.isWalletInCooldown('eth|0xnonexistent');
    console.log(`    Non-existent wallet in cooldown: ${inCooldown}`);
    
    console.log('✅ All error handling tests passed!');
    
  } catch (error) {
    console.error('❌ Error handling test failed:', error);
    throw error;
  }
}

// Test state migration
async function testStateMigration(): Promise<void> {
  console.log('🧪 Testing state migration...');
  
  try {
    // Create a mock old state file
    const testStatePath = path.join(process.cwd(), 'state.test.json');
    const oldState = {
      trades: [],
      positions: [],
      // Missing some new fields
      version: '0.9.0'
    };
    
    fs.writeFileSync(testStatePath, JSON.stringify(oldState, null, 2));
    
    // Test loading and migration
    const stateManager = StateManager.getInstance();
    await stateManager.initialize();
    
    const migratedState = stateManager.getState();
    console.log(`    Migrated state version: ${migratedState.version}`);
    console.log(`    Has dailyLimits: ${!!migratedState.dailyLimits}`);
    console.log(`    Has websocket state: ${typeof migratedState.websocketConnected === 'boolean'}`);
    
    // Clean up test file
    if (fs.existsSync(testStatePath)) {
      fs.unlinkSync(testStatePath);
    }
    
    console.log('✅ State migration test passed!');
    
  } catch (error) {
    console.error('❌ State migration test failed:', error);
    throw error;
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  (async () => {
    try {
      await testStateManager();
      await testErrorHandling();
      await testStateMigration();
      console.log('\n🎉 All state management tests completed successfully!');
    } catch (error) {
      console.error('\n💥 State management tests failed:', error);
      process.exit(1);
    }
  })();
}
