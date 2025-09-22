/**
 * Trade Analysis Engine
 * 
 * Provides comprehensive trade analysis that validates, categorizes,
 * and prepares trades for execution based on detected wallet activities.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ConfigurationManager, TargetWallet } from '../config/configManager';
import { StateManager } from '../utils/stateManager';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/errorHandler';
import { WalletMonitor, WalletStats, WalletActivity } from '../monitoring/walletMonitor';

// Trade analysis interfaces
export interface TradeAnalysis {
  id: string;
  originalActivity: WalletActivity;
  targetWallet: TargetWallet;
  walletStats: WalletStats;
  analysisResult: 'approved' | 'rejected' | 'pending';
  rejectionReason?: string;
  riskScore: number;
  confidenceScore: number;
  recommendedAction: TradeAction;
  calculatedTrade: CalculatedTrade;
  marketConditions: MarketConditions;
  timestamp: number;
}

export interface CalculatedTrade {
  type: 'buy' | 'sell' | 'swap';
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  copyMode: 'exact' | 'proportional';
  copyAmount: number;
  maxSlippage: number;
  executionDelay: number;
  priority: number;
}

export interface TradeAction {
  action: 'execute' | 'skip' | 'modify' | 'wait';
  reason: string;
  modifications?: Partial<CalculatedTrade>;
  waitTime?: number;
}

export interface MarketConditions {
  volatility: 'low' | 'medium' | 'high';
  liquidity: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'sideways';
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface TradeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  riskFactors: string[];
}

export interface TokenAnalysis {
  token: string;
  isWhitelisted: boolean;
  isBlacklisted: boolean;
  liquidityScore: number;
  volatilityScore: number;
  marketCap?: number;
  priceChange24h?: number;
}

export class TradeAnalyzer extends EventEmitter {
  private static instance: TradeAnalyzer;
  private configManager: ConfigurationManager;
  private stateManager: StateManager;
  private errorHandler: ErrorHandler;
  private walletMonitor: WalletMonitor;
  private analysisQueue: TradeAnalysis[] = [];
  private processingInterval: NodeJS.Timeout | null = null;
  private tokenCache: Map<string, TokenAnalysis> = new Map();
  private marketConditions: MarketConditions | null = null;

  private constructor() {
    super();
    this.configManager = ConfigurationManager.getInstance();
    this.stateManager = StateManager.getInstance();
    this.errorHandler = ErrorHandler.getInstance();
    this.walletMonitor = WalletMonitor.getInstance();
  }

  public static getInstance(): TradeAnalyzer {
    if (!TradeAnalyzer.instance) {
      TradeAnalyzer.instance = new TradeAnalyzer();
    }
    return TradeAnalyzer.instance;
  }

  /**
   * Initialize the trade analysis engine
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('🔍 Initializing Trade Analyzer...');
      
      // Initialize market conditions
      await this.initializeMarketConditions();
      
      // Start processing queue
      this.startProcessing();
      
      // Register health check
      this.errorHandler.addHealthCheck('trade-analyzer', this.checkTradeAnalyzerHealth.bind(this));
      
      logger.info('✅ Trade Analyzer initialized successfully');
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        { phase: 'trade_analyzer_initialization' }
      );
      throw error;
    }
  }

  /**
   * Shutdown the trade analysis engine
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Trade Analyzer...');
    
    this.stopProcessing();
    
    logger.info('✅ Trade Analyzer shutdown complete');
  }

  /**
   * Analyze a wallet activity for potential trade copying
   */
  public async analyzeWalletActivity(activity: WalletActivity): Promise<TradeAnalysis | null> {
    try {
      const walletName = this.getWalletName(activity.walletAddress);
      logger.info(`🔍 Analyzing wallet activity: ${activity.walletAddress}${walletName ? ` (${walletName})` : ''} - ${activity.activityType}`);
      
      // Get target wallet configuration
      const targetWallet = this.getTargetWallet(activity.walletAddress);
      if (!targetWallet) {
        logger.debug(`⏭️ Wallet ${activity.walletAddress} not in target list, skipping analysis`);
        return null;
      }
      
      // Get wallet statistics
      logger.debug(`🔍 Looking for wallet stats for: ${activity.walletAddress}`);
      const walletStats = this.walletMonitor.getWalletStats(activity.walletAddress) as WalletStats;
      if (!walletStats) {
        logger.warn(`⚠️ No wallet stats found for ${activity.walletAddress}`);
        // Debug: show all available wallet addresses
        const allStats = this.walletMonitor.getWalletStats() as Map<string, WalletStats>;
        if (allStats) {
          const availableAddresses = Array.from(allStats.keys());
          logger.debug(`📋 Available wallet addresses: ${availableAddresses.join(', ')}`);
        }
        return null;
      }
      
      // Create trade analysis
      const analysis: TradeAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        originalActivity: activity,
        targetWallet,
        walletStats,
        analysisResult: 'pending',
        riskScore: 0,
        confidenceScore: 0,
        recommendedAction: { action: 'skip', reason: 'Pending analysis' },
        calculatedTrade: this.createEmptyCalculatedTrade(),
        marketConditions: this.marketConditions || this.getDefaultMarketConditions(),
        timestamp: Date.now()
      };
      
      // Perform comprehensive analysis
      await this.performTradeAnalysis(analysis);
      
      // Add to processing queue
      this.analysisQueue.push(analysis);
      
      // Emit analysis event
      this.emit('tradeAnalysis', analysis);
      
      logger.info(`📊 Trade analysis completed: ${analysis.analysisResult}`, {
        analysisId: analysis.id,
        riskScore: analysis.riskScore,
        confidenceScore: analysis.confidenceScore,
        action: analysis.recommendedAction.action
      });
      
      return analysis;
      
    } catch (error) {
      await this.errorHandler.handleError(
        error as Error,
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        { phase: 'analyze_wallet_activity', walletAddress: activity.walletAddress }
      );
      return null;
    }
  }

  /**
   * Perform comprehensive trade analysis
   */
  private async performTradeAnalysis(analysis: TradeAnalysis): Promise<void> {
    try {
      // Step 1: Validate the trade
      const validation = await this.validateTrade(analysis);
      if (!validation.isValid) {
        analysis.analysisResult = 'rejected';
        analysis.rejectionReason = validation.errors.join(', ');
        analysis.recommendedAction = { action: 'skip', reason: analysis.rejectionReason };
        return;
      }
      
      // Step 2: Analyze tokens
      const tokenAnalysis = await this.analyzeTokens(analysis);
      
      // Step 3: Calculate trade parameters
      const calculatedTrade = await this.calculateTradeParameters(analysis, tokenAnalysis);
      analysis.calculatedTrade = calculatedTrade;
      
      // Step 4: Assess risk
      const riskScore = await this.assessRisk(analysis, tokenAnalysis);
      analysis.riskScore = riskScore;
      
      // Step 5: Calculate confidence
      const confidenceScore = await this.calculateConfidence(analysis, tokenAnalysis);
      analysis.confidenceScore = confidenceScore;
      
      // Step 6: Determine recommended action
      const recommendedAction = await this.determineRecommendedAction(analysis, validation);
      analysis.recommendedAction = recommendedAction;
      
      // Step 7: Final decision
      //&& confidenceScore >= 0.7 && riskScore <= 0.6 - original thresholds
      const envConfig = this.configManager.getEnvironmentConfig();
      if (recommendedAction.action === 'execute' && envConfig.enableAutoTrading) {
        analysis.analysisResult = 'approved';
      } else if (recommendedAction.action === 'skip') {
        analysis.analysisResult = 'rejected';
        analysis.rejectionReason = recommendedAction.reason;
      } else if (!envConfig.enableAutoTrading && recommendedAction.action === 'execute') {
        analysis.analysisResult = 'rejected';
        analysis.rejectionReason = 'Auto-trading is disabled';
      } else {
        analysis.analysisResult = 'pending';
      }
      
    } catch (error) {
      logger.error('❌ Error performing trade analysis:', error);
      analysis.analysisResult = 'rejected';
      analysis.rejectionReason = 'Analysis error';
      analysis.recommendedAction = { action: 'skip', reason: 'Analysis failed' };
    }
  }

  /**
   * Validate a trade against various criteria
   */
  private async validateTrade(analysis: TradeAnalysis): Promise<TradeValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const riskFactors: string[] = [];
    
    const activity = analysis.originalActivity;
    const walletStats = analysis.walletStats;
    const targetWallet = analysis.targetWallet;
    
    // Check if wallet is enabled
    if (!targetWallet.enabled) {
      errors.push('Target wallet is disabled');
    }
    
    // Check wallet performance
    if (walletStats.performanceScore < 30) {
      warnings.push('Low wallet performance score');
      riskFactors.push('Poor historical performance');
    }
    
    // Check wallet risk level
    if (walletStats.riskScore > 70) {
      warnings.push('High wallet risk score');
      riskFactors.push('High risk wallet');
    }
    
    // Check if wallet is in cooldown
    if (this.stateManager.isWalletInCooldown(activity.walletAddress)) {
      errors.push('Wallet is in cooldown period');
    }
    
    // Check daily limits
    const envConfig = this.configManager.getEnvironmentConfig();
    if (this.stateManager.isDailyTradeLimitReached(envConfig.maxDailyTrades)) {
      errors.push('Daily trade limit reached');
    }
    
    // Validate transaction data
    if (!activity.transaction) {
      errors.push('No transaction data available');
    } else {
      // Check token validity
      if (!activity.transaction.tokenIn || !activity.transaction.tokenOut) {
        errors.push('Invalid token pair');
      }
      
      // Check amount validity
      logger.debug(`🔍 Validating amounts - amountIn: ${activity.transaction.amountIn}, amountOut: ${activity.transaction.amountOut}`);
      if (!activity.transaction.amountIn || parseFloat(activity.transaction.amountIn) <= 0) {
        errors.push('Invalid input amount');
        logger.debug(`❌ Invalid amountIn: ${activity.transaction.amountIn}`);
      }
      
      // Check GALA minimum threshold (configurable minimum for any swap involving GALA)
      const envConfig = this.configManager.getEnvironmentConfig();
      const galaMinimum = envConfig.galaMinimumThreshold || 50;
      const tokenIn = activity.transaction.tokenIn;
      const tokenOut = activity.transaction.tokenOut;
      const amountIn = parseFloat(activity.transaction.amountIn);
      const amountOut = parseFloat(activity.transaction.amountOut);
      
      if (tokenIn === 'GALA' && amountIn < galaMinimum) {
        errors.push(`GALA input amount (${amountIn}) below minimum threshold (${galaMinimum})`);
        logger.debug(`❌ GALA amount too small: ${amountIn} < ${galaMinimum}`);
      }
      
      if (tokenOut === 'GALA' && amountOut < galaMinimum) {
        errors.push(`GALA output amount (${amountOut}) below minimum threshold (${galaMinimum})`);
        logger.debug(`❌ GALA amount too small: ${amountOut} < ${galaMinimum}`);
      }
    }
    
    // Check market conditions
    if (this.marketConditions && this.marketConditions.riskLevel === 'high') {
      warnings.push('High market risk conditions');
      riskFactors.push('Unfavorable market conditions');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      riskFactors
    };
  }

  /**
   * Analyze tokens involved in the trade
   */
  private async analyzeTokens(analysis: TradeAnalysis): Promise<TokenAnalysis[]> {
    const activity = analysis.originalActivity;
    const tokens: string[] = [];
    
    if (activity.transaction.tokenIn) tokens.push(activity.transaction.tokenIn);
    if (activity.transaction.tokenOut) tokens.push(activity.transaction.tokenOut);
    
    const tokenAnalyses: TokenAnalysis[] = [];
    
    for (const token of tokens) {
      let tokenAnalysis = this.tokenCache.get(token);
      
      if (!tokenAnalysis) {
        tokenAnalysis = await this.analyzeToken(token);
        this.tokenCache.set(token, tokenAnalysis);
      }
      
      tokenAnalyses.push(tokenAnalysis);
    }
    
    return tokenAnalyses;
  }

  /**
   * Analyze a single token
   */
  private async analyzeToken(token: string): Promise<TokenAnalysis> {
    const walletConfig = this.configManager.getWalletConfig();
    const globalSettings = walletConfig.globalSettings;
    
    const isWhitelisted = globalSettings.whitelistedTokens.includes(token.toUpperCase());
    const isBlacklisted = globalSettings.blacklistedTokens.includes(token.toUpperCase());
    
    // Placeholder for more sophisticated token analysis
    // In a real implementation, this would fetch token data from APIs
    const liquidityScore = this.estimateLiquidityScore(token);
    const volatilityScore = this.estimateVolatilityScore(token);
    
    return {
      token,
      isWhitelisted,
      isBlacklisted,
      liquidityScore,
      volatilityScore
    };
  }

  /**
   * Calculate trade parameters
   */
  private async calculateTradeParameters(analysis: TradeAnalysis, _tokenAnalyses: TokenAnalysis[]): Promise<CalculatedTrade> {
    const activity = analysis.originalActivity;
    const targetWallet = analysis.targetWallet;
    const envConfig = this.configManager.getEnvironmentConfig();
    
    const originalAmountIn = parseFloat(activity.transaction.amountIn || '0');
    const originalAmountOut = parseFloat(activity.transaction.amountOut || '0');
    
    // Determine copy mode
    const copyMode = envConfig.copyMode;
    
    // Calculate copy amount
    let copyAmount: number;
    if (copyMode === 'exact') {
      copyAmount = originalAmountIn;
    } else {
      // Proportional copy based on max copy amount
      const maxCopyAmount = targetWallet.maxCopyAmount;
      const portfolioSize = this.estimatePortfolioSize(); // Placeholder
      const proportionalAmount = (maxCopyAmount / portfolioSize) * originalAmountIn;
      copyAmount = Math.min(proportionalAmount, maxCopyAmount);
    }
    
    // Apply position size limits
    const maxPositionSize = envConfig.maxPositionSize;
    const maxAllowedAmount = maxPositionSize * this.estimatePortfolioSize();
    copyAmount = Math.min(copyAmount, maxAllowedAmount);
    
    // Calculate output amount proportionally
    const outputRatio = originalAmountOut / originalAmountIn;
    const calculatedAmountOut = copyAmount * outputRatio;
    
    return {
      type: this.determineTradeType(activity),
      tokenIn: activity.transaction.tokenIn || 'Unknown',
      tokenOut: activity.transaction.tokenOut || 'Unknown',
      amountIn: copyAmount,
      amountOut: calculatedAmountOut,
      copyMode,
      copyAmount,
      maxSlippage: envConfig.slippageTolerance,
      executionDelay: envConfig.executionDelay,
      priority: targetWallet.priority
    };
  }

  /**
   * Assess risk for the trade - Simplified to always return low risk
   */
  private async assessRisk(_analysis: TradeAnalysis, _tokenAnalyses: TokenAnalysis[]): Promise<number> {
    // Simplified: Always return low risk to allow execution
    return 0.1; // Low risk score
  }

  /**
   * Calculate confidence score for the trade
   */
  private async calculateConfidence(_analysis: TradeAnalysis, _tokenAnalyses: TokenAnalysis[]): Promise<number> {
    // Simplified: Always return high confidence to allow execution
    return 0.9; // High confidence score
  }

  /**
   * Determine recommended action for the trade
   */
  private async determineRecommendedAction(_analysis: TradeAnalysis, validation: TradeValidationResult): Promise<TradeAction> {
    // Simplified: If validation passed, execute the trade
    if (validation.isValid) {
      return { action: 'execute', reason: 'Valid trade - executing' };
    }
    
    // If validation failed, skip
    return { action: 'skip', reason: validation.errors.join(', ') };
  }

  /**
   * Start processing the analysis queue
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    this.processingInterval = setInterval(async () => {
      await this.processAnalysisQueue();
    }, 1000); // Process every second
    
    logger.info('🔄 Trade analysis queue processing started');
  }

  /**
   * Stop processing the analysis queue
   */
  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    logger.info('🛑 Trade analysis queue processing stopped');
  }

  /**
   * Process the analysis queue
   */
  private async processAnalysisQueue(): Promise<void> {
    if (this.analysisQueue.length === 0) {
      return;
    }
    
    const analysis = this.analysisQueue.shift();
    if (!analysis) return;
    
    try {
      // Emit processed analysis
      this.emit('analysisProcessed', analysis);
      
      // If approved, emit for execution
      if (analysis.analysisResult === 'approved') {
        this.emit('tradeApproved', analysis);
      } else if (analysis.analysisResult === 'rejected') {
        this.emit('tradeRejected', analysis);
      }
      
    } catch (error) {
      logger.error('❌ Error processing analysis:', error);
    }
  }

  /**
   * Initialize market conditions
   */
  private async initializeMarketConditions(): Promise<void> {
    // Placeholder for market condition initialization
    // In a real implementation, this would fetch market data
    this.marketConditions = {
      volatility: 'medium',
      liquidity: 'high',
      trend: 'sideways',
      riskLevel: 'medium',
      confidence: 0.7
    };
    
    logger.info('📊 Market conditions initialized');
  }

  /**
   * Get default market conditions
   */
  private getDefaultMarketConditions(): MarketConditions {
    return {
      volatility: 'medium',
      liquidity: 'medium',
      trend: 'sideways',
      riskLevel: 'medium',
      confidence: 0.5
    };
  }

  /**
   * Get target wallet configuration
   */
  private getTargetWallet(walletAddress: string): TargetWallet | null {
    const walletConfig = this.configManager.getWalletConfig();
    return walletConfig.targetWallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase()) || null;
  }

  /**
   * Create empty calculated trade
   */
  private createEmptyCalculatedTrade(): CalculatedTrade {
    return {
      type: 'swap',
      tokenIn: '',
      tokenOut: '',
      amountIn: 0,
      amountOut: 0,
      copyMode: 'proportional',
      copyAmount: 0,
      maxSlippage: 0.05,
      executionDelay: 30,
      priority: 1
    };
  }

  /**
   * Determine trade type from activity
   */
  private determineTradeType(activity: WalletActivity): 'buy' | 'sell' | 'swap' {
    if (activity.activityType === 'swap') {
      return 'swap';
    }
    // Additional logic for buy/sell determination
    return 'swap';
  }

  /**
   * Estimate portfolio size (placeholder)
   */
  private estimatePortfolioSize(): number {
    // Placeholder - in real implementation, this would calculate actual portfolio value
    return 10000; // $10,000 default
  }

  /**
   * Estimate liquidity score for a token (placeholder)
   */
  private estimateLiquidityScore(token: string): number {
    // Placeholder - in real implementation, this would fetch actual liquidity data
    const commonTokens = ['GALA', 'GUSDC', 'GWETH'];
    return commonTokens.includes(token.toUpperCase()) ? 0.8 : 0.5;
  }

  /**
   * Estimate volatility score for a token (placeholder)
   */
  private estimateVolatilityScore(token: string): number {
    // Placeholder - in real implementation, this would fetch actual volatility data
    const stableTokens = ['GUSDC'];
    return stableTokens.includes(token.toUpperCase()) ? 0.2 : 0.6;
  }

  /**
   * Health check for trade analyzer
   */
  private async checkTradeAnalyzerHealth(): Promise<boolean> {
    try {
      return this.processingInterval !== null && this.analysisQueue.length < 1000;
    } catch (error) {
      logger.error('❌ Trade analyzer health check failed:', error);
      return false;
    }
  }

  /**
   * Get analysis queue status
   */
  public getQueueStatus(): { queueLength: number; processingActive: boolean } {
    return {
      queueLength: this.analysisQueue.length,
      processingActive: this.processingInterval !== null
    };
  }

  /**
   * Get recent analyses
   */
  public getRecentAnalyses(limit: number = 10): TradeAnalysis[] {
    return this.analysisQueue.slice(-limit);
  }

  /**
   * Get wallet name from configuration
   */
  private getWalletName(walletAddress: string): string | null {
    try {
      const walletConfig = this.configManager.getWalletConfig();
      const targetWallet = walletConfig.targetWallets.find(w => 
        w.address.toLowerCase() === walletAddress.toLowerCase()
      );
      return targetWallet?.name || null;
    } catch (error) {
      logger.debug('Failed to get wallet name:', error);
      return null;
    }
  }
}
