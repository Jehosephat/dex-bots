/**
 * Price Sources Module
 * Handles multiple price data sources for comparison and validation
 */

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

export class QuoteExactAmountSource extends PriceSource {
  name = "quoteexactamount";
  private baseUrl: string;
  private apiKey?: string | undefined;

  constructor(baseUrl: string, apiKey?: string) {
    super();
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async getPrice(symbol: string): Promise<PriceData> {
    // Placeholder implementation - needs actual API details
    // This will be updated once QuoteExactAmount API documentation is available
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    // Placeholder URL - needs to be updated with actual endpoint
    const url = `${this.baseUrl}/api/v1/price/${symbol}`;
    
    try {
      const response = await fetch(url, { headers, cache: "no-store" });
      if (!response.ok) {
        throw new Error(`QuoteExactAmount API error: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        source: this.name,
        symbol: symbol.toUpperCase(),
        price: data.price || data.last || data.close,
        timestamp: Date.now(),
        lastUpdated: new Date()
      };
    } catch (error) {
      // Fallback to mock data for development
      console.warn(`QuoteExactAmount API not available, using mock data: ${error}`);
      return {
        source: this.name,
        symbol: symbol.toUpperCase(),
        price: 0.05, // Mock GALA price
        timestamp: Date.now(),
        lastUpdated: new Date()
      };
    }
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
