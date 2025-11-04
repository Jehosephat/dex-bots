import BigNumber from 'bignumber.js';
import logger from './utils/logger';
import { initializeConfig, getEnabledTokens, getTradingConfig } from './config';
import { GalaChainPriceProvider } from './core/priceProviders/galachain';
import { SolanaPriceProvider } from './core/priceProviders/solana';
import { RiskManager } from './execution/riskManager';
import { DualLegCoordinator } from './execution/dualLegCoordinator';
import { GalaChainQuote, SolanaQuote } from './types/core';
import { sendAlert } from './utils/alerts';
import { getTradeLogger } from './utils/tradeLogger';
import { EdgeCalculationResult } from './core/edgeCalculator';
import { BalanceChecker } from './core/balanceChecker';

export async function runMainCycle(runMode: 'live' | 'dry_run' = 'dry_run'): Promise<boolean> {
  initializeConfig();
  
  const enabled = getEnabledTokens();
  if (enabled.length === 0) {
    logger.warn('⚠️ No enabled tokens');
    return false;
  }

  const gcProvider = new GalaChainPriceProvider();
  const solProvider = new SolanaPriceProvider();
  const risk = new RiskManager();
        const coord = new DualLegCoordinator();
        const tradingConfig = getTradingConfig();
  
  // Get stateManager for cooldown checks
  const stateManager = (risk as any).stateManager;
  
  // Initialize balance checker
  const balanceChecker = new BalanceChecker(stateManager);
  
  // Always check balances before starting (especially for live mode)
  // Force check on cycle start to ensure we have accurate state
  if (runMode === 'live') {
    logger.info(`\n🔍 Running initial balance check before cycle...`);
    const initialBalanceCheck = await balanceChecker.checkBalances(true, true); // forceCheck=true
    
    // Log all balance checks (both sufficient and insufficient) for visibility
    logger.info(`\n📊 Balance Check Summary:`);
    
    // Show all checked balances, grouped by chain
    if (initialBalanceCheck.checkedBalances) {
      // GalaChain balances
      if (initialBalanceCheck.checkedBalances.galaChain.length > 0) {
        logger.info(`   🔷 GalaChain:`);
        initialBalanceCheck.checkedBalances.galaChain.forEach(check => {
          const status = check.sufficient ? '✅' : '❌';
          logger.info(`      ${status} ${check.token}: ${check.current.toFixed(8)} ${check.sufficient ? '>=' : '<'} ${check.required.toFixed(8)} (${check.purpose.toUpperCase()})`);
        });
      }
      
      // Solana balances
      if (initialBalanceCheck.checkedBalances.solana.length > 0) {
        logger.info(`   🔸 Solana:`);
        initialBalanceCheck.checkedBalances.solana.forEach(check => {
          const status = check.sufficient ? '✅' : '❌';
          logger.info(`      ${status} ${check.token}: ${check.current.toFixed(8)} ${check.sufficient ? '>=' : '<'} ${check.required.toFixed(8)} (${check.purpose.toUpperCase()})`);
        });
      }
    }
    
    // Also show insufficient funds in detail
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
      
      // If trading was previously paused but now we have funds, resume
      if (balanceChecker.isTradingPaused()) {
        logger.info(`✅ Trading resumed: Funds replenished`);
      }
    }
  }

  await gcProvider.initialize();
  await solProvider.initialize();

  let anyExecuted = false;

  for (const token of enabled) {
    try {
      logger.info(`\n${'━'.repeat(60)}`);
      logger.info(`📊 EVALUATING: ${token.symbol} | Trade Size: ${token.tradeSize}`);

      // Fetch quotes for FORWARD direction (SELL token on GC → BUY token on SOL)
      const [gcQuote, solQuoteResult] = await Promise.all([
        gcProvider.getQuote(token.symbol, token.tradeSize, false), // Selling token on GC to get GALA
        solProvider.getQuote(token.symbol, token.tradeSize, false)  // Buying token on SOL (or getting GALA)
      ]);
      
      // Check if we have both quotes
      if (!gcQuote || !solQuoteResult) {
        logger.warn('⚠️ Missing quote(s), skipping token', { 
          token: token.symbol,
          hasGcQuote: !!gcQuote,
          hasSolQuote: !!solQuoteResult
        });
        logger.info(`${'━'.repeat(60)}\n`);
        continue;
      }

      const galaQuote = gcQuote as GalaChainQuote;
      const solQuote = solQuoteResult as SolanaQuote;

      // Calculate conversion rate from Solana quote currency to GALA
      let quoteToGalaRate = new BigNumber(0);
      let galaUsdPrice = 0.01;
      try {
        const quoteCurrency = solQuote.currency;
        if (quoteCurrency === 'GALA') {
          // Solana quote is already in GALA (e.g., SOL→GALA quote), no conversion needed
          quoteToGalaRate = new BigNumber(1);
          logger.debug(`💱 Solana quote already in GALA - no conversion needed (1:1)`);
          galaUsdPrice = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01;
        } else if (quoteCurrency === 'SOL') {
          // Try to get rate directly from GALA/GSOL pool (more accurate, no USD conversion)
          const solCost = solQuote.price.multipliedBy(token.tradeSize);
          const poolRate = await gcProvider.getSOLToGALARate?.(solCost);
          
          if (poolRate && !poolRate.isZero() && !poolRate.isNaN()) {
            quoteToGalaRate = poolRate;
            logger.debug(`💱 Using SOL→GALA rate from pool: ${quoteToGalaRate.toFixed(4)} GALA per SOL`);
          } else {
            // Fallback to USD conversion if pool quote fails
            logger.debug(`⚠️ Pool quote failed, falling back to USD conversion for SOL→GALA rate`);
            const solUsd = solProvider.getSOLUSDPrice();
            galaUsdPrice = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01;
            if (solUsd > 0 && galaUsdPrice > 0) {
              quoteToGalaRate = new BigNumber(solUsd).div(galaUsdPrice);
              logger.debug(`💱 Using USD-based SOL→GALA rate: ${quoteToGalaRate.toFixed(4)} GALA per SOL (via $${solUsd}/$${galaUsdPrice.toFixed(6)})`);
            }
          }
        } else if (quoteCurrency === 'USDC') {
          // USDC still needs USD conversion (no direct pool on GalaChain)
          galaUsdPrice = gcProvider.getGALAUSDPrice ? gcProvider.getGALAUSDPrice() : 0.01;
          if (galaUsdPrice > 0) {
            quoteToGalaRate = new BigNumber(1).div(galaUsdPrice);
            logger.debug(`💱 USDC→GALA rate: ${quoteToGalaRate.toFixed(4)} GALA per USDC (via GALA/USD: $${galaUsdPrice.toFixed(6)})`);
          }
        }
      } catch (rateError) {
        logger.error('❌ Failed to calculate conversion rate', { 
          error: rateError instanceof Error ? rateError.message : String(rateError)
        });
      }

      if (quoteToGalaRate.isZero() || quoteToGalaRate.isNaN()) {
        logger.warn(`⚠️ Invalid conversion rate, skipping ${token.symbol}`);
        logger.info(`${'━'.repeat(60)}\n`);
        continue;
      }

      // Evaluate forward arbitrage (SELL token on GC → BUY on SOL)
      let riskResult;
      try {
        riskResult = risk.evaluate(token, galaQuote, solQuote, quoteToGalaRate, galaUsdPrice);
      } catch (evalError) {
        logger.error(`❌ ERROR in risk.evaluate() for ${token.symbol}`, { error: evalError });
        riskResult = { shouldProceed: false, reasons: ['Evaluation error'], edge: undefined };
      }

      // Log prices
      const gcProceeds = galaQuote.price.multipliedBy(token.tradeSize);
      const solCost = solQuote.price.multipliedBy(token.tradeSize);
      
      logger.info(`\n💰 MARKET PRICES`);
      // Determine what we're doing on each chain
      const gcAction = token.gcQuoteVia === 'GALA' 
        ? `SELL GALA → BUY ${token.symbol}` 
        : `SELL ${token.symbol}`;
      const solAction = token.solQuoteVia === 'GALA' 
        ? `SELL ${token.symbol} → BUY GALA` 
        : `BUY ${token.symbol}`;
      
      logger.info(`   🔷 GalaChain (${gcAction})`);
      logger.info(`      Price:    ${galaQuote.price.toFixed(8)} ${galaQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      if (token.gcQuoteVia === 'GALA') {
        logger.info(`      Cost:     ${gcProceeds.toFixed(8)} ${galaQuote.currency} (to buy ${token.tradeSize} ${token.symbol})`);
      } else {
        logger.info(`      Proceeds: ${gcProceeds.toFixed(8)} ${galaQuote.currency}`);
      }
      logger.info(`      Impact:   ${galaQuote.priceImpactBps.toFixed(2)} bps`);
      logger.info(`   🔸 Solana (${solAction})`);
      logger.info(`      Price:    ${solQuote.price.toFixed(8)} ${solQuote.currency} per ${token.symbol}`);
      logger.info(`      Size:     ${token.tradeSize} ${token.symbol}`);
      if (token.solQuoteVia === 'GALA') {
        logger.info(`      Proceeds: ${solCost.toFixed(8)} ${solQuote.currency} (from selling ${token.tradeSize} ${token.symbol})`);
      } else {
        logger.info(`      Cost:     ${solCost.toFixed(8)} ${solQuote.currency}`);
      }
      logger.info(`      Impact:   ${solQuote.priceImpactBps.toFixed(2)} bps`);

      if (!riskResult || !riskResult.shouldProceed) {
        logger.info(`❌ DECISION: DO NOT TRADE ${token.symbol}`);
        if (riskResult?.reasons) {
          logger.info(`\n   Reasons:`);
          riskResult.reasons.forEach((r: string, i: number) => logger.info(`   ${i + 1}. ${r}`));
        }
        logger.info(`${'═'.repeat(60)}\n`);
        continue;
      }

      // Log detailed edge calculation
      if (riskResult.edge) {
        const edge = riskResult.edge;
        const isProfitable = edge.isProfitable;
        const meetsThreshold = edge.meetsThreshold;
        const impactAcceptable = edge.priceImpactAcceptable;
        
        logger.info(`\n🧮 EDGE CALCULATION`);
        logger.info(`   📥 INCOME:`);
        logger.info(`      🔷 GalaChain Proceeds:  ${edge.galaChainProceeds.toFixed(8)} GALA`);
        logger.info(`   📤 COSTS:`);
        logger.info(`      🔸 Solana Cost:         ${edge.solanaCostGala.toFixed(8)} GALA (${solCost.toFixed(8)} ${solQuote.currency})`);
        logger.info(`      🌉 Bridge Cost (amort): ${edge.bridgeCost.toFixed(8)} GALA (amortized per trade)`);
        logger.info(`      🛡️  Risk Buffer:        ${edge.riskBuffer.toFixed(8)} GALA`);
        logger.info(`      ────────────────────────────`);
        logger.info(`      💰 Total Cost:         ${edge.totalCost.toFixed(8)} GALA`);
        logger.info(`   ════════════════════════════════`);
        logger.info(`   💵 NET EDGE:              ${edge.netEdge.toFixed(8)} GALA (${edge.netEdgeBps.toFixed(2)} bps)`);
        logger.info(`   📊 Threshold:             ${tradingConfig.minEdgeBps} bps minimum`);
        logger.info(`   ✅ Meets Threshold:        ${meetsThreshold ? 'YES ✓' : 'NO ✗'}`);
        logger.info(`   💹 Profitable:             ${isProfitable ? 'YES ✓' : 'NO ✗'}`);
        logger.info(`\n   📉 PRICE IMPACT:`);
        logger.info(`      🔷 GalaChain:           ${edge.galaChainPriceImpactBps.toFixed(2)} bps`);
        logger.info(`      🔸 Solana:              ${edge.solanaPriceImpactBps.toFixed(2)} bps`);
        logger.info(`      Max Allowed:            ${tradingConfig.maxPriceImpactBps} bps`);
        logger.info(`      ✅ Acceptable:          ${impactAcceptable ? 'YES ✓' : 'NO ✗'}`);
      }

      // Log decision
      logger.info(`\n${'═'.repeat(60)}`);
      logger.info(`✅ DECISION: PROCEED WITH TRADE ${token.symbol}`);
      logger.info(`   Mode:     ${runMode === 'live' ? '🚀 LIVE TRADING' : '🧪 DRY-RUN'}`);
      logger.info(`   Size:     ${token.tradeSize} ${token.symbol}`);
      logger.info(`   Direction: 🔷 SELL on GalaChain → 🔸 BUY on Solana`);
      if (riskResult.edge) {
        logger.info(`   Expected Edge: ${riskResult.edge.netEdge.toFixed(8)} GALA (${riskResult.edge.netEdgeBps.toFixed(2)} bps)`);
      }
      logger.info(`${'═'.repeat(60)}\n`);

      // Get trade logger
      const tradeLogger = getTradeLogger();
      const startTime = Date.now();

      // Prepare log entry with expected values
      const edge = riskResult.edge;
      const logEntry: any = {
        timestamp: new Date().toISOString(),
        mode: runMode,
        token: token.symbol,
        tradeSize: token.tradeSize,
        direction: 'forward',
        success: false,
        expectedGalaChainProceeds: edge ? edge.galaChainProceeds.toNumber() : undefined,
        expectedSolanaCost: solCost.toNumber(),
        expectedSolanaCostGala: edge ? edge.solanaCostGala.toNumber() : undefined,
        expectedNetEdge: edge ? edge.netEdge.toNumber() : undefined,
        expectedNetEdgeBps: edge ? edge.netEdgeBps : undefined,
        galaChainPrice: galaQuote.price.toNumber(),
        galaChainPriceCurrency: galaQuote.currency,
        solanaPrice: solQuote.price.toNumber(),
        solanaPriceCurrency: solQuote.currency,
        priceImpactGcBps: galaQuote.priceImpactBps,
        priceImpactSolBps: solQuote.priceImpactBps
      };

      if (runMode === 'live') {
        const { gc, sol } = await coord.executeLive(token.symbol);
        const endTime = Date.now();
        logEntry.executionDurationMs = endTime - startTime;
        logEntry.galaChainSuccess = gc.success;
        logEntry.solanaSuccess = sol.success;
        logEntry.success = gc.success && sol.success;

        if (gc.success && sol.success) {
          anyExecuted = true;
          logEntry.galaChainTxHash = gc.txHash;
          logEntry.solanaTxSig = sol.txSig;
          
          logger.info(`\n🎉 TRADE EXECUTED SUCCESSFULLY`);
          logger.info(`   Token: ${token.symbol}`);
          logger.info(`   Direction: FORWARD`);
          logger.info(`   🔷 GalaChain (SELL): ✅ Success`);
          logger.info(`      TX Hash: ${gc.txHash}`);
          logger.info(`   🔸 Solana (BUY): ✅ Success`);
          logger.info(`      TX Signature: ${sol.txSig}`);
          
          // Note: Actual values would need to be extracted from execution results
          // For now, we log expected values. Can enhance later if execution results provide actuals.
        } else if (!gc.success && !sol.success) {
          logEntry.galaChainError = gc.error;
          logEntry.solanaError = sol.error;
          
          logger.error(`\n❌ BOTH LEGS FAILED`);
          logger.error(`   Token: ${token.symbol}`);
          logger.error(`   🔷 GalaChain (SELL): ❌ Failed`);
          logger.error(`      Error: ${gc.error}`);
          logger.error(`   🔸 Solana (BUY): ❌ Failed`);
          logger.error(`      Error: ${sol.error}`);
          sendAlert('Dual-leg trade failed', { token: token.symbol, direction: 'forward', gcError: gc.error, solError: sol.error }, 'error').catch(() => {});
        } else {
          logEntry.galaChainTxHash = gc.success ? gc.txHash : undefined;
          logEntry.solanaTxSig = sol.success ? sol.txSig : undefined;
          logEntry.galaChainError = !gc.success ? gc.error : undefined;
          logEntry.solanaError = !sol.success ? sol.error : undefined;
          
          logger.warn(`\n⚠️ PARTIAL SUCCESS`);
          logger.warn(`   Token: ${token.symbol}`);
          logger.warn(`   🔷 GalaChain (SELL): ${gc.success ? '✅ Success' : '❌ Failed'}`);
          if (gc.success && gc.txHash) {
            logger.warn(`      TX Hash: ${gc.txHash}`);
          }
          if (!gc.success && gc.error) {
            logger.warn(`      Error: ${gc.error}`);
          }
          logger.warn(`   🔸 Solana (BUY): ${sol.success ? '✅ Success' : '❌ Failed'}`);
          if (sol.success && sol.txSig) {
            logger.warn(`      TX Signature: ${sol.txSig}`);
          }
          if (!sol.success && sol.error) {
            logger.warn(`      Error: ${sol.error}`);
          }
        }
        
        // Log the trade
        tradeLogger.logTrade(logEntry);
        
        // Set cooldown after any trade attempt (success or failure)
        const cooldownMinutes = 1; // 1 minute cooldown
        const cooldownEndsAt = Date.now() + (cooldownMinutes * 60 * 1000);
        const cooldownReason = gc.success && sol.success 
          ? 'Trade executed successfully' 
          : (!gc.success && !sol.success) 
            ? 'Both legs failed' 
            : 'Partial success';
        
        stateManager.setTokenCooldown(token.symbol, {
          isInCooldown: true,
          cooldownEndsAt,
          remainingSeconds: cooldownMinutes * 60,
          reason: cooldownReason
        });
        
        logger.info(`⏰ Cooldown set for ${token.symbol}: ${cooldownMinutes} minute(s) - ${cooldownReason}`);
        
        // Check balances after successful live trade
        if (gc.success && sol.success) {
          try {
            logger.info(`\n🔍 Checking balances after trade...`);
            const balanceCheck = await balanceChecker.checkBalances();
            
            if (!balanceCheck.canTrade) {
              logger.error(`\n⛔ TRADING PAUSED: Insufficient funds detected`);
              logger.error(`   Reason: ${balanceCheck.insufficientFunds.map(f => `${f.chain} ${f.token}`).join(', ')}`);
              
              // Return early to stop processing more tokens
              logger.info(`\n🛑 Stopping main cycle due to insufficient funds`);
              return anyExecuted;
            } else {
              logger.info(`✅ Balance check passed: Sufficient funds available`);
            }
          } catch (balanceError) {
            logger.warn(`⚠️ Balance check failed, continuing with caution`, {
              error: balanceError instanceof Error ? balanceError.message : String(balanceError)
            });
          }
        }
        
      } else {
        await coord.dryRun(token.symbol);
        logEntry.executionDurationMs = Date.now() - startTime;
        
        const strategy = 'Would SELL on GalaChain and BUY on Solana';
        
        logger.info(`🧪 DRY-RUN completed`, {
          token: token.symbol,
          direction: 'forward',
          note: 'No actual trades executed - simulation only',
          strategy
        });
        
        // Log dry-run trades too
        tradeLogger.logTrade(logEntry);
      }

      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('❌ Error in main cycle for token', { token: token.symbol, error: msg });
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }
  }

  return anyExecuted;
}


