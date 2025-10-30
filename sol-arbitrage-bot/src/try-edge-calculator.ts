/**
 * Interactive Edge Calculator Test
 * 
 * Simple script to try the edge calculator with custom inputs.
 */

import { EdgeCalculator } from './core/edgeCalculator';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { initializeConfig } from './config';
import { GalaChainQuote, SolanaQuote } from './types/core';
import { TokenConfig } from './types/config';
import logger from './utils/logger';
import BigNumber from 'bignumber.js';

async function tryEdgeCalculator() {
  try {
    logger.info('🧮 Interactive Edge Calculator Test');
    logger.info('=====================================');
    
    // Initialize configuration
    initializeConfig();
    
    // Initialize price providers
    const galaChainProvider = new GalaChainPriceProvider();
    const solanaProvider = new SolanaPriceProvider();
    
    await galaChainProvider.initialize();
    await solanaProvider.initialize();
    
    // Initialize edge calculator
    const edgeCalculator = new EdgeCalculator();
    
    logger.info('✅ All components initialized');
    
    // Get current prices
    const galaUsdPrice = galaChainProvider.getGALAUSDPrice();
    const solUsdPrice = solanaProvider.getSOLUSDPrice();
    const solToGalaRate = await edgeCalculator.calculateSolToGalaRate(galaUsdPrice, solUsdPrice);
    
    logger.info(`💰 Current Prices:`);
    logger.info(`   GALA/USD: $${galaUsdPrice.toFixed(6)}`);
    logger.info(`   SOL/USD: $${solUsdPrice.toFixed(2)}`);
    logger.info(`   SOL to GALA rate: 1 SOL = ${solToGalaRate.toFixed(2)} GALA`);
    logger.info('');
    
    // Test scenarios
    const scenarios = [
      {
        name: 'Scenario 1: High GalaChain Price, Low Solana Price',
        galaPrice: 0.002, // 0.002 GALA per token
        solPrice: 0.001,  // 0.001 SOL per token
        tradeSize: 1000
      },
      {
        name: 'Scenario 2: Low GalaChain Price, High Solana Price',
        galaPrice: 0.001, // 0.001 GALA per token
        solPrice: 0.002,  // 0.002 SOL per token
        tradeSize: 1000
      },
      {
        name: 'Scenario 3: Equal Prices (Break Even)',
        galaPrice: 0.0015, // 0.0015 GALA per token
        solPrice: 0.0015,  // 0.0015 SOL per token
        tradeSize: 1000
      },
      {
        name: 'Scenario 4: Small Trade Size',
        galaPrice: 0.002, // 0.002 GALA per token
        solPrice: 0.001,  // 0.001 SOL per token
        tradeSize: 100
      },
       {
         name: 'Scenario 5: Large Trade Size',
         galaPrice: 0.002, // 0.002 GALA per token
         solPrice: 0.001,  // 0.001 SOL per token
         tradeSize: 10000
       },
       {
         name: 'Scenario 6: Profitable Arbitrage',
         galaPrice: 0.250, // 0.250 GALA per token (very high GalaChain price)
         solPrice: 0.00001, // 0.00001 SOL per token (extremely low Solana price)
         tradeSize: 1000
       },
       {
         name: 'Scenario 7: USD-ish',
         galaPrice: 98, // GALA per token
         solPrice: 0.00514, // SOL per token
         tradeSize: 1000
       }
    ];
    
    for (const scenario of scenarios) {
      logger.info(`📊 ${scenario.name}`);
      logger.info('─'.repeat(50));
      
      // Create simulated quotes
      const galaChainQuote: GalaChainQuote = {
        symbol: 'TEST',
        price: new BigNumber(scenario.galaPrice),
        currency: 'GALA',
        tradeSize: scenario.tradeSize,
        priceImpactBps: 5,
        minOutput: new BigNumber(0.99),
        provider: 'galachain',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000,
        isValid: true,
        galaFee: new BigNumber(1.1),
        feeTier: 1
      };
      
      const solanaQuote: SolanaQuote = {
        symbol: 'TEST',
        price: new BigNumber(scenario.solPrice),
        currency: 'SOL',
        tradeSize: scenario.tradeSize,
        priceImpactBps: 3,
        minOutput: new BigNumber(0.99),
        provider: 'solana',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000,
        isValid: true,
        priorityFee: new BigNumber(0.000005),
        jupiterRoute: { 
          routeId: 'test-route',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'test-mint',
          steps: [],
          totalPriceImpact: 0,
          totalFee: 0
        }
      };
      
      const tokenConfig: TokenConfig = {
        symbol: 'TEST',
        galaChainMint: 'test-gc-mint',
        solanaMint: 'test-sol-mint',
        solanaSymbol: 'TEST',
        decimals: 6,
        tradeSize: scenario.tradeSize,
        enabled: true,
        gcQuoteVia: 'GALA'
      };
      
      // Calculate edge
      const edgeResult = edgeCalculator.calculateEdge(
        tokenConfig,
        galaChainQuote,
        solanaQuote,
        solToGalaRate
      );
      
      // Display results
      logger.info(`   💰 GALA proceeds: ${edgeResult.galaChainProceeds.toFixed(6)} GALA`);
      logger.info(`   💰 SOL cost: ${edgeResult.solanaCostGala.toFixed(6)} GALA`);
      logger.info(`   🌉 Bridge cost: ${edgeResult.bridgeCost.toFixed(6)} GALA`);
      logger.info(`   ⚠️ Risk buffer: ${edgeResult.riskBuffer.toFixed(6)} GALA`);
      logger.info(`   📈 Net edge: ${edgeResult.netEdge.toFixed(6)} GALA (${edgeResult.netEdgeBps.toFixed(2)}bps)`);
      logger.info(`   ✅ Profitable: ${edgeResult.isProfitable ? 'YES' : 'NO'}`);
      logger.info(`   📊 Price impact acceptable: ${edgeResult.priceImpactAcceptable ? 'YES' : 'NO'}`);
      
      if (edgeResult.invalidationReasons.length > 0) {
        logger.info(`   ❌ Reasons: ${edgeResult.invalidationReasons.join(', ')}`);
      }
      
      // Create arbitrage opportunity if profitable
      if (edgeResult.isProfitable) {
        const opportunity = edgeCalculator.createArbitrageOpportunity(
          tokenConfig,
          galaChainQuote,
          solanaQuote,
          edgeResult
        );
        
        if (opportunity) {
          logger.info(`   🎯 Arbitrage opportunity: ${opportunity.id}`);
        }
      }
      
      logger.info('');
    }
    
    // Test with custom inputs
    logger.info('🎯 Try Your Own Scenario');
    logger.info('─'.repeat(50));
    logger.info('You can modify the script to test different scenarios:');
    logger.info('1. Change galaPrice (GALA per token)');
    logger.info('2. Change solPrice (SOL per token)');
    logger.info('3. Change tradeSize (number of tokens)');
    logger.info('');
    logger.info('Example:');
    logger.info('   galaPrice: 0.003  // 0.003 GALA per token');
    logger.info('   solPrice: 0.001   // 0.001 SOL per token');
    logger.info('   tradeSize: 5000   // 5000 tokens');
    logger.info('');
    
    logger.info('✅ Edge calculator test completed!');
    return true;
    
  } catch (error) {
    logger.error('❌ Edge calculator test failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  tryEdgeCalculator().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { tryEdgeCalculator };
