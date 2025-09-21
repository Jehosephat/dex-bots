#!/usr/bin/env node

/**
 * Follow Bot - GalaSwap Copy Trading Bot
 * 
 * This is the main entry point for the follow bot.
 * It orchestrates all components to monitor target wallets
 * and automatically replicate their GalaSwap trades.
 */

import dotenv from 'dotenv';
import { ConfigurationManager } from './config/configManager';
import { StateManager } from './utils/stateManager';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

async function initializeBot(): Promise<void> {
  try {
    logger.info('🤖 Starting Follow Bot...');
    logger.info('📋 Environment:', process.env['NODE_ENV'] || 'development');
    
    // Initialize configuration manager
    logger.info('🔧 Initializing configuration manager...');
    const configManager = ConfigurationManager.getInstance();
    await configManager.initialize();
    
    // Initialize state manager
    logger.info('💾 Initializing state manager...');
    const stateManager = StateManager.getInstance();
    await stateManager.initialize();
    
    // Get configurations
    const envConfig = configManager.getEnvironmentConfig();
    const enabledWallets = configManager.getEnabledTargetWallets();
    
    // Get state information
    const currentState = stateManager.getState();
    const performanceMetrics = stateManager.getPerformanceMetrics();
    
    logger.info('✅ Configuration loaded successfully');
    logger.info(`📊 Loaded ${enabledWallets.length} enabled target wallets`);
    logger.info(`🎯 Copy mode: ${envConfig.copyMode}`);
    logger.info(`💰 Max position size: ${envConfig.maxPositionSize * 100}%`);
    logger.info(`⏱️  Execution delay: ${envConfig.executionDelay}s`);
    
    logger.info('✅ State manager initialized successfully');
    logger.info(`📈 Previous session: ${performanceMetrics.totalTrades} trades, ${performanceMetrics.successRate.toFixed(1)}% success rate`);
    logger.info(`💼 Current positions: ${currentState.positions.length}`);
    logger.info(`⏰ Active cooldowns: ${currentState.cooldowns.length}`);
    
    // TODO: Initialize all components
    // - WebSocket Manager  
    // - Wallet Monitor
    // - Trade Analyzer
    // - Position Manager
    // - Trade Executor
    // - Risk Manager
    // - Safety Manager
    
    logger.info('✅ Follow Bot initialized successfully');
    logger.info('🚀 Ready to monitor target wallets and copy trades');
    
  } catch (error) {
    logger.error('❌ Failed to initialize Follow Bot:', error);
    process.exit(1);
  }
}

// Initialize and start the bot
initializeBot();

// Graceful shutdown handling
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  try {
    // Shutdown state manager
    const stateManager = StateManager.getInstance();
    await stateManager.shutdown();
    
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
