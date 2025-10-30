/**
 * Quote Manager Test Script
 * 
 * Tests the QuoteManager functionality with simulated data to demonstrate
 * how it discovers arbitrage opportunities.
 */

import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { QuoteManager } from './core/quoteManager';
import { initializeConfig, getEnabledTokens } from './config';
import logger from './utils/logger';
import { BigNumber } from 'bignumber.js';

async function testQuoteManager() {
  try {
    logger.info('🧪 Testing Quote Manager functionality...');
    
    // Initialize configuration
    logger.info('📋 Initializing configuration...');
    initializeConfig();
    
    // Initialize price providers
    logger.info('📊 Initializing price providers...');
    const galaChainProvider = new GalaChainPriceProvider();
    const solanaProvider = new SolanaPriceProvider();
    
    await galaChainProvider.initialize();
    await solanaProvider.initialize();
    
    logger.info('✅ Price providers initialized');
    
    // Create quote manager
    logger.info('🎯 Creating quote manager...');
    const quoteManager = new QuoteManager(galaChainProvider, solanaProvider);
    await quoteManager.initialize();
    
    logger.info('✅ Quote manager initialized');
    
    // Test 1: Check cooldown status
    logger.info('⏰ Testing cooldown status...');
    const cooldownStatus = quoteManager.getCooldownStatus();
    const retryCounts = quoteManager.getRetryCounts();
    
    logger.info('📊 Cooldown status:', Object.fromEntries(cooldownStatus));
    logger.info('📊 Retry counts:', Object.fromEntries(retryCounts));
    
    // Test 2: Try to discover opportunities (will likely find none due to liquidity)
    logger.info('💰 Discovering arbitrage opportunities...');
    const opportunities = await quoteManager.discoverOpportunities();
    
    logger.info(`📊 Found ${opportunities.length} opportunities:`);
    opportunities.forEach((opp, index) => {
      logger.info(`  ${index + 1}. ${opp.tokenSymbol}:`, {
        netEdge: opp.netEdge.toString(),
        netEdgeBps: opp.netEdgeBps,
        galaChainPrice: opp.galaChainPrice.toString(),
        solanaPrice: opp.solanaPrice.toString(),
        tradeSize: opp.tradeSize
      });
    });
    
    // Test 3: Test with smaller trade sizes
    logger.info('🔍 Testing with smaller trade sizes...');
    const enabledTokens = getEnabledTokens();
    
    for (const token of enabledTokens.slice(0, 2)) {
      logger.info(`📈 Testing ${token.symbol} with smaller size...`);
      
      // Try with much smaller trade size
      const smallerSize = token.tradeSize / 1000; // Reduce by 1000x
      
      try {
        const galaChainQuote = await galaChainProvider.getQuote(token.symbol, smallerSize);
        if (galaChainQuote) {
          logger.info(`✅ GalaChain quote for ${token.symbol} (${smallerSize}):`, {
            price: galaChainQuote.price.toString(),
            currency: galaChainQuote.currency,
            priceImpactBps: galaChainQuote.priceImpactBps,
            provider: galaChainQuote.provider
          });
        } else {
          logger.warn(`⚠️ No GalaChain quote for ${token.symbol} (${smallerSize})`);
        }
        
        const solanaQuote = await solanaProvider.getQuote(token.symbol, smallerSize);
        if (solanaQuote) {
          logger.info(`✅ Solana quote for ${token.symbol} (${smallerSize}):`, {
            price: solanaQuote.price.toString(),
            currency: solanaQuote.currency,
            priceImpactBps: solanaQuote.priceImpactBps,
            provider: solanaQuote.provider
          });
        } else {
          logger.warn(`⚠️ No Solana quote for ${token.symbol} (${smallerSize})`);
        }
        
      } catch (error) {
        logger.error(`❌ Error testing ${token.symbol} with smaller size`, { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    // Test 4: Test quote manager methods
    logger.info('🔧 Testing quote manager methods...');
    
    // Test getEnabledTokens (from config)
    const tokens = getEnabledTokens();
    logger.info(`📋 Enabled tokens: ${tokens.map((t: any) => t.symbol).join(', ')}`);
    
    // Test cooldown status for each token
    for (const token of tokens) {
      const cooldownStatus = quoteManager.getCooldownStatus();
      const tokenStatus = cooldownStatus.get(token.symbol);
      const inCooldown = tokenStatus?.inCooldown || false;
      logger.info(`⏰ ${token.symbol} in cooldown: ${inCooldown}`);
    }
    
    // Test retry counts
    const tokenRetryCounts = quoteManager.getRetryCounts();
    for (const token of tokens) {
      const retryCount = tokenRetryCounts.get(token.symbol) || 0;
      logger.info(`🔄 ${token.symbol} retry count: ${retryCount}`);
    }
    
    logger.info('✅ Quote manager test completed successfully!');
    return true;
    
  } catch (error) {
    logger.error('❌ Quote manager test failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testQuoteManager().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { testQuoteManager };
