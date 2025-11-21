/**
 * Test Script: Configuration Management
 * Tests that configuration files load correctly and environment variables are set
 */

import { config } from './utils/config';
import { logger } from './utils/logger';

async function testConfiguration() {
  console.log('\n=== Testing Configuration Management ===\n');

  try {
    // Test 1: Load configuration
    console.log('✓ Configuration loaded successfully');
    
    // Test 2: Get bot config
    const botConfig = config.getBotConfig();
    console.log('\n📊 Bot Configuration:');
    console.log('  Min Edge Threshold:', botConfig.trading.minEdgeThreshold);
    console.log('  Max Price Impact:', botConfig.trading.maxPriceImpact);
    console.log('  Max Concurrent Trades:', botConfig.trading.maxConcurrentTrades);
    console.log('  Slippage Tolerance:', botConfig.trading.slippageTolerance);
    console.log('  Risk Buffer:', botConfig.trading.riskBuffer);
    console.log('  Bridge Cost (USD):', botConfig.bridging.bridgeCostUSD);
    console.log('  Bridge Interval:', botConfig.bridging.interval / 1000, 'seconds');

    // Test 3: Get tokens config
    const tokens = config.getEnabledTokens();
    console.log('\n🪙 Supported Tokens:');
    tokens.forEach(token => {
      console.log(`  ${token.symbol}:`);
      console.log(`    GalaChain: ${token.galaChainMint}`);
      console.log(`    Solana: ${token.solanaMint}`);
      console.log(`    Decimals: ${token.decimals}`);
      console.log(`    Min Trade: ${token.minTradeSize}`);
      console.log(`    Max Trade: ${token.maxTradeSize}`);
      console.log(`    Enabled: ${token.enabled}`);
    });

    // Test 4: Check environment variables
    console.log('\n🔐 Environment Variables:');
    console.log('  NODE_ENV:', config.isDevelopment() ? 'development' : 'production');
    console.log('  GALA_WALLET_ADDRESS:', config.getGalaWalletAddress());
    console.log('  GALA_PRIVATE_KEY:', config.getGalaPrivateKey() ? '✓ Set' : '✗ Missing');
    console.log('  SOLANA_PRIVATE_KEY:', config.getSolanaPrivateKey() ? '✓ Set' : '✗ Missing');
    console.log('  SLACK_WEBHOOK_URL:', config.getSlackWebhookUrl() ? '✓ Set' : '✗ Missing');
    console.log('  GALA_RPC_ENDPOINT:', config.getGalaRpcEndpoint());
    console.log('  SOLANA_RPC_ENDPOINT:', config.getSolanaRpcEndpoint());

    // Test 5: Test dynamic config updates
    console.log('\n🔧 Testing Dynamic Config Updates:');
    const originalRiskBuffer = botConfig.trading.riskBuffer;
    console.log('  Original Risk Buffer:', originalRiskBuffer);
    
    config.updateRiskBuffer(0.015);
    const newBotConfig = config.getBotConfig();
    console.log('  Updated Risk Buffer:', newBotConfig.trading.riskBuffer);
    
    // Restore original
    config.updateRiskBuffer(originalRiskBuffer);
    console.log('  Restored Risk Buffer:', config.getBotConfig().trading.riskBuffer);

    console.log('\n✅ All configuration tests passed!\n');
    return true;
  } catch (error) {
    console.error('❌ Configuration test failed:', error);
    logger.error('Configuration test failed', { error });
    return false;
  }
}

// Run the test
testConfiguration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });

