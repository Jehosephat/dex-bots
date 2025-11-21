/**
 * Trade Analysis Script
 * 
 * Analyzes trade logs and generates comprehensive summary reports.
 * Can analyze daily logs (JSONL) or consolidated logs (JSON).
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getTradeLogger, TradeLogEntry } from './utils/tradeLogger';
import logger from './utils/logger';

interface TradeStats {
  total: number;
  successful: number;
  failed: number;
  dryRun: number;
  live: number;
  totalNetEdge: number;
  avgNetEdge: number;
  totalExpectedEdge: number;
  avgExpectedEdge: number;
  totalProfitLoss: number;
}

interface TokenStats {
  token: string;
  total: number;
  successful: number;
  failed: number;
  dryRun: number;
  totalNetEdge: number;
  avgNetEdge: number;
  totalExpectedEdge: number;
}

interface DirectionStats {
  direction: 'forward' | 'reverse' | 'unknown';
  total: number;
  successful: number;
  failed: number;
  totalNetEdge: number;
  avgNetEdge: number;
}

interface TimeStats {
  hour: number;
  count: number;
  successful: number;
  totalNetEdge: number;
}

function readDailyLogs(logDir: string = 'logs', date?: string): TradeLogEntry[] {
  const entries: TradeLogEntry[] = [];
  
  try {
    if (date) {
      // Read specific date
      const dailyLogPath = join(process.cwd(), logDir, `trades-${date}.jsonl`);
      if (existsSync(dailyLogPath)) {
        const content = readFileSync(dailyLogPath, 'utf8');
        content.split('\n').forEach(line => {
          if (line.trim()) {
            try {
              entries.push(JSON.parse(line));
            } catch (e) {
              // Skip malformed lines
            }
          }
        });
      }
    } else {
      // Read all daily logs
      const files = readdirSync(join(process.cwd(), logDir));
      files.filter(f => f.startsWith('trades-') && f.endsWith('.jsonl')).forEach(file => {
        const filePath = join(process.cwd(), logDir, file);
        const content = readFileSync(filePath, 'utf8');
        content.split('\n').forEach(line => {
          if (line.trim()) {
            try {
              entries.push(JSON.parse(line));
            } catch (e) {
              // Skip malformed lines
            }
          }
        });
      });
    }
  } catch (error) {
    logger.error('Failed to read daily logs', { error });
  }
  
  return entries;
}

function calculateStats(entries: TradeLogEntry[]): TradeStats {
  const total = entries.length;
  const successful = entries.filter(e => e.success && e.mode === 'live').length;
  const failed = entries.filter(e => !e.success && e.mode === 'live').length;
  const dryRun = entries.filter(e => e.mode === 'dry_run').length;
  const live = entries.filter(e => e.mode === 'live').length;
  
  const liveTrades = entries.filter(e => e.mode === 'live');
  const withActualEdge = liveTrades.filter(e => e.actualNetEdge !== undefined);
  const totalNetEdge = withActualEdge.reduce((sum, e) => sum + (e.actualNetEdge || 0), 0);
  const avgNetEdge = withActualEdge.length > 0 ? totalNetEdge / withActualEdge.length : 0;
  
  const withExpectedEdge = entries.filter(e => e.expectedNetEdge !== undefined);
  const totalExpectedEdge = withExpectedEdge.reduce((sum, e) => sum + (e.expectedNetEdge || 0), 0);
  const avgExpectedEdge = withExpectedEdge.length > 0 ? totalExpectedEdge / withExpectedEdge.length : 0;
  
  // Profit/loss = sum of actual net edge for successful live trades
  const totalProfitLoss = withActualEdge.reduce((sum, e) => sum + (e.actualNetEdge || 0), 0);
  
  return {
    total,
    successful,
    failed,
    dryRun,
    live,
    totalNetEdge,
    avgNetEdge,
    totalExpectedEdge,
    avgExpectedEdge,
    totalProfitLoss
  };
}

function calculateTokenStats(entries: TradeLogEntry[]): TokenStats[] {
  const tokenMap = new Map<string, TradeLogEntry[]>();
  
  entries.forEach(entry => {
    if (!tokenMap.has(entry.token)) {
      tokenMap.set(entry.token, []);
    }
    tokenMap.get(entry.token)!.push(entry);
  });
  
  const tokenStats: TokenStats[] = [];
  
  tokenMap.forEach((tokenEntries, token) => {
    const total = tokenEntries.length;
    const successful = tokenEntries.filter(e => e.success && e.mode === 'live').length;
    const failed = tokenEntries.filter(e => !e.success && e.mode === 'live').length;
    const dryRun = tokenEntries.filter(e => e.mode === 'dry_run').length;
    
    const liveTrades = tokenEntries.filter(e => e.mode === 'live');
    const withActualEdge = liveTrades.filter(e => e.actualNetEdge !== undefined);
    const totalNetEdge = withActualEdge.reduce((sum, e) => sum + (e.actualNetEdge || 0), 0);
    const avgNetEdge = withActualEdge.length > 0 ? totalNetEdge / withActualEdge.length : 0;
    
    const withExpectedEdge = tokenEntries.filter(e => e.expectedNetEdge !== undefined);
    const totalExpectedEdge = withExpectedEdge.reduce((sum, e) => sum + (e.expectedNetEdge || 0), 0);
    
    tokenStats.push({
      token,
      total,
      successful,
      failed,
      dryRun,
      totalNetEdge,
      avgNetEdge,
      totalExpectedEdge
    });
  });
  
  // Sort by total trades (descending)
  return tokenStats.sort((a, b) => b.total - a.total);
}

function calculateDirectionStats(entries: TradeLogEntry[]): DirectionStats[] {
  const directionMap = new Map<string, TradeLogEntry[]>();
  
  entries.forEach(entry => {
    const direction = (entry as any).direction || 'unknown';
    if (!directionMap.has(direction)) {
      directionMap.set(direction, []);
    }
    directionMap.get(direction)!.push(entry);
  });
  
  const directionStats: DirectionStats[] = [];
  
  directionMap.forEach((directionEntries, direction) => {
    const total = directionEntries.length;
    const successful = directionEntries.filter(e => e.success && e.mode === 'live').length;
    const failed = directionEntries.filter(e => !e.success && e.mode === 'live').length;
    
    const liveTrades = directionEntries.filter(e => e.mode === 'live');
    const withActualEdge = liveTrades.filter(e => e.actualNetEdge !== undefined);
    const totalNetEdge = withActualEdge.reduce((sum, e) => sum + (e.actualNetEdge || 0), 0);
    const avgNetEdge = withActualEdge.length > 0 ? totalNetEdge / withActualEdge.length : 0;
    
    directionStats.push({
      direction: direction as 'forward' | 'reverse' | 'unknown',
      total,
      successful,
      failed,
      totalNetEdge,
      avgNetEdge
    });
  });
  
  return directionStats.sort((a, b) => b.total - a.total);
}

function calculateTimeStats(entries: TradeLogEntry[]): TimeStats[] {
  const hourMap = new Map<number, TradeLogEntry[]>();
  
  entries.forEach(entry => {
    const date = new Date(entry.timestamp);
    const hour = date.getUTCHours();
    if (!hourMap.has(hour)) {
      hourMap.set(hour, []);
    }
    hourMap.get(hour)!.push(entry);
  });
  
  const timeStats: TimeStats[] = [];
  
  hourMap.forEach((hourEntries, hour) => {
    const count = hourEntries.length;
    const successful = hourEntries.filter(e => e.success && e.mode === 'live').length;
    
    const liveTrades = hourEntries.filter(e => e.mode === 'live');
    const withActualEdge = liveTrades.filter(e => e.actualNetEdge !== undefined);
    const totalNetEdge = withActualEdge.reduce((sum, e) => sum + (e.actualNetEdge || 0), 0);
    
    timeStats.push({
      hour,
      count,
      successful,
      totalNetEdge
    });
  });
  
  return timeStats.sort((a, b) => a.hour - b.hour);
}

function formatReport(
  stats: TradeStats,
  tokenStats: TokenStats[],
  directionStats: DirectionStats[],
  timeStats: TimeStats[],
  entries: TradeLogEntry[]
): string {
  const lines: string[] = [];
  
  lines.push('='.repeat(80));
  lines.push('📊 TRADE ANALYSIS REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  
  // Overall Statistics
  lines.push('📈 OVERALL STATISTICS');
  lines.push('-'.repeat(80));
  lines.push(`Total Trades:        ${stats.total}`);
  lines.push(`  Live:              ${stats.live}`);
  lines.push(`  Dry-Run:           ${stats.dryRun}`);
  lines.push(`Successful:          ${stats.successful}`);
  lines.push(`Failed:              ${stats.failed}`);
  if (stats.live > 0) {
    lines.push(`Success Rate:        ${((stats.successful / stats.live) * 100).toFixed(2)}%`);
  }
  lines.push('');
  
  // Profit/Loss
  lines.push('💰 PROFIT/LOSS (Live Trades Only)');
  lines.push('-'.repeat(80));
  lines.push(`Total Net Edge:      ${stats.totalNetEdge.toFixed(8)} GALA`);
  lines.push(`Average Net Edge:    ${stats.avgNetEdge.toFixed(8)} GALA`);
  lines.push(`Total Expected:      ${stats.totalExpectedEdge.toFixed(8)} GALA`);
  lines.push(`Average Expected:    ${stats.avgExpectedEdge.toFixed(8)} GALA`);
  if (stats.totalNetEdge > 0) {
    lines.push(`✅ Total Profit:      ${stats.totalProfitLoss.toFixed(8)} GALA`);
  } else if (stats.totalNetEdge < 0) {
    lines.push(`❌ Total Loss:        ${Math.abs(stats.totalProfitLoss).toFixed(8)} GALA`);
  }
  lines.push('');
  
  // Token Breakdown
  if (tokenStats.length > 0) {
    lines.push('🪙 TOKEN BREAKDOWN');
    lines.push('-'.repeat(80));
    lines.push('Token'.padEnd(12) + 'Total'.padStart(8) + 'Success'.padStart(8) + 'Failed'.padStart(8) + 'Dry-Run'.padStart(10) + 'Net Edge'.padStart(15) + 'Avg Edge'.padStart(15));
    lines.push('-'.repeat(80));
    tokenStats.forEach(ts => {
      const netEdgeStr = ts.totalNetEdge >= 0 
        ? `+${ts.totalNetEdge.toFixed(4)}`.padStart(15)
        : `${ts.totalNetEdge.toFixed(4)}`.padStart(15);
      const avgEdgeStr = ts.avgNetEdge >= 0 
        ? `+${ts.avgNetEdge.toFixed(4)}`.padStart(15)
        : `${ts.avgNetEdge.toFixed(4)}`.padStart(15);
      lines.push(
        ts.token.padEnd(12) +
        ts.total.toString().padStart(8) +
        ts.successful.toString().padStart(8) +
        ts.failed.toString().padStart(8) +
        ts.dryRun.toString().padStart(10) +
        netEdgeStr +
        avgEdgeStr
      );
    });
    lines.push('');
  }
  
  // Direction Breakdown
  if (directionStats.length > 0 && directionStats.some(ds => ds.direction !== 'unknown')) {
    lines.push('🔄 DIRECTION BREAKDOWN');
    lines.push('-'.repeat(80));
    lines.push('Direction'.padEnd(12) + 'Total'.padStart(8) + 'Success'.padStart(8) + 'Failed'.padStart(8) + 'Net Edge'.padStart(15) + 'Avg Edge'.padStart(15));
    lines.push('-'.repeat(80));
    directionStats.forEach(ds => {
      if (ds.direction !== 'unknown') {
        const netEdgeStr = ds.totalNetEdge >= 0 
          ? `+${ds.totalNetEdge.toFixed(4)}`.padStart(15)
          : `${ds.totalNetEdge.toFixed(4)}`.padStart(15);
        const avgEdgeStr = ds.avgNetEdge >= 0 
          ? `+${ds.avgNetEdge.toFixed(4)}`.padStart(15)
          : `${ds.avgNetEdge.toFixed(4)}`.padStart(15);
        const directionLabel = ds.direction === 'forward' ? 'Forward' : 'Reverse';
        lines.push(
          directionLabel.padEnd(12) +
          ds.total.toString().padStart(8) +
          ds.successful.toString().padStart(8) +
          ds.failed.toString().padStart(8) +
          netEdgeStr +
          avgEdgeStr
        );
      }
    });
    lines.push('');
  }
  
  // Time Analysis
  if (timeStats.length > 0) {
    lines.push('⏰ TIME ANALYSIS (UTC Hours)');
    lines.push('-'.repeat(80));
    lines.push('Hour'.padEnd(8) + 'Count'.padStart(8) + 'Success'.padStart(8) + 'Net Edge'.padStart(15));
    lines.push('-'.repeat(80));
    timeStats.forEach(ts => {
      const netEdgeStr = ts.totalNetEdge >= 0 
        ? `+${ts.totalNetEdge.toFixed(4)}`.padStart(15)
        : `${ts.totalNetEdge.toFixed(4)}`.padStart(15);
      lines.push(
        `${ts.hour.toString().padStart(2)}:00`.padEnd(8) +
        ts.count.toString().padStart(8) +
        ts.successful.toString().padStart(8) +
        netEdgeStr
      );
    });
    lines.push('');
  }
  
  // Recent Trades
  if (entries.length > 0) {
    const recent = entries.slice(-10).reverse(); // Last 10, most recent first
    lines.push('📋 RECENT TRADES (Last 10)');
    lines.push('-'.repeat(80));
    recent.forEach((entry, idx) => {
      const date = new Date(entry.timestamp);
      const timeStr = date.toISOString().replace('T', ' ').substring(0, 19);
      const modeStr = entry.mode === 'live' ? '🚀 LIVE' : '🧪 DRY-RUN';
      const successStr = entry.success ? '✅' : entry.mode === 'live' ? '❌' : '⚪';
      const edgeStr = entry.actualNetEdge !== undefined 
        ? `${entry.actualNetEdge >= 0 ? '+' : ''}${entry.actualNetEdge.toFixed(4)} GALA`
        : entry.expectedNetEdge !== undefined
        ? `exp: ${entry.expectedNetEdge >= 0 ? '+' : ''}${entry.expectedNetEdge.toFixed(4)} GALA`
        : 'N/A';
      const direction = (entry as any).direction ? ` (${(entry as any).direction})` : '';
      lines.push(`${idx + 1}. ${timeStr} ${modeStr} ${successStr} ${entry.token}${direction}`);
      lines.push(`   Edge: ${edgeStr}, Size: ${entry.tradeSize}`);
    });
    lines.push('');
  }
  
  // Error Analysis
  const failedTrades = entries.filter(e => !e.success && e.mode === 'live');
  if (failedTrades.length > 0) {
    lines.push('❌ FAILED TRADES ANALYSIS');
    lines.push('-'.repeat(80));
    const errorMap = new Map<string, number>();
    failedTrades.forEach(entry => {
      const error = entry.galaChainError || entry.solanaError || 'Unknown error';
      errorMap.set(error, (errorMap.get(error) || 0) + 1);
    });
    errorMap.forEach((count, error) => {
      lines.push(`  ${error}: ${count}`);
    });
    lines.push('');
  }
  
  lines.push('='.repeat(80));
  
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find(arg => arg.startsWith('--date='));
  const date = dateArg ? dateArg.split('=')[1] : undefined;
  
  logger.info('📊 Starting trade analysis...');
  
  // Read entries
  let entries: TradeLogEntry[] = [];
  
  if (date) {
    logger.info(`Reading logs for date: ${date}`);
    entries = readDailyLogs('logs', date);
  } else {
    logger.info('Reading all daily logs...');
    entries = readDailyLogs('logs');
    
    // Also try reading from consolidated log if daily logs are empty
    if (entries.length === 0) {
      logger.info('No daily logs found, trying consolidated log...');
      const tradeLogger = getTradeLogger();
      entries = tradeLogger.readLogs();
    }
  }
  
  if (entries.length === 0) {
    logger.warn('⚠️ No trade entries found');
    return;
  }
  
  logger.info(`Found ${entries.length} trade entries`);
  
  // Calculate statistics
  const stats = calculateStats(entries);
  const tokenStats = calculateTokenStats(entries);
  const directionStats = calculateDirectionStats(entries);
  const timeStats = calculateTimeStats(entries);
  
  // Generate and print report
  const report = formatReport(stats, tokenStats, directionStats, timeStats, entries);
  console.log('\n' + report + '\n');
  
  // Save to file
  const outputPath = date 
    ? join(process.cwd(), 'logs', `analysis-${date}.txt`)
    : join(process.cwd(), 'logs', 'analysis-latest.txt');
  
  writeFileSync(outputPath, report, 'utf8');
  logger.info(`💾 Report saved to: ${outputPath}`);
}

main().catch(error => {
  logger.error('Failed to analyze trades', { error });
  process.exit(1);
});

