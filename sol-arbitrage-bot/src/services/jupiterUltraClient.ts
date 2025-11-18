/**
 * Jupiter Ultra Swap API Client
 * 
 * Provides access to Jupiter's Ultra Swap API with dynamic rate limits
 * that scale with swap volume. No Pro plans or payment required.
 * 
 * Documentation: https://dev.jup.ag/docs/ultra/get-started
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';

export interface UltraSwapOrderParams {
  inputMint: string;
  outputMint: string;
  amount: string; // raw amount in base units
  slippageBps: number;
  swapMode?: 'ExactIn' | 'ExactOut';
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number | 'auto';
}

export interface UltraSwapOrderResult {
  orderId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  swapTransaction: string; // base64 encoded transaction
  routePlan?: any[];
  platformFee?: {
    amount: string;
    feeBps: number;
  };
}

export interface UltraSwapExecuteParams {
  orderId: string;
  signedTransaction: string; // base64 encoded signed transaction
}

export interface UltraSwapExecuteResult {
  signature: string;
  orderId: string;
  status: 'success' | 'pending' | 'failed';
}

export class JupiterUltraClient {
  private apiKey: string | null = null;
  private baseUrl = 'https://api.jup.ag';
  private axiosInstance: AxiosInstance;

  constructor() {
    this.apiKey = process.env.JUPITER_ULTRA_API_KEY || null;
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      }
    });

    if (!this.apiKey) {
      logger.warn('⚠️ JUPITER_ULTRA_API_KEY not set. Ultra Swap API will work but with lower rate limits.');
      logger.info('💡 Get a free API key at https://portal.jup.ag/ for dynamic rate limits that scale with swap volume');
    } else {
      logger.info('✅ Jupiter Ultra Swap API key configured');
    }
  }

  /**
   * Get Order - Request a quote and swap transaction
   * This replaces the separate /quote and /swap calls in v1 API
   */
  async getOrder(params: UltraSwapOrderParams): Promise<UltraSwapOrderResult> {
    try {
      const response = await this.axiosInstance.post('/ultra/order', {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps,
        swapMode: params.swapMode || 'ExactIn',
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: params.wrapAndUnwrapSol !== undefined ? params.wrapAndUnwrapSol : true,
        dynamicComputeUnitLimit: params.dynamicComputeUnitLimit !== undefined ? params.dynamicComputeUnitLimit : true,
        prioritizationFeeLamports: params.prioritizationFeeLamports || 'auto'
      });

      if (!response.data) {
        throw new Error('No data returned from Ultra Swap API');
      }

      const data = response.data;

      return {
        orderId: data.orderId || data.id || '',
        inputMint: data.inputMint || params.inputMint,
        outputMint: data.outputMint || params.outputMint,
        inAmount: data.inAmount || data.inputAmount || '0',
        outAmount: data.outAmount || data.outputAmount || '0',
        priceImpactPct: data.priceImpactPct || data.priceImpact || 0,
        swapTransaction: data.swapTransaction || data.transaction || '',
        routePlan: data.routePlan || data.route,
        platformFee: data.platformFee
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const statusCode = error?.response?.status;
      
      logger.error('❌ Ultra Swap Get Order failed', {
        error: errorMessage,
        statusCode,
        params: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount
        }
      });

      throw new Error(`Ultra Swap Get Order failed: ${errorMessage}${statusCode ? ` (${statusCode})` : ''}`);
    }
  }

  /**
   * Execute Order - Sign and execute the swap transaction
   * Note: You can also sign locally and send directly to Solana network
   */
  async executeOrder(params: UltraSwapExecuteParams): Promise<UltraSwapExecuteResult> {
    try {
      const response = await this.axiosInstance.post('/ultra/execute', {
        orderId: params.orderId,
        signedTransaction: params.signedTransaction
      });

      if (!response.data) {
        throw new Error('No data returned from Ultra Swap Execute API');
      }

      const data = response.data;

      return {
        signature: data.signature || '',
        orderId: data.orderId || params.orderId,
        status: data.status || 'success'
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const statusCode = error?.response?.status;
      
      logger.error('❌ Ultra Swap Execute Order failed', {
        error: errorMessage,
        statusCode,
        orderId: params.orderId
      });

      throw new Error(`Ultra Swap Execute Order failed: ${errorMessage}${statusCode ? ` (${statusCode})` : ''}`);
    }
  }

  /**
   * Check if Ultra Swap API is available and configured
   */
  isAvailable(): boolean {
    return true; // API is always available, but rate limits depend on API key
  }

  /**
   * Check if API key is configured (for better rate limits)
   */
  hasApiKey(): boolean {
    return !!this.apiKey;
  }
}

