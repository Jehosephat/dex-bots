/**
 * Calculation Utilities for SOL Arbitrage Bot
 * 
 * Common calculations and helper functions used throughout the bot.
 */

import BigNumber from 'bignumber.js';

// ============================================================================
// BASIS POINTS CALCULATIONS
// ============================================================================

/**
 * Convert basis points to percentage
 */
export function bpsToPercentage(bps: number): number {
  return bps / 100;
}

/**
 * Convert percentage to basis points
 */
export function percentageToBps(percentage: number): number {
  return percentage * 100;
}

/**
 * Calculate basis points between two values
 */
export function calculateBps(value1: BigNumber, value2: BigNumber): number {
  if (value2.isZero()) return 0;
  return value1.minus(value2).div(value2).multipliedBy(10000).toNumber();
}

/**
 * Calculate percentage between two values
 */
export function calculatePercentage(value1: BigNumber, value2: BigNumber): number {
  if (value2.isZero()) return 0;
  return value1.minus(value2).div(value2).multipliedBy(100).toNumber();
}

// ============================================================================
// PRICE IMPACT CALCULATIONS
// ============================================================================

/**
 * Calculate price impact in basis points
 */
export function calculatePriceImpactBps(
  inputAmount: BigNumber,
  outputAmount: BigNumber,
  spotPrice: BigNumber
): number {
  if (spotPrice.isZero()) return 0;
  
  const effectivePrice = outputAmount.div(inputAmount);
  return calculateBps(effectivePrice, spotPrice);
}

/**
 * Check if price impact is within acceptable limits
 */
export function isPriceImpactAcceptable(
  priceImpactBps: number,
  maxPriceImpactBps: number
): boolean {
  return Math.abs(priceImpactBps) <= maxPriceImpactBps;
}

// ============================================================================
// SLIPPAGE CALCULATIONS
// ============================================================================

/**
 * Calculate slippage in basis points
 */
export function calculateSlippageBps(
  expectedAmount: BigNumber,
  actualAmount: BigNumber
): number {
  if (expectedAmount.isZero()) return 0;
  return calculateBps(actualAmount, expectedAmount);
}

/**
 * Check if slippage is within tolerance
 */
export function isSlippageWithinTolerance(
  slippageBps: number,
  maxSlippageBps: number
): boolean {
  return Math.abs(slippageBps) <= maxSlippageBps;
}

/**
 * Calculate minimum output with slippage protection
 */
export function calculateMinOutput(
  expectedOutput: BigNumber,
  slippageToleranceBps: number
): BigNumber {
  const slippageMultiplier = new BigNumber(1).minus(
    new BigNumber(slippageToleranceBps).div(10000)
  );
  return expectedOutput.multipliedBy(slippageMultiplier);
}

// ============================================================================
// ARBITRAGE CALCULATIONS
// ============================================================================

/**
 * Calculate net edge in GALA
 */
export function calculateNetEdge(
  galaChainProceeds: BigNumber,
  solanaCostGala: BigNumber,
  bridgeCost: BigNumber,
  riskBuffer: BigNumber
): BigNumber {
  return galaChainProceeds
    .minus(solanaCostGala)
    .minus(bridgeCost)
    .minus(riskBuffer);
}

/**
 * Calculate net edge in basis points
 */
export function calculateNetEdgeBps(
  netEdge: BigNumber,
  totalCost: BigNumber
): number {
  if (totalCost.isZero()) return 0;
  return netEdge.div(totalCost).multipliedBy(10000).toNumber();
}

/**
 * Check if net edge meets minimum threshold
 */
export function isNetEdgeSufficient(
  netEdgeBps: number,
  minEdgeBps: number
): boolean {
  return netEdgeBps >= minEdgeBps;
}

// ============================================================================
// TOKEN AMOUNT CALCULATIONS
// ============================================================================

/**
 * Convert raw token amount to human-readable amount
 */
export function toTokenAmount(rawAmount: BigNumber, decimals: number): BigNumber {
  return rawAmount.div(new BigNumber(10).pow(decimals));
}

/**
 * Convert human-readable amount to raw token amount
 */
export function toRawAmount(tokenAmount: BigNumber, decimals: number): BigNumber {
  return tokenAmount.multipliedBy(new BigNumber(10).pow(decimals));
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(
  amount: BigNumber,
  decimals: number = 6,
  symbol?: string
): string {
  const formatted = amount.toFixed(decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

// ============================================================================
// TIME CALCULATIONS
// ============================================================================

/**
 * Calculate time remaining in seconds
 */
export function calculateTimeRemaining(endTimestamp: number): number {
  return Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));
}

/**
 * Check if timestamp is expired
 */
export function isExpired(timestamp: number): boolean {
  return Date.now() > timestamp;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate token amount
 */
export function isValidTokenAmount(amount: BigNumber): boolean {
  return amount.isFinite() && amount.isPositive();
}

/**
 * Validate price
 */
export function isValidPrice(price: BigNumber): boolean {
  return price.isFinite() && price.isPositive();
}

/**
 * Validate basis points value
 */
export function isValidBps(bps: number): boolean {
  return Number.isFinite(bps) && bps >= 0 && bps <= 10000;
}

// ============================================================================
// ROUNDING HELPERS
// ============================================================================

/**
 * Round to specified decimal places
 */
export function roundToDecimals(value: BigNumber, decimals: number): BigNumber {
  return value.decimalPlaces(decimals, BigNumber.ROUND_HALF_UP);
}

/**
 * Round up to specified decimal places
 */
export function roundUpToDecimals(value: BigNumber, decimals: number): BigNumber {
  return value.decimalPlaces(decimals, BigNumber.ROUND_UP);
}

/**
 * Round down to specified decimal places
 */
export function roundDownToDecimals(value: BigNumber, decimals: number): BigNumber {
  return value.decimalPlaces(decimals, BigNumber.ROUND_DOWN);
}

// ============================================================================
// COMPARISON HELPERS
// ============================================================================

/**
 * Compare two BigNumber values with tolerance
 */
export function isEqualWithTolerance(
  value1: BigNumber,
  value2: BigNumber,
  toleranceBps: number = 1
): boolean {
  const diff = value1.minus(value2).abs();
  const tolerance = value1.multipliedBy(toleranceBps).div(10000);
  return diff.lte(tolerance);
}

/**
 * Check if value is within range
 */
export function isWithinRange(
  value: BigNumber,
  min: BigNumber,
  max: BigNumber
): boolean {
  return value.gte(min) && value.lte(max);
}

// ============================================================================
// ARRAY HELPERS
// ============================================================================

/**
 * Calculate average of BigNumber array
 */
export function calculateAverage(values: BigNumber[]): BigNumber {
  if (values.length === 0) return new BigNumber(0);
  const sum = values.reduce((acc, val) => acc.plus(val), new BigNumber(0));
  return sum.div(values.length);
}

/**
 * Calculate median of BigNumber array
 */
export function calculateMedian(values: BigNumber[]): BigNumber {
  if (values.length === 0) return new BigNumber(0);
  
  const sorted = [...values].sort((a, b) => a.comparedTo(b) || 0);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return sorted[mid - 1].plus(sorted[mid]).div(2);
  } else {
    return sorted[mid];
  }
}

/**
 * Calculate standard deviation of BigNumber array
 */
export function calculateStandardDeviation(values: BigNumber[]): BigNumber {
  if (values.length === 0) return new BigNumber(0);
  
  const average = calculateAverage(values);
  const squaredDiffs = values.map(val => val.minus(average).pow(2));
  const variance = calculateAverage(squaredDiffs);
  
  return variance.sqrt();
}
