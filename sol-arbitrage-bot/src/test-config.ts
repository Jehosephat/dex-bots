/**
 * Configuration Test Script
 * 
 * Tests the configuration system to ensure it loads and validates correctly.
 */

import { initializeConfig, validateConfig, getConfig, getEnabledTokens, getTokenConfig } from './config';
import logger from './utils/logger';

async function testConfiguration() {
  try {
    logger.info('🧪 Testing configuration system...');
    
    // Initialize configuration
    logger.info('📋 Initializing configuration...');
    const configManager = initializeConfig();
    
    // Validate configuration
    logger.info('✅ Validating configuration...');
    const validation = validateConfig();
    
    if (!validation.isValid) {
      logger.error('❌ Configuration validation failed:', { errors: validation.errors });
      return false;
    }
    
    if (validation.warnings.length > 0) {
      logger.warn('⚠️ Configuration warnings:', { warnings: validation.warnings });
    }
    
    // Test configuration access
    logger.info('🔍 Testing configuration access...');
    const config = getConfig();
    const enabledTokens = getEnabledTokens();
    
    logger.info('📊 Configuration summary:', {
      totalTokens: Object.keys(config.tokens).length,
      enabledTokens: enabledTokens.length,
      enabledTokenSymbols: enabledTokens.map(t => t.symbol),
      tradingConfig: config.trading,
      bridgingConfig: config.bridging,
      monitoringConfig: config.monitoring
    });
    
    // Test individual token access
    logger.info('🎯 Testing individual token access...');
    for (const token of enabledTokens) {
      const tokenConfig = getTokenConfig(token.symbol);
      if (tokenConfig) {
        logger.info(`✅ Token ${token.symbol}:`, {
          enabled: tokenConfig.enabled,
          tradeSize: tokenConfig.tradeSize,
          decimals: tokenConfig.decimals,
          galaChainMint: tokenConfig.galaChainMint,
          solanaMint: tokenConfig.solanaMint
        });
      } else {
        logger.error(`❌ Failed to get config for token ${token.symbol}`);
      }
    }
    
    // Test environment configuration
    logger.info('🌍 Environment configuration:', configManager.getEnvironmentConfig());
    
    logger.info('✅ Configuration test completed successfully!');
    return true;
    
  } catch (error) {
    logger.error('❌ Configuration test failed:', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testConfiguration().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { testConfiguration };
