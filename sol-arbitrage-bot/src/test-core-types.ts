/**
 * Core Types Test Script
 * 
 * Tests the core types and state management functionality.
 */

import { StateManager } from './core/stateManager';
import { 
  ArbitrageOpportunity, 
  ExecutionResult, 
  BridgeStatus,
  CooldownInfo 
} from './types/core';
import { 
  calculateNetEdge, 
  calculatePriceImpactBps, 
  calculateSlippageBps,
  formatTokenAmount 
} from './utils/calculations';
import logger from './utils/logger';
import BigNumber from 'bignumber.js';

async function testCoreTypes() {
  try {
    logger.info('🧪 Testing core types and state management...');
    
    // Test state manager
    logger.info('📊 Testing state manager...');
    const stateManager = new StateManager('./test-state.json');
    
    // Test inventory updates
    logger.info('📦 Testing inventory updates...');
    stateManager.updateTokenBalance('galaChain', 'FARTCOIN', {
      symbol: 'FARTCOIN',
      mint: 'FARTCOIN|Unit|none|none',
      rawBalance: new BigNumber('1000000000'),
      balance: new BigNumber('1000'),
      decimals: 6,
      valueUsd: new BigNumber('100'),
      lastUpdated: Date.now()
    });
    
    // Test execution result
    logger.info('📈 Testing execution result...');
    const executionResult: ExecutionResult = {
      id: 'test-exec-1',
      tokenSymbol: 'FARTCOIN',
      tradeSize: 1000,
      success: true,
      actualGalaChainProceeds: new BigNumber('50'),
      actualSolanaCost: new BigNumber('0.1'),
      actualSolanaCostGala: new BigNumber('45'),
      actualNetEdge: new BigNumber('5'),
      actualNetEdgeBps: 1000,
      galaChainSlippageBps: 10,
      solanaSlippageBps: 20,
      totalFees: new BigNumber('1'),
      startTimestamp: Date.now() - 5000,
      endTimestamp: Date.now(),
      durationMs: 5000
    };
    
    stateManager.addExecutionResult(executionResult);
    
    // Test bridge status
    logger.info('🌉 Testing bridge status...');
    const bridgeStatus: BridgeStatus = {
      id: 'test-bridge-1',
      tokenSymbol: 'FARTCOIN',
      amount: new BigNumber('1000'),
      sourceChain: 'solana',
      destinationChain: 'galachain',
      status: 'pending',
      bridgeFee: new BigNumber('1.25'),
      submittedAt: Date.now(),
      retryCount: 0,
      maxRetries: 3
    };
    
    stateManager.addBridgeStatus(bridgeStatus);
    
    // Test cooldown
    logger.info('⏰ Testing cooldown...');
    const cooldown: CooldownInfo = {
      isInCooldown: true,
      cooldownEndsAt: Date.now() + 300000, // 5 minutes
      remainingSeconds: 300,
      reason: 'test cooldown'
    };
    
    stateManager.setTokenCooldown('FARTCOIN', cooldown);
    
    // Test calculations
    logger.info('🧮 Testing calculations...');
    const netEdge = calculateNetEdge(
      new BigNumber('100'),
      new BigNumber('95'),
      new BigNumber('1.25'),
      new BigNumber('5')
    );
    
    const priceImpact = calculatePriceImpactBps(
      new BigNumber('1000'),
      new BigNumber('950'),
      new BigNumber('1')
    );
    
    const slippage = calculateSlippageBps(
      new BigNumber('100'),
      new BigNumber('99')
    );
    
    logger.info('📊 Calculation results:', {
      netEdge: netEdge.toString(),
      priceImpact,
      slippage,
      formattedAmount: formatTokenAmount(new BigNumber('1234.56789'), 4, 'FARTCOIN')
    });
    
    // Test performance metrics
    logger.info('📈 Testing performance metrics...');
    const metrics = stateManager.getPerformanceMetrics();
    logger.info('📊 Performance metrics:', {
      totalTrades: metrics.totalTrades,
      successfulTrades: metrics.successfulTrades,
      winRate: metrics.winRate,
      totalPnlGala: metrics.totalPnlGala.toString()
    });
    
    // Test state persistence
    logger.info('💾 Testing state persistence...');
    stateManager.forceSave();
    
    // Cleanup
    stateManager.destroy();
    
    logger.info('✅ Core types test completed successfully!');
    return true;
    
  } catch (error) {
    logger.error('❌ Core types test failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testCoreTypes().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { testCoreTypes };
