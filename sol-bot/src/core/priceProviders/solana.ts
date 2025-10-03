import axios from 'axios';
import { BasePriceProvider } from './base';
import { TokenPrice, TokenConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Solana DEX price provider
 * Fetches prices from Solana via Jupiter aggregator and CoinGecko
 */
export class SolanaPriceProvider extends BasePriceProvider {
  private jupiterApiUrl = 'https://lite-api.jup.ag/swap/v1';
  private coinGeckoApiUrl = 'https://api.coingecko.com/api/v3';
  private solUSDPrice: number = 0;
  private solUSDPriceLastUpdate: number = 0;
  private solUSDPriceCacheDuration: number = 60000; // Cache for 60 seconds to avoid rate limits

  async initialize(): Promise<void> {
    // Fetch initial SOL/USD price
    await this.updateSOLUSDPrice();
    logger.info('Solana price provider initialized');
  }

  getName(): string {
    return 'solana';
  }

  async updatePrices(tokens: TokenConfig[]): Promise<void> {
    // First, update SOL/USD price
    await this.updateSOLUSDPrice();

    for (const tokenConfig of tokens) {
      try {
        if (!tokenConfig.solanaMint) {
          continue;
        }

        const solMint = 'So11111111111111111111111111111111111111112';
        
        // Skip if this token IS SOL (already handled by updateSOLUSDPrice)
        if (tokenConfig.solanaMint === solMint) {
          logger.debug(`Skipping Jupiter quote for ${tokenConfig.symbol} (it is SOL itself, using market price)`);
          continue;
        }

        // Use Jupiter API to get quote (token → SOL)
        const quoteAmount = tokenConfig.minTradeSize * Math.pow(10, tokenConfig.decimals);
        
        const response = await axios.get(`${this.jupiterApiUrl}/quote`, {
          params: {
            inputMint: tokenConfig.solanaMint,
            outputMint: solMint,
            amount: Math.floor(quoteAmount),
            slippageBps: 50
          },
          timeout: 10000
        });

        if (response.data && response.data.outAmount) {
          const solReceived = response.data.outAmount / 1e9;
          const priceInSOL = solReceived / tokenConfig.minTradeSize;
          const priceInUSD = priceInSOL * this.solUSDPrice;

          this.setPrice(tokenConfig.symbol, {
            token: tokenConfig.symbol,
            price: priceInSOL,
            priceUSD: priceInUSD,
            liquidity: 0,
            timestamp: Date.now(),
            source: 'solana'
          });

          logger.debug(`Solana price for ${tokenConfig.symbol}: ${priceInSOL.toFixed(9)} SOL ($${priceInUSD.toFixed(6)} USD)`);
        }
      } catch (error: any) {
        logger.error(`Failed to fetch Solana price for ${tokenConfig.symbol}`, {
          error: error.message || error
        });
      }
    }

    this.updateTimestamp();
  }

  private async updateSOLUSDPrice(): Promise<void> {
    // Check if cached price is still valid
    const now = Date.now();
    if (this.solUSDPrice > 0 && (now - this.solUSDPriceLastUpdate) < this.solUSDPriceCacheDuration) {
      logger.debug(`Using cached SOL/USD price: $${this.solUSDPrice.toFixed(2)} (age: ${((now - this.solUSDPriceLastUpdate) / 1000).toFixed(0)}s)`);
      return;
    }

    try {
      // Fetch SOL/USD price from CoinGecko
      const response = await axios.get(`${this.coinGeckoApiUrl}/simple/price`, {
        params: {
          ids: 'solana',
          vs_currencies: 'usd'
        },
        timeout: 10000
      });

      if (response.data?.solana?.usd) {
        this.solUSDPrice = response.data.solana.usd;
        this.solUSDPriceLastUpdate = now;
        logger.info(`SOL/USD price: $${this.solUSDPrice.toFixed(2)}`);
        
        // Store SOL as a "Solana price" with price of 1 SOL = 1 SOL
        this.setPrice('GSOL', {
          token: 'GSOL',
          price: 1, // 1 SOL = 1 SOL
          priceUSD: this.solUSDPrice,
          liquidity: 0,
          timestamp: Date.now(),
          source: 'solana'
        });
      }
    } catch (error: any) {
      logger.error('Failed to fetch SOL/USD price from CoinGecko', {
        error: error.message || error
      });
      // Use fallback price if we don't have a cached one
      if (this.solUSDPrice === 0) {
        this.solUSDPrice = 225; // Approximate fallback
        logger.warn(`Using fallback SOL/USD price: $${this.solUSDPrice}`);
      } else {
        logger.warn(`Continuing with last cached SOL/USD price: $${this.solUSDPrice.toFixed(2)}`);
      }
    }
  }

  /**
   * Get the current SOL/USD price
   */
  getSOLUSDPrice(): number {
    return this.solUSDPrice;
  }
}

