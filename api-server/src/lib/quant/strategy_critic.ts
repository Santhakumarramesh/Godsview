import { Strategy, BacktestResult } from '../types';

export enum Grade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  F = 'F',
}

export interface SubGrades {
  edgeQuality: Grade;
  robustness: Grade;
  riskManagement: Grade;
  executionFeasibility: Grade;
  regimeDependency: Grade;
  capacity: Grade;
  complexity: Grade;
}

export interface StrategyGrade {
  overall: Grade;
  subGrades: SubGrades;
  scores: Record<string, number>;
  explanation: string;
}

export interface RedTeamAnalysis {
  critiques: string[];
  vulnerabilities: string[];
  failureScenarios: string[];
  estimatedFailureProbability: number;
  breakingPoints: string[];
}

export interface CounterStrategy {
  description: string;
  mechanism: string;
  effectiveness: number; // 0-1
  exploitedWeakness: string;
}

export class StrategyCritic {
  /**
   * Grade strategy across multiple dimensions
   */
  gradeStrategy(strategy: Strategy, backtestResults?: BacktestResult): StrategyGrade {
    const scores: Record<string, number> = {};

    // Score each dimension
    const edgeQualityScore = this.scoreEdgeQuality(strategy, backtestResults);
    const robustnessScore = this.scoreRobustness(strategy, backtestResults);
    const riskManagementScore = this.scoreRiskManagement(strategy);
    const executionFeasibilityScore = this.scoreExecutionFeasibility(strategy);
    const regimeDependencyScore = this.scoreRegimeDependency(strategy, backtestResults);
    const capacityScore = this.scoreCapacity(strategy);
    const complexityScore = this.scoreComplexity(strategy);

    scores.edgeQuality = edgeQualityScore;
    scores.robustness = robustnessScore;
    scores.riskManagement = riskManagementScore;
    scores.executionFeasibility = executionFeasibilityScore;
    scores.regimeDependency = regimeDependencyScore;
    scores.capacity = capacityScore;
    scores.complexity = complexityScore;

    const subGrades: SubGrades = {
      edgeQuality: this.scoreToGrade(edgeQualityScore),
      robustness: this.scoreToGrade(robustnessScore),
      riskManagement: this.scoreToGrade(riskManagementScore),
      executionFeasibility: this.scoreToGrade(executionFeasibilityScore),
      regimeDependency: this.scoreToGrade(regimeDependencyScore),
      capacity: this.scoreToGrade(capacityScore),
      complexity: this.scoreToGrade(complexityScore),
    };

    const overallScore = (edgeQualityScore * 0.25 + robustnessScore * 0.25 + riskManagementScore * 0.2 + executionFeasibilityScore * 0.15 + regimeDependencyScore * 0.1 + capacityScore * 0.05) * 100;

    return {
      overall: this.scoreToGrade(overallScore / 100),
      subGrades,
      scores,
      explanation: this.generateGradeExplanation(subGrades, scores),
    };
  }

  private scoreEdgeQuality(strategy: Strategy, backtestResults?: BacktestResult): number {
    if (!backtestResults) return 0.3;

    let score = 0;

    // Sharpe ratio evaluation (best: > 2.0)
    if (backtestResults.sharpeRatio && backtestResults.sharpeRatio > 2.0) {
      score += 0.4;
    } else if (backtestResults.sharpeRatio && backtestResults.sharpeRatio > 1.0) {
      score += 0.25;
    } else if (backtestResults.sharpeRatio && backtestResults.sharpeRatio > 0.5) {
      score += 0.15;
    }

    // Win rate evaluation
    if (backtestResults.winRate && backtestResults.winRate > 0.6) {
      score += 0.3;
    } else if (backtestResults.winRate && backtestResults.winRate > 0.5) {
      score += 0.2;
    } else if (backtestResults.winRate && backtestResults.winRate > 0.45) {
      score += 0.1;
    }

    // Profit factor (reward/risk)
    if (backtestResults.profitFactor && backtestResults.profitFactor > 2.0) {
      score += 0.3;
    } else if (backtestResults.profitFactor && backtestResults.profitFactor > 1.5) {
      score += 0.2;
    } else if (backtestResults.profitFactor && backtestResults.profitFactor > 1.1) {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  private scoreRobustness(strategy: Strategy, backtestResults?: BacktestResult): number {
    if (!backtestResults) return 0.4;

    let score = 0;

    // Out-of-sample performance vs in-sample
    if (backtestResults.outOfSampleSharpe && backtestResults.sharpeRatio) {
      const degradation = backtestResults.outOfSampleSharpe / Math.max(backtestResults.sharpeRatio, 0.1);
      if (degradation > 0.8) {
        score += 0.35;
      } else if (degradation > 0.6) {
        score += 0.2;
      } else if (degradation > 0.4) {
        score += 0.1;
      }
    } else {
      score += 0.2;
    }

    // Parameter sensitivity
    if (backtestResults.parameterSensitivity) {
      if (backtestResults.parameterSensitivity < 0.15) {
        score += 0.35;
      } else if (backtestResults.parameterSensitivity < 0.3) {
        score += 0.2;
      } else if (backtestResults.parameterSensitivity < 0.5) {
        score += 0.1;
      }
    } else {
      score += 0.2;
    }

    // Trade count (more trades = more robust edge)
    if (backtestResults.totalTrades && backtestResults.totalTrades > 200) {
      score += 0.3;
    } else if (backtestResults.totalTrades && backtestResults.totalTrades > 100) {
      score += 0.2;
    } else if (backtestResults.totalTrades && backtestResults.totalTrades > 50) {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  private scoreRiskManagement(strategy: Strategy): number {
    let score = 0;

    // Check for stop losses
    if (strategy.exitRules?.some(r => r.type === 'stop_loss')) {
      score += 0.25;
    }

    // Check for position sizing
    if (strategy.positionSizingRules?.type && strategy.positionSizingRules.type !== 'fixed') {
      score += 0.25;
    } else if (strategy.positionSizingRules?.maxPositionSize && strategy.positionSizingRules.maxPositionSize < 0.1) {
      score += 0.15;
    }

    // Check for diversification
    if (strategy.maxConcurrentPositions && strategy.maxConcurrentPositions > 1) {
      score += 0.2;
    }

    // Check for profit taking
    if (strategy.exitRules?.some(r => r.type === 'profit_target')) {
      score += 0.15;
    }

    // Check for drawdown limits
    if (strategy.maxDrawdown && strategy.maxDrawdown < 0.25) {
      score += 0.15;
    }

    return Math.min(score, 1);
  }

  private scoreExecutionFeasibility(strategy: Strategy): number {
    let score = 0;

    // Liquidity requirements
    const minLiquidity = strategy.minLiquidity || 1000000;
    if (minLiquidity < 10000000) {
      score += 0.3;
    } else if (minLiquidity < 100000000) {
      score += 0.2;
    } else if (minLiquidity < 1000000000) {
      score += 0.1;
    }

    // Latency sensitivity
    if (strategy.type === 'statistical_arbitrage' || strategy.type === 'mean_reversion') {
      score += 0.15; // These can tolerate higher latency
    } else if (strategy.type === 'momentum') {
      score += 0.2;
    }

    // Number of entry signals (fewer = easier to execute)
    const entryRuleCount = strategy.entryRules?.length || 0;
    if (entryRuleCount <= 2) {
      score += 0.25;
    } else if (entryRuleCount <= 4) {
      score += 0.15;
    } else if (entryRuleCount <= 6) {
      score += 0.05;
    }

    // Trading frequency
    const expectedTradesPerDay = this.estimateTradesPerDay(strategy);
    if (expectedTradesPerDay < 10) {
      score += 0.3;
    } else if (expectedTradesPerDay < 100) {
      score += 0.2;
    } else if (expectedTradesPerDay < 1000) {
      score += 0.05;
    }

    return Math.min(score, 1);
  }

  private scoreRegimeDependency(strategy: Strategy, backtestResults?: BacktestResult): number {
    let score = 0;

    // Check for regime filters
    if (strategy.regimeFilters && strategy.regimeFilters.length > 0) {
      score += 0.2;
    }

    // Check performance consistency across regimes
    if (backtestResults?.regimePerformance) {
      const performances = Object.values(backtestResults.regimePerformance as Record<string, number>);
      if (performances.length > 1) {
        const mean = performances.reduce((a, b) => a + b) / performances.length;
        const variance = performances.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / performances.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev < mean * 0.3) {
          score += 0.4;
        } else if (stdDev < mean * 0.6) {
          score += 0.25;
        } else if (stdDev < mean * 1.0) {
          score += 0.1;
        }
      }
    } else {
      score += 0.15; // Default credit for not knowing
    }

    // Higher score if strategy is designed for specific regime
    if (strategy.targetRegimes && strategy.targetRegimes.length > 0) {
      score += 0.15;
    } else {
      score -= 0.1;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  private scoreCapacity(strategy: Strategy): number {
    let score = 0.5; // Start at neutral

    // Larger target market cap = better capacity
    const targetMarketCap = strategy.targetMarketCap || 100000000;
    if (targetMarketCap > 5000000000) {
      score += 0.3;
    } else if (targetMarketCap > 1000000000) {
      score += 0.2;
    } else if (targetMarketCap > 100000000) {
      score += 0.1;
    } else {
      score -= 0.2;
    }

    // Number of instruments
    const instrumentCount = strategy.instruments?.length || 1;
    if (instrumentCount > 100) {
      score += 0.2;
    } else if (instrumentCount > 20) {
      score += 0.1;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  private scoreComplexity(strategy: Strategy): number {
    let score = 0;

    // Simpler is better - fewer rules
    const totalRules = (strategy.entryRules?.length || 0) + (strategy.exitRules?.length || 0);
    if (totalRules <= 2) {
      score += 0.3;
    } else if (totalRules <= 4) {
      score += 0.2;
    } else if (totalRules <= 6) {
      score += 0.1;
    }

    // Fewer parameters to optimize
    const parameterCount = strategy.parameters?.length || 5;
    if (parameterCount <= 2) {
      score += 0.35;
    } else if (parameterCount <= 4) {
      score += 0.2;
    } else if (parameterCount <= 8) {
      score += 0.1;
    }

    // Simpler indicators preferred
    if (strategy.indicators?.some(i => ['SMA', 'EMA', 'RSI', 'MACD'].includes(i.type))) {
      score += 0.2;
    } else if (strategy.indicators?.some(i => i.type.includes('Custom'))) {
      score -= 0.1;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  private scoreToGrade(score: number): Grade {
    const normalized = Math.min(Math.max(score, 0), 1);
    if (normalized >= 0.9) return Grade.A;
    if (normalized >= 0.8) return Grade.B;
    if (normalized >= 0.7) return Grade.C;
    if (normalized >= 0.6) return Grade.D;
    return Grade.F;
  }

  private generateGradeExplanation(subGrades: SubGrades, scores: Record<string, number>): string {
    const explanations: string[] = [];

    if (subGrades.edgeQuality === Grade.F || subGrades.edgeQuality === Grade.D) {
      explanations.push('Warning: Edge quality is questionable. Returns may be due to luck or overfitting.');
    }

    if (subGrades.robustness === Grade.F) {
      explanations.push('Critical: Strategy fails robustness tests. High risk of failure in live trading.');
    }

    if (subGrades.riskManagement === Grade.F || subGrades.riskManagement === Grade.D) {
      explanations.push('Risk management is inadequate. Strategy lacks proper safeguards.');
    }

    if (subGrades.executionFeasibility === Grade.F) {
      explanations.push('Strategy is not practically executable. May face liquidity or latency issues.');
    }

    if (subGrades.regimeDependency === Grade.F) {
      explanations.push('Strategy is highly dependent on specific market regimes. Likely to fail when conditions change.');
    }

    if (subGrades.complexity === Grade.F) {
      explanations.push('Strategy is overly complex. High maintenance burden and risk of implementation errors.');
    }

    if (explanations.length === 0) {
      explanations.push('Strategy meets acceptable standards across most dimensions.');
    }

    return explanations.join(' ');
  }

  /**
   * Adversarial critique - how would this strategy fail?
   */
  redTeamAnalysis(strategy: Strategy, backtestResults?: BacktestResult): RedTeamAnalysis {
    const critiques: string[] = [];
    const vulnerabilities: string[] = [];
    const failureScenarios: string[] = [];
    const breakingPoints: string[] = [];

    // Critique edge sources
    critiques.push('Strategy likely exploits a temporary market inefficiency that may disappear as it scales.');
    critiques.push('Backtest results may suffer from look-ahead bias or data snooping.');
    critiques.push('Strategy parameters are likely overfit to historical data.');

    // Identify vulnerabilities
    vulnerabilities.push('Extreme volatility or gap moves can violate all risk management assumptions.');
    vulnerabilities.push('Liquidity can disappear during market stress, making entry/exit impossible.');
    vulnerabilities.push('Correlations between positions can increase dramatically during crashes.');

    if (!strategy.exitRules?.some(r => r.type === 'stop_loss')) {
      vulnerabilities.push('No stop loss protection - losses can grow unbounded.');
    }

    if (!backtestResults) {
      vulnerabilities.push('No backtest results available - edge is unvalidated.');
    } else if (backtestResults.maxDrawdown && backtestResults.maxDrawdown > 0.3) {
      vulnerabilities.push(`Maximum drawdown of ${(backtestResults.maxDrawdown * 100).toFixed(1)}% indicates high risk concentration.`);
    }

    // Failure scenarios
    failureScenarios.push('Flash crash: Assets gap down 10%+ triggering cascading stop losses.');
    failureScenarios.push('Market structure change: New exchange, circuit breakers, or regulatory changes break the edge.');
    failureScenarios.push('Correlation spike: All positions move together, negating diversification.');
    failureScenarios.push(`Liquidity drought: Can't scale position size without massive slippage.`);
    failureScenarios.push('Regime shift: Sharp pivot from bullish to bearish environment.');

    // Breaking points
    if (backtestResults?.parameterSensitivity && backtestResults.parameterSensitivity > 0.3) {
      breakingPoints.push('Strategy is brittle - small parameter changes cause large P&L swings.');
    }

    breakingPoints.push('Strategy breaks if execution latency increases by >100ms.');
    breakingPoints.push('Strategy fails if trading volume in target instruments declines >50%.');
    breakingPoints.push('Strategy fails if competition discovers and trades the same signals.');

    const estimatedFailureProbability = this.estimateFailureProbability(strategy, backtestResults);

    return {
      critiques,
      vulnerabilities,
      failureScenarios,
      estimatedFailureProbability,
      breakingPoints,
    };
  }

  private estimateFailureProbability(strategy: Strategy, backtestResults?: BacktestResult): number {
    let probability = 0.3; // Base rate of strategy failure

    if (!backtestResults) {
      probability += 0.2; // Unvalidated
    } else {
      if (backtestResults.sharpeRatio && backtestResults.sharpeRatio < 1.0) {
        probability += 0.15;
      }

      if (backtestResults.outOfSampleSharpe && backtestResults.sharpeRatio) {
        const degradation = 1 - backtestResults.outOfSampleSharpe / Math.max(backtestResults.sharpeRatio, 0.1);
        probability += Math.min(degradation * 0.2, 0.2);
      }

      if (backtestResults.maxDrawdown && backtestResults.maxDrawdown > 0.4) {
        probability += 0.1;
      }
    }

    if (!strategy.exitRules?.some(r => r.type === 'stop_loss')) {
      probability += 0.1;
    }

    if ((strategy.entryRules?.length || 0) > 8) {
      probability += 0.05;
    }

    return Math.min(probability, 1);
  }

  /**
   * Generate strongest arguments AGAINST trading this strategy
   */
  whyNotTrade(strategy: Strategy, backtestResults?: BacktestResult): string[] {
    const arguments_: string[] = [];

    // Argument 1: Risk of overfitting
    if (!backtestResults || !backtestResults.outOfSampleSharpe) {
      arguments_.push(
        'The strategy has never been walk-forward tested on truly unseen data. There is extreme risk of overfitting to historical noise.',
      );
    } else if (backtestResults.outOfSampleSharpe < backtestResults.sharpeRatio * 0.5) {
      arguments_.push(
        'Out-of-sample performance is half of in-sample Sharpe ratio. This indicates severe overfitting and likely poor future performance.',
      );
    }

    // Argument 2: Execution risk
    const expectedTrades = this.estimateTradesPerDay(strategy) * 252;
    if (expectedTrades > 10000) {
      arguments_.push(
        'Strategy requires over 10,000 trades annually. Transaction costs and slippage will likely consume any edge. Not practically executable.',
      );
    }

    // Argument 3: Capacity constraints
    if (strategy.maxConcurrentPositions && strategy.maxConcurrentPositions < 5 && strategy.targetMarketCap && strategy.targetMarketCap < 500000000) {
      arguments_.push(
        'Maximum capacity is very small due to limited concurrent positions and liquid markets. Not scalable for meaningful capital deployment.',
      );
    }

    // Argument 4: Drawdown risk
    if (backtestResults?.maxDrawdown && backtestResults.maxDrawdown > 0.35) {
      arguments_.push(
        `Maximum historical drawdown of ${(backtestResults.maxDrawdown * 100).toFixed(1)}% with no guarantee it won't be worse in the future. Unacceptable risk for most portfolios.`,
      );
    }

    // Argument 5: Complexity
    const ruleCount = (strategy.entryRules?.length || 0) + (strategy.exitRules?.length || 0);
    if (ruleCount > 10) {
      arguments_.push('Strategy has excessive complexity with too many interacting rules. High probability of unexpected behavior or implementation errors.');
    }

    // Argument 6: Parameter sensitivity
    if (backtestResults?.parameterSensitivity && backtestResults.parameterSensitivity > 0.4) {
      arguments_.push(
        'Strategy is extremely sensitive to parameter values. Small market changes or parameter drift will likely cause large losses.',
      );
    }

    // Argument 7: Insufficient edge
    if (backtestResults?.sharpeRatio && backtestResults.sharpeRatio < 0.8) {
      arguments_.push('Risk-adjusted returns are barely above buy-and-hold. Not worth the operational complexity and drawdown risk.');
    }

    // Argument 8: No regime filter
    if (!strategy.regimeFilters || strategy.regimeFilters.length === 0) {
      arguments_.push(
        'Strategy lacks regime filters. Will trade in all market conditions including those where the edge is known to disappear.',
      );
    }

    return arguments_;
  }

  /**
   * Stress test strategy against extreme scenarios
   */
  stressTest(strategy: Strategy, backtestResults?: BacktestResult): Record<string, { passed: boolean; result: string }> {
    const results: Record<string, { passed: boolean; result: string }> = {};

    // Stress 1: Flash crash
    const stopLossExists = strategy.exitRules?.some(r => r.type === 'stop_loss');
    results['flash_crash_10pct'] = {
      passed: stopLossExists,
      result: stopLossExists ? 'Mitigated by stop loss' : 'Strategy would suffer massive loss with gaps down 10%+',
    };

    // Stress 2: Liquidity drying up
    const hasLiquidityFilter = strategy.entryRules?.some(r => r.type?.includes('volume') || r.type?.includes('liquidity'));
    results['liquidity_drought'] = {
      passed: hasLiquidityFilter,
      result: hasLiquidityFilter ? 'Liquidity filter provides some protection' : 'No liquidity protection - would be forced into wide spreads',
    };

    // Stress 3: Volatility spike
    const hasVolatilityScaling = strategy.positionSizingRules?.type === 'volatility_adjusted';
    results['vol_spike_3x'] = {
      passed: hasVolatilityScaling,
      result: hasVolatilityScaling
        ? 'Position size automatically reduced'
        : 'Position size unchanged - losses would increase dramatically',
    };

    // Stress 4: Correlation blowup
    const hasMaxConcurrentCheck = strategy.maxConcurrentPositions && strategy.maxConcurrentPositions > 1;
    results['correlation_to_1'] = {
      passed: hasMaxConcurrentCheck,
      result: hasMaxConcurrentCheck ? 'Diversification provides some cushion' : 'No diversification - all positions fail together',
    };

    // Stress 5: Sharp regime change
    const hasRegimeFilter = strategy.regimeFilters && strategy.regimeFilters.length > 0;
    results['regime_shift'] = {
      passed: hasRegimeFilter,
      result: hasRegimeFilter ? 'Regime filter can reduce exposure' : 'No protection - strategy trades regardless of regime',
    };

    // Stress 6: Drawdown recovery
    if (backtestResults?.maxDrawdown && backtestResults.maxDrawdownRecoveryDays) {
      const recoveryTimeMonths = backtestResults.maxDrawdownRecoveryDays / 21;
      results['drawdown_recovery'] = {
        passed: recoveryTimeMonths < 6,
        result: `Maximum drawdown took ${recoveryTimeMonths.toFixed(1)} months to recover. ${recoveryTimeMonths < 6 ? 'Acceptable' : 'Unacceptably slow'}`,
      };
    }

    // Stress 7: Parameter drift
    if (backtestResults?.parameterSensitivity) {
      results['param_drift'] = {
        passed: backtestResults.parameterSensitivity < 0.25,
        result: backtestResults.parameterSensitivity < 0.25 ? 'Robust to parameter changes' : 'Brittle - fails with parameter drift',
      };
    }

    return results;
  }

  /**
   * Compare strategy to baseline alternatives
   */
  compareToBaseline(strategy: Strategy, backtestResults?: BacktestResult): Record<string, { wins: boolean; detail: string }> {
    const comparisons: Record<string, { wins: boolean; detail: string }> = {};

    if (!backtestResults) {
      return { error: { wins: false, detail: 'No backtest results provided' } };
    }

    // vs Buy and Hold
    const buyHoldReturn = 0.1; // Assume 10% annual for SPY
    const strategyReturn = backtestResults.totalReturn || 0;
    comparisons['vs_buy_and_hold'] = {
      wins: strategyReturn > buyHoldReturn,
      detail: `Strategy returned ${(strategyReturn * 100).toFixed(1)}% vs 10% for buy-and-hold. ${strategyReturn > buyHoldReturn ? 'Better' : 'Worse'}`,
    };

    // vs Random entry
    const randomSharpe = 0.2;
    const strategySharpe = backtestResults.sharpeRatio || 0;
    comparisons['vs_random_entry'] = {
      wins: strategySharpe > randomSharpe,
      detail: `Strategy Sharpe of ${strategySharpe.toFixed(2)} vs 0.2 for random. ${strategySharpe > randomSharpe * 3 ? 'Significantly better' : 'Only marginally better'}`,
    };

    // vs Long-only
    const longOnlyDrawdown = 0.35;
    const strategyDrawdown = backtestResults.maxDrawdown || 0;
    comparisons['vs_long_only'] = {
      wins: strategyDrawdown < longOnlyDrawdown,
      detail: `Strategy drawdown ${(strategyDrawdown * 100).toFixed(1)}% vs 35% for long-only. ${strategyDrawdown < longOnlyDrawdown ? 'Better risk management' : 'Comparable or worse'}`,
    };

    // vs 60/40 portfolio
    const balanced60_40Sharpe = 0.6;
    comparisons['vs_60_40_portfolio'] = {
      wins: strategySharpe > balanced60_40Sharpe,
      detail: `Strategy Sharpe of ${strategySharpe.toFixed(2)} vs 0.6 for 60/40. ${strategySharpe > balanced60_40Sharpe ? 'Superior risk-adjusted returns' : 'Underperforming balanced portfolio'}`,
    };

    return comparisons;
  }

  /**
   * Identify the most fragile assumptions
   */
  identifyWeakLinks(strategy: Strategy, backtestResults?: BacktestResult): string[] {
    const weakLinks: string[] = [];

    // 1. No stop loss
    if (!strategy.exitRules?.some(r => r.type === 'stop_loss')) {
      weakLinks.push('No stop loss protection - worst-case losses are unlimited');
    }

    // 2. Limited position sizing rules
    if (!strategy.positionSizingRules || strategy.positionSizingRules.type === 'fixed') {
      weakLinks.push('Fixed position sizing ignores market volatility - overexposed in volatile periods');
    }

    // 3. Indicator lag
    if (strategy.indicators?.some(i => ['SMA', 'EMA'].includes(i.type) && (i.period || 20) > 50)) {
      weakLinks.push('Long moving averages create significant lag - signals are late');
    }

    // 4. Insufficient diversification
    if (strategy.maxConcurrentPositions === 1) {
      weakLinks.push('Single position at a time - no diversification benefit');
    }

    // 5. Parameter sensitivity
    if (backtestResults?.parameterSensitivity && backtestResults.parameterSensitivity > 0.3) {
      weakLinks.push('High parameter sensitivity - small changes cause large P&L swings');
    }

    // 6. No regime filter
    if (!strategy.regimeFilters || strategy.regimeFilters.length === 0) {
      weakLinks.push('No regime filter - trades in all conditions despite variable edge');
    }

    // 7. Overfitting evidence
    if (backtestResults && backtestResults.sharpeRatio && backtestResults.outOfSampleSharpe) {
      if (backtestResults.outOfSampleSharpe < backtestResults.sharpeRatio * 0.6) {
        weakLinks.push('Severe in-sample vs out-of-sample degradation suggests overfitting');
      }
    }

    // 8. Single entry condition
    if ((strategy.entryRules?.length || 0) === 1) {
      weakLinks.push('Single entry condition - no confirmation or validation of signals');
    }

    // 9. Time-of-day dependency
    if (strategy.trainingSchedule?.includes('market_open') || strategy.trainingSchedule?.includes('market_close')) {
      weakLinks.push('Strategy depends on specific times of day - vulnerable to schedule changes');
    }

    // 10. Correlation assumption
    if (strategy.maxConcurrentPositions && strategy.maxConcurrentPositions > 10) {
      weakLinks.push('Many concurrent positions assume low correlations - breaks during crises');
    }

    return weakLinks;
  }

  /**
   * Build a counter-strategy that would exploit this strategy's weaknesses
   */
  constructCounterStrategy(strategy: Strategy, backtestResults?: BacktestResult): CounterStrategy[] {
    const counters: CounterStrategy[] = [];

    // Counter 1: Fade the trend
    if (strategy.type === 'momentum') {
      counters.push({
        description: 'Fade momentum moves by shorting into strength',
        mechanism: 'Short the same assets the strategy buys on strength',
        effectiveness: 0.6,
        exploitedWeakness: 'Momentum strategies can overshoot and mean revert',
      });
    }

    // Counter 2: Front-run the entry
    counters.push({
      description: 'Front-run the strategy by entering before its signals fire',
      mechanism: `Place orders slightly ahead of the strategy's known entry points`,
      effectiveness: backtestResults ? 0.4 : 0.3,
      exploitedWeakness: 'Predictable entry signals can be anticipated',
    });

    // Counter 3: Exploit the exit
    if (strategy.exitRules && strategy.exitRules.length > 0) {
      counters.push({
        description: 'Trade against the strategy exits by reversing positions',
        mechanism: 'Reverse position right after the strategy exits',
        effectiveness: 0.5,
        exploitedWeakness: 'Exit signals are often reactive and inefficient',
      });
    }

    // Counter 4: Volatility trap
    counters.push({
      description: 'Create artificial volatility to trigger stop losses',
      mechanism: 'Initiate brief sharp moves to hit stops, then unwind',
      effectiveness: 0.45,
      exploitedWeakness: 'Strategy reliance on mechanical stops',
    });

    // Counter 5: Liquidity withdrawal
    counters.push({
      description: 'Withdraw liquidity when the strategy tries to trade',
      mechanism: 'Pull limit orders right before the strategy market orders',
      effectiveness: 0.5,
      exploitedWeakness: 'Strategy is forced to accept worse prices',
    });

    return counters;
  }

  private estimateTradesPerDay(strategy: Strategy): number {
    // Estimate based on entry frequency and position holding time
    const baseFrequency = (strategy.entryRules?.length || 1) * 2;
    const holdingDaysEstimate = strategy.averageHoldingPeriod || 5;

    return Math.max(1, Math.floor(252 * baseFrequency / Math.max(holdingDaysEstimate, 1) / 252)); // Average
  }
}

export default StrategyCritic;

export const strategyCritic = new StrategyCritic();
