/**
 * Price Cache Service
 * 
 * Handles caching of USD prices (SOL/USD, GALA/USD) with TTL support.
 * Separates price caching from quote logic.
 */

import logger from '../utils/logger';

/**
 * Cached price entry
 */
interface CachedPrice {
  /** Price value */
  price: number;
  
  /** Timestamp when cached */
  timestamp: number;
  
  /** Source of the price */
  source: string;
}

/**
 * Price Cache Service
 * 
 * Manages USD price caching with TTL
 */
export class PriceCache {
  private cache: Map<string, CachedPrice> = new Map();
  private defaultTtl: number; // in milliseconds

  constructor(defaultTtl: number = 60000) { // 60 seconds default
    this.defaultTtl = defaultTtl;
  }

  /**
   * Get cached price
   * 
   * @param key - Cache key (e.g., 'SOL/USD', 'GALA/USD')
   * @param ttl - Optional TTL override in milliseconds
   * @returns Cached price or null if not found/expired
   */
  get(key: string, ttl?: number): number | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    const effectiveTtl = ttl || this.defaultTtl;
    const age = Date.now() - entry.timestamp;
    
    if (age > effectiveTtl) {
      // Cache expired, remove it
      this.cache.delete(key);
      logger.debug(`Cache expired for ${key} (age: ${Math.floor(age / 1000)}s, ttl: ${Math.floor(effectiveTtl / 1000)}s)`);
      return null;
    }

    logger.debug(`Cache hit for ${key} (age: ${Math.floor(age / 1000)}s)`);
    return entry.price;
  }

  /**
   * Set cached price
   * 
   * @param key - Cache key
   * @param price - Price value
   * @param source - Source of the price (for logging)
   */
  set(key: string, price: number, source: string = 'unknown'): void {
    const previous = this.cache.get(key);
    const changed = previous ? Math.abs(previous.price - price) > 0.0001 : true;
    
    this.cache.set(key, {
      price,
      timestamp: Date.now(),
      source
    });

    if (changed) {
      logger.debug(`Cached ${key}: $${price.toFixed(6)} [Source: ${source}]`);
    }
  }

  /**
   * Check if price is cached and fresh
   */
  has(key: string, ttl?: number): boolean {
    return this.get(key, ttl) !== null;
  }

  /**
   * Clear cache entry
   */
  clear(key: string): void {
    this.cache.delete(key);
    logger.debug(`Cleared cache for ${key}`);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
    logger.debug('Cleared all price cache');
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    keys: string[];
    entries: Array<{ key: string; price: number; age: number; source: string }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      price: entry.price,
      age: Math.floor((now - entry.timestamp) / 1000),
      source: entry.source
    }));

    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      entries
    };
  }

  /**
   * Clean expired entries
   */
  cleanExpired(ttl?: number): number {
    const effectiveTtl = ttl || this.defaultTtl;
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > effectiveTtl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired cache entries`);
    }

    return cleaned;
  }
}

/**
 * Global price cache instance
 */
let globalPriceCache: PriceCache | null = null;

/**
 * Get global price cache instance
 */
export function getPriceCache(): PriceCache {
  if (!globalPriceCache) {
    globalPriceCache = new PriceCache();
  }
  return globalPriceCache;
}

