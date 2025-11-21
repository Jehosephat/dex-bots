/**
 * Logger Utility
 * 
 * Centralized logging system using Winston for structured logging
 * with support for different log levels and file output.
 */

import winston from 'winston';
import path from 'path';

// Log levels
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Logger configuration
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present, but filter out verbose service info
    if (Object.keys(meta).length > 0) {
      const filteredMeta = { ...meta };
      // Remove verbose service metadata
      delete filteredMeta['service'];
      delete filteredMeta['version'];
      delete filteredMeta['environment'];
      
      // Only add metadata if there's something meaningful left
      if (Object.keys(filteredMeta).length > 0) {
        logMessage += ` ${JSON.stringify(filteredMeta)}`;
      }
    }
    
    return logMessage;
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || 'info',
  format: logFormat,
  defaultMeta: { 
    service: 'sol-arbitrage-bot',
    version: '1.0.0',
    environment: process.env['NODE_ENV'] || 'development'
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// Extend logger interface
interface ExtendedLogger extends winston.Logger {
  arbitrage: (message: string, meta?: Record<string, unknown>) => void;
  execution: (message: string, meta?: Record<string, unknown>) => void;
  bridge: (message: string, meta?: Record<string, unknown>) => void;
  quote: (message: string, meta?: Record<string, unknown>) => void;
}

// Add custom methods for arbitrage operations
(logger as ExtendedLogger).arbitrage = (message: string, meta?: Record<string, unknown>) => {
  logger.info(`[ARBITRAGE] ${message}`, meta);
};

(logger as ExtendedLogger).execution = (message: string, meta?: Record<string, unknown>) => {
  logger.info(`[EXECUTION] ${message}`, meta);
};

(logger as ExtendedLogger).bridge = (message: string, meta?: Record<string, unknown>) => {
  logger.info(`[BRIDGE] ${message}`, meta);
};

(logger as ExtendedLogger).quote = (message: string, meta?: Record<string, unknown>) => {
  logger.info(`[QUOTE] ${message}`, meta);
};

// Add file transport if log file is specified
const logFile = process.env['LOG_FILE'];
if (logFile && logFile !== 'console') {
  // Ensure log directory exists
  const logDir = path.dirname(logFile);
  if (logDir !== '.') {
    try {
      require('fs').mkdirSync(logDir, { recursive: true });
    } catch {
      // Directory might already exist, ignore error
    }
  }

  logger.add(new winston.transports.File({
    filename: logFile,
    format: logFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }));
}

// Export logger instance with extended interface
export default logger as ExtendedLogger;
