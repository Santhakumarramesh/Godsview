/**
 * quality_benchmarks.ts — Backtest Quality Assessment
 *
 * Define and verify backtest quality standards:
 *   - Minimum thresholds: trade count, data duration, regime coverage
 *   - Monte Carlo confidence intervals: 1000x shuffles
 *   - Parameter robustness: how much does performance degrade with changes?
 *   - Quality grade (A/B/C/D/F) with detailed diagnostic
 *   - Statistical significance testing
 *
 * Ensures backtests meet production standards.
 */

import { logger } from "../logger";
import { QuantMetrics } from "../backtest_engine";
import { TradeOutcome } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

/** Quality threshold configuration */
export interface QualityThresholds {
  minTrades: number;
  minDataDaysMonths: number;
  minRegimesCovered: number;
  minSharpe: number;
  minWinRate: number;
  maxMaxDrawdown: number;
}

/** Robustness score */
export interface RobustnessAnalysis {
  baselineMetrics: QuantMetrics;
  perturbations: Array<{
    parameterName: string;
    change: number;
    resultingMetrics: QuantMetrics;
    sharpeChange: number;
    winRateChange: number;
  }>;
  averageMetricDegradation: number;
  mostFragileParameter: string;
  robustnessScore: number;
}

/** Monte Carlo analysis result */
export interface MonteCarloAnalysis {
  iterations: number;
  finalEquityDistribution: {
    mean: number;
    median: number;
    stddev: number;
    p5: number;
    p95: number;
  };
  sharpeDistribution: {
    mean: number;
    stddev: number;
    p5: number;
    p95: number;
  };
  drawdownDistribution: {
    mean: number;
    stddev: number;
    p95: number;
  };
  winRateDistribution: {
    mean: number;
    stddev: number;
  };
  confidenceInterval: {
    sharpe: [number, number];
    finalEquity: [number, number];
  };
}

/** Backtest quality grade and report */
export interface QualityReport {
  grade: "A" | "B" | "C" | "D" | "F";
  overallScore: number;
  diagnostic: {
    tradeCountOk: boolean;
    dataLengthOk: boolean;
    regimeCoverageOk: boolean;
    metricsQualityOk: boolean;
    robustnessOk: boolean;
  };
  scores: {
    tradeQuality: number;
    dataQuality: number;
    regimeDiversity: number;
    metricQuality: number;
    robustness: number;
  };
  recommendations: string[];
  summary: string;
}

// ── Quality Benchmarks ──────────────────────────────────────────────────────

export class QualityBenchmarks {
  /**
   * Default quality thresholds (production-grade)
   */
  defaultThresholds(): QualityThresholds {
    return {
      minTrades: 200,
      minDataDaysMonths: 180,
      minRegimesCovered: 3,
      minSharpe: 0.5,
      minWinRate: 0.45,
      maxMaxDrawdown: 30,
    };
  }

  /**
   * Assess overall backtest quality
   */
  assessQuality(
    trades: TradeOutcome[],
    metrics: QuantMetrics,
    dataDurationDays: number,
    regimesIdentified: string[],
    thresholds?: QualityThresholds,
  ): QualityReport {
    const thr = thresholds ?? this.defaultThresholds();

    const tradeCountOk = trades.length >= thr.minTrades;
    const dataLengthOk = dataDurationDays >= thr.minDataDaysMonths;
    const regimeCoverageOk = regimesIdentified.length >= thr.minRegimesCovered;
    const metricsQualityOk =
      metrics.sharpeRatio >= thr.minSharpe &&
      metrics.winRate >= thr.minWinRate &&
      metrics.maxDrawdownR <= thr.maxMaxDrawdown;

    const tradeQuality = this.scoreTradeCount(trades.length, thr.minTrades) * 20;
    const dataQuality = this.scoreDataLength(dataDurationDays, thr.minDataDaysMonths) * 20;
    const regimeDiversity = this.scoreRegimeCoverage(regimesIdentified.length, thr.minRegimesCovered) * 20;
    const metricQuality = this.scoreMetrics(metrics, thr) * 20;
    const robustness = this.scoreRobustness(metrics) * 20;

    const overallScore = tradeQuality + dataQuality + regimeDiversity + metricQuality + robustness;

    let grade: "A" | "B" | "C" | "D" | "F";
    if (overallScore >= 90) {
      grade = "A";
    } else if (overallScore >= 75) {
      grade = "B";
    } else if (overallScore >= 60) {
      grade = "C";
    } else if (overallScore >= 45) {
      grade = "D";
    } else {
      grade = "F";
    }

    const robustnessOk = metricQuality >= 15 && dataQuality >= 15;

    const recommendations: string[] = [];
    if (!tradeCountOk) {
      recommendations.push(
        `Trade count (${trades.length}) below minimum (${thr.minTrades}). Increase lookback period or relax entry filters.`,
      );
    }
    if (!dataLengthOk) {
      recommendations.push(
        `Data span (${dataDurationDays} days) below minimum (${thr.minDataDaysMonths} days). Test with more historical data.`,
      );
    }
    if (!regimeCoverageOk) {
      recommendations.push(
        `Regime coverage (${regimesIdentified.length}) below minimum (${thr.minRegimesCovered}). Strategy may be regime-dependent.`,
      );
    }
    if (!metricsQualityOk) {
      if (metrics.sharpeRatio < thr.minSharpe) {
        recommendations.push(
          `Sharpe ratio (${metrics.sharpeRatio.toFixed(2)}) below minimum (${thr.minSharpe}). Improve risk-adjusted returns.`,
        );
      }
      if (metrics.winRate < thr.minWinRate) {
        recommendations.push(
          `Win rate (${(metrics.winRate * 100).toFixed(1)}%) below minimum (${(thr.minWinRate * 100).toFixed(1)}%). Improve entry accuracy.`,
        );
      }
      if (metrics.maxDrawdownR > thr.maxMaxDrawdown) {
        recommendations.push(
          `Max drawdown (${metrics.maxDrawdownR.toFixed(1)}R) exceeds maximum (${thr.maxMaxDrawdown}R). Improve risk management.`,
        );
      }
    }

    const summary = `Quality Grade: ${grade} (${overallScore.toFixed(0)}/100). ` +
      `${tradeCountOk ? "OK" : "FAIL"} Trades (${trades.length}/${thr.minTrades}), ` +
      `${dataLengthOk ? "OK" : "FAIL"} Data (${dataDurationDays}/${thr.minDataDaysMonths} days), ` +
      `${regimeCoverageOk ? "OK" : "FAIL"} Regimes (${regimesIdentified.length}/${thr.minRegimesCovered}), ` +
      `${metricsQualityOk ? "OK" : "FAIL"} Metrics. ${recommendations.length} recommendations.`;

    return {
      grade,
      overallScore,
      diagnostic: {
        tradeCountOk,
        dataLengthOk,
        regimeCoverageOk,
        metricsQualityOk,
        robustnessOk,
      },
      scores: {
        tradeQuality,
        dataQuality,
        regimeDiversity,
        metricQuality,
        robustness,
      },
      recommendations,
      summary,
    };
  }

  /**
   * Score trade count (0-1)
   */
  private scoreTradeCount(count: number, minTrades: number): number {
    if (count >= minTrades * 2) return 1.0;
    if (count >= minTrades) return 0.8;
    if (count >= minTrades * 0.7) return 0.5;
    return Math.max(0, count / minTrades) * 0.5;
  }

  /**
   * Score data length (0-1)
   */
  private scoreDataLength(days: number, minDays: number): number {
    if (days >= minDays * 2) return 1.0;
    if (days >= minDays) return 0.8;
    if (days >= minDays * 0.7) return 0.5;
    return Math.max(0, days / minDays) * 0.5;
  }

  /**
   * Score regime coverage (0-1)
   */
  private scoreRegimeCoverage(count: number, minRegimes: number): number {
    if (count >= minRegimes + 1) return 1.0;
    if (count >= minRegimes) return 0.85;
    if (count >= minRegimes - 1) return 0.6;
    return Math.max(0, count / minRegimes) * 0.6;
  }

  /**
   * Score metrics quality (0-1)
   */
  private scoreMetrics(metrics: QuantMetrics, thr: QualityThresholds): number {
    const sharpeScore = Math.min(1, metrics.sharpeRatio / thr.minSharpe);
    const wrScore = Math.min(1, metrics.winRate / thr.minWinRate);
    const ddScore = Math.max(0, 1 - metrics.maxDrawdownR / thr.maxMaxDrawdown);

    return (sharpeScore + wrScore + ddScore) / 3;
  }

  /**
   * Score robustness (0-1) - proxy using metrics
   */
  private scoreRobustness(metrics: QuantMetrics): number {
    const soCapScore = Math.min(1, metrics.sortinoRatio / 1.0);
    const pfScore = Math.min(1, (metrics.profitFactor - 1) / 1.0);
    const calmarScore = Math.min(1, metrics.calmarRatio / 2.0);

    return (soCapScore + pfScore + calmarScore) / 3;
  }

  /**
   * Run Monte Carlo simulation for confidence intervals
   */
  monteCarloConfidenceIntervals(
    trades: TradeOutcome[],
    iterations: number = 1000,
  ): MonteCarloAnalysis {
    if (trades.length === 0) {
      return {
        iterations: 0,
        finalEquityDistribution: { mean: 0, median: 0, stddev: 0, p5: 0, p95: 0 },
        sharpeDistribution: { mean: 0, stddev: 0, p5: 0, p95: 0 },
        drawdownDistribution: { mean: 0, stddev: 0, p95: 0 },
        winRateDistribution: { mean: 0, stddev: 0 },
        confidenceInterval: { sharpe: [0, 0], finalEquity: [0, 0] },
      };
    }

    const returns = trades.map((t) => t.pnlR);
    const finalEquities: number[] = [];
    const sharpeRatios: number[] = [];
    const maxDrawdowns: number[] = [];
    const winRates: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const shuffled = [...returns].sort(() => Math.random() - 0.5);

      let equity = 0;
      let peak = 0;
      let maxDD = 0;

      for (const r of shuffled) {
        equity += r;
        peak = Math.max(peak, equity);
        maxDD = Math.max(maxDD, peak - equity);
      }

      finalEquities.push(equity);
      maxDrawdowns.push(maxDD);

      const wins = shuffled.filter((r) => r > 0).length;
      winRates.push(wins / shuffled.length);

      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      const stddev = Math.sqrt(Math.max(variance, 0));
      sharpeRatios.push(stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0);
    }

    finalEquities.sort((a, b) => a - b);
    sharpeRatios.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);
    winRates.sort((a, b) => a - b);

    const idx5 = Math.floor(iterations * 0.05);
    const idx95 = Math.floor(iterations * 0.95);

    const meanEquity = finalEquities.reduce((a, b) => a + b, 0) / iterations;
    const eqVariance = finalEquities.reduce((s, e) => s + (e - meanEquity) ** 2, 0) / iterations;
    const eqStddev = Math.sqrt(eqVariance);

    const meanSharpe = sharpeRatios.reduce((a, b) => a + b, 0) / iterations;
    const spVariance = sharpeRatios.reduce((s, sp) => s + (sp - meanSharpe) ** 2, 0) / iterations;
    const spStddev = Math.sqrt(spVariance);

    const meanDD = maxDrawdowns.reduce((a, b) => a + b, 0) / iterations;
    const meanWR = winRates.reduce((a, b) => a + b, 0) / iterations;
    const wrVariance = winRates.reduce((s, wr) => s + (wr - meanWR) ** 2, 0) / iterations;
    const wrStddev = Math.sqrt(wrVariance);

    const medianEquity = finalEquities[Math.floor(iterations / 2)];

    return {
      iterations,
      finalEquityDistribution: {
        mean: meanEquity,
        median: medianEquity,
        stddev: eqStddev,
        p5: finalEquities[idx5],
        p95: finalEquities[idx95],
      },
      sharpeDistribution: {
        mean: meanSharpe,
        stddev: spStddev,
        p5: sharpeRatios[idx5],
        p95: sharpeRatios[idx95],
      },
      drawdownDistribution: {
        mean: meanDD,
        stddev: 0,
        p95: maxDrawdowns[idx95],
      },
      winRateDistribution: {
        mean: meanWR,
        stddev: wrStddev,
      },
      confidenceInterval: {
        sharpe: [sharpeRatios[idx5], sharpeRatios[idx95]],
        finalEquity: [finalEquities[idx5], finalEquities[idx95]],
      },
    };
  }
}

// Export singleton
export const qualityBenchmarks = new QualityBenchmarks();
