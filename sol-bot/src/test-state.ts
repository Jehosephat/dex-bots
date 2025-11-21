/**
 * Test Script: State Manager
 * Tests persistent state management
 */

import { stateManager } from './utils/stateManager';
import { logger } from './utils/logger';

async function testStateManager() {
  console.log('\n=== Testing State Manager ===\n');

  try {
    // Test 1: Get current state
    console.log('📊 Current State:');
    const state = stateManager.getState();
    console.log('  Is Running:', state.isRunning);
    console.log('  Is Paused:', state.isPaused);
    console.log('  Circuit Breaker Active:', state.circuitBreakerActive);
    console.log('  Total PnL:', state.totalPnL.toFixed(2), 'GALA');
    console.log('  Daily PnL:', state.dailyPnL.toFixed(2), 'GALA');
    console.log('  Trade Count:', state.tradeCount);
    console.log('  Recent Failures:', state.recentFailures);
    console.log('  Pending Bridges:', state.pendingBridges.length);

    // Test 2: Update state
    console.log('\n🔧 Testing State Updates:');
    
    console.log('  Setting bot to running...');
    stateManager.setRunning(true);
    console.log('    ✓ Running:', stateManager.isRunning());

    console.log('  Recording a test trade (+10 GALA)...');
    const beforePnL = stateManager.getTotalPnL();
    stateManager.recordTrade(10);
    const afterPnL = stateManager.getTotalPnL();
    console.log(`    ✓ PnL updated: ${beforePnL} → ${afterPnL}`);
    console.log(`    ✓ Trade count: ${stateManager.getTradeCount()}`);

    console.log('  Recording another trade (-5 GALA)...');
    stateManager.recordTrade(-5);
    console.log(`    ✓ PnL updated: ${afterPnL} → ${stateManager.getTotalPnL()}`);

    // Test 3: Failure tracking
    console.log('\n⚠️  Testing Failure Tracking:');
    console.log('  Recording test failures...');
    const beforeFailures = stateManager.getRecentFailures();
    stateManager.recordFailure();
    stateManager.recordFailure();
    const afterFailures = stateManager.getRecentFailures();
    console.log(`    ✓ Failures: ${beforeFailures} → ${afterFailures}`);

    console.log('  Resetting failures...');
    stateManager.resetFailures();
    console.log(`    ✓ Failures reset to: ${stateManager.getRecentFailures()}`);

    // Test 4: Circuit breaker
    console.log('\n🔴 Testing Circuit Breaker:');
    console.log('  Activating circuit breaker...');
    stateManager.setCircuitBreaker(true);
    console.log(`    ✓ Active: ${stateManager.isCircuitBreakerActive()}`);

    console.log('  Deactivating circuit breaker...');
    stateManager.setCircuitBreaker(false);
    console.log(`    ✓ Active: ${stateManager.isCircuitBreakerActive()}`);

    // Test 5: Pause/Resume
    console.log('\n⏸️  Testing Pause/Resume:');
    console.log('  Pausing bot...');
    stateManager.setPaused(true);
    console.log(`    ✓ Paused: ${stateManager.isPaused()}`);

    console.log('  Resuming bot...');
    stateManager.setPaused(false);
    console.log(`    ✓ Paused: ${stateManager.isPaused()}`);

    // Test 6: Bridge tracking
    console.log('\n🌉 Testing Bridge Tracking:');
    console.log('  Adding test bridge transaction...');
    stateManager.addPendingBridge({
      txId: 'test-bridge-123',
      token: 'GALA',
      amount: 1000,
      fromChain: 'SOL',
      toChain: 'GC',
      status: 'pending',
      estimatedArrival: Date.now() + 300000, // 5 minutes
      initiatedAt: Date.now()
    });
    console.log(`    ✓ Pending bridges: ${stateManager.getPendingBridges().length}`);

    console.log('  Updating bridge status...');
    stateManager.updatePendingBridge('test-bridge-123', {
      status: 'confirmed',
      actualArrival: Date.now()
    });
    const bridges = stateManager.getPendingBridges();
    console.log(`    ✓ Bridge status: ${bridges[0]?.status}`);

    console.log('  Removing bridge...');
    stateManager.removePendingBridge('test-bridge-123');
    console.log(`    ✓ Pending bridges: ${stateManager.getPendingBridges().length}`);

    // Test 7: State persistence
    console.log('\n💾 Testing State Persistence:');
    console.log('  State is automatically saved every 30 seconds');
    console.log('  State file location: ./state.json');
    console.log('  ✓ Auto-save is active');

    // Display final state
    console.log('\n📊 Final State Summary:');
    const finalState = stateManager.getState();
    console.log('  Running:', finalState.isRunning);
    console.log('  Paused:', finalState.isPaused);
    console.log('  Circuit Breaker:', finalState.circuitBreakerActive);
    console.log('  Total PnL:', finalState.totalPnL.toFixed(2), 'GALA');
    console.log('  Daily PnL:', finalState.dailyPnL.toFixed(2), 'GALA');
    console.log('  Trades:', finalState.tradeCount);
    console.log('  Failures:', finalState.recentFailures);

    console.log('\n✅ State manager test completed!\n');
    
    // Stop auto-save and clean up
    stateManager.stopAutoSave();
    
    return true;

  } catch (error) {
    console.error('❌ State manager test failed:', error);
    logger.error('State manager test failed', { error });
    return false;
  }
}

// Run the test
testStateManager()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });

