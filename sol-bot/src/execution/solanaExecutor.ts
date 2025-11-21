/**
 * Solana Executor
 * Handles swap execution on Solana via Jupiter aggregator
 */

import axios from 'axios';
import { Connection, PublicKey, VersionedTransaction, Keypair, Transaction } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { SolanaResult } from '../types';
import bs58 from 'bs58';

export class SolanaExecutor {
  private connection: Connection;
  private jupiterApiUrl = 'https://quote-api.jup.ag/v6';
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection(
      config.getSolanaRpcEndpoint(),
      'confirmed'
    );
    
    // Load wallet from private key
    const privateKeyString = config.getSolanaPrivateKey();
    const privateKeyBytes = bs58.decode(privateKeyString);
    this.wallet = Keypair.fromSecretKey(privateKeyBytes);
    
    logger.info('Solana Executor initialized', {
      rpcEndpoint: config.getSolanaRpcEndpoint(),
      walletAddress: this.wallet.publicKey.toString()
    });
  }

  /**
   * Execute a swap on Solana via Jupiter
   */
  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    decimals: number,
    slippageBps: number = 50 // 0.5% slippage
  ): Promise<SolanaResult> {
    const startTime = Date.now();

    try {
      logger.info('Executing Solana swap via Jupiter', {
        inputMint,
        outputMint,
        amount,
        decimals
      });

      // Step 1: Get quote from Jupiter
      const quote = await this.getQuote(inputMint, outputMint, amount, decimals, slippageBps);
      
      if (!quote) {
        throw new Error('Failed to get Jupiter quote');
      }

      logger.debug('Jupiter quote received', {
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
        priceImpact: quote.priceImpactPct
      });

      // Step 2: Get serialized transaction
      const swapTransaction = await this.getSwapTransaction(quote);
      
      if (!swapTransaction) {
        throw new Error('Failed to get swap transaction');
      }

      // Step 3: Deserialize and sign transaction
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(swapTransaction, 'base64')
      );
      
      transaction.sign([this.wallet]);

      logger.debug('Transaction signed', {
        signature: bs58.encode(transaction.signatures[0])
      });

      // Step 4: Send and confirm transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3
        }
      );

      logger.info('Transaction sent to Solana', { signature });

      // Step 5: Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(
        signature,
        'confirmed'
      );

      const executionTime = Date.now() - startTime;

      if (confirmation.value.err) {
        logger.error('Solana swap failed', {
          signature,
          error: confirmation.value.err
        });

        return {
          success: false,
          signature,
          tokenReceived: 0,
          costSOL: 0,
          actualSlippage: 0,
          executionTime,
          error: 'Transaction failed: ' + JSON.stringify(confirmation.value.err)
        };
      }

      // Calculate actual results
      const tokenReceived = parseInt(quote.outAmount) / Math.pow(10, 9); // SOL decimals
      const costSOL = amount;

      logger.info('Solana swap completed successfully', {
        signature,
        tokenReceived,
        costSOL,
        executionTime: `${executionTime}ms`
      });

      return {
        success: true,
        signature,
        tokenReceived,
        costSOL,
        actualSlippage: parseFloat(quote.priceImpactPct || '0'),
        executionTime,
        error: undefined
      };

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      logger.error('Solana swap execution error', {
        error: error.message || error,
        inputMint,
        outputMint,
        amount
      });

      return {
        success: false,
        signature: undefined,
        tokenReceived: 0,
        costSOL: amount,
        actualSlippage: 0,
        executionTime,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Get quote from Jupiter
   */
  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    decimals: number,
    slippageBps: number
  ): Promise<any> {
    try {
      const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));
      
      const response = await axios.get(`${this.jupiterApiUrl}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: amountInSmallestUnit,
          slippageBps,
          onlyDirectRoutes: false,
          asLegacyTransaction: false
        },
        timeout: 10000
      });

      if (response.data) {
        return response.data;
      }

      return null;
    } catch (error: any) {
      logger.error('Failed to get Jupiter quote', {
        error: error.message || error,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get swap transaction from Jupiter
   */
  private async getSwapTransaction(quote: any): Promise<string | null> {
    try {
      const response = await axios.post(
        `${this.jupiterApiUrl}/swap`,
        {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto'
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      if (response.data?.swapTransaction) {
        return response.data.swapTransaction;
      }

      return null;
    } catch (error: any) {
      logger.error('Failed to get swap transaction', {
        error: error.message || error,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get SOL balance
   */
  async getSOLBalance(): Promise<number> {
    try {
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      logger.error('Failed to get SOL balance', { error });
      return 0;
    }
  }

  /**
   * Get token balance
   */
  async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      // TODO: Implement SPL token balance fetching
      // This requires @solana/spl-token package
      logger.warn('Token balance fetching not yet fully implemented');
      return 0;
    } catch (error) {
      logger.error('Failed to get token balance', { error });
      return 0;
    }
  }
}

