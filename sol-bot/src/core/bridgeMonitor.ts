import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../utils/config';

/**
 * Bridge status from GalaChain API
 * 0-4: Pending stages
 * 5: Success/Completed
 * 6-7: Failed
 */
export enum BridgeStatus {
  INITIATED = 0,
  PENDING_CONFIRMATION = 1,
  CONFIRMED = 2,
  PENDING_DELIVERY = 3,
  DELIVERY_IN_PROGRESS = 4,
  COMPLETED = 5,
  FAILED = 6,
  FAILED_DELIVERY = 7
}

export interface BridgeTransaction {
  hash: string;
  token: string;
  amount: number;
  fromChain: 'SOL' | 'GC' | 'Ethereum';
  toChain: 'SOL' | 'GC' | 'Ethereum';
  status: BridgeStatus;
  statusDescription: string;
  initiatedAt: number;
  estimatedArrivalTime?: number;
  completedAt?: number;
  emitterTransactionHash?: string;
  receiverTransactionHash?: string;
  error?: string;
}

export interface BridgeHealth {
  isHealthy: boolean;
  avgCompletionTime: number; // milliseconds
  recentFailureRate: number; // percentage
  pendingCount: number;
  lastCheckTime: number;
  issues: string[];
}

export interface BridgeConfiguration {
  token: string;
  canBridgeFrom: string[];
  canBridgeTo: string[];
  fee: number;
  feeToken: string;
  minAmount?: number;
  maxAmount?: number;
}

/**
 * Bridge Monitor
 * Tracks bridge health, pending transactions, and bridge completion times
 */
export class BridgeMonitor {
  private bridgeApiUrl = 'https://dex-backend-prod1.defi.gala.com';
  private pendingBridges: Map<string, BridgeTransaction> = new Map();
  private completedBridges: BridgeTransaction[] = [];
  private failedBridges: BridgeTransaction[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private bridgeConfigurations: Map<string, BridgeConfiguration> = new Map();
  
  // Health tracking
  private recentCompletionTimes: number[] = []; // in milliseconds
  private maxHistorySize = 100;
  
  constructor() {
    // Load bridge configurations on initialization
    this.loadBridgeConfigurations();
  }

  /**
   * Start monitoring pending bridges
   */
  startMonitoring(intervalMs: number = 15000): void {
    if (this.checkInterval) {
      logger.warn('Bridge monitoring already running');
      return;
    }

    logger.info(`Starting bridge monitoring with ${intervalMs}ms interval`);
    
    this.checkInterval = setInterval(async () => {
      await this.checkPendingBridges();
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Bridge monitoring stopped');
    }
  }

  /**
   * Load bridge configurations for supported tokens
   */
  private async loadBridgeConfigurations(): Promise<void> {
    try {
      const tokens = config.getEnabledTokens();
      
      for (const token of tokens) {
        try {
          const response = await axios.get(`${this.bridgeApiUrl}/v1/connect/bridge-configurations`, {
            params: { searchprefix: token.symbol },
            timeout: 10000
          });

          if (response.data?.data?.tokens) {
            const tokenConfig = response.data.data.tokens.find((t: any) => 
              t.symbol === token.symbol && t.verified
            );

            if (tokenConfig) {
              const canBridgeTo = tokenConfig.canBridgeTo?.map((b: any) => b.network) || [];
              
              this.bridgeConfigurations.set(token.symbol, {
                token: token.symbol,
                canBridgeFrom: ['GC'],
                canBridgeTo,
                fee: 0, // Will be calculated per transaction
                feeToken: 'GALA',
                minAmount: token.minTradeSize,
                maxAmount: token.maxTradeSize
              });

              logger.debug(`Loaded bridge config for ${token.symbol}`, {
                canBridgeTo
              });
            }
          }
        } catch (error: any) {
          logger.warn(`Failed to load bridge config for ${token.symbol}`, {
            error: error.message
          });
        }
      }

      logger.info(`Loaded bridge configurations for ${this.bridgeConfigurations.size} tokens`);
    } catch (error) {
      logger.error('Failed to load bridge configurations', { error });
    }
  }

  /**
   * Add a bridge transaction to monitoring
   */
  trackBridge(
    hash: string,
    token: string,
    amount: number,
    fromChain: 'SOL' | 'GC' | 'Ethereum',
    toChain: 'SOL' | 'GC' | 'Ethereum'
  ): void {
    const bridge: BridgeTransaction = {
      hash,
      token,
      amount,
      fromChain,
      toChain,
      status: BridgeStatus.INITIATED,
      statusDescription: 'Initiated',
      initiatedAt: Date.now(),
      estimatedArrivalTime: Date.now() + this.getEstimatedArrivalTime()
    };

    this.pendingBridges.set(hash, bridge);
    
    logger.info(`Tracking bridge transaction`, {
      hash,
      token,
      amount,
      fromChain,
      toChain,
      eta: new Date(bridge.estimatedArrivalTime!).toLocaleTimeString()
    });
  }

  /**
   * Check status of all pending bridges
   */
  private async checkPendingBridges(): Promise<void> {
    if (this.pendingBridges.size === 0) {
      return;
    }

    logger.debug(`Checking ${this.pendingBridges.size} pending bridges`);

    for (const [hash, bridge] of this.pendingBridges.entries()) {
      try {
        const status = await this.getBridgeStatus(hash);
        
        if (status) {
          // Update bridge transaction
          bridge.status = status.status;
          bridge.statusDescription = status.statusDescription;
          bridge.emitterTransactionHash = status.emitterTransactionHash;
          bridge.receiverTransactionHash = status.receiverTransactionHash;

          // Handle completion
          if (status.status === BridgeStatus.COMPLETED) {
            await this.handleBridgeCompletion(bridge);
          } 
          // Handle failure
          else if (status.status === BridgeStatus.FAILED || status.status === BridgeStatus.FAILED_DELIVERY) {
            await this.handleBridgeFailure(bridge, status.error || 'Unknown error');
          }
          // Update ETA for pending bridges
          else {
            this.updateBridgeETA(bridge);
          }
        }
      } catch (error: any) {
        logger.error(`Failed to check bridge status`, {
          hash,
          error: error.message
        });
      }
    }
  }

  /**
   * Get bridge status from GalaChain API
   */
  async getBridgeStatus(hash: string): Promise<{
    status: BridgeStatus;
    statusDescription: string;
    fromChain: string;
    toChain: string;
    quantity: string;
    emitterTransactionHash?: string;
    receiverTransactionHash?: string;
    error?: string;
  } | null> {
    try {
      const response = await axios.post(
        `${this.bridgeApiUrl}/v1/connect/bridge/status`,
        { hash },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      if (response.data?.data) {
        return {
          status: response.data.data.status,
          statusDescription: response.data.data.statusDescription,
          fromChain: response.data.data.fromChain,
          toChain: response.data.data.toChain,
          quantity: response.data.data.quantity,
          emitterTransactionHash: response.data.data.emitterTransactionHash,
          receiverTransactionHash: response.data.data.receiverTransactionHash,
          error: response.data.data.error
        };
      }

      return null;
    } catch (error: any) {
      logger.error('Failed to get bridge status', {
        hash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Handle successful bridge completion
   */
  private async handleBridgeCompletion(bridge: BridgeTransaction): Promise<void> {
    bridge.completedAt = Date.now();
    const completionTime = bridge.completedAt - bridge.initiatedAt;

    // Track completion time
    this.recentCompletionTimes.push(completionTime);
    if (this.recentCompletionTimes.length > this.maxHistorySize) {
      this.recentCompletionTimes.shift();
    }

    // Move to completed
    this.completedBridges.push(bridge);
    this.pendingBridges.delete(bridge.hash);

    logger.info(`Bridge completed successfully`, {
      hash: bridge.hash,
      token: bridge.token,
      amount: bridge.amount,
      completionTime: `${(completionTime / 1000).toFixed(1)}s`
    });

    // Trigger reconciliation callback if registered
    // This will be used by inventory manager to update balances
  }

  /**
   * Handle bridge failure
   */
  private async handleBridgeFailure(bridge: BridgeTransaction, error: string): Promise<void> {
    bridge.completedAt = Date.now();
    bridge.error = error;

    // Move to failed
    this.failedBridges.push(bridge);
    this.pendingBridges.delete(bridge.hash);

    logger.error(`Bridge failed`, {
      hash: bridge.hash,
      token: bridge.token,
      amount: bridge.amount,
      error
    });

    // Trigger alert for failed bridge
  }

  /**
   * Update ETA based on current progress and historical data
   */
  private updateBridgeETA(bridge: BridgeTransaction): void {
    const elapsed = Date.now() - bridge.initiatedAt;
    const avgCompletionTime = this.getAverageCompletionTime();
    
    // Adjust ETA based on status
    let estimatedRemaining = avgCompletionTime - elapsed;
    
    // If taking longer than average, use pessimistic estimate
    if (elapsed > avgCompletionTime) {
      estimatedRemaining = avgCompletionTime * 0.5; // Add 50% more time
    }

    bridge.estimatedArrivalTime = Date.now() + estimatedRemaining;
  }

  /**
   * Get estimated arrival time for new bridges (milliseconds)
   */
  private getEstimatedArrivalTime(): number {
    const avgTime = this.getAverageCompletionTime();
    
    // Add 20% buffer for safety
    return avgTime * 1.2;
  }

  /**
   * Get average completion time from recent history
   */
  private getAverageCompletionTime(): number {
    if (this.recentCompletionTimes.length === 0) {
      // Default to 5 minutes if no history
      return 5 * 60 * 1000;
    }

    const sum = this.recentCompletionTimes.reduce((a, b) => a + b, 0);
    return sum / this.recentCompletionTimes.length;
  }

  /**
   * Get bridge health metrics
   */
  async getBridgeHealth(): Promise<BridgeHealth> {
    const issues: string[] = [];
    
    // Calculate recent failure rate
    const recentBridges = [...this.completedBridges, ...this.failedBridges].slice(-50);
    const failureRate = recentBridges.length > 0
      ? (this.failedBridges.length / recentBridges.length) * 100
      : 0;

    // Check for stuck bridges (taking > 2x average time)
    const avgTime = this.getAverageCompletionTime();
    const stuckBridges = Array.from(this.pendingBridges.values()).filter(
      bridge => Date.now() - bridge.initiatedAt > avgTime * 2
    );

    if (stuckBridges.length > 0) {
      issues.push(`${stuckBridges.length} bridge(s) taking longer than expected`);
    }

    if (failureRate > 10) {
      issues.push(`High failure rate: ${failureRate.toFixed(1)}%`);
    }

    const isHealthy = issues.length === 0 && failureRate < 5;

    return {
      isHealthy,
      avgCompletionTime: this.getAverageCompletionTime(),
      recentFailureRate: failureRate,
      pendingCount: this.pendingBridges.size,
      lastCheckTime: Date.now(),
      issues
    };
  }

  /**
   * Get configuration for a token's bridge
   */
  getBridgeConfiguration(token: string): BridgeConfiguration | undefined {
    return this.bridgeConfigurations.get(token);
  }

  /**
   * Check if a token can be bridged between chains
   */
  canBridge(token: string, fromChain: string, toChain: string): boolean {
    const config = this.bridgeConfigurations.get(token);
    if (!config) return false;

    return config.canBridgeFrom.includes(fromChain) && 
           config.canBridgeTo.includes(toChain);
  }

  /**
   * Get all pending bridges
   */
  getPendingBridges(): BridgeTransaction[] {
    return Array.from(this.pendingBridges.values());
  }

  /**
   * Get recent completed bridges
   */
  getCompletedBridges(limit: number = 10): BridgeTransaction[] {
    return this.completedBridges.slice(-limit);
  }

  /**
   * Get recent failed bridges
   */
  getFailedBridges(limit: number = 10): BridgeTransaction[] {
    return this.failedBridges.slice(-limit);
  }

  /**
   * Get bridge by hash
   */
  getBridge(hash: string): BridgeTransaction | undefined {
    return this.pendingBridges.get(hash) ||
           this.completedBridges.find(b => b.hash === hash) ||
           this.failedBridges.find(b => b.hash === hash);
  }

  /**
   * Clear old completed/failed bridges to prevent memory issues
   */
  cleanupOldBridges(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoffTime = Date.now() - maxAge;

    this.completedBridges = this.completedBridges.filter(
      b => b.completedAt && b.completedAt > cutoffTime
    );

    this.failedBridges = this.failedBridges.filter(
      b => b.completedAt && b.completedAt > cutoffTime
    );

    logger.debug('Cleaned up old bridge records', {
      completed: this.completedBridges.length,
      failed: this.failedBridges.length
    });
  }
}

