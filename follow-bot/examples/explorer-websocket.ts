import { io, Socket } from 'socket.io-client';
import { logInfo, logError, logWarn, logWebSocketEvent } from '../utils/logger.js';
import { ChainEvent, PoolUpdateEvent, TransactionEvent, SwapEvent } from '../types/index.js';
import { MarketDataManager } from '../services/market-data-manager.js';

export interface ExplorerWebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  timeout: number;
  forceNew: boolean;
}

export interface ExplorerEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  blockNumber?: number;
  transactionHash?: string;
}

export class ExplorerWebSocketClient {
  private socket: Socket | null = null;
  private config: ExplorerWebSocketConfig;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private eventHandlers: Map<string, ((data: any) => void)[]> = new Map();
  private lastBlockNumber = 0;
  private lastTransactionHash = '';
  private marketDataManager?: MarketDataManager;

  constructor(config: ExplorerWebSocketConfig, marketDataManager?: MarketDataManager) {
    this.config = config;
    if (marketDataManager) {
      this.marketDataManager = marketDataManager;
    }
  }

  /**
   * Set the market data manager for pool state updates
   */
  public setMarketDataManager(marketDataManager: MarketDataManager): void {
    this.marketDataManager = marketDataManager;
    logInfo('Market data manager connected to explorer WebSocket');
  }

  /**
   * Connect to the Explorer API WebSocket
   */
  public async connect(): Promise<void> {
    if (this.socket?.connected || this.isConnecting) {
      logWarn('Explorer WebSocket already connected or connecting');
      return;
    }

    this.isConnecting = true;
    logInfo('Attempting to connect to Socket.IO at', { url: this.config.url });

    try {
      this.socket = io(this.config.url, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });
      
      this.setupEventHandlers();
    } catch (error) {
      this.isConnecting = false;
      logError('Error creating Socket.IO connection:', error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from Explorer WebSocket
   */
  public disconnect(): void {
    logInfo('Disconnecting from Explorer WebSocket');
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Send a message to Explorer WebSocket
   */
  public send(eventName: string, data: any): void {
    if (this.socket?.connected) {
      try {
        this.socket.emit(eventName, data);
        logWebSocketEvent('EXPLORER_SENT', { type: eventName, data } as unknown as Record<string, unknown>);
      } catch (error) {
        logError('Failed to send Explorer WebSocket message', error as Error, { eventName, data });
      }
    } else {
      logWarn('Explorer WebSocket not connected, cannot send message', { eventName, data });
    }
  }

  /**
   * Subscribe to specific event types
   */
  public subscribe(eventType: string, handler: (data: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Unsubscribe from specific event types
   */
  public unsubscribe(eventType: string, handler: (data: any) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Check if Explorer WebSocket is connected
   */
  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Get connection status
   */
  public getStatus(): {
    connected: boolean;
    id: string | undefined;
    reconnectAttempts: number;
    lastBlockNumber: number;
    lastTransactionHash: string;
  } {
    return {
      connected: this.isConnected(),
      id: this.socket?.id,
      reconnectAttempts: this.reconnectAttempts,
      lastBlockNumber: this.lastBlockNumber,
      lastTransactionHash: this.lastTransactionHash,
    };
  }

  /**
   * Subscribe to chain events
   */
  private subscribeToChainEvents(): void {
    if (!this.socket?.connected) return;

    logInfo('Subscribing to Explorer chain events...');

    // Subscribe to blocks (this is the main event we want)
    this.socket.emit('subscribe', 'blocks');
    
    // We can add more subscriptions later as needed
    // this.socket.emit('subscribe', 'transactions');
    // this.socket.emit('subscribe', 'pools');
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Listen for all events (but filter out blocks.received to avoid spam)
    this.socket.onAny((eventName: string, ...args: any[]) => {
      if (eventName !== 'blocks.received') {
        logInfo(`Received event "${eventName}":`, { args });
      }
      this.handleExplorerEvent(eventName, args);
    });

    this.socket.on('connect', () => {
      logInfo('Connected to GalaChain Socket.IO');
      logInfo('Socket ID:', { id: this.socket?.id });
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.emit('connected', { timestamp: Date.now(), id: this.socket?.id });
      
      // Subscribe to chain events after connection
      this.subscribeToChainEvents();
    });

    this.socket.on('message', (data) => {
      logInfo('Received message event:', { data });
      this.emit('message', { type: 'message', data, timestamp: Date.now() });
    });

    this.socket.on('blocks.received', async (data) => {
      logInfo(`Received ${data.payload.length} blocks, first block #${data.payload[0].blockNumber}`);
      
      try {
        for (const block of data.payload) {
          await this.processBlock(block);
        }
      } catch (error) {
        logError('Error processing blocks:', error as Error);
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      logWarn('Socket disconnected. Reason:', { reason });
      this.isConnecting = false;
      this.emit('disconnected', { reason, timestamp: Date.now() });
    });

    this.socket.on('error', (error: Error) => {
      logError('Socket error:', error);
      this.emit('error', { error: error.message, timestamp: Date.now() });
    });

    this.socket.on('connect_error', (error: Error) => {
      logError('Connection error:', error);
      this.isConnecting = false;
      this.emit('error', { error: error.message, timestamp: Date.now() });
    });

    this.socket.on('ping', () => {
      logInfo('Socket ping');
    });

    this.socket.on('pong', (latency: number) => {
      logInfo('Socket pong, latency:', { latency });
    });
  }

  private handleExplorerEvent(eventName: string, args: any[]): void {
    // Update tracking variables for important events
    if (eventName === 'block') {
      const blockData = args[0];
      if (blockData?.blockNumber) {
        this.lastBlockNumber = blockData.blockNumber;
      }
    }

    if (eventName === 'transaction') {
      const txData = args[0];
      if (txData?.hash) {
        this.lastTransactionHash = txData.hash;
      }
    }

    // Emit to all registered handlers for this event type
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(args);
        } catch (error) {
          logError('Error in Explorer WebSocket event handler', error as Error, { 
            eventName, 
            args 
          });
        }
      });
    }

    // Emit to general message handlers
    this.emit('message', { type: eventName, data: args, timestamp: Date.now() });
  }

  private emit(eventType: string, data: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          logError('Error in Explorer WebSocket emit handler', error as Error, { 
            eventType, 
            data 
          });
        }
      });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send('ping', { timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Get the latest block number seen
   */
  public getLastBlockNumber(): number {
    return this.lastBlockNumber;
  }

  /**
   * Get the latest transaction hash seen
   */
  public getLastTransactionHash(): string {
    return this.lastTransactionHash;
  }

  /**
   * Check if we have received any chain events
   */
  public hasReceivedEvents(): boolean {
    return this.lastBlockNumber > 0 || this.lastTransactionHash !== '';
  }

  /**
   * Process a block received from the WebSocket
   */
  private async processBlock(block: any): Promise<void> {
    // Update tracking variables
    if (block.blockNumber) {
      this.lastBlockNumber = block.blockNumber;
    }

    // Emit to block handlers
    this.emit('block', { type: 'block', data: block, timestamp: Date.now() });

    // Log block processing
    logInfo('Processed block', { 
      blockNumber: block.blockNumber, 
      timestamp: block.timestamp,
      transactionCount: block.transactions?.length || 0
    });

    // Check for BatchSubmit transactions (DEX operations)
    this.detectBatchSubmitTransactions(block);
  }

  /**
   * Detect BatchSubmit transactions in a block
   * These contain batches of DEX operations like swap, add/remove liquidity, etc.
   */
  private detectBatchSubmitTransactions(block: any): void {
    if (!block.parsedBlock?.transactions) {
      return;
    }

    for (const transaction of block.parsedBlock.transactions) {
      if (!transaction.actions || transaction.actions.length === 0) {
        continue;
      }

      // Check if this transaction contains BatchSubmit
      const firstAction = transaction.actions[0];
      if (firstAction.args && firstAction.args.length > 0) {
        const actionType = firstAction.args[0];
        
        if (actionType === 'DexV3Contract:BatchSubmit') {
          const blockNumber = block.parsedBlock.blockNumber;
          
          // Log to console with block number
          console.log(`🎯 BATCHSUBMIT DETECTED in Block #${blockNumber}!`);
          
          logInfo('🎯 BATCHSUBMIT DETECTED!', {
            blockNumber: blockNumber,
            blockTimestamp: block.parsedBlock.createdAt,
            channelName: block.parsedBlock.channelName,
            transactionId: transaction.id,
            actionType: actionType,
            argsCount: firstAction.args.length
          });

          // Parse the operations from the second argument
          if (firstAction.args.length > 1) {
            try {
              const batchData = JSON.parse(firstAction.args[1]);
              this.parseAndLogOperations(batchData, blockNumber, transaction.id);
              
              // Update market data manager with pool state information
              if (this.marketDataManager) {
                this.marketDataManager.updatePoolStateFromBatchSubmit(transaction);
              }
            } catch (error) {
              logError('Failed to parse BatchSubmit operations', error as Error, {
                blockNumber: blockNumber,
                transactionId: transaction.id,
                rawData: firstAction.args[1]
              });
            }
          }
        }
      }
    }
  }

  /**
   * Parse and log summaries of DEX operations from BatchSubmit data
   */
  private parseAndLogOperations(batchData: any, blockNumber: string, transactionId: string): void {
    if (!batchData.operations || !Array.isArray(batchData.operations)) {
      logWarn('No operations array found in BatchSubmit data', {
        blockNumber,
        transactionId,
        batchDataKeys: Object.keys(batchData)
      });
      return;
    }

    const operations = batchData.operations;
    console.log(`📊 Found ${operations.length} operation(s) in BatchSubmit:`);

    // Log summary of each operation
    operations.forEach((operation: any, index: number) => {
      const method = operation.method || 'Unknown';
      const uniqueId = operation.uniqueId || 'No ID';
      const dto = operation.dto || {};

      console.log(`  ${index + 1}. ${method} Operation:`);
      console.log(`     ID: ${uniqueId}`);
      
      // Log operation-specific details
      switch (method) {
        case 'Swap':
          this.logSwapOperation(dto, index + 1);
          break;
        case 'AddLiquidity':
          this.logAddLiquidityOperation(dto, index + 1);
          break;
        case 'RemoveLiquidity':
          this.logRemoveLiquidityOperation(dto, index + 1);
          break;
        default:
          console.log(`     Details: ${JSON.stringify(dto, null, 2)}`);
      }
    });

    // Log batch metadata
    if (batchData.uniqueKey) {
      console.log(`  Batch Key: ${batchData.uniqueKey}`);
    }
    if (batchData.trace) {
      console.log(`  Trace ID: ${batchData.trace.traceId}`);
    }

    // Log to structured logger
    logInfo('BatchSubmit operations parsed', {
      blockNumber,
      transactionId,
      operationCount: operations.length,
      operations: operations.map((op: any) => ({
        method: op.method,
        uniqueId: op.uniqueId,
        hasDto: !!op.dto
      }))
    });
  }

  /**
   * Log details for a Swap operation
   */
  private logSwapOperation(dto: any, operationNumber: number): void {
    const token0 = dto.token0?.collection || 'Unknown';
    const token1 = dto.token1?.collection || 'Unknown';
    const amount = dto.amount || 'Unknown';
    const recipient = dto.recipient || 'Unknown';
    const fee = dto.fee || 'Unknown';
    const zeroForOne = dto.zeroForOne;

    console.log(`     Token Pair: ${token0} ↔ ${token1}`);
    console.log(`     Amount: ${amount}`);
    console.log(`     Direction: ${zeroForOne ? 'Token0→Token1' : 'Token1→Token0'}`);
    console.log(`     Fee: ${fee}`);
    console.log(`     Recipient: ${recipient.substring(0, 20)}...`);
  }

  /**
   * Log details for an AddLiquidity operation
   */
  private logAddLiquidityOperation(dto: any, operationNumber: number): void {
    const token0 = dto.token0?.collection || 'Unknown';
    const token1 = dto.token1?.collection || 'Unknown';
    const amount0Desired = dto.amount0Desired || 'Unknown';
    const amount1Desired = dto.amount1Desired || 'Unknown';
    const recipient = dto.recipient || 'Unknown';

    console.log(`     Token Pair: ${token0} + ${token1}`);
    console.log(`     Amount0 Desired: ${amount0Desired}`);
    console.log(`     Amount1 Desired: ${amount1Desired}`);
    console.log(`     Recipient: ${recipient.substring(0, 20)}...`);
  }

  /**
   * Log details for a RemoveLiquidity operation
   */
  private logRemoveLiquidityOperation(dto: any, operationNumber: number): void {
    const token0 = dto.token0?.collection || 'Unknown';
    const token1 = dto.token1?.collection || 'Unknown';
    const liquidity = dto.liquidity || 'Unknown';
    const recipient = dto.recipient || 'Unknown';

    console.log(`     Token Pair: ${token0} - ${token1}`);
    console.log(`     Liquidity: ${liquidity}`);
    console.log(`     Recipient: ${recipient.substring(0, 20)}...`);
  }
}
