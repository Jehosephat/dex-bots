import 'dotenv/config';
import logger from './utils/logger';
import { DualLegCoordinator } from './execution/dualLegCoordinator';

async function main() {
  const symbol = (process.env.TEST_SMOKE_SYMBOL || 'SOL').toUpperCase();
  const runMode = (process.env.RUN_MODE || 'dry_run').toLowerCase();

  logger.info('🧪 Live smoke test', { symbol, runMode });

  const coord = new DualLegCoordinator();
  if (runMode === 'live') {
    const { gc, sol } = await coord.executeLive(symbol);
    logger.info('✅ Smoke result', { gc: gc.success, sol: sol.success });
  } else {
    const dry = await coord.dryRun(symbol);
    logger.info('✅ Dry-run result', { ok: !!dry });
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Live smoke test failed', err);
    process.exit(1);
  });
}


