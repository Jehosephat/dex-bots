/**
 * Test script to test transaction monitoring with real GalaChain block data
 */

import { TransactionMonitor } from './src/monitoring/transactionMonitor';
import { ConfigurationManager } from './src/config/configManager';
import { StateManager } from './src/utils/stateManager';
import { ErrorHandler } from './src/utils/errorHandler';
import { logger } from './src/utils/logger';
import fs from 'fs/promises';
import path from 'path';

async function testRealBlock() {
  try {
    logger.info('🧪 Testing with real GalaChain block data...');
    
    // Initialize components
    const configManager = ConfigurationManager.getInstance();
    await configManager.initialize();
    
    const stateManager = StateManager.getInstance();
    await stateManager.initialize();
    
    const errorHandler = ErrorHandler.getInstance();
    
    // Initialize transaction monitor
    const transactionMonitor = TransactionMonitor.getInstance();
    await transactionMonitor.initialize();
    
    // Load the real block data
    const blockDataPath = path.join(process.cwd(), 'examples', 'swap-block-example.json');
    const blockData = JSON.parse(await fs.readFile(blockDataPath, 'utf8'));
    
    logger.info(`📦 Loaded block data: ${blockData.blockNumber}`);
    logger.info(`📊 Block has ${blockData.transactions.length} transactions`);
    
    // Process the block
    transactionMonitor.processBlock(blockData);
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check results
    const queueStatus = transactionMonitor.getQueueStatus();
    logger.info(`📈 Queue status: ${JSON.stringify(queueStatus)}`);
    
    // Get state
    const state = stateManager.getState();
    logger.info(`📊 State: ${state.trades.length} trades, ${state.positions.length} positions`);
    
    if (state.trades.length > 0) {
      logger.info('🎯 Detected trades:');
      state.trades.forEach((trade, index) => {
        logger.info(`  ${index + 1}. ${trade.id}: ${trade.originalTrade.tokenIn} → ${trade.originalTrade.tokenOut}`);
        logger.info(`     Amount: ${trade.originalTrade.amountIn} → ${trade.originalTrade.amountOut}`);
        logger.info(`     Wallet: ${trade.targetWallet}`);
        logger.info(`     Status: ${trade.copiedTrade.status}`);
      });
    }
    
    // Shutdown
    await transactionMonitor.shutdown();
    
    logger.info('✅ Test completed successfully!');
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testRealBlock();
