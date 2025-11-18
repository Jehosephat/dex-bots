/**
 * Configuration Schema with Zod Validation
 * 
 * Provides runtime validation for all configuration types using Zod schemas.
 */

import { z } from 'zod';

/**
 * GalaChain mint address format: "COLLECTION|CATEGORY|TYPE|ADDITIONAL_KEY"
 */
const galaChainMintSchema = z.string().regex(
  /^[^|]+\|[^|]+\|[^|]+\|[^|]+$/,
  'GalaChain mint must be in format: COLLECTION|CATEGORY|TYPE|ADDITIONAL_KEY'
);

/**
 * Solana mint address (base58 encoded, 32-44 characters)
 */
const solanaMintSchema = z.string().min(32).max(44);

/**
 * Token decimals (0-18)
 */
const decimalsSchema = z.number().int().min(0).max(18);

/**
 * Basis points (0-10000, representing 0-100%)
 */
const bpsSchema = z.number().int().min(0).max(10000);

/**
 * Positive number
 */
const positiveNumberSchema = z.number().positive();

/**
 * Non-negative number
 */
const nonNegativeNumberSchema = z.number().nonnegative();

/**
 * Quote token configuration schema
 */
export const quoteTokenConfigSchema = z.object({
  galaChainMint: galaChainMintSchema,
  solanaMint: solanaMintSchema,
  decimals: decimalsSchema,
});

/**
 * Token configuration schema
 */
export const tokenConfigSchema = z.object({
  symbol: z.string().min(1),
  galaChainMint: galaChainMintSchema,
  solanaMint: solanaMintSchema,
  solanaSymbol: z.string().min(1),
  decimals: decimalsSchema,
  tradeSize: positiveNumberSchema,
  enabled: z.boolean(),
  gcQuoteVia: z.string().min(1).default('GALA'),
  solQuoteVia: z.string().min(1).default('SOL'),
  inventoryTarget: positiveNumberSchema.optional(), // Total amount of tokens desired across both chains
}).transform((data) => ({
  ...data,
  gcQuoteVia: data.gcQuoteVia || 'GALA',
  solQuoteVia: data.solQuoteVia || 'SOL',
}));

/**
 * Trading configuration schema
 */
export const tradingConfigSchema = z.object({
  minEdgeBps: bpsSchema,
  maxSlippageBps: bpsSchema,
  riskBufferBps: bpsSchema,
  maxPriceImpactBps: bpsSchema,
  cooldownMinutes: nonNegativeNumberSchema,
  maxDailyTrades: nonNegativeNumberSchema,
  enableReverseArbitrage: z.boolean().optional(),
  reverseArbitrageMinEdgeBps: bpsSchema.optional(),
  arbitrageDirection: z.enum(['forward', 'reverse', 'best']).optional(),
  // Dynamic slippage configuration
  dynamicSlippageMaxMultiplier: z.number().positive().default(2.0).optional(), // Max slippage = baseSlippage * this multiplier
  dynamicSlippageEdgeRatio: z.number().min(0).max(1).default(0.75).optional(), // Percentage of edge to allow as slippage (0-1)
});

/**
 * Bridging configuration schema
 */
export const bridgingConfigSchema = z.object({
  intervalMinutes: z.number().int().min(1),
  thresholdUsd: nonNegativeNumberSchema,
  maxRetries: nonNegativeNumberSchema,
  retryDelayMinutes: nonNegativeNumberSchema,
  tradesPerBridge: z.number().int().positive().optional(),
  bridgeCostUsd: positiveNumberSchema.optional(),
});

/**
 * Monitoring configuration schema
 */
export const monitoringConfigSchema = z.object({
  enableAlerts: z.boolean(),
  alertWebhookUrl: z.string(), // Allow any string (empty or URL)
  inventoryFloorUsd: nonNegativeNumberSchema,
  bridgeTimeoutMinutes: z.number().int().min(1),
});

/**
 * Auto-bridging configuration schema
 */
export const autoBridgingConfigSchema = z.object({
  enabled: z.boolean(),
  imbalanceThresholdPercent: z.number().int().min(50).max(100).default(80),
  targetSplitPercent: z.number().int().min(0).max(100).default(50),
  minRebalanceAmount: nonNegativeNumberSchema.default(100),
  checkIntervalMinutes: z.number().int().min(1).default(60),
  cooldownMinutes: z.number().int().min(0).default(30),
  maxBridgesPerDay: z.number().int().min(1).default(10),
  enabledTokens: z.array(z.string()).default([]), // Empty = all enabled tokens
  skipTokens: z.array(z.string()).default([]),
}).transform((data) => ({
  ...data,
  imbalanceThresholdPercent: data.imbalanceThresholdPercent ?? 80,
  targetSplitPercent: data.targetSplitPercent ?? 50,
  minRebalanceAmount: data.minRebalanceAmount ?? 100,
  checkIntervalMinutes: data.checkIntervalMinutes ?? 60,
  cooldownMinutes: data.cooldownMinutes ?? 30,
  maxBridgesPerDay: data.maxBridgesPerDay ?? 10,
  enabledTokens: data.enabledTokens ?? [],
  skipTokens: data.skipTokens ?? [],
}));

/**
 * Arbitrage strategy configuration schema
 */
export const arbitrageStrategySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  galaChainSide: z.object({
    quoteCurrency: z.string().min(1),
    operation: z.enum(['buy', 'sell']),
  }),
  solanaSide: z.object({
    quoteCurrency: z.string().min(1),
    operation: z.enum(['buy', 'sell']),
  }),
  enabled: z.boolean(),
  minEdgeBps: bpsSchema.optional(),
  priority: z.number().int().optional(),
});

/**
 * Network configuration schema
 */
export const networkConfigSchema = z.object({
  rpcUrl: z.string().url(),
  chainId: z.string().min(1),
});

/**
 * Networks configuration schema
 */
export const networksConfigSchema = z.object({
  galaChain: networkConfigSchema,
  solana: networkConfigSchema,
});

/**
 * Complete bot configuration schema
 */
export const botConfigSchema = z.object({
  tokens: z.record(z.string(), tokenConfigSchema),
  quoteTokens: z.record(z.string(), quoteTokenConfigSchema),
  trading: tradingConfigSchema,
  bridging: bridgingConfigSchema,
  monitoring: monitoringConfigSchema,
  autoBridging: autoBridgingConfigSchema.optional(),
  networks: networksConfigSchema,
  strategies: z.record(z.string(), arbitrageStrategySchema).optional(),
});

/**
 * Environment configuration schema (for validation of environment variables)
 */
export const environmentConfigSchema = z.object({
  GALACHAIN_PRIVATE_KEY: z.string().optional(),
  GALACHAIN_WALLET_ADDRESS: z.string().optional(),
  SOLANA_PRIVATE_KEY: z.string().optional(),
  SOLANA_WALLET_ADDRESS: z.string().optional(),
  BRIDGE_PRIVATE_KEY: z.string().optional(),
  BRIDGE_WALLET_ADDRESS: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  JUPITER_API_KEY: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().optional(),
  MIN_EDGE_BPS: z.string().optional(),
  MAX_SLIPPAGE_BPS: z.string().optional(),
  RISK_BUFFER_BPS: z.string().optional(),
  MAX_PRICE_IMPACT_BPS: z.string().optional(),
  COOLDOWN_MINUTES: z.string().optional(),
  MAX_DAILY_TRADES: z.string().optional(),
  BRIDGE_INTERVAL_MINUTES: z.string().optional(),
  BRIDGE_THRESHOLD_USD: z.string().optional(),
  INVENTORY_FLOOR_USD: z.string().optional(),
  BRIDGE_TIMEOUT_MINUTES: z.string().optional(),
  GALACHAIN_RPC_URL: z.string().url().optional(),
  SOLANA_RPC_URL: z.string().url().optional(),
});

/**
 * Validate and parse configuration
 */
export function validateBotConfig(config: unknown): z.infer<typeof botConfigSchema> {
  return botConfigSchema.parse(config);
}

/**
 * Validate and parse token configuration
 */
export function validateTokenConfig(config: unknown): z.infer<typeof tokenConfigSchema> {
  return tokenConfigSchema.parse(config);
}

/**
 * Validate and parse quote token configuration
 */
export function validateQuoteTokenConfig(config: unknown): z.infer<typeof quoteTokenConfigSchema> {
  return quoteTokenConfigSchema.parse(config);
}

/**
 * Get validation errors in a user-friendly format
 */
export function formatValidationError(error: z.ZodError): string[] {
  return error.issues.map((err) => {
    const path = err.path.join('.');
    return `${path}: ${err.message}`;
  });
}

