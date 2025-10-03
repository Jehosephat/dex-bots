import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL || 'info';

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// File format
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // File transport for errors only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // File transport for trades
    new winston.transports.File({
      filename: path.join(logsDir, 'trades.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10
    })
  ]
});

// Helper functions for structured logging
export const logTrade = (trade: any) => {
  logger.info('Trade executed', {
    category: 'trade',
    ...trade
  });
};

export const logBridge = (bridge: any) => {
  logger.info('Bridge transaction', {
    category: 'bridge',
    ...bridge
  });
};

export const logRisk = (risk: any) => {
  logger.warn('Risk event', {
    category: 'risk',
    ...risk
  });
};

export const logSystem = (message: string, data?: any) => {
  logger.info(message, {
    category: 'system',
    ...data
  });
};

export const logError = (error: Error, context?: any) => {
  logger.error('Error occurred', {
    category: 'error',
    error: error.message,
    stack: error.stack,
    ...context
  });
};

