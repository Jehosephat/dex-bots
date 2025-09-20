/**
 * Price Sources Module
 * Handles multiple price data sources for comparison and validation
 */

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

export interface PriceData {
  source: string;
  symbol: string;
  price: number;
  timestamp: number;
  volume24h?: number;
  lastUpdated: Date;
}

export interface PriceComparison {
  primary: PriceData;
  secondary: PriceData;
  difference: number;
  differencePercent: number;
  isValid: boolean;
  discrepancyThreshold: number;
}

export class PriceSourceManager {
  private sources: Map<string, PriceSource> = new Map();
  private discrepancyThreshold: number = 0.02; // 2% default

  constructor(discrepancyThreshold: number = 0.02) {
    this.discrepancyThreshold = discrepancyThreshold;
  }

  addSource(name: string, source: PriceSource): void {
    this.sources.set(name, source);
  }

  async getPrice(symbol: string, sourceName: string): Promise<PriceData> {
    const source = this.sources.get(sourceName);
    if (!source) {
      throw new Error(`Price source '${sourceName}' not found`);
    }
    return await source.getPrice(symbol);
  }

  async comparePrices(symbol: string, primarySource: string, secondarySource: string): Promise<PriceComparison> {
    const [primary, secondary] = await Promise.all([
      this.getPrice(symbol, primarySource),
      this.getPrice(symbol, secondarySource)
    ]);

    const difference = Math.abs(primary.price - secondary.price);
    const differencePercent = difference / Math.min(primary.price, secondary.price);

    return {
      primary,
      secondary,
      difference,
      differencePercent,
      isValid: differencePercent <= this.discrepancyThreshold,
      discrepancyThreshold: this.discrepancyThreshold
    };
  }

  setDiscrepancyThreshold(threshold: number): void {
    this.discrepancyThreshold = threshold;
  }
}

export abstract class PriceSource {
  abstract name: string;
  abstract getPrice(symbol: string): Promise<PriceData>;
}

export class CoinGeckoSource extends PriceSource {
  name = "coingecko";
  private apiKey: string;
  private baseUrl = "https://api.coingecko.com/api/v3";

  constructor(apiKey: string = "") {
    super();
    this.apiKey = apiKey;
  }

  async getPrice(symbol: string): Promise<PriceData> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["x-cg-demo-api-key"] = this.apiKey;
    }

    // For GALA v2 on Ethereum
    const contractAddress = "0xd1d2eb1b1e90b638588728b4130137d262c87cae";
    const url = `${this.baseUrl}/simple/token_price/ethereum?contract_addresses=${contractAddress}&vs_currencies=usd,eth`;

    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const tokenData = data[contractAddress.toLowerCase()];
    
    if (!tokenData) {
      throw new Error("Token data not found in CoinGecko response");
    }

    return {
      source: this.name,
      symbol: symbol.toUpperCase(),
      price: tokenData.usd || tokenData.eth,
      timestamp: Date.now(),
      lastUpdated: new Date()
    };
  }
}

export class GSwapSource extends PriceSource {
  name = "gswap";
  private gSwap: GSwap | null = null;
  private privateKey?: string | undefined;

  constructor(privateKey?: string) {
    super();
    this.privateKey = privateKey;
  }

  private async initializeGSwap(): Promise<void> {
    if (!this.gSwap) {
      if (!this.privateKey) {
        throw new Error("Private key required for GSwap SDK");
      }
      const signer = new PrivateKeySigner(this.privateKey);
      this.gSwap = new GSwap({ signer });
    }
  }

  async getPrice(symbol: string): Promise<PriceData> {
    try {
      await this.initializeGSwap();
      
      // Convert symbol to GSwap token format
      const tokenIn = this.getTokenFormat(symbol, true);  // GUSDC
      const tokenOut = this.getTokenFormat(symbol, false); // GALA
      
      // Get quote for 1 unit of input token
      const quote = await this.gSwap!.quoting.quoteExactInput(
        tokenIn,
        tokenOut,
        1 // 1 unit of input token
      );

      // Calculate price: output amount / input amount
      const price = quote.outTokenAmount.toNumber();
      
      return {
        source: this.name,
        symbol: symbol.toUpperCase(),
        price: price,
        timestamp: Date.now(),
        lastUpdated: new Date()
      };
    } catch (error) {
      console.warn(`GSwap API not available: ${error}`);
      // Fallback to mock data for development
      return {
        source: this.name,
        symbol: symbol.toUpperCase(),
        price: 0.017, // Mock GALA price in ETH
        timestamp: Date.now(),
        lastUpdated: new Date()
      };
    }
  }

  private getTokenFormat(symbol: string, isInput: boolean): string {
    // For GALA/ETH pair, we'll use GALA/GUSDC on GalaChain
    if (symbol.toLowerCase().includes('gala')) {
      return isInput ? "GUSDC|Unit|none|none" : "GALA|Unit|none|none";
    }
    // Default fallback
    return isInput ? "GUSDC|Unit|none|none" : "GALA|Unit|none|none";
  }
}

export class BinanceSource extends PriceSource {
  name = "binance";
  private baseUrl = "https://api.binance.com/api/v3";

  async getPrice(symbol: string): Promise<PriceData> {
    const url = `${this.baseUrl}/ticker/price?symbol=${symbol}`;
    
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      source: this.name,
      symbol: data.symbol,
      price: parseFloat(data.price),
      timestamp: Date.now(),
      lastUpdated: new Date()
    };
  }
}

// Utility functions
export function formatPriceComparison(comparison: PriceComparison): string {
  const status = comparison.isValid ? "✅ VALID" : "⚠️ DISCREPANCY";
  return `${status} | ${comparison.primary.source}: $${comparison.primary.price.toFixed(8)} | ${comparison.secondary.source}: $${comparison.secondary.price.toFixed(8)} | Diff: ${(comparison.differencePercent * 100).toFixed(2)}%`;
}

export function shouldProceedWithTrade(comparison: PriceComparison): boolean {
  return comparison.isValid;
}
