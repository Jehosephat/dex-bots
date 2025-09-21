/**
 * Configuration Manager Tests
 * 
 * Tests for the configuration management system
 */

import { ConfigurationManager } from './configManager';
import fs from 'fs';
import path from 'path';

// Mock environment variables for testing
const mockEnv = {
  PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  WALLET_ADDRESS: 'eth|0x1234567890abcdef1234567890abcdef12345678',
  TARGET_WALLETS: 'eth|0x1234567890abcdef1234567890abcdef12345678,client|test123',
  COPY_MODE: 'proportional',
  MAX_POSITION_SIZE: '0.1',
  EXECUTION_DELAY: '30',
  COOLDOWN_MINUTES: '5',
  SLIPPAGE_TOLERANCE: '0.05',
  ENABLE_AUTO_TRADING: 'false',
  MIN_TRADE_AMOUNT: '10',
  MAX_DAILY_TRADES: '50',
  WEBSOCKET_RECONNECT_DELAY: '5000',
  WEBSOCKET_MAX_RETRIES: '10',
  LOG_LEVEL: 'info',
  LOG_FILE: '/tmp/follow-bot.log',
  GALACHAIN_RPC_URL: 'https://rpc.galachain.io',
  GALACHAIN_WEBSOCKET_URL: 'wss://explorer.galachain.io/ws',
  NODE_ENV: 'test',
  DEBUG: 'false'
};

// Mock wallet configuration
const mockWalletConfig = {
  targetWallets: [
    {
      address: 'eth|0x1234567890abcdef1234567890abcdef12345678',
      name: 'Test Trader 1',
      maxCopyAmount: 1000,
      enabled: true,
      priority: 1,
      type: 'ethereum' as const
    },
    {
      address: 'client|test123',
      name: 'Test Client Trader',
      maxCopyAmount: 500,
      enabled: true,
      priority: 2,
      type: 'client' as const
    }
  ],
  globalSettings: {
    maxTotalExposure: 0.3,
    blacklistedTokens: [],
    whitelistedTokens: ['GALA', 'GWETH', 'GUSDC'],
    defaultMaxCopyAmount: {
      ethereum: 1000,
      client: 500
    },
    copyMode: 'proportional' as const,
    executionDelay: 30,
    cooldownMinutes: 5,
    slippageTolerance: 0.05,
    maxDailyTrades: 50,
    websocketReconnectDelay: 5000,
    websocketMaxRetries: 10
  }
};

async function testConfigurationManager(): Promise<void> {
  console.log('🧪 Testing Configuration Manager...');
  
  try {
    // Set up mock environment
    Object.assign(process.env, mockEnv);
    
    // Create test config file
    const testConfigPath = path.join(process.cwd(), 'config', 'config.test.json');
    fs.writeFileSync(testConfigPath, JSON.stringify(mockWalletConfig, null, 2));
    
    // Test configuration manager
    const configManager = ConfigurationManager.getInstance();
    
    // Test initialization
    console.log('  ✓ Testing initialization...');
    await configManager.initialize();
    
    // Test environment config
    console.log('  ✓ Testing environment configuration...');
    const envConfig = configManager.getEnvironmentConfig();
    console.log(`    Private Key: ${envConfig.privateKey.substring(0, 10)}...`);
    console.log(`    Wallet Address: ${envConfig.walletAddress}`);
    console.log(`    Copy Mode: ${envConfig.copyMode}`);
    console.log(`    Max Position Size: ${envConfig.maxPositionSize}`);
    
    // Test wallet config
    console.log('  ✓ Testing wallet configuration...');
    const walletConfig = configManager.getWalletConfig();
    console.log(`    Total Wallets: ${walletConfig.targetWallets.length}`);
    console.log(`    Max Total Exposure: ${walletConfig.globalSettings.maxTotalExposure}`);
    
    // Test enabled wallets
    console.log('  ✓ Testing enabled wallets...');
    const enabledWallets = configManager.getEnabledTargetWallets();
    console.log(`    Enabled Wallets: ${enabledWallets.length}`);
    enabledWallets.forEach((wallet, index) => {
      console.log(`      ${index + 1}. ${wallet.name} (${wallet.type})`);
    });
    
    // Test backup functionality
    console.log('  ✓ Testing backup functionality...');
    const backupPath = await configManager.backup();
    console.log(`    Backup created: ${backupPath}`);
    
    // Test restore functionality
    console.log('  ✓ Testing restore functionality...');
    await configManager.restore(backupPath);
    console.log('    Configuration restored successfully');
    
    // Clean up test files
    fs.unlinkSync(testConfigPath);
    fs.unlinkSync(backupPath);
    
    console.log('✅ All configuration manager tests passed!');
    
  } catch (error) {
    console.error('❌ Configuration manager test failed:', error);
    throw error;
  }
}

// Test error handling
async function testErrorHandling(): Promise<void> {
  console.log('🧪 Testing error handling...');
  
  try {
    // Test missing required environment variables
    console.log('  ✓ Testing missing environment variables...');
    const originalEnv = { ...process.env };
    delete process.env['PRIVATE_KEY'];
    
    const configManager = ConfigurationManager.getInstance();
    
    try {
      await configManager.initialize();
      console.error('    ❌ Should have thrown error for missing PRIVATE_KEY');
    } catch (error) {
      console.log('    ✓ Correctly caught missing PRIVATE_KEY error');
    }
    
    // Restore environment
    Object.assign(process.env, originalEnv);
    
    // Test invalid private key format
    console.log('  ✓ Testing invalid private key format...');
    process.env['PRIVATE_KEY'] = 'invalid-key';
    
    try {
      await configManager.initialize();
      console.error('    ❌ Should have thrown error for invalid private key');
    } catch (error) {
      console.log('    ✓ Correctly caught invalid private key error');
    }
    
    // Restore environment
    Object.assign(process.env, originalEnv);
    
    console.log('✅ All error handling tests passed!');
    
  } catch (error) {
    console.error('❌ Error handling test failed:', error);
    throw error;
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  (async () => {
    try {
      await testConfigurationManager();
      await testErrorHandling();
      console.log('\n🎉 All configuration tests completed successfully!');
    } catch (error) {
      console.error('\n💥 Configuration tests failed:', error);
      process.exit(1);
    }
  })();
}
