/**
 * Health Check System
 * 
 * Provides health check endpoints and monitoring for the follow bot
 * including system health, external service status, and performance metrics.
 */

import { logger } from './logger';
import { ErrorHandler } from './errorHandler';
import { StateManager } from './stateManager';
import { ConfigurationManager } from '../config/configManager';

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface SystemHealth {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheckResult[];
  timestamp: number;
  uptime: number;
  version: string;
}

export class HealthCheckSystem {
  private static instance: HealthCheckSystem;
  private startTime: number;
  private healthChecks: Map<string, () => Promise<HealthCheckResult>> = new Map();

  private constructor() {
    this.startTime = Date.now();
    this.initializeHealthChecks();
  }

  public static getInstance(): HealthCheckSystem {
    if (!HealthCheckSystem.instance) {
      HealthCheckSystem.instance = new HealthCheckSystem();
    }
    return HealthCheckSystem.instance;
  }

  /**
   * Initialize default health checks
   */
  private initializeHealthChecks(): void {
    this.addHealthCheck('system', this.checkSystemHealth.bind(this));
    this.addHealthCheck('configuration', this.checkConfigurationHealth.bind(this));
    this.addHealthCheck('state', this.checkStateHealth.bind(this));
    this.addHealthCheck('memory', this.checkMemoryHealth.bind(this));
    this.addHealthCheck('disk', this.checkDiskHealth.bind(this));
    this.addHealthCheck('errors', this.checkErrorHealth.bind(this));
  }

  /**
   * Add a health check
   */
  public addHealthCheck(name: string, checkFunction: () => Promise<HealthCheckResult>): void {
    this.healthChecks.set(name, checkFunction);
    logger.info(`🏥 Health check registered: ${name}`);
  }

  /**
   * Run all health checks
   */
  public async runAllHealthChecks(): Promise<SystemHealth> {
    const checks: HealthCheckResult[] = [];
    
    for (const [name, checkFunction] of this.healthChecks) {
      try {
        const result = await checkFunction();
        checks.push(result);
      } catch (error) {
        checks.push({
          name,
          status: 'unhealthy',
          message: `Health check failed: ${error}`,
          timestamp: Date.now(),
          details: { error: String(error) }
        });
      }
    }

    // Determine overall health
    const overall = this.determineOverallHealth(checks);

    return {
      overall,
      checks,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: '1.0.0'
    };
  }

  /**
   * Determine overall system health
   */
  private determineOverallHealth(checks: HealthCheckResult[]): 'healthy' | 'unhealthy' | 'degraded' {
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;

    if (unhealthyCount > 0) {
      return 'unhealthy';
    } else if (degradedCount > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  /**
   * Check system health
   */
  private async checkSystemHealth(): Promise<HealthCheckResult> {
    try {
      const uptime = Date.now() - this.startTime;
      const nodeVersion = process.version;
      const platform = process.platform;
      const arch = process.arch;

      return {
        name: 'system',
        status: 'healthy',
        message: 'System is running normally',
        timestamp: Date.now(),
        details: {
          uptime,
          nodeVersion,
          platform,
          arch,
          pid: process.pid
        }
      };
    } catch (error) {
      return {
        name: 'system',
        status: 'unhealthy',
        message: 'System health check failed',
        timestamp: Date.now(),
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check configuration health
   */
  private async checkConfigurationHealth(): Promise<HealthCheckResult> {
    try {
      const configManager = ConfigurationManager.getInstance();
      const envConfig = configManager.getEnvironmentConfig();
      const walletConfig = configManager.getWalletConfig();
      const enabledWallets = configManager.getEnabledTargetWallets();

      return {
        name: 'configuration',
        status: 'healthy',
        message: 'Configuration is valid',
        timestamp: Date.now(),
        details: {
          environment: envConfig.nodeEnv,
          copyMode: envConfig.copyMode,
          enabledWallets: enabledWallets.length,
          totalWallets: walletConfig.targetWallets.length,
          autoTrading: envConfig.enableAutoTrading
        }
      };
    } catch (error) {
      return {
        name: 'configuration',
        status: 'unhealthy',
        message: 'Configuration health check failed',
        timestamp: Date.now(),
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check state health
   */
  private async checkStateHealth(): Promise<HealthCheckResult> {
    try {
      const stateManager = StateManager.getInstance();
      const state = stateManager.getState();
      const metrics = stateManager.getPerformanceMetrics();

      // Check if state is recent (within last 5 minutes)
      const stateAge = Date.now() - state.lastHeartbeat;
      const isRecent = stateAge < 5 * 60 * 1000;

      return {
        name: 'state',
        status: isRecent ? 'healthy' : 'degraded',
        message: isRecent ? 'State is current' : 'State is stale',
        timestamp: Date.now(),
        details: {
          stateAge,
          totalTrades: metrics.totalTrades,
          successRate: metrics.successRate,
          activePositions: state.positions.length,
          activeCooldowns: state.cooldowns.length,
          websocketConnected: state.websocketConnected
        }
      };
    } catch (error) {
      return {
        name: 'state',
        status: 'unhealthy',
        message: 'State health check failed',
        timestamp: Date.now(),
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check memory health
   */
  private async checkMemoryHealth(): Promise<HealthCheckResult> {
    try {
      const memUsage = process.memoryUsage();
      const totalMem = memUsage.heapTotal;
      const usedMem = memUsage.heapUsed;
      const externalMem = memUsage.external;
      const rssMem = memUsage.rss;

      const memoryUsagePercent = (usedMem / totalMem) * 100;
      const isHealthy = memoryUsagePercent < 80;
      const isDegraded = memoryUsagePercent >= 80 && memoryUsagePercent < 95;

      return {
        name: 'memory',
        status: isHealthy ? 'healthy' : (isDegraded ? 'degraded' : 'unhealthy'),
        message: `Memory usage: ${memoryUsagePercent.toFixed(1)}%`,
        timestamp: Date.now(),
        details: {
          heapUsed: usedMem,
          heapTotal: totalMem,
          external: externalMem,
          rss: rssMem,
          usagePercent: memoryUsagePercent
        }
      };
    } catch (error) {
      return {
        name: 'memory',
        status: 'unhealthy',
        message: 'Memory health check failed',
        timestamp: Date.now(),
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check disk health
   */
  private async checkDiskHealth(): Promise<HealthCheckResult> {
    try {
      // This is a simplified disk check
      // In a real implementation, you'd use a library like 'node-disk-info'
      const fs = require('fs');
      const path = require('path');
      
      // Check if we can write to the current directory
      const testFile = path.join(process.cwd(), '.health-check-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      return {
        name: 'disk',
        status: 'healthy',
        message: 'Disk is accessible',
        timestamp: Date.now(),
        details: {
          workingDirectory: process.cwd(),
          writable: true
        }
      };
    } catch (error) {
      return {
        name: 'disk',
        status: 'unhealthy',
        message: 'Disk health check failed',
        timestamp: Date.now(),
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check error health
   */
  private async checkErrorHealth(): Promise<HealthCheckResult> {
    try {
      const errorHandler = ErrorHandler.getInstance();
      const stats = errorHandler.getErrorStatistics();
      const unresolvedErrors = errorHandler.getUnresolvedErrors();

      const criticalErrors = unresolvedErrors.filter(e => e.severity === 'CRITICAL').length;
      const highErrors = unresolvedErrors.filter(e => e.severity === 'HIGH').length;

      let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
      let message = 'No critical errors';

      if (criticalErrors > 0) {
        status = 'unhealthy';
        message = `${criticalErrors} critical errors`;
      } else if (highErrors > 0) {
        status = 'degraded';
        message = `${highErrors} high severity errors`;
      }

      return {
        name: 'errors',
        status,
        message,
        timestamp: Date.now(),
        details: {
          totalErrors: stats.totalErrors,
          unresolvedErrors: stats.unresolvedErrors,
          criticalErrors,
          highErrors,
          errorsByCategory: stats.errorsByCategory,
          errorsBySeverity: stats.errorsBySeverity
        }
      };
    } catch (error) {
      return {
        name: 'errors',
        status: 'unhealthy',
        message: 'Error health check failed',
        timestamp: Date.now(),
        details: { error: String(error) }
      };
    }
  }

  /**
   * Get health status as HTTP response
   */
  public async getHealthStatus(): Promise<{ status: number; body: SystemHealth }> {
    const health = await this.runAllHealthChecks();
    const status = health.overall === 'healthy' ? 200 : 
                   health.overall === 'degraded' ? 200 : 503;
    
    return { status, body: health };
  }

  /**
   * Get simple health status
   */
  public async getSimpleHealthStatus(): Promise<{ status: 'ok' | 'error'; timestamp: number }> {
    try {
      const health = await this.runAllHealthChecks();
      return {
        status: health.overall === 'healthy' ? 'ok' : 'error',
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: Date.now()
      };
    }
  }
}
