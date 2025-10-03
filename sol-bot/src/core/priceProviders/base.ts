import { TokenPrice, TokenConfig } from '../../types';

/**
 * Base interface for all price discovery providers
 * Each blockchain/DEX should implement this interface
 */
export interface IPriceProvider {
  /**
   * Initialize the provider (e.g., connect to network, load configs)
   */
  initialize(): Promise<void>;

  /**
   * Fetch prices for the given tokens
   */
  updatePrices(tokens: TokenConfig[]): Promise<void>;

  /**
   * Get price for a specific token
   */
  getPrice(symbol: string): TokenPrice | undefined;

  /**
   * Get all prices from this provider
   */
  getAllPrices(): Map<string, TokenPrice>;

  /**
   * Get the name of this price provider
   */
  getName(): string;
}

/**
 * Abstract base class that provides common functionality
 */
export abstract class BasePriceProvider implements IPriceProvider {
  protected prices: Map<string, TokenPrice> = new Map();
  protected lastUpdate: number = 0;

  abstract initialize(): Promise<void>;
  abstract updatePrices(tokens: TokenConfig[]): Promise<void>;
  abstract getName(): string;

  getPrice(symbol: string): TokenPrice | undefined {
    return this.prices.get(symbol);
  }

  getAllPrices(): Map<string, TokenPrice> {
    return this.prices;
  }

  getLastUpdate(): number {
    return this.lastUpdate;
  }

  protected setPrice(symbol: string, price: TokenPrice): void {
    this.prices.set(symbol, price);
  }

  protected updateTimestamp(): void {
    this.lastUpdate = Date.now();
  }
}

