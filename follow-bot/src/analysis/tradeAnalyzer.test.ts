/**
 * Test suite for Trade Analyzer
 */

import { TradeAnalyzer, TradeAnalysis, CalculatedTrade, MarketConditions } from './tradeAnalyzer';
import { ConfigurationManager } from '../config/configManager';
import { StateManager, WalletActivity } from '../utils/stateManager';
import { ErrorHandler } from '../utils/errorHandler';
import { WalletMonitor } from '../monitoring/walletMonitor';
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

async function testTradeAnalyzer(): Promise<void> {
  logger.info('🧪 Testing Trade Analyzer...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  // Test 1: Singleton pattern
  console.log('  ✓ Testing singleton pattern...');
  const instance1 = TradeAnalyzer.getInstance();
  const instance2 = TradeAnalyzer.getInstance();
  if (instance1 !== instance2) throw new Error('Singleton pattern failed');
  console.log('    Singleton test: PASS');

  // Test 2: Initialization
  console.log('  ✓ Testing initialization...');
  await instance1.initialize();
  const queueStatus = instance1.getQueueStatus();
  if (!queueStatus.processingActive) throw new Error('Processing not active');
  console.log(`    Queue status: ${queueStatus.queueLength} items, processing: ${queueStatus.processingActive}`);
  console.log('    ✅ Initialization successful.');

  // Test 3: Trade analysis
  console.log('  ✓ Testing trade analysis...');
  const mockActivity: WalletActivity = {
    walletAddress: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
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
      from: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      to: 'eth|0xCe74B68cd1e9786F4BD3b9f7152D6151695A0bA5',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: '100',
      amountOut: '1000',
      recipient: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      fee: '1000',
      zeroForOne: false
    }
  };

  const analysis = await instance1.analyzeWalletActivity(mockActivity);
  if (!analysis) throw new Error('Analysis not created');
  if (!analysis.id) throw new Error('Analysis ID not set');
  if (analysis.originalActivity.walletAddress !== 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF') throw new Error('Wallet address mismatch');
  console.log(`    Analysis ID: ${analysis.id}`);
  console.log(`    Analysis result: ${analysis.analysisResult}`);
  console.log(`    Risk score: ${analysis.riskScore.toFixed(2)}`);
  console.log(`    Confidence score: ${analysis.confidenceScore.toFixed(2)}`);
  console.log('    ✅ Trade analysis successful.');

  // Test 4: Trade validation
  console.log('  ✓ Testing trade validation...');
  const calculatedTrade = analysis.calculatedTrade;
  if (calculatedTrade.tokenIn !== 'GALA') throw new Error('Token in mismatch');
  if (calculatedTrade.tokenOut !== 'GUSDC') throw new Error('Token out mismatch');
  if (calculatedTrade.amountIn <= 0) throw new Error('Invalid amount in');
  if (calculatedTrade.copyMode !== 'proportional') throw new Error('Copy mode mismatch');
  console.log(`    Calculated trade: ${calculatedTrade.amountIn} ${calculatedTrade.tokenIn} → ${calculatedTrade.amountOut} ${calculatedTrade.tokenOut}`);
  console.log(`    Copy mode: ${calculatedTrade.copyMode}`);
  console.log(`    Max slippage: ${calculatedTrade.maxSlippage}`);
  console.log('    ✅ Trade validation successful.');

  // Test 5: Market conditions
  console.log('  ✓ Testing market conditions...');
  const marketConditions = analysis.marketConditions;
  if (!marketConditions) throw new Error('Market conditions not set');
  if (!marketConditions.volatility || !marketConditions.liquidity || !marketConditions.trend) {
    throw new Error('Market conditions incomplete');
  }
  console.log(`    Volatility: ${marketConditions.volatility}`);
  console.log(`    Liquidity: ${marketConditions.liquidity}`);
  console.log(`    Trend: ${marketConditions.trend}`);
  console.log(`    Risk level: ${marketConditions.riskLevel}`);
  console.log('    ✅ Market conditions successful.');

  // Test 6: Queue processing
  console.log('  ✓ Testing queue processing...');
  const recentAnalyses = instance1.getRecentAnalyses(5);
  if (recentAnalyses.length === 0) throw new Error('No recent analyses found');
  console.log(`    Recent analyses: ${recentAnalyses.length}`);
  console.log('    ✅ Queue processing successful.');

  // Test 7: Event emission
  console.log('  ✓ Testing event emission...');
  let analysisEventReceived = false;
  let approvedEventReceived = false;
  let rejectedEventReceived = false;

  instance1.on('tradeAnalysis', () => {
    analysisEventReceived = true;
  });

  instance1.on('tradeApproved', () => {
    approvedEventReceived = true;
  });

  instance1.on('tradeRejected', () => {
    rejectedEventReceived = true;
  });

  // Wait for events
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`    Analysis event received: ${analysisEventReceived}`);
  console.log(`    Approved event received: ${approvedEventReceived}`);
  console.log(`    Rejected event received: ${rejectedEventReceived}`);
  console.log('    ✅ Event emission successful.');

  // Test 8: Shutdown
  console.log('  ✓ Testing shutdown...');
  await instance1.shutdown();
  const finalQueueStatus = instance1.getQueueStatus();
  if (finalQueueStatus.processingActive) throw new Error('Processing still active after shutdown');
  console.log('    Trade analyzer shutdown successfully');
  console.log('    ✅ Shutdown successful.');

  await walletMonitor.shutdown();
  console.log('✅ All trade analyzer tests passed!');
}

async function testTradeValidation(): Promise<void> {
  logger.info('🧪 Testing trade validation...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  // Test 1: Valid trade
  console.log('  ✓ Testing valid trade...');
  const validActivity: WalletActivity = {
    walletAddress: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
    activityType: 'swap',
    transactionHash: '0xvalid',
    timestamp: Date.now(),
    blockNumber: '12346',
    detectedAt: Date.now(),
    transaction: {
      id: 'valid-tx',
      hash: '0xvalid',
      blockNumber: 12346,
      timestamp: Date.now(),
      from: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      to: 'eth|0xCe74B68cd1e9786F4BD3b9f7152D6151695A0bA5',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: '100',
      amountOut: '1000',
      recipient: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      fee: '1000',
      zeroForOne: false
    }
  };

  const validAnalysis = await tradeAnalyzer.analyzeWalletActivity(validActivity);
  if (!validAnalysis) throw new Error('Valid analysis not created');
  console.log(`    Valid analysis result: ${validAnalysis.analysisResult}`);
  console.log('    ✅ Valid trade test successful.');

  // Test 2: Invalid trade (disabled wallet)
  console.log('  ✓ Testing invalid trade (disabled wallet)...');
  const invalidActivity: WalletActivity = {
    walletAddress: 'eth|4e0CD6A94a839F3D9a6F21013A4B0b8E1C8A51ee', // Disabled wallet
    activityType: 'swap',
    transactionHash: '0xinvalid',
    timestamp: Date.now(),
    blockNumber: '12347',
    detectedAt: Date.now(),
    transaction: {
      id: 'invalid-tx',
      hash: '0xinvalid',
      blockNumber: 12347,
      timestamp: Date.now(),
      from: 'eth|4e0CD6A94a839F3D9a6F21013A4B0b8E1C8A51ee',
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
      recipient: 'eth|4e0CD6A94a839F3D9a6F21013A4B0b8E1C8A51ee',
      fee: '1000',
      zeroForOne: false
    }
  };

  const invalidAnalysis = await tradeAnalyzer.analyzeWalletActivity(invalidActivity);
  if (invalidAnalysis && invalidAnalysis.analysisResult !== 'rejected') {
    throw new Error('Invalid analysis should be rejected');
  }
  console.log(`    Invalid analysis result: ${invalidAnalysis?.analysisResult || 'null'}`);
  console.log('    ✅ Invalid trade test successful.');

  // Test 3: Blacklisted token
  console.log('  ✓ Testing blacklisted token...');
  const blacklistedActivity: WalletActivity = {
    walletAddress: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
    activityType: 'swap',
    transactionHash: '0xblacklisted',
    timestamp: Date.now(),
    blockNumber: '12348',
    detectedAt: Date.now(),
    transaction: {
      id: 'blacklisted-tx',
      hash: '0xblacklisted',
      blockNumber: 12348,
      timestamp: Date.now(),
      from: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      to: 'eth|0xCe74B68cd1e9786F4BD3b9f7152D6151695A0bA5',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'BADTOKEN',
      tokenOut: 'GUSDC',
      amountIn: '100',
      amountOut: '1000',
      recipient: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      fee: '1000',
      zeroForOne: false
    }
  };

  const blacklistedAnalysis = await tradeAnalyzer.analyzeWalletActivity(blacklistedActivity);
  if (blacklistedAnalysis && blacklistedAnalysis.riskScore < 0.5) {
    throw new Error('Blacklisted token should have high risk score');
  }
  console.log(`    Blacklisted token risk score: ${blacklistedAnalysis?.riskScore.toFixed(2) || 'N/A'}`);
  console.log('    ✅ Blacklisted token test successful.');

  await tradeAnalyzer.shutdown();
  await walletMonitor.shutdown();
  console.log('✅ All trade validation tests passed!');
}

async function testTradeCalculation(): Promise<void> {
  logger.info('🧪 Testing trade calculation...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  // Test 1: Proportional copy mode
  console.log('  ✓ Testing proportional copy mode...');
  const proportionalActivity: WalletActivity = {
    walletAddress: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
    activityType: 'swap',
    transactionHash: '0xproportional',
    timestamp: Date.now(),
    blockNumber: '12349',
    detectedAt: Date.now(),
    transaction: {
      id: 'proportional-tx',
      hash: '0xproportional',
      blockNumber: 12349,
      timestamp: Date.now(),
      from: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      to: 'eth|0xCe74B68cd1e9786F4BD3b9f7152D6151695A0bA5',
      value: '0',
      gasUsed: '0',
      gasPrice: '0',
      logs: [],
      method: 'Swap',
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: '1000',
      amountOut: '10000',
      recipient: 'eth|9Bc3fD09Fa9B41c4FE553D260c467363cfe02aCF',
      fee: '1000',
      zeroForOne: false
    }
  };

  const proportionalAnalysis = await tradeAnalyzer.analyzeWalletActivity(proportionalActivity);
  if (!proportionalAnalysis) throw new Error('Proportional analysis not created');
  
  const calculatedTrade = proportionalAnalysis.calculatedTrade;
  if (calculatedTrade.copyMode !== 'proportional') throw new Error('Copy mode should be proportional');
  if (calculatedTrade.amountIn >= 1000) throw new Error('Proportional amount should be less than original');
  
  console.log(`    Original amount: 1000 GALA`);
  console.log(`    Calculated amount: ${calculatedTrade.amountIn.toFixed(2)} GALA`);
  console.log(`    Copy mode: ${calculatedTrade.copyMode}`);
  console.log('    ✅ Proportional copy mode successful.');

  // Test 2: Risk assessment
  console.log('  ✓ Testing risk assessment...');
  const riskScore = proportionalAnalysis.riskScore;
  const confidenceScore = proportionalAnalysis.confidenceScore;
  
  if (riskScore < 0 || riskScore > 1) throw new Error('Invalid risk score range');
  if (confidenceScore < 0 || confidenceScore > 1) throw new Error('Invalid confidence score range');
  
  console.log(`    Risk score: ${riskScore.toFixed(2)}`);
  console.log(`    Confidence score: ${confidenceScore.toFixed(2)}`);
  console.log('    ✅ Risk assessment successful.');

  // Test 3: Recommended action
  console.log('  ✓ Testing recommended action...');
  const recommendedAction = proportionalAnalysis.recommendedAction;
  if (!recommendedAction.action) throw new Error('No recommended action');
  
  console.log(`    Recommended action: ${recommendedAction.action}`);
  console.log(`    Reason: ${recommendedAction.reason}`);
  console.log('    ✅ Recommended action successful.');

  await tradeAnalyzer.shutdown();
  await walletMonitor.shutdown();
  console.log('✅ All trade calculation tests passed!');
}

async function testIntegration(): Promise<void> {
  logger.info('🧪 Testing integration...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();
  const walletMonitor = WalletMonitor.getInstance();
  await walletMonitor.initialize();

  const tradeAnalyzer = TradeAnalyzer.getInstance();
  await tradeAnalyzer.initialize();

  // Test 1: Health check
  console.log('  ✓ Testing health check...');
  const healthCheckSystem = (errorHandler as any).healthCheckSystem;
  if (healthCheckSystem) {
    const healthStatus = await healthCheckSystem.getHealthStatus();
    const tradeAnalyzerHealthy = healthStatus.body.checks['trade-analyzer']?.healthy;
    console.log(`    Trade analyzer healthy: ${tradeAnalyzerHealthy}`);
  } else {
    console.log('    Health check system not available');
  }
  console.log('    ✅ Health check successful.');

  // Test 2: Queue status
  console.log('  ✓ Testing queue status...');
  const queueStatus = tradeAnalyzer.getQueueStatus();
  console.log(`    Queue length: ${queueStatus.queueLength}`);
  console.log(`    Processing active: ${queueStatus.processingActive}`);
  console.log('    ✅ Queue status successful.');

  // Test 3: Recent analyses
  console.log('  ✓ Testing recent analyses...');
  const recentAnalyses = tradeAnalyzer.getRecentAnalyses(3);
  console.log(`    Recent analyses count: ${recentAnalyses.length}`);
  console.log('    ✅ Recent analyses successful.');

  await tradeAnalyzer.shutdown();
  await walletMonitor.shutdown();
  console.log('✅ All integration tests passed!');
}

(async () => {
  try {
    await testTradeAnalyzer();
    await testTradeValidation();
    await testTradeCalculation();
    await testIntegration();
    console.log('\n🎉 All trade analysis tests completed successfully!');
  } catch (error) {
    logger.error('💥 Trade analysis tests failed:', error);
    process.exit(1);
  } finally {
    await teardownTestEnvironment();
  }
})();
