/**
 * Test Script: Price Discovery
 * Tests price fetching from GalaChain and Solana
 */

import { PriceDiscovery } from './core/priceDiscovery';
import { logger } from './utils/logger';
import { config } from './utils/config';

async function testPriceDiscovery() {
  console.log('\n=== Testing Price Discovery ===\n');

  try {
    const priceDiscovery = new PriceDiscovery();
    const tokens = config.getEnabledTokens();

    console.log('📊 Fetching prices from GalaChain and Solana...');
    console.log('This may take 10-30 seconds...\n');

    // Discover opportunities (this will fetch prices)
    const opportunities = await priceDiscovery.discoverOpportunities();

    // Get and display base GALA/USD price
    const galaUSDPrice = await priceDiscovery.getGalaUSDPrice();
    console.log('💵 Base Exchange Rate:');
    console.log(`   1 GALA = $${galaUSDPrice.toFixed(6)} USD (via GALA/GUSDC pool)`);
    console.log(`   1 USD = ${(1/galaUSDPrice).toFixed(2)} GALA\n`);

    // Display all prices
    const allPrices = priceDiscovery.getAllPrices();
    
    console.log('🔵 GalaChain Prices:');
    if (allPrices.galaChain.length > 0) {
      allPrices.galaChain.forEach(([symbol, price]) => {
        console.log(`  ${symbol}:`);
        console.log(`    ${price.price.toFixed(6)} GALA per token`);
        console.log(`    $${price.priceUSD.toFixed(6)} USD per token`);
        console.log(`    Last updated: ${new Date(price.timestamp).toLocaleTimeString()}`);
      });
    } else {
      console.log('  ⚠️  No GalaChain prices fetched');
    }

    console.log('\n🟣 Solana Prices (token → SOL):');
    if (allPrices.solana.length > 0) {
      allPrices.solana.forEach(([symbol, price]) => {
        console.log(`  ${symbol}: ${price.price.toFixed(6)} SOL per token`);
        console.log(`    Last updated: ${new Date(price.timestamp).toLocaleTimeString()}`);
      });
    } else {
      console.log('  ⚠️  No Solana prices fetched');
    }

    // Display opportunities
    console.log('\n💰 Arbitrage Opportunities Found:');
    if (opportunities.length > 0) {
      opportunities.forEach((opp, index) => {
        console.log(`\n  ${index + 1}. ${opp.token}`);
        console.log(`     Net Edge: ${(opp.netEdge * 100).toFixed(2)}%`);
        console.log(`     GC Sell Price: ${opp.gcSellPrice.toFixed(6)} GALA`);
        console.log(`     SOL Buy Price: ${opp.solBuyPrice.toFixed(6)} SOL`);
        console.log(`     Bridge Cost: ${opp.bridgeCostGALA.toFixed(2)} GALA`);
        console.log(`     Recommended Size: ${opp.recommendedSize.toFixed(2)} tokens`);
      });
    } else {
      console.log('  No opportunities above minimum edge threshold');
      console.log(`  (Minimum edge: ${config.getBotConfig().trading.minEdgeThreshold * 100}%)`);
    }

    // Check for specific tokens
    console.log('\n🔍 Token-Specific Analysis:');
    tokens.forEach(token => {
      const gcPrice = priceDiscovery.getGalaChainPrice(token.symbol);
      const solPrice = priceDiscovery.getSolanaPrice(token.symbol);
      
      console.log(`\n  ${token.symbol}:`);
      if (gcPrice) {
        console.log(`    ✓ GalaChain price available: ${gcPrice.price.toFixed(6)} GALA ($${gcPrice.priceUSD.toFixed(6)} USD)`);
      } else {
        console.log(`    ✗ GalaChain price not available`);
      }
      
      if (solPrice) {
        console.log(`    ✓ Solana price available: ${solPrice.price.toFixed(6)} SOL`);
      } else {
        console.log(`    ✗ Solana price not available`);
        if (token.solanaMint.includes('ADDRESS_HERE')) {
          console.log(`      (Solana mint address not configured)`);
        }
      }
    });

    console.log('\n✅ Price discovery test completed!\n');
    
    // Return success if we got at least some prices
    const hasGCPrices = allPrices.galaChain.length > 0;
    const hasSolPrices = allPrices.solana.length > 0;
    
    if (hasGCPrices || hasSolPrices) {
      console.log('📊 Summary:');
      console.log(`  GalaChain prices fetched: ${allPrices.galaChain.length}`);
      console.log(`  Solana prices fetched: ${allPrices.solana.length}`);
      console.log(`  Opportunities found: ${opportunities.length}`);
      return true;
    } else {
      console.log('⚠️  Warning: No prices were fetched from either chain');
      console.log('   Check your RPC endpoints and wallet configuration');
      return false;
    }

  } catch (error) {
    console.error('❌ Price discovery test failed:', error);
    logger.error('Price discovery test failed', { error });
    return false;
  }
}

// Run the test
testPriceDiscovery()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });

