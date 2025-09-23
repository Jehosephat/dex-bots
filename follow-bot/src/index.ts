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
import { WalletMonitor } from './monitoring/walletMonitor';
import { TradeAnalyzer } from './analysis/tradeAnalyzer';
import { PositionTracker } from './positions/positionTracker';
import { TradeExecutor } from './execution/tradeExecutor';
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
    
    // Initialize wallet monitor
    logger.info('👥 Initializing wallet monitor...');
    const walletMonitor = WalletMonitor.getInstance();
    await walletMonitor.initialize();
    
    // Initialize trade analyzer
    logger.info('🔍 Initializing trade analyzer...');
    const tradeAnalyzer = TradeAnalyzer.getInstance();
    await tradeAnalyzer.initialize();
    
    // Initialize position tracker
    logger.info('📊 Initializing position tracker...');
    const positionTracker = PositionTracker.getInstance();
    await positionTracker.initialize();
    
    // Initialize trade executor
    logger.info('🚀 Initializing trade executor...');
    const tradeExecutor = TradeExecutor.getInstance();
    await tradeExecutor.initialize();
    
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
    
    // Setup transaction monitor event handlers
    const transactionMonitor = wsManager['transactionMonitor']; // Access private property
    transactionMonitor.on('walletActivity', async (activity) => {
      logger.info(`📊 Transaction processed: ${activity.walletAddress} - ${activity.activityType}`);
      logger.info(`   Block: ${activity.blockNumber}, Hash: ${activity.transactionHash}`);
      if (activity.transaction.tokenIn && activity.transaction.tokenOut) {
        logger.info(`   Tokens: ${activity.transaction.tokenIn} → ${activity.transaction.tokenOut}`);
      }
      
      // Process wallet activity through wallet monitor
      await walletMonitor.processWalletActivity(activity);
    });
    
    transactionMonitor.on('transactionDetected', (activity) => {
      logger.info(`🔍 Transaction detected: ${activity.walletAddress} - ${activity.activityType}`);
      // TODO: Add to trade analysis queue
    });
    
    // Setup wallet monitor event handlers
    walletMonitor.on('walletActivity', async (data) => {
      logger.info(`👥 Wallet activity: ${data.wallet.name} - ${data.activity.activityType} (Perf: ${data.wallet.performanceScore.toFixed(1)}, Risk: ${data.wallet.riskScore.toFixed(1)}, Trades: ${data.wallet.totalTrades})`);
      
      // Analyze the wallet activity for potential trade copying
      await tradeAnalyzer.analyzeWalletActivity(data.activity);
    });
    
    walletMonitor.on('walletAlert', (alert) => {
      logger.warn(`🚨 Wallet Alert [${alert.severity.toUpperCase()}]: ${alert.message}`);
      logger.warn(`   Wallet: ${alert.walletAddress}`);
      logger.warn(`   Type: ${alert.type}`);
      // TODO: Implement alert handling (notifications, etc.)
    });
    
    // Setup trade analyzer event handlers
    tradeAnalyzer.on('tradeAnalysis', (analysis) => {
      logger.info(`🔍 Trade analysis: ${analysis.analysisResult} - ${analysis.targetWallet.name} (Risk: ${analysis.riskScore.toFixed(1)}, Conf: ${analysis.confidenceScore.toFixed(1)}, Action: ${analysis.recommendedAction.action})`);
    });
    
    tradeAnalyzer.on('tradeApproved', async (analysis) => {
      logger.info(`✅ Trade approved: ${analysis.calculatedTrade.amountIn} ${analysis.calculatedTrade.tokenIn} → ${analysis.calculatedTrade.amountOut} ${analysis.calculatedTrade.tokenOut} (${analysis.calculatedTrade.copyMode})`);
      
      // Create position from approved trade
      const position = await positionTracker.createPositionFromTrade(analysis);
      if (position) {
        logger.info(`📊 Position created for approved trade: ${position.id}`);
      }
      
      // Execute the approved trade
      const execution = await tradeExecutor.executeTrade(analysis);
      logger.info(`🚀 Trade execution queued: ${execution.id}`);
    });
    
    tradeAnalyzer.on('tradeRejected', (analysis) => {
      logger.warn(`❌ Trade rejected: ${analysis.rejectionReason || 'Unknown'} (Risk: ${analysis.riskScore.toFixed(1)})`);
    });
    
    // Setup position tracker event handlers
    positionTracker.on('positionCreated', (position) => {
      logger.info(`📊 Position created: ${position.id}`);
      logger.info(`   Pool: ${position.token0}/${position.token1}`);
      logger.info(`   Liquidity: ${position.liquidity}`);
      logger.info(`   Ticks: ${position.tickLower} to ${position.tickUpper}`);
      logger.info(`   Original Wallet: ${position.originalWallet}`);
    });
    
    positionTracker.on('positionUpdated', (position) => {
      logger.info(`📊 Position updated: ${position.id}`);
      logger.info(`   Status: ${position.status}`);
      logger.info(`   Liquidity: ${position.liquidity}`);
      logger.info(`   Return: ${position.performance.returnPercentage.toFixed(2)}%`);
    });
    
    positionTracker.on('positionClosed', (position) => {
      logger.info(`📊 Position closed: ${position.id}`);
      logger.info(`   Final Return: ${position.performance.returnPercentage.toFixed(2)}%`);
      logger.info(`   Total Fees Earned: ${position.performance.totalFeesEarned.toFixed(2)}`);
      logger.info(`   Duration: ${(position.performance.duration / (1000 * 60 * 60 * 24)).toFixed(1)} days`);
    });
    
    positionTracker.on('positionAlert', (alert) => {
      logger.warn(`🚨 Position Alert [${alert.severity.toUpperCase()}]: ${alert.message}`);
      logger.warn(`   Position: ${alert.positionId}`);
      logger.warn(`   Type: ${alert.type}`);
      logger.warn(`   Threshold: ${alert.threshold}`);
      // TODO: Implement alert handling (notifications, etc.)
    });
    
    // Setup trade executor event handlers
    tradeExecutor.on('executionQueued', (execution) => {
      logger.info(`🚀 Trade execution queued: ${execution.id}`);
      logger.info(`   Strategy: ${execution.executionStrategy.type}`);
      logger.info(`   Trade: ${execution.trade.amountIn} ${execution.trade.tokenIn} → ${execution.trade.amountOut} ${execution.trade.tokenOut}`);
    });
    
    tradeExecutor.on('executionStarted', (execution) => {
      logger.info(`🚀 Trade execution started: ${execution.id}`);
      logger.info(`   Attempt: ${execution.attempts}/${execution.maxAttempts}`);
    });
    
    tradeExecutor.on('executionCompleted', (execution) => {
      logger.info(`✅ Trade execution completed: ${execution.id}`);
      if (execution.result) {
        logger.info(`   Transaction ID: ${execution.result.transactionId}`);
        logger.info(`   Actual Output: ${execution.result.actualAmountOut}`);
        logger.info(`   Slippage: ${(execution.result.slippage * 100).toFixed(2)}%`);
        logger.info(`   Execution Time: ${execution.result.executionTime}ms`);
      }
    });
    
    tradeExecutor.on('executionFailed', (execution) => {
      logger.error(`❌ Trade execution failed: ${execution.id}`);
      logger.error(`   Error: ${execution.error}`);
      logger.error(`   Attempts: ${execution.attempts}/${execution.maxAttempts}`);
    });
    
    tradeExecutor.on('executionCancelled', (execution) => {
      logger.warn(`⚠️ Trade execution cancelled: ${execution.id}`);
      logger.warn(`   Reason: ${execution.error || 'Manual cancellation'}`);
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
    
    // Shutdown wallet monitor
    const walletMonitor = WalletMonitor.getInstance();
    await walletMonitor.shutdown();
    
    // Shutdown trade analyzer
    const tradeAnalyzer = TradeAnalyzer.getInstance();
    await tradeAnalyzer.shutdown();
    
    // Shutdown position tracker
    const positionTracker = PositionTracker.getInstance();
    await positionTracker.shutdown();
    
    // Shutdown trade executor
    const tradeExecutor = TradeExecutor.getInstance();
    await tradeExecutor.shutdown();
    
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
