import { Strategy, BacktestResult } from '../types';

export enum ImprovementType {
  ENTRY_TIMING = 'ENTRY_TIMING',
  ENTRY_CONFIRMATION = 'ENTRY_CONFIRMATION',
  ENTRY_REGIME_FILTER = 'ENTRY_REGIME_FILTER',
  EXIT_TRAILING_STOP = 'EXIT_TRAILING_STOP',
  EXIT_TIME_BASED = 'EXIT_TIME_BASED',
  EXIT_VOLATILITY_ADJUSTED = 'EXIT_VOLATILITY_ADJUSTED',
  SIZING_KELLY = 'SIZING_KELLY',
  SIZING_VOLATILITY = 'SIZING_VOLATILITY',
  SIZING_CORRELATION = 'SIZING_CORRELATION',
  FILTER_VOLUME = 'FILTER_VOLUME',
  FILTER_VOLATILITY_REGIME = 'FILTER_VOLATILITY_REGIME',
  FILTER_TIME_OF_DAY = 'FILTER_TIME_OF_DAY',
  FILTER_NEWS_AVOIDANCE = 'FILTER_NEWS_AVOIDANCE',
  META_ENSEMBLE = 'META_ENSEMBLE',
  META_ADAPTIVE_PARAMS = 'META_ADAPTIVE_PARAMS',
  META_REGIME_SWITCHING = 'META_REGIME_SWITCHING',
}

export interface Improvement {
  type: ImprovementType;
  name: string;
  description: string;
  implementation: string;
  estimatedReturnImpact: number; // bps per trade
  estimatedRiskReduction: number; // percentage reduction in drawdown/volatility
  complexity: number; // 0-1
  implementationEffort: number; // days of work
  priority: number; // 1-16, 1 = highest priority
  dependencies: ImprovementType[];
  mutuallyExclusive: ImprovementType[];
}

export interface ImprovementHistory {
  improvement: Improvement;
  appliedDate: Date;
  resultingStrategy: Strategy;
  backtestResult: BacktestResult;
  actualReturnImpact: number;
  actualRiskReduction: number;
  successful: boolean;
  notes: string;
}

export class AutoImprover {
  private improvementCatalog: Map<ImprovementType, Improvement> = new Map();
  private improvementHistory: ImprovementHistory[] = [];

  constructor() {
    this.initializeImprovementCatalog();
  }

  private initializeImprovementCatalog(): void {
    // Entry improvements
    this.improvementCatalog.set(ImprovementType.ENTRY_TIMING, {
      type: ImprovementType.ENTRY_TIMING,
      name: 'Improved Entry Timing',
      description: 'Use higher timeframe confirmation to time entries more precisely, reducing noise trades',
      implementation: 'Add higher timeframe filter (e.g., daily trend for intraday trades)',
      estimatedReturnImpact: 5, // 5 bps per trade
      estimatedRiskReduction: 0.08, // 8% drawdown reduction
      complexity: 0.3,
      implementationEffort: 1,
      priority: 2,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.ENTRY_CONFIRMATION, {
      type: ImprovementType.ENTRY_CONFIRMATION,
      name: 'Entry Signal Confirmation',
      description: 'Require multiple signals to align before entering (reduces false signals)',
      implementation: 'Add second indicator or price action confirmation',
      estimatedReturnImpact: 8,
      estimatedRiskReduction: 0.15,
      complexity: 0.35,
      implementationEffort: 2,
      priority: 3,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.ENTRY_REGIME_FILTER, {
      type: ImprovementType.ENTRY_REGIME_FILTER,
      name: 'Market Regime Filter',
      description: 'Only trade in regimes where edge is proven to exist',
      implementation: 'Identify optimal volatility/trend regimes and filter accordingly',
      estimatedReturnImpact: 12,
      estimatedRiskReduction: 0.25,
      complexity: 0.6,
      implementationEffort: 3,
      priority: 1,
      dependencies: [],
      mutuallyExclusive: [],
    });

    // Exit improvements
    this.improvementCatalog.set(ImprovementType.EXIT_TRAILING_STOP, {
      type: ImprovementType.EXIT_TRAILING_STOP,
      name: 'Trailing Stop Loss',
      description: 'Use trailing stops instead of fixed stops to lock in profits while protecting downside',
      implementation: 'Replace fixed stop with trailing stop (e.g., 2x ATR)',
      estimatedReturnImpact: 10,
      estimatedRiskReduction: 0.2,
      complexity: 0.3,
      implementationEffort: 1,
      priority: 4,
      dependencies: [],
      mutuallyExclusive: [ImprovementType.EXIT_VOLATILITY_ADJUSTED],
    });

    this.improvementCatalog.set(ImprovementType.EXIT_TIME_BASED, {
      type: ImprovementType.EXIT_TIME_BASED,
      name: 'Time-Based Exit',
      description: `Exit if trade hasn't moved in positive direction after N bars`,
      implementation: 'Add time decay exit (e.g., exit after 5 bars if not profitable)',
      estimatedReturnImpact: 6,
      estimatedRiskReduction: 0.1,
      complexity: 0.2,
      implementationEffort: 1,
      priority: 6,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.EXIT_VOLATILITY_ADJUSTED, {
      type: ImprovementType.EXIT_VOLATILITY_ADJUSTED,
      name: 'Volatility-Adjusted Exits',
      description: 'Scale stop loss and take profit levels based on market volatility',
      implementation: 'Use ATR or historical volatility to scale exit targets',
      estimatedReturnImpact: 9,
      estimatedRiskReduction: 0.18,
      complexity: 0.4,
      implementationEffort: 2,
      priority: 5,
      dependencies: [],
      mutuallyExclusive: [ImprovementType.EXIT_TRAILING_STOP],
    });

    // Sizing improvements
    this.improvementCatalog.set(ImprovementType.SIZING_KELLY, {
      type: ImprovementType.SIZING_KELLY,
      name: 'Kelly Criterion Sizing',
      description: 'Use Kelly criterion to calculate optimal position size',
      implementation: 'Calculate Kelly fraction from win rate and payoff ratio',
      estimatedReturnImpact: 15,
      estimatedRiskReduction: 0.3,
      complexity: 0.5,
      implementationEffort: 2,
      priority: 2,
      dependencies: [],
      mutuallyExclusive: [ImprovementType.SIZING_VOLATILITY],
    });

    this.improvementCatalog.set(ImprovementType.SIZING_VOLATILITY, {
      type: ImprovementType.SIZING_VOLATILITY,
      name: 'Volatility-Based Sizing',
      description: 'Scale position size inversely with market volatility',
      implementation: 'Position size = base size / (current volatility / target volatility)',
      estimatedReturnImpact: 12,
      estimatedRiskReduction: 0.25,
      complexity: 0.35,
      implementationEffort: 1,
      priority: 3,
      dependencies: [],
      mutuallyExclusive: [ImprovementType.SIZING_KELLY],
    });

    this.improvementCatalog.set(ImprovementType.SIZING_CORRELATION, {
      type: ImprovementType.SIZING_CORRELATION,
      name: 'Correlation-Aware Sizing',
      description: 'Reduce position sizes when positions are highly correlated',
      implementation: 'Calculate portfolio correlation and scale sizes accordingly',
      estimatedReturnImpact: 8,
      estimatedRiskReduction: 0.22,
      complexity: 0.6,
      implementationEffort: 3,
      priority: 4,
      dependencies: [ImprovementType.SIZING_VOLATILITY],
      mutuallyExclusive: [],
    });

    // Filter improvements
    this.improvementCatalog.set(ImprovementType.FILTER_VOLUME, {
      type: ImprovementType.FILTER_VOLUME,
      name: 'Volume Filter',
      description: 'Only trade when volume is above average (better execution)',
      implementation: 'Check if current volume > MA(volume) before entry',
      estimatedReturnImpact: 4,
      estimatedRiskReduction: 0.08,
      complexity: 0.2,
      implementationEffort: 0.5,
      priority: 8,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.FILTER_VOLATILITY_REGIME, {
      type: ImprovementType.FILTER_VOLATILITY_REGIME,
      name: 'Volatility Regime Filter',
      description: 'Avoid trading in extreme volatility regimes',
      implementation: 'Skip trades if volatility is in top/bottom 10%',
      estimatedReturnImpact: 5,
      estimatedRiskReduction: 0.15,
      complexity: 0.3,
      implementationEffort: 1,
      priority: 7,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.FILTER_TIME_OF_DAY, {
      type: ImprovementType.FILTER_TIME_OF_DAY,
      name: 'Time-of-Day Filter',
      description: 'Only trade during best hours of the day (e.g., market open/close)',
      implementation: 'Disable trades outside proven profitable time windows',
      estimatedReturnImpact: 7,
      estimatedRiskReduction: 0.12,
      complexity: 0.2,
      implementationEffort: 0.5,
      priority: 9,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.FILTER_NEWS_AVOIDANCE, {
      type: ImprovementType.FILTER_NEWS_AVOIDANCE,
      name: 'News Avoidance Filter',
      description: 'Avoid trading around major economic news/earnings',
      implementation: 'Skip trades within 1 hour of major news events',
      estimatedReturnImpact: 3,
      estimatedRiskReduction: 0.1,
      complexity: 0.7,
      implementationEffort: 4,
      priority: 10,
      dependencies: [],
      mutuallyExclusive: [],
    });

    // Meta improvements
    this.improvementCatalog.set(ImprovementType.META_ENSEMBLE, {
      type: ImprovementType.META_ENSEMBLE,
      name: 'Ensemble Method',
      description: 'Combine signals from multiple indicator combinations',
      implementation: 'Vote or average signals from 3+ independent approaches',
      estimatedReturnImpact: 14,
      estimatedRiskReduction: 0.28,
      complexity: 0.8,
      implementationEffort: 5,
      priority: 1,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.META_ADAPTIVE_PARAMS, {
      type: ImprovementType.META_ADAPTIVE_PARAMS,
      name: 'Adaptive Parameters',
      description: 'Allow parameters to adapt based on recent market conditions',
      implementation: 'Optimize parameters monthly or use walk-forward optimization',
      estimatedReturnImpact: 11,
      estimatedRiskReduction: 0.2,
      complexity: 0.7,
      implementationEffort: 4,
      priority: 5,
      dependencies: [],
      mutuallyExclusive: [],
    });

    this.improvementCatalog.set(ImprovementType.META_REGIME_SWITCHING, {
      type: ImprovementType.META_REGIME_SWITCHING,
      name: 'Regime Switching',
      description: 'Switch between multiple strategies based on market regime',
      implementation: 'Identify regime, apply best strategy for that regime',
      estimatedReturnImpact: 16,
      estimatedRiskReduction: 0.35,
      complexity: 0.9,
      implementationEffort: 6,
      priority: 1,
      dependencies: [ImprovementType.ENTRY_REGIME_FILTER],
      mutuallyExclusive: [],
    });
  }

  /**
   * Suggest improvements ranked by impact and feasibility
   */
  suggestImprovements(strategy: Strategy, backtestResults: BacktestResult): Improvement[] {
    const suggestions: Improvement[] = [];
    const applicable = new Set<ImprovementType>();

    // Filter applicable improvements based on strategy characteristics
    for (const [type, improvement] of this.improvementCatalog) {
      // Check dependencies
      const dependenciesMet = improvement.dependencies.every(dep => applicable.has(dep) || this.isDependencyMet(strategy, dep));

      if (dependenciesMet) {
        applicable.add(type);

        // Score improvement by impact and feasibility
        const impactScore = improvement.estimatedReturnImpact + improvement.estimatedRiskReduction * 100;
        const feasibilityScore = (1 - improvement.complexity) * 10 - improvement.implementationEffort * 2;
        improvement.priority = Math.floor(impactScore + feasibilityScore);

        suggestions.push(improvement);
      }
    }

    // Sort by priority (lower number = higher priority)
    suggestions.sort((a, b) => a.priority - b.priority);

    return suggestions.slice(0, 8); // Return top 8
  }

  private isDependencyMet(strategy: Strategy, dep: ImprovementType): boolean {
    // Check if strategy already implements this feature
    const regimeFilters = (strategy as { regimeFilters?: unknown[] }).regimeFilters;
    const hasRegimeFilter = Array.isArray(regimeFilters) && regimeFilters.length > 0;
    const hasVolatilityScaling = strategy.positionSizingRules?.type === 'volatility_adjusted';
    const hasTrailingStop = Boolean(
      strategy.exitRules?.some((r: { type?: string }) => r.type === 'trailing_stop'),
    );

    switch (dep) {
      case ImprovementType.ENTRY_REGIME_FILTER:
        return hasRegimeFilter;
      case ImprovementType.SIZING_VOLATILITY:
        return Boolean(hasVolatilityScaling);
      case ImprovementType.EXIT_TRAILING_STOP:
        return hasTrailingStop;
      default:
        return false;
    }
  }

  /**
   * Apply an improvement to a strategy
   */
  applyImprovement(strategy: Strategy, improvement: Improvement): Strategy {
    const improved = JSON.parse(JSON.stringify(strategy)); // Deep clone

    switch (improvement.type) {
      case ImprovementType.ENTRY_TIMING:
        improved.entryRules = improved.entryRules || [];
        improved.entryRules.push({
          type: 'higher_timeframe_confirmation',
          parameter: 'daily_trend',
          description: 'Confirm signal on daily timeframe',
        });
        break;

      case ImprovementType.ENTRY_CONFIRMATION:
        improved.entryRules = improved.entryRules || [];
        improved.entryRules.push({
          type: 'confirmation',
          parameter: 'volume_increase',
          description: 'Require volume increase on entry signal',
        });
        break;

      case ImprovementType.ENTRY_REGIME_FILTER:
        improved.regimeFilters = improved.regimeFilters || [];
        improved.regimeFilters.push({
          type: 'volatility_range',
          minVol: 0.15,
          maxVol: 0.35,
        });
        break;

      case ImprovementType.EXIT_TRAILING_STOP:
        improved.exitRules = improved.exitRules || [];
        improved.exitRules.push({
          type: 'trailing_stop',
          trailingPercent: 0.02,
          description: '2% trailing stop',
        });
        break;

      case ImprovementType.EXIT_TIME_BASED:
        improved.exitRules = improved.exitRules || [];
        improved.exitRules.push({
          type: 'time_exit',
          barsToHold: 5,
          description: 'Exit after 5 bars if not profitable',
        });
        break;

      case ImprovementType.EXIT_VOLATILITY_ADJUSTED:
        improved.exitRules = improved.exitRules || [];
        improved.exitRules.push({
          type: 'volatility_adjusted_target',
          baseTarget: 0.02,
          volatilityMultiplier: 1.5,
        });
        break;

      case ImprovementType.SIZING_KELLY:
        improved.positionSizingRules = {
          type: 'kelly_criterion',
          maxPositionSize: 0.1,
        };
        break;

      case ImprovementType.SIZING_VOLATILITY:
        improved.positionSizingRules = {
          type: 'volatility_adjusted',
          targetVolatility: 0.15,
          basePositionSize: 0.02,
        };
        break;

      case ImprovementType.SIZING_CORRELATION:
        improved.positionSizingRules = {
          type: 'correlation_aware',
          maxCorrelation: 0.7,
          basePositionSize: 0.02,
        };
        break;

      case ImprovementType.FILTER_VOLUME:
        improved.entryRules = improved.entryRules || [];
        improved.entryRules.push({
          type: 'volume_filter',
          volumeMultiplier: 1.2,
          description: 'Require volume > 1.2x moving average',
        });
        break;

      case ImprovementType.FILTER_VOLATILITY_REGIME:
        improved.entryRules = improved.entryRules || [];
        improved.entryRules.push({
          type: 'volatility_percentile_filter',
          minPercentile: 0.1,
          maxPercentile: 0.9,
          description: 'Skip trades in extreme vol regimes',
        });
        break;

      case ImprovementType.FILTER_TIME_OF_DAY:
        improved.trainingSchedule = improved.trainingSchedule || [];
        improved.trainingSchedule.push('market_open');
        improved.trainingSchedule.push('market_close');
        break;

      case ImprovementType.FILTER_NEWS_AVOIDANCE:
        improved.entryRules = improved.entryRules || [];
        improved.entryRules.push({
          type: 'news_avoidance',
          minutesBuffer: 60,
          description: 'Avoid trading within 60 minutes of major news',
        });
        break;

      case ImprovementType.META_ENSEMBLE:
        improved.metaStrategy = {
          type: 'ensemble',
          voting: 'majority',
          numStrategies: 3,
        };
        break;

      case ImprovementType.META_ADAPTIVE_PARAMS:
        improved.adaptiveParameters = true;
        improved.optimizationFrequency = 'monthly';
        break;

      case ImprovementType.META_REGIME_SWITCHING:
        improved.regimeSwitching = true;
        improved.numRegimes = 3;
        break;
    }

    return improved;
  }

  /**
   * Estimate impact of an improvement
   */
  estimateImpact(improvement: Improvement, baseline: BacktestResult): { expectedReturn: number; expectedRisk: number } {
    const estimatedNewReturn = (baseline.totalReturn || 0) * (1 + improvement.estimatedReturnImpact / 10000);
    const estimatedNewRisk = (baseline.maxDrawdown || 0) * (1 - improvement.estimatedRiskReduction);

    return {
      expectedReturn: estimatedNewReturn,
      expectedRisk: estimatedNewRisk,
    };
  }

  /**
   * Track improvement application and results
   */
  recordImprovement(improvement: Improvement, originalStrategy: Strategy, improvedStrategy: Strategy, originalResults: BacktestResult, improvedResults: BacktestResult): void {
    const actualReturnImpact = (improvedResults.totalReturn || 0) - (originalResults.totalReturn || 0);
    const actualRiskReduction = ((originalResults.maxDrawdown || 0) - (improvedResults.maxDrawdown || 0)) / (originalResults.maxDrawdown || 1);
    const successful = actualReturnImpact > 0 && actualRiskReduction > 0;

    this.improvementHistory.push({
      improvement,
      appliedDate: new Date(),
      resultingStrategy: improvedStrategy,
      backtestResult: improvedResults,
      actualReturnImpact,
      actualRiskReduction,
      successful,
      notes: successful ? 'Improvement was successful' : 'Improvement did not improve performance',
    });
  }

  /**
   * Get history of improvements and what worked
   */
  trackImprovementHistory(): { successful: ImprovementHistory[]; unsuccessful: ImprovementHistory[]; summary: string } {
    const successful = this.improvementHistory.filter(h => h.successful);
    const unsuccessful = this.improvementHistory.filter(h => !h.successful);

    const successRate = successful.length / Math.max(this.improvementHistory.length, 1);
    const avgReturnGain = successful.reduce((sum, h) => sum + h.actualReturnImpact, 0) / Math.max(successful.length, 1);
    const avgRiskReduction = successful.reduce((sum, h) => sum + h.actualRiskReduction, 0) / Math.max(successful.length, 1);

    const summary = `Applied ${this.improvementHistory.length} improvements with ${(successRate * 100).toFixed(1)}% success rate. Average return gain: ${(avgReturnGain * 100).toFixed(2)}%, Average risk reduction: ${(avgRiskReduction * 100).toFixed(1)}%`;

    return { successful, unsuccessful, summary };
  }

  /**
   * Get most effective improvements historically
   */
  getMostEffectiveImprovements(topN: number = 5): ImprovementHistory[] {
    return this.improvementHistory
      .filter(h => h.successful)
      .sort((a, b) => {
        const scoreA = a.actualReturnImpact + a.actualRiskReduction * 100;
        const scoreB = b.actualReturnImpact + b.actualRiskReduction * 100;
        return scoreB - scoreA;
      })
      .slice(0, topN);
  }

  /**
   * Recommendations based on historical data
   */
  recommendImprovements(strategy: Strategy, backtestResults: BacktestResult): string[] {
    const recommendations: string[] = [];
    const effective = this.getMostEffectiveImprovements();

    // Get applicable suggestions
    const suggestions = this.suggestImprovements(strategy, backtestResults);

    if (suggestions.length === 0) {
      recommendations.push('No further improvements identified.');
      return recommendations;
    }

    // Check if top improvements have worked historically
    for (const effective_hist of effective) {
      const matching = suggestions.find(s => s.type === effective_hist.improvement.type);
      if (matching) {
        recommendations.push(`Apply "${matching.name}" - historically added ${(effective_hist.actualReturnImpact * 100).toFixed(2)}% return and reduced risk by ${(effective_hist.actualRiskReduction * 100).toFixed(1)}%`);
      }
    }

    // Add top suggestions not yet tried
    const triedTypes = new Set(this.improvementHistory.map(h => h.improvement.type));
    for (const suggestion of suggestions) {
      if (!triedTypes.has(suggestion.type) && recommendations.length < 5) {
        recommendations.push(`Try "${suggestion.name}" - estimated to add ${suggestion.estimatedReturnImpact} bps and reduce risk by ${(suggestion.estimatedRiskReduction * 100).toFixed(1)}%`);
      }
    }

    return recommendations;
  }
}

export default AutoImprover;

export const autoImprover = new AutoImprover();
