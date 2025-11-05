import logger from './utils/logger';
import { createConfigService, IConfigService } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { BalanceChecker } from './core/balanceChecker';
import { TokenEvaluator } from './core/tokenEvaluator';
import { TradeExecutor } from './core/tradeExecutor';
import { getErrorHandler } from './utils/errorHandler';

export async function runMainCycle(runMode: 'live' | 'dry_run' = 'dry_run', configService?: IConfigService): Promise<boolean> {
  // Use provided config service or create default one
  const config = configService || createConfigService();
  const errorHandler = getErrorHandler();
  
  const enabled = config.getEnabledTokens();
  if (enabled.length === 0) {
    logger.warn('⚠️ No enabled tokens');
    return false;
  }

  // Initialize providers
  const gcProvider = new GalaChainPriceProvider(config);
  const solProvider = new SolanaPriceProvider(config);
  
  // Initialize components
  const tokenEvaluator = new TokenEvaluator(config, gcProvider, solProvider);
  const tradeExecutor = new TradeExecutor(config);
  
  // Get stateManager for cooldown and balance checks
  const risk = new (require('./execution/riskManager').RiskManager)(undefined, config);
  const stateManager = (risk as any).stateManager;
  const balanceChecker = new BalanceChecker(stateManager, config);
  
  // Initialize providers
  await gcProvider.initialize();
  await solProvider.initialize();

  // Check balances before starting (especially for live mode)
  if (runMode === 'live') {
    const balanceCheckResult = await checkInitialBalances(balanceChecker);
    if (!balanceCheckResult) {
      return false;
    }
  }

  let anyExecuted = false;

  // Process each enabled token
  for (const token of enabled) {
    try {
      // Evaluate token
      const evaluation = await tokenEvaluator.evaluateToken(token);
      
      // Log evaluation results
      tokenEvaluator.logEvaluationResults(evaluation);

      // Skip if evaluation failed or trade should not proceed
      if (!evaluation.success || !evaluation.riskResult?.shouldProceed) {
        continue;
      }

      // Execute trade
      const executionResult = await tradeExecutor.executeTrade(evaluation, runMode);

      if (executionResult.executed && executionResult.success) {
        anyExecuted = true;

        // Handle post-execution tasks for live trades
        if (runMode === 'live') {
          // Set cooldown
          await setCooldown(stateManager, token.symbol, executionResult);
          
          // Check balances after successful trade
          const shouldStop = await checkBalancesAfterTrade(balanceChecker);
          if (shouldStop) {
            logger.info(`\n🛑 Stopping main cycle due to insufficient funds`);
            return anyExecuted;
          }
        }
      }

      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'runMainCycle', token: token.symbol }
      );
      logger.error('❌ Error in main cycle for token', { token: token.symbol, error: errorMessage });
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      // Continue processing other tokens even if one fails
    }
  }

  return anyExecuted;
}

/**
 * Check initial balances before starting cycle
 */
async function checkInitialBalances(balanceChecker: BalanceChecker): Promise<boolean> {
  logger.info(`\n🔍 Running initial balance check before cycle...`);
  const initialBalanceCheck = await balanceChecker.checkBalances(true, true);

  // Log balance check summary
  logger.info(`\n📊 Balance Check Summary:`);
  
  if (initialBalanceCheck.checkedBalances) {
    if (initialBalanceCheck.checkedBalances.galaChain.length > 0) {
      logger.info(`   🔷 GalaChain:`);
      initialBalanceCheck.checkedBalances.galaChain.forEach(check => {
        const status = check.sufficient ? '✅' : '❌';
        logger.info(`      ${status} ${check.token}: ${check.current.toFixed(8)} ${check.sufficient ? '>=' : '<'} ${check.required.toFixed(8)} (${check.purpose.toUpperCase()})`);
      });
    }
    
    if (initialBalanceCheck.checkedBalances.solana.length > 0) {
      logger.info(`   🔸 Solana:`);
      initialBalanceCheck.checkedBalances.solana.forEach(check => {
        const status = check.sufficient ? '✅' : '❌';
        logger.info(`      ${status} ${check.token}: ${check.current.toFixed(8)} ${check.sufficient ? '>=' : '<'} ${check.required.toFixed(8)} (${check.purpose.toUpperCase()})`);
      });
    }
  }
  
  if (initialBalanceCheck.insufficientFunds.length > 0) {
    logger.error(`\n   ⚠️ Insufficient funds:`);
    initialBalanceCheck.insufficientFunds.forEach(f => {
      logger.error(`      ${f.chain === 'galaChain' ? '🔷' : '🔸'} ${f.chain.toUpperCase()}: ${f.token} - ${f.currentBalance.toFixed(8)} < ${f.requiredBalance.toFixed(8)} (${f.purpose.toUpperCase()})`);
    });
  }
  
  if (!initialBalanceCheck.canTrade) {
    logger.error(`\n⛔ TRADING PAUSED: Insufficient funds detected at cycle start`);
    
    if (initialBalanceCheck.recommendations.length > 0) {
      logger.warn(`   Recommendations:`);
      initialBalanceCheck.recommendations.forEach(r => logger.warn(`   - ${r}`));
    }
    
    logger.error(`\n🛑 Stopping cycle - waiting for balance replenishment`);
    logger.error(`   Run 'npm run balances' to check current balances`);
    return false;
  } else {
    logger.info(`✅ Balance check passed: Sufficient funds available`);
    
    if (balanceChecker.isTradingPaused()) {
      logger.info(`✅ Trading resumed: Funds replenished`);
    }
  }

  return true;
}

/**
 * Set cooldown after trade execution
 */
async function setCooldown(stateManager: any, tokenSymbol: string, executionResult: any): Promise<void> {
  const cooldownMinutes = 1;
  const cooldownEndsAt = Date.now() + (cooldownMinutes * 60 * 1000);
  
  let cooldownReason: string;
  if (executionResult.gcResult?.success && executionResult.solResult?.success) {
    cooldownReason = 'Trade executed successfully';
  } else if (!executionResult.gcResult?.success && !executionResult.solResult?.success) {
    cooldownReason = 'Both legs failed';
  } else {
    cooldownReason = 'Partial success';
  }
  
  stateManager.setTokenCooldown(tokenSymbol, {
    isInCooldown: true,
    cooldownEndsAt,
    remainingSeconds: cooldownMinutes * 60,
    reason: cooldownReason
  });
  
  logger.info(`⏰ Cooldown set for ${tokenSymbol}: ${cooldownMinutes} minute(s) - ${cooldownReason}`);
}

/**
 * Check balances after successful trade
 */
async function checkBalancesAfterTrade(balanceChecker: BalanceChecker): Promise<boolean> {
  try {
    logger.info(`\n🔍 Checking balances after trade...`);
    const balanceCheck = await balanceChecker.checkBalances();
    
    if (!balanceCheck.canTrade) {
      logger.error(`\n⛔ TRADING PAUSED: Insufficient funds detected`);
      logger.error(`   Reason: ${balanceCheck.insufficientFunds.map(f => `${f.chain} ${f.token}`).join(', ')}`);
      return true; // Signal to stop processing
    } else {
      logger.info(`✅ Balance check passed: Sufficient funds available`);
      return false;
    }
  } catch (balanceError) {
    logger.warn(`⚠️ Balance check failed, continuing with caution`, {
      error: balanceError instanceof Error ? balanceError.message : String(balanceError)
    });
    return false;
  }
}


