/**
 * Quote Manager for SOL Arbitrage Bot
 * 
 * Coordinates between GalaChain and Solana price providers,
 * manages quote freshness, validation, and cooldown logic.
 */

import {
  ArbitrageOpportunity,
  PriceQuote,
  GalaChainQuote,
  SolanaQuote
} from '../types/core';
import { TokenConfig } from '../types/config';
import { IConfigService, createConfigService } from '../config';
import { IPriceProvider } from './priceProviders/base';
import { UnifiedEdgeCalculator } from './unifiedEdgeCalculator';
import logger from '../utils/logger';
import { isExpired } from '../utils/calculations';

export interface QuoteManagerConfig {
  /** Maximum quote age in seconds */
  maxQuoteAge: number;
  
  /** Cooldown period in seconds after failed quote */
  cooldownPeriod: number;
  
  /** Maximum retries for failed quotes */
  maxRetries: number;
  
  /** Quote validation timeout in milliseconds */
  quoteTimeout: number;
}

export class QuoteManager {
  private galaChainProvider: IPriceProvider;
  private solanaProvider: IPriceProvider;
  private edgeCalculator: UnifiedEdgeCalculator;
  private config: QuoteManagerConfig;
  private tokenCooldowns: Map<string, number> = new Map();
  private retryCounts: Map<string, number> = new Map();

  constructor(
    galaChainProvider: IPriceProvider,
    solanaProvider: IPriceProvider,
    config?: Partial<QuoteManagerConfig>,
    configService?: IConfigService
  ) {
    this.galaChainProvider = galaChainProvider;
    this.solanaProvider = solanaProvider;
    this.edgeCalculator = new UnifiedEdgeCalculator(configService || createConfigService());
    
    this.config = {
      maxQuoteAge: 30, // 30 seconds
      cooldownPeriod: 60, // 1 minute
      maxRetries: 3,
      quoteTimeout: 10000, // 10 seconds
      ...config
    };
  }

  /**
   * Initialize the quote manager
   */
  async initialize(): Promise<void> {
    try {
      await this.galaChainProvider.initialize();
      await this.solanaProvider.initialize();
      
      if (!this.galaChainProvider.isReady()) {
        throw new Error('GalaChain provider not ready');
      }
      
      if (!this.solanaProvider.isReady()) {
        throw new Error('Solana provider not ready');
      }
      
      logger.info('✅ Quote manager initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to initialize quote manager', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Discover arbitrage opportunities for all enabled tokens
   */
  async discoverOpportunities(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    // Use config service from edge calculator or create default
    const configService = (this.edgeCalculator as any).configService || createConfigService();
    const enabledTokens = configService.getEnabledTokens();
    
    logger.info(`🔍 Discovering opportunities for ${enabledTokens.length} tokens`);
    
    for (const token of enabledTokens) {
      try {
        // Check cooldown
        if (this.isTokenInCooldown(token.symbol)) {
          logger.debug(`⏰ Token ${token.symbol} in cooldown, skipping`);
          continue;
        }

        // Get quotes for both chains
        const [galaChainQuote, solanaQuote] = await Promise.all([
          this.getGalaChainQuote(token),
          this.getSolanaQuote(token)
        ]);

        if (!galaChainQuote || !solanaQuote) {
          this.handleQuoteFailure(token.symbol);
          continue;
        }

        // Validate quote freshness
        if (!this.isQuoteFresh(galaChainQuote) || !this.isQuoteFresh(solanaQuote)) {
          logger.warn(`⚠️ Stale quotes for ${token.symbol}, skipping`);
          this.handleQuoteFailure(token.symbol);
          continue;
        }

        // Calculate edge
        const solToGalaRate = await this.calculateSolToGalaRate();
        const edgeResult = this.edgeCalculator.calculateEdge(
          'forward',
          token,
          galaChainQuote as GalaChainQuote,
          solanaQuote as SolanaQuote,
          solToGalaRate
        );

        // Create opportunity if profitable
        const opportunity = this.edgeCalculator.createArbitrageOpportunity(
          token,
          galaChainQuote as GalaChainQuote,
          solanaQuote as SolanaQuote,
          edgeResult
        );

        if (opportunity) {
          opportunities.push(opportunity);
          this.clearTokenCooldown(token.symbol);
          logger.info(`💰 Found opportunity for ${token.symbol}: ${edgeResult.netEdgeBps}bps edge`);
        } else {
          logger.debug(`❌ No opportunity for ${token.symbol}: ${edgeResult.invalidationReasons.join(', ')}`);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Error processing ${token.symbol}`, { error: errorMessage });
        this.handleQuoteFailure(token.symbol);
      }
    }

    // Sort opportunities by net edge (highest first)
    opportunities.sort((a, b) => b.netEdgeBps - a.netEdgeBps);

    logger.info(`🎯 Found ${opportunities.length} profitable opportunities`);
    return opportunities;
  }

  /**
   * Get quote for a specific token from GalaChain
   */
  async getGalaChainQuote(token: TokenConfig): Promise<PriceQuote | null> {
    try {
      const quote = await this.galaChainProvider.getQuote(token.symbol, token.tradeSize);
      
      if (!quote) {
        logger.warn(`⚠️ No GalaChain quote for ${token.symbol}`);
        return null;
      }

      if (!this.isQuoteValid(quote)) {
        logger.warn(`⚠️ Invalid GalaChain quote for ${token.symbol}`);
        return null;
      }

      return quote;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ GalaChain quote failed for ${token.symbol}`, { error: errorMessage });
      return null;
    }
  }

  /**
   * Get quote for a specific token from Solana
   */
  async getSolanaQuote(token: TokenConfig): Promise<PriceQuote | null> {
    try {
      const quote = await this.solanaProvider.getQuote(token.symbol, token.tradeSize);
      
      if (!quote) {
        logger.warn(`⚠️ No Solana quote for ${token.symbol}`);
        return null;
      }

      if (!this.isQuoteValid(quote)) {
        logger.warn(`⚠️ Invalid Solana quote for ${token.symbol}`);
        return null;
      }

      return quote;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Solana quote failed for ${token.symbol}`, { error: errorMessage });
      return null;
    }
  }

  /**
   * Calculate SOL to GALA conversion rate
   */
  private async calculateSolToGalaRate(): Promise<BigNumber> {
    try {
      // Get SOL/USD price from Solana provider
      const solUsdPrice = (this.solanaProvider as any).getSOLUSDPrice?.() || 225;

      // Get GALA/USD price from GalaChain provider
      const galaUsdPrice = (this.galaChainProvider as any).getGALAUSDPrice?.() || 0.04;

      return await this.edgeCalculator.calculateQuoteToGalaRate(galaUsdPrice, solUsdPrice);
    } catch (error) {
      logger.warn('⚠️ Failed to calculate SOL to GALA rate, using fallback', { error });
      return new BigNumber(5625); // Fallback rate: 225 / 0.04
    }
  }

  /**
   * Check if quote is fresh (not expired)
   */
  private isQuoteFresh(quote: PriceQuote): boolean {
    const age = Math.floor((Date.now() - quote.timestamp) / 1000);
    return age <= this.config.maxQuoteAge && !isExpired(quote.expiresAt);
  }

  /**
   * Check if quote is valid
   */
  private isQuoteValid(quote: PriceQuote): boolean {
    return quote.isValid && 
           quote.price.isPositive() && 
           quote.price.isFinite() &&
           !isExpired(quote.expiresAt);
  }

  /**
   * Check if token is in cooldown
   */
  private isTokenInCooldown(symbol: string): boolean {
    const cooldownEnd = this.tokenCooldowns.get(symbol);
    if (!cooldownEnd) return false;
    
    if (Date.now() < cooldownEnd) {
      return true;
    }
    
    // Clear expired cooldown
    this.tokenCooldowns.delete(symbol);
    return false;
  }

  /**
   * Set token cooldown
   */
  private setTokenCooldown(symbol: string): void {
    const cooldownEnd = Date.now() + (this.config.cooldownPeriod * 1000);
    this.tokenCooldowns.set(symbol, cooldownEnd);
    logger.debug(`⏰ Set cooldown for ${symbol} until ${new Date(cooldownEnd).toISOString()}`);
  }

  /**
   * Clear token cooldown
   */
  private clearTokenCooldown(symbol: string): void {
    this.tokenCooldowns.delete(symbol);
    this.retryCounts.delete(symbol);
  }

  /**
   * Handle quote failure
   */
  private handleQuoteFailure(symbol: string): void {
    const retryCount = this.retryCounts.get(symbol) || 0;
    const newRetryCount = retryCount + 1;
    
    this.retryCounts.set(symbol, newRetryCount);
    
    if (newRetryCount >= this.config.maxRetries) {
      this.setTokenCooldown(symbol);
      logger.warn(`⚠️ Max retries reached for ${symbol}, setting cooldown`);
    } else {
      logger.debug(`🔄 Quote failure for ${symbol}, retry ${newRetryCount}/${this.config.maxRetries}`);
    }
  }

  /**
   * Get cooldown status for all tokens
   */
  getCooldownStatus(): Map<string, { inCooldown: boolean; cooldownEnd?: number }> {
    const status = new Map();
    const now = Date.now();
    
    for (const [symbol, cooldownEnd] of this.tokenCooldowns.entries()) {
      if (now < cooldownEnd) {
        status.set(symbol, { inCooldown: true, cooldownEnd });
      } else {
        status.set(symbol, { inCooldown: false });
      }
    }
    
    return status;
  }

  /**
   * Get retry counts for all tokens
   */
  getRetryCounts(): Map<string, number> {
    return new Map(this.retryCounts);
  }

  /**
   * Reset all cooldowns and retry counts
   */
  resetAll(): void {
    this.tokenCooldowns.clear();
    this.retryCounts.clear();
    logger.info('🔄 Reset all cooldowns and retry counts');
  }
}
