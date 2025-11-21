import 'dotenv/config';
import logger from './utils/logger';
import { runMainCycle } from './mainLoop';

async function main() {
  const mode = (process.env.RUN_MODE || 'dry_run').toLowerCase() as 'live' | 'dry_run';
  logger.info('🧪 Running one main cycle', { mode });
  const executed = await runMainCycle(mode);
  logger.info('✅ Main cycle finished', { executed });
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ test-main-loop-once failed', err);
    process.exit(1);
  });
}


