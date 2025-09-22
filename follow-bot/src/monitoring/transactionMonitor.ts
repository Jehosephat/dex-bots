/**
 * Transaction Monitoring System
 * 
 * Filters and processes GalaSwap transactions from target wallets,
 * building upon the existing BatchSubmit detection system.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/errorHandler';
import { StateManager } from '../utils/stateManager';
import { ConfigurationManager } from '../config/configManager';

// Transaction types and interfaces
export interface GalaSwapTransaction {
  id: string;
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  logs: TransactionLog[];
  method: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOut?: string;
  recipient?: string;
  fee?: string;
  zeroForOne?: boolean;
}

export interface TransactionLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
  transactionIndex: number;
  blockNumber: number;
  blockHash: string;
  removed: boolean;
}

export interface WalletActivity {
  walletAddress: string;
  transaction: GalaSwapTransaction;
  activityType: 'swap' | 'add_liquidity' | 'remove_liquidity' | 'transfer' | 'approval' | 'other';
  detectedAt: number;
  blockNumber: number;
  transactionHash: string;
}

export interface TransactionFilter {
  targetWallets: string[];
  whitelistedTokens: string[];
  blacklistedTokens: string[];
  minTransactionValue: number;
  maxTransactionValue: number;
  enabledMethods: string[];
}

export interface ProcessedTransaction {
  id: string;
  originalTransaction: GalaSwapTransaction;
  walletActivity: WalletActivity;
  processedAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  error?: string;
}

export class TransactionMonitor extends EventEmitter {
  private static instance: TransactionMonitor;
  private configManager: ConfigurationManager;
  private stateManager: StateManager;
  private errorHandler: ErrorHandler;
  private transactionQueue: ProcessedTransaction[] = [];
  private processedTransactions: Set<string> = new Set();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private filter: TransactionFilter;

  private constructor() {
    super();
    this.configManager = ConfigurationManager.getInstance();
    this.stateManager = StateManager.getInstance();
    this.errorHandler = ErrorHandler.getInstance();
    this.filter = this.initializeFilter();
  }

  public static getInstance(): TransactionMonitor {
    if (!TransactionMonitor.instance) {
      TransactionMonitor.instance = new TransactionMonitor();
    }
    return TransactionMonitor.instance;
  }

  /**
   * Initialize the transaction monitor
   */
  public async initialize(): Promise<void> {
    logger.info('🔍 Initializing Transaction Monitor...');
    
    try {
      // Load configuration
      this.updateFilter();
      
      // Start processing queue
      this.startProcessing();
      
      // Register health check
      const healthCheckSystem = (this.errorHandler as any).healthCheckSystem;
      if (healthCheckSystem) {
        healthCheckSystem.registerCheck('transaction-monitor', async () => {
          return this.isHealthy();
        });
      }

      logger.info('✅ Transaction Monitor initialized successfully');
      logger.info(`📊 Monitoring ${this.filter.targetWallets.length} target wallets`);
      logger.info(`🎯 Whitelisted tokens: ${this.filter.whitelistedTokens.join(', ')}`);
      logger.info(`🚫 Blacklisted tokens: ${this.filter.blacklistedTokens.join(', ')}`);

    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        { phase: 'transaction_monitor_initialization' }
      );
      throw error;
    }
  }

  /**
   * Process a block received from WebSocket
   */
  public processBlock(block: any): void {
    try {
      // Handle both parsedBlock.transactions and direct transactions
      const transactions = block.parsedBlock?.transactions || block.transactions;
      const blockNumber = block.parsedBlock?.blockNumber || block.blockNumber;

      if (!transactions || !Array.isArray(transactions)) {
        return;
      }

      logger.info(`🔍 Processing block ${blockNumber} with ${transactions.length} transactions`);

      for (const transaction of transactions) {
        logger.debug(`📝 Processing transaction: ${transaction.id}`);
        this.processTransaction(transaction, blockNumber);
      }

    } catch (error) {
      logger.error('❌ Error processing block:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'block_processing' }
      );
    }
  }

  /**
   * Process a single transaction
   */
  private processTransaction(transaction: any, blockNumber: number): void {
    try {
      // Check if transaction involves target wallets
      const targetWallet = this.findTargetWallet(transaction);
      if (!targetWallet) {
        logger.debug(`⏭️ Transaction ${transaction.id} not from target wallet, skipping`);
        return; // Not a target wallet transaction
      }
      
      logger.info(`🎯 Found target wallet transaction: ${transaction.id} from ${targetWallet}`);

      // Check for BatchSubmit transactions (DEX operations)
      if (this.isBatchSubmitTransaction(transaction)) {
        this.processBatchSubmitTransaction(transaction, blockNumber, targetWallet);
      } else {
        // Process other types of transactions
        this.processRegularTransaction(transaction, blockNumber, targetWallet);
      }

    } catch (error) {
      logger.error('❌ Error processing transaction:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'transaction_processing' }
      );
    }
  }

  /**
   * Check if transaction involves any target wallet
   */
  private findTargetWallet(transaction: any): string | null {
    const targetWallets = this.filter.targetWallets;
    
    // Check transaction from/to addresses (for regular transactions)
    if (transaction.from && targetWallets.includes(transaction.from.toLowerCase())) {
      return transaction.from.toLowerCase();
    }
    
    if (transaction.to && targetWallets.includes(transaction.to.toLowerCase())) {
      return transaction.to.toLowerCase();
    }

    // Check transaction actions for wallet addresses (for BatchSubmit transactions)
    if (transaction.actions && Array.isArray(transaction.actions)) {
      for (const action of transaction.actions) {
        if (action.args && Array.isArray(action.args) && action.args.length >= 2) {
          const actionType = action.args[0];
          
          // Check for BatchSubmit transactions
          if (actionType === 'DexV3Contract:BatchSubmit') {
            try {
              const batchData = JSON.parse(action.args[1]);
              if (batchData.operations && Array.isArray(batchData.operations)) {
                for (const operation of batchData.operations) {
                  if (operation.dto && operation.dto.recipient) {
                    const recipient = operation.dto.recipient.toLowerCase();
                    if (targetWallets.includes(recipient)) {
                      return recipient;
                    }
                  }
                }
              }
            } catch (error) {
              logger.debug('Failed to parse BatchSubmit data:', error);
            }
          }
          
          // Check other action arguments for wallet addresses
          for (const arg of action.args) {
            if (typeof arg === 'string' && targetWallets.includes(arg.toLowerCase())) {
              return arg.toLowerCase();
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if transaction is a BatchSubmit transaction
   */
  private isBatchSubmitTransaction(transaction: any): boolean {
    if (!transaction.actions || transaction.actions.length === 0) {
      return false;
    }

    const firstAction = transaction.actions[0];
    if (firstAction.args && firstAction.args.length > 0) {
      const actionType = firstAction.args[0];
      return actionType === 'DexV3Contract:BatchSubmit';
    }

    return false;
  }

  /**
   * Process BatchSubmit transaction (DEX operations)
   */
  private processBatchSubmitTransaction(transaction: any, blockNumber: number, targetWallet: string): void {
    try {
      const firstAction = transaction.actions[0];
      if (firstAction.args.length < 2) {
        return;
      }

      const batchData = JSON.parse(firstAction.args[1]);
      if (!batchData.operations || !Array.isArray(batchData.operations)) {
        return;
      }

      logger.info(`🎯 Processing BatchSubmit from wallet ${targetWallet} in block ${blockNumber}`);

      for (const operation of batchData.operations) {
        this.processDEXOperation(operation, transaction, blockNumber, targetWallet);
      }

    } catch (error) {
      logger.error('❌ Error processing BatchSubmit transaction:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'batchsubmit_processing' }
      );
    }
  }

  /**
   * Process individual DEX operation
   */
  private processDEXOperation(operation: any, transaction: any, blockNumber: number, targetWallet: string): void {
    try {
      const method = operation.method;
      const dto = operation.dto || {};
      const uniqueId = operation.uniqueId;

      // Check if operation method is enabled
      if (!this.filter.enabledMethods.includes(method)) {
        return;
      }

      // Extract token information from the real GalaChain structure
      const tokenIn = dto.token0?.collection || 'Unknown';
      const tokenOut = dto.token1?.collection || 'Unknown';
      const recipient = dto.recipient || targetWallet;
      const fee = dto.fee || '0';
      const zeroForOne = dto.zeroForOne;
      
      // For swaps, we need to extract amounts from the chaincodeResponse payload
      let amountIn = '0';
      let amountOut = '0';
      
      if (method === 'Swap') {
        // Try to extract from chaincodeResponse payload
        try {
          const chaincodeResponse = transaction.chaincodeResponse;
          if (chaincodeResponse && chaincodeResponse.payload) {
            const payload = JSON.parse(chaincodeResponse.payload);
            if (payload.Data && payload.Data[0] && payload.Data[0].Data) {
              const swapData = payload.Data[0].Data;
              const amount0 = parseFloat(swapData.amount0 || '0');
              const amount1 = parseFloat(swapData.amount1 || '0');
              
              // Determine input/output based on zeroForOne and amounts
              if (zeroForOne) {
                // Selling token0 (GALA) for token1 (GUSDC)
                amountIn = Math.abs(amount0).toString();
                amountOut = Math.abs(amount1).toString();
              } else {
                // Selling token1 (GUSDC) for token0 (GALA)
                amountIn = Math.abs(amount1).toString();
                amountOut = Math.abs(amount0).toString();
              }
            }
          }
        } catch (error) {
          logger.debug('Failed to parse chaincodeResponse payload:', error);
        }
        
        // Fallback to dto fields if chaincodeResponse parsing failed
        if (amountIn === '0' && amountOut === '0') {
          amountIn = Math.abs(parseFloat(dto.amount || dto.amountInMaximum || '0')).toString();
          amountOut = Math.abs(parseFloat(dto.amountOutMinimum || '0')).toString();
        }
      } else {
        // For non-swap operations, use the original logic with absolute values
        amountIn = Math.abs(parseFloat(dto.amount || dto.amount0Desired || '0')).toString();
        amountOut = Math.abs(parseFloat(dto.amount1Desired || '0')).toString();
      }

      // Determine correct tokenIn and tokenOut based on zeroForOne
      let finalTokenIn = tokenIn;
      let finalTokenOut = tokenOut;
      
      if (method === 'Swap' && zeroForOne !== undefined) {
        if (zeroForOne) {
          // Selling token0 (GALA) for token1 (GUSDC)
          finalTokenIn = tokenIn; // GALA
          finalTokenOut = tokenOut; // GUSDC
        } else {
          // Selling token1 (GUSDC) for token0 (GALA)
          finalTokenIn = tokenOut; // GUSDC
          finalTokenOut = tokenIn; // GALA
        }
      }

      // Create transaction object
      const galaSwapTransaction: GalaSwapTransaction = {
        id: uniqueId || `${transaction.id}_${Date.now()}`,
        hash: transaction.id,
        blockNumber: blockNumber,
        timestamp: Date.now(),
        from: targetWallet,
        to: recipient,
        value: '0',
        gasUsed: '0',
        gasPrice: '0',
        logs: [],
        method: method,
        tokenIn: finalTokenIn,
        tokenOut: finalTokenOut,
        amountIn: amountIn,
        amountOut: amountOut,
        recipient: recipient,
        fee: fee,
        zeroForOne: zeroForOne
      };

      // Determine activity type
      const activityType = this.determineActivityType(method, dto);

      // Create wallet activity
      const walletActivity: WalletActivity = {
        walletAddress: targetWallet,
        transaction: galaSwapTransaction,
        activityType: activityType,
        detectedAt: Date.now(),
        blockNumber: blockNumber,
        transactionHash: transaction.id
      };
      
      // Debug logging for transaction amounts
      logger.debug(`🔍 Created wallet activity with amounts:`, {
        amountIn: galaSwapTransaction.amountIn,
        amountOut: galaSwapTransaction.amountOut,
        tokenIn: galaSwapTransaction.tokenIn,
        tokenOut: galaSwapTransaction.tokenOut,
        method: galaSwapTransaction.method
      });

      // Apply filters
      if (this.passesFilters(walletActivity)) {
        this.addToQueue(walletActivity);
      }

    } catch (error) {
      logger.error('❌ Error processing DEX operation:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'dex_operation_processing' }
      );
    }
  }

  /**
   * Process regular (non-DEX) transaction
   */
  private processRegularTransaction(transaction: any, blockNumber: number, targetWallet: string): void {
    try {
      const galaSwapTransaction: GalaSwapTransaction = {
        id: transaction.id,
        hash: transaction.id,
        blockNumber: blockNumber,
        timestamp: Date.now(),
        from: transaction.from || targetWallet,
        to: transaction.to || '',
        value: transaction.value || '0',
        gasUsed: transaction.gasUsed || '0',
        gasPrice: transaction.gasPrice || '0',
        logs: transaction.logs || [],
        method: 'transfer'
      };

      const walletActivity: WalletActivity = {
        walletAddress: targetWallet,
        transaction: galaSwapTransaction,
        activityType: 'transfer',
        detectedAt: Date.now(),
        blockNumber: blockNumber,
        transactionHash: transaction.id
      };

      if (this.passesFilters(walletActivity)) {
        this.addToQueue(walletActivity);
      }

    } catch (error) {
      logger.error('❌ Error processing regular transaction:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'regular_transaction_processing' }
      );
    }
  }

  /**
   * Determine activity type from method and DTO
   */
  private determineActivityType(method: string, _dto: any): 'swap' | 'add_liquidity' | 'remove_liquidity' | 'transfer' | 'approval' | 'other' {
    switch (method) {
      case 'Swap':
        return 'swap';
      case 'AddLiquidity':
        return 'add_liquidity';
      case 'RemoveLiquidity':
        return 'remove_liquidity';
      case 'Transfer':
        return 'transfer';
      case 'Approval':
        return 'approval';
      default:
        return 'other';
    }
  }

  /**
   * Check if wallet activity passes all filters
   */
  private passesFilters(walletActivity: WalletActivity): boolean {
    // Check token whitelist/blacklist
    if (walletActivity.transaction.tokenIn && this.filter.blacklistedTokens.includes(walletActivity.transaction.tokenIn)) {
      return false;
    }
    if (walletActivity.transaction.tokenOut && this.filter.blacklistedTokens.includes(walletActivity.transaction.tokenOut)) {
      return false;
    }

    // Check whitelist (if not empty, only allow whitelisted tokens)
    if (this.filter.whitelistedTokens.length > 0) {
      const hasWhitelistedToken = 
        (walletActivity.transaction.tokenIn && this.filter.whitelistedTokens.includes(walletActivity.transaction.tokenIn)) ||
        (walletActivity.transaction.tokenOut && this.filter.whitelistedTokens.includes(walletActivity.transaction.tokenOut));
      
      if (!hasWhitelistedToken) {
        return false;
      }
    }

    // Check transaction value limits
    const value = parseFloat(walletActivity.transaction.value || '0');
    if (value < this.filter.minTransactionValue || value > this.filter.maxTransactionValue) {
      return false;
    }

    return true;
  }

  /**
   * Add wallet activity to processing queue
   */
  private addToQueue(walletActivity: WalletActivity): void {
    const transactionId = walletActivity.transaction.id;
    
    // Check for duplicates
    if (this.processedTransactions.has(transactionId)) {
      logger.debug(`🔄 Duplicate transaction detected, skipping: ${transactionId}`);
      return;
    }

    const processedTransaction: ProcessedTransaction = {
      id: transactionId,
      originalTransaction: walletActivity.transaction,
      walletActivity: walletActivity,
      processedAt: Date.now(),
      status: 'pending',
      retryCount: 0
    };

    this.transactionQueue.push(processedTransaction);
    this.processedTransactions.add(transactionId);

    logger.info(`📥 Added transaction to queue: ${transactionId} (${walletActivity.activityType})`);
    logger.info(`   Wallet: ${walletActivity.walletAddress}`);
    logger.info(`   Method: ${walletActivity.transaction.method}`);
    if (walletActivity.transaction.tokenIn && walletActivity.transaction.tokenOut) {
      logger.info(`   Tokens: ${walletActivity.transaction.tokenIn} → ${walletActivity.transaction.tokenOut}`);
    }

    // Emit event for immediate processing if needed
    this.emit('transactionDetected', walletActivity);
  }

  /**
   * Start processing transaction queue
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      return;
    }

    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, 1000); // Process every second

    logger.info('🔄 Transaction queue processing started');
  }

  /**
   * Process transaction queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.transactionQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const transaction = this.transactionQueue.shift();
      if (!transaction) {
        return;
      }

      await this.processTransactionFromQueue(transaction);

    } catch (error) {
      logger.error('❌ Error processing transaction queue:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'queue_processing' }
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process individual transaction from queue
   */
  private async processTransactionFromQueue(processedTransaction: ProcessedTransaction): Promise<void> {
    try {
      processedTransaction.status = 'processing';
      
      logger.info(`🔄 Processing transaction: ${processedTransaction.id}`);

      // Emit wallet activity event
      this.emit('walletActivity', processedTransaction.walletActivity);

      // Update state manager
      this.stateManager.addTrade({
        id: processedTransaction.id,
        targetWallet: processedTransaction.walletActivity.walletAddress,
        originalTrade: {
          type: this.determineTradeType(
            processedTransaction.walletActivity.transaction.tokenIn || 'Unknown',
            processedTransaction.walletActivity.transaction.tokenOut || 'Unknown'
          ),
          tokenIn: processedTransaction.walletActivity.transaction.tokenIn || 'Unknown',
          tokenOut: processedTransaction.walletActivity.transaction.tokenOut || 'Unknown',
          amountIn: parseFloat(processedTransaction.walletActivity.transaction.amountIn || '0'),
          amountOut: parseFloat(processedTransaction.walletActivity.transaction.amountOut || '0')
        },
        copiedTrade: {
          type: this.determineTradeType(
            processedTransaction.walletActivity.transaction.tokenIn || 'Unknown',
            processedTransaction.walletActivity.transaction.tokenOut || 'Unknown'
          ),
          tokenIn: processedTransaction.walletActivity.transaction.tokenIn || 'Unknown',
          tokenOut: processedTransaction.walletActivity.transaction.tokenOut || 'Unknown',
          amountIn: parseFloat(processedTransaction.walletActivity.transaction.amountIn || '0'),
          amountOut: parseFloat(processedTransaction.walletActivity.transaction.amountOut || '0'),
          transactionHash: processedTransaction.walletActivity.transactionHash,
          status: 'pending'
        },
        copyMode: 'proportional',
        executionDelay: 30, // Default execution delay
        slippage: 0.05, // Default slippage tolerance
        timestamp: processedTransaction.walletActivity.detectedAt
      });

      processedTransaction.status = 'completed';
      logger.info(`✅ Transaction processed successfully: ${processedTransaction.id}`);

    } catch (error) {
      processedTransaction.status = 'failed';
      processedTransaction.error = (error as Error).message;
      processedTransaction.retryCount++;

      logger.error(`❌ Failed to process transaction ${processedTransaction.id}:`, error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'transaction_processing', transactionId: processedTransaction.id }
      );

      // Retry if retry count is below limit
      if (processedTransaction.retryCount < 3) {
        this.transactionQueue.push(processedTransaction);
        logger.info(`🔄 Retrying transaction ${processedTransaction.id} (attempt ${processedTransaction.retryCount + 1})`);
      }
    }
  }

  /**
   * Initialize transaction filter from configuration
   */
  private initializeFilter(): TransactionFilter {
    const walletConfig = this.configManager.getWalletConfig();

    return {
      targetWallets: walletConfig.targetWallets
        .filter((w: any) => w.enabled)
        .map((w: any) => w.address.toLowerCase()),
      whitelistedTokens: walletConfig.globalSettings.whitelistedTokens || [],
      blacklistedTokens: walletConfig.globalSettings.blacklistedTokens || [],
      minTransactionValue: 0,
      maxTransactionValue: Number.MAX_SAFE_INTEGER,
      enabledMethods: ['Swap', 'AddLiquidity', 'RemoveLiquidity', 'Transfer', 'Approval']
    };
  }

  /**
   * Update filter from current configuration
   */
  public updateFilter(): void {
    this.filter = this.initializeFilter();
    logger.info('🔄 Transaction filter updated');
  }

  /**
   * Get current filter configuration
   */
  public getFilter(): TransactionFilter {
    return { ...this.filter };
  }

  /**
   * Get transaction queue status
   */
  public getQueueStatus(): { queueLength: number; isProcessing: boolean; processedCount: number } {
    return {
      queueLength: this.transactionQueue.length,
      isProcessing: this.isProcessing,
      processedCount: this.processedTransactions.size
    };
  }

  /**
   * Check if transaction monitor is healthy
   */
  private isHealthy(): boolean {
    return this.transactionQueue.length < 1000 && // Queue not too large
           this.processedTransactions.size < 10000 && // Not too many processed
           !this.isProcessing; // Not stuck processing
  }

  /**
   * Shutdown transaction monitor
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Transaction Monitor...');
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Process remaining queue items
    while (this.transactionQueue.length > 0) {
      await this.processQueue();
    }

    logger.info('✅ Transaction Monitor shutdown complete');
  }

  /**
   * Determine trade type based on token direction
   */
  private determineTradeType(tokenIn: string, tokenOut: string): 'buy' | 'sell' {
    // Common base tokens that are typically "sold" to get other tokens
    const baseTokens = ['GUSDC', 'GUSDT', 'GWETH'];
    
    // If selling a base token to get another token, it's a "buy" of the output token
    if (baseTokens.includes(tokenIn.toUpperCase())) {
      return 'buy';
    }
    
    // If selling a non-base token to get a base token, it's a "sell" of the input token
    if (baseTokens.includes(tokenOut.toUpperCase())) {
      return 'sell';
    }
    
    // Default to 'buy' for other cases (could be improved with more logic)
    return 'buy';
  }
}
