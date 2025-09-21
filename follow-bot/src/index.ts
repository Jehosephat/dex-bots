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
import { ErrorHandler, ErrorCategory, ErrorSeverity } from './utils/errorHandler';
import { HealthCheckSystem } from './utils/healthCheck';
import { WebSocketManager } from './websocket/websocketManager';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

async function initializeBot(): Promise<void> {
  try {
    logger.info('🤖 Starting Follow Bot...');
    logger.info('📋 Environment:', process.env['NODE_ENV'] || 'development');
    
    // Initialize error handler first
    logger.info('🛡️ Initializing error handler...');
    const errorHandler = ErrorHandler.getInstance();
    
    // Initialize health check system
    logger.info('🏥 Initializing health check system...');
    const healthCheckSystem = HealthCheckSystem.getInstance();
    
    // Initialize configuration manager
    logger.info('🔧 Initializing configuration manager...');
    const configManager = ConfigurationManager.getInstance();
    await configManager.initialize();
    
    // Initialize state manager
    logger.info('💾 Initializing state manager...');
    const stateManager = StateManager.getInstance();
    await stateManager.initialize();
    
    // Create circuit breakers for external services first
    errorHandler.createCircuitBreaker('galachain-api');
    errorHandler.createCircuitBreaker('websocket-connection');
    logger.info('🔒 Circuit breakers created for external services');
    
    // Initialize WebSocket manager
    logger.info('🔌 Initializing WebSocket manager...');
    const wsManager = WebSocketManager.getInstance();
    await wsManager.initialize();
    
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
    
    // Setup WebSocket event handlers
    wsManager.on('walletActivity', (activity) => {
      logger.info(`🎯 Wallet activity detected: ${activity.walletAddress} - ${activity.activityType}`);
      // TODO: Process wallet activity for trade copying
    });
    
    wsManager.on('connected', () => {
      logger.info('✅ WebSocket connected and ready for monitoring');
    });
    
    wsManager.on('disconnected', (data) => {
      logger.warn(`⚠️ WebSocket disconnected: ${data.code} - ${data.reason}`);
    });
    
    wsManager.on('error', (error) => {
      logger.error('❌ WebSocket error:', error);
    });
    
    // Run initial health check
    const healthStatus = await healthCheckSystem.getHealthStatus();
    logger.info(`🏥 Initial health check: ${healthStatus.body.overall}`);
    
    // TODO: Initialize remaining components
    // - Wallet Monitor
    // - Trade Analyzer
    // - Position Manager
    // - Trade Executor
    // - Risk Manager
    // - Safety Manager
    
    logger.info('✅ Follow Bot initialized successfully');
    logger.info('🚀 Ready to monitor target wallets and copy trades');
    
  } catch (error) {
    // Use error handler to categorize and handle initialization errors
    const errorHandler = ErrorHandler.getInstance();
    await errorHandler.handleError(
      error as Error,
      ErrorCategory.SYSTEM,
      ErrorSeverity.CRITICAL,
      { phase: 'initialization' }
    );
    
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
    // Set error handler to shutting down mode
    const errorHandler = ErrorHandler.getInstance();
    errorHandler.setShuttingDown();
    
    // Shutdown WebSocket manager
    const wsManager = WebSocketManager.getInstance();
    await wsManager.shutdown();
    
    // Shutdown state manager
    const stateManager = StateManager.getInstance();
    await stateManager.shutdown();
    
    // Cleanup error handler
    errorHandler.cleanupOldErrors();
    
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
