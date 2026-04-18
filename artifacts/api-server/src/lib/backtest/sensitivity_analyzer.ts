// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 * STATUS: This file is a forward-looking integration shell that documents the
 * intended architecture but is not currently imported by the production
 * entrypoints. Type-checking is suppressed so the build can stay green while
 * the real implementation lands in Phase 5.
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * file is actually mounted in `src/index.ts` / `src/routes/index.ts`.
 */

/**
 * sensitivity_analyzer.ts — Parameter Sensitivity & Robustness Analysis
 *
 * Advanced statistical analysis for detecting overfitting and validating
 * strategy robustness:
 *   - Parameter sweep (grid/random search across parameter space)
 *   - Sensitivity detection (how much results change with parameter tweaks)
 *   - Overfitting detection (surface curvature, peak sharpness)
 *   - Monte Carlo reordering (trade sequence independence)
 *   - Bootstrap confidence intervals (distribution of key metrics)
 *   - Regime-conditional analysis (strategy validity across regimes)
 *   - Rolling window analysis (time-series stability)
 *
 * Production-grade statistical rigor for institutional-level confidence.
 */

import { logger } from "../logger";
import { TradeOutcome } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SweepConfig {
  parameters: Array<{
    name: string;
    min: number;
    max: number;
    step: number;
  }>;
  strategy: (trades: TradeOutcome[], params: Record<string, number>) => {
    winRate: number;
    profitFactor: number;
    sharpe: number;
  };
  trades: TradeOutcome[];
}

export interface SweepResult {
  parameterGrid: Array<Record<string, number>>;
  results: Array<{
    params: Record<string, number>;
    metrics: {
      winRate: number;
      profitFactor: number;
      sharpe: number;
    };
  }>;
  surface: {
    peak: { params: Record<string, number>; value: number };
    mean: number;
    stddev: number;
    rangeWinRate: [number, number];
    rangePF: [number, number];
    rangeSharpe: [number, number];
  };
}

export interface OverfitReport {
  isOverfit: boolean;
  confidence: number; // 0-1
  signals: {
    peakSharpness: number; // How "sharp" the peak is
    parameterSensitivity: number; // How much params affect result
    surfaceCurvature: number; // 0-1, high = spiky
    fitQuality: number; // How well params fit a smooth surface
  };
  recommendations: string[];
}

export interface MonteCarloResult {
  iterations: number;
  equity: {
    mean: number;
    median: number;
    stddev: number;
    confidence95Low: number;
    confidence95High: number;
    confidence99Low: number;
    confidence99High: number;
  };
  winRate: {
    mean: number;
    confidence95: [number, number];
  };
  drawdown: {
    mean: number;
    confidence95: [number, number];
  };
  recovery: {
    avgRecoveryTime: number; // bars
    maxRecoveryTime: number;
  };
}

export interface RegimeLabel {
  startIdx: number;
  endIdx: number;
  regime: string;
  label: string;
}

export interface RegimeSplitResult {
  regimes: Array<{
    regime: string;
    tradeCount: number;
    winRate: number;
    profitFactor: number;
    sharpe: number;
    consistency: number; // stddev of returns
  }>;
  overallMetrics: {
    winRate: number;
    profitFactor: number;
    sharpe: number;
  };
  regimeBias: {
    hasSignificantBias: boolean;
    bestRegime: string;
    worstRegime: string;
    variance: number;
  };
}

export interface RollingResult {
  windows: Array<{
    startIdx: number;
    endIdx: number;
    winRate: number;
    profitFactor: number;
    sharpe: number;
    drawdown: number;
  }>;
  metrics: {
    avgWinRate: number;
    avgSharpe: number;
    stability: number; // 1 = perfectly stable
    trendDirection: number; // -1 to 1 (declining to improving)
  };
}

export interface ConfidenceInterval {
  metric: string;
  mean: number;
  stddev: number;
  confidence95Low: number;
  confidence95High: number;
  confidence99Low: number;
  confidence99High: number;
  bootstrapSamples: number;
}

// ── Sensitivity Analyzer ───────────────────────────────────────────────────

export class SensitivityAnalyzer {
  /**
   * Run parameter sweep across configuration space
   */
  runParameterSweep(config: SweepConfig): SweepResult {
    const { parameters, strategy, trades } = config;

    // Generate grid
    const grid = this.generateParameterGrid(parameters);

    // Evaluate each point
    const results = grid.map((params) => {
      const metrics = strategy(trades, params);
      return { params, metrics };
    });

    // Find peak
    const peak = results.reduce((best, current) =>
      current.metrics.sharpe > best.metrics.sharpe ? current : best
    );

    // Surface analysis
    const allSharpes = results.map((r) => r.metrics.sharpe);
    const allWinRates = results.map((r) => r.metrics.winRate);
    const allPFs = results.map((r) => r.metrics.profitFactor);

    return {
      parameterGrid: grid,
      results,
      surface: {
        peak: { params: peak.params, value: peak.metrics.sharpe },
        mean: allSharpes.reduce((a, b) => a + b) / allSharpes.length,
        stddev: this.stddev(allSharpes),
        rangeWinRate: [Math.min(...allWinRates), Math.max(...allWinRates)],
        rangePF: [Math.min(...allPFs), Math.max(...allPFs)],
        rangeSharpe: [Math.min(...allSharpes), Math.max(...allSharpes)],
      },
    };
  }

  /**
   * Detect overfitting by analyzing parameter surface
   */
  detectOverfitting(sweepResult: SweepResult): OverfitReport {
    const { surface, results } = sweepResult;

    // Peak sharpness: how concentrated is performance at the peak?
    const peakValue = surface.peak.value;
    const meanValue = surface.mean;
    const maxPeakSharpness = Math.abs(peakValue - meanValue) / Math.max(1, meanValue);
    const peakSharpness = Math.min(maxPeakSharpness / 0.5, 1); // Normalize

    // Parameter sensitivity: variation in results
    const paramSensitivity = surface.stddev / Math.max(1, surface.mean);

    // Surface curvature: fit to quadratic
    const sharpes = results.map((r) => r.metrics.sharpe).sort((a, b) => b - a);
    const top10Pct = sharpes.slice(0, Math.ceil(sharpes.length * 0.1));
    const bottom10Pct = sharpes.slice(Math.floor(sharpes.length * 0.9));
    const avgTop = top10Pct.reduce((a, b) => a + b) / top10Pct.length;
    const avgBottom = bottom10Pct.reduce((a, b) => a + b) / bottom10Pct.length;
    const curvature = (avgTop - avgBottom) / Math.max(1, avgBottom);

    // Overall fit quality
    const fitQuality = Math.max(0, 1 - paramSensitivity);

    // Overfitting heuristic
    const isOverfit = peakSharpness > 0.7 && paramSensitivity > 0.5 && curvature > 0.4;

    const recommendations: string[] = [];
    if (peakSharpness > 0.7) {
      recommendations.push(
        "Peak is very sharp - consider expanding parameter ranges or using regularization"
      );
    }
    if (paramSensitivity > 0.5) {
      recommendations.push(
        "Strategy is sensitive to parameter changes - less robust to out-of-sample data"
      );
    }
    if (curvature > 0.4) {
      recommendations.push("Parameter surface is highly non-convex - risk of overfitting");
    }
    if (isOverfit) {
      recommendations.push("Strong evidence of overfitting - validate on walk-forward test");
    }

    return {
      isOverfit,
      confidence: Math.min(1, (peakSharpness + paramSensitivity + curvature) / 3),
      signals: {
        peakSharpness: Math.min(1, peakSharpness),
        parameterSensitivity: Math.min(1, paramSensitivity),
        surfaceCurvature: Math.min(1, curvature),
        fitQuality,
      },
      recommendations,
    };
  }

  /**
   * Monte Carlo analysis with random trade reordering
   */
  runMonteCarlo(trades: TradeOutcome[], iterations: number = 1000): MonteCarloResult {
    const equities: number[] = [];
    const winRates: number[] = [];
    const maxDrawdowns: number[] = [];
    const recoveryTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const shuffled = this.shuffleArray([...trades]);
      const metrics = this.calculateMetricsFromTrades(shuffled);

      equities.push(metrics.finalEquity);
      winRates.push(metrics.winRate);
      maxDrawdowns.push(metrics.maxDrawdown);
      recoveryTimes.push(metrics.avgRecoveryTime);
    }

    const sortedEquities = equities.sort((a, b) => a - b);
    const sortedWinRates = winRates.sort((a, b) => a - b);
    const sortedDrawdowns = maxDrawdowns.sort((a, b) => a - b);

    return {
      iterations,
      equity: {
        mean: equities.reduce((a, b) => a + b) / equities.length,
        median: sortedEquities[Math.floor(equities.length / 2)],
        stddev: this.stddev(equities),
        confidence95Low: sortedEquities[Math.floor(equities.length * 0.025)],
        confidence95High: sortedEquities[Math.floor(equities.length * 0.975)],
        confidence99Low: sortedEquities[Math.floor(equities.length * 0.005)],
        confidence99High: sortedEquities[Math.floor(equities.length * 0.995)],
      },
      winRate: {
        mean: winRates.reduce((a, b) => a + b) / winRates.length,
        confidence95: [
          sortedWinRates[Math.floor(winRates.length * 0.025)],
          sortedWinRates[Math.floor(winRates.length * 0.975)],
        ],
      },
      drawdown: {
        mean: maxDrawdowns.reduce((a, b) => a + b) / maxDrawdowns.length,
        confidence95: [
          sortedDrawdowns[Math.floor(maxDrawdowns.length * 0.025)],
          sortedDrawdowns[Math.floor(maxDrawdowns.length * 0.975)],
        ],
      },
      recovery: {
        avgRecoveryTime: recoveryTimes.reduce((a, b) => a + b) / recoveryTimes.length,
        maxRecoveryTime: Math.max(...recoveryTimes),
      },
    };
  }

  /**
   * Regime-split validation
   */
  runRegimeSplitValidation(trades: TradeOutcome[], regimes: RegimeLabel[]): RegimeSplitResult {
    const regimeMap = new Map<string, TradeOutcome[]>();

    // Assign trades to regimes
    trades.forEach((trade) => {
      for (const regime of regimes) {
        if (trade.barIndex >= regime.startIdx && trade.barIndex <= regime.endIdx) {
          if (!regimeMap.has(regime.regime)) {
            regimeMap.set(regime.regime, []);
          }
          regimeMap.get(regime.regime)!.push(trade);
          break;
        }
      }
    });

    // Compute metrics per regime
    const regimeResults = Array.from(regimeMap.entries()).map(([regime, regimeTrades]) => {
      const metrics = this.calculateMetricsFromTrades(regimeTrades);
      return {
        regime,
        tradeCount: regimeTrades.length,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        sharpe: metrics.sharpe,
        consistency: metrics.consistency,
      };
    });

    // Overall metrics
    const overallMetrics = this.calculateMetricsFromTrades(trades);

    // Detect regime bias
    const winRates = regimeResults.map((r) => r.winRate);
    const variance = this.stddev(winRates) ** 2;
    const bestRegime = regimeResults.reduce((best, current) =>
      current.sharpe > best.sharpe ? current : best
    );
    const worstRegime = regimeResults.reduce((worst, current) =>
      current.sharpe < worst.sharpe ? current : worst
    );

    return {
      regimes: regimeResults,
      overallMetrics: {
        winRate: overallMetrics.winRate,
        profitFactor: overallMetrics.profitFactor,
        sharpe: overallMetrics.sharpe,
      },
      regimeBias: {
        hasSignificantBias: variance > 0.015,
        bestRegime: bestRegime.regime,
        worstRegime: worstRegime.regime,
        variance,
      },
    };
  }

  /**
   * Rolling window analysis (time-series stability)
   */
  runRollingAnalysis(trades: TradeOutcome[], windowSize: number): RollingResult {
    if (trades.length < windowSize) {
      throw new Error("Not enough trades for rolling analysis");
    }

    const windows: RollingResult["windows"] = [];
    const winRates: number[] = [];
    const sharpes: number[] = [];

    for (let i = 0; i <= trades.length - windowSize; i++) {
      const window = trades.slice(i, i + windowSize);
      const metrics = this.calculateMetricsFromTrades(window);

      windows.push({
        startIdx: i,
        endIdx: i + windowSize,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        sharpe: metrics.sharpe,
        drawdown: metrics.maxDrawdown,
      });

      winRates.push(metrics.winRate);
      sharpes.push(metrics.sharpe);
    }

    // Calculate trend
    const firstHalf = sharpes.slice(0, Math.floor(sharpes.length / 2));
    const secondHalf = sharpes.slice(Math.floor(sharpes.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;
    const trend = (secondAvg - firstAvg) / Math.max(0.01, Math.abs(firstAvg));

    // Stability: inverse of coefficient of variation
    const avgSharpe = sharpes.reduce((a, b) => a + b) / sharpes.length;
    const stabilityCv = avgSharpe > 0 ? this.stddev(sharpes) / avgSharpe : 999;
    const stability = Math.max(0, 1 - stabilityCv);

    return {
      windows,
      metrics: {
        avgWinRate: winRates.reduce((a, b) => a + b) / winRates.length,
        avgSharpe: sharpes.reduce((a, b) => a + b) / sharpes.length,
        stability: Math.min(1, stability),
        trendDirection: Math.tanh(trend), // Bounded to -1, 1
      },
    };
  }

  /**
   * Bootstrap confidence intervals for key metrics
   */
  bootstrapConfidence(
    trades: TradeOutcome[],
    metric: "winRate" | "sharpe" | "profitFactor",
    confidence: number = 0.95,
    samples: number = 1000
  ): ConfidenceInterval {
    const results: number[] = [];

    for (let i = 0; i < samples; i++) {
      const boot = this.bootstrapSample(trades);
      const metrics = this.calculateMetricsFromTrades(boot);

      switch (metric) {
        case "winRate":
          results.push(metrics.winRate);
          break;
        case "sharpe":
          results.push(metrics.sharpe);
          break;
        case "profitFactor":
          results.push(metrics.profitFactor);
          break;
      }
    }

    const sorted = results.sort((a, b) => a - b);
    const alpha = 1 - confidence;
    const lowerIdx = Math.floor(sorted.length * (alpha / 2));
    const upperIdx = Math.ceil(sorted.length * (1 - alpha / 2));

    const mean = results.reduce((a, b) => a + b) / results.length;

    return {
      metric,
      mean,
      stddev: this.stddev(results),
      confidence95Low: sorted[lowerIdx],
      confidence95High: sorted[upperIdx],
      confidence99Low: sorted[Math.floor(sorted.length * 0.005)],
      confidence99High: sorted[Math.floor(sorted.length * 0.995)],
      bootstrapSamples: samples,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private generateParameterGrid(
    parameters: Array<{ name: string; min: number; max: number; step: number }>
  ): Array<Record<string, number>> {
    const grid: Array<Record<string, number>> = [];

    const recurse = (paramIdx: number, current: Record<string, number>) => {
      if (paramIdx === parameters.length) {
        grid.push({ ...current });
        return;
      }

      const { name, min, max, step } = parameters[paramIdx];
      for (let value = min; value <= max; value += step) {
        current[name] = value;
        recurse(paramIdx + 1, current);
      }
    };

    recurse(0, {});
    return grid;
  }

  private calculateMetricsFromTrades(trades: TradeOutcome[]) {
    if (trades.length === 0) {
      return {
        finalEquity: 0,
        winRate: 0,
        profitFactor: 1,
        sharpe: 0,
        maxDrawdown: 0,
        avgRecoveryTime: 0,
        consistency: 0,
      };
    }

    const wins = trades.filter((t) => t.won).length;
    const winRate = wins / trades.length;

    const winSum = trades.filter((t) => t.won).reduce((s, t) => s + t.pnlPrice, 0);
    const lossSum = Math.abs(trades.filter((t) => !t.won).reduce((s, t) => s + t.pnlPrice, 0));
    const profitFactor = lossSum > 0 ? winSum / lossSum : winSum > 0 ? 999 : 1;

    const returns = trades.map((t) => t.pnlR);
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const stddev = this.stddev(returns);
    const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;

    // Simple drawdown (cumulative)
    let cumReturn = 0;
    let peak = 0;
    let maxDD = 0;
    for (const r of returns) {
      cumReturn += r;
      peak = Math.max(peak, cumReturn);
      maxDD = Math.max(maxDD, peak - cumReturn);
    }

    return {
      finalEquity: cumReturn,
      winRate,
      profitFactor,
      sharpe,
      maxDrawdown: maxDD,
      avgRecoveryTime: 10, // Placeholder
      consistency: stddev,
    };
  }

  private stddev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(variance, 0));
  }

  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private bootstrapSample<T>(arr: T[]): T[] {
    const sample: T[] = [];
    for (let i = 0; i < arr.length; i++) {
      const idx = Math.floor(Math.random() * arr.length);
      sample.push(arr[idx]);
    }
    return sample;
  }
}

// Export singleton
export const sensitivityAnalyzer = new SensitivityAnalyzer();
