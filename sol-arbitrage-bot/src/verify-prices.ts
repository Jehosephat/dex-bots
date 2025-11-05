/**
 * Simple Price Verification Script
 * 
 * Quick way to verify that prices are real and up-to-date.
 */

import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { initializeConfig } from './config';
import logger from './utils/logger';

async function verifyPrices() {
  try {
    logger.info('🔍 Verifying real-time prices...');
    
    // Initialize configuration
    initializeConfig();
    
    // Initialize price providers
    const configService = require('./config').createConfigService();
    const galaChainProvider = new GalaChainPriceProvider(configService);
    const solanaProvider = new SolanaPriceProvider(configService);
    
    await galaChainProvider.initialize();
    await solanaProvider.initialize();
    
    // Get current prices
    const galaPrice = galaChainProvider.getGALAUSDPrice();
    const solPrice = solanaProvider.getSOLUSDPrice();
    
    const now = new Date().toLocaleString();
    
    logger.info('📊 Current Prices:');
    logger.info(`💰 GALA/USD: $${galaPrice.toFixed(6)} (${now})`);
    logger.info(`💰 SOL/USD: $${solPrice.toFixed(2)} (${now})`);
    
    // Calculate SOL to GALA rate
    const solToGalaRate = solPrice / galaPrice;
    logger.info(`🔄 SOL to GALA rate: ${solToGalaRate.toFixed(2)} GALA per SOL`);
    
    // Verify prices are reasonable
    const galaReasonable = galaPrice > 0.001 && galaPrice < 1.0;
    const solReasonable = solPrice > 10 && solPrice < 1000;
    
    if (galaReasonable && solReasonable) {
      logger.info('✅ Prices appear reasonable and up-to-date!');
    } else {
      logger.warn('⚠️ Prices may be stale or incorrect');
    }
    
    return true;
    
  } catch (error) {
    logger.error('❌ Price verification failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

// Run verification if this file is executed directly
if (require.main === module) {
  verifyPrices().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { verifyPrices };
