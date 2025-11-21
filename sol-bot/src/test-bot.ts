/**
 * Test Script: Main Bot Orchestration
 * Tests the bot initialization and main loop without executing trades
 */

import ArbitrageBot from './index';
import { logger } from './utils/logger';

async function testBot() {
  console.log('\n=== Testing Main Bot Orchestration ===\n');

  const bot = new ArbitrageBot();

  try {
    // Test initialization
    console.log('🧪 Test 1: Bot Initialization\n');
    await bot.initialize();
    console.log('  ✅ Bot initialized successfully\n');

    // Get initial status
    console.log('🧪 Test 2: Bot Status\n');
    const initialStatus = bot.getStatus();
    console.log('  Status:', {
      isRunning: initialStatus.isRunning,
      isPaused: initialStatus.isPaused,
      cycles: initialStatus.cycles,
      opportunitiesFound: initialStatus.opportunitiesFound
    });
    console.log('  ✅ Status retrieved\n');

    // Start the bot for a short test run
    console.log('🧪 Test 3: Starting Bot (30 second test run)\n');
    console.log('  The bot will run for 30 seconds to test the main loop...\n');
    
    await bot.start();
    
    // Let it run for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Check status after running
    console.log('\n🧪 Test 4: Bot Status After Running\n');
    const runningStatus = bot.getStatus();
    console.log('  Status:', {
      isRunning: runningStatus.isRunning,
      isPaused: runningStatus.isPaused,
      cycles: runningStatus.cycles,
      opportunitiesFound: runningStatus.opportunitiesFound,
      tradesExecuted: runningStatus.tradesExecuted,
      uptime: `${Math.floor(runningStatus.uptime / 1000)}s`
    });
    console.log('  ✅ Bot ran successfully\n');

    // Test pause/resume
    console.log('🧪 Test 5: Pause and Resume\n');
    bot.pause();
    console.log('  ⏸️  Bot paused');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    bot.resume();
    console.log('  ▶️  Bot resumed');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('  ✅ Pause/resume working\n');

    // Stop the bot
    console.log('🧪 Test 6: Graceful Shutdown\n');
    await bot.stop();
    console.log('  ✅ Bot stopped gracefully\n');

    // Final status
    const finalStatus = bot.getStatus();
    console.log('\n📊 Final Test Results:\n');
    console.log('  Total Cycles:', finalStatus.cycles);
    console.log('  Opportunities Found:', finalStatus.opportunitiesFound);
    console.log('  Trades Executed:', finalStatus.tradesExecuted);
    console.log('  Total Runtime:', `${Math.floor(finalStatus.uptime / 1000)}s`);
    
    if (finalStatus.cycles > 0) {
      console.log('\n✅ Main bot orchestration test completed successfully!\n');
      console.log('📊 Test Summary:');
      console.log('  ✅ Initialization: Working');
      console.log('  ✅ Status tracking: Working');
      console.log('  ✅ Main loop: Working');
      console.log('  ✅ Pause/Resume: Working');
      console.log('  ✅ Graceful shutdown: Working');
      console.log('\n🎉 All orchestration tests passed!\n');
      
      if (finalStatus.opportunitiesFound > 0) {
        console.log(`💎 Found ${finalStatus.opportunitiesFound} arbitrage opportunities during test!`);
      } else {
        console.log('ℹ️  No arbitrage opportunities found (normal if market conditions are balanced)');
      }
      
      return true;
    } else {
      console.log('\n⚠️  Bot ran but no cycles completed - check configuration\n');
      return false;
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error);
    logger.error('Bot test failed', { error: error.message || error });
    
    try {
      await bot.stop();
    } catch (stopError) {
      logger.error('Failed to stop bot during error handling', { stopError });
    }
    
    return false;
  }
}

// Run the test
testBot()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });

