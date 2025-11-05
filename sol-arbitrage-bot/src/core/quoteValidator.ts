/**
 * Quote Validator
 * 
 * Validates quotes for freshness, completeness, and correctness.
 * Rejects stale or invalid quotes automatically.
 */

import logger from '../utils/logger';
import { PriceQuote, GalaChainQuote, SolanaQuote } from '../types/core';
import BigNumber from 'bignumber.js';

/**
 * Quote validation result
 */
export interface QuoteValidationResult {
  /** Whether quote is valid */
  isValid: boolean;
  
  /** Validation errors (if any) */
  errors: string[];
  
  /** Warnings (non-blocking issues) */
  warnings: string[];
  
  /** Quote age in seconds */
  age: number;
  
  /** Whether quote is expired */
  isExpired: boolean;
}

/**
 * Quote Validator
 * 
 * Validates quotes before they are used in trading decisions
 */
export class QuoteValidator {
  private readonly maxQuoteAge: number; // in seconds
  private readonly maxPriceImpactBps: number;
  private readonly minPrice: number;

  constructor(
    maxQuoteAge: number = 30, // 30 seconds default
    maxPriceImpactBps: number = 1000, // 10% default
    minPrice: number = 0.00000001 // minimum price to avoid zero/negative
  ) {
    this.maxQuoteAge = maxQuoteAge;
    this.maxPriceImpactBps = maxPriceImpactBps;
    this.minPrice = minPrice;
  }

  /**
   * Validate a quote
   */
  validate(quote: PriceQuote | null, context?: string): QuoteValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!quote) {
      return {
        isValid: false,
        errors: ['Quote is null or undefined'],
        warnings: [],
        age: 0,
        isExpired: true
      };
    }

    // Check timestamp and expiration
    const now = Date.now();
    const age = Math.floor((now - quote.timestamp) / 1000);
    const isExpired = now >= (quote.expiresAt || quote.timestamp + 30000);

    if (isExpired) {
      errors.push(`Quote expired (age: ${age}s, expiresAt: ${new Date(quote.expiresAt || quote.timestamp + 30000).toISOString()})`);
    } else if (age > this.maxQuoteAge) {
      errors.push(`Quote too old (age: ${age}s, max: ${this.maxQuoteAge}s)`);
    }

    // Check required fields
    if (!quote.symbol) {
      errors.push('Missing symbol');
    }

    if (!quote.price) {
      errors.push('Missing price');
    } else if (quote.price instanceof BigNumber) {
      if (quote.price.isNaN() || quote.price.isZero() || quote.price.isNegative()) {
        errors.push(`Invalid price: ${quote.price.toString()}`);
      }
      if (quote.price.lt(this.minPrice)) {
        warnings.push(`Price is very low: ${quote.price.toString()}`);
      }
    }

    if (quote.tradeSize <= 0) {
      errors.push(`Invalid trade size: ${quote.tradeSize}`);
    }

    if (!quote.provider) {
      errors.push('Missing provider');
    }

    // Check price impact
    if (quote.priceImpactBps !== undefined) {
      if (quote.priceImpactBps < 0) {
        errors.push(`Negative price impact: ${quote.priceImpactBps} bps`);
      } else if (quote.priceImpactBps > this.maxPriceImpactBps) {
        warnings.push(`High price impact: ${quote.priceImpactBps} bps (max: ${this.maxPriceImpactBps} bps)`);
      }
    }

    // Check isValid flag
    if (quote.isValid === false) {
      errors.push('Quote marked as invalid');
    }

    // Provider-specific validation
    if (quote.provider === 'solana') {
      const solQuote = quote as SolanaQuote;
      if (!solQuote.currency) {
        errors.push('Missing currency in Solana quote');
      }
      if (solQuote.minOutput && solQuote.minOutput instanceof BigNumber) {
        if (solQuote.minOutput.isNegative() || solQuote.minOutput.isZero()) {
          warnings.push(`Low minOutput: ${solQuote.minOutput.toString()}`);
        }
      }
    } else if (quote.provider === 'galachain') {
      const gcQuote = quote as GalaChainQuote;
      if (gcQuote.currency !== 'GALA') {
        warnings.push(`GalaChain quote currency is ${gcQuote.currency}, expected GALA`);
      }
      if (gcQuote.galaFee && gcQuote.galaFee instanceof BigNumber) {
        if (gcQuote.galaFee.isNegative()) {
          errors.push(`Negative GALA fee: ${gcQuote.galaFee.toString()}`);
        }
      }
    }

    const isValid = errors.length === 0;

    if (!isValid && context) {
      // Format errors more readably
      const errorSummary = errors.length > 0 
        ? errors.slice(0, 2).join('; ') + (errors.length > 2 ? ` (+${errors.length - 2} more)` : '')
        : 'Validation failed';
      logger.debug(`   ⚠️  Quote validation failed: ${errorSummary}`);
    }

    return {
      isValid,
      errors,
      warnings,
      age,
      isExpired
    };
  }

  /**
   * Validate multiple quotes
   */
  validateQuotes(quotes: (PriceQuote | null)[], context?: string): QuoteValidationResult[] {
    return quotes.map((quote, index) => 
      this.validate(quote, context ? `${context}[${index}]` : `quote[${index}]`)
    );
  }

  /**
   * Check if quote is fresh (not expired and within age limit)
   */
  isFresh(quote: PriceQuote | null): boolean {
    if (!quote) return false;
    
    const result = this.validate(quote);
    return result.isValid && !result.isExpired && result.age <= this.maxQuoteAge;
  }

  /**
   * Check if quote is expired
   */
  isExpired(quote: PriceQuote | null): boolean {
    if (!quote) return true;
    
    const now = Date.now();
    return now >= (quote.expiresAt || quote.timestamp + 30000);
  }

  /**
   * Get quote age in seconds
   */
  getAge(quote: PriceQuote | null): number {
    if (!quote) return Infinity;
    
    return Math.floor((Date.now() - quote.timestamp) / 1000);
  }
}

