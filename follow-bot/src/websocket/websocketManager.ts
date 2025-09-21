/**
 * WebSocket Manager
 * 
 * Manages WebSocket connection to GalaChain block explorer for real-time
 * transaction monitoring and wallet activity tracking.
 */

import io from 'socket.io-client';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/errorHandler';
import { StateManager } from '../utils/stateManager';
import { TransactionMonitor } from '../monitoring/transactionMonitor';

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp: number;
  id?: string;
}

// Transaction data from GalaChain
export interface GalaChainTransaction {
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  status: 'success' | 'failed';
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

// Wallet activity event
export interface WalletActivity {
  walletAddress: string;
  transaction: GalaChainTransaction;
  activityType: 'swap' | 'transfer' | 'approval' | 'other';
  detectedAt: number;
}

// WebSocket connection state
export enum WebSocketState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

// WebSocket configuration
export interface WebSocketConfig {
  url: string;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  messageTimeout: number;
  pingTimeout: number;
}

export class WebSocketManager extends EventEmitter {
  private static instance: WebSocketManager;
  private socket: any | null = null;
  private state: WebSocketState = WebSocketState.DISCONNECTED;
  private config: WebSocketConfig;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageTimeout: NodeJS.Timeout | null = null;
  private lastMessageTime = 0;
  private errorHandler: ErrorHandler;
  private stateManager: StateManager;
  private transactionMonitor: TransactionMonitor;
  private isConnecting = false;

  private constructor() {
    super();
    this.errorHandler = ErrorHandler.getInstance();
    this.stateManager = StateManager.getInstance();
    this.transactionMonitor = TransactionMonitor.getInstance();
    
    this.config = {
      url: process.env['GALACHAIN_WEBSOCKET_URL'] || 'https://explorer-api.galachain.com/',
      reconnectDelay: parseInt(process.env['WEBSOCKET_RECONNECT_DELAY'] || '5000'),
      maxReconnectAttempts: parseInt(process.env['WEBSOCKET_MAX_RETRIES'] || '10'),
      heartbeatInterval: 30000, // 30 seconds
      messageTimeout: 60000, // 1 minute
      pingTimeout: 10000 // 10 seconds
    };
  }

  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * Initialize WebSocket connection
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('🔌 Initializing WebSocket manager...');
      logger.info(`📡 WebSocket URL: ${this.config.url}`);
      
      // Initialize transaction monitor
      await this.transactionMonitor.initialize();
      
      await this.connect();
      
      // Set up health check
      this.errorHandler.addHealthCheck('websocket', this.checkWebSocketHealth.bind(this));
      
      logger.info('✅ WebSocket manager initialized successfully');
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.WEBSOCKET,
        ErrorSeverity.HIGH,
        { phase: 'initialization' }
      );
      throw error;
    }
  }

  /**
   * Connect to WebSocket
   */
  private async connect(): Promise<void> {
    if (this.state === WebSocketState.CONNECTING || this.state === WebSocketState.CONNECTED || this.isConnecting) {
      logger.warn('⚠️ WebSocket connection already in progress or connected');
      return;
    }

    this.setState(WebSocketState.CONNECTING);
    this.isConnecting = true;
    logger.info('🔌 Connecting to GalaChain Socket.IO...');

    try {
      // Create Socket.IO connection with circuit breaker protection
      await this.errorHandler.executeWithCircuitBreaker('websocket-connection', async () => {
        this.socket = io(this.config.url, {
          transports: ['websocket'],
          reconnection: false, // We handle reconnection manually
          timeout: 10000,
          forceNew: true
        });

        this.setupEventHandlers();
      });

    } catch (error) {
      this.setState(WebSocketState.ERROR);
      this.isConnecting = false;
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.WEBSOCKET,
        ErrorSeverity.HIGH,
        { phase: 'connection' }
      );
      throw error;
    }
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', this.handleConnect.bind(this));
    this.socket.on('disconnect', this.handleDisconnect.bind(this));
    this.socket.on('error', this.handleError.bind(this));
    this.socket.on('connect_error', this.handleConnectError.bind(this));
    this.socket.on('message', this.handleMessage.bind(this));
    this.socket.on('blocks.received', this.handleBlocksReceived.bind(this));
    this.socket.on('ping', this.handlePing.bind(this));
    this.socket.on('pong', this.handlePong.bind(this));
  }

  /**
   * Handle Socket.IO connect event
   */
  private handleConnect(): void {
    logger.info('✅ Socket.IO connected successfully');
    logger.info(`📡 Socket ID: ${this.socket?.id}`);
    this.setState(WebSocketState.CONNECTED);
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.lastMessageTime = Date.now();
    
    // Update state manager
    this.stateManager.updateWebSocketState(true);
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Emit connection event
    this.emit('connected', { timestamp: Date.now(), id: this.socket?.id });
    
    // Subscribe to relevant events
    this.subscribeToEvents();
  }

  /**
   * Handle Socket.IO message
   */
  private handleMessage(data: any): void {
    try {
      this.lastMessageTime = Date.now();
      
      logger.debug('📨 Socket.IO message received:', { data });

      // Emit message event
      this.emit('message', { type: 'message', data, timestamp: Date.now() });

    } catch (error) {
      logger.error('❌ Error processing Socket.IO message:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.WEBSOCKET,
        ErrorSeverity.MEDIUM,
        { phase: 'message_processing' }
      );
    }
  }

  /**
   * Handle blocks received event
   */
  private handleBlocksReceived(data: any): void {
    try {
      this.lastMessageTime = Date.now();
      
      logger.info(`📦 Received ${data.payload?.length || 0} blocks`);
      
      if (data.payload && Array.isArray(data.payload)) {
        for (const block of data.payload) {
          this.processBlock(block);
        }
      }

    } catch (error) {
      logger.error('❌ Error processing blocks:', error);
      this.errorHandler.handleError(
        error as Error,
        ErrorCategory.WEBSOCKET,
        ErrorSeverity.MEDIUM,
        { phase: 'block_processing' }
      );
    }
  }

  /**
   * Handle connect error
   */
  private handleConnectError(error: Error): void {
    logger.error('❌ Socket.IO connection error:', error);
    this.isConnecting = false;
    this.setState(WebSocketState.ERROR);
    this.stateManager.updateWebSocketState(false);
    
    this.errorHandler.handleError(
      error,
      ErrorCategory.WEBSOCKET,
      ErrorSeverity.HIGH,
      { phase: 'connection_error' }
    );

    this.emit('error', { error: error.message, timestamp: Date.now() });
  }


  /**
   * Subscribe to relevant events
   */
  private subscribeToEvents(): void {
    if (!this.socket || !this.socket.connected) return;

    try {
      // Subscribe to blocks (main event we want)
      this.socket.emit('subscribe', 'blocks');
      logger.info('📡 Subscribed to blocks events');

    } catch (error) {
      logger.error('❌ Failed to subscribe to Socket.IO events:', error);
    }
  }

  /**
   * Process a block received from the WebSocket
   */
  private processBlock(block: any): void {
    try {
      logger.debug('📦 Processing block:', { 
        blockNumber: block.blockNumber, 
        timestamp: block.timestamp,
        transactionCount: block.transactions?.length || 0
      });

      // Emit block event
      this.emit('block', { type: 'block', data: block, timestamp: Date.now() });

      // Process block through transaction monitor
      this.transactionMonitor.processBlock(block);

    } catch (error) {
      logger.error('❌ Error processing block:', error);
    }
  }


  /**
   * Handle Socket.IO disconnect event
   */
  private handleDisconnect(reason: string): void {
    logger.warn(`🔌 Socket.IO disconnected: ${reason}`);
    this.setState(WebSocketState.DISCONNECTED);
    this.isConnecting = false;
    this.stateManager.updateWebSocketState(false);
    
    this.stopHeartbeat();
    this.emit('disconnected', { reason, timestamp: Date.now() });

    // Attempt reconnection if not a clean disconnect
    if (reason !== 'io client disconnect' && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnection();
    }
  }

  /**
   * Handle Socket.IO error event
   */
  private handleError(error: Error): void {
    logger.error('❌ Socket.IO error:', error);
    this.setState(WebSocketState.ERROR);
    this.stateManager.updateWebSocketState(false);
    
    this.errorHandler.handleError(
      error,
      ErrorCategory.WEBSOCKET,
      ErrorSeverity.HIGH,
      { phase: 'websocket_error' }
    );

    this.emit('error', { error: error.message, timestamp: Date.now() });
  }

  /**
   * Handle ping event
   */
  private handlePing(): void {
    logger.debug('🏓 Ping received');
  }

  /**
   * Handle pong event
   */
  private handlePong(latency: number): void {
    logger.debug('🏓 Pong received, latency:', { latency });
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('ping', { timestamp: Date.now() });
        logger.debug('💓 Heartbeat sent');
      }
    }, this.config.heartbeatInterval);

    // Check for message timeout
    this.messageTimeout = setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTime;
      if (timeSinceLastMessage > this.config.messageTimeout) {
        logger.warn('⚠️ No messages received for extended period, reconnecting...');
        this.reconnect();
      }
    }, this.config.messageTimeout);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.messageTimeout) {
      clearInterval(this.messageTimeout);
      this.messageTimeout = null;
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnection(): void {
    this.setState(WebSocketState.RECONNECTING);
    this.reconnectAttempts++;
    
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    logger.info(`🔄 Scheduling reconnection in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        logger.error('❌ Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Reconnect to WebSocket
   */
  public async reconnect(): Promise<void> {
    logger.info('🔄 Manually reconnecting WebSocket...');
    this.disconnect();
    await this.connect();
  }

  /**
   * Disconnect Socket.IO
   */
  public disconnect(): void {
    logger.info('🔌 Disconnecting Socket.IO...');
    
    this.stopHeartbeat();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.setState(WebSocketState.DISCONNECTED);
    this.isConnecting = false;
    this.stateManager.updateWebSocketState(false);
  }

  /**
   * Set WebSocket state
   */
  private setState(state: WebSocketState): void {
    if (this.state !== state) {
      const previousState = this.state;
      this.state = state;
      logger.info(`🔄 WebSocket state: ${previousState} → ${state}`);
      this.emit('stateChange', { previous: previousState, current: state });
    }
  }

  /**
   * Get current WebSocket state
   */
  public getState(): WebSocketState {
    return this.state;
  }

  /**
   * Check if Socket.IO is connected
   */
  public isConnected(): boolean {
    return this.state === WebSocketState.CONNECTED && 
           this.socket?.connected === true;
  }

  /**
   * Get connection statistics
   */
  public getConnectionStats(): {
    state: WebSocketState;
    reconnectAttempts: number;
    lastMessageTime: number;
    uptime: number;
  } {
    return {
      state: this.state,
      reconnectAttempts: this.reconnectAttempts,
      lastMessageTime: this.lastMessageTime,
      uptime: this.lastMessageTime > 0 ? Date.now() - this.lastMessageTime : 0
    };
  }

  /**
   * Health check for WebSocket
   */
  private async checkWebSocketHealth(): Promise<boolean> {
    return this.isConnected() && 
           (Date.now() - this.lastMessageTime) < this.config.messageTimeout;
  }

  /**
   * Send message to Socket.IO
   */
  public sendMessage(eventName: string, data: any): boolean {
    if (!this.isConnected()) {
      logger.warn('⚠️ Cannot send message: Socket.IO not connected');
      return false;
    }

    try {
      this.socket!.emit(eventName, data);
      logger.debug('📤 Message sent to Socket.IO:', { eventName, data });
      return true;
    } catch (error) {
      logger.error('❌ Failed to send Socket.IO message:', error);
      return false;
    }
  }

  /**
   * Shutdown WebSocket manager
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down WebSocket manager...');
    
    // Shutdown transaction monitor first
    await this.transactionMonitor.shutdown();
    
    this.stopHeartbeat();
    this.disconnect();
    
    // Remove all listeners
    this.removeAllListeners();
    
    logger.info('✅ WebSocket manager shutdown complete');
  }
}
