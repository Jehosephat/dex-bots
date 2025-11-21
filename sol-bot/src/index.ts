/**
 * GalaChain-Solana Arbitrage Bot
 * Main Entry Point
 * 
 * This bot discovers and executes arbitrage opportunities between
 * GalaChain DEX and Solana DEXs (via Jupiter).
 */

import { PriceDiscovery } from './core/priceDiscovery';
import { InventoryManager } from './core/inventoryManager';
import { BridgeMonitor } from './core/bridgeMonitor';
import { riskManager } from './core/riskManager';
import { DualLegExecutor } from './execution';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { stateManager } from './utils/stateManager';
import { ArbitrageOpportunity } from './types';

export class ArbitrageBot {
  private priceDiscovery: PriceDiscovery;
  private inventoryManager: InventoryManager;
  private bridgeMonitor: BridgeMonitor;
  private dualLegExecutor: DualLegExecutor;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private bridgeCheckInterval: NodeJS.Timeout | null = null;
  
  // Performance tracking
  private cycleCount: number = 0;
  private opportunitiesFound: number = 0;
  private tradesExecuted: number = 0;
  private startTime: number = 0;
  private totalPnL: number = 0;

  constructor() {
    this.priceDiscovery = new PriceDiscovery();
    this.inventoryManager = new InventoryManager();
    this.bridgeMonitor = new BridgeMonitor();
    this.dualLegExecutor = new DualLegExecutor();
  }

  /**
   * Initialize all modules
   */
  async initialize(): Promise<void> {
    try {
      logger.info('🚀 Initializing GalaChain-Solana Arbitrage Bot...');
      
      // Load configuration
      const botConfig = config.getBotConfig();
      const tokensConfig = config.getTokensConfig();
      
      logger.info('Configuration loaded', {
        enabledTokens: config.getEnabledTokens().map(t => t.symbol),
        minEdge: botConfig.trading.minEdgeThreshold,
        maxConcurrentTrades: botConfig.trading.maxConcurrentTrades
      });

      // Initialize modules
      logger.info('Initializing modules...');
      
      await this.priceDiscovery.initialize();
      logger.info('✅ Price Discovery initialized');
      
      await this.inventoryManager.updateBalances();
      logger.info('✅ Inventory Manager initialized');
      
      this.bridgeMonitor.startMonitoring();
      logger.info('✅ Bridge Monitor initialized');
      
      logger.info('✅ Risk Manager initialized');

      // Load saved state
      const state = stateManager.getState();
      if (state.totalPnL !== undefined) {
        logger.info('Loaded previous state', {
          totalPnL: state.totalPnL,
          tradeCount: state.tradeCount
        });
      }

      logger.info('🎉 All modules initialized successfully!');
    } catch (error) {
      logger.error('Failed to initialize bot', { error });
      throw error;
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    try {
      await this.initialize();
      
      this.isRunning = true;
      this.startTime = Date.now();
      
      logger.info('🤖 Starting arbitrage bot...');
      logger.info(this.getBotInfo());

      // Update state
      stateManager.setRunning(true);

      // Start main trading loop
      const updateInterval = config.getTradingConfig().priceUpdateInterval;
      this.mainLoopInterval = setInterval(() => {
        this.runMainCycle().catch(error => {
          logger.error('Error in main cycle', { error });
        });
      }, updateInterval);

      // Run first cycle immediately
      await this.runMainCycle();

      // Start bridge monitoring
      this.bridgeCheckInterval = setInterval(() => {
        this.checkBridgeStatus().catch(error => {
          logger.error('Error checking bridge status', { error });
        });
      }, 60000); // Check every minute

      logger.info('✅ Bot started successfully!');
      logger.info(`📊 Main loop running every ${updateInterval}ms`);
    } catch (error) {
      logger.error('Failed to start bot', { error });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Main trading cycle
   */
  private async runMainCycle(): Promise<void> {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    try {
      this.cycleCount++;
      logger.debug(`Starting cycle #${this.cycleCount}`);

      // Check risk status first
      const riskStatus = riskManager.getRiskStatus();
      if (!riskStatus.isHealthy) {
        logger.warn('Risk manager not healthy - skipping cycle', riskStatus);
        return;
      }

      // Update inventory
      await this.inventoryManager.updateBalances();
      const inventory = this.inventoryManager.getInventoryStatus();
      
      // Log inventory periodically
      if (this.cycleCount % 10 === 0) {
        logger.info('Current inventory', {
          gcBalances: Object.fromEntries(
            Object.entries(inventory.gcBalances).map(([k, v]) => [k, v.toFixed(2)])
          ),
          solBalances: Object.fromEntries(
            Object.entries(inventory.solBalances).map(([k, v]) => [k, v.toFixed(4)])
          ),
          totalValueGALA: inventory.totalValueGALA.toFixed(2),
          drift: inventory.driftDirection
        });
      }

      // Discover arbitrage opportunities
      const opportunities = await this.priceDiscovery.discoverOpportunities();
      
      if (opportunities.length > 0) {
        this.opportunitiesFound += opportunities.length;
        logger.info(`Found ${opportunities.length} potential opportunities`, {
          tokens: opportunities.map(o => `${o.token}(${(o.netEdge * 100).toFixed(2)}%)`)
        });

        // Validate and execute opportunities
        for (const opportunity of opportunities) {
          await this.evaluateOpportunity(opportunity, inventory);
        }
      } else {
        logger.debug('No opportunities found in this cycle');
      }

      // Log status periodically
      if (this.cycleCount % 20 === 0) {
        this.logStatus();
      }

    } catch (error: any) {
      logger.error('Error in main cycle', { 
        error: error.message || error,
        cycle: this.cycleCount 
      });
    }
  }

  /**
   * Evaluate and potentially execute an arbitrage opportunity
   */
  private async evaluateOpportunity(
    opportunity: ArbitrageOpportunity,
    inventory: any
  ): Promise<void> {
    try {
      // Get bridge health
      const bridgeHealth = await this.bridgeMonitor.getBridgeHealth();

      // Validate with risk manager
      const validation = riskManager.validateOpportunity(opportunity, inventory);
      
      if (!validation.isValid) {
        logger.debug(`Opportunity rejected for ${opportunity.token}`, {
          violations: validation.violations.map(v => v.message),
          riskScore: validation.riskScore
        });
        return;
      }

      // Check bridge health for cross-chain trades
      const bridgeHealthCheck = riskManager.validateBridgeHealth(bridgeHealth);
      if (!bridgeHealthCheck.isValid) {
        logger.warn(`Bridge health check failed: ${bridgeHealthCheck.message}`);
        return;
      }

      logger.info(`✅ Opportunity validated for ${opportunity.token}`, {
        netEdge: `${(opportunity.netEdge * 100).toFixed(2)}%`,
        size: opportunity.recommendedSize,
        riskScore: validation.riskScore
      });

      // Check if we're in dry run mode
      const tradingConfig = config.getTradingConfig();
      if (tradingConfig.dryRun) {
        // DRY RUN MODE - Show what would be executed but don't actually trade
        this.opportunitiesFound++;
        
        logger.info('🔍 DRY RUN - Would execute arbitrage trade:', {
          token: opportunity.token,
          size: opportunity.recommendedSize,
          expectedProfit: `${(opportunity.netEdge * opportunity.recommendedSize * opportunity.gcSellPrice).toFixed(2)} GALA`,
          netEdge: `${(opportunity.netEdge * 100).toFixed(2)}%`,
          plan: {
            step1: `GalaChain: Sell ${opportunity.recommendedSize} ${opportunity.token} → Receive ~${(opportunity.recommendedSize * opportunity.gcSellPrice).toFixed(2)} GALA`,
            step2: `Solana: Spend ~${(opportunity.recommendedSize * opportunity.solBuyPrice).toFixed(4)} SOL → Buy ${opportunity.recommendedSize} ${opportunity.token}`,
            step3: `Net Profit: ${(opportunity.netEdge * opportunity.recommendedSize * opportunity.gcSellPrice).toFixed(2)} GALA (after bridge costs)`,
            gcPrice: `${opportunity.gcSellPrice.toFixed(6)} GALA per ${opportunity.token}`,
            solPrice: `${opportunity.solBuyPrice.toFixed(6)} SOL per ${opportunity.token}`,
            bridgeCost: `${opportunity.bridgeCostGALA.toFixed(2)} GALA`
          }
        });
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 DRY RUN - ARBITRAGE OPPORTUNITY FOUND`);
        console.log(`${'='.repeat(80)}`);
        console.log(`Token: ${opportunity.token}`);
        console.log(`Trade Size: ${opportunity.recommendedSize}`);
        console.log(`Net Edge: ${(opportunity.netEdge * 100).toFixed(2)}%`);
        console.log(`\n📤 STEP 1: GalaChain (SELL)`);
        console.log(`  Action: Sell ${opportunity.recommendedSize} ${opportunity.token}`);
        console.log(`  Price: ${opportunity.gcSellPrice.toFixed(6)} GALA per token`);
        console.log(`  Expected: ~${(opportunity.recommendedSize * opportunity.gcSellPrice).toFixed(2)} GALA`);
        console.log(`\n📥 STEP 2: Solana (BUY)`);
        console.log(`  Action: Buy ${opportunity.recommendedSize} ${opportunity.token}`);
        console.log(`  Price: ${opportunity.solBuyPrice.toFixed(6)} SOL per token`);
        console.log(`  Cost: ~${(opportunity.recommendedSize * opportunity.solBuyPrice).toFixed(4)} SOL`);
        console.log(`\n💰 EXPECTED PROFIT:`);
        console.log(`  Gross Profit: ${(opportunity.netEdge * opportunity.recommendedSize * opportunity.gcSellPrice + opportunity.bridgeCostGALA).toFixed(2)} GALA`);
        console.log(`  Bridge Cost: ${opportunity.bridgeCostGALA.toFixed(2)} GALA`);
        console.log(`  Net Profit: ${(opportunity.netEdge * opportunity.recommendedSize * opportunity.gcSellPrice).toFixed(2)} GALA`);
        console.log(`${'='.repeat(80)}\n`);
        
        return;
      }

      // LIVE MODE - Actually execute the trade
      logger.info('🚀 Executing arbitrage trade...', {
        token: opportunity.token,
        expectedProfit: (opportunity.netEdge * opportunity.recommendedSize * opportunity.gcSellPrice).toFixed(2) + ' GALA'
      });

      const tokenConfig = config.getToken(opportunity.token);
      if (!tokenConfig) {
        logger.error(`Token configuration not found for ${opportunity.token}`);
        return;
      }

      const result = await this.dualLegExecutor.executeArbitrage(opportunity, tokenConfig);

      if (result.success) {
        this.tradesExecuted++;
        this.totalPnL += result.realizedPnL;
        
        logger.info('💰 Trade executed successfully!', {
          token: opportunity.token,
          realizedPnL: `${result.realizedPnL.toFixed(2)} GALA`,
          netEdge: `${(result.netEdge * 100).toFixed(2)}%`,
          totalPnL: `${this.totalPnL.toFixed(2)} GALA`,
          totalTrades: this.tradesExecuted
        });

        // Update state
        stateManager.recordTrade(result.realizedPnL);
      } else {
        logger.error('❌ Trade execution failed', {
          token: opportunity.token,
          gcError: result.gcResult.error,
          solError: result.solResult.error
        });
      }
      
    } catch (error: any) {
      logger.error(`Failed to evaluate opportunity for ${opportunity.token}`, {
        error: error.message || error
      });
    }
  }

  /**
   * Check bridge status
   */
  private async checkBridgeStatus(): Promise<void> {
    try {
      const pendingBridges = this.bridgeMonitor.getPendingBridges();
      
      if (pendingBridges.length > 0) {
        logger.info(`Monitoring ${pendingBridges.length} pending bridge(s)`);
        
        // Log details of pending bridges
        pendingBridges.forEach(bridge => {
          const elapsed = Date.now() - bridge.initiatedAt;
          const elapsedMin = Math.floor(elapsed / 60000);
          logger.info(`Pending bridge: ${bridge.token}`, {
            hash: bridge.hash.substring(0, 20) + '...',
            amount: bridge.amount,
            status: bridge.statusDescription,
            elapsed: `${elapsedMin}min`
          });
        });
      }
      
      const health = await this.bridgeMonitor.getBridgeHealth();
      if (!health.isHealthy) {
        logger.warn('Bridge health degraded', health);
      }
    } catch (error) {
      logger.error('Failed to check bridge status', { error });
    }
  }

  /**
   * Pause the bot (stops looking for opportunities but continues monitoring)
   */
  pause(): void {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    this.isPaused = true;
    stateManager.setPaused(true);
    logger.warn('⏸️  Bot paused - monitoring continues, trading stopped');
  }

  /**
   * Resume the bot
   */
  resume(): void {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    this.isPaused = false;
    stateManager.setPaused(false);
    logger.info('▶️  Bot resumed');
  }

  /**
   * Stop the bot gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    logger.info('🛑 Stopping bot gracefully...');
    this.isRunning = false;

    // Clear intervals
    if (this.mainLoopInterval) {
      clearInterval(this.mainLoopInterval);
      this.mainLoopInterval = null;
    }

    if (this.bridgeCheckInterval) {
      clearInterval(this.bridgeCheckInterval);
      this.bridgeCheckInterval = null;
    }

    // Stop bridge monitoring
    this.bridgeMonitor.stopMonitoring();

    // Wait for any pending operations
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Update state
    stateManager.setRunning(false);
    stateManager.setPaused(false);

    this.logFinalStatus();
    logger.info('✅ Bot stopped successfully');
  }

  /**
   * Get bot information
   */
  private getBotInfo(): string {
    const riskConfig = config.getRiskConfig();
    const tradingConfig = config.getTradingConfig();
    const mode = tradingConfig.dryRun ? '🔍 DRY RUN MODE' : '💰 LIVE TRADING MODE';
    
    return `
╔════════════════════════════════════════════════════════════╗
║        GalaChain-Solana Arbitrage Bot v1.0.0              ║
║                  ${mode}                  ║
╚════════════════════════════════════════════════════════════╝

${tradingConfig.dryRun ? '⚠️  DRY RUN: Will show opportunities but NOT execute trades\n' : ''}
📊 Configuration:
  • Enabled Tokens: ${config.getEnabledTokens().map(t => t.symbol).join(', ')}
  • Min Edge Threshold: ${(tradingConfig.minEdgeThreshold * 100).toFixed(1)}%
  • Max Concurrent Trades: ${tradingConfig.maxConcurrentTrades}
  • Cooldown Period: ${tradingConfig.cooldownPeriod / 1000}s
  
🛡️  Risk Controls:
  • Circuit Breaker: ${riskConfig.circuitBreakerThreshold || 'N/A'} failures
  • Max Daily Loss: ${riskConfig.maxDailyLossGALA || riskConfig.maxDailyLoss || 'N/A'} GALA
  • Min GALA Balance: ${riskConfig.inventoryMinimums?.GALA || 'N/A'} GALA
  • Min SOL Balance: ${riskConfig.inventoryMinimums?.SOL || 'N/A'} SOL

🌉 Bridge:
  • Bridge Cost: ${config.getBridgingConfig().bridgeCostUSD} USD
  • Max Bridge Delay: ${config.getBridgingConfig().maxBridgeDelay / 60000}min

Ready to ${tradingConfig.dryRun ? 'analyze' : 'execute'} arbitrage opportunities! 🚀
`;
  }

  /**
   * Log current status
   */
  private logStatus(): void {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    const riskStatus = riskManager.getRiskStatus();
    
    logger.info('📊 Bot Status', {
      uptime: `${hours}h ${minutes}m ${seconds}s`,
      cycles: this.cycleCount,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      totalPnL: `${this.totalPnL.toFixed(2)} GALA`,
      activeTrades: riskStatus.activeTrades,
      dailyLoss: riskStatus.dailyLossGALA.toFixed(2) + ' GALA',
      circuitBreaker: riskStatus.circuitBreakerActive ? '⚠️ ACTIVE' : '✅ Inactive',
      emergencyStop: riskStatus.emergencyStopActive ? '🛑 ACTIVE' : '✅ Inactive'
    });
  }

  /**
   * Log final status on shutdown
   */
  private logFinalStatus(): void {
    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);

    logger.info('📊 Final Statistics', {
      runtime: `${hours}h ${minutes}m`,
      totalCycles: this.cycleCount,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      successRate: this.tradesExecuted > 0 
        ? `${((this.tradesExecuted / this.opportunitiesFound) * 100).toFixed(1)}%`
        : 'N/A'
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      uptime: Date.now() - this.startTime,
      cycles: this.cycleCount,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      riskStatus: riskManager.getRiskStatus()
    };
  }
}

// Main execution
async function main() {
  const bot = new ArbitrageBot();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    shutdown('unhandledRejection');
  });

  try {
    await bot.start();
  } catch (error) {
    logger.error('Failed to start bot', { error });
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main();
}

export default ArbitrageBot;

