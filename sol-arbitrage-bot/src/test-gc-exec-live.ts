import 'dotenv/config';
import { initializeConfig } from './config';
import logger from './utils/logger';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { GalaChainExecutor } from './execution/galaChainExecutor';

async function main() {
  initializeConfig();

  const symbol = (process.env.TEST_GC_SYMBOL || 'SOL').toUpperCase();
  const tradeSize = Number(process.env.TEST_GC_TRADE_SIZE || '0.01');

  const hasPriv = !!process.env.GALACHAIN_PRIVATE_KEY;
  const hasAddr = !!process.env.GALACHAIN_WALLET_ADDRESS;
  if (!hasPriv || !hasAddr) {
    logger.error('Missing GALACHAIN_PRIVATE_KEY or GALACHAIN_WALLET_ADDRESS');
    process.exit(1);
    return;
  }

  logger.info('🧪 Running GalaChain live executor test', { symbol, tradeSize });

  const configService = require('./config').createConfigService();
  const provider = new GalaChainPriceProvider(configService);
  await provider.initialize();
  const quote = await provider.getQuote(symbol, tradeSize) as any; // cast for test
  if (!quote) {
    logger.error('❌ Failed to obtain GalaChain quote');
    process.exit(1);
    return;
  }

  const exec = new GalaChainExecutor();
  const result = await exec.executeFromQuoteLive(symbol, tradeSize, quote);

  if (!result.success) {
    logger.error('❌ Live GalaChain swap failed', { error: result.error });
    process.exit(1);
    return;
  }

  logger.info('✅ Live GalaChain swap succeeded', {
    symbol,
    tradeSize,
    transactionId: result.txHash
  });
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ test-gc-exec-live crashed', err);
    process.exit(1);
  });
}


