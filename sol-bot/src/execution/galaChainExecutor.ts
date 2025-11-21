/**
 * GalaChain Executor
 * Handles swap execution on GalaChain DEX v3
 */

import axios from 'axios';
import BigNumber from 'bignumber.js';
import { TokenClassKey } from '@gala-chain/api';
import { DexFeePercentageTypes } from '@gala-chain/dex';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { GalaChainResult } from '../types';

export class GalaChainExecutor {
  private dexBackendUrl = 'https://dex-backend-prod1.defi.gala.com';
  private bundleBackendUrl = 'wss://bundle-backend-prod1.defi.gala.com';

  constructor() {
    logger.info('GalaChain Executor initialized');
  }

  /**
   * Execute a swap on GalaChain
   */
  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    minAmountOut: number,
    slippageTolerance: number = 0.05
  ): Promise<GalaChainResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Executing GalaChain swap', {
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut
      });

      // Step 1: Parse token keys
      const tokenInKey = this.parseTokenMint(tokenIn);
      const tokenOutKey = this.parseTokenMint(tokenOut);

      // Step 2: Determine fee tier and swap direction
      const fee = this.determineFee(tokenIn, tokenOut);
      const zeroForOne = this.compareTokenKeys(tokenInKey, tokenOutKey) < 0;

      // Step 3: Calculate slippage protection
      const amountInMaximum = amountIn * (1 + slippageTolerance);
      const amountOutMinimum = minAmountOut * (1 - slippageTolerance);

      // Step 4: Create swap payload
      const swapPayload = await this.createSwapPayload({
        tokenIn: tokenInKey,
        tokenOut: tokenOutKey,
        amountIn: amountIn.toString(),
        fee,
        amountInMaximum: amountInMaximum.toString(),
        amountOutMinimum: amountOutMinimum.toString()
      });

      if (!swapPayload) {
        throw new Error('Failed to create swap payload');
      }

      logger.debug('Swap payload created', { uniqueKey: swapPayload.uniqueKey });

      // Step 5: Sign the payload
      const signature = await this.signPayload(swapPayload);

      // Step 6: Execute the bundle
      const executionResult = await this.executeBundle({
        payload: swapPayload,
        type: 'swap',
        signature,
        user: config.getGalaWalletAddress()
      });

      if (!executionResult || !executionResult.transactionId) {
        throw new Error('Bundle execution failed');
      }

      logger.info('Bundle submitted', { transactionId: executionResult.transactionId });

      // Step 7: Wait for transaction confirmation
      const status = await this.waitForConfirmation(executionResult.transactionId, 30000);

      const executionTime = Date.now() - startTime;

      if (status.status === 'SUCCESS') {
        logger.info('GalaChain swap completed successfully', {
          transactionId: executionResult.transactionId,
          executionTime: `${executionTime}ms`
        });

        return {
          success: true,
          transactionId: executionResult.transactionId,
          galaReceived: status.galaReceived || 0, // TODO: Extract from transaction result
          tokenSold: amountIn,
          actualSlippage: 0, // TODO: Calculate actual slippage
          executionTime,
          error: undefined
        };
      } else {
        logger.error('GalaChain swap failed', {
          transactionId: executionResult.transactionId,
          status: status.status,
          error: status.error
        });

        return {
          success: false,
          transactionId: executionResult.transactionId,
          galaReceived: 0,
          tokenSold: amountIn,
          actualSlippage: 0,
          executionTime,
          error: status.error || 'Transaction failed'
        };
      }

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      logger.error('GalaChain swap execution error', {
        error: error.message || error,
        tokenIn,
        tokenOut,
        amountIn
      });

      return {
        success: false,
        transactionId: undefined,
        galaReceived: 0,
        tokenSold: amountIn,
        actualSlippage: 0,
        executionTime,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Create swap payload via DEX backend
   */
  private async createSwapPayload(params: {
    tokenIn: TokenClassKey;
    tokenOut: TokenClassKey;
    amountIn: string;
    fee: number;
    amountInMaximum: string;
    amountOutMinimum: string;
  }): Promise<any> {
    try {
      const response = await axios.post(
        `${this.dexBackendUrl}/v1/trade/swap`,
        {
          tokenIn: {
            collection: params.tokenIn.collection,
            category: params.tokenIn.category,
            type: params.tokenIn.type,
            additionalKey: params.tokenIn.additionalKey
          },
          tokenOut: {
            collection: params.tokenOut.collection,
            category: params.tokenOut.category,
            type: params.tokenOut.type,
            additionalKey: params.tokenOut.additionalKey
          },
          amountIn: params.amountIn,
          fee: params.fee,
          amountInMaximum: params.amountInMaximum,
          amountOutMinimum: params.amountOutMinimum,
          // sqrtPriceLimit can be calculated if needed
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      if (response.data?.data) {
        return {
          ...response.data.data,
          payload: response.data.data // Store the full payload
        };
      }

      return null;
    } catch (error: any) {
      logger.error('Failed to create swap payload', {
        error: error.message || error,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Sign the payload using GalaChain SDK
   */
  private async signPayload(payload: any): Promise<string> {
    try {
      // TODO: Implement actual signing using @gala-chain/api
      // For now, returning a placeholder
      // const privateKey = config.getGalaPrivateKey();
      // const signature = await sign(payload, privateKey);
      
      logger.warn('Signing not yet fully implemented - using placeholder');
      return '0x' + '0'.repeat(130); // Placeholder signature
      
    } catch (error) {
      logger.error('Failed to sign payload', { error });
      throw new Error('Payload signing failed');
    }
  }

  /**
   * Execute bundle via DEX backend
   */
  private async executeBundle(params: {
    payload: any;
    type: string;
    signature: string;
    user: string;
  }): Promise<{ transactionId: string } | null> {
    try {
      const response = await axios.post(
        `${this.dexBackendUrl}/v1/trade/bundle`,
        {
          payload: params.payload,
          type: params.type,
          signature: params.signature,
          user: params.user
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      if (response.data?.data?.data) {
        return {
          transactionId: response.data.data.data
        };
      }

      return null;
    } catch (error: any) {
      logger.error('Failed to execute bundle', {
        error: error.message || error,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForConfirmation(
    transactionId: string,
    timeoutMs: number = 30000
  ): Promise<{ status: string; error?: string; galaReceived?: number }> {
    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await axios.get(
          `${this.dexBackendUrl}/v1/trade/transaction-status`,
          {
            params: { id: transactionId },
            timeout: 5000
          }
        );

        if (response.data?.data) {
          const status = response.data.data.status;
          
          if (status === 'SUCCESS' || status === 'FAILED') {
            return {
              status,
              error: status === 'FAILED' ? response.data.data.error : undefined,
              galaReceived: response.data.data.galaReceived
            };
          }
          
          // Still pending, wait and retry
          logger.debug(`Transaction ${transactionId} still pending...`);
        }
      } catch (error) {
        logger.warn('Error checking transaction status', { error });
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout
    return {
      status: 'TIMEOUT',
      error: `Transaction confirmation timeout after ${timeoutMs}ms`
    };
  }

  /**
   * Parse token mint string to TokenClassKey
   */
  private parseTokenMint(mint: string): TokenClassKey {
    const parts = mint.split('|');
    const key = new TokenClassKey();
    key.collection = parts[0];
    key.category = parts[1];
    key.type = parts[2];
    key.additionalKey = parts[3];
    return key;
  }

  /**
   * Compare two token keys for ordering
   */
  private compareTokenKeys(token0: TokenClassKey, token1: TokenClassKey): number {
    if (token0.collection !== token1.collection) return token0.collection.localeCompare(token1.collection);
    if (token0.category !== token1.category) return token0.category.localeCompare(token1.category);
    if (token0.type !== token1.type) return token0.type.localeCompare(token1.type);
    return token0.additionalKey.localeCompare(token1.additionalKey);
  }

  /**
   * Determine appropriate fee tier for token pair
   */
  private determineFee(tokenIn: string, tokenOut: string): number {
    // Use 1% fee for most pairs (10000 = 1.00%)
    // Could be made more sophisticated based on pair volatility
    return DexFeePercentageTypes.FEE_1_PERCENT;
  }
}

