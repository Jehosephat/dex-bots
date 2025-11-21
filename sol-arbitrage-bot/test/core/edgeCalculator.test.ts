/**
 * Tests for UnifiedEdgeCalculator
 *
 * Verifies that the unified edge calculator correctly handles both forward
 * and reverse directions with consistent universal fields (income, expense,
 * sellSide, buySide).
 */

import BigNumber from 'bignumber.js';
import { UnifiedEdgeCalculator } from '../../src/core/unifiedEdgeCalculator';
import { GalaChainQuote, SolanaQuote } from '../../src/types/core';
import { TokenConfig } from '../../src/types/config';
import { IConfigService } from '../../src/config';

// Mock config service
const mockConfigService: IConfigService = {
  getTradingConfig: () => ({
    minEdgeBps: 30,
    reverseArbitrageMinEdgeBps: 35,
    maxPriceImpactBps: 250,
    maxSlippageBps: 50,
    riskBufferBps: 10
  }),
  getBridgingConfig: () => ({
    bridgeCostUsd: 1.25,
    tradesPerBridge: 100
  }),
  getTokenConfig: jest.fn(),
  getQuoteTokenConfig: jest.fn(),
  getDirectionConfig: jest.fn(),
  getStrategiesConfig: jest.fn(),
  getAllTokens: jest.fn(),
} as any;

// Mock token config
const mockToken: TokenConfig = {
  symbol: 'GUSDC',
  solanaSymbol: 'USDC',
  tradeSize: 1500,
  enabled: true,
  galaChainMint: 'GUSDC|Unit|none|none',
  solanaMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
  gcQuoteVia: 'GALA',
  solQuoteVia: 'SOL'
};

// Mock GalaChain quote (for selling token, receiving GALA)
const mockGcQuote: GalaChainQuote = {
  symbol: 'GUSDC',
  price: new BigNumber('0.001234'),  // 0.001234 GALA per GUSDC
  currency: 'GALA',
  tradeSize: 1500,
  priceImpactBps: 25,
  minOutput: new BigNumber('1.85'),
  galaFee: new BigNumber('0.001'),
  feeTier: 10000,
  provider: 'galachain',
  timestamp: Date.now(),
  expiresAt: Date.now() + 60000,
  isValid: true
};

// Mock Solana quote (for buying token, spending SOL)
const mockSolQuote: SolanaQuote = {
  symbol: 'GUSDC',
  price: new BigNumber('0.0001'),  // 0.0001 SOL per GUSDC
  currency: 'SOL',
  tradeSize: 1500,
  priceImpactBps: 15,
  minOutput: new BigNumber('1495'),
  priorityFee: new BigNumber('0.000005'),
  provider: 'jupiter',
  timestamp: Date.now(),
  expiresAt: Date.now() + 60000,
  isValid: true
};

// Mock SOL to GALA rate (1 SOL = 122 GALA)
const mockSolToGalaRate = new BigNumber('122');

// Mock GALA USD price
const mockGalaUsdPrice = 0.01;

describe('UnifiedEdgeCalculator Field Consistency', () => {
  let edgeCalculator: UnifiedEdgeCalculator;

  beforeEach(() => {
    edgeCalculator = new UnifiedEdgeCalculator(mockConfigService);
  });

  describe('Forward Direction (SELL on GalaChain, BUY on Solana)', () => {
    it('should populate universal fields correctly', () => {
      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        mockGcQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // Universal fields should be populated
      expect(result.income).toBeDefined();
      expect(result.expense).toBeDefined();
      expect(result.sellSide).toBeDefined();
      expect(result.buySide).toBeDefined();

      // Income should be positive GALA amount
      expect(result.income.isGreaterThan(0)).toBe(true);

      // Expense should be positive GALA amount
      expect(result.expense.isGreaterThan(0)).toBe(true);

      // Direction should be correct
      expect(result.sellSide).toBe('galachain');
      expect(result.buySide).toBe('solana');
    });

    it('should have income === galaChainProceeds (forward direction)', () => {
      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        mockGcQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // In forward mode, income should equal galaChainProceeds
      expect(result.income.toString()).toBe(result.galaChainProceeds.toString());
    });

    it('should have expense === solanaCostGala (forward direction)', () => {
      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        mockGcQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // In forward mode, expense should equal solanaCostGala
      expect(result.expense.toString()).toBe(result.solanaCostGala.toString());
    });

    it('should calculate netEdge as income - expense - costs', () => {
      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        mockGcQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      const expectedNetEdge = result.income
        .minus(result.expense)
        .minus(result.bridgeCost)
        .minus(result.riskBuffer);

      expect(result.netEdge.toString()).toBe(expectedNetEdge.toString());
    });

    it('should calculate income from GalaChain quote correctly', () => {
      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        mockGcQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // Income should be: GC price (GALA per token) * trade size
      const expectedIncome = mockGcQuote.price.multipliedBy(mockToken.tradeSize);
      expect(result.income.toString()).toBe(expectedIncome.toString());
    });

    it('should calculate expense from Solana quote correctly', () => {
      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        mockGcQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // Expense should be: SOL price * trade size * SOL-to-GALA rate
      const expectedExpense = mockSolQuote.price
        .multipliedBy(mockToken.tradeSize)
        .multipliedBy(mockSolToGalaRate);

      expect(result.expense.toString()).toBe(expectedExpense.toString());
    });
  });

  describe('Invalid Input Handling', () => {
    it('should handle zero income gracefully', () => {
      const zeroGcQuote = { ...mockGcQuote, price: new BigNumber(0) };

      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        zeroGcQuote as GalaChainQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      expect(result.isProfitable).toBe(false);
      expect(result.invalidationReasons.length).toBeGreaterThan(0);
      expect(result.income.toString()).toBe('0');
    });

    it('should populate universal fields even for invalid results', () => {
      const invalidQuote = { ...mockGcQuote, price: new BigNumber(NaN) };

      const result = edgeCalculator.calculateEdge(
        'forward',
        mockToken,
        invalidQuote as GalaChainQuote,
        mockSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // Even invalid results should have all fields
      expect(result.income).toBeDefined();
      expect(result.expense).toBeDefined();
      expect(result.sellSide).toBeDefined();
      expect(result.buySide).toBeDefined();
    });
  });
});

describe('UnifiedEdgeCalculator - Reverse Direction', () => {
  let edgeCalculator: UnifiedEdgeCalculator;

  beforeEach(() => {
    edgeCalculator = new UnifiedEdgeCalculator(mockConfigService);
  });

  describe('Reverse Direction (BUY on GalaChain, SELL on Solana)', () => {
    // For reverse: GC quote is for BUYING (cost), SOL quote is for SELLING (proceeds)
    const reverseGcQuote: GalaChainQuote = {
      ...mockGcQuote,
      price: new BigNumber('0.001250')  // Cost to BUY token with GALA
    };

    const reverseSolQuote: SolanaQuote = {
      ...mockSolQuote,
      price: new BigNumber('0.00012')  // Proceeds from SELLING token for SOL
    };

    it('should populate universal fields correctly', () => {
      const result = edgeCalculator.calculateEdge(
        'reverse',
        mockToken,
        reverseGcQuote,
        reverseSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // Universal fields should be populated
      expect(result.income).toBeDefined();
      expect(result.expense).toBeDefined();
      expect(result.sellSide).toBeDefined();
      expect(result.buySide).toBeDefined();

      // Direction should be correct
      expect(result.sellSide).toBe('solana');
      expect(result.buySide).toBe('galachain');
    });

    it('should have income from Solana proceeds (reverse direction)', () => {
      const result = edgeCalculator.calculateEdge(
        'reverse',
        mockToken,
        reverseGcQuote,
        reverseSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // In reverse mode, income is from Solana
      const expectedIncome = reverseSolQuote.price
        .multipliedBy(mockToken.tradeSize)
        .multipliedBy(mockSolToGalaRate);

      expect(result.income.toString()).toBe(expectedIncome.toString());
    });

    it('should have expense from GalaChain cost (reverse direction)', () => {
      const result = edgeCalculator.calculateEdge(
        'reverse',
        mockToken,
        reverseGcQuote,
        reverseSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // In reverse mode, expense is on GalaChain
      const expectedExpense = reverseGcQuote.price.multipliedBy(mockToken.tradeSize);

      expect(result.expense.toString()).toBe(expectedExpense.toString());
    });

    it('should have confusing deprecated field names (warning)', () => {
      const result = edgeCalculator.calculateEdge(
        'reverse',
        mockToken,
        reverseGcQuote,
        reverseSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      // ⚠️ This test documents the confusing semantics of deprecated fields
      // In reverse mode:
      // - galaChainProceeds actually holds Solana proceeds!
      // - solanaCostGala actually holds GalaChain cost!

      // These should be equal to income (which is Solana proceeds)
      expect(result.galaChainProceeds.toString()).toBe(result.income.toString());

      // These should be equal to expense (which is GalaChain cost)
      expect(result.solanaCostGala.toString()).toBe(result.expense.toString());

      // This test serves as documentation that the deprecated field names
      // are misleading in reverse mode!
    });

    it('should calculate netEdge as income - expense - costs (universal)', () => {
      const result = edgeCalculator.calculateEdge(
        'reverse',
        mockToken,
        reverseGcQuote,
        reverseSolQuote,
        mockSolToGalaRate,
        mockGalaUsdPrice
      );

      const expectedNetEdge = result.income
        .minus(result.expense)
        .minus(result.bridgeCost)
        .minus(result.riskBuffer);

      expect(result.netEdge.toString()).toBe(expectedNetEdge.toString());
    });
  });
});

describe('Cross-Direction Consistency', () => {
  let edgeCalculator: UnifiedEdgeCalculator;

  beforeEach(() => {
    edgeCalculator = new UnifiedEdgeCalculator(mockConfigService);
  });

  it('netEdge formula should be identical for both directions', () => {
    const forwardResult = edgeCalculator.calculateEdge(
      'forward',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    const reverseResult = edgeCalculator.calculateEdge(
      'reverse',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    // Both should use: income - expense - bridgeCost - riskBuffer
    const forwardCalculatedEdge = forwardResult.income
      .minus(forwardResult.expense)
      .minus(forwardResult.bridgeCost)
      .minus(forwardResult.riskBuffer);

    const reverseCalculatedEdge = reverseResult.income
      .minus(reverseResult.expense)
      .minus(reverseResult.bridgeCost)
      .minus(reverseResult.riskBuffer);

    expect(forwardResult.netEdge.toString()).toBe(forwardCalculatedEdge.toString());
    expect(reverseResult.netEdge.toString()).toBe(reverseCalculatedEdge.toString());
  });

  it('sellSide and buySide should be opposites', () => {
    const forwardResult = edgeCalculator.calculateEdge(
      'forward',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    const reverseResult = edgeCalculator.calculateEdge(
      'reverse',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    // Forward: sell on GC, buy on SOL
    expect(forwardResult.sellSide).toBe('galachain');
    expect(forwardResult.buySide).toBe('solana');

    // Reverse: sell on SOL, buy on GC
    expect(reverseResult.sellSide).toBe('solana');
    expect(reverseResult.buySide).toBe('galachain');

    // Verify they're opposites
    expect(forwardResult.sellSide).toBe(reverseResult.buySide);
    expect(forwardResult.buySide).toBe(reverseResult.sellSide);
  });

  it('income and expense should always be positive for valid results', () => {
    const forwardResult = edgeCalculator.calculateEdge(
      'forward',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    const reverseResult = edgeCalculator.calculateEdge(
      'reverse',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    // Both calculators should produce positive income and expense
    expect(forwardResult.income.isGreaterThan(0)).toBe(true);
    expect(forwardResult.expense.isGreaterThan(0)).toBe(true);
    expect(reverseResult.income.isGreaterThan(0)).toBe(true);
    expect(reverseResult.expense.isGreaterThan(0)).toBe(true);
  });
});

describe('Field Deprecation Warnings', () => {
  it('should document that galaChainProceeds is deprecated', () => {
    // This test serves as documentation
    // Developers should use 'income' instead of 'galaChainProceeds'
    // because 'income' has universal meaning across all directions

    const edgeCalculator = new UnifiedEdgeCalculator(mockConfigService);
    const result = edgeCalculator.calculateEdge(
      'forward',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    // Both fields exist but have different semantics
    expect(result.galaChainProceeds).toBeDefined();  // Deprecated
    expect(result.income).toBeDefined();             // Preferred

    // In this case they're equal, but semantics are clearer with 'income'
    expect(result.income.toString()).toBe(result.galaChainProceeds.toString());
  });

  it('should document that solanaCostGala is deprecated', () => {
    // This test serves as documentation
    // Developers should use 'expense' instead of 'solanaCostGala'
    // because 'expense' has universal meaning across all directions

    const edgeCalculator = new UnifiedEdgeCalculator(mockConfigService);
    const result = edgeCalculator.calculateEdge(
      'forward',
      mockToken,
      mockGcQuote,
      mockSolQuote,
      mockSolToGalaRate,
      mockGalaUsdPrice
    );

    // Both fields exist but have different semantics
    expect(result.solanaCostGala).toBeDefined();  // Deprecated
    expect(result.expense).toBeDefined();         // Preferred

    // In this case they're equal, but semantics are clearer with 'expense'
    expect(result.expense.toString()).toBe(result.solanaCostGala.toString());
  });
});
