import { initializeConfig, getTokenConfig } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { RiskManager } from './execution/riskManager';
import logger from './utils/logger';
import BigNumber from 'bignumber.js';
import { GalaChainQuote, SolanaQuote } from './types/core';

async function testRiskManager() {
  try {
    logger.info('🧪 Testing Risk Manager...');

    initializeConfig();

    const symbol = 'SOL';
    const token = getTokenConfig(symbol);
    if (!token) {
      logger.error('❌ Token not configured', { symbol });
      return false;
    }

    const configService = require('./config').createConfigService();
    const gc = new GalaChainPriceProvider(configService);
    const sol = new SolanaPriceProvider(configService);
    await gc.initialize();
    await sol.initialize();

    const [gcGeneric, solGeneric] = await Promise.all([
      gc.getQuote(symbol, token.tradeSize),
      sol.getQuote(symbol, token.tradeSize)
    ]);

    if (!gcGeneric || gcGeneric.currency !== 'GALA' || !solGeneric) {
      logger.warn('⚠️ Missing quotes');
      return false;
    }

    const gcQ = gcGeneric as GalaChainQuote;
    const solQ = solGeneric as SolanaQuote;

    // For SOL, use GC price (GALA per SOL) as SOL→GALA rate proxy
    const solToGalaRate = new BigNumber(gcQ.price);

    const rm = new RiskManager();
    const result = rm.evaluate(token, gcQ, solQ, solToGalaRate);

    logger.info(result.shouldProceed ? '✅ Risk PASS' : '🚫 Risk FAIL', {
      reasons: result.reasons,
      netEdge: result.edge?.netEdge.toString(),
      netEdgeBps: result.edge?.netEdgeBps
    });

    return true;
  } catch (error) {
    logger.error('❌ Risk manager test error', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

if (require.main === module) {
  testRiskManager().then(ok => process.exit(ok ? 0 : 1));
}

export { testRiskManager };
