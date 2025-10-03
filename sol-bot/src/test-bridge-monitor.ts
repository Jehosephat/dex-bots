/**
 * Test Script: Bridge Monitor
 * Tests bridge monitoring and health tracking
 */

import { BridgeMonitor } from './core/bridgeMonitor';
import { logger } from './utils/logger';

async function testBridgeMonitor() {
  console.log('\n=== Testing Bridge Monitor ===\n');

  try {
    const bridgeMonitor = new BridgeMonitor();

    // Give it a moment to load configurations
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('📊 Bridge Configurations Loaded\n');

    // Display bridge configurations
    const tokens = ['GFARTCOIN', 'GTRUMP', 'GSOL', 'GALA', 'GUSDC'];
    console.log('Available Bridge Configurations:');
    
    for (const token of tokens) {
      const config = bridgeMonitor.getBridgeConfiguration(token);
      if (config) {
        console.log(`\n  ${token}:`);
        console.log(`    Can bridge to: ${config.canBridgeTo.join(', ')}`);
        console.log(`    Fee token: ${config.feeToken}`);
        if (config.minAmount) {
          console.log(`    Min amount: ${config.minAmount}`);
        }
      } else {
        console.log(`\n  ${token}: No configuration found`);
      }
    }

    // Check bridge health
    console.log('\n\n🏥 Bridge Health Status\n');
    const health = await bridgeMonitor.getBridgeHealth();
    
    console.log(`  Overall Health: ${health.isHealthy ? '✅ Healthy' : '⚠️  Issues Detected'}`);
    console.log(`  Average Completion Time: ${(health.avgCompletionTime / 1000).toFixed(1)}s`);
    console.log(`  Recent Failure Rate: ${health.recentFailureRate.toFixed(1)}%`);
    console.log(`  Pending Bridges: ${health.pendingCount}`);
    
    if (health.issues.length > 0) {
      console.log(`\n  Issues:`);
      health.issues.forEach(issue => console.log(`    - ${issue}`));
    }

    // Simulate tracking a bridge (for demonstration)
    console.log('\n\n📦 Simulating Bridge Transaction Tracking\n');
    
    const mockHash = '6d44dc30f6adcbd0fd594615d470c947dd6e21204e9127ff78adce1d3985a79f';
    console.log(`  Tracking mock bridge: ${mockHash.substring(0, 16)}...`);
    
    bridgeMonitor.trackBridge(
      mockHash,
      'GALA',
      100,
      'GC',
      'Ethereum'
    );

    // Check pending bridges
    const pending = bridgeMonitor.getPendingBridges();
    console.log(`\n  Pending Bridges: ${pending.length}`);
    
    if (pending.length > 0) {
      pending.forEach(bridge => {
        console.log(`\n    Hash: ${bridge.hash.substring(0, 16)}...`);
        console.log(`    Token: ${bridge.token}`);
        console.log(`    Amount: ${bridge.amount}`);
        console.log(`    From: ${bridge.fromChain} → To: ${bridge.toChain}`);
        console.log(`    Status: ${bridge.statusDescription}`);
        
        if (bridge.estimatedArrivalTime) {
          const eta = new Date(bridge.estimatedArrivalTime);
          console.log(`    ETA: ${eta.toLocaleTimeString()}`);
        }
      });
    }

    // Test checking status of a real bridge transaction (if available)
    console.log('\n\n🔍 Testing Bridge Status Query\n');
    
    const status = await bridgeMonitor.getBridgeStatus(mockHash);
    if (status) {
      console.log(`  Found bridge status:`);
      console.log(`    Status: ${status.statusDescription}`);
      console.log(`    From: ${status.fromChain} → To: ${status.toChain}`);
      console.log(`    Quantity: ${status.quantity}`);
    } else {
      console.log(`  ℹ️  Bridge not found (expected for mock hash)`);
    }

    // Check bridge capabilities
    console.log('\n\n🌉 Bridge Capability Tests\n');
    
    const tests = [
      { token: 'GALA', from: 'GC', to: 'Ethereum' },
      { token: 'GSOL', from: 'GC', to: 'Solana' },
      { token: 'GUSDC', from: 'GC', to: 'Ethereum' }
    ];

    tests.forEach(test => {
      const canBridge = bridgeMonitor.canBridge(test.token, test.from, test.to);
      console.log(`  ${test.token} (${test.from} → ${test.to}): ${canBridge ? '✅ Supported' : '❌ Not supported'}`);
    });

    // Display recent bridge history
    console.log('\n\n📜 Bridge History\n');
    
    const completed = bridgeMonitor.getCompletedBridges(5);
    const failed = bridgeMonitor.getFailedBridges(5);
    
    console.log(`  Completed Bridges: ${completed.length}`);
    console.log(`  Failed Bridges: ${failed.length}`);

    console.log('\n✅ Bridge Monitor test completed!\n');
    
    // Summary
    console.log('📊 Summary:');
    console.log(`  Bridge configurations loaded: ${tokens.filter(t => bridgeMonitor.getBridgeConfiguration(t)).length}/${tokens.length}`);
    console.log(`  Bridge health: ${health.isHealthy ? 'Healthy' : 'Has issues'}`);
    console.log(`  Monitoring ready: ✅`);

    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    logger.error('Bridge monitor test failed', { error });
    return false;
  }
}

// Run the test
testBridgeMonitor()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

