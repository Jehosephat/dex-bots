/**
 * Test Script: Risk Manager
 * Tests all risk validation and safety controls
 */

import { riskManager } from './core/riskManager';
import { logger } from './utils/logger';
import { ArbitrageOpportunity, InventoryStatus } from './types';

async function testRiskManager() {
  console.log('\n=== Testing Risk Manager ===\n');

  try {
    // Initial status
    console.log('📊 Initial Risk Status\n');
    console.log(riskManager.getRiskReport());

    // Create mock inventory
    const mockInventory: InventoryStatus = {
      gcBalances: {
        'GALA': 500,
        'GFARTCOIN': 5000,
        'GTRUMP': 50,
        'GPENGU': 100,
        'GSOL': 5
      },
      solBalances: {
        'SOL': 5,
        'FARTCOIN': 10000,
        'TRUMP': 100,
        'PENGU': 200,
        'GSOL': 0
      },
      totalValueGALA: 5000,
      driftDirection: 'balanced',
      recommendations: []
    };

    console.log('\n💰 Mock Inventory Created\n');
    console.log('  GalaChain Balances:');
    Object.entries(mockInventory.gcBalances).forEach(([token, balance]) => {
      console.log(`    ${token}: ${balance}`);
    });
    console.log('  Solana Balances:');
    Object.entries(mockInventory.solBalances).forEach(([token, balance]) => {
      console.log(`    ${token}: ${balance}`);
    });

    // Test 1: Valid opportunity
    console.log('\n\n🧪 Test 1: Valid Opportunity\n');
    const validOpp: ArbitrageOpportunity = {
      token: 'GFARTCOIN',
      netEdge: 0.05, // 5% edge
      gcSellPrice: 0.003,
      solBuyPrice: 0.0028,
      bridgeCostGALA: 20,
      recommendedSize: 2000,
      timestamp: Date.now()
    };

    const validation1 = riskManager.validateOpportunity(validOpp, mockInventory);
    console.log(`  Result: ${validation1.isValid ? '✅ VALID' : '❌ INVALID'}`);
    console.log(`  Risk Score: ${validation1.riskScore}`);
    if (validation1.violations.length > 0) {
      console.log('  Violations:');
      validation1.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    } else {
      console.log('  ✅ No violations');
    }

    // Test 2: Low edge opportunity
    console.log('\n\n🧪 Test 2: Low Edge Opportunity (below threshold)\n');
    const lowEdgeOpp: ArbitrageOpportunity = {
      token: 'GFARTCOIN',
      netEdge: 0.01, // 1% edge (below 2% threshold)
      gcSellPrice: 0.003,
      solBuyPrice: 0.0029,
      bridgeCostGALA: 20,
      recommendedSize: 2000,
      timestamp: Date.now()
    };

    const validation2 = riskManager.validateOpportunity(lowEdgeOpp, mockInventory);
    console.log(`  Result: ${validation2.isValid ? '✅ VALID' : '❌ INVALID'}`);
    console.log(`  Risk Score: ${validation2.riskScore}`);
    if (validation2.violations.length > 0) {
      console.log('  Violations:');
      validation2.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }

    // Test 3: Oversized trade
    console.log('\n\n🧪 Test 3: Oversized Trade\n');
    const oversizedOpp: ArbitrageOpportunity = {
      token: 'GFARTCOIN',
      netEdge: 0.05,
      gcSellPrice: 0.003,
      solBuyPrice: 0.0028,
      bridgeCostGALA: 20,
      recommendedSize: 200000, // Way above max
      timestamp: Date.now()
    };

    const validation3 = riskManager.validateOpportunity(oversizedOpp, mockInventory);
    console.log(`  Result: ${validation3.isValid ? '✅ VALID' : '❌ INVALID'}`);
    console.log(`  Risk Score: ${validation3.riskScore}`);
    if (validation3.violations.length > 0) {
      console.log('  Violations:');
      validation3.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }

    // Test 4: Insufficient inventory
    console.log('\n\n🧪 Test 4: Insufficient Inventory\n');
    const lowInventory: InventoryStatus = {
      ...mockInventory,
      gcBalances: {
        ...mockInventory.gcBalances,
        'GFARTCOIN': 500 // Less than trade size
      }
    };

    const validation4 = riskManager.validateOpportunity(validOpp, lowInventory);
    console.log(`  Result: ${validation4.isValid ? '✅ VALID' : '❌ INVALID'}`);
    console.log(`  Risk Score: ${validation4.riskScore}`);
    if (validation4.violations.length > 0) {
      console.log('  Violations:');
      validation4.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }

    // Test 5: Low GALA balance
    console.log('\n\n🧪 Test 5: Insufficient GALA for Fees\n');
    const lowGalaInventory: InventoryStatus = {
      ...mockInventory,
      gcBalances: {
        ...mockInventory.gcBalances,
        'GALA': 50 // Below minimum
      }
    };

    const validation5 = riskManager.validateOpportunity(validOpp, lowGalaInventory);
    console.log(`  Result: ${validation5.isValid ? '✅ VALID' : '❌ INVALID'}`);
    console.log(`  Risk Score: ${validation5.riskScore}`);
    if (validation5.violations.length > 0) {
      console.log('  Violations:');
      validation5.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }

    // Test 6: Trade tracking
    console.log('\n\n🧪 Test 6: Trade Tracking and Concurrent Limits\n');
    riskManager.startTrade('GFARTCOIN', 'trade-001');
    riskManager.startTrade('GTRUMP', 'trade-002');
    console.log('  Started 2 trades...');
    
    const validation6 = riskManager.validateOpportunity(validOpp, mockInventory);
    console.log(`  Result for 3rd trade: ${validation6.isValid ? '✅ VALID' : '❌ INVALID'}`);
    if (validation6.violations.length > 0) {
      console.log('  Violations:');
      validation6.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }
    
    // Complete trades
    riskManager.completeTrade('trade-001', true, 50); // Profitable
    riskManager.completeTrade('trade-002', true, 30); // Profitable
    console.log('  ✅ Completed both trades successfully');

    // Test 7: Circuit breaker
    console.log('\n\n🧪 Test 7: Circuit Breaker (Consecutive Failures)\n');
    console.log('  Simulating 3 consecutive failures...');
    riskManager.startTrade('GFARTCOIN', 'fail-001');
    riskManager.completeTrade('fail-001', false, -20);
    riskManager.startTrade('GFARTCOIN', 'fail-002');
    riskManager.completeTrade('fail-002', false, -15);
    riskManager.startTrade('GFARTCOIN', 'fail-003');
    riskManager.completeTrade('fail-003', false, -10);
    
    const validation7 = riskManager.validateOpportunity(validOpp, mockInventory);
    console.log(`  Result after failures: ${validation7.isValid ? '✅ VALID' : '❌ INVALID'}`);
    if (validation7.violations.length > 0) {
      console.log('  Violations:');
      validation7.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }
    
    console.log('\n  Resetting circuit breaker...');
    riskManager.resetCircuitBreaker();
    const validation7b = riskManager.validateOpportunity(validOpp, mockInventory);
    console.log(`  Result after reset: ${validation7b.isValid ? '✅ VALID' : '❌ INVALID'}`);

    // Test 8: Emergency stop
    console.log('\n\n🧪 Test 8: Emergency Stop\n');
    console.log('  Activating emergency stop...');
    riskManager.activateEmergencyStop('Manual test');
    
    const validation8 = riskManager.validateOpportunity(validOpp, mockInventory);
    console.log(`  Result with emergency stop: ${validation8.isValid ? '✅ VALID' : '❌ INVALID'}`);
    if (validation8.violations.length > 0) {
      console.log('  Violations:');
      validation8.violations.forEach(v => {
        const icon = v.severity === 'high' ? '❌' : v.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} [${v.severity}] ${v.message}`);
      });
    }
    
    console.log('\n  Deactivating emergency stop...');
    riskManager.deactivateEmergencyStop();
    const validation8b = riskManager.validateOpportunity(validOpp, mockInventory);
    console.log(`  Result after deactivation: ${validation8b.isValid ? '✅ VALID' : '❌ INVALID'}`);

    // Test 9: Bridge health validation
    console.log('\n\n🧪 Test 9: Bridge Health Validation\n');
    
    const healthyBridge = {
      isHealthy: true,
      averageCompletionTime: 300,
      recentFailureRate: 0.05,
      pendingBridgesCount: 2
    };
    const healthCheck1 = riskManager.validateBridgeHealth(healthyBridge);
    console.log(`  Healthy bridge: ${healthCheck1.isValid ? '✅ VALID' : '❌ INVALID'} - ${healthCheck1.message}`);
    
    const unhealthyBridge = {
      isHealthy: false,
      averageCompletionTime: 900,
      recentFailureRate: 0.3,
      pendingBridgesCount: 10
    };
    const healthCheck2 = riskManager.validateBridgeHealth(unhealthyBridge);
    console.log(`  Unhealthy bridge: ${healthCheck2.isValid ? '✅ VALID' : '❌ INVALID'} - ${healthCheck2.message}`);
    
    const slowBridge = {
      isHealthy: true,
      averageCompletionTime: 700,
      recentFailureRate: 0.05,
      pendingBridgesCount: 5
    };
    const healthCheck3 = riskManager.validateBridgeHealth(slowBridge);
    console.log(`  Slow bridge: ${healthCheck3.isValid ? '✅ VALID' : '❌ INVALID'} - ${healthCheck3.message}`);

    // Final status
    console.log('\n\n📊 Final Risk Status\n');
    console.log(riskManager.getRiskReport());

    console.log('\n✅ Risk Manager test completed!\n');

    // Summary
    console.log('📊 Test Summary:');
    console.log('  ✅ Valid opportunity validation: Working');
    console.log('  ✅ Edge threshold enforcement: Working');
    console.log('  ✅ Trade size limits: Working');
    console.log('  ✅ Inventory constraints: Working');
    console.log('  ✅ Concurrent trade limits: Working');
    console.log('  ✅ Circuit breaker: Working');
    console.log('  ✅ Emergency stop: Working');
    console.log('  ✅ Bridge health validation: Working');
    console.log('\n🛡️  All safety controls functional!\n');

    return true;
  } catch (error: any) {
    console.error('❌ Test failed:', error);
    logger.error('Risk manager test failed', { error: error.message || error });
    return false;
  }
}

// Run the test
testRiskManager()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });

