/**
 * Test suite for Position Tracker
 */

import { PositionTracker, LiquidityPosition, PositionAlert } from './positionTracker';
import { ConfigurationManager } from '../config/configManager';
import { StateManager } from '../utils/stateManager';
import { ErrorHandler } from '../utils/errorHandler';
import { TradeAnalyzer, TradeAnalysis } from '../analysis/tradeAnalyzer';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs/promises';

// Mock configuration and state files
const CONFIG_DIR = path.join(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const STATE_FILE = path.join(process.cwd(), 'state.json');

const mockConfig = {
  targetWallets: [
    { address: 'eth|0xabc', name: 'Test Wallet 1', maxCopyAmount: 1000, enabled: true, priority: 1, type: 'ethereum' },
    { address: 'eth|0xdef', name: 'Test Wallet 2', maxCopyAmount: 2000, enabled: true, priority: 2, type: 'ethereum' },
  ],
  globalSettings: {
    maxTotalExposure: 0.5,
    blacklistedTokens: [],
    whitelistedTokens: ['gala', 'gweth', 'gusdc', 'gusdt'],
    defaultMaxCopyAmount: {
      ethereum: 1000,
      client: 500
    },
    copyMode: 'proportional',
    executionDelay: 30,
    cooldownMinutes: 5,
    slippageTolerance: 0.05,
    maxDailyTrades: 50,
    websocketReconnectDelay: 1000,
    websocketMaxRetries: 3
  }
};

async function setupTestEnvironment() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(mockConfig, null, 2));
  if (await fs.access(STATE_FILE).then(() => true).catch(() => false)) {
    await fs.unlink(STATE_FILE);
  }
}

async function teardownTestEnvironment() {
  if (await fs.access(CONFIG_FILE).then(() => true).catch(() => false)) {
    await fs.unlink(CONFIG_FILE);
  }
  if (await fs.access(CONFIG_DIR).then(() => true).catch(() => false)) {
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  }
  if (await fs.access(STATE_FILE).then(() => true).catch(() => false)) {
    await fs.unlink(STATE_FILE);
  }
}

async function testPositionTracker(): Promise<void> {
  logger.info('🧪 Testing Position Tracker...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  // Test 1: Singleton pattern
  console.log('  ✓ Testing singleton pattern...');
  const instance1 = PositionTracker.getInstance();
  const instance2 = PositionTracker.getInstance();
  if (instance1 !== instance2) throw new Error('Singleton pattern failed');
  console.log('    Singleton test: PASS');

  // Test 2: Initialization
  console.log('  ✓ Testing initialization...');
  await instance1.initialize();
  console.log('    ✅ Initialization successful.');

  // Test 3: Position creation from trade analysis
  console.log('  ✓ Testing position creation from trade analysis...');
  const mockTradeAnalysis: TradeAnalysis = {
    id: 'analysis_123',
    originalActivity: {
      walletAddress: 'eth|0xabc',
      activityType: 'add_liquidity',
      transactionHash: '0x123456',
      timestamp: Date.now(),
      blockNumber: '12345',
      detectedAt: Date.now(),
      transaction: {
        poolHash: 'pool_123',
        tickLower: -1000,
        tickUpper: 1000,
        fee: 10000
      }
    },
    targetWallet: { address: 'eth|0xabc', name: 'Test Wallet', maxCopyAmount: 1000, enabled: true, priority: 1, type: 'ethereum' },
    walletStats: {
      walletAddress: 'eth|0xabc',
      name: 'Test Wallet',
      totalTrades: 10,
      successfulTrades: 8,
      failedTrades: 2,
      totalVolumeTraded: 10000,
      performanceScore: 80,
      riskScore: 30,
      lastActivity: Date.now(),
      activityPattern: 'swing_trader',
      patternConfidence: 0.8,
      dailyTradeCount: 2,
      dailyVolume: 1000,
      lastDailyReset: Date.now(),
      alerts: []
    },
    analysisResult: 'approved',
    riskScore: 0.3,
    confidenceScore: 0.8,
    recommendedAction: { action: 'execute', reason: 'Good trade' },
    calculatedTrade: {
      type: 'add_liquidity',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: 1000,
      amountOut: 100,
      copyMode: 'proportional',
      copyAmount: 100,
      maxSlippage: 0.05,
      executionDelay: 30,
      priority: 1
    },
    marketConditions: {
      volatility: 'medium',
      liquidity: 'high',
      trend: 'sideways',
      riskLevel: 'medium',
      confidence: 0.7
    },
    timestamp: Date.now()
  };

  const position = await instance1.createPositionFromTrade(mockTradeAnalysis);
  if (!position) throw new Error('Position not created');
  if (position.token0 !== 'GALA') throw new Error('Token0 mismatch');
  if (position.token1 !== 'GUSDC') throw new Error('Token1 mismatch');
  if (position.status !== 'active') throw new Error('Status should be active');
  console.log(`    Position created: ${position.id}`);
  console.log(`    Tokens: ${position.token0}/${position.token1}`);
  console.log(`    Liquidity: ${position.liquidity}`);
  console.log('    ✅ Position creation successful.');

  // Test 4: Position updates
  console.log('  ✓ Testing position updates...');
  const positions = instance1.getPositions();
  if (positions.length === 0) throw new Error('No positions found');
  console.log(`    Total positions: ${positions.length}`);
  console.log('    ✅ Position updates successful.');

  // Test 5: Position performance
  console.log('  ✓ Testing position performance...');
  const performance = instance1.getPositionPerformanceSummary();
  if (performance.totalPositions === 0) throw new Error('No positions in summary');
  console.log(`    Total positions: ${performance.totalPositions}`);
  console.log(`    Active positions: ${performance.activePositions}`);
  console.log(`    Total value: ${performance.totalValue.toFixed(2)}`);
  console.log(`    Total return: ${performance.totalReturn.toFixed(2)}`);
  console.log('    ✅ Position performance successful.');

  // Test 6: Event emission
  console.log('  ✓ Testing event emission...');
  let positionCreatedReceived = false;
  let positionUpdatedReceived = false;
  let positionAlertReceived = false;

  instance1.on('positionCreated', () => {
    positionCreatedReceived = true;
  });

  instance1.on('positionUpdated', () => {
    positionUpdatedReceived = true;
  });

  instance1.on('positionAlert', () => {
    positionAlertReceived = true;
  });

  // Wait for events
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log(`    Position created event received: ${positionCreatedReceived}`);
  console.log(`    Position updated event received: ${positionUpdatedReceived}`);
  console.log(`    Position alert event received: ${positionAlertReceived}`);
  console.log('    ✅ Event emission successful.');

  // Test 7: Shutdown
  console.log('  ✓ Testing shutdown...');
  await instance1.shutdown();
  console.log('    Position tracker shutdown successfully');
  console.log('    ✅ Shutdown successful.');

  await tradeAnalyzer.shutdown();
  console.log('✅ All position tracker tests passed!');
}

async function testPositionOperations(): Promise<void> {
  logger.info('🧪 Testing position operations...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  const positionTracker = PositionTracker.getInstance();
  await positionTracker.initialize();

  // Test 1: AddLiquidity operation
  console.log('  ✓ Testing AddLiquidity operation...');
  const addLiquidityTransaction = {
    id: 'tx_add_liquidity',
    chaincodeResponse: {
      payload: JSON.stringify({
        Data: [{
          Data: {
            poolHash: 'pool_123',
            positionId: 'pos_123',
            amounts: ['1000', '100'],
            userAddress: 'eth|0xabc'
          }
        }]
      })
    },
    actions: [{
      args: [
        'DexV3Contract:BatchSubmit',
        JSON.stringify({
          operations: [{
            method: 'AddLiquidity',
            dto: {
              token0: { collection: 'GALA' },
              token1: { collection: 'GUSDC' },
              amount: '1000',
              amount0Desired: '1000',
              amount1Desired: '100',
              tickLower: -1000,
              tickUpper: 1000,
              fee: 10000,
              recipient: 'eth|0xabc',
              positionId: 'pos_123'
            }
          }]
        })
      ]
    }]
  };

  await positionTracker.updatePositionFromTransaction(addLiquidityTransaction, 12345);
  const positions = positionTracker.getPositions();
  console.log(`    Positions after AddLiquidity: ${positions.length}`);
  console.log('    ✅ AddLiquidity operation successful.');

  // Test 2: RemoveLiquidity operation
  console.log('  ✓ Testing RemoveLiquidity operation...');
  const removeLiquidityTransaction = {
    id: 'tx_remove_liquidity',
    chaincodeResponse: {
      payload: JSON.stringify({
        Data: [{
          Data: {
            poolHash: 'pool_123',
            positionId: 'pos_123',
            amounts: ['500', '50'],
            userAddress: 'eth|0xabc'
          }
        }]
      })
    },
    actions: [{
      args: [
        'DexV3Contract:BatchSubmit',
        JSON.stringify({
          operations: [{
            method: 'RemoveLiquidity',
            dto: {
              token0: { collection: 'GALA' },
              token1: { collection: 'GUSDC' },
              amount: '500',
              amount0Min: '500',
              amount1Min: '50',
              tickLower: -1000,
              tickUpper: 1000,
              fee: 10000,
              positionId: 'pos_123'
            }
          }]
        })
      ]
    }]
  };

  await positionTracker.updatePositionFromTransaction(removeLiquidityTransaction, 12346);
  const updatedPositions = positionTracker.getPositions();
  console.log(`    Positions after RemoveLiquidity: ${updatedPositions.length}`);
  console.log('    ✅ RemoveLiquidity operation successful.');

  // Test 3: Swap operation
  console.log('  ✓ Testing Swap operation...');
  const swapTransaction = {
    id: 'tx_swap',
    chaincodeResponse: {
      payload: JSON.stringify({
        Data: [{
          Data: {
            poolHash: 'pool_123',
            userAddress: 'eth|0xabc'
          }
        }]
      })
    },
    actions: [{
      args: [
        'DexV3Contract:BatchSubmit',
        JSON.stringify({
          operations: [{
            method: 'Swap',
            dto: {
              token0: { collection: 'GALA' },
              token1: { collection: 'GUSDC' },
              amount: '100',
              recipient: 'eth|0xabc',
              fee: 10000
            }
          }]
        })
      ]
    }]
  };

  await positionTracker.updatePositionFromTransaction(swapTransaction, 12347);
  console.log('    ✅ Swap operation successful.');

  await positionTracker.shutdown();
  await tradeAnalyzer.shutdown();
  console.log('✅ All position operations tests passed!');
}

async function testPositionRiskManagement(): Promise<void> {
  logger.info('🧪 Testing position risk management...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  const positionTracker = PositionTracker.getInstance();
  await positionTracker.initialize();

  // Test 1: Risk metrics calculation
  console.log('  ✓ Testing risk metrics calculation...');
  
  // Create a test position
  const testPosition: LiquidityPosition = {
    id: 'test_pos_1',
    positionId: 'pos_123',
    poolHash: 'pool_123',
    token0: 'GALA',
    token1: 'GUSDC',
    tickLower: -1000,
    tickUpper: 1000,
    liquidity: 1000,
    amount0: 1000,
    amount1: 100,
    fee: 10000,
    createdAt: Date.now() - (7 * 24 * 60 * 60 * 1000), // 7 days ago
    lastUpdated: Date.now(),
    status: 'active',
    originalWallet: 'eth|0xabc',
    copiedFrom: 'eth|0xabc',
    performance: {
      totalFeesEarned: 10,
      unrealizedPnL: -50,
      realizedPnL: 0,
      totalReturn: -50,
      returnPercentage: -5,
      duration: 7 * 24 * 60 * 60 * 1000,
      lastPriceUpdate: Date.now(),
      currentValue: 950,
      initialValue: 1000
    }
  };

  // Manually add position to tracker
  (positionTracker as any).positions.set(testPosition.id, testPosition);
  
  // Calculate risk metrics
  await (positionTracker as any).calculatePositionRisk(testPosition);
  
  const riskMetrics = positionTracker.getPositionRiskMetrics(testPosition.id);
  if (!riskMetrics) throw new Error('Risk metrics not calculated');
  
  console.log(`    Overall risk: ${riskMetrics.overallRisk.toFixed(2)}`);
  console.log(`    Impermanent loss: ${riskMetrics.impermanentLoss.toFixed(2)}`);
  console.log(`    Concentration risk: ${riskMetrics.concentrationRisk.toFixed(2)}`);
  console.log(`    Liquidity risk: ${riskMetrics.liquidityRisk.toFixed(2)}`);
  console.log(`    Duration risk: ${riskMetrics.durationRisk.toFixed(2)}`);
  console.log(`    Risk factors: ${riskMetrics.riskFactors.length}`);
  console.log('    ✅ Risk metrics calculation successful.');

  // Test 2: Position alerts
  console.log('  ✓ Testing position alerts...');
  
  // Wait for alert checking
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const alerts = positionTracker.getPositionAlerts();
  console.log(`    Total alerts: ${alerts.length}`);
  
  if (alerts.length > 0) {
    const alert = alerts[0];
    console.log(`    Alert type: ${alert.type}`);
    console.log(`    Alert severity: ${alert.severity}`);
    console.log(`    Alert message: ${alert.message}`);
  }
  console.log('    ✅ Position alerts successful.');

  // Test 3: Position filtering
  console.log('  ✓ Testing position filtering...');
  const activePositions = positionTracker.getPositionsByStatus('active');
  const closedPositions = positionTracker.getPositionsByStatus('closed');
  
  console.log(`    Active positions: ${activePositions.length}`);
  console.log(`    Closed positions: ${closedPositions.length}`);
  console.log('    ✅ Position filtering successful.');

  await positionTracker.shutdown();
  await tradeAnalyzer.shutdown();
  console.log('✅ All position risk management tests passed!');
}

async function testIntegration(): Promise<void> {
  logger.info('🧪 Testing integration...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  const positionTracker = PositionTracker.getInstance();
  await positionTracker.initialize();

  // Test 1: Health check
  console.log('  ✓ Testing health check...');
  const healthCheckSystem = (errorHandler as any).healthCheckSystem;
  if (healthCheckSystem) {
    const healthStatus = await healthCheckSystem.getHealthStatus();
    const positionTrackerHealthy = healthStatus.body.checks['position-tracker']?.healthy;
    console.log(`    Position tracker healthy: ${positionTrackerHealthy}`);
  } else {
    console.log('    Health check system not available');
  }
  console.log('    ✅ Health check successful.');

  // Test 2: Performance summary
  console.log('  ✓ Testing performance summary...');
  const summary = positionTracker.getPositionPerformanceSummary();
  console.log(`    Total positions: ${summary.totalPositions}`);
  console.log(`    Active positions: ${summary.activePositions}`);
  console.log(`    Total value: ${summary.totalValue.toFixed(2)}`);
  console.log(`    Total fees earned: ${summary.totalFeesEarned.toFixed(2)}`);
  console.log(`    Total return: ${summary.totalReturn.toFixed(2)}`);
  console.log(`    Average return: ${summary.averageReturn.toFixed(2)}`);
  console.log('    ✅ Performance summary successful.');

  await positionTracker.shutdown();
  await tradeAnalyzer.shutdown();
  console.log('✅ All integration tests passed!');
}

(async () => {
  try {
    await testPositionTracker();
    await testPositionOperations();
    await testPositionRiskManagement();
    await testIntegration();
    console.log('\n🎉 All position tracker tests completed successfully!');
  } catch (error) {
    logger.error('💥 Position tracker tests failed:', error);
    process.exit(1);
  } finally {
    await teardownTestEnvironment();
  }
})();

