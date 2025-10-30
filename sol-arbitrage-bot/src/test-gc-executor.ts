import { initializeConfig, getTokenConfig } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { GalaChainExecutor } from './execution/galaChainExecutor';
import logger from './utils/logger';
import { GalaChainQuote } from './types/core';

async function testGcExecutor() {
  try {
    logger.info('🧪 Testing GalaChain Executor (dry-run)...');

    initializeConfig();

    const symbol = 'SOL';
    const token = getTokenConfig(symbol);
    if (!token) {
      logger.error('❌ Token not configured', { symbol });
      return false;
    }

    const provider = new GalaChainPriceProvider();
    await provider.initialize();

    const genericQuote = await provider.getQuote(symbol, token.tradeSize);
    if (!genericQuote || genericQuote.currency !== 'GALA') {
      logger.warn('⚠️ No GalaChain quote available', { symbol });
      return false;
    }

    const quote = genericQuote as GalaChainQuote;

    const executor = new GalaChainExecutor();
    const result = executor.dryRunFromQuote(symbol, token.tradeSize, quote);

    if (!result.success) {
      logger.error('❌ Dry-run executor failed', { error: result.error });
      return false;
    }

    logger.info('✅ Dry-run params built', {
      symbol,
      tradeSize: result.params.tradeSize,
      expectedProceedsGala: result.params.expectedProceedsGala.toString(),
      minProceedsGala: result.params.minProceedsGala.toString(),
      feeTier: result.params.feeTier,
      deadlineMs: result.params.deadlineMs
    });

    return true;
  } catch (error) {
    logger.error('❌ GC executor test error', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

if (require.main === module) {
  testGcExecutor().then(ok => process.exit(ok ? 0 : 1));
}

export { testGcExecutor };
