/**
 * Test Script: Live Dry Run
 * Runs the bot in dry run mode to see what it would execute
 */

import ArbitrageBot from './index';
import { logger } from './utils/logger';
import { config } from './utils/config';

async function liveTestDryRun() {
  console.log('\n=== Live Dry Run Test ===\n');
  console.log('This will run the bot in dry run mode for 2 minutes.');
  console.log('It will discover real opportunities and show what it would execute,');
  console.log('but will NOT actually execute any trades.\n');

  const tradingConfig = config.getTradingConfig();
  
  if (!tradingConfig.dryRun) {
    console.log('⚠️  WARNING: config.json has dryRun set to false!');
    console.log('Please set "dryRun": true in config/config.json to run safely.\n');
    process.exit(1);
  }

  console.log('✅ Dry run mode confirmed: dryRun =', tradingConfig.dryRun);
  console.log('Starting bot in 3 seconds...\n');
  
  await new Promise(resolve => setTimeout(resolve, 3000));

  const bot = new ArbitrageBot();

  try {
    // Start the bot
    await bot.start();
    
    console.log('\n✅ Bot started successfully!');
    console.log('📊 Monitoring for arbitrage opportunities...');
    console.log('⏱️  Will run for 2 minutes, then stop automatically.\n');
    
    // Run for 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    console.log('\n⏰ 2 minutes elapsed. Stopping bot...\n');
    
    // Stop the bot
    await bot.stop();
    
    // Get final status
    const status = bot.getStatus();
    
    console.log('\n📊 Dry Run Test Results:\n');
    console.log(`  Runtime: ${Math.floor(status.uptime / 1000)}s`);
    console.log(`  Cycles Completed: ${status.cycles}`);
    console.log(`  Opportunities Found: ${status.opportunitiesFound}`);
    console.log(`  Opportunities That Would Execute: ${status.opportunitiesFound}`);
    console.log(`  Actual Trades Executed: ${status.tradesExecuted} (should be 0 in dry run)`);
    
    if (status.opportunitiesFound > 0) {
      console.log(`\n💎 Found ${status.opportunitiesFound} arbitrage opportunities!`);
      console.log('   Check the output above for detailed execution plans.');
      console.log('   These would be executed if dryRun was set to false.');
    } else {
      console.log('\nℹ️  No arbitrage opportunities found during this test run.');
      console.log('   This is normal if markets are balanced or edges are below threshold.');
    }
    
    console.log('\n✅ Dry run test completed successfully!\n');
    console.log('💡 To enable live trading:');
    console.log('   1. Set "dryRun": false in config/config.json');
    console.log('   2. Ensure wallets are funded');
    console.log('   3. Implement real GalaChain signing');
    console.log('   4. Test with small amounts first!\n');
    
    return true;

  } catch (error: any) {
    console.error('❌ Test failed:', error);
    logger.error('Live dry run test failed', { error: error.message || error });
    
    try {
      await bot.stop();
    } catch (stopError) {
      logger.error('Failed to stop bot during error handling', { stopError });
    }
    
    return false;
  }
}

// Run the test
liveTestDryRun()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });

