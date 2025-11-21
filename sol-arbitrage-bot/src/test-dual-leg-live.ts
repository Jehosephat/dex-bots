import 'dotenv/config';
import { initializeConfig, createConfigService } from './config';
import logger from './utils/logger';
import { DualLegCoordinator } from './execution/dualLegCoordinator';

async function main() {
  initializeConfig();
  const symbol = (process.env.TEST_DUAL_SYMBOL || 'SOL').toUpperCase();

  logger.info('🧪 Running Dual-Leg live test', { symbol });
  const configService = createConfigService();
  const coord = new DualLegCoordinator(configService);

  try {
    const { gc, sol } = await coord.executeLive(symbol);
    logger.info('✅ Dual-Leg result', {
      gcSuccess: gc.success,
      gcTx: gc.txHash,
      solSuccess: sol.success,
      solTx: sol.txSig
    });
    if (!gc.success || !sol.success) process.exit(2);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('❌ Dual-Leg live test failed', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Dual-Leg live test crashed', err);
    process.exit(1);
  });
}


