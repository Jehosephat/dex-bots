import BigNumber from 'bignumber.js';
import logger from './utils/logger';
import { createConfigService, IConfigService } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { BalanceChecker } from './core/balanceChecker';
import { TokenEvaluator } from './core/tokenEvaluator';
import { TradeExecutor } from './core/tradeExecutor';
import { getErrorHandler } from './utils/errorHandler';
import { AutoBridgeService } from './bridging/autoBridgeService';
import { BridgeManager } from './bridging/bridgeManager';
import { BridgeStateTracker } from './bridging/bridgeStateTracker';

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
  
  // Initialize auto-bridging service (if enabled)
  let autoBridgeService: AutoBridgeService | null = null;
  const autoBridgingConfig = config.getAutoBridgingConfig();
  if (autoBridgingConfig?.enabled) {
    const bridgeManager = new BridgeManager(config as any); // BridgeManager expects ConfigManager, but IConfigService is compatible
    await bridgeManager.initialize();
    const bridgeStateTracker = new BridgeStateTracker();
    autoBridgeService = new AutoBridgeService(
      config,
      balanceChecker,
      bridgeManager,
      bridgeStateTracker,
      gcProvider,
      solProvider
    );
    logger.info('🌉 Auto-bridging enabled');
  }
  
  // Initialize providers
  await gcProvider.initialize();
  await solProvider.initialize();

  // Check balances before starting (especially for live mode)
  let balanceCheckResult = await checkInitialBalances(balanceChecker, config);
  
  // Check for auto-bridging opportunities BEFORE checking if we should pause
  // This allows bridging to fix imbalances even when trading would otherwise be paused
  // Reuse the balance check result to avoid duplicate API calls
  if (autoBridgeService) {
    // Get the last balance check result from BalanceChecker (it caches the result)
    const lastBalanceCheck = balanceChecker.getLastBalanceCheckResult();
    await checkAutoBridging(autoBridgeService, lastBalanceCheck || undefined);
    
    // After auto-bridging, re-check balances in case bridging fixed the issue
    // Only re-check if trading was paused, to avoid unnecessary API calls
    if (!balanceCheckResult && runMode === 'live') {
      logger.info(`\n🔍 Re-checking balances after auto-bridging attempt...`);
      const recheckResult = await checkInitialBalances(balanceChecker, config);
      if (recheckResult) {
        logger.info(`✅ Trading can proceed after auto-bridging`);
        balanceCheckResult = true; // Update result so trading can continue
      }
    }
  }
  
  // Only pause trading if balance check failed AND auto-bridging didn't fix it
  if (runMode === 'live' && !balanceCheckResult) {
    return false;
  }

  let anyExecuted = false;

  // Process each enabled token
  for (const token of enabled) {
    try {
      // Check if this specific token can trade (per-token balance check)
      if (!balanceChecker.canTokenTrade(token.symbol)) {
        const pausedTokens = balanceChecker.getPausedTokens();
        logger.warn(`⏸️ Skipping ${token.symbol}: Insufficient funds (paused tokens: ${pausedTokens.join(', ')})`);
        continue;
      }

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
          
          // Check balances after successful trade (but don't stop - just update per-token status)
          await checkBalancesAfterTrade(balanceChecker, config);
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
async function checkInitialBalances(balanceChecker: BalanceChecker, config: IConfigService): Promise<boolean> {
  logger.info(`\n🔍 Running initial balance check before cycle...`);
  const initialBalanceCheck = await balanceChecker.checkBalances(true, true);

  // Log balance check summary (deduplicated by token, showing max required)
  logger.info(`\n📊 Balance Check Summary:`);
  
  // Log total USD value if available
  if (initialBalanceCheck.totalUsdValue) {
    const total = initialBalanceCheck.totalUsdValue;
    logger.info(`\n💰 Total Inventory Value: $${total.total.toFixed(2)} USD`);
    logger.info(`   🔷 GalaChain: $${total.galaChain.toFixed(2)} USD`);
    logger.info(`   🔸 Solana: $${total.solana.toFixed(2)} USD`);
  }

  if (initialBalanceCheck.checkedBalances) {
    // Deduplicate GalaChain balances by token, keeping max required
    if (initialBalanceCheck.checkedBalances.galaChain.length > 0) {
      const gcMap = new Map<string, { current: BigNumber; required: BigNumber; sufficient: boolean }>();
      initialBalanceCheck.checkedBalances.galaChain.forEach(check => {
        const existing = gcMap.get(check.token);
        if (!existing || check.required.isGreaterThan(existing.required)) {
          gcMap.set(check.token, {
            current: check.current,
            required: check.required,
            sufficient: check.sufficient
          });
        } else if (existing && !existing.sufficient && check.sufficient) {
          // Update if new check is sufficient but existing wasn't
          existing.sufficient = true;
        }
      });
      
      logger.info(`   🔷 GalaChain:`);
      Array.from(gcMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([token, check]) => {
        const status = check.sufficient ? '✅' : '❌';
        // Find USD value from original balance check
        const originalCheck = initialBalanceCheck.checkedBalances!.galaChain.find(b => b.token === token);
        const usdValue = originalCheck?.usdValue;
        const usdStr = usdValue !== undefined && usdValue > 0 ? ` (≈$${usdValue.toFixed(2)})` : '';
        logger.info(`      ${status} ${token}: ${check.current.toFixed(8)} ${check.sufficient ? '>=' : '<'} ${check.required.toFixed(8)}${usdStr}`);
      });
    }
    
    // Deduplicate Solana balances by token, keeping max required
    if (initialBalanceCheck.checkedBalances.solana.length > 0) {
      const solMap = new Map<string, { current: BigNumber; required: BigNumber; sufficient: boolean }>();
      initialBalanceCheck.checkedBalances.solana.forEach(check => {
        const existing = solMap.get(check.token);
        if (!existing || check.required.isGreaterThan(existing.required)) {
          solMap.set(check.token, {
            current: check.current,
            required: check.required,
            sufficient: check.sufficient
          });
        } else if (existing && !existing.sufficient && check.sufficient) {
          // Update if new check is sufficient but existing wasn't
          existing.sufficient = true;
        }
      });
      
      logger.info(`   🔸 Solana:`);
      Array.from(solMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([token, check]) => {
        const status = check.sufficient ? '✅' : '❌';
        // Find USD value from original balance check
        const originalCheck = initialBalanceCheck.checkedBalances!.solana.find(b => b.token === token);
        const usdValue = originalCheck?.usdValue;
        const usdStr = usdValue !== undefined && usdValue > 0 ? ` (≈$${usdValue.toFixed(2)})` : '';
        logger.info(`      ${status} ${token}: ${check.current.toFixed(8)} ${check.sufficient ? '>=' : '<'} ${check.required.toFixed(8)}${usdStr}`);
      });
    }
  }
  
  if (initialBalanceCheck.insufficientFunds.length > 0) {
    logger.error(`\n   ⚠️ Insufficient funds:`);
    initialBalanceCheck.insufficientFunds.forEach(f => {
      logger.error(`      ${f.chain === 'galaChain' ? '🔷' : '🔸'} ${f.chain.toUpperCase()}: ${f.token} - ${f.currentBalance.toFixed(8)} < ${f.requiredBalance.toFixed(8)} (${f.purpose.toUpperCase()})`);
    });
  }
  
  // Log balance status (but don't stop the cycle - we'll skip individual tokens)
  if (!initialBalanceCheck.canTrade) {
    const pausedTokens = balanceChecker.getPausedTokens();
    logger.warn(`\n⚠️ Some tokens have insufficient funds at cycle start`);
    logger.warn(`   Paused tokens: ${pausedTokens.join(', ')}`);
    
    if (initialBalanceCheck.recommendations.length > 0) {
      logger.warn(`   Recommendations:`);
      initialBalanceCheck.recommendations.forEach(r => logger.warn(`   - ${r}`));
    }
    
    // Log which tokens can still trade
    const enabledTokens = config.getEnabledTokens();
    const canTradeTokens = enabledTokens
      .map((t: { symbol: string }) => t.symbol)
      .filter((symbol: string) => !pausedTokens.includes(symbol));
    
    if (canTradeTokens.length > 0) {
      logger.info(`   ✅ Tokens that can still trade: ${canTradeTokens.join(', ')}`);
      logger.info(`   Continuing cycle for tokens with sufficient funds...`);
    } else {
      logger.error(`\n🛑 All tokens paused - stopping cycle`);
      logger.error(`   Run 'npm run balances' to check current balances`);
      return false;
    }
  } else {
    logger.info(`✅ Balance check passed: All tokens have sufficient funds`);
    
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
 * Updates per-token pause status but doesn't stop the cycle
 */
async function checkBalancesAfterTrade(balanceChecker: BalanceChecker, configService: IConfigService): Promise<void> {
  try {
    logger.info(`\n🔍 Checking balances after trade...`);
    const balanceCheck = await balanceChecker.checkBalances();
    
    if (!balanceCheck.canTrade) {
      const pausedTokens = balanceChecker.getPausedTokens();
      logger.warn(`⚠️ Some tokens now have insufficient funds`);
      logger.warn(`   Paused tokens: ${pausedTokens.join(', ')}`);
      
      // Log which tokens can still trade
      const enabledTokens = configService.getEnabledTokens();
      const canTradeTokens = enabledTokens
        .map(t => t.symbol)
        .filter(symbol => !pausedTokens.includes(symbol));
      
      if (canTradeTokens.length > 0) {
        logger.info(`   ✅ Tokens that can still trade: ${canTradeTokens.join(', ')}`);
      } else {
        logger.error(`   🛑 All tokens paused - will stop after current cycle`);
      }
    } else {
      logger.info(`✅ Balance check passed: All tokens have sufficient funds`);
    }
  } catch (balanceError) {
    logger.warn(`⚠️ Balance check failed, continuing with caution`, {
      error: balanceError instanceof Error ? balanceError.message : String(balanceError)
    });
  }
}

/**
 * Check for auto-bridging opportunities
 */
async function checkAutoBridging(
  autoBridgeService: AutoBridgeService,
  balanceCheckResult?: import('./core/balanceChecker').BalanceCheckResult
): Promise<void> {
  try {
    logger.info(`\n🔍 Checking for auto-bridging opportunities...`);
    const checkResult = await autoBridgeService.checkAllTokens(balanceCheckResult);
    
    if (checkResult.needsRebalancing && checkResult.recommendations.length > 0) {
      logger.info(`🌉 Found ${checkResult.recommendations.length} token(s) needing rebalancing`);
      
      for (const imbalance of checkResult.recommendations) {
        try {
          await autoBridgeService.rebalance(imbalance);
        } catch (error) {
          logger.error(`❌ Failed to rebalance ${imbalance.token}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      logger.debug(`✅ No auto-bridging needed - balances are balanced`);
    }
  } catch (error) {
    logger.warn(`⚠️ Auto-bridging check failed, continuing`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}


