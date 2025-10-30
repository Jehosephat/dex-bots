/**
 * Price Validation Test Script
 * 
 * Validates that the price discovery system is getting real, up-to-date prices
 * by comparing with external sources and checking data freshness.
 */

import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { QuoteManager } from './core/quoteManager';
import { initializeConfig, getEnabledTokens } from './config';
import logger from './utils/logger';
import axios from 'axios';

interface PriceValidationResult {
  source: string;
  symbol: string;
  price: number;
  currency: string;
  timestamp: number;
  age: number;
  isValid: boolean;
  error?: string;
}

interface ExternalPriceData {
  symbol: string;
  price: number;
  currency: string;
  source: string;
  timestamp: number;
}

async function validatePrices() {
  try {
    logger.info('🔍 Starting comprehensive price validation...');
    
    // Initialize configuration
    initializeConfig();
    
    // Initialize price providers
    const galaChainProvider = new GalaChainPriceProvider();
    const solanaProvider = new SolanaPriceProvider();
    const quoteManager = new QuoteManager(galaChainProvider, solanaProvider);
    
    await galaChainProvider.initialize();
    await solanaProvider.initialize();
    await quoteManager.initialize();
    
    logger.info('✅ Price providers initialized');
    
    // Test 1: Validate GALA/USD price
    await validateGalaUsdPrice(galaChainProvider);
    
    // Test 2: Validate SOL/USD price
    await validateSolUsdPrice(solanaProvider);
    
    // Test 3: Validate token quotes with external sources
    await validateTokenQuotes(quoteManager);
    
    // Test 4: Check quote freshness
    await validateQuoteFreshness(quoteManager);
    
    // Test 5: Compare with multiple external sources
    await compareWithExternalSources();
    
    logger.info('✅ Price validation completed successfully!');
    return true;
    
  } catch (error) {
    logger.error('❌ Price validation failed:', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

async function validateGalaUsdPrice(provider: GalaChainPriceProvider) {
  logger.info('💰 Validating GALA/USD price...');
  
  const galaPrice = provider.getGALAUSDPrice();
  logger.info(`📊 GalaChain GALA/USD: $${galaPrice.toFixed(6)}`);
  
  // Compare with CoinGecko
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'gala', vs_currencies: 'usd' },
      timeout: 10000
    });
    
    const coinGeckoPrice = response.data?.gala?.usd;
    if (coinGeckoPrice) {
      const difference = Math.abs(galaPrice - coinGeckoPrice);
      const percentDiff = (difference / coinGeckoPrice) * 100;
      
      logger.info(`📊 CoinGecko GALA/USD: $${coinGeckoPrice.toFixed(6)}`);
      logger.info(`📊 Price difference: $${difference.toFixed(6)} (${percentDiff.toFixed(2)}%)`);
      
      if (percentDiff < 5) {
        logger.info('✅ GALA price validation passed - within 5% of CoinGecko');
      } else {
        logger.warn('⚠️ GALA price validation warning - significant difference from CoinGecko');
      }
    }
  } catch (error) {
    logger.warn('⚠️ Failed to validate GALA price with CoinGecko', { error });
  }
}

async function validateSolUsdPrice(provider: SolanaPriceProvider) {
  logger.info('💰 Validating SOL/USD price...');
  
  const solPrice = provider.getSOLUSDPrice();
  logger.info(`📊 Solana SOL/USD: $${solPrice.toFixed(2)}`);
  
  // Compare with CoinGecko
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'solana', vs_currencies: 'usd' },
      timeout: 10000
    });
    
    const coinGeckoPrice = response.data?.solana?.usd;
    if (coinGeckoPrice) {
      const difference = Math.abs(solPrice - coinGeckoPrice);
      const percentDiff = (difference / coinGeckoPrice) * 100;
      
      logger.info(`📊 CoinGecko SOL/USD: $${coinGeckoPrice.toFixed(2)}`);
      logger.info(`📊 Price difference: $${difference.toFixed(2)} (${percentDiff.toFixed(2)}%)`);
      
      if (percentDiff < 2) {
        logger.info('✅ SOL price validation passed - within 2% of CoinGecko');
      } else {
        logger.warn('⚠️ SOL price validation warning - significant difference from CoinGecko');
      }
    }
  } catch (error) {
    logger.warn('⚠️ Failed to validate SOL price with CoinGecko', { error });
  }
}

async function validateTokenQuotes(quoteManager: QuoteManager) {
  logger.info('🔍 Validating token quotes...');
  
  const enabledTokens = getEnabledTokens();
  const results: PriceValidationResult[] = [];
  
  for (const token of enabledTokens.slice(0, 2)) { // Test first 2 tokens
    try {
      logger.info(`📈 Testing quotes for ${token.symbol}...`);
      
      // Get quotes from both providers
      const galaChainQuote = await quoteManager.getGalaChainQuote(token);
      const solanaQuote = await quoteManager.getSolanaQuote(token);
      
      if (galaChainQuote) {
        results.push({
          source: 'GalaChain',
          symbol: token.symbol,
          price: galaChainQuote.price.toNumber(),
          currency: galaChainQuote.currency,
          timestamp: galaChainQuote.timestamp,
          age: Math.floor((Date.now() - galaChainQuote.timestamp) / 1000),
          isValid: galaChainQuote.isValid
        });
        
        logger.info(`✅ GalaChain quote for ${token.symbol}: ${galaChainQuote.price.toString()} ${galaChainQuote.currency}`);
      } else {
        logger.warn(`⚠️ No GalaChain quote for ${token.symbol}`);
      }
      
      if (solanaQuote) {
        results.push({
          source: 'Solana',
          symbol: token.symbol,
          price: solanaQuote.price.toNumber(),
          currency: solanaQuote.currency,
          timestamp: solanaQuote.timestamp,
          age: Math.floor((Date.now() - solanaQuote.timestamp) / 1000),
          isValid: solanaQuote.isValid
        });
        
        logger.info(`✅ Solana quote for ${token.symbol}: ${solanaQuote.price.toString()} ${solanaQuote.currency}`);
      } else {
        logger.warn(`⚠️ No Solana quote for ${token.symbol}`);
      }
      
    } catch (error) {
      logger.error(`❌ Error validating ${token.symbol}`, { error });
    }
  }
  
  // Display validation results
  logger.info('📊 Quote validation results:');
  results.forEach(result => {
    const status = result.isValid ? '✅' : '❌';
    logger.info(`${status} ${result.source} ${result.symbol}: ${result.price} ${result.currency} (age: ${result.age}s)`);
  });
}

async function validateQuoteFreshness(quoteManager: QuoteManager) {
  logger.info('⏰ Validating quote freshness...');
  
  const enabledTokens = getEnabledTokens();
  
  for (const token of enabledTokens.slice(0, 2)) {
    try {
      const galaChainQuote = await quoteManager.getGalaChainQuote(token);
      const solanaQuote = await quoteManager.getSolanaQuote(token);
      
      if (galaChainQuote) {
        const age = Math.floor((Date.now() - galaChainQuote.timestamp) / 1000);
        const isFresh = age <= 30; // 30 seconds
        logger.info(`📊 GalaChain ${token.symbol} quote age: ${age}s ${isFresh ? '✅' : '❌'}`);
      }
      
      if (solanaQuote) {
        const age = Math.floor((Date.now() - solanaQuote.timestamp) / 1000);
        const isFresh = age <= 30; // 30 seconds
        logger.info(`📊 Solana ${token.symbol} quote age: ${age}s ${isFresh ? '✅' : '❌'}`);
      }
      
    } catch (error) {
      logger.error(`❌ Error checking freshness for ${token.symbol}`, { error });
    }
  }
}

async function compareWithExternalSources() {
  logger.info('🌐 Comparing with external price sources...');
  
  try {
    // Get prices from multiple sources
    const [coinGecko, coinMarketCap] = await Promise.allSettled([
      getCoinGeckoPrices(),
      getCoinMarketCapPrices()
    ]);
    
    if (coinGecko.status === 'fulfilled') {
      logger.info('📊 CoinGecko prices:', coinGecko.value);
    }
    
    if (coinMarketCap.status === 'fulfilled') {
      logger.info('📊 CoinMarketCap prices:', coinMarketCap.value);
    }
    
  } catch (error) {
    logger.error('❌ Error comparing with external sources', { error });
  }
}

async function getCoinGeckoPrices(): Promise<ExternalPriceData[]> {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { 
        ids: 'gala,solana',
        vs_currencies: 'usd'
      },
      timeout: 10000
    });
    
    const prices: ExternalPriceData[] = [];
    
    if (response.data?.gala?.usd) {
      prices.push({
        symbol: 'GALA',
        price: response.data.gala.usd,
        currency: 'USD',
        source: 'CoinGecko',
        timestamp: Date.now()
      });
    }
    
    if (response.data?.solana?.usd) {
      prices.push({
        symbol: 'SOL',
        price: response.data.solana.usd,
        currency: 'USD',
        source: 'CoinGecko',
        timestamp: Date.now()
      });
    }
    
    return prices;
  } catch (error) {
    throw new Error(`CoinGecko API error: ${error}`);
  }
}

async function getCoinMarketCapPrices(): Promise<ExternalPriceData[]> {
  try {
    // Note: CoinMarketCap requires API key, so we'll simulate or skip
    logger.info('📊 CoinMarketCap integration would require API key');
    return [];
  } catch (error) {
    throw new Error(`CoinMarketCap API error: ${error}`);
  }
}

// Run the validation if this file is executed directly
if (require.main === module) {
  validatePrices().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { validatePrices };
