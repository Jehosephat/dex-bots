import { initializeConfig, getTokenConfig } from './config';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { SolanaExecutor } from './execution/solanaExecutor';
import logger from './utils/logger';
import { SolanaQuote } from './types/core';

async function testSolExecutor() {
  try {
    logger.info('🧪 Testing Solana Executor (dry-run)...');

    initializeConfig();

    const symbol = 'SOL';
    const token = getTokenConfig(symbol);
    if (!token) {
      logger.error('❌ Token not configured', { symbol });
      return false;
    }

    const configService = require('./config').createConfigService();
    const provider = new SolanaPriceProvider(configService);
    await provider.initialize();

    const genericQuote = await provider.getQuote(symbol, token.tradeSize);
    if (!genericQuote) {
      logger.warn('⚠️ No Solana quote available', { symbol });
      return false;
    }

    const quote = genericQuote as SolanaQuote;

    const executor = new SolanaExecutor();
    const result = executor.dryRunFromQuote(symbol, token.tradeSize, quote);

    if (!result.success) {
      logger.error('❌ Solana dry-run executor failed', { error: result.error });
      return false;
    }

    logger.info('✅ Solana dry-run params built', {
      symbol,
      tradeSize: result.params.tradeSize,
      quoteCurrency: result.params.quoteCurrency,
      expectedCostInQuote: result.params.expectedCostInQuote.toString(),
      maxCostInQuote: result.params.maxCostInQuote.toString(),
      deadlineMs: result.params.deadlineMs
    });

    return true;
  } catch (error) {
    logger.error('❌ SOL executor test error', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

if (require.main === module) {
  testSolExecutor().then(ok => process.exit(ok ? 0 : 1));
}

export { testSolExecutor };
