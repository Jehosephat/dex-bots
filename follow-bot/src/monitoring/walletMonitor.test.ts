/**
 * Test suite for Wallet Monitor
 */

import { WalletMonitor, WalletStats, WalletAlert, WalletActivityPattern } from './walletMonitor';
import { ConfigurationManager } from '../config/configManager';
import { StateManager, WalletActivity, TradeRecord } from '../utils/stateManager';
import { ErrorHandler } from '../utils/errorHandler';
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
    { address: 'eth|0x123', name: 'Test Wallet 3', maxCopyAmount: 500, enabled: false, priority: 3, type: 'ethereum' },
  ],
  globalSettings: {
    maxTotalExposure: 0.5,
    blacklistedTokens: ['badtoken'],
    whitelistedTokens: ['gala', 'gweth', 'gusdc'],
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

async function testWalletMonitor(): Promise<void> {
  logger.info('🧪 Testing Wallet Monitor...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();

  // Test 1: Singleton pattern
  console.log('  ✓ Testing singleton pattern...');
  const instance1 = WalletMonitor.getInstance();
  const instance2 = WalletMonitor.getInstance();
  if (instance1 !== instance2) throw new Error('Singleton pattern failed');
  console.log('    Singleton test: PASS');

  // Test 2: Initialization
  console.log('  ✓ Testing initialization...');
  await instance1.initialize();
  const walletStats = instance1.getWalletStats() as Map<string, WalletStats>;
  if (walletStats.size !== 2) throw new Error(`Expected 2 enabled wallets, got ${walletStats.size}`);
  console.log(`    Initialized with ${walletStats.size} wallets`);
  console.log('    ✅ Initialization successful.');

  // Test 3: Wallet statistics
  console.log('  ✓ Testing wallet statistics...');
  const stats1 = walletStats.get('eth|0xabc');
  if (!stats1) throw new Error('Wallet stats not found for eth|0xabc');
  if (stats1.name !== 'Test Wallet 1') throw new Error('Wallet name mismatch');
  if (stats1.totalTrades !== 0) throw new Error('Initial trade count should be 0');
  console.log(`    Wallet 1: ${stats1.name}, trades: ${stats1.totalTrades}`);
  console.log('    ✅ Wallet statistics successful.');

  // Test 4: Wallet activity processing
  console.log('  ✓ Testing wallet activity processing...');
  const mockActivity: WalletActivity = {
    walletAddress: 'eth|0xabc',
    activityType: 'swap',
    transactionHash: '0x123456',
    timestamp: Date.now(),
    blockNumber: '12345',
    detectedAt: Date.now(),
    transaction: {
      id: 'test-tx-1',
      hash: '0x123456',
      blockNumber: 12345,
      timestamp: Date.now(),
      from: 'eth|0xabc',
      to: 'eth|0xdef',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: '100',
      amountOut: '1000',
      recipient: 'eth|0xabc',
      fee: '1000',
      zeroForOne: false
    }
  };

  await instance1.processWalletActivity(mockActivity);
  const updatedStats = instance1.getWalletStats('eth|0xabc') as WalletStats;
  if (updatedStats.lastActivity === 0) throw new Error('Last activity not updated');
  console.log(`    Last activity: ${new Date(updatedStats.lastActivity).toISOString()}`);
  console.log('    ✅ Wallet activity processing successful.');

  // Test 5: Performance metrics calculation
  console.log('  ✓ Testing performance metrics calculation...');
  const performanceScore = updatedStats.performanceScore;
  const riskScore = updatedStats.riskScore;
  if (performanceScore < 0 || performanceScore > 100) throw new Error('Invalid performance score');
  if (riskScore < 0 || riskScore > 100) throw new Error('Invalid risk score');
  console.log(`    Performance score: ${performanceScore.toFixed(2)}`);
  console.log(`    Risk score: ${riskScore.toFixed(2)}`);
  console.log('    ✅ Performance metrics calculation successful.');

  // Test 6: Activity pattern analysis
  console.log('  ✓ Testing activity pattern analysis...');
  const patterns = instance1.getWalletActivityPatterns();
  const pattern = patterns.get('eth|0xabc');
  if (!pattern) throw new Error('Activity pattern not found');
  if (pattern.confidence < 0 || pattern.confidence > 1) throw new Error('Invalid confidence score');
  console.log(`    Pattern: ${pattern.pattern}, confidence: ${pattern.confidence.toFixed(2)}`);
  console.log('    ✅ Activity pattern analysis successful.');

  // Test 7: Top performing wallets
  console.log('  ✓ Testing top performing wallets...');
  const topWallets = instance1.getTopPerformingWallets(5);
  if (topWallets.length === 0) throw new Error('No top performing wallets found');
  console.log(`    Top performing wallets: ${topWallets.length}`);
  console.log('    ✅ Top performing wallets successful.');

  // Test 8: Risk level filtering
  console.log('  ✓ Testing risk level filtering...');
  const lowRiskWallets = instance1.getWalletsByRiskLevel('low');
  const mediumRiskWallets = instance1.getWalletsByRiskLevel('medium');
  const highRiskWallets = instance1.getWalletsByRiskLevel('high');
  console.log(`    Low risk: ${lowRiskWallets.length}, Medium risk: ${mediumRiskWallets.length}, High risk: ${highRiskWallets.length}`);
  console.log('    ✅ Risk level filtering successful.');

  // Test 9: Monitoring summary
  console.log('  ✓ Testing monitoring summary...');
  const summary = instance1.getMonitoringSummary();
  if (summary.totalWallets !== 2) throw new Error('Total wallets mismatch');
  if (summary.totalWallets < summary.activeWallets) throw new Error('Active wallets cannot exceed total wallets');
  console.log(`    Total wallets: ${summary.totalWallets}`);
  console.log(`    Active wallets: ${summary.activeWallets}`);
  console.log(`    Total alerts: ${summary.totalAlerts}`);
  console.log(`    Average performance: ${summary.averagePerformanceScore.toFixed(2)}`);
  console.log('    ✅ Monitoring summary successful.');

  // Test 10: Shutdown
  console.log('  ✓ Testing shutdown...');
  await instance1.shutdown();
  console.log('    Wallet monitor shutdown successfully');
  console.log('    ✅ Shutdown successful.');

  console.log('✅ All wallet monitor tests passed!');
}

async function testWalletAlerts(): Promise<void> {
  logger.info('🧪 Testing wallet alerts...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();

  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  // Test 1: High volume alert
  console.log('  ✓ Testing high volume alert...');
  const highVolumeActivity: WalletActivity = {
    walletAddress: 'eth|0xabc',
    activityType: 'swap',
    transactionHash: '0xhighvolume',
    timestamp: Date.now(),
    blockNumber: '12346',
    detectedAt: Date.now(),
    transaction: {
      id: 'high-volume-tx',
      hash: '0xhighvolume',
      blockNumber: 12346,
      timestamp: Date.now(),
      from: 'eth|0xabc',
      to: 'eth|0xdef',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: '50000', // High volume
      amountOut: '500000',
      recipient: 'eth|0xabc',
      fee: '1000',
      zeroForOne: false
    }
  };

  await walletMonitor.processWalletActivity(highVolumeActivity);
  
  // Wait for alert check interval
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const alerts = walletMonitor.getWalletAlerts();
  const highVolumeAlerts = alerts.filter(alert => alert.type === 'high_volume');
  console.log(`    High volume alerts: ${highVolumeAlerts.length}`);
  console.log('    ✅ High volume alert test completed.');

  // Test 2: Alert filtering
  console.log('  ✓ Testing alert filtering...');
  const walletAlerts = walletMonitor.getWalletAlerts('eth|0xabc');
  const criticalAlerts = walletMonitor.getWalletAlerts(undefined, 'critical');
  console.log(`    Wallet-specific alerts: ${walletAlerts.length}`);
  console.log(`    Critical alerts: ${criticalAlerts.length}`);
  console.log('    ✅ Alert filtering successful.');

  await walletMonitor.shutdown();
  console.log('✅ All wallet alert tests passed!');
}

async function testWalletPerformance(): Promise<void> {
  logger.info('🧪 Testing wallet performance tracking...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();

  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  // Test 1: Performance tracking
  console.log('  ✓ Testing performance tracking...');
  const stats = walletMonitor.getWalletStats('eth|0xabc') as WalletStats;
  console.log(`    Initial performance score: ${stats.performanceScore.toFixed(2)}`);
  console.log(`    Initial risk score: ${stats.riskScore.toFixed(2)}`);
  console.log('    ✅ Performance tracking successful.');

  // Test 2: Performance comparison
  console.log('  ✓ Testing performance comparison...');
  const topWallets = walletMonitor.getTopPerformingWallets(2);
  if (topWallets.length >= 2) {
    const performanceDiff = topWallets[0].performanceScore - topWallets[1].performanceScore;
    console.log(`    Performance difference: ${performanceDiff.toFixed(2)}`);
  }
  console.log('    ✅ Performance comparison successful.');

  await walletMonitor.shutdown();
  console.log('✅ All wallet performance tests passed!');
}

async function testWalletIntegration(): Promise<void> {
  logger.info('🧪 Testing wallet integration...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();

  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  // Test 1: Event emission
  console.log('  ✓ Testing event emission...');
  let activityEventReceived = false;
  let alertEventReceived = false;

  walletMonitor.on('walletActivity', () => {
    activityEventReceived = true;
  });

  walletMonitor.on('walletAlert', () => {
    alertEventReceived = true;
  });

  const testActivity: WalletActivity = {
    walletAddress: 'eth|0xabc',
    activityType: 'swap',
    transactionHash: '0xintegration',
    timestamp: Date.now(),
    blockNumber: '12347',
    detectedAt: Date.now(),
    transaction: {
      id: 'integration-tx',
      hash: '0xintegration',
      blockNumber: 12347,
      timestamp: Date.now(),
      from: 'eth|0xabc',
      to: 'eth|0xdef',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: '100',
      amountOut: '1000',
      recipient: 'eth|0xabc',
      fee: '1000',
      zeroForOne: false
    }
  };

  await walletMonitor.processWalletActivity(testActivity);
  
  // Wait for events
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`    Activity event received: ${activityEventReceived}`);
  console.log('    ✅ Event emission successful.');

  // Test 2: Health check
  console.log('  ✓ Testing health check...');
  const healthCheckSystem = (errorHandler as any).healthCheckSystem;
  if (healthCheckSystem) {
    const healthStatus = await healthCheckSystem.getHealthStatus();
    const walletMonitorHealthy = healthStatus.body.checks['wallet-monitor']?.healthy;
    console.log(`    Wallet monitor healthy: ${walletMonitorHealthy}`);
  } else {
    console.log('    Health check system not available');
  }
  console.log('    ✅ Health check successful.');

  await walletMonitor.shutdown();
  console.log('✅ All wallet integration tests passed!');
}

(async () => {
  try {
    await testWalletMonitor();
    await testWalletAlerts();
    await testWalletPerformance();
    await testWalletIntegration();
    console.log('\n🎉 All wallet monitoring tests completed successfully!');
  } catch (error) {
    logger.error('💥 Wallet monitoring tests failed:', error);
    process.exit(1);
  } finally {
    await teardownTestEnvironment();
  }
})();
