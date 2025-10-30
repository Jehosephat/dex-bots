/**
 * SOL Arbitrage Bot - Main Entry Point
 * 
 * Cross-chain arbitrage bot that detects price discrepancies between
 * GalaChain and Solana, executes paired trades, and bridges tokens.
 */

import logger from './utils/logger';
import { initializeConfig, validateConfig, getEnabledTokens, getConfig } from './config';

async function main() {
  try {
    logger.info('🚀 Starting SOL Arbitrage Bot...');
    logger.arbitrage('Bot initialization started');
    
    // Initialize configuration
    logger.info('📋 Loading configuration...');
    const configManager = initializeConfig();
    
    // Validate configuration
    const validation = validateConfig();
    if (!validation.isValid) {
      logger.error('❌ Configuration validation failed', { errors: validation.errors });
      process.exit(1);
    }
    
    if (validation.warnings.length > 0) {
      logger.warn('⚠️ Configuration warnings', { warnings: validation.warnings });
    }
    
    // Log configuration summary
    const config = getConfig();
    const enabledTokens = getEnabledTokens();
    logger.info('✅ Configuration loaded successfully', {
      enabledTokens: enabledTokens.map(t => t.symbol),
      tradingConfig: {
        minEdgeBps: config.trading.minEdgeBps,
        maxSlippageBps: config.trading.maxSlippageBps,
        cooldownMinutes: config.trading.cooldownMinutes
      },
      bridgingConfig: {
        intervalMinutes: config.bridging.intervalMinutes,
        thresholdUsd: config.bridging.thresholdUsd
      }
    });
    
    // TODO: Initialize price providers
    // TODO: Initialize execution engine
    // TODO: Initialize bridging system
    // TODO: Initialize monitoring
    
    logger.info('✅ SOL Arbitrage Bot initialized successfully');
    logger.arbitrage('Bot ready for arbitrage opportunities');
    
    // TODO: Start main arbitrage loop
    // TODO: Start bridge scheduler
    // TODO: Start monitoring dashboard
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Failed to start SOL Arbitrage Bot', { error: errorMessage });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the bot
if (require.main === module) {
  main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('💥 Unhandled error in main process', { error: errorMessage });
    process.exit(1);
  });
}

export { main };
