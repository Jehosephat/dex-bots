/**
 * Test GalaChain Quote for SOL
 * 
 * Quick test script to verify SOL quote calculation on GalaChain
 */

import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { initializeConfig, getTokenConfig } from './config';
import logger from './utils/logger';

async function testSOLQuote() {
  try {
    logger.info('🧪 Testing GalaChain SOL quote...');
    
    // Initialize configuration
    logger.info('📋 Initializing configuration...');
    initializeConfig();
    
    const tokenConfig = getTokenConfig('SOL');
    if (!tokenConfig) {
      throw new Error('SOL token not configured');
    }
    
    logger.info(`📊 SOL Config:`, {
      symbol: tokenConfig.symbol,
      galaChainMint: tokenConfig.galaChainMint,
      decimals: tokenConfig.decimals,
      tradeSize: tokenConfig.tradeSize,
      gcQuoteVia: tokenConfig.gcQuoteVia
    });
    
    // Initialize price provider
    logger.info('📊 Initializing GalaChain price provider...');
    const galaChainProvider = new GalaChainPriceProvider();
    await galaChainProvider.initialize();
    
    logger.info('✅ Price provider initialized');
    
    // Test with even smaller amounts to find what works
    const testSizes = [0.00001, 0.0001, 0.001]; // Try progressively larger sizes
    
    for (const testTradeSize of testSizes) {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`🔍 Testing quote for ${testTradeSize} SOL (${testTradeSize * 1000000} microSOL)...`);
    
      const quote = await galaChainProvider.getQuote('SOL', testTradeSize);
      
      if (quote) {
        logger.info(`\n✅ Quote Success for ${testTradeSize} SOL:`);
        logger.info(`   Price: ${quote.price.toFixed(8)} ${quote.currency} per SOL`);
        logger.info(`   Proceeds: ${quote.price.multipliedBy(testTradeSize).toFixed(8)} ${quote.currency}`);
        logger.info(`   Price Impact: ${quote.priceImpactBps.toFixed(2)} bps`);
        
        // Validate expected range
        const expectedPrice = 18000; // Based on UI: ~181 GALA for 0.01 SOL
        const actualPrice = quote.price.toNumber();
        const diff = Math.abs(actualPrice - expectedPrice);
        const percentDiff = (diff / expectedPrice) * 100;
        
        logger.info(`   Expected: ~${expectedPrice.toLocaleString()} ${quote.currency} per SOL`);
        logger.info(`   Actual: ${actualPrice.toLocaleString()} ${quote.currency} per SOL`);
        logger.info(`   Difference: ${percentDiff.toFixed(2)}%`);
        
        if (percentDiff < 10) {
          logger.info(`   ✅ Price is within expected range!`);
        } else {
          logger.warn(`   ⚠️ Price seems off`);
        }
        
        // If this size worked, try configured size
        if (testTradeSize === testSizes[testSizes.length - 1]) {
          logger.info(`\n🔍 Testing configured trade size (${tokenConfig.tradeSize} SOL)...`);
          const configuredQuote = await galaChainProvider.getQuote('SOL', tokenConfig.tradeSize);
          if (configuredQuote) {
            logger.info(`✅ Configured size quote works:`);
            logger.info(`   Size: ${tokenConfig.tradeSize} SOL`);
            logger.info(`   Proceeds: ${configuredQuote.price.multipliedBy(tokenConfig.tradeSize).toFixed(8)} ${quote.currency}`);
          } else {
            logger.warn(`⚠️ Configured size quote failed (not enough liquidity)`);
          }
        }
        
        return quote;
      } else {
        logger.warn(`❌ No quote for ${testTradeSize} SOL - trying next size...`);
      }
    }
    
    logger.error(`❌ All test sizes failed - quote logic may be incorrect`);
    return null;
    
  } catch (error) {
    logger.error('❌ Test failed:', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

// Run the test
testSOLQuote()
  .then(() => {
    logger.info('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('\n❌ Test failed:', error);
    process.exit(1);
  });

