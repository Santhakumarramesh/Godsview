import { StrategyDSL } from './strategy_dsl';

/**
 * Edge analysis result
 */
interface EdgeAnalysis {
  expectedWinRate: number;
  profitFactor: number;
  expectancy: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

/**
 * Risk/reward analysis result
 */
interface RiskRewardAnalysis {
  riskRewardRatio: number;
  maxDrawdownEstimate: number;
  kellyPercentage: number;
  recommendedRiskPerTrade: number;
  notes: string[];
}

/**
 * Overfit risk analysis
 */
interface OverfitAnalysis {
  overallRisk: 'high' | 'medium' | 'low';
  parameterCount: number;
  dataPointsRequired: number;
  walkForwardRequired: boolean;
  complexityPenalty: number;
  notes: string[];
}

/**
 * Regime dependency analysis
 */
interface RegimeDependencyAnalysis {
  trendingMarketScore: number;
  rangingMarketScore: number;
  volatileMarketScore: number;
  regimeSensitivity: 'high' | 'medium' | 'low';
  transitionRisk: number;
  notes: string[];
}

/**
 * Complexity analysis
 */
interface ComplexityAnalysis {
  ruleCount: number;
  indicatorCount: number;
  complexityScore: number;
  simplificationSuggestions: string[];
  notes: string[];
}

/**
 * Crowding analysis
 */
interface CrowdingAnalysis {
  crowdingScore: number;
  crowdingLevel: 'unique' | 'moderate' | 'crowded' | 'very_crowded';
  commonPatterns: string[];
  notes: string[];
}

/**
 * Execution risk analysis
 */
interface ExecutionRiskAnalysis {
  slippageEstimate: number;
  liquidityScore: number;
  timingDependency: 'high' | 'medium' | 'low';
  executionDifficulty: 'easy' | 'moderate' | 'hard';
  notes: string[];
}

/**
 * Full critique result
 */
export interface CritiqueResult {
  strategyName: string;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  overallScore: number;
  edge: EdgeAnalysis;
  riskReward: RiskRewardAnalysis;
  overfit: OverfitAnalysis;
  regimeDependency: RegimeDependencyAnalysis;
  complexity: ComplexityAnalysis;
  crowding: CrowdingAnalysis;
  executionRisk: ExecutionRiskAnalysis;
  recommendations: string[];
  redFlags: string[];
  strengths: string[];
  timestamp: string;
}

/**
 * Strategy Critique Engine
 * Comprehensive multi-module analysis of trading strategies
 */
export class StrategyCritique {
  /**
   * Analyze statistical edge: win rate, profit factor, expectancy
   */
  public analyzeEdge(strategy: StrategyDSL): EdgeAnalysis {
    const notes: string[] = [];
    let expectedWinRate = 0.5;
    let profitFactor = 1.0;
    let expectancy = 0;

    const hasMultipleConfirmations =
      strategy.entry.conditions.length >= 2;
    if (hasMultipleConfirmations) {
      expectedWinRate += 0.1;
      notes.push('Multiple entry confirmations suggest higher win rate');
    }

    const hasDefinedExits =
      (strategy.exit.takeProfit?.targets?.length || 0) > 0 ||
      strategy.exit.stopLoss !== undefined;
    if (hasDefinedExits) {
      profitFactor += 0.5;
      notes.push('Defined exits improve profit factor expectation');
    }

    const hasMomentumIndicators = strategy.entry.conditions.some(
      (c: any) =>
        c.name?.includes('rsi') ||
        c.name?.includes('macd') ||
        c.name?.includes('stochastic')
    );
    if (hasMomentumIndicators) {
      expectedWinRate += 0.05;
      notes.push('Momentum indicators typically improve entry timing');
    }

    const hasVolatilityFilter = strategy.marketContext.volatilityFilter?.minATR !== undefined;
    if (hasVolatilityFilter) {
      expectedWinRate -= 0.05;
      notes.push('Volatility filters may reduce trade frequency');
    }

    if (
      strategy.exit.stopLoss &&
      strategy.exit.takeProfit?.targets?.length > 0
    ) {
      const sl = strategy.exit.stopLoss.value || 2;
      const tp = strategy.exit.takeProfit.targets[0]?.ratio || 3;
      profitFactor = 1 + (tp - sl) / sl;
    }

    expectedWinRate = Math.min(Math.max(expectedWinRate, 0.3), 0.75);
    expectancy =
      expectedWinRate * profitFactor - (1 - expectedWinRate);

    const confidence =
      expectedWinRate > 0.6 ? 'high' : expectedWinRate > 0.5
        ? 'medium'
        : 'low';

    return {
      expectedWinRate,
      profitFactor,
      expectancy,
      confidence,
      notes,
    };
  }

  /**
   * Analyze risk/reward: ratio, max drawdown, Kelly criterion
   */
  public analyzeRiskReward(
    strategy: StrategyDSL
  ): RiskRewardAnalysis {
    const notes: string[] = [];

    let riskRewardRatio = 1.5;
    if (
      strategy.exit.stopLoss &&
      strategy.exit.takeProfit.targets.length > 0
    ) {
      const risk = strategy.exit.stopLoss.value || 2;
      const reward = strategy.exit.takeProfit.targets[0].ratio || 3;
      riskRewardRatio = reward / risk;
      notes.push(
        `Explicit risk/reward ratio: ${riskRewardRatio.toFixed(2)}:1`
      );
    }

    const maxDrawdownEstimate = Math.min(
      0.15 + 0.05 * (strategy.entry.conditions.length || 1),
      0.4
    );
    notes.push(`Estimated max drawdown: ${(maxDrawdownEstimate * 100).toFixed(1)}%`);

    const expectedWinRate = this.analyzeEdge(strategy)
      .expectedWinRate;
    const kellyPercentage = this.calculateKelly(
      expectedWinRate,
      riskRewardRatio
    );
    const recommendedRiskPerTrade = Math.min(
      kellyPercentage / 2,
      0.02
    );

    if (kellyPercentage > 0.1) {
      notes.push('High Kelly percentage - reduce position sizing');
    }

    return {
      riskRewardRatio,
      maxDrawdownEstimate,
      kellyPercentage,
      recommendedRiskPerTrade,
      notes,
    };
  }

  /**
   * Analyze overfit risk based on parameter count and data requirements
   */
  public analyzeOverfitRisk(strategy: StrategyDSL): OverfitAnalysis {
    const notes: string[] = [];

    let parameterCount = 0;

    if (strategy.exit.stopLoss) {
      parameterCount += 1;
    }

    parameterCount += strategy.exit.takeProfit.targets.length;
    parameterCount += strategy.entry.conditions.length * 2;

    const indicatorCount = strategy.entry.conditions.filter(
      (c: any) =>
        c.name?.includes('rsi') ||
        c.name?.includes('macd') ||
        c.name?.includes('sma') ||
        c.name?.includes('ema')
    ).length;
    parameterCount += indicatorCount * 2;

    const dataPointsRequired = Math.max(100, parameterCount * 30);
    const actualDataPoints = 100;

    let overallRisk: 'high' | 'medium' | 'low' = 'low';
    let complexityPenalty = 0;

    if (parameterCount > actualDataPoints / 20) {
      overallRisk = 'high';
      complexityPenalty = 0.3;
      notes.push(
        `High overfit risk: ${parameterCount} parameters with only ${actualDataPoints} data points`
      );
    } else if (parameterCount > actualDataPoints / 30) {
      overallRisk = 'medium';
      complexityPenalty = 0.15;
      notes.push(
        `Moderate overfit risk: increase walk-forward testing`
      );
    } else {
      notes.push('Overfit risk acceptable for parameter count');
    }

    const walkForwardRequired =
      overallRisk === 'high' || parameterCount > 20;
    if (walkForwardRequired) {
      notes.push(
        'Walk-forward optimization strongly recommended'
      );
    }

    return {
      overallRisk,
      parameterCount,
      dataPointsRequired,
      walkForwardRequired,
      complexityPenalty,
      notes,
    };
  }

  /**
   * Analyze regime dependency: trending vs ranging vs volatile
   */
  public analyzeRegimeDependency(
    strategy: StrategyDSL
  ): RegimeDependencyAnalysis {
    const notes: string[] = [];

    const hasTrendIndicators = strategy.entry.conditions.some(
      (c: any) => c.name?.includes('sma') || c.name?.includes('ema')
    );
    const trendingMarketScore = hasTrendIndicators ? 0.8 : 0.5;

    const hasRangeIndicators = strategy.entry.conditions.some(
      (c: any) => c.name?.includes('rsi') || c.name?.includes('bollinger')
    );
    const rangingMarketScore = hasRangeIndicators ? 0.7 : 0.4;

    const hasVolatilityFilter = strategy.marketContext.volatilityFilter?.minATR !== undefined;
    const volatileMarketScore = hasVolatilityFilter ? 0.6 : 0.3;

    const maxScore = Math.max(
      trendingMarketScore,
      rangingMarketScore,
      volatileMarketScore
    );
    const minScore = Math.min(
      trendingMarketScore,
      rangingMarketScore,
      volatileMarketScore
    );
    const regimeSensitivity = maxScore - minScore > 0.3 ? 'high' : 'medium';

    if (regimeSensitivity === 'high') {
      notes.push('Strategy shows high regime sensitivity');
    }

    const transitionRisk = Math.abs(
      trendingMarketScore - rangingMarketScore
    );

    if (
      trendingMarketScore > 0.7 &&
      rangingMarketScore < 0.5
    ) {
      notes.push('Strategy optimized for trending markets');
    } else if (
      rangingMarketScore > 0.7 &&
      trendingMarketScore < 0.5
    ) {
      notes.push('Strategy optimized for ranging markets');
    }

    return {
      trendingMarketScore,
      rangingMarketScore,
      volatileMarketScore,
      regimeSensitivity,
      transitionRisk,
      notes,
    };
  }

  /**
   * Analyze complexity: rule count, indicator count, simplification
   */
  public analyzeComplexity(strategy: StrategyDSL): ComplexityAnalysis {
    const notes: string[] = [];
    const simplificationSuggestions: string[] = [];

    const ruleCount =
      strategy.entry.conditions.length +
      (strategy.entry.conditions.length > 0 ? 1 : 0);

    const indicatorCount = strategy.entry.conditions.filter(
      (c: any) =>
        /rsi|macd|sma|ema|atr|bollinger|stochastic|cci|adx/i.test(
          c.name || ''
        )
    ).length;

    const filterCount = strategy.entry.conditions.length;
    const complexityScore = Math.min(
      (ruleCount + indicatorCount * 1.5 + (filterCount || 0)) / 10,
      10
    );

    if (ruleCount > 5) {
      simplificationSuggestions.push(
        'Consider combining entry rules using AND/OR logic'
      );
    }

    if (indicatorCount > 3) {
      simplificationSuggestions.push(
        'Reduce to 2-3 core indicators to avoid redundancy'
      );
    }

    if (filterCount > 3) {
      simplificationSuggestions.push(
        'Consolidate filters to reduce complexity'
      );
    }

    if (complexityScore > 7) {
      notes.push('Strategy is complex - may be difficult to manage');
    } else if (complexityScore < 2) {
      notes.push('Strategy is simple - good for robustness');
    }

    return {
      ruleCount,
      indicatorCount,
      complexityScore,
      simplificationSuggestions,
      notes,
    };
  }

  /**
   * Analyze crowding: how common is this strategy?
   */
  public analyzeCrowding(strategy: StrategyDSL): CrowdingAnalysis {
    const notes: string[] = [];
    const commonPatterns: string[] = [];

    let crowdingScore = 0;

    const hasMACDRSI = strategy.entry.conditions.some(
      (c: any) => c.name?.includes('macd') && c.name?.includes('rsi')
    );
    if (hasMACDRSI) {
      crowdingScore += 2;
      commonPatterns.push('MACD + RSI (very common retail pattern)');
    }

    const hasMovingAverageCrossover =
      strategy.entry.conditions.some((c: any) =>
        /sma|ema/.test(c.name || '')
      ) &&
      strategy.entry.conditions.filter((c: any) =>
        /sma|ema/.test(c.name || '')
      ).length >= 2;
    if (hasMovingAverageCrossover) {
      crowdingScore += 1.5;
      commonPatterns.push('Moving average crossover (common)');
    }

    const hasBollingerRSI = strategy.entry.conditions.some(
      (c: any) => c.name?.includes('bollinger') && c.name?.includes('rsi')
    );
    if (hasBollingerRSI) {
      crowdingScore += 1.5;
      commonPatterns.push('Bollinger Bands + RSI (crowded)');
    }

    const hasSupportResistance = strategy.entry.conditions.some(
      (c: any) => c.name?.includes('support') || c.name?.includes('resistance')
    );
    if (hasSupportResistance && !hasMovingAverageCrossover) {
      crowdingScore += 0.5;
      commonPatterns.push('Support/resistance levels');
    }

    let crowdingLevel: 'unique' | 'moderate' | 'crowded' | 'very_crowded';
    if (crowdingScore > 4) {
      crowdingLevel = 'very_crowded';
      notes.push(
        'Strategy uses very common patterns - expect heavy competition'
      );
    } else if (crowdingScore > 2.5) {
      crowdingLevel = 'crowded';
      notes.push(
        'Strategy likely used by many traders - edge may be limited'
      );
    } else if (crowdingScore > 1) {
      crowdingLevel = 'moderate';
      notes.push('Moderate crowding - edge still possible');
    } else {
      crowdingLevel = 'unique';
      notes.push(
        'Relatively unique approach - lower crowding risk'
      );
    }

    return {
      crowdingScore,
      crowdingLevel,
      commonPatterns,
      notes,
    };
  }

  /**
   * Analyze execution risk: slippage, liquidity, timing
   */
  public analyzeExecutionRisk(
    strategy: StrategyDSL
  ): ExecutionRiskAnalysis {
    const notes: string[] = [];

    const slippageEstimate = 0.005 + (strategy.entry.conditions.length || 0) * 0.001;
    notes.push(
      `Estimated slippage: ${(slippageEstimate * 100).toFixed(2)}%`
    );

    const hasVolatilityFilter = strategy.marketContext.volatilityFilter?.minATR !== undefined;
    const liquidityScore = hasVolatilityFilter ? 0.8 : 0.6;

    const hasTimeFilter = strategy.marketContext.sessionFilter?.allowedSessions !== undefined;
    const timingDependency = hasTimeFilter ? 'high' : 'medium';

    const entryCount = strategy.entry.conditions.length;
    const executionDifficulty = entryCount > 3 ? 'hard' : entryCount > 1 ? 'moderate' : 'easy';

    if (timingDependency === 'high') {
      notes.push(
        'Strategy has time-of-day dependencies - execution risk increases'
      );
    }

    if (
      strategy.entry.type === 'limit' &&
      timingDependency === 'high'
    ) {
      notes.push(
        'Limit orders with timing filters may miss entries'
      );
    }

    if (slippageEstimate > 0.01) {
      notes.push('High estimated slippage - profitability at risk');
    }

    return {
      slippageEstimate,
      liquidityScore,
      timingDependency,
      executionDifficulty,
      notes,
    };
  }

  /**
   * Full critique: all 7 analyses plus grade and recommendations
   */
  public fullCritique(strategy: StrategyDSL): CritiqueResult {
    const edge = this.analyzeEdge(strategy);
    const riskReward = this.analyzeRiskReward(strategy);
    const overfit = this.analyzeOverfitRisk(strategy);
    const regimeDependency =
      this.analyzeRegimeDependency(strategy);
    const complexity = this.analyzeComplexity(strategy);
    const crowding = this.analyzeCrowding(strategy);
    const executionRisk = this.analyzeExecutionRisk(strategy);

    const redFlags: string[] = [];
    const strengths: string[] = [];
    const recommendations: string[] = [];

    if (overfit.overallRisk === 'high') {
      redFlags.push(
        'High overfit risk - more data and walk-forward testing needed'
      );
    }

    if (crowding.crowdingLevel === 'very_crowded') {
      redFlags.push('Strategy uses very common patterns');
    }

    if (executionRisk.executionDifficulty === 'hard') {
      redFlags.push('Complex execution requirements may reduce edge');
    }

    if (edge.expectancy > 0.1) {
      strengths.push('Positive expected value');
    }

    if (riskReward.riskRewardRatio > 2) {
      strengths.push('Favorable risk/reward ratio');
    }

    if (complexity.complexityScore < 3) {
      strengths.push('Simple, robust design');
    }

    if (riskReward.riskRewardRatio < 1.5) {
      recommendations.push(
        'Improve risk/reward ratio through wider stops or wider targets'
      );
    }

    if (edge.expectedWinRate < 0.55) {
      recommendations.push(
        'Consider adding confirmation indicators to improve win rate'
      );
    }

    if (overfit.overallRisk !== 'low') {
      recommendations.push('Implement walk-forward optimization');
    }

    if (complexity.simplificationSuggestions.length > 0) {
      recommendations.push(
        ...complexity.simplificationSuggestions.slice(0, 2)
      );
    }

    const overallScore = this.calculateOverallScore(
      edge,
      riskReward,
      overfit,
      complexity,
      crowding,
      executionRisk
    );

    const overallGrade = this.scoreToGrade(overallScore);

    return {
      strategyName: strategy.name,
      overallGrade,
      overallScore,
      edge,
      riskReward,
      overfit,
      regimeDependency,
      complexity,
      crowding,
      executionRisk,
      recommendations,
      redFlags,
      strengths,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate Kelly criterion percentage
   */
  private calculateKelly(winRate: number, riskReward: number): number {
    if (winRate <= 0 || winRate >= 1) return 0;
    return (winRate * riskReward - (1 - winRate)) / riskReward;
  }

  /**
   * Calculate overall critique score (0-10)
   */
  private calculateOverallScore(
    edge: EdgeAnalysis,
    riskReward: RiskRewardAnalysis,
    overfit: OverfitAnalysis,
    complexity: ComplexityAnalysis,
    crowding: CrowdingAnalysis,
    executionRisk: ExecutionRiskAnalysis
  ): number {
    let score = 5;

    if (edge.expectancy > 0.15) score += 1.5;
    else if (edge.expectancy > 0.1) score += 1;
    else if (edge.expectancy > 0) score += 0.5;

    if (riskReward.riskRewardRatio > 2) score += 1.5;
    else if (riskReward.riskRewardRatio > 1.5) score += 1;

    if (overfit.overallRisk === 'low') score += 1.5;
    else if (overfit.overallRisk === 'medium') score += 0.5;
    else score -= 1;

    if (complexity.complexityScore < 3) score += 1;
    else if (complexity.complexityScore > 7) score -= 0.5;

    if (crowding.crowdingLevel === 'unique') score += 1;
    else if (crowding.crowdingLevel === 'very_crowded') score -= 1;

    if (executionRisk.executionDifficulty === 'easy') score += 0.5;
    else if (executionRisk.executionDifficulty === 'hard') score -= 0.5;

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Convert numeric score to letter grade
   */
  private scoreToGrade(
    score: number
  ): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 8) return 'A';
    if (score >= 6.5) return 'B';
    if (score >= 5) return 'C';
    if (score >= 3) return 'D';
    return 'F';
  }
}

export default StrategyCritique;
