/**
 * Base Price Provider Interface and Implementation
 * 
 * Defines the interface for all price providers and provides common functionality.
 */

import { PriceQuote } from '../../types/core';
import { TokenConfig } from '../../types/config';

/**
 * Interface for all price discovery providers
 * Each blockchain/DEX should implement this interface
 */
export interface IPriceProvider {
  /**
   * Initialize the provider (e.g., connect to network, load configs)
   */
  initialize(): Promise<void>;

  /**
   * Get a quote for a specific token and amount
   * @param reverse If true, get reverse quote (buy on GC, sell on SOL). Default false.
   */
  getQuote(symbol: string, amount: number, reverse?: boolean): Promise<PriceQuote | null>;

  /**
   * Get the name of this price provider
   */
  getName(): string;

  /**
   * Check if the provider is ready
   */
  isReady(): boolean;

  /**
   * Get last error if any
   */
  getLastError(): string | null;
}

/**
 * Abstract base class that provides common functionality
 */
export abstract class BasePriceProvider implements IPriceProvider {
  protected isInitialized: boolean = false;
  protected lastError: string | null = null;
  protected lastUpdate: number = 0;

  abstract initialize(): Promise<void>;
  abstract getQuote(symbol: string, amount: number): Promise<PriceQuote | null>;
  abstract getName(): string;

  isReady(): boolean {
    return this.isInitialized && !this.lastError;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  protected setError(error: string): void {
    this.lastError = error;
  }

  protected clearError(): void {
    this.lastError = null;
  }

  protected updateTimestamp(): void {
    this.lastUpdate = Date.now();
  }

  protected getQuoteAge(): number {
    return Date.now() - this.lastUpdate;
  }
}
