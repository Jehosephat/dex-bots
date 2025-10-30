import 'dotenv/config';
import { initializeConfig } from './config';
import logger from './utils/logger';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { SolanaExecutor } from './execution/solanaExecutor';

async function main() {
  initializeConfig();

  const symbol = (process.env.TEST_SYMBOL || 'SOL').toUpperCase();
  const tradeSize = Number(process.env.TEST_TRADE_SIZE || '0.001');

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const hasKey = !!process.env.SOLANA_PRIVATE_KEY;
  if (!hasKey) {
    logger.error('Missing SOLANA_PRIVATE_KEY');
    process.exit(1);
    return;
  }

  logger.info('🧪 Running Solana live executor test', { symbol, tradeSize, rpcUrl });

  const provider = new SolanaPriceProvider();
  await provider.initialize();
  const quote = await provider.getQuote(symbol, tradeSize) as any; // cast for test

  if (!quote) {
    logger.error('❌ Failed to obtain Solana quote');
    process.exit(1);
    return;
  }

  const exec = new SolanaExecutor();
  const result = await exec.executeFromQuoteLive(symbol, tradeSize, quote);

  if (!result.success) {
    logger.error('❌ Live Solana swap failed', { error: result.error });
    process.exit(1);
    return;
  }

  logger.info('✅ Live Solana swap succeeded', {
    symbol,
    tradeSize,
    signature: result.txSig,
    explorer: result.txSig ? `https://solscan.io/tx/${result.txSig}` : undefined
  });
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ test-sol-exec-live crashed', err);
    process.exit(1);
  });
}


