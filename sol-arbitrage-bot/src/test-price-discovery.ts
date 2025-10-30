/**
 * Price Discovery Test Script
 * 
 * Tests the price discovery and quoting system.
 */

import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { QuoteManager } from './core/quoteManager';
import { initializeConfig, getEnabledTokens } from './config';
import logger from './utils/logger';

async function testPriceDiscovery() {
  try {
    logger.info('🧪 Testing price discovery system...');
    
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
    
    // Test individual quotes
    logger.info('🔍 Testing individual quotes...');
    const enabledTokens = getEnabledTokens();
    
    for (const token of enabledTokens.slice(0, 2)) { // Test first 2 tokens
      logger.info(`📈 Testing quotes for ${token.symbol}...`);
      
      try {
        const galaChainQuote = await galaChainProvider.getQuote(token.symbol, token.tradeSize);
        if (galaChainQuote) {
          logger.info(`✅ GalaChain quote for ${token.symbol}:`, {
            price: galaChainQuote.price.toString(),
            currency: galaChainQuote.currency,
            priceImpactBps: galaChainQuote.priceImpactBps,
            provider: galaChainQuote.provider
          });
        } else {
          logger.warn(`⚠️ No GalaChain quote for ${token.symbol}`);
        }
        
        const solanaQuote = await solanaProvider.getQuote(token.symbol, token.tradeSize);
        if (solanaQuote) {
          logger.info(`✅ Solana quote for ${token.symbol}:`, {
            price: solanaQuote.price.toString(),
            currency: solanaQuote.currency,
            priceImpactBps: solanaQuote.priceImpactBps,
            provider: solanaQuote.provider
          });
        } else {
          logger.warn(`⚠️ No Solana quote for ${token.symbol}`);
        }
        
      } catch (error) {
        logger.error(`❌ Error testing ${token.symbol}`, { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    // Test quote manager
    logger.info('🎯 Testing quote manager...');
    const quoteManager = new QuoteManager(galaChainProvider, solanaProvider);
    await quoteManager.initialize();
    
    // Discover opportunities
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
    
    // Test cooldown status
    logger.info('⏰ Testing cooldown status...');
    const cooldownStatus = quoteManager.getCooldownStatus();
    const retryCounts = quoteManager.getRetryCounts();
    
    logger.info('📊 Cooldown status:', Object.fromEntries(cooldownStatus));
    logger.info('📊 Retry counts:', Object.fromEntries(retryCounts));
    
    logger.info('✅ Price discovery test completed successfully!');
    return true;
    
  } catch (error) {
    logger.error('❌ Price discovery test failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testPriceDiscovery().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { testPriceDiscovery };
