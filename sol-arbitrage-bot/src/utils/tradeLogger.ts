/**
 * Trade Logger
 * 
 * Logs all trade execution attempts to a JSON log file
 * for record keeping and analysis.
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import logger from './logger';

export interface TradeLogEntry {
  timestamp: string;
  mode: 'live' | 'dry_run';
  token: string;
  tradeSize: number;
  success: boolean;
  
  // Expected values (from quotes/edge calculation)
  expectedGalaChainProceeds?: number;
  expectedSolanaCost?: number;
  expectedSolanaCostGala?: number;
  expectedNetEdge?: number;
  expectedNetEdgeBps?: number;
  
  // Actual values (from execution - live mode only)
  actualGalaChainProceeds?: number;
  actualSolanaCost?: number;
  actualSolanaCostGala?: number;
  actualNetEdge?: number;
  actualNetEdgeBps?: number;
  
  // Transaction details (live mode only)
  galaChainTxHash?: string;
  solanaTxSig?: string;
  
  // Execution status
  galaChainSuccess?: boolean;
  solanaSuccess?: boolean;
  
  // Errors
  galaChainError?: string;
  solanaError?: string;
  
  // Price information
  galaChainPrice?: number;
  galaChainPriceCurrency?: string;
  solanaPrice?: number;
  solanaPriceCurrency?: string;
  
  // Additional metadata
  priceImpactGcBps?: number;
  priceImpactSolBps?: number;
  executionDurationMs?: number;
}

export class TradeLogger {
  private logFilePath: string;
  private logDir: string;

  constructor(logDir: string = 'logs') {
    this.logDir = logDir;
    this.logFilePath = join(process.cwd(), logDir, 'trades.json');
    this.ensureLogFile();
  }

  /**
   * Ensure log directory and file exist
   */
  private ensureLogFile(): void {
    try {
      // Create logs directory if it doesn't exist
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }

      // Create log file with empty array if it doesn't exist
      if (!existsSync(this.logFilePath)) {
        writeFileSync(this.logFilePath, JSON.stringify([], null, 2), 'utf8');
      }
    } catch (error) {
      logger.error('Failed to initialize trade log file', { 
        error: error instanceof Error ? error.message : String(error),
        path: this.logFilePath
      });
    }
  }

  /**
   * Log a trade execution
   */
  logTrade(entry: TradeLogEntry): void {
    try {
      // Read existing log entries
      let entries: TradeLogEntry[] = [];
      if (existsSync(this.logFilePath)) {
        try {
          const content = readFileSync(this.logFilePath, 'utf8');
          entries = JSON.parse(content);
          if (!Array.isArray(entries)) {
            entries = [];
          }
        } catch (parseError) {
          logger.warn('Failed to parse existing trade log, starting fresh', { error: parseError });
          entries = [];
        }
      }

      // Add new entry
      entries.push(entry);

      // Write back to file (with pretty formatting)
      writeFileSync(this.logFilePath, JSON.stringify(entries, null, 2), 'utf8');

      // Also append to a daily log file for easier parsing
      this.appendToDailyLog(entry);

      logger.debug(`📝 Trade logged to ${this.logFilePath}`);
    } catch (error) {
      logger.error('Failed to write trade log', {
        error: error instanceof Error ? error.message : String(error),
        entry: entry
      });
    }
  }

  /**
   * Append to daily log file (one file per day)
   */
  private appendToDailyLog(entry: TradeLogEntry): void {
    try {
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const dailyLogPath = join(process.cwd(), this.logDir, `trades-${dateStr}.jsonl`);

      // Append as JSONL (one JSON object per line)
      appendFileSync(dailyLogPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (error) {
      // Silent fail for daily log - not critical
      logger.debug('Failed to append to daily log', { error });
    }
  }

  /**
   * Read all trade logs
   */
  readLogs(): TradeLogEntry[] {
    try {
      if (!existsSync(this.logFilePath)) {
        return [];
      }
      const content = readFileSync(this.logFilePath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logger.error('Failed to read trade logs', { error });
      return [];
    }
  }

  /**
   * Get trade statistics
   */
  getStats(): {
    total: number;
    successful: number;
    failed: number;
    dryRun: number;
    totalNetEdge: number;
    avgNetEdge: number;
  } {
    const entries = this.readLogs();
    const successful = entries.filter(e => e.success && e.mode === 'live').length;
    const failed = entries.filter(e => !e.success && e.mode === 'live').length;
    const dryRun = entries.filter(e => e.mode === 'dry_run').length;
    
    const liveTrades = entries.filter(e => e.mode === 'live' && e.actualNetEdge !== undefined);
    const totalNetEdge = liveTrades.reduce((sum, e) => sum + (e.actualNetEdge || 0), 0);
    const avgNetEdge = liveTrades.length > 0 ? totalNetEdge / liveTrades.length : 0;

    return {
      total: entries.length,
      successful,
      failed,
      dryRun,
      totalNetEdge,
      avgNetEdge
    };
  }
}

// Singleton instance
let tradeLoggerInstance: TradeLogger | null = null;

/**
 * Get the trade logger instance
 */
export function getTradeLogger(): TradeLogger {
  if (!tradeLoggerInstance) {
    tradeLoggerInstance = new TradeLogger();
  }
  return tradeLoggerInstance;
}

