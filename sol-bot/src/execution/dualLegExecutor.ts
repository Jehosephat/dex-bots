/**
 * Dual-Leg Executor
 * Coordinates arbitrage execution across GalaChain and Solana
 */

import { GalaChainExecutor } from './galaChainExecutor';
import { SolanaExecutor } from './solanaExecutor';
import { riskManager } from '../core/riskManager';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { ArbitrageOpportunity, ExecutionResult, TokenConfig } from '../types';

export class DualLegExecutor {
  private gcExecutor: GalaChainExecutor;
  private solExecutor: SolanaExecutor;

  constructor() {
    this.gcExecutor = new GalaChainExecutor();
    this.solExecutor = new SolanaExecutor();
    logger.info('Dual-Leg Executor initialized');
  }

  /**
   * Execute a complete arbitrage trade across both chains
   * 
   * Flow:
   * 1. Sell token on GalaChain for GALA
   * 2. Buy token on Solana using SOL
   * 3. (Bridge tokens back to GalaChain if needed)
   */
  async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    tokenConfig: TokenConfig
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const tradeId = `trade-${Date.now()}-${opportunity.token}`;

    try {
      logger.info('🚀 Starting dual-leg arbitrage execution', {
        tradeId,
        token: opportunity.token,
        size: opportunity.recommendedSize,
        expectedEdge: `${(opportunity.netEdge * 100).toFixed(2)}%`
      });

      // Mark trade as started
      riskManager.startTrade(opportunity.token, tradeId);

      // Step 1: Execute GalaChain leg (Sell token for GALA)
      logger.info('📤 Executing GalaChain leg (SELL)', {
        token: opportunity.token,
        amount: opportunity.recommendedSize
      });

      const gcResult = await this.gcExecutor.executeSwap(
        tokenConfig.galaChainMint, // Token we're selling
        'GALA|Unit|none|none',     // GALA we're receiving
        opportunity.recommendedSize,
        opportunity.recommendedSize * opportunity.gcSellPrice * 0.95, // Min GALA expected (with buffer)
        config.getTradingConfig().slippageTolerance
      );

      if (!gcResult.success) {
        logger.error('❌ GalaChain leg failed', {
          tradeId,
          error: gcResult.error
        });

        // Mark trade as failed
        riskManager.completeTrade(tradeId, false, 0);

        return {
          success: false,
          token: opportunity.token,
          gcResult,
          solResult: {
            success: false,
            signature: undefined,
            tokenReceived: 0,
            costSOL: 0,
            actualSlippage: 0,
            executionTime: 0,
            error: 'Skipped due to GC failure'
          },
          realizedPnL: 0,
          netEdge: 0,
          executionTime: Date.now() - startTime,
          timestamp: Date.now()
        };
      }

      logger.info('✅ GalaChain leg completed', {
        tradeId,
        galaReceived: gcResult.galaReceived,
        executionTime: `${gcResult.executionTime}ms`,
        slippage: `${(gcResult.actualSlippage * 100).toFixed(2)}%`
      });

      // Step 2: Execute Solana leg (Buy token with SOL)
      logger.info('📥 Executing Solana leg (BUY)', {
        token: opportunity.token,
        amount: opportunity.recommendedSize
      });

      const solResult = await this.solExecutor.executeSwap(
        'So11111111111111111111111111111111111111112', // SOL (input)
        tokenConfig.solanaMint,                         // Token we're buying
        opportunity.recommendedSize * opportunity.solBuyPrice, // SOL amount
        9, // SOL decimals
        config.getTradingConfig().slippageTolerance * 100 // Convert to basis points
      );

      if (!solResult.success) {
        logger.error('❌ Solana leg failed (GC leg succeeded!)', {
          tradeId,
          error: solResult.error,
          warning: 'Position imbalance - need to rebalance manually or via bridge'
        });

        // Calculate PnL (negative because we only completed one leg)
        const partialPnL = gcResult.galaReceived - (opportunity.recommendedSize * opportunity.gcSellPrice);
        riskManager.completeTrade(tradeId, false, partialPnL);

        return {
          success: false,
          token: opportunity.token,
          gcResult,
          solResult,
          realizedPnL: partialPnL,
          netEdge: 0,
          executionTime: Date.now() - startTime,
          timestamp: Date.now()
        };
      }

      logger.info('✅ Solana leg completed', {
        tradeId,
        tokenReceived: solResult.tokenReceived,
        costSOL: solResult.costSOL,
        executionTime: `${solResult.executionTime}ms`,
        slippage: `${(solResult.actualSlippage * 100).toFixed(2)}%`
      });

      // Step 3: Calculate realized PnL
      const galaReceived = gcResult.galaReceived;
      const solSpent = solResult.costSOL;
      
      // Convert SOL to GALA for PnL calculation
      // TODO: Use actual SOL/GALA exchange rate
      const solToGalaRate = 5000; // Placeholder: 1 SOL = 5000 GALA
      const galaCostOfSolanaLeg = solSpent * solToGalaRate;
      
      const realizedPnL = galaReceived - galaCostOfSolanaLeg - opportunity.bridgeCostGALA;
      const netEdge = realizedPnL / (opportunity.recommendedSize * opportunity.gcSellPrice);

      const totalExecutionTime = Date.now() - startTime;

      logger.info('🎉 Dual-leg arbitrage completed!', {
        tradeId,
        token: opportunity.token,
        realizedPnL: `${realizedPnL.toFixed(2)} GALA`,
        netEdge: `${(netEdge * 100).toFixed(2)}%`,
        totalExecutionTime: `${totalExecutionTime}ms`
      });

      // Mark trade as successful
      riskManager.completeTrade(tradeId, true, realizedPnL);

      return {
        success: true,
        token: opportunity.token,
        gcResult,
        solResult,
        realizedPnL,
        netEdge,
        executionTime: totalExecutionTime,
        timestamp: Date.now()
      };

    } catch (error: any) {
      const totalExecutionTime = Date.now() - startTime;
      logger.error('💥 Dual-leg arbitrage execution error', {
        tradeId,
        token: opportunity.token,
        error: error.message || error
      });

      // Mark trade as failed
      riskManager.completeTrade(tradeId, false, 0);

      return {
        success: false,
        token: opportunity.token,
        gcResult: {
          success: false,
          transactionId: undefined,
          galaReceived: 0,
          tokenSold: opportunity.recommendedSize,
          actualSlippage: 0,
          executionTime: 0,
          error: error.message
        },
        solResult: {
          success: false,
          signature: undefined,
          tokenReceived: 0,
          costSOL: 0,
          actualSlippage: 0,
          executionTime: 0,
          error: 'Not attempted'
        },
        realizedPnL: 0,
        netEdge: 0,
        executionTime: totalExecutionTime,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Execute only the GalaChain leg (for testing or partial execution)
   */
  async executeGalaChainOnly(
    opportunity: ArbitrageOpportunity,
    tokenConfig: TokenConfig
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const tradeId = `gc-only-${Date.now()}-${opportunity.token}`;

    logger.info('Executing GalaChain-only trade', {
      tradeId,
      token: opportunity.token
    });

    riskManager.startTrade(opportunity.token, tradeId);

    const gcResult = await this.gcExecutor.executeSwap(
      tokenConfig.galaChainMint,
      'GALA|Unit|none|none',
      opportunity.recommendedSize,
      opportunity.recommendedSize * opportunity.gcSellPrice * 0.95,
      config.getTradingConfig().slippageTolerance
    );

    const realizedPnL = gcResult.success ? gcResult.galaReceived : 0;
    riskManager.completeTrade(tradeId, gcResult.success, realizedPnL);

    return {
      success: gcResult.success,
      token: opportunity.token,
      gcResult,
      solResult: {
        success: false,
        signature: undefined,
        tokenReceived: 0,
        costSOL: 0,
        actualSlippage: 0,
        executionTime: 0,
        error: 'Not executed'
      },
      realizedPnL,
      netEdge: 0,
      executionTime: Date.now() - startTime,
      timestamp: Date.now()
    };
  }

  /**
   * Execute only the Solana leg (for testing or partial execution)
   */
  async executeSolanaOnly(
    opportunity: ArbitrageOpportunity,
    tokenConfig: TokenConfig
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const tradeId = `sol-only-${Date.now()}-${opportunity.token}`;

    logger.info('Executing Solana-only trade', {
      tradeId,
      token: opportunity.token
    });

    riskManager.startTrade(opportunity.token, tradeId);

    const solResult = await this.solExecutor.executeSwap(
      'So11111111111111111111111111111111111111112',
      tokenConfig.solanaMint,
      opportunity.recommendedSize * opportunity.solBuyPrice,
      9,
      config.getTradingConfig().slippageTolerance * 100
    );

    riskManager.completeTrade(tradeId, solResult.success, 0);

    return {
      success: solResult.success,
      token: opportunity.token,
      gcResult: {
        success: false,
        transactionId: undefined,
        galaReceived: 0,
        tokenSold: 0,
        actualSlippage: 0,
        executionTime: 0,
        error: 'Not executed'
      },
      solResult,
      realizedPnL: 0,
      netEdge: 0,
      executionTime: Date.now() - startTime,
      timestamp: Date.now()
    };
  }
}

