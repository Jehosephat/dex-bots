import BigNumber from 'bignumber.js';
import { ArbitrageOpportunity, TokenPrice, TokenConfig } from '../types';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { IPriceProvider, GalaChainPriceProvider, SolanaPriceProvider } from './priceProviders';

/**
 * Main price discovery orchestrator
 * Coordinates multiple price providers to discover arbitrage opportunities
 */
export class PriceDiscovery {
  private providers: Map<string, IPriceProvider> = new Map();
  private galaChainProvider: GalaChainPriceProvider;
  private solanaProvider: SolanaPriceProvider;
  private lastUpdate: number = 0;

  constructor() {
    // Initialize default providers
    this.galaChainProvider = new GalaChainPriceProvider();
    this.solanaProvider = new SolanaPriceProvider();
    
    // Register providers
    this.providers.set('galachain', this.galaChainProvider);
    this.providers.set('solana', this.solanaProvider);
  }

  /**
   * Add a custom price provider
   * This allows plugging in new networks/exchanges as needed
   */
  addProvider(provider: IPriceProvider): void {
    this.providers.set(provider.getName(), provider);
    logger.info(`Added price provider: ${provider.getName()}`);
  }

  /**
   * Remove a price provider
   */
  removeProvider(name: string): void {
    this.providers.delete(name);
    logger.info(`Removed price provider: ${name}`);
  }

  /**
   * Get a specific provider
   */
  getProvider(name: string): IPriceProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Initialize all price providers
   */
  async initialize(): Promise<void> {
    const initPromises = Array.from(this.providers.values()).map(provider => 
      provider.initialize().catch(error => {
        logger.error(`Failed to initialize ${provider.getName()} provider`, { error });
      })
    );
    await Promise.all(initPromises);
    logger.info('Price discovery initialized with providers:', Array.from(this.providers.keys()));
  }

  async discoverOpportunities(): Promise<ArbitrageOpportunity[]> {
    try {
      await this.updatePrices();

      const opportunities: ArbitrageOpportunity[] = [];
      const enabledTokens = config.getEnabledTokens();
      const botConfig = config.getBotConfig();

      for (const token of enabledTokens) {
        // Get prices from GalaChain and Solana
        const gcPrice = this.galaChainProvider.getPrice(token.symbol);
        const solPrice = this.solanaProvider.getPrice(token.symbol);

        if (!gcPrice || !solPrice) {
          logger.warn(`Missing prices for ${token.symbol}`);
          continue;
        }

        // Calculate opportunity for different trade sizes
        const sizes = this.calculateTradeSizes(token);
        
        for (const size of sizes) {
          const opportunity = await this.evaluateOpportunity(
            token,
            size,
            gcPrice,
            solPrice
          );

          if (opportunity && opportunity.netEdge >= botConfig.trading.minEdgeThreshold) {
            opportunities.push(opportunity);
          }
        }
      }

      // Sort by net edge (highest first)
      opportunities.sort((a, b) => b.netEdge - a.netEdge);

      if (opportunities.length > 0) {
        logger.info(`Found ${opportunities.length} arbitrage opportunities`);
      }

      return opportunities;
    } catch (error) {
      logger.error('Error discovering opportunities', { error });
      return [];
    }
  }

  private async updatePrices(): Promise<void> {
    const botConfig = config.getBotConfig();
    const now = Date.now();

    // Only update if enough time has passed
    if (now - this.lastUpdate < botConfig.trading.priceUpdateInterval) {
      return;
    }

    const enabledTokens = config.getEnabledTokens();

    // Update prices from all providers in parallel
    const updatePromises = Array.from(this.providers.values()).map(provider =>
      provider.updatePrices(enabledTokens).catch(error => {
        logger.error(`Failed to update prices from ${provider.getName()}`, { error });
      })
    );
    
    await Promise.all(updatePromises);

    this.lastUpdate = now;
  }

  private calculateTradeSizes(tokenConfig: TokenConfig): number[] {
    const sizes: number[] = [];
    const min = tokenConfig.minTradeSize;
    const max = tokenConfig.maxTradeSize;

    sizes.push(min);

    const steps = 3;
    for (let i = 1; i <= steps; i++) {
      const size = min + (max - min) * (i / (steps + 1));
      sizes.push(size);
    }

    return sizes;
  }

  private async evaluateOpportunity(
    token: TokenConfig,
    size: number,
    gcPrice: TokenPrice,
    solPrice: TokenPrice
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const botConfig = config.getBotConfig();

      // 1. Calculate GC sell proceeds (token -> GALA)
      const gcSellProceeds = size * gcPrice.price;

      // 2. Calculate SOL buy cost in GALA terms
      const solBuyCost = await this.calculateSolBuyCostInGALA(token, size, solPrice);

      // 3. Calculate bridge cost in GALA
      const bridgeCostGALA = await this.calculateBridgeCostGALA();

      // 4. Apply risk buffer
      const riskBufferAmount = gcSellProceeds * botConfig.trading.riskBuffer;

      // 5. Calculate net edge
      const netEdge = gcSellProceeds - solBuyCost - bridgeCostGALA - riskBufferAmount;

      // 6. Calculate as percentage
      const edgePercent = netEdge / gcSellProceeds;

      if (edgePercent < botConfig.trading.minEdgeThreshold) {
        return null;
      }

      return {
        token: token.symbol,
        netEdge: edgePercent,
        gcSellPrice: gcPrice.price,
        solBuyPrice: solPrice.price,
        bridgeCostGALA,
        recommendedSize: size,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Error evaluating opportunity for ${token.symbol}`, { error });
      return null;
    }
  }

  private async calculateSolBuyCostInGALA(
    _token: TokenConfig,
    size: number,
    solPrice: TokenPrice
  ): Promise<number> {
    // Calculate cost in SOL
    const costInSOL = size / solPrice.price;

    // Convert SOL to GALA
    const solGalaPrice = await this.getSOLGALAPrice();
    
    return costInSOL * solGalaPrice;
  }

  private async getSOLGALAPrice(): Promise<number> {
    // Get SOL price in USD from Solana provider
    const solUSDPrice = this.solanaProvider.getSOLUSDPrice();
    
    // Get GALA price in USD from GalaChain provider
    const galaUSDPrice = await this.galaChainProvider.getGALAUSDPrice();
    
    // Calculate SOL/GALA rate
    return solUSDPrice / galaUSDPrice;
  }

  private async calculateBridgeCostGALA(): Promise<number> {
    const botConfig = config.getBotConfig();
    const bridgeCostUSD = botConfig.bridging.bridgeCostUSD;

    // Get current GALA/USD price
    const galaUSDPrice = await this.galaChainProvider.getGALAUSDPrice();

    return bridgeCostUSD / galaUSDPrice;
  }

  // Public getters for backward compatibility
  getGalaChainPrice(token: string): TokenPrice | undefined {
    return this.galaChainProvider.getPrice(token);
  }

  getSolanaPrice(token: string): TokenPrice | undefined {
    return this.solanaProvider.getPrice(token);
  }

  getAllPrices() {
    return {
      galaChain: Array.from(this.galaChainProvider.getAllPrices().entries()),
      solana: Array.from(this.solanaProvider.getAllPrices().entries()),
      lastUpdate: this.lastUpdate
    };
  }

  async getGalaUSDPrice(): Promise<number> {
    return await this.galaChainProvider.getGALAUSDPrice();
  }

  /**
   * Get prices from a specific provider
   */
  getPricesFromProvider(providerName: string): Map<string, TokenPrice> | undefined {
    const provider = this.providers.get(providerName);
    return provider?.getAllPrices();
  }

  /**
   * Get list of all registered providers
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }
}
