import { DualLegCoordinator } from './execution/dualLegCoordinator';
import logger from './utils/logger';

async function testDualLeg() {
  try {
    logger.info('🧪 Testing Dual-Leg Coordinator (dry-run)...');

    const coordinator = new DualLegCoordinator();
    const result = await coordinator.dryRun('SOL');

    if (!result) {
      logger.warn('⚠️ Dual-leg dry-run not available');
      return false;
    }

    logger.info('✅ Dual-leg dry-run built', {
      symbol: result.symbol,
      tradeSize: result.tradeSize,
      gc_expectedProceedsGala: result.galaChain.params.expectedProceedsGala.toString(),
      gc_minProceedsGala: result.galaChain.params.minProceedsGala.toString(),
      sol_quoteCurrency: result.solana.params.quoteCurrency,
      sol_expectedCostInQuote: result.solana.params.expectedCostInQuote.toString(),
      sol_maxCostInQuote: result.solana.params.maxCostInQuote.toString(),
      gc_deadline: result.galaChain.params.deadlineMs,
      sol_deadline: result.solana.params.deadlineMs
    });

    return true;
  } catch (error) {
    logger.error('❌ Dual-leg test error', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

if (require.main === module) {
  testDualLeg().then(ok => process.exit(ok ? 0 : 1));
}

export { testDualLeg };
