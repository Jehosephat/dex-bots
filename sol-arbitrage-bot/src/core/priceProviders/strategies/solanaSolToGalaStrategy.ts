/**
 * SOL to GALA Quote Strategy
 * 
 * Handles SOL→GALA quotes on Solana (buying GALA with SOL)
 */

import axios from 'axios';
import BigNumber from 'bignumber.js';
import { SolanaQuote } from '../../../types/core';
import { TokenConfig } from '../../../types/config';
import { IQuoteStrategy } from './quoteStrategy';
import { toRawAmount, toTokenAmount } from '../../../utils/calculations';
import { getErrorHandler } from '../../../utils/errorHandler';
import logger from '../../../utils/logger';

/**
 * SOL to GALA Quote Strategy
 * 
 * Handles the special case where we quote SOL→GALA on Solana
 */
export class SolanaSolToGalaStrategy implements IQuoteStrategy {
  private readonly jupiterApiUrl: string;
  private readonly galaMint = 'eEUiUs4JWYZrp72djAGF1A8PhpR6rHphGeGN7GbVLp6'; // GALA on Solana
  private readonly solMint = 'So11111111111111111111111111111111111111112'; // Native SOL
  private errorHandler = getErrorHandler();

  constructor(jupiterApiUrl: string) {
    this.jupiterApiUrl = jupiterApiUrl;
  }

  canHandle(tokenConfig: TokenConfig, reverse?: boolean): boolean {
    // Handles SOL token with solQuoteVia === 'SOL'
    return tokenConfig.symbol === 'SOL' && (tokenConfig.solQuoteVia || 'SOL') === 'SOL';
  }

  async getQuote(symbol: string, amount: number, tokenConfig: TokenConfig): Promise<SolanaQuote | null> {
    try {
      const rawAmount = toRawAmount(new BigNumber(amount), 9).toString(); // SOL has 9 decimals
      
      const response = await this.errorHandler.executeWithProtection(
        () => axios.get(`${this.jupiterApiUrl}/quote`, {
          params: {
            inputMint: this.solMint,
            outputMint: this.galaMint,
            amount: rawAmount,
            slippageBps: 50,
            swapMode: 'ExactIn'
          },
          timeout: 10000
        }),
        'jupiter-api',
        `SOL→GALA quote for ${symbol}`,
        undefined, // retryPolicy
        {
          failureThreshold: 10,  // More tolerant: 10 failures instead of 5
          timeout: 60000,         // Longer wait: 60s instead of 30s before retry
          failureWindow: 120000  // Longer window: 2min instead of 1min
        }
      );

      if (!response.data?.outAmount) {
        return null;
      }

      // GALA has 8 decimals
      const solAmount = new BigNumber(amount);
      const galaAmount = toTokenAmount(new BigNumber(response.data.outAmount), 8);
      const price = galaAmount.div(solAmount); // GALA per SOL
      
      const solanaQuote: SolanaQuote = {
        symbol,
        price,
        currency: 'GALA', // Return price in GALA, not SOL
        tradeSize: amount,
        priceImpactBps: (response.data.priceImpactPct || 0) * 100,
        minOutput: galaAmount.multipliedBy(0.99),
        provider: 'solana',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000,
        isValid: true,
        priorityFee: this.calculatePriorityFee(response.data.priceImpactPct || 0),
        jupiterRoute: response.data.routePlan ? {
          routeId: response.data.routePlan[0]?.swapInfo?.label || 'unknown',
          inputMint: this.solMint,
          outputMint: this.galaMint,
          steps: response.data.routePlan || [],
          totalPriceImpact: response.data.priceImpactPct || 0,
          totalFee: response.data.platformFee?.amount || 0
        } : undefined
      };
      
      logger.debug(`📊 Solana quote for ${symbol} (SOL→GALA): ${price.toString()} GALA per SOL`);
      return solanaQuote;
    } catch (error) {
      await this.errorHandler.handleError(
        error,
        undefined,
        undefined,
        { operation: 'getQuote', symbol, quoteType: 'SOL→GALA', provider: 'solana', strategy: 'SolToGala' }
      );
      return null;
    }
  }

  private calculatePriorityFee(priceImpact: number): BigNumber {
    const baseFee = 0.000005; // 5000 lamports base fee
    const impactMultiplier = Math.max(1, priceImpact * 10);
    return new BigNumber(baseFee).multipliedBy(impactMultiplier);
  }
}

