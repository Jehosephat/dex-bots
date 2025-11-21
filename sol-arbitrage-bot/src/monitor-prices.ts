/**
 * Real-Time Price Monitor
 * 
 * Monitors prices in real-time to validate data freshness and accuracy.
 */

import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { QuoteManager } from './core/quoteManager';
import { initializeConfig, getEnabledTokens } from './config';
import logger from './utils/logger';

interface PriceSnapshot {
  timestamp: number;
  galaUsd: number;
  solUsd: number;
  tokenQuotes: Array<{
    symbol: string;
    galaChainPrice?: number;
    solanaPrice?: number;
  }>;
}

class PriceMonitor {
  private galaChainProvider: GalaChainPriceProvider;
  private solanaProvider: SolanaPriceProvider;
  private quoteManager: QuoteManager;
  private snapshots: PriceSnapshot[] = [];
  private isRunning: boolean = false;

  constructor() {
    const configService = require('./config').createConfigService();
    this.galaChainProvider = new GalaChainPriceProvider(configService);
    this.solanaProvider = new SolanaPriceProvider(configService);
    this.quoteManager = new QuoteManager(this.galaChainProvider, this.solanaProvider);
  }

  async initialize(): Promise<void> {
    await this.galaChainProvider.initialize();
    await this.solanaProvider.initialize();
    await this.quoteManager.initialize();
    logger.info('✅ Price monitor initialized');
  }

  async startMonitoring(intervalMs: number = 30000): Promise<void> {
    this.isRunning = true;
    logger.info(`🔄 Starting price monitoring (every ${intervalMs / 1000}s)`);
    
    const monitor = async () => {
      if (!this.isRunning) return;
      
      try {
        await this.takeSnapshot();
        this.displayLatestSnapshot();
        this.analyzePriceChanges();
      } catch (error) {
        logger.error('❌ Error in price monitoring', { error });
      }
      
      if (this.isRunning) {
        setTimeout(monitor, intervalMs);
      }
    };
    
    // Start immediately
    await monitor();
  }

  stopMonitoring(): void {
    this.isRunning = false;
    logger.info('🛑 Price monitoring stopped');
  }

  private async takeSnapshot(): Promise<void> {
    const snapshot: PriceSnapshot = {
      timestamp: Date.now(),
      galaUsd: this.galaChainProvider.getGALAUSDPrice(),
      solUsd: this.solanaProvider.getSOLUSDPrice(),
      tokenQuotes: []
    };

    const enabledTokens = getEnabledTokens();
    
    for (const token of enabledTokens.slice(0, 3)) { // Monitor first 3 tokens
      try {
        const galaChainQuote = await this.quoteManager.getGalaChainQuote(token);
        const solanaQuote = await this.quoteManager.getSolanaQuote(token);
        
        snapshot.tokenQuotes.push({
          symbol: token.symbol,
          galaChainPrice: galaChainQuote?.price.toNumber(),
          solanaPrice: solanaQuote?.price.toNumber()
        });
      } catch (error) {
        logger.debug(`⚠️ Error getting quotes for ${token.symbol}`, { error });
      }
    }

    this.snapshots.push(snapshot);
    
    // Keep only last 20 snapshots
    if (this.snapshots.length > 20) {
      this.snapshots = this.snapshots.slice(-20);
    }
  }

  private displayLatestSnapshot(): void {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return;

    const timeStr = new Date(latest.timestamp).toLocaleTimeString();
    
    logger.info(`📊 Price Snapshot [${timeStr}]:`);
    logger.info(`💰 GALA/USD: $${latest.galaUsd.toFixed(6)}`);
    logger.info(`💰 SOL/USD: $${latest.solUsd.toFixed(2)}`);
    
    latest.tokenQuotes.forEach(quote => {
      const galaPrice = quote.galaChainPrice ? `GC: ${quote.galaChainPrice.toFixed(6)} GALA` : 'GC: N/A';
      const solPrice = quote.solanaPrice ? `SOL: ${quote.solanaPrice.toFixed(6)} SOL` : 'SOL: N/A';
      logger.info(`🪙 ${quote.symbol}: ${galaPrice} | ${solPrice}`);
    });
  }

  private analyzePriceChanges(): void {
    if (this.snapshots.length < 2) return;

    const latest = this.snapshots[this.snapshots.length - 1];
    const previous = this.snapshots[this.snapshots.length - 2];
    
    // Analyze GALA price change
    const galaChange = latest.galaUsd - previous.galaUsd;
    const galaChangePercent = (galaChange / previous.galaUsd) * 100;
    
    if (Math.abs(galaChangePercent) > 1) {
      logger.info(`📈 GALA price change: ${galaChangePercent > 0 ? '+' : ''}${galaChangePercent.toFixed(2)}%`);
    }
    
    // Analyze SOL price change
    const solChange = latest.solUsd - previous.solUsd;
    const solChangePercent = (solChange / previous.solUsd) * 100;
    
    if (Math.abs(solChangePercent) > 1) {
      logger.info(`📈 SOL price change: ${solChangePercent > 0 ? '+' : ''}${solChangePercent.toFixed(2)}%`);
    }
    
    // Check for arbitrage opportunities
    this.checkArbitrageOpportunities(latest);
  }

  private checkArbitrageOpportunities(snapshot: PriceSnapshot): void {
    snapshot.tokenQuotes.forEach(quote => {
      if (quote.galaChainPrice && quote.solanaPrice) {
        // Convert SOL price to GALA equivalent
        const solToGalaRate = snapshot.solUsd / snapshot.galaUsd;
        const solanaPriceInGala = quote.solanaPrice * solToGalaRate;
        
        const priceDiff = quote.galaChainPrice - solanaPriceInGala;
        const priceDiffPercent = (priceDiff / quote.galaChainPrice) * 100;
        
        if (Math.abs(priceDiffPercent) > 5) {
          logger.info(`🎯 Potential arbitrage for ${quote.symbol}: ${priceDiffPercent.toFixed(2)}% difference`);
        }
      }
    });
  }

  getSnapshots(): PriceSnapshot[] {
    return [...this.snapshots];
  }

  getLatestSnapshot(): PriceSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] || null;
  }
}

async function startPriceMonitoring() {
  try {
    logger.info('🚀 Starting real-time price monitoring...');
    
    // Initialize configuration
    initializeConfig();
    
    // Create and initialize monitor
    const monitor = new PriceMonitor();
    await monitor.initialize();
    
    // Start monitoring every 30 seconds
    await monitor.startMonitoring(30000);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('🛑 Received SIGINT, stopping price monitor...');
      monitor.stopMonitoring();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('❌ Failed to start price monitoring', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  }
}

// Run the monitor if this file is executed directly
if (require.main === module) {
  startPriceMonitoring();
}

export { PriceMonitor, startPriceMonitoring };
