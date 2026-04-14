/**
 * parameter_tuner.ts — Strategy Parameter Optimization Engine
 *
 * Automated parameter search and optimization:
 *   - Grid search over parameter combinations
 *   - Configurable ranges and step sizes
 *   - Multiple optimization targets (Sharpe, profit factor, win rate, expectancy)
 *   - Walk-forward optimization (in-sample training, out-of-sample validation)
 *   - Overfitting detection (IS vs OOS gap analysis)
 *   - Top-N parameter sets with ranking
 *   - Sensitivity analysis (robustness to parameter changes)
 *
 * Designed for finding robust, generalizable parameter sets.
 */

import { logger } from "../logger";
import { QuantMetrics } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

/** Parameter range definition */
export interface ParameterRange {
  name: string;
  min: number;
  max: number;
  step: number;
}

/** Parameter set for testing */
export interface ParameterSet {
  [key: string]: number;
}

/** Result of parameter tuning */
export interface TuningResult {
  parameterSet: ParameterSet;
  metrics: QuantMetrics;
  rank: number;
  score: number;
}

/** Walk-forward optimization result */
export interface WalkForwardResult {
  inSampleMetrics: QuantMetrics;
  outOfSampleMetrics: QuantMetrics;
  isScore: number;
  oosScore: number;
  overfittingGap: number;
  robust: boolean;
}

/** Sensitivity analysis result */
export interface SensitivityAnalysis {
  baselineScore: number;
  variations: Array<{
    parameterName: string;
    value: number;
    score: number;
    sensitivity: number;
  }>;
  averageSensitivity: number;
  mostSensitiveParameter: string;
}

// ── Optimization Target Scoring ────────────────────────────────────────────

function scoreMetrics(
  metrics: QuantMetrics,
  target: "sharpe" | "profit_factor" | "win_rate" | "expectancy",
): number {
  switch (target) {
    case "sharpe":
      return metrics.sharpeRatio;
    case "profit_factor":
      return metrics.profitFactor;
    case "win_rate":
      return metrics.winRate * 100;
    case "expectancy":
      return metrics.expectancy;
    default:
      return 0;
  }
}

// ── Parameter Tuner ───────────────────────────────────────────────────────

export class ParameterTuner {
  /**
   * Generate all parameter combinations for grid search
   */
  generateGrid(ranges: ParameterRange[]): ParameterSet[] {
    if (ranges.length === 0) return [];

    const combinations: ParameterSet[] = [];
    const indices: number[] = new Array(ranges.length).fill(0);

    while (true) {
      const params: ParameterSet = {};
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        const count = Math.floor((range.max - range.min) / range.step) + 1;
        const value = range.min + indices[i] * range.step;
        params[range.name] = Math.min(value, range.max);
      }
      combinations.push(params);

      let carry = 1;
      for (let i = ranges.length - 1; i >= 0 && carry; i--) {
        const range = ranges[i];
        const count = Math.floor((range.max - range.min) / range.step) + 1;
        indices[i] += carry;
        if (indices[i] >= count) {
          indices[i] = 0;
        } else {
          carry = 0;
        }
      }

      if (carry === 1) break;
    }

    return combinations;
  }

  /**
   * Rank parameter sets by backtest results
   */
  rankParameterSets(
    results: Array<{ parameterSet: ParameterSet; metrics: QuantMetrics }>,
    target: "sharpe" | "profit_factor" | "win_rate" | "expectancy",
  ): TuningResult[] {
    const scored = results.map(({ parameterSet, metrics }) => ({
      parameterSet,
      metrics,
      score: scoreMetrics(metrics, target),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
  }

  /**
   * Get top N parameter sets
   */
  getTopParameterSets(
    results: TuningResult[],
    n: number = 10,
  ): TuningResult[] {
    return results.slice(0, n);
  }

  /**
   * Walk-forward optimization: train on window, validate on next window
   */
  walkForwardOptimization(
    allResults: Array<{
      parameterSet: ParameterSet;
      metrics: QuantMetrics;
      timestamp: string;
    }>,
    trainingWindowSize: number,
    testWindowSize: number,
    target: "sharpe" | "profit_factor" | "win_rate" | "expectancy" = "sharpe",
  ): WalkForwardResult[] {
    allResults.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const results: WalkForwardResult[] = [];
    const totalBars = allResults.length;

    for (
      let trainStart = 0;
      trainStart + trainingWindowSize + testWindowSize <= totalBars;
      trainStart += testWindowSize
    ) {
      const trainEnd = trainStart + trainingWindowSize;
      const testEnd = Math.min(trainEnd + testWindowSize, totalBars);

      const trainingData = allResults.slice(trainStart, trainEnd);
      if (trainingData.length === 0) continue;

      const inSampleMetrics = trainingData.reduce((best, current) => {
        const currentScore = scoreMetrics(current.metrics, target);
        const bestScore = scoreMetrics(best.metrics, target);
        return currentScore > bestScore ? current : best;
      }).metrics;

      const testingData = allResults.slice(trainEnd, testEnd);
      if (testingData.length === 0) continue;

      const outOfSampleMetrics = testingData.reduce((best, current) => {
        const currentScore = scoreMetrics(current.metrics, target);
        const bestScore = scoreMetrics(best.metrics, target);
        return currentScore > bestScore ? current : best;
      }).metrics;

      const isScore = scoreMetrics(inSampleMetrics, target);
      const oosScore = scoreMetrics(outOfSampleMetrics, target);
      const overfittingGap = Math.abs(isScore - oosScore) / Math.max(Math.abs(isScore), 1);

      const robust = overfittingGap < 0.15;

      results.push({
        inSampleMetrics,
        outOfSampleMetrics,
        isScore,
        oosScore,
        overfittingGap,
        robust,
      });
    }

    logger.info(
      { windowCount: results.length, robustCount: results.filter((r) => r.robust).length },
      "Walk-forward optimization completed",
    );

    return results;
  }

  /**
   * Analyze sensitivity of metrics to parameter changes
   */
  sensitivityAnalysis(
    baselineResult: { parameterSet: ParameterSet; metrics: QuantMetrics },
    variations: Array<{
      parameterSet: ParameterSet;
      metrics: QuantMetrics;
    }>,
    target: "sharpe" | "profit_factor" | "win_rate" | "expectancy",
  ): SensitivityAnalysis {
    const baselineScore = scoreMetrics(baselineResult.metrics, target);

    const sensitivityData: Array<{
      parameterName: string;
      value: number;
      score: number;
      sensitivity: number;
    }> = [];

    for (const variation of variations) {
      for (const [paramName, paramValue] of Object.entries(variation.parameterSet)) {
        const baselineValue = baselineResult.parameterSet[paramName];
        if (baselineValue === undefined) continue;

        const score = scoreMetrics(variation.metrics, target);
        const valueDelta = Math.abs(paramValue - baselineValue);
        const scoreDelta = Math.abs(score - baselineScore);

        const sensitivity = valueDelta > 0 ? scoreDelta / valueDelta : 0;

        sensitivityData.push({
          parameterName: paramName,
          value: paramValue,
          score,
          sensitivity,
        });
      }
    }

    const paramSensitivities = new Map<string, number[]>();
    for (const item of sensitivityData) {
      if (!paramSensitivities.has(item.parameterName)) {
        paramSensitivities.set(item.parameterName, []);
      }
      paramSensitivities.get(item.parameterName)!.push(item.sensitivity);
    }

    const averagedSensitivities: Array<{
      parameterName: string;
      value: number;
      score: number;
      sensitivity: number;
    }> = [];

    for (const [paramName, sensitivities] of paramSensitivities.entries()) {
      const avgSensitivity = sensitivities.reduce((a, b) => a + b, 0) / sensitivities.length;
      const relevantData = sensitivityData.find((d) => d.parameterName === paramName);
      if (relevantData) {
        averagedSensitivities.push({
          parameterName: paramName,
          value: relevantData.value,
          score: relevantData.score,
          sensitivity: avgSensitivity,
        });
      }
    }

    averagedSensitivities.sort((a, b) => b.sensitivity - a.sensitivity);

    const avgSensitivity =
      sensitivityData.length > 0
        ? sensitivityData.reduce((sum, d) => sum + d.sensitivity, 0) / sensitivityData.length
        : 0;

    const mostSensitiveParameter =
      averagedSensitivities.length > 0 ? averagedSensitivities[0].parameterName : "none";

    logger.info(
      { mostSensitiveParameter, avgSensitivity: avgSensitivity.toFixed(4) },
      "Sensitivity analysis complete",
    );

    return {
      baselineScore,
      variations: averagedSensitivities,
      averageSensitivity: avgSensitivity,
      mostSensitiveParameter,
    };
  }

  /**
   * Detect overfitting indicators
   */
  detectOverfitting(
    isMetrics: QuantMetrics,
    oosMetrics: QuantMetrics,
    target: "sharpe" | "profit_factor" | "win_rate" | "expectancy" = "sharpe",
  ): {
    overfit: boolean;
    gap: number;
    severity: "none" | "mild" | "moderate" | "severe";
    recommendation: string;
  } {
    const isScore = scoreMetrics(isMetrics, target);
    const oosScore = scoreMetrics(oosMetrics, target);

    const gap = Math.abs(isScore - oosScore) / Math.max(Math.abs(isScore), 1);

    let severity: "none" | "mild" | "moderate" | "severe";
    if (gap < 0.1) {
      severity = "none";
    } else if (gap < 0.2) {
      severity = "mild";
    } else if (gap < 0.4) {
      severity = "moderate";
    } else {
      severity = "severe";
    }

    const overfit = gap > 0.15;

    let recommendation = "";
    if (overfit) {
      if (severity === "mild") {
        recommendation =
          "Acceptable fit. Monitor for stability but may be ready for live trading.";
      } else if (severity === "moderate") {
        recommendation =
          "Significant overfitting detected. Reduce parameters or expand training window.";
      } else {
        recommendation =
          "Severe overfitting. Simplify strategy or add constraints to prevent curve-fitting.";
      }
    } else {
      recommendation = "Strong out-of-sample performance. Parameters are robust.";
    }

    return {
      overfit,
      gap: Math.round(gap * 10000) / 100,
      severity,
      recommendation,
    };
  }

  /**
   * Generate report on parameter tuning results
   */
  generateTuningReport(
    rankedResults: TuningResult[],
    walkForwardResults: WalkForwardResult[],
  ): string {
    const topParams = rankedResults.slice(0, 5);
    const robustWF = walkForwardResults.filter((r) => r.robust);

    let report = "=== PARAMETER TUNING REPORT ===\n\n";

    report += `Total Parameter Sets Tested: ${rankedResults.length}\n`;
    report += `Top 5 Results:\n`;

    for (const result of topParams) {
      report += `  Rank ${result.rank}: Score ${result.score.toFixed(4)}\n`;
      report += `    Parameters: ${JSON.stringify(result.parameterSet)}\n`;
    }

    report += `\nWalk-Forward Analysis:\n`;
    report += `  Total Windows: ${walkForwardResults.length}\n`;
    report += `  Robust Windows: ${robustWF.length} (${((robustWF.length / walkForwardResults.length) * 100).toFixed(1)}%)\n`;

    if (robustWF.length > 0) {
      const avgGap =
        robustWF.reduce((s, r) => s + r.overfittingGap, 0) / robustWF.length;
      report += `  Average Overfitting Gap: ${(avgGap * 100).toFixed(2)}%\n`;
    }

    return report;
  }
}

// Export singleton
export const parameterTuner = new ParameterTuner();
