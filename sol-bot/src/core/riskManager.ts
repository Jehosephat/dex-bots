import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { stateManager } from '../utils/stateManager';
import {
  ArbitrageOpportunity,
  ValidationResult,
  RiskValidation,
  TokenConfig,
  InventoryStatus
} from '../types';

/**
 * Risk Manager
 * Validates all trading decisions against risk parameters and enforces safety limits
 */
export class RiskManager {
  private emergencyStopActive: boolean = false;
  private circuitBreakerActive: boolean = false;
  private consecutiveFailures: number = 0;
  private dailyLossGALA: number = 0;
  private dailyLossResetTime: number = Date.now();
  private activeTrades: Set<string> = new Set();
  private lastTradeTime: Map<string, number> = new Map();
  
  // Trade count tracking per token
  private dailyTradeCount: Map<string, number> = new Map();
  private lastDailyReset: number = Date.now();
  
  constructor() {
    this.loadState();
    logger.info('Risk Manager initialized');
  }

  /**
   * Load state from persistent storage
   */
  private loadState(): void {
    try {
      const state = stateManager.getState();
      this.circuitBreakerActive = state.circuitBreakerActive || false;
      this.consecutiveFailures = state.recentFailures || 0;
      
      // Reset daily tracking if it's a new day
      if (this.isNewDay()) {
        this.resetDailyTracking();
      }
    } catch (error) {
      logger.error('Failed to load risk manager state', { error });
    }
  }

  /**
   * Save state to persistent storage
   */
  private saveState(): void {
    try {
      stateManager.setCircuitBreaker(this.circuitBreakerActive);
      // StateManager automatically tracks failures through recordFailure()
    } catch (error) {
      logger.error('Failed to save risk manager state', { error });
    }
  }

  /**
   * Validate an arbitrage opportunity before execution
   */
  validateOpportunity(
    opportunity: ArbitrageOpportunity,
    inventory: InventoryStatus
  ): RiskValidation {
    const violations: ValidationResult[] = [];
    let riskScore = 0;

    // Check emergency stop
    if (this.emergencyStopActive) {
      violations.push({
        isValid: false,
        message: 'Emergency stop is active - all trading halted',
        severity: 'high'
      });
      riskScore += 100;
    }

    // Check circuit breaker
    if (this.circuitBreakerActive) {
      violations.push({
        isValid: false,
        message: 'Circuit breaker is active - too many consecutive failures',
        severity: 'high'
      });
      riskScore += 100;
    }

    // Check daily loss limit
    const dailyLossCheck = this.checkDailyLossLimit(opportunity);
    if (!dailyLossCheck.isValid) {
      violations.push(dailyLossCheck);
      riskScore += 50;
    }

    // Check edge threshold
    const edgeCheck = this.checkEdgeThreshold(opportunity);
    if (!edgeCheck.isValid) {
      violations.push(edgeCheck);
      riskScore += 30;
    }

    // Check trade size
    const sizeCheck = this.checkTradeSize(opportunity);
    if (!sizeCheck.isValid) {
      violations.push(sizeCheck);
      riskScore += 20;
    }

    // Check inventory constraints
    const inventoryCheck = this.checkInventoryConstraints(opportunity, inventory);
    if (!inventoryCheck.isValid) {
      violations.push(inventoryCheck);
      riskScore += 40;
    }

    // Check concurrent trades limit
    const concurrencyCheck = this.checkConcurrentTrades();
    if (!concurrencyCheck.isValid) {
      violations.push(concurrencyCheck);
      riskScore += 15;
    }

    // Check cooldown period
    const cooldownCheck = this.checkCooldownPeriod(opportunity.token);
    if (!cooldownCheck.isValid) {
      violations.push(cooldownCheck);
      riskScore += 10;
    }

    const isValid = violations.length === 0 || violations.every(v => v.severity === 'low');

    if (!isValid) {
      logger.warn('Trade validation failed', {
        token: opportunity.token,
        violations: violations.map(v => v.message),
        riskScore
      });
    }

    return {
      isValid,
      violations,
      riskScore
    };
  }

  /**
   * Check if edge meets minimum threshold
   */
  private checkEdgeThreshold(opportunity: ArbitrageOpportunity): ValidationResult {
    const cfg = config.getTradingConfig();
    const minEdge = cfg.minEdgeThreshold;

    if (opportunity.netEdge < minEdge) {
      return {
        isValid: false,
        message: `Edge ${(opportunity.netEdge * 100).toFixed(2)}% below minimum ${(minEdge * 100).toFixed(2)}%`,
        severity: 'medium'
      };
    }

    // Warn if edge is marginal
    if (opportunity.netEdge < minEdge * 1.5) {
      return {
        isValid: true,
        message: `Edge ${(opportunity.netEdge * 100).toFixed(2)}% is marginal`,
        severity: 'low'
      };
    }

    return {
      isValid: true,
      message: `Edge ${(opportunity.netEdge * 100).toFixed(2)}% acceptable`
    };
  }

  /**
   * Check if trade size is within configured limits
   */
  private checkTradeSize(opportunity: ArbitrageOpportunity): ValidationResult {
    const tokensConfig = config.getTokensConfig();
    const tokenConfig = tokensConfig.supportedTokens.find(t => t.symbol === opportunity.token);

    if (!tokenConfig) {
      return {
        isValid: false,
        message: `Token ${opportunity.token} not found in configuration`,
        severity: 'high'
      };
    }

    const size = opportunity.recommendedSize;

    if (size < tokenConfig.minTradeSize) {
      return {
        isValid: false,
        message: `Trade size ${size} below minimum ${tokenConfig.minTradeSize}`,
        severity: 'medium'
      };
    }

    if (size > tokenConfig.maxTradeSize) {
      return {
        isValid: false,
        message: `Trade size ${size} exceeds maximum ${tokenConfig.maxTradeSize}`,
        severity: 'high'
      };
    }

    return {
      isValid: true,
      message: `Trade size ${size} within limits`
    };
  }

  /**
   * Check inventory constraints
   */
  private checkInventoryConstraints(
    opportunity: ArbitrageOpportunity,
    inventory: InventoryStatus
  ): ValidationResult {
    const riskCfg = config.getRiskConfig();
    
    // Check if we have enough inventory on GalaChain to sell
    const gcBalance = inventory.gcBalances[opportunity.token] || 0;
    if (gcBalance < opportunity.recommendedSize) {
      return {
        isValid: false,
        message: `Insufficient GalaChain balance: ${gcBalance} < ${opportunity.recommendedSize}`,
        severity: 'high'
      };
    }

    // Check minimum GALA balance for fees
    const galaBalance = inventory.gcBalances['GALA'] || 0;
    const minGALA = (riskCfg.inventoryMinimums && riskCfg.inventoryMinimums['GALA']) || 100;
    if (galaBalance < minGALA) {
      return {
        isValid: false,
        message: `GALA balance ${galaBalance} below minimum ${minGALA} (needed for fees)`,
        severity: 'high'
      };
    }

    // Check minimum SOL balance for Solana transactions
    const solBalance = inventory.solBalances['SOL'] || inventory.solBalances['GSOL'] || 0;
    const minSOL = (riskCfg.inventoryMinimums && riskCfg.inventoryMinimums['SOL']) || 1;
    if (solBalance < minSOL) {
      return {
        isValid: false,
        message: `SOL balance ${solBalance.toFixed(4)} below minimum ${minSOL} (needed for fees)`,
        severity: 'high'
      };
    }

    // Warn if approaching minimum balances
    if (galaBalance < minGALA * 1.5) {
      return {
        isValid: true,
        message: `GALA balance ${galaBalance.toFixed(2)} approaching minimum`,
        severity: 'low'
      };
    }

    return {
      isValid: true,
      message: 'Inventory constraints satisfied'
    };
  }

  /**
   * Check daily loss limit
   */
  private checkDailyLossLimit(opportunity: ArbitrageOpportunity): ValidationResult {
    if (this.isNewDay()) {
      this.resetDailyTracking();
    }

    const riskCfg = config.getRiskConfig();
    const maxDailyLoss = riskCfg.maxDailyLossGALA || riskCfg.maxDailyLoss;

    if (this.dailyLossGALA >= maxDailyLoss) {
      return {
        isValid: false,
        message: `Daily loss limit reached: ${this.dailyLossGALA.toFixed(2)} GALA >= ${maxDailyLoss} GALA`,
        severity: 'high'
      };
    }

    // Warn if approaching limit
    if (this.dailyLossGALA >= maxDailyLoss * 0.8) {
      return {
        isValid: true,
        message: `Daily loss ${this.dailyLossGALA.toFixed(2)} GALA approaching limit ${maxDailyLoss} GALA`,
        severity: 'low'
      };
    }

    return {
      isValid: true,
      message: `Daily loss ${this.dailyLossGALA.toFixed(2)} GALA within limit`
    };
  }

  /**
   * Check concurrent trades limit
   */
  private checkConcurrentTrades(): ValidationResult {
    const cfg = config.getTradingConfig();
    const maxConcurrent = cfg.maxConcurrentTrades;

    if (this.activeTrades.size >= maxConcurrent) {
      return {
        isValid: false,
        message: `Maximum concurrent trades reached: ${this.activeTrades.size}/${maxConcurrent}`,
        severity: 'medium'
      };
    }

    return {
      isValid: true,
      message: `Active trades: ${this.activeTrades.size}/${maxConcurrent}`
    };
  }

  /**
   * Check cooldown period between trades for same token
   */
  private checkCooldownPeriod(token: string): ValidationResult {
    const cfg = config.getTradingConfig();
    const cooldownMs = cfg.cooldownPeriod;
    const lastTrade = this.lastTradeTime.get(token);

    if (lastTrade) {
      const elapsed = Date.now() - lastTrade;
      if (elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        const remainingSec = Math.ceil(remainingMs / 1000);
        return {
          isValid: false,
          message: `Cooldown active for ${token}: ${remainingSec}s remaining`,
          severity: 'low'
        };
      }
    }

    return {
      isValid: true,
      message: 'Cooldown period satisfied'
    };
  }

  /**
   * Validate bridge health before initiating cross-chain trade
   */
  validateBridgeHealth(bridgeHealth: any): ValidationResult {
    if (!bridgeHealth.isHealthy) {
      return {
        isValid: false,
        message: 'Bridge is unhealthy - cross-chain trades paused',
        severity: 'high'
      };
    }

    // Check recent failure rate
    if (bridgeHealth.recentFailureRate > 0.2) {
      return {
        isValid: false,
        message: `Bridge failure rate too high: ${(bridgeHealth.recentFailureRate * 100).toFixed(1)}%`,
        severity: 'high'
      };
    }

    // Warn if completion time is elevated
    if (bridgeHealth.averageCompletionTime > 600) { // 10 minutes
      return {
        isValid: true,
        message: `Bridge completion time elevated: ${Math.round(bridgeHealth.averageCompletionTime / 60)}min`,
        severity: 'low'
      };
    }

    return {
      isValid: true,
      message: 'Bridge health acceptable'
    };
  }

  /**
   * Mark trade as started
   */
  startTrade(token: string, tradeId: string): void {
    this.activeTrades.add(tradeId);
    this.lastTradeTime.set(token, Date.now());
    
    logger.info('Trade started', { token, tradeId, activeTrades: this.activeTrades.size });
  }

  /**
   * Mark trade as completed (success or failure)
   */
  completeTrade(tradeId: string, success: boolean, pnl: number): void {
    this.activeTrades.delete(tradeId);

    if (success) {
      // Reset consecutive failures on success
      this.consecutiveFailures = 0;
      
      // Track PnL
      if (pnl < 0) {
        this.dailyLossGALA += Math.abs(pnl);
        logger.warn('Trade loss recorded', { tradeId, loss: Math.abs(pnl), dailyTotal: this.dailyLossGALA });
      } else {
        logger.info('Trade profit recorded', { tradeId, profit: pnl });
      }
    } else {
      // Increment failure counter
      this.consecutiveFailures++;
      logger.warn('Trade failure recorded', { tradeId, consecutiveFailures: this.consecutiveFailures });
      
      // Check circuit breaker
      const riskCfg = config.getRiskConfig();
      if (this.consecutiveFailures >= riskCfg.circuitBreakerThreshold) {
        this.activateCircuitBreaker();
      }
    }

    this.saveState();
  }

  /**
   * Activate circuit breaker
   */
  private activateCircuitBreaker(): void {
    if (!this.circuitBreakerActive) {
      this.circuitBreakerActive = true;
      logger.error('⚠️  CIRCUIT BREAKER ACTIVATED', {
        reason: 'Too many consecutive failures',
        consecutiveFailures: this.consecutiveFailures
      });
      
      // TODO: Send alert to monitoring system
      this.saveState();
    }
  }

  /**
   * Reset circuit breaker (manual intervention)
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerActive = false;
    this.consecutiveFailures = 0;
    logger.info('Circuit breaker reset manually');
    this.saveState();
  }

  /**
   * Activate emergency stop
   */
  activateEmergencyStop(reason: string): void {
    this.emergencyStopActive = true;
    logger.error('🛑 EMERGENCY STOP ACTIVATED', { reason });
    // TODO: Send critical alert
  }

  /**
   * Deactivate emergency stop
   */
  deactivateEmergencyStop(): void {
    this.emergencyStopActive = false;
    logger.info('Emergency stop deactivated');
  }

  /**
   * Check if it's a new day (for daily limit resets)
   */
  private isNewDay(): boolean {
    const now = new Date();
    const lastReset = new Date(this.dailyLossResetTime);
    return now.getDate() !== lastReset.getDate() || 
           now.getMonth() !== lastReset.getMonth() ||
           now.getFullYear() !== lastReset.getFullYear();
  }

  /**
   * Reset daily tracking
   */
  private resetDailyTracking(): void {
    this.dailyLossGALA = 0;
    this.dailyTradeCount.clear();
    this.dailyLossResetTime = Date.now();
    logger.info('Daily risk tracking reset');
  }

  /**
   * Get current risk status
   */
  getRiskStatus(): {
    emergencyStopActive: boolean;
    circuitBreakerActive: boolean;
    consecutiveFailures: number;
    dailyLossGALA: number;
    activeTrades: number;
    isHealthy: boolean;
  } {
    return {
      emergencyStopActive: this.emergencyStopActive,
      circuitBreakerActive: this.circuitBreakerActive,
      consecutiveFailures: this.consecutiveFailures,
      dailyLossGALA: this.dailyLossGALA,
      activeTrades: this.activeTrades.size,
      isHealthy: !this.emergencyStopActive && !this.circuitBreakerActive
    };
  }

  /**
   * Get risk report
   */
  getRiskReport(): string {
    const status = this.getRiskStatus();
    const riskCfg = config.getRiskConfig();
    
    let report = '\n=== Risk Manager Status ===\n';
    report += `\n🛡️  Safety Controls:\n`;
    report += `  Emergency Stop: ${status.emergencyStopActive ? '🛑 ACTIVE' : '✅ Inactive'}\n`;
    report += `  Circuit Breaker: ${status.circuitBreakerActive ? '⚠️  ACTIVE' : '✅ Inactive'}\n`;
    report += `  Consecutive Failures: ${status.consecutiveFailures}/${riskCfg.circuitBreakerThreshold}\n`;
    report += `\n💰 Daily Limits:\n`;
    report += `  Daily Loss: ${status.dailyLossGALA.toFixed(2)} / ${riskCfg.maxDailyLossGALA || riskCfg.maxDailyLoss} GALA\n`;
    report += `\n📊 Current Activity:\n`;
    report += `  Active Trades: ${status.activeTrades}\n`;
    report += `\n✅ Overall Status: ${status.isHealthy ? '✅ HEALTHY' : '⚠️  RESTRICTED'}\n`;
    
    return report;
  }
}

// Export singleton instance
export const riskManager = new RiskManager();

