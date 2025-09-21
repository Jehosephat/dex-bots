#!/usr/bin/env tsx

/**
 * Configuration Validation Script
 * 
 * Validates both environment variables and wallet configuration
 * to ensure the bot can start properly.
 */

import { ConfigurationManager } from '../src/config/configManager';
import { logger } from '../src/utils/logger';

async function validateConfiguration(): Promise<void> {
  try {
    console.log('🔍 Validating configuration...');
    
    const configManager = ConfigurationManager.getInstance();
    
    // Initialize configuration (this will validate everything)
    await configManager.initialize();
    
    // Get configurations
    const envConfig = configManager.getEnvironmentConfig();
    const walletConfig = configManager.getWalletConfig();
    const enabledWallets = configManager.getEnabledTargetWallets();
    
    // Display configuration summary
    console.log('\n📋 Configuration Summary:');
    console.log('========================');
    
    console.log('\n🔧 Environment Configuration:');
    console.log(`  Node Environment: ${envConfig.nodeEnv}`);
    console.log(`  Debug Mode: ${envConfig.debug}`);
    console.log(`  Log Level: ${envConfig.logLevel}`);
    console.log(`  Log File: ${envConfig.logFile}`);
    console.log(`  Auto Trading: ${envConfig.enableAutoTrading}`);
    console.log(`  Copy Mode: ${envConfig.copyMode}`);
    console.log(`  Max Position Size: ${envConfig.maxPositionSize * 100}%`);
    console.log(`  Execution Delay: ${envConfig.executionDelay}s`);
    console.log(`  Cooldown: ${envConfig.cooldownMinutes}min`);
    console.log(`  Slippage Tolerance: ${envConfig.slippageTolerance * 100}%`);
    console.log(`  Max Daily Trades: ${envConfig.maxDailyTrades}`);
    
    console.log('\n🌐 GalaChain Configuration:');
    console.log(`  RPC URL: ${envConfig.galachainRpcUrl}`);
    console.log(`  WebSocket URL: ${envConfig.galachainWebsocketUrl}`);
    console.log(`  WebSocket Reconnect Delay: ${envConfig.websocketReconnectDelay}ms`);
    console.log(`  WebSocket Max Retries: ${envConfig.websocketMaxRetries}`);
    
    console.log('\n👛 Wallet Configuration:');
    console.log(`  Your Wallet: ${envConfig.walletAddress}`);
    console.log(`  Total Target Wallets: ${walletConfig.targetWallets.length}`);
    console.log(`  Enabled Wallets: ${enabledWallets.length}`);
    console.log(`  Max Total Exposure: ${walletConfig.globalSettings.maxTotalExposure * 100}%`);
    console.log(`  Whitelisted Tokens: ${walletConfig.globalSettings.whitelistedTokens.join(', ')}`);
    console.log(`  Blacklisted Tokens: ${walletConfig.globalSettings.blacklistedTokens.length > 0 ? walletConfig.globalSettings.blacklistedTokens.join(', ') : 'None'}`);
    
    console.log('\n🎯 Target Wallets:');
    enabledWallets.forEach((wallet, index) => {
      console.log(`  ${index + 1}. ${wallet.name} (${wallet.type})`);
      console.log(`     Address: ${wallet.address}`);
      console.log(`     Max Copy: ${wallet.maxCopyAmount}`);
      console.log(`     Priority: ${wallet.priority}`);
    });
    
    console.log('\n✅ Configuration validation completed successfully!');
    console.log('🚀 Bot is ready to start.');
    
  } catch (error) {
    console.error('\n❌ Configuration validation failed:');
    console.error(error);
    process.exit(1);
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateConfiguration();
}
