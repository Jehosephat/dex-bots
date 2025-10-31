import 'dotenv/config';
import logger from './utils/logger';
import { initializeConfig } from './config';
import { runMainCycle } from './mainLoop';
import { InventoryRefresher } from './core/inventoryRefresher';

async function main() {
  initializeConfig();

  const runMode = ((process.env.RUN_MODE || 'dry_run').toLowerCase() === 'live') ? 'live' : 'dry_run';
  const intervalMs = Number(process.env.UPDATE_INTERVAL_MS || '15000');
  const invRefreshMs = Number(process.env.INVENTORY_REFRESH_MS || '300000'); // 5 min default

  logger.info('🤖 Starting SOL Arbitrage Bot runner', { runMode, intervalMs, invRefreshMs });

  // Initial inventory refresh (best-effort)
  const refresher = new InventoryRefresher();
  try {
    await refresher.refreshAll();
  } catch (e) {
    logger.warn('⚠️ Initial inventory refresh failed', { error: e instanceof Error ? e.message : String(e) });
  }

  // Periodic inventory refresh
  const invTimer = setInterval(() => {
    refresher.refreshAll().catch((e) => {
      logger.warn('⚠️ Periodic inventory refresh failed', { error: e instanceof Error ? e.message : String(e) });
    });
  }, invRefreshMs);

  // Main trading loop
  let stopping = false;
  const loop = async () => {
    if (stopping) return;
    try {
      const paused = (process.env.PAUSE || '').toLowerCase() === 'true';
      if (paused) {
        logger.info('⏸️  Bot paused (PAUSE=true), skipping cycle');
      } else {
        await runMainCycle(runMode);
      }
    } catch (e) {
      logger.error('❌ Error in main runner cycle', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (!stopping) setTimeout(loop, intervalMs);
    }
  };

  // Start first cycle
  loop();

  // Graceful shutdown
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(invTimer);
    logger.info('🛑 Runner stopping...');
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('run-bot crashed:', err);
    process.exit(1);
  });
}



