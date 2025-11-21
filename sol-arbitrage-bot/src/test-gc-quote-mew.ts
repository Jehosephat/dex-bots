/**
 * Test GalaChain Quote for MEW
 * 
 * Quick test script to verify MEW quote calculation on GalaSwap
 * Tests both forward arbitrage (selling MEW for GALA) and reverse arbitrage (buying MEW with GALA)
 * 
 * Uses the same quoting methodology as the main application:
 * - Forward: getQuote('MEW', amount, false) - selling MEW to get GALA
 * - Reverse: getQuote('MEW', amount, true) - buying MEW with GALA
 * - Validates quotes using QuoteValidator (same as application)
 * - Displays GalaChain-specific fields (galaFee, route, etc.)
 */

import { join } from 'path';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { initializeConfig, getTokenConfig, createConfigService } from './config';
import { GalaChainQuote } from './types/core';
import { QuoteValidator } from './core/quoteValidator';
import logger from './utils/logger';

async function testMEWQuote() {
  try {
    logger.info('🧪 Testing GalaChain MEW quote on GalaSwap...');
    
    // Initialize configuration
    // Use paths relative to project root (one level up from src/)
    const configPath = join(__dirname, '..', 'config', 'config.json');
    const tokensPath = join(__dirname, '..', 'config', 'tokens.json');
    logger.info('📋 Initializing configuration...');
    initializeConfig(configPath, tokensPath);
    
    const tokenConfig = getTokenConfig('MEW');
    if (!tokenConfig) {
      throw new Error('MEW token not configured');
    }
    
    logger.info(`📊 MEW Config:`, {
      symbol: tokenConfig.symbol,
      galaChainMint: tokenConfig.galaChainMint,
      decimals: tokenConfig.decimals,
      tradeSize: tokenConfig.tradeSize,
      gcQuoteVia: tokenConfig.gcQuoteVia
    });
    
    // Initialize price provider
    logger.info('📊 Initializing GalaChain price provider...');
    const configService = createConfigService(configPath, tokensPath);
    const galaChainProvider = new GalaChainPriceProvider(configService);
    await galaChainProvider.initialize();
    
    logger.info('✅ Price provider initialized');
    
    // Initialize quote validator (same as application uses)
    const quoteValidator = new QuoteValidator();
    
    const tradeSize = 5000; // 5000 MEW
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`🔍 Testing quotes for ${tradeSize} MEW on GalaSwap`);
    logger.info(`${'='.repeat(60)}\n`);
    
    // Test FORWARD arbitrage (selling MEW for GALA) - reverse=false
    // This matches how the application gets quotes for forward arbitrage
    logger.info(`\n📤 FORWARD ARBITRAGE: Selling ${tradeSize} MEW for GALA`);
    logger.info(`   (reverse=false, same as application uses for forward direction)`);
    logger.info(`${'-'.repeat(60)}`);
    const forwardQuote = await galaChainProvider.getQuote('MEW', tradeSize, false);
    
    if (forwardQuote) {
      // Validate quote (same as application does)
      const validation = quoteValidator.validate(forwardQuote, 'Forward MEW quote');
      if (!validation.isValid) {
        logger.warn(`⚠️ Quote validation failed: ${validation.errors.join(', ')}`);
      }
      
      const proceeds = forwardQuote.price.multipliedBy(tradeSize);
      const gcQuote = forwardQuote as GalaChainQuote;
      logger.info(`✅ Forward Quote Success:`);
      logger.info(`   Trade Size: ${tradeSize} MEW`);
      logger.info(`   Price: ${forwardQuote.price.toFixed(8)} ${forwardQuote.currency} per MEW`);
      logger.info(`   Proceeds: ${proceeds.toFixed(8)} ${forwardQuote.currency}`);
      logger.info(`   Price Impact: ${forwardQuote.priceImpactBps.toFixed(2)} bps`);
      logger.info(`   Fee Tier: ${gcQuote.feeTier} (${(gcQuote.feeTier / 10000).toFixed(2)}%)`);
      if (gcQuote.galaFee) {
        logger.info(`   GALA Fee: ${gcQuote.galaFee.toFixed(8)} GALA`);
      }
      if (gcQuote.poolLiquidity) {
        logger.info(`   Pool Liquidity:`);
        logger.info(`     Active: ${gcQuote.poolLiquidity.liquidity.toFixed(2)}`);
        logger.info(`     Total: ${gcQuote.poolLiquidity.grossPoolLiquidity.toFixed(2)}`);
        // Warn if liquidity seems low
        if (gcQuote.poolLiquidity.liquidity.isLessThan(1000)) {
          logger.warn(`     ⚠️ Low liquidity detected - execution may fail!`);
        }
      } else {
        logger.warn(`   ⚠️ Pool liquidity information not available`);
      }
      if (forwardQuote.minOutput) {
        logger.info(`   Min Output: ${forwardQuote.minOutput.toFixed(8)} ${forwardQuote.currency}`);
      }
      if (gcQuote.route && gcQuote.route.length > 0) {
        logger.info(`   Route: ${gcQuote.route.join(' → ')}`);
      }
      logger.info(`   Valid: ${forwardQuote.isValid ? '✅' : '❌'}`);
      logger.info(`   Age: ${Math.floor((Date.now() - forwardQuote.timestamp) / 1000)}s`);
    } else {
      logger.error(`❌ No forward quote available for ${tradeSize} MEW`);
    }
    
    // Test REVERSE arbitrage (buying MEW with GALA) - reverse=true
    // This matches how the application gets quotes for reverse arbitrage
    logger.info(`\n📥 REVERSE ARBITRAGE: Buying ${tradeSize} MEW with GALA`);
    logger.info(`   (reverse=true, same as application uses for reverse direction)`);
    logger.info(`${'-'.repeat(60)}`);
    const reverseQuote = await galaChainProvider.getQuote('MEW', tradeSize, true);
    
    if (reverseQuote) {
      // Validate quote (same as application does)
      const validation = quoteValidator.validate(reverseQuote, 'Reverse MEW quote');
      if (!validation.isValid) {
        logger.warn(`⚠️ Quote validation failed: ${validation.errors.join(', ')}`);
      }
      
      const cost = reverseQuote.price.multipliedBy(tradeSize);
      const gcQuote = reverseQuote as GalaChainQuote;
      logger.info(`✅ Reverse Quote Success:`);
      logger.info(`   Trade Size: ${tradeSize} MEW`);
      logger.info(`   Price: ${reverseQuote.price.toFixed(8)} ${reverseQuote.currency} per MEW`);
      logger.info(`   Total Cost: ${cost.toFixed(8)} ${reverseQuote.currency}`);
      logger.info(`   Price Impact: ${reverseQuote.priceImpactBps.toFixed(2)} bps`);
      logger.info(`   Fee Tier: ${gcQuote.feeTier} (${(gcQuote.feeTier / 10000).toFixed(2)}%)`);
      if (gcQuote.galaFee) {
        logger.info(`   GALA Fee: ${gcQuote.galaFee.toFixed(8)} GALA`);
      }
      if (gcQuote.poolLiquidity) {
        logger.info(`   Pool Liquidity:`);
        logger.info(`     Active: ${gcQuote.poolLiquidity.liquidity.toFixed(2)}`);
        logger.info(`     Total: ${gcQuote.poolLiquidity.grossPoolLiquidity.toFixed(2)}`);
        // Warn if liquidity seems low
        if (gcQuote.poolLiquidity.liquidity.isLessThan(1000)) {
          logger.warn(`     ⚠️ Low liquidity detected - execution may fail!`);
        }
      } else {
        logger.warn(`   ⚠️ Pool liquidity information not available`);
      }
      if (reverseQuote.minOutput) {
        logger.info(`   Min Output: ${reverseQuote.minOutput.toFixed(8)} ${reverseQuote.currency}`);
      }
      if (gcQuote.route && gcQuote.route.length > 0) {
        logger.info(`   Route: ${gcQuote.route.join(' → ')}`);
      }
      logger.info(`   Valid: ${reverseQuote.isValid ? '✅' : '❌'}`);
      logger.info(`   Age: ${Math.floor((Date.now() - reverseQuote.timestamp) / 1000)}s`);
    } else {
      logger.error(`❌ No reverse quote available for ${tradeSize} MEW`);
    }
    
    // Compare forward vs reverse prices
    if (forwardQuote && reverseQuote) {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`📊 PRICE COMPARISON`);
      logger.info(`${'='.repeat(60)}`);
      const forwardPrice = forwardQuote.price.toNumber();
      const reversePrice = reverseQuote.price.toNumber();
      const spread = reversePrice - forwardPrice;
      const spreadPercent = (spread / forwardPrice) * 100;
      
      logger.info(`   Forward (Sell) Price: ${forwardPrice.toFixed(8)} ${forwardQuote.currency} per MEW`);
      logger.info(`   Reverse (Buy) Price:  ${reversePrice.toFixed(8)} ${reverseQuote.currency} per MEW`);
      logger.info(`   Spread: ${spread.toFixed(8)} ${forwardQuote.currency} (${spreadPercent.toFixed(2)}%)`);
      
      if (spread > 0) {
        logger.info(`   ✅ Reverse (buy) price is higher than forward (sell) price (as expected)`);
        logger.info(`   💡 This spread represents the cost of liquidity and price impact`);
      } else {
        logger.warn(`   ⚠️ Reverse (buy) price is lower than forward (sell) price (unusual)`);
      }
    }
    
    return { forwardQuote, reverseQuote };
    
  } catch (error) {
    logger.error('❌ Test failed:', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

// Run the test
testMEWQuote()
  .then(() => {
    logger.info('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('\n❌ Test failed:', error);
    process.exit(1);
  });

