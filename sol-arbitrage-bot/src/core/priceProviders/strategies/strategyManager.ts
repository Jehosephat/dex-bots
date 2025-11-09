/**
 * Strategy Manager
 * 
 * Manages quote strategies and selects the appropriate strategy for a given token.
 */

import { TokenConfig } from '../../../types/config';
import { IQuoteStrategy } from './quoteStrategy';
import { SolanaSolToGalaStrategy } from './solanaSolToGalaStrategy';
import { SolanaTokenToGalaStrategy } from './solanaTokenToGalaStrategy';
import { SolanaStandardQuoteStrategy } from './solanaStandardQuoteStrategy';

/**
 * Strategy Manager
 * 
 * Selects and manages quote strategies
 */
export class StrategyManager {
  private strategies: IQuoteStrategy[] = [];

  constructor(strategies: IQuoteStrategy[]) {
    this.strategies = strategies;
  }

  /**
   * Get strategy for a token configuration
   */
  getStrategy(tokenConfig: TokenConfig, reverse?: boolean): IQuoteStrategy | null {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(tokenConfig, reverse)) {
        return strategy;
      }
    }
    return null;
  }

  /**
   * Create default Solana strategy manager
   */
  static createSolanaStrategyManager(
    jupiterApiUrl: string,
    getJupiterQuote: (tokenSymbol: string, amount: number, reverse: boolean, quoteCurrency?: string) => Promise<{
      inputAmount: string;
      outputAmount: string;
      priceImpact: number;
      route?: any;
    } | null>,
    getSpotPrice: (tokenSymbol: string) => Promise<any>,
    configService: any
  ): StrategyManager {
    const strategies: IQuoteStrategy[] = [
      new SolanaSolToGalaStrategy(jupiterApiUrl),
      new SolanaTokenToGalaStrategy(jupiterApiUrl),
      new SolanaStandardQuoteStrategy(jupiterApiUrl, getJupiterQuote, getSpotPrice, configService)
    ];
    
    return new StrategyManager(strategies);
  }
}

