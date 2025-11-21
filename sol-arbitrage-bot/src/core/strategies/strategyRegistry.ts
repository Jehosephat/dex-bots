/**
 * Strategy Registry
 * 
 * Manages and organizes multiple arbitrage strategies.
 * Loads strategies from configuration and provides access to enabled strategies.
 */

import { ArbitrageStrategy } from './arbitrageStrategy';
import logger from '../../utils/logger';

/**
 * Strategy Registry
 * 
 * Manages and evaluates multiple arbitrage strategies
 */
export class StrategyRegistry {
  private strategies: Map<string, ArbitrageStrategy> = new Map();

  /**
   * Register a strategy
   */
  register(strategy: ArbitrageStrategy): void {
    if (this.strategies.has(strategy.id)) {
      logger.warn(`Strategy ${strategy.id} already registered, overwriting`);
    }
    this.strategies.set(strategy.id, strategy);
    logger.debug(`Registered strategy: ${strategy.id} - ${strategy.name}`);
  }

  /**
   * Register multiple strategies
   */
  registerAll(strategies: ArbitrageStrategy[]): void {
    strategies.forEach(strategy => this.register(strategy));
  }

  /**
   * Get a strategy by ID
   */
  getStrategy(id: string): ArbitrageStrategy | undefined {
    return this.strategies.get(id);
  }

  /**
   * Get all enabled strategies
   */
  getAllEnabledStrategies(): ArbitrageStrategy[] {
    return Array.from(this.strategies.values())
      .filter(strategy => strategy.enabled)
      .sort((a, b) => {
        // Sort by priority (lower = higher priority)
        const priorityA = a.priority ?? 999;
        const priorityB = b.priority ?? 999;
        return priorityA - priorityB;
      });
  }

  /**
   * Get all strategies (including disabled)
   */
  getAllStrategies(): ArbitrageStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get enabled strategies for a specific token
   * 
   * Note: Currently all strategies are token-agnostic, but this method
   * allows for future token-specific strategy filtering
   */
  getStrategiesForToken(tokenSymbol: string): ArbitrageStrategy[] {
    // For now, return all enabled strategies
    // In the future, we could filter by token-specific strategy rules
    return this.getAllEnabledStrategies();
  }

  /**
   * Load strategies from configuration object
   * 
   * @param strategiesConfig - Object mapping strategy IDs to strategy configs
   */
  loadFromConfig(strategiesConfig: Record<string, any>): void {
    const loaded: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const [id, config] of Object.entries(strategiesConfig)) {
      try {
        const strategy = this.parseStrategyConfig(id, config);
        if (strategy) {
          this.register(strategy);
          loaded.push(id);
        } else {
          errors.push({ id, error: 'Failed to parse strategy config' });
        }
      } catch (error) {
        errors.push({
          id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (loaded.length > 0) {
      logger.info(`Loaded ${loaded.length} strategy(ies): ${loaded.join(', ')}`);
    }

    if (errors.length > 0) {
      logger.warn(`Failed to load ${errors.length} strategy(ies):`, errors);
    }
  }

  /**
   * Parse a single strategy configuration object
   */
  private parseStrategyConfig(id: string, config: any): ArbitrageStrategy | null {
    try {
      // Validate required fields
      if (!config.name) {
        throw new Error('Strategy name is required');
      }

      if (!config.galaChainSide || !config.solanaSide) {
        throw new Error('Both galaChainSide and solanaSide are required');
      }

      // Validate chain side configs
      const validateChainSide = (side: any, sideName: string) => {
        if (!side.quoteCurrency) {
          throw new Error(`${sideName} quoteCurrency is required`);
        }
        if (!side.operation || !['buy', 'sell'].includes(side.operation)) {
          throw new Error(`${sideName} operation must be 'buy' or 'sell'`);
        }
      };

      validateChainSide(config.galaChainSide, 'galaChainSide');
      validateChainSide(config.solanaSide, 'solanaSide');

      const strategy: ArbitrageStrategy = {
        id: id,
        name: config.name,
        description: config.description,
        galaChainSide: {
          chain: 'galaChain',
          quoteCurrency: config.galaChainSide.quoteCurrency,
          operation: config.galaChainSide.operation
        },
        solanaSide: {
          chain: 'solana',
          quoteCurrency: config.solanaSide.quoteCurrency,
          operation: config.solanaSide.operation
        },
        enabled: config.enabled !== false, // Default to enabled if not specified
        minEdgeBps: config.minEdgeBps,
        priority: config.priority
      };

      return strategy;
    } catch (error) {
      logger.error(`Failed to parse strategy ${id}:`, {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Clear all registered strategies
   */
  clear(): void {
    this.strategies.clear();
  }

  /**
   * Get count of enabled strategies
   */
  getEnabledCount(): number {
    return this.getAllEnabledStrategies().length;
  }

  /**
   * Get count of all strategies
   */
  getTotalCount(): number {
    return this.strategies.size;
  }
}

