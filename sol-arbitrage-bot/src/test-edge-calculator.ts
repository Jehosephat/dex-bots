/**
 * Edge Calculator Test Script
 * 
 * Tests the edge calculation functionality with real and simulated data.
 */

import { EdgeCalculator } from './core/edgeCalculator';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { QuoteManager } from './core/quoteManager';
import { initializeConfig, getEnabledTokens } from './config';
import { GalaChainQuote, SolanaQuote } from './types/core';
import { TokenConfig } from './types/config';
import logger from './utils/logger';
import BigNumber from 'bignumber.js';

async function testEdgeCalculator() {
  try {
    logger.info('🧮 Testing Edge Calculator...');
    
    // Initialize configuration
    initializeConfig();
    
    // Initialize price providers
    const galaChainProvider = new GalaChainPriceProvider();
    const solanaProvider = new SolanaPriceProvider();
    const quoteManager = new QuoteManager(galaChainProvider, solanaProvider);
    
    await galaChainProvider.initialize();
    await solanaProvider.initialize();
    await quoteManager.initialize();
    
    // Initialize edge calculator
    const edgeCalculator = new EdgeCalculator();
    
    logger.info('✅ All components initialized');
    
    // Test 1: Calculate SOL to GALA rate
    await testSolToGalaRate(edgeCalculator, galaChainProvider, solanaProvider);
    
    // Test 2: Test with real quotes (if available)
    await testWithRealQuotes(edgeCalculator, quoteManager);
    
    // Test 3: Test with simulated data
    await testWithSimulatedData(edgeCalculator);
    
    // Test 4: Test edge calculation scenarios
    await testEdgeScenarios(edgeCalculator);
    
    logger.info('✅ Edge calculator test completed successfully!');
    return true;
    
  } catch (error) {
    logger.error('❌ Edge calculator test failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

async function testSolToGalaRate(
  edgeCalculator: EdgeCalculator,
  galaChainProvider: GalaChainPriceProvider,
  solanaProvider: SolanaPriceProvider
) {
  logger.info('💱 Testing SOL to GALA rate calculation...');
  
  const galaUsdPrice = galaChainProvider.getGALAUSDPrice();
  const solUsdPrice = solanaProvider.getSOLUSDPrice();
  
  logger.info(`📊 GALA/USD: $${galaUsdPrice.toFixed(6)}`);
  logger.info(`📊 SOL/USD: $${solUsdPrice.toFixed(2)}`);
  
  const solToGalaRate = await edgeCalculator.calculateSolToGalaRate(galaUsdPrice, solUsdPrice);
  
  logger.info(`💱 SOL to GALA rate: 1 SOL = ${solToGalaRate.toFixed(2)} GALA`);
  
  // Verify the calculation
  const expectedRate = solUsdPrice / galaUsdPrice;
  const difference = Math.abs(solToGalaRate.toNumber() - expectedRate);
  const percentDiff = (difference / expectedRate) * 100;
  
  if (percentDiff < 0.01) {
    logger.info('✅ SOL to GALA rate calculation is accurate');
  } else {
    logger.warn(`⚠️ SOL to GALA rate calculation has ${percentDiff.toFixed(4)}% difference`);
  }
}

async function testWithRealQuotes(
  edgeCalculator: EdgeCalculator,
  quoteManager: QuoteManager
) {
  logger.info('🔍 Testing with real quotes...');
  
  const enabledTokens = getEnabledTokens();
  
  for (const token of enabledTokens.slice(0, 2)) { // Test first 2 tokens
    try {
      logger.info(`📈 Testing edge calculation for ${token.symbol}...`);
      
      // Get quotes
      const galaChainQuote = await quoteManager.getGalaChainQuote(token);
      const solanaQuote = await quoteManager.getSolanaQuote(token);
      
      if (!galaChainQuote || !solanaQuote) {
        logger.warn(`⚠️ Missing quotes for ${token.symbol}, skipping...`);
        continue;
      }
      
      // Calculate SOL to GALA rate
      const galaUsdPrice = 0.010804; // Use current price
      const solUsdPrice = 193.73; // Use current price
      const solToGalaRate = await edgeCalculator.calculateSolToGalaRate(galaUsdPrice, solUsdPrice);
      
      // Calculate edge
      const edgeResult = edgeCalculator.calculateEdge(
        token,
        galaChainQuote as GalaChainQuote,
        solanaQuote as SolanaQuote,
        solToGalaRate
      );
      
      // Display results
      logger.info(`📊 Edge calculation for ${token.symbol}:`);
      logger.info(`   💰 GALA proceeds: ${edgeResult.galaChainProceeds.toFixed(6)} GALA`);
      logger.info(`   💰 SOL cost: ${edgeResult.solanaCostGala.toFixed(6)} GALA`);
      logger.info(`   🌉 Bridge cost: ${edgeResult.bridgeCost.toFixed(6)} GALA`);
      logger.info(`   ⚠️ Risk buffer: ${edgeResult.riskBuffer.toFixed(6)} GALA`);
      logger.info(`   📈 Net edge: ${edgeResult.netEdge.toFixed(6)} GALA (${edgeResult.netEdgeBps}bps)`);
      logger.info(`   ✅ Profitable: ${edgeResult.isProfitable ? 'YES' : 'NO'}`);
      
      if (edgeResult.invalidationReasons.length > 0) {
        logger.info(`   ❌ Reasons: ${edgeResult.invalidationReasons.join(', ')}`);
      }
      
      // Create arbitrage opportunity if profitable
      if (edgeResult.isProfitable) {
        const opportunity = edgeCalculator.createArbitrageOpportunity(
          token,
          galaChainQuote as GalaChainQuote,
          solanaQuote as SolanaQuote,
          edgeResult
        );
        
        if (opportunity) {
          logger.info(`   🎯 Arbitrage opportunity created: ${opportunity.id}`);
        }
      }
      
    } catch (error) {
      logger.error(`❌ Error testing ${token.symbol}`, { error });
    }
  }
}

async function testWithSimulatedData(edgeCalculator: EdgeCalculator) {
  logger.info('🎭 Testing with simulated data...');
  
  // Create simulated quotes
  const simulatedGalaChainQuote: GalaChainQuote = {
    symbol: 'TEST',
    price: new BigNumber(0.001), // 0.001 GALA per token
    currency: 'GALA',
    tradeSize: 1000,
    priceImpactBps: 5,
    minOutput: new BigNumber(0.99),
    provider: 'galachain',
    timestamp: Date.now(),
    expiresAt: Date.now() + 30000,
    isValid: true,
    galaFee: new BigNumber(1.1),
    feeTier: 1
  };
  
  const simulatedSolanaQuote: SolanaQuote = {
    symbol: 'TEST',
    price: new BigNumber(0.0008), // 0.0008 SOL per token
    currency: 'SOL',
    tradeSize: 1000,
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
  
  const simulatedTokenConfig: TokenConfig = {
    symbol: 'TEST',
    galaChainMint: 'test-gc-mint',
    solanaMint: 'test-sol-mint',
    solanaSymbol: 'TEST',
    decimals: 6,
    tradeSize: 1000,
    enabled: true,
    gcQuoteVia: 'GALA',
    solQuoteVia: 'USDC'
  };
  
  const solToGalaRate = new BigNumber(20000); // 1 SOL = 20,000 GALA
  
  // Calculate edge
  const edgeResult = edgeCalculator.calculateEdge(
    simulatedTokenConfig,
    simulatedGalaChainQuote,
    simulatedSolanaQuote,
    solToGalaRate
  );
  
  logger.info('📊 Simulated edge calculation:');
  logger.info(`   💰 GALA proceeds: ${edgeResult.galaChainProceeds.toFixed(6)} GALA`);
  logger.info(`   💰 SOL cost: ${edgeResult.solanaCostGala.toFixed(6)} GALA`);
  logger.info(`   🌉 Bridge cost: ${edgeResult.bridgeCost.toFixed(6)} GALA`);
  logger.info(`   ⚠️ Risk buffer: ${edgeResult.riskBuffer.toFixed(6)} GALA`);
  logger.info(`   📈 Net edge: ${edgeResult.netEdge.toFixed(6)} GALA (${edgeResult.netEdgeBps}bps)`);
  logger.info(`   ✅ Profitable: ${edgeResult.isProfitable ? 'YES' : 'NO'}`);
  logger.info(`   📊 Price impact acceptable: ${edgeResult.priceImpactAcceptable ? 'YES' : 'NO'}`);
  
  if (edgeResult.invalidationReasons.length > 0) {
    logger.info(`   ❌ Reasons: ${edgeResult.invalidationReasons.join(', ')}`);
  }
}

async function testEdgeScenarios(edgeCalculator: EdgeCalculator) {
  logger.info('🎯 Testing different edge scenarios...');
  
  const scenarios = [
    {
      name: 'Highly Profitable',
      galaPrice: 0.002, // High GalaChain price
      solPrice: 0.001,  // Low Solana price
      expectedProfitable: true
    },
    {
      name: 'Unprofitable',
      galaPrice: 0.001, // Low GalaChain price
      solPrice: 0.002,  // High Solana price
      expectedProfitable: false
    },
    {
      name: 'Break Even',
      galaPrice: 0.0015,
      solPrice: 0.0015,
      expectedProfitable: false
    }
  ];
  
  const solToGalaRate = new BigNumber(20000); // 1 SOL = 20,000 GALA
  
  for (const scenario of scenarios) {
    logger.info(`📊 Testing scenario: ${scenario.name}`);
    
    const simulatedGalaChainQuote: GalaChainQuote = {
      symbol: 'TEST',
      price: new BigNumber(scenario.galaPrice),
      currency: 'GALA',
      tradeSize: 1000,
      priceImpactBps: 5,
      minOutput: new BigNumber(0.99),
      provider: 'galachain',
      timestamp: Date.now(),
      expiresAt: Date.now() + 30000,
      isValid: true,
      galaFee: new BigNumber(1.1),
      feeTier: 1
    };
    
    const simulatedSolanaQuote: SolanaQuote = {
      symbol: 'TEST',
      price: new BigNumber(scenario.solPrice),
      currency: 'SOL',
      tradeSize: 1000,
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
    
    const simulatedTokenConfig: TokenConfig = {
      symbol: 'TEST',
      galaChainMint: 'test-gc-mint',
      solanaMint: 'test-sol-mint',
      solanaSymbol: 'TEST',
      decimals: 6,
      tradeSize: 1000,
      enabled: true,
      gcQuoteVia: 'GALA',
      solQuoteVia: 'USDC'
    };
    
    const edgeResult = edgeCalculator.calculateEdge(
      simulatedTokenConfig,
      simulatedGalaChainQuote,
      simulatedSolanaQuote,
      solToGalaRate
    );
    
    const isCorrect = edgeResult.isProfitable === scenario.expectedProfitable;
    const status = isCorrect ? '✅' : '❌';
    
    logger.info(`   ${status} Expected: ${scenario.expectedProfitable}, Got: ${edgeResult.isProfitable}`);
    logger.info(`   📈 Net edge: ${edgeResult.netEdge.toFixed(6)} GALA (${edgeResult.netEdgeBps}bps)`);
    
    if (!isCorrect) {
      logger.warn(`   ⚠️ Scenario ${scenario.name} did not match expected result`);
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testEdgeCalculator().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { testEdgeCalculator };
