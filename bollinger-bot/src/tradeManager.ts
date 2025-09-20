/**
 * Trade Manager Module
 * Handles trade execution using GSwap SDK
 */

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

export interface TradeConfig {
  privateKey: string;
  walletAddress: string;
  buyAmount: number;    // Amount of GUSDC to spend on BUY trades
  sellAmount: number;   // Amount of GALA to sell on SELL trades
  slippageTolerance: number;
  galaToken: string;
  gusdcToken: string;
}

export interface TradeResult {
  success: boolean;
  transactionId?: string;
  amountIn?: number;
  amountOut?: number;
  feeTier?: number;
  error?: string;
}

export class TradeManager {
  private gSwap: GSwap | null = null;
  private config: TradeConfig;

  constructor(config: TradeConfig) {
    this.config = config;
  }

  /**
   * Initialize the GSwap SDK
   */
  private async initializeGSwap(): Promise<void> {
    if (!this.gSwap) {
      const signer = new PrivateKeySigner(this.config.privateKey);
      this.gSwap = new GSwap({ signer });
    }
  }

  /**
   * Execute a BUY trade (GUSDC -> GALA)
   */
  async executeBuy(): Promise<TradeResult> {
    try {
      await this.initializeGSwap();
      
      console.log(`🔄 Executing BUY: ${this.config.buyAmount} GUSDC -> GALA`);

      // Get quote
      const quote = await this.gSwap!.quoting.quoteExactInput(
        this.config.gusdcToken,
        this.config.galaToken,
        this.config.buyAmount
      );

      console.log(`📊 Best rate found on ${quote.feeTier} fee tier pool`);
      console.log(`💰 Expected output: ${quote.outTokenAmount.toString()} GALA`);

      // Calculate minimum output with slippage protection
      const amountOutMinimum = quote.outTokenAmount.multipliedBy(1 - this.config.slippageTolerance);
      console.log(`🛡️ Min output (${this.config.slippageTolerance * 100}% slippage): ${amountOutMinimum.toString()}`);

      // Execute the swap
      const result = await this.gSwap!.swaps.swap(
        this.config.gusdcToken,
        this.config.galaToken,
        quote.feeTier,
        {
          exactIn: this.config.buyAmount,
          amountOutMinimum: amountOutMinimum
        },
        this.config.walletAddress
      );

      console.log(`✅ BUY trade completed successfully!`);
      console.log(`🔗 Transaction: ${result.transactionId || 'N/A'}`);

      return {
        success: true,
        transactionId: result.transactionId,
        amountIn: this.config.buyAmount,
        amountOut: quote.outTokenAmount.toNumber(),
        feeTier: quote.feeTier
      };

    } catch (error: any) {
      console.error(`❌ BUY trade failed:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute a SELL trade (GALA -> GUSDC)
   */
  async executeSell(): Promise<TradeResult> {
    try {
      await this.initializeGSwap();
      
      console.log(`🔄 Executing SELL: ${this.config.sellAmount} GALA -> GUSDC`);

      // Get quote
      const quote = await this.gSwap!.quoting.quoteExactInput(
        this.config.galaToken,
        this.config.gusdcToken,
        this.config.sellAmount
      );

      console.log(`📊 Best rate found on ${quote.feeTier} fee tier pool`);
      console.log(`💰 Expected output: ${quote.outTokenAmount.toString()} GUSDC`);

      // Calculate minimum output with slippage protection
      const amountOutMinimum = quote.outTokenAmount.multipliedBy(1 - this.config.slippageTolerance);
      console.log(`🛡️ Min output (${this.config.slippageTolerance * 100}% slippage): ${amountOutMinimum.toString()}`);

      // Execute the swap
      const result = await this.gSwap!.swaps.swap(
        this.config.galaToken,
        this.config.gusdcToken,
        quote.feeTier,
        {
          exactIn: this.config.sellAmount,
          amountOutMinimum: amountOutMinimum
        },
        this.config.walletAddress
      );

      console.log(`✅ SELL trade completed successfully!`);
      console.log(`🔗 Transaction: ${result.transactionId || 'N/A'}`);

      return {
        success: true,
        transactionId: result.transactionId,
        amountIn: this.config.sellAmount,
        amountOut: quote.outTokenAmount.toNumber(),
        feeTier: quote.feeTier
      };

    } catch (error: any) {
      console.error(`❌ SELL trade failed:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if trade execution is properly configured
   */
  isConfigured(): boolean {
    return !!(this.config.privateKey && this.config.walletAddress);
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfigInfo(): { walletAddress: string; buyAmount: number; sellAmount: number; slippageTolerance: number } {
    return {
      walletAddress: this.config.walletAddress,
      buyAmount: this.config.buyAmount,
      sellAmount: this.config.sellAmount,
      slippageTolerance: this.config.slippageTolerance
    };
  }
}
