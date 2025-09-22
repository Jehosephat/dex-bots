#!/usr/bin/env node

/**
 * GalaSwap V3 Periodic Buy/Sell Bot
 * 
 * This script implements a periodic trading strategy that:
 * 1. Buys GALA with GUSDC for a configurable period and frequency
 * 2. Sells GALA for GUSDC for the same period and frequency
 * 3. Repeats this cycle indefinitely
 * 
 * Configuration:
 * - TRADE_AMOUNT: Amount to trade in each transaction
 * - TRADE_FREQUENCY: Time between trades (in milliseconds)
 * - TRADE_DURATION: Duration of each buy/sell phase (in milliseconds)
 * - PRIVATE_KEY: Your wallet private key
 * - WALLET_ADDRESS: Your wallet address
 */

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration - Set these values according to your needs
const CONFIG = {
  // Trading parameters
  BUY_AMOUNT: parseFloat(process.env.BUY_AMOUNT) || 10, // Amount to buy in each transaction
  SELL_AMOUNT: parseFloat(process.env.SELL_AMOUNT) || 10, // Amount to sell in each transaction
  TRADE_FREQUENCY: parseInt(process.env.TRADE_FREQUENCY) || 30000, // 30 seconds between trades
  TRADE_DURATION: parseInt(process.env.TRADE_DURATION) || 300000, // 5 minutes per phase
  
  // Wallet configuration
  PRIVATE_KEY: process.env.PRIVATE_KEY || "", // Your private key (0x...)
  WALLET_ADDRESS: process.env.WALLET_ADDRESS || "", // Your wallet address (eth|0x...)
  
  // Token configuration (using SDK format)
  GALA_TOKEN: "GALA|Unit|none|none",
  GUSDC_TOKEN: "GUSDC|Unit|none|none",
  
  // Slippage tolerance (5%)
  SLIPPAGE_TOLERANCE: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.05
};

// State management
let isBuyingPhase = true;
let isRunning = false;
let currentCycle = 1;
let gSwap = null;

/**
 * Log with timestamp
 */
function log(message, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...args);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Initialize the GSwap SDK
 */
function initializeGSwap() {
  try {
    const signer = new PrivateKeySigner(CONFIG.PRIVATE_KEY);
    gSwap = new GSwap({ signer });
    log('✅ GSwap SDK initialized successfully');
  } catch (error) {
    log('❌ Error initializing GSwap SDK:', error.message);
    throw error;
  }
}

/**
 * Execute a trade (buy or sell) using the GSwap SDK
 */
async function executeTrade(isBuy) {
  try {
    const tokenIn = isBuy ? CONFIG.GUSDC_TOKEN : CONFIG.GALA_TOKEN;
    const tokenOut = isBuy ? CONFIG.GALA_TOKEN : CONFIG.GUSDC_TOKEN;
    const tradeType = isBuy ? 'BUY' : 'SELL';
    const tradeAmount = isBuy ? CONFIG.BUY_AMOUNT : CONFIG.SELL_AMOUNT;
    
    log(`Executing ${tradeType} trade: ${tradeAmount} ${tokenIn.split('|')[0]} -> ${tokenOut.split('|')[0]}`);

    // Get quote using the SDK
    const quote = await gSwap.quoting.quoteExactInput(
      tokenIn,
      tokenOut,
      tradeAmount
    );

    log(`Best rate found on ${quote.feeTier} fee tier pool`);
    log(`Expected output: ${quote.outTokenAmount.toString()} ${tokenOut.split('|')[0]}`);

    // Calculate minimum output with slippage protection
    const amountOutMinimum = quote.outTokenAmount.multipliedBy(1 - CONFIG.SLIPPAGE_TOLERANCE);
    log(`Min output (${CONFIG.SLIPPAGE_TOLERANCE * 100}% slippage): ${amountOutMinimum.toString()}`);

    // Execute the swap using the SDK
    const result = await gSwap.swaps.swap(
      tokenIn,
      tokenOut,
      quote.feeTier,
      {
        exactIn: tradeAmount,
        amountOutMinimum: amountOutMinimum
      },
      CONFIG.WALLET_ADDRESS
    );

    log(`✅ ${tradeType} trade completed successfully!`);
    log(`Transaction result:`, result);
    
    return { 
      success: true, 
      result, 
      expectedOutput: quote.outTokenAmount.toString(),
      feeTier: quote.feeTier
    };

  } catch (error) {
    log(`❌ Error executing ${isBuy ? 'BUY' : 'SELL'} trade:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Run a trading phase (buy or sell)
 */
async function runTradingPhase(isBuyPhase) {
  const phaseName = isBuyPhase ? 'BUY' : 'SELL';
  const startTime = Date.now();
  const endTime = startTime + CONFIG.TRADE_DURATION;
  
  log(`🚀 Starting ${phaseName} phase for ${CONFIG.TRADE_DURATION / 1000} seconds`);
  
  let tradeCount = 0;
  let successCount = 0;
  
  while (Date.now() < endTime && isRunning) {
    try {
      const result = await executeTrade(isBuyPhase);
      tradeCount++;
      
      if (result.success) {
        successCount++;
      }
      
      // Wait for the next trade
      await sleep(CONFIG.TRADE_FREQUENCY);
      
    } catch (error) {
      log(`Error in ${phaseName} phase:`, error.message);
      await sleep(CONFIG.TRADE_FREQUENCY);
    }
  }
  
  log(`✅ ${phaseName} phase completed: ${successCount}/${tradeCount} trades successful`);
  return { tradeCount, successCount };
}

/**
 * Main trading loop
 */
async function runTradingBot() {
  if (!CONFIG.PRIVATE_KEY || !CONFIG.WALLET_ADDRESS) {
    log('❌ Error: PRIVATE_KEY and WALLET_ADDRESS must be set in environment variables');
    process.exit(1);
  }

  log('🤖 Starting GalaSwap V3 Periodic Trading Bot');
  log(`Configuration:`);
  log(`  Buy Amount: ${CONFIG.BUY_AMOUNT} GUSDC`);
  log(`  Sell Amount: ${CONFIG.SELL_AMOUNT} GALA`);
  log(`  Trade Frequency: ${CONFIG.TRADE_FREQUENCY / 1000}s`);
  log(`  Trade Duration: ${CONFIG.TRADE_DURATION / 1000}s per phase`);
  log(`  Slippage Tolerance: ${CONFIG.SLIPPAGE_TOLERANCE * 100}%`);
  log(`  Wallet: ${CONFIG.WALLET_ADDRESS}`);
  log('');

  // Initialize the GSwap SDK
  try {
    initializeGSwap();
  } catch (error) {
    log('❌ Failed to initialize GSwap SDK:', error.message);
    process.exit(1);
  }

  isRunning = true;

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('🛑 Shutting down trading bot...');
    isRunning = false;
    process.exit(0);
  });

  while (isRunning) {
    try {
      log(`🔄 Starting cycle ${currentCycle}`);
      
      // Buy phase
      const buyResults = await runTradingPhase(true);
      
      // Sell phase
      const sellResults = await runTradingPhase(false);
      
      log(`📊 Cycle ${currentCycle} summary:`);
      log(`  Buy trades: ${buyResults.successCount}/${buyResults.tradeCount} successful`);
      log(`  Sell trades: ${sellResults.successCount}/${sellResults.tradeCount} successful`);
      log(`  Total trades: ${buyResults.tradeCount + sellResults.tradeCount}`);
      log(`  Success rate: ${((buyResults.successCount + sellResults.successCount) / (buyResults.tradeCount + sellResults.tradeCount) * 100).toFixed(1)}%`);
      log('');
      
      currentCycle++;
      
    } catch (error) {
      log('❌ Error in trading cycle:', error.message);
      await sleep(5000); // Wait 5 seconds before retrying
    }
  }
}

// Start the bot
runTradingBot().catch(error => {
  log('❌ Fatal error:', error.message);
  process.exit(1);
});
