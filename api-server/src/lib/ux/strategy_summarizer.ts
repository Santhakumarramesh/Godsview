/**
 * StrategySummarizer - Human-readable strategy summaries
 *
 * Translates technical strategy parameters into plain English descriptions
 * suitable for traders of all skill levels.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface StrategySummary {
  oneLiner: string;
  description: string; // 2-3 sentences
  howItWorks: string; // plain English explanation
  whenItWorks: string; // best conditions
  whenItFails: string; // worst conditions
  riskProfile: string; // risk description
  suitableFor: string; // what type of trader
  keyMetrics: { label: string; value: string; rating: 'good' | 'neutral' | 'bad' }[];
  quickFacts: string[];
  grade: string;
  emoji: string; // strategy health emoji
}

export interface DetailedSummary {
  overview: string;
  entrySignals: string;
  exitSignals: string;
  riskManagement: string;
  filters: string;
  tradingHours: string;
  positionSizing: string;
  expectedPerformance: string;
  assumptions: string[];
}

export interface ComparisonSummary {
  strategies: Array<{
    name: string;
    oneLiner: string;
    grade: string;
    complexity: 'simple' | 'moderate' | 'complex';
    riskLevel: 'low' | 'moderate' | 'high';
  }>;
  recommendation: string;
  differences: string[];
  winner: string;
}

export interface FormattedMetrics {
  [key: string]: {
    value: string;
    unit: string;
    interpretation: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// StrategySummarizer
// ──────────────────────────────────────────────────────────────────────────

export class StrategySummarizer {
  /**
   * Generate a complete plain-English summary of a strategy
   */
  summarize(strategy: any): StrategySummary {
    const entryLogic = this.describeEntryLogic(strategy);
    const exitLogic = this.describeExitLogic(strategy);
    const riskProfile = this.assessRiskProfile(strategy);

    const oneLiner = this.generateOneLiner(entryLogic, exitLogic);
    const description = this.generateDescription(strategy, entryLogic, exitLogic);
    const howItWorks = this.explainMechanism(strategy, entryLogic, exitLogic);
    const whenItWorks = this.describeWhenItWorks(strategy);
    const whenItFails = this.describeWhenItFails(strategy);

    const keyMetrics = this.extractKeyMetrics(strategy);
    const quickFacts = this.generateQuickFacts(strategy);
    const grade = this.calculateGrade(strategy);
    const emoji = this.selectEmoji(grade);

    return {
      oneLiner,
      description,
      howItWorks,
      whenItWorks,
      whenItFails,
      riskProfile,
      suitableFor: this.determineSuitability(strategy),
      keyMetrics,
      quickFacts,
      grade,
      emoji,
    };
  }

  /**
   * Generate a quick one-liner
   */
  oneLiner(strategy: any): string {
    const entry = this.describeEntryLogic(strategy);
    const exit = this.describeExitLogic(strategy);
    return `${entry} with ${exit}`;
  }

  /**
   * Generate a detailed breakdown
   */
  detailedBreakdown(strategy: any): DetailedSummary {
    return {
      overview: this.generateDescription(strategy, '', ''),
      entrySignals: this.describeEntryLogic(strategy),
      exitSignals: this.describeExitLogic(strategy),
      riskManagement: this.describeRiskManagement(strategy),
      filters: this.describeFilters(strategy),
      tradingHours: this.describeTradingHours(strategy),
      positionSizing: this.describePositionSizing(strategy),
      expectedPerformance: this.describeExpectedPerformance(strategy),
      assumptions: this.extractAssumptions(strategy),
    };
  }

  /**
   * Generate a comparison summary
   */
  compareSummary(strategies: any[]): ComparisonSummary {
    const summaries = strategies.map(s => ({
      name: s.name || 'Unnamed Strategy',
      oneLiner: this.oneLiner(s),
      grade: this.calculateGrade(s),
      complexity: this.assessComplexity(s),
      riskLevel: this.assessRiskLevel(s),
    }));

    const bestStrategy = summaries.reduce((best, current) => {
      const bestScore = this.gradeToScore(best.grade);
      const currentScore = this.gradeToScore(current.grade);
      return currentScore > bestScore ? current : best;
    });

    const differences = this.identifyDifferences(strategies);

    return {
      strategies: summaries,
      recommendation: `${bestStrategy.name} is the strongest strategy with a ${bestStrategy.grade} grade.`,
      differences,
      winner: bestStrategy.name,
    };
  }

  /**
   * Generate a performance narrative
   */
  performanceNarrative(strategy: any, results: any): string {
    const winRate = results?.winRate || 0;
    const sharpe = results?.sharpeRatio || 0;
    const drawdown = results?.maxDrawdown || 0;

    const performanceDesc =
      winRate > 0.55
        ? 'strong win rate'
        : winRate > 0.50
          ? 'slightly profitable'
          : 'challenging performance';

    const riskDesc =
      drawdown < 0.15
        ? 'well-controlled risk'
        : drawdown < 0.25
          ? 'moderate drawdown periods'
          : 'significant volatility';

    const sharpDesc =
      sharpe > 1.5
        ? 'excellent risk-adjusted returns'
        : sharpe > 1.0
          ? 'good return-to-risk ratio'
          : 'lower risk-adjusted returns';

    return `This strategy exhibits ${performanceDesc} with ${riskDesc} and ${sharpDesc}. It has generated ${((winRate * 100).toFixed(1))}% winning trades with a Sharpe ratio of ${sharpe.toFixed(2)}.`;
  }

  /**
   * Format numbers nicely for display
   */
  formatMetrics(metrics: any): FormattedMetrics {
    const formatted: FormattedMetrics = {};

    if (metrics.sharpeRatio !== undefined) {
      formatted.sharpeRatio = {
        value: metrics.sharpeRatio.toFixed(2),
        unit: 'ratio',
        interpretation:
          metrics.sharpeRatio > 1.5
            ? 'Excellent risk-adjusted returns'
            : metrics.sharpeRatio > 1.0
              ? 'Good risk-adjusted returns'
              : 'Fair risk-adjusted returns',
      };
    }

    if (metrics.maxDrawdown !== undefined) {
      formatted.maxDrawdown = {
        value: `${(metrics.maxDrawdown * 100).toFixed(1)}%`,
        unit: 'percentage',
        interpretation:
          metrics.maxDrawdown < 0.15
            ? 'Well-managed risk'
            : metrics.maxDrawdown < 0.25
              ? 'Moderate drawdown'
              : 'High volatility periods',
      };
    }

    if (metrics.winRate !== undefined) {
      formatted.winRate = {
        value: `${(metrics.winRate * 100).toFixed(1)}%`,
        unit: 'percentage',
        interpretation:
          metrics.winRate > 0.55
            ? 'Strong win rate'
            : metrics.winRate > 0.50
              ? 'Slightly positive'
              : 'Negative win rate',
      };
    }

    if (metrics.profitFactor !== undefined) {
      formatted.profitFactor = {
        value: metrics.profitFactor.toFixed(2),
        unit: 'ratio',
        interpretation:
          metrics.profitFactor > 2.0
            ? 'Excellent profit-to-loss ratio'
            : metrics.profitFactor > 1.5
              ? 'Good profit-to-loss ratio'
              : 'Tight profit margins',
      };
    }

    return formatted;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  private describeEntryLogic(strategy: any): string {
    const entry = strategy?.entry;
    if (!entry) return 'Unknown entry logic';

    if (entry.type === 'moving_average_cross') {
      return `Buys when ${entry.fast_ma || 'fast'} MA crosses above ${entry.slow_ma || 'slow'} MA`;
    }
    if (entry.type === 'rsi_oversold') {
      return `Buys when RSI drops below ${entry.threshold || 30}`;
    }
    if (entry.type === 'breakout') {
      return `Buys when price breaks above recent highs`;
    }
    if (entry.type === 'trend_confirmation') {
      return `Buys when price confirms an uptrend`;
    }
    return `Enters based on ${entry.type}`;
  }

  private describeExitLogic(strategy: any): string {
    const exit = strategy?.exit;
    if (!exit) return 'Unknown exit logic';

    if (exit.type === 'profit_target') {
      return `takes profits at ${(exit.target * 100).toFixed(1)}%`;
    }
    if (exit.type === 'stop_loss') {
      return `exits on stop loss at ${(exit.level * 100).toFixed(1)}%`;
    }
    if (exit.type === 'trailing_stop') {
      return `trails stops by ${(exit.trail * 100).toFixed(1)}%`;
    }
    if (exit.type === 'time_based') {
      return `exits after ${exit.bars} bars`;
    }
    return `exits using ${exit.type}`;
  }

  private assessRiskProfile(strategy: any): string {
    const stopLoss = strategy?.exit?.level || 0.05;
    const positionSize = strategy?.position_size || 1;

    if (stopLoss < 0.03 && positionSize < 1) return 'Very conservative - tight stops and small positions';
    if (stopLoss < 0.05 && positionSize < 2) return 'Conservative - controlled risk exposure';
    if (stopLoss < 0.10 && positionSize < 3) return 'Moderate - balanced risk and reward';
    if (stopLoss < 0.15 && positionSize < 4) return 'Aggressive - larger positions with wider stops';
    return 'Very aggressive - high risk exposure';
  }

  private generateOneLiner(entry: string, exit: string): string {
    return `A strategy that ${entry} and ${exit}.`;
  }

  private generateDescription(strategy: any, entry: string, exit: string): string {
    return `This strategy ${entry.toLowerCase() || 'trades'} by identifying key entry points and ${exit.toLowerCase() || 'managing exits'}. It aims to capture directional moves while controlling downside risk through disciplined position management.`;
  }

  private explainMechanism(strategy: any, entry: string, exit: string): string {
    return `The strategy works by watching for ${entry.toLowerCase()}. Once a position is open, the system will ${exit.toLowerCase()}. This creates a systematic approach to trade management.`;
  }

  private describeWhenItWorks(strategy: any): string {
    const timeFrame = strategy?.timeframe || 'daily';
    return `This strategy typically performs best in trending markets with clear directional bias, especially on ${timeFrame} timeframes when momentum is strong.`;
  }

  private describeWhenItFails(strategy: any): string {
    return `Performance tends to suffer in choppy, sideways markets with false breakouts. Whipsaws can trigger multiple stop losses in ranging conditions.`;
  }

  private determineSuitability(strategy: any): string {
    const complexity = this.assessComplexity(strategy);
    if (complexity === 'simple') return 'New traders, trend-followers';
    if (complexity === 'moderate') return 'Intermediate traders, system-focused traders';
    return 'Advanced traders, quants, institutional traders';
  }

  private extractKeyMetrics(strategy: any): Array<{ label: string; value: string; rating: 'good' | 'neutral' | 'bad' }> {
    return [
      {
        label: 'Win Rate',
        value: `${((strategy?.win_rate || 0.50) * 100).toFixed(1)}%`,
        rating: (strategy?.win_rate || 0) > 0.55 ? 'good' : (strategy?.win_rate || 0) > 0.50 ? 'neutral' : 'bad',
      },
      {
        label: 'Risk/Reward',
        value: `1:${(strategy?.reward_risk || 1.5).toFixed(1)}`,
        rating: (strategy?.reward_risk || 1) > 2 ? 'good' : 'neutral',
      },
      {
        label: 'Max Drawdown',
        value: `${((strategy?.max_drawdown || 0.15) * 100).toFixed(1)}%`,
        rating: (strategy?.max_drawdown || 0.15) < 0.15 ? 'good' : 'neutral',
      },
    ];
  }

  private generateQuickFacts(strategy: any): string[] {
    const facts: string[] = [];
    if (strategy?.timeframe) facts.push(`Trades on ${strategy.timeframe} timeframe`);
    if (strategy?.instruments) facts.push(`Works with ${strategy.instruments}`);
    if (strategy?.sessions) facts.push(`Active during ${strategy.sessions}`);
    if (strategy?.max_trades_per_day) facts.push(`Max ${strategy.max_trades_per_day} trades per day`);
    return facts.length > 0 ? facts : ['Systematic trading approach', 'Risk-managed strategy'];
  }

  private calculateGrade(strategy: any): string {
    const score =
      (strategy?.win_rate || 0) * 30 +
      Math.min((strategy?.sharpe_ratio || 0) / 2, 30) +
      (1 - Math.min(strategy?.max_drawdown || 0.15, 1)) * 20 +
      (strategy?.logic_quality || 0.5) * 20;

    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    return 'F';
  }

  private selectEmoji(grade: string): string {
    if (grade.startsWith('A')) return '🚀';
    if (grade.startsWith('B')) return '📈';
    if (grade.startsWith('C')) return '⚠️';
    return '❌';
  }

  private describeRiskManagement(strategy: any): string {
    const stopLoss = strategy?.exit?.level || 0.05;
    const posSize = strategy?.position_size || 1;
    return `Uses ${(stopLoss * 100).toFixed(1)}% stop losses and ${posSize}x position sizing to manage risk.`;
  }

  private describeFilters(strategy: any): string {
    const filters = strategy?.filters || [];
    if (filters.length === 0) return 'No additional filters applied.';
    return `Applies ${filters.length} filter(s): ${filters.map((f: any) => f.name).join(', ')}.`;
  }

  private describeTradingHours(strategy: any): string {
    const sessions = strategy?.sessions || 'all market hours';
    return `Trades during ${sessions}.`;
  }

  private describePositionSizing(strategy: any): string {
    const method = strategy?.position_sizing?.method || 'fixed';
    if (method === 'fixed') return 'Uses fixed position sizes for each trade.';
    if (method === 'dynamic') return 'Adjusts position size based on market volatility.';
    if (method === 'equity_pct') return `Risks ${(strategy?.position_sizing?.risk_pct || 1)}% of equity per trade.`;
    return 'Uses adaptive position sizing.';
  }

  private describeExpectedPerformance(strategy: any): string {
    const winRate = strategy?.win_rate || 0.5;
    const profitFactor = strategy?.profit_factor || 1.5;
    return `Expected to win about ${(winRate * 100).toFixed(0)}% of trades with a profit factor of ${profitFactor.toFixed(1)}.`;
  }

  private extractAssumptions(strategy: any): string[] {
    return [
      'Markets are reasonably liquid',
      'Historical patterns repeat',
      'Execution is efficient',
      'No major market gaps',
      'Consistent entry/exit signals',
    ];
  }

  private assessComplexity(strategy: any): 'simple' | 'moderate' | 'complex' {
    const entryComplexity = (strategy?.entry?.conditions?.length || 1) > 2 ? 2 : 1;
    const exitComplexity = (strategy?.exit?.conditions?.length || 1) > 2 ? 2 : 1;
    const filterCount = (strategy?.filters?.length || 0);

    const total = entryComplexity + exitComplexity + filterCount;
    if (total <= 2) return 'simple';
    if (total <= 4) return 'moderate';
    return 'complex';
  }

  private assessRiskLevel(strategy: any): 'low' | 'moderate' | 'high' {
    const maxDrawdown = strategy?.max_drawdown || 0.15;
    const stopLoss = strategy?.exit?.level || 0.05;

    if (maxDrawdown < 0.10 && stopLoss < 0.03) return 'low';
    if (maxDrawdown < 0.20 && stopLoss < 0.07) return 'moderate';
    return 'high';
  }

  private gradeToScore(grade: string): number {
    const gradeMap: { [key: string]: number } = {
      'A+': 95,
      A: 90,
      'B+': 85,
      B: 75,
      C: 65,
      F: 30,
    };
    return gradeMap[grade] || 50;
  }

  private identifyDifferences(strategies: any[]): string[] {
    if (strategies.length < 2) return [];

    const differences: string[] = [];
    const strategy1 = strategies[0];
    const strategy2 = strategies[1];

    if (strategy1?.entry?.type !== strategy2?.entry?.type) {
      differences.push(`Different entry signals: ${strategy1?.entry?.type} vs ${strategy2?.entry?.type}`);
    }

    if (strategy1?.timeframe !== strategy2?.timeframe) {
      differences.push(`Different timeframes: ${strategy1?.timeframe} vs ${strategy2?.timeframe}`);
    }

    if (strategy1?.risk_level !== strategy2?.risk_level) {
      differences.push(`Different risk profiles`);
    }

    return differences;
  }
}

// Export singleton
let summarizerInstance: StrategySummarizer | null = null;

export function getStrategySummarizer(): StrategySummarizer {
  if (!summarizerInstance) {
    summarizerInstance = new StrategySummarizer();
  }
  return summarizerInstance;
}
