/**
 * Jupiter Service Wrapper
 * 
 * Provides a unified interface for Jupiter swaps, supporting both:
 * 1. Direct Jupiter API calls (default/fallback)
 * 2. MCP server integration (when enabled via USE_JUPITER_MCP=true)
 */

import axios from 'axios';
import BigNumber from 'bignumber.js';
import logger from '../utils/logger';
import { JupiterMcpClient, JupiterMcpSwapQuoteParams, JupiterMcpSwapQuoteResult } from './jupiterMcpClient';

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string; // raw amount in base units
  slippageBps: number;
  swapMode?: 'ExactIn' | 'ExactOut';
}

export interface JupiterQuoteResult {
  inAmount: string;
  outAmount: string;
  priceImpact?: number;
  routePlan?: any;
  priceImpactPct?: number;
}

export interface JupiterSwapParams {
  quoteResponse: any;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: string;
}

export interface JupiterSwapResult {
  swapTransaction: string; // base64 encoded transaction
}

export class JupiterService {
  private useMcp: boolean;
  private mcpClient: JupiterMcpClient | null = null;
  private jupiterApiBases: string[];

  constructor() {
    this.useMcp = (process.env.USE_JUPITER_MCP || '').toLowerCase() === 'true';
    this.jupiterApiBases = [
      process.env.JUPITER_API_BASE || 'https://lite-api.jup.ag/swap/v1'
    ];

    if (this.useMcp) {
      this.mcpClient = new JupiterMcpClient(process.env.JUPITER_MCP_SERVER_PATH);
      logger.info('🔄 Jupiter Service: Using MCP mode');
    } else {
      logger.info('🔄 Jupiter Service: Using direct API mode');
    }
  }

  /**
   * Initialize the service (connect to MCP if enabled)
   */
  async initialize(): Promise<void> {
    if (this.useMcp && this.mcpClient) {
      try {
        await this.mcpClient.connect();
        logger.info('✅ Jupiter MCP client initialized');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('⚠️ Failed to initialize MCP client, falling back to direct API', { error: errorMessage });
        this.useMcp = false;
        this.mcpClient = null;
      }
    }
  }

  /**
   * Close the service (disconnect from MCP if connected)
   */
  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
    }
  }

  /**
   * Get a swap quote from Jupiter
   */
  async getQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult | null> {
    if (this.useMcp && this.mcpClient) {
      try {
        const mcpParams: JupiterMcpSwapQuoteParams = {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        };

        const result = await this.mcpClient.getSwapQuote(mcpParams);
        if (result) {
          return {
            inAmount: result.inAmount,
            outAmount: result.outAmount,
            priceImpact: result.priceImpact,
            routePlan: result.route,
            priceImpactPct: result.priceImpact,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('⚠️ MCP quote failed, falling back to direct API', { error: errorMessage });
        // Fall through to direct API
      }
    }

    // Direct API call (fallback or default)
    return this.getQuoteDirect(params);
  }

  /**
   * Get quote directly from Jupiter API
   */
  private async getQuoteDirect(params: JupiterQuoteParams): Promise<JupiterQuoteResult | null> {
    let lastErr: any;
    
    for (const base of this.jupiterApiBases) {
      try {
        const response = await axios.get(`${base}/quote`, {
          params: {
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            slippageBps: params.slippageBps,
            swapMode: params.swapMode || 'ExactOut',
          },
          timeout: 15000
        });

        if (response.data) {
          return {
            inAmount: response.data.inAmount,
            outAmount: response.data.outAmount,
            priceImpact: response.data.priceImpact,
            routePlan: response.data.routePlan,
            priceImpactPct: response.data.priceImpactPct,
          };
        }
      } catch (e) {
        lastErr = e;
        logger.debug('Jupiter /quote failed on host', { 
          base, 
          error: e instanceof Error ? e.message : String(e) 
        });
      }
    }

    if (lastErr) {
      logger.warn('⚠️ All Jupiter /quote hosts failed', { 
        error: lastErr instanceof Error ? lastErr.message : String(lastErr) 
      });
    }

    return null;
  }

  /**
   * Execute a swap using Jupiter
   * Note: MCP executeSwap handles transaction building and signing internally,
   * so we need to handle this differently than direct API which returns a transaction
   */
  async executeSwap(params: JupiterSwapParams): Promise<JupiterSwapResult | null> {
    // For MCP mode, we would need to call executeSwap which handles everything
    // But since the current executor expects a transaction to sign, we'll use direct API for swaps
    // MCP can be used for quotes only, or we'd need to refactor the executor
    
    // For now, always use direct API for swaps since MCP executeSwap returns a signature directly
    // and doesn't return a transaction we can sign with our own wallet setup
    return this.executeSwapDirect(params);
  }

  /**
   * Get swap transaction directly from Jupiter API
   */
  private async executeSwapDirect(params: JupiterSwapParams): Promise<JupiterSwapResult | null> {
    let lastErr: any;

    for (const base of this.jupiterApiBases) {
      try {
        const response = await axios.post(`${base}/swap`, {
          quoteResponse: params.quoteResponse,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
          dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
          prioritizationFeeLamports: params.prioritizationFeeLamports || 'auto',
        }, { timeout: 20000 });

        if (response.data?.swapTransaction) {
          return {
            swapTransaction: response.data.swapTransaction,
          };
        }
      } catch (e) {
        lastErr = e;
        logger.debug('Jupiter /swap failed on host', { 
          base, 
          error: e instanceof Error ? e.message : String(e) 
        });
      }
    }

    if (lastErr) {
      logger.warn('⚠️ All Jupiter /swap hosts failed', { 
        error: lastErr instanceof Error ? lastErr.message : String(lastErr) 
      });
    }

    return null;
  }

  /**
   * Execute swap using MCP (returns signature directly)
   * This is an alternative method when you want MCP to handle the full swap execution
   */
  async executeSwapViaMcp(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps: number = 50
  ): Promise<string | null> {
    if (!this.useMcp || !this.mcpClient) {
      throw new Error('MCP not enabled or client not initialized');
    }

    try {
      const result = await this.mcpClient.executeSwap({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      });

      if (result.signature) {
        return result.signature;
      } else if (result.error) {
        throw new Error(result.error);
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ MCP swap execution failed', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Check if MCP is enabled
   */
  isMcpEnabled(): boolean {
    return this.useMcp && this.mcpClient !== null;
  }
}

