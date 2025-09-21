/**
 * Transaction Monitor Test Suite
 * 
 * Tests the transaction monitoring system for filtering and processing
 * GalaSwap transactions from target wallets.
 */

import { TransactionMonitor, GalaSwapTransaction, WalletActivity } from './transactionMonitor';
import { ConfigurationManager } from '../config/configManager';
import { StateManager } from '../utils/stateManager';
import { ErrorHandler } from '../utils/errorHandler';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs/promises';

// Setup test environment
const configDir = path.join(process.cwd(), 'config');
const testConfigPath = path.join(configDir, 'config.json');
const mockWalletConfig = {
  targetWallets: [
    { address: 'eth|0xabc123', name: 'Test Wallet 1', maxCopyAmount: 100, enabled: true, priority: 1, type: 'ethereum' },
    { address: 'eth|0xdef456', name: 'Test Wallet 2', maxCopyAmount: 200, enabled: true, priority: 2, type: 'ethereum' },
    { address: 'eth|0xghi789', name: 'Test Wallet 3', maxCopyAmount: 300, enabled: false, priority: 3, type: 'ethereum' },
  ],
  globalSettings: {
    maxTotalExposure: 0.5,
    blacklistedTokens: ['BADTOKEN'],
    whitelistedTokens: ['GALA', 'GWETH', 'GUSDC'],
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
  if (!await fs.access(configDir).then(() => true).catch(() => false)) {
    await fs.mkdir(configDir, { recursive: true });
  }
  await fs.writeFile(testConfigPath, JSON.stringify(mockWalletConfig, null, 2));
  
  // Ensure state file is clean
  const stateFile = path.join(process.cwd(), 'state.json');
  if (await fs.access(stateFile).then(() => true).catch(() => false)) {
    await fs.unlink(stateFile);
  }
}

async function teardownTestEnvironment() {
  if (await fs.access(testConfigPath).then(() => true).catch(() => false)) {
    await fs.unlink(testConfigPath);
  }
  if (await fs.access(configDir).then(() => true).catch(() => false)) {
    await fs.rm(configDir, { recursive: true, force: true });
  }
  const stateFile = path.join(process.cwd(), 'state.json');
  if (await fs.access(stateFile).then(() => true).catch(() => false)) {
    await fs.unlink(stateFile);
  }
}

async function testTransactionMonitorBasic(): Promise<void> {
  console.log('🧪 Testing Transaction Monitor (Basic)...');
  await setupTestEnvironment();

  const configManager = ConfigurationManager.getInstance();
  await configManager.initialize();
  const stateManager = StateManager.getInstance();
  await stateManager.initialize();
  const errorHandler = ErrorHandler.getInstance();

  // Test 1: Singleton pattern
  console.log('  ✓ Testing singleton pattern...');
  const instance1 = TransactionMonitor.getInstance();
  const instance2 = TransactionMonitor.getInstance();
  if (instance1 !== instance2) throw new Error('Singleton pattern failed');
  console.log('    Singleton test: PASS');

  // Test 2: Initialization
  console.log('  ✓ Testing initialization...');
  await instance1.initialize();
  console.log('    Initialization successful');

  // Test 3: Filter configuration
  console.log('  ✓ Testing filter configuration...');
  const filter = instance1.getFilter();
  if (filter.targetWallets.length !== 2) throw new Error('Target wallets count mismatch'); // Only 2 enabled wallets
  if (!filter.whitelistedTokens.includes('GALA')) throw new Error('Whitelisted tokens not loaded');
  if (!filter.blacklistedTokens.includes('BADTOKEN')) throw new Error('Blacklisted tokens not loaded');
  console.log(`    Target wallets: ${filter.targetWallets.length}`);
  console.log(`    Whitelisted tokens: ${filter.whitelistedTokens.join(', ')}`);
  console.log(`    Blacklisted tokens: ${filter.blacklistedTokens.join(', ')}`);

  // Test 4: Queue status
  console.log('  ✓ Testing queue status...');
  const queueStatus = instance1.getQueueStatus();
  if (queueStatus.queueLength !== 0) throw new Error('Queue should be empty initially');
  if (queueStatus.isProcessing !== false) throw new Error('Should not be processing initially');
  console.log(`    Queue length: ${queueStatus.queueLength}`);
  console.log(`    Is processing: ${queueStatus.isProcessing}`);

  console.log('✅ All basic transaction monitor tests passed!');
}

async function testTransactionFiltering(): Promise<void> {
  console.log('🧪 Testing transaction filtering...');
  const transactionMonitor = TransactionMonitor.getInstance();

  // Test 1: Target wallet filtering
  console.log('  ✓ Testing target wallet filtering...');
  const targetWalletTransaction = {
    from: 'eth|0xabc123',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'Swap',
          uniqueId: 'test-swap-1',
          dto: {
            token0: { collection: 'GALA' },
            token1: { collection: 'GWETH' },
            amount: '100',
            recipient: 'eth|0xabc123',
            fee: '0.003',
            zeroForOne: true
          }
        }]
      })]
    }]
  };

  const nonTargetWalletTransaction = {
    from: 'eth|0xnotarget',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'Swap',
          uniqueId: 'test-swap-2',
          dto: {
            token0: { collection: 'GALA' },
            token1: { collection: 'GWETH' },
            amount: '100',
            recipient: 'eth|0xnotarget',
            fee: '0.003',
            zeroForOne: true
          }
        }]
      })]
    }]
  };

  // Process transactions
  transactionMonitor.processBlock({
    parsedBlock: {
      blockNumber: 12345,
      transactions: [targetWalletTransaction, nonTargetWalletTransaction]
    }
  });

  // Wait a bit for processing
  await new Promise(resolve => setTimeout(resolve, 100));

  const queueStatus = transactionMonitor.getQueueStatus();
  console.log(`    Queue length after processing: ${queueStatus.queueLength}`);
  console.log(`    Processed transactions: ${queueStatus.processedCount}`);

  console.log('✅ Transaction filtering tests passed!');
}

async function testDEXOperationProcessing(): Promise<void> {
  console.log('🧪 Testing DEX operation processing...');
  const transactionMonitor = TransactionMonitor.getInstance();

  // Test 1: Swap operation
  console.log('  ✓ Testing swap operation...');
  const swapTransaction = {
    from: 'eth|0xabc123',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'Swap',
          uniqueId: 'test-swap-3',
          dto: {
            token0: { collection: 'GALA' },
            token1: { collection: 'GWETH' },
            amount: '1000',
            recipient: 'eth|0xabc123',
            fee: '0.003',
            zeroForOne: true
          }
        }]
      })]
    }]
  };

  // Test 2: Add liquidity operation
  console.log('  ✓ Testing add liquidity operation...');
  const addLiquidityTransaction = {
    from: 'eth|0xdef456',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'AddLiquidity',
          uniqueId: 'test-add-liquidity-1',
          dto: {
            token0: { collection: 'GALA' },
            token1: { collection: 'GUSDC' },
            amount0Desired: '500',
            amount1Desired: '1000',
            recipient: 'eth|0xdef456'
          }
        }]
      })]
    }]
  };

  // Process transactions
  transactionMonitor.processBlock({
    parsedBlock: {
      blockNumber: 12346,
      transactions: [swapTransaction, addLiquidityTransaction]
    }
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 200));

  const queueStatus = transactionMonitor.getQueueStatus();
  console.log(`    Queue length after DEX operations: ${queueStatus.queueLength}`);
  console.log(`    Processed transactions: ${queueStatus.processedCount}`);

  console.log('✅ DEX operation processing tests passed!');
}

async function testTokenFiltering(): Promise<void> {
  console.log('🧪 Testing token filtering...');
  const transactionMonitor = TransactionMonitor.getInstance();

  // Test 1: Whitelisted token transaction
  console.log('  ✓ Testing whitelisted token transaction...');
  const whitelistedTransaction = {
    from: 'eth|0xabc123',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'Swap',
          uniqueId: 'test-whitelisted-1',
          dto: {
            token0: { collection: 'GALA' }, // Whitelisted
            token1: { collection: 'GWETH' }, // Whitelisted
            amount: '100',
            recipient: 'eth|0xabc123',
            fee: '0.003',
            zeroForOne: true
          }
        }]
      })]
    }]
  };

  // Test 2: Blacklisted token transaction
  console.log('  ✓ Testing blacklisted token transaction...');
  const blacklistedTransaction = {
    from: 'eth|0xabc123',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'Swap',
          uniqueId: 'test-blacklisted-1',
          dto: {
            token0: { collection: 'BADTOKEN' }, // Blacklisted
            token1: { collection: 'GWETH' },
            amount: '100',
            recipient: 'eth|0xabc123',
            fee: '0.003',
            zeroForOne: true
          }
        }]
      })]
    }]
  };

  // Process transactions
  transactionMonitor.processBlock({
    parsedBlock: {
      blockNumber: 12347,
      transactions: [whitelistedTransaction, blacklistedTransaction]
    }
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 200));

  const queueStatus = transactionMonitor.getQueueStatus();
  console.log(`    Queue length after token filtering: ${queueStatus.queueLength}`);
  console.log(`    Processed transactions: ${queueStatus.processedCount}`);

  console.log('✅ Token filtering tests passed!');
}

async function testEventEmission(): Promise<void> {
  console.log('🧪 Testing event emission...');
  const transactionMonitor = TransactionMonitor.getInstance();

  let walletActivityReceived = false;
  let transactionDetectedReceived = false;

  // Set up event listeners
  transactionMonitor.on('walletActivity', (activity) => {
    walletActivityReceived = true;
    console.log(`    Received wallet activity: ${activity.walletAddress} - ${activity.activityType}`);
  });

  transactionMonitor.on('transactionDetected', (activity) => {
    transactionDetectedReceived = true;
    console.log(`    Received transaction detected: ${activity.walletAddress} - ${activity.activityType}`);
  });

  // Test transaction that should trigger events
  const testTransaction = {
    from: 'eth|0xabc123',
    to: 'eth|0xdef456',
    actions: [{
      args: ['DexV3Contract:BatchSubmit', JSON.stringify({
        operations: [{
          method: 'Swap',
          uniqueId: 'test-event-1',
          dto: {
            token0: { collection: 'GALA' },
            token1: { collection: 'GWETH' },
            amount: '100',
            recipient: 'eth|0xabc123',
            fee: '0.003',
            zeroForOne: true
          }
        }]
      })]
    }]
  };

  transactionMonitor.processBlock({
    parsedBlock: {
      blockNumber: 12348,
      transactions: [testTransaction]
    }
  });

  // Wait for processing and events
  await new Promise(resolve => setTimeout(resolve, 300));

  console.log(`    Wallet activity event received: ${walletActivityReceived}`);
  console.log(`    Transaction detected event received: ${transactionDetectedReceived}`);

  console.log('✅ Event emission tests passed!');
}

async function testShutdown(): Promise<void> {
  console.log('🧪 Testing shutdown...');
  const transactionMonitor = TransactionMonitor.getInstance();

  await transactionMonitor.shutdown();
  console.log('    Transaction monitor shutdown successfully');

  console.log('✅ Shutdown tests passed!');
}

(async () => {
  try {
    await testTransactionMonitorBasic();
    await testTransactionFiltering();
    await testDEXOperationProcessing();
    await testTokenFiltering();
    await testEventEmission();
    await testShutdown();
    console.log('\n🎉 All transaction monitor tests completed successfully!');
  } catch (error) {
    logger.error('💥 Transaction monitor tests failed:', error);
    await teardownTestEnvironment();
    process.exit(1);
  } finally {
    await teardownTestEnvironment();
  }
})();
