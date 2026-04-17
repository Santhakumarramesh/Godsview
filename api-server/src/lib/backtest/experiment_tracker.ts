/**
 * experiment_tracker.ts — Backtest Experiment Management
 *
 * Track, compare, and manage backtest experiments with:
 *   - Unique experiment IDs and metadata
 *   - Strategy parameters and backtesting configuration
 *   - Results storage and retrieval
 *   - Experiment tagging and categorization
 *   - Side-by-side comparison
 *   - Best experiment selection per strategy
 *   - Parameter diff analysis
 *   - Filtering, sorting, and history management
 *
 * Designed for iterative strategy optimization and learning.
 */

import { logger } from "../logger";
import { QuantMetrics } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

/** Strategy parameter configuration */
export interface StrategyParams {
  [key: string]: number | string | boolean | (number | string | boolean)[];
}

/** Complete experiment configuration and results */
export interface BacktestExperiment {
  /** Unique experiment ID (auto-generated) */
  experimentId: string;
  /** Name for easy reference */
  experimentName: string;
  /** Strategy identifier */
  strategyName: string;
  /** Parameters used in this experiment */
  params: StrategyParams;
  /** Testing date range */
  dateRange: {
    start: string;
    end: string;
  };
  /** Tested symbols */
  symbols: string[];
  /** Timeframe tested */
  timeframe: string;
  /** Complete metrics from backtest */
  metrics: QuantMetrics[];
  /** Tags for categorization */
  tags: string[];
  /** Experiment timestamp */
  createdAt: string;
  /** User notes */
  notes: string;
  /** Status of experiment */
  status: "pending" | "running" | "completed" | "failed";
  /** Error message if failed */
  errorMessage?: string;
}

/** Experiment comparison result */
export interface ExperimentComparison {
  experimentIds: string[];
  experiments: BacktestExperiment[];
  parameterDiff: Record<string, any[]>;
  metricComparison: {
    experimentId: string;
    symbol: string;
    sharpeRatio: number;
    profitFactor: number;
    winRate: number;
    expectancy: number;
    maxDrawdownR: number;
  }[];
}

// ── Experiment Tracker ─────────────────────────────────────────────────────

export class ExperimentTracker {
  private experiments: Map<string, BacktestExperiment> = new Map();
  private experimentsByStrategy: Map<string, Set<string>> = new Map();
  private experimentsByTag: Map<string, Set<string>> = new Map();

  /**
   * Create a new experiment record
   */
  createExperiment(
    strategyName: string,
    params: StrategyParams,
    dateRange: { start: string; end: string },
    symbols: string[],
    timeframe: string,
    experimentName?: string,
    notes?: string,
  ): BacktestExperiment {
    const experimentId = this.generateExperimentId(strategyName);

    const experiment: BacktestExperiment = {
      experimentId,
      experimentName: experimentName ?? `${strategyName}_${experimentId.split("_").slice(-1)[0]}`,
      strategyName,
      params: { ...params },
      dateRange,
      symbols: [...symbols],
      timeframe,
      metrics: [],
      tags: [],
      createdAt: new Date().toISOString(),
      notes: notes ?? "",
      status: "pending",
    };

    this.experiments.set(experimentId, experiment);

    // Index by strategy
    if (!this.experimentsByStrategy.has(strategyName)) {
      this.experimentsByStrategy.set(strategyName, new Set());
    }
    this.experimentsByStrategy.get(strategyName)!.add(experimentId);

    logger.info(
      { experimentId, strategyName, paramCount: Object.keys(params).length },
      "Experiment created",
    );

    return experiment;
  }

  /**
   * Add results to an experiment
   */
  addMetrics(experimentId: string, metrics: QuantMetrics | QuantMetrics[]): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      logger.warn({ experimentId }, "Experiment not found");
      return;
    }

    const metricsArray = Array.isArray(metrics) ? metrics : [metrics];
    exp.metrics.push(...metricsArray);
    exp.status = "completed";

    logger.info(
      { experimentId, metricsCount: metricsArray.length },
      "Metrics added to experiment",
    );
  }

  /**
   * Tag an experiment for organization
   */
  tagExperiment(experimentId: string, tags: string | string[]): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      logger.warn({ experimentId }, "Experiment not found");
      return;
    }

    const newTags = Array.isArray(tags) ? tags : [tags];
    for (const tag of newTags) {
      if (!exp.tags.includes(tag)) {
        exp.tags.push(tag);
      }

      if (!this.experimentsByTag.has(tag)) {
        this.experimentsByTag.set(tag, new Set());
      }
      this.experimentsByTag.get(tag)!.add(experimentId);
    }

    logger.debug({ experimentId, tags: newTags }, "Tags added");
  }

  /**
   * Get experiment by ID
   */
  getExperiment(experimentId: string): BacktestExperiment | null {
    return this.experiments.get(experimentId) ?? null;
  }

  /**
   * Get all experiments for a strategy
   */
  getExperimentsForStrategy(strategyName: string): BacktestExperiment[] {
    const ids = this.experimentsByStrategy.get(strategyName) ?? new Set();
    return Array.from(ids)
      .map((id) => this.experiments.get(id))
      .filter((exp): exp is BacktestExperiment => exp !== undefined);
  }

  /**
   * Get experiments by tag
   */
  getExperimentsByTag(tag: string): BacktestExperiment[] {
    const ids = this.experimentsByTag.get(tag) ?? new Set();
    return Array.from(ids)
      .map((id) => this.experiments.get(id))
      .filter((exp): exp is BacktestExperiment => exp !== undefined);
  }

  /**
   * Find best experiment for a strategy by metric
   */
  getBestExperiment(
    strategyName: string,
    metric: "sharpeRatio" | "profitFactor" | "winRate" | "expectancy",
    symbol?: string,
  ): BacktestExperiment | null {
    const exps = this.getExperimentsForStrategy(strategyName);
    if (exps.length === 0) return null;

    let best: BacktestExperiment | null = null;
    let bestValue = -Infinity;

    for (const exp of exps) {
      if (exp.metrics.length === 0) continue;

      for (const m of exp.metrics) {
        if (symbol && m.symbol !== symbol) continue;

        let value = 0;
        if (metric === "sharpeRatio") value = m.sharpeRatio;
        else if (metric === "profitFactor") value = m.profitFactor;
        else if (metric === "winRate") value = m.winRate;
        else if (metric === "expectancy") value = m.expectancy;

        if (value > bestValue) {
          bestValue = value;
          best = exp;
        }
      }
    }

    return best;
  }

  /**
   * Compare experiments side by side
   */
  compareExperiments(experimentIds: string[]): ExperimentComparison | null {
    const experiments = experimentIds
      .map((id) => this.experiments.get(id))
      .filter((exp): exp is BacktestExperiment => exp !== undefined);

    if (experiments.length === 0) {
      logger.warn({ experimentIds }, "No experiments found for comparison");
      return null;
    }

    // Compute parameter differences
    const allParams = new Set<string>();
    for (const exp of experiments) {
      Object.keys(exp.params).forEach((k) => allParams.add(k));
    }

    const parameterDiff: Record<string, any[]> = {};
    for (const param of allParams) {
      parameterDiff[param] = experiments.map((exp) => exp.params[param] ?? null);
    }

    // Collect metric comparison data
    const metricComparison: ExperimentComparison["metricComparison"] = [];
    for (const exp of experiments) {
      for (const m of exp.metrics) {
        metricComparison.push({
          experimentId: exp.experimentId,
          symbol: m.symbol,
          sharpeRatio: m.sharpeRatio,
          profitFactor: m.profitFactor,
          winRate: m.winRate,
          expectancy: m.expectancy,
          maxDrawdownR: m.maxDrawdownR,
        });
      }
    }

    logger.info(
      { experimentCount: experiments.length, paramCount: allParams.size },
      "Experiments compared",
    );

    return {
      experimentIds: experiments.map((e) => e.experimentId),
      experiments,
      parameterDiff,
      metricComparison,
    };
  }

  /**
   * Get parameter differences between two experiments
   */
  getParameterDiff(
    experimentId1: string,
    experimentId2: string,
  ): Record<string, { exp1: any; exp2: any; different: boolean }> | null {
    const exp1 = this.experiments.get(experimentId1);
    const exp2 = this.experiments.get(experimentId2);

    if (!exp1 || !exp2) {
      logger.warn({ experimentId1, experimentId2 }, "One or both experiments not found");
      return null;
    }

    const allParams = new Set([...Object.keys(exp1.params), ...Object.keys(exp2.params)]);
    const diff: Record<string, { exp1: any; exp2: any; different: boolean }> = {};

    for (const param of allParams) {
      const v1 = exp1.params[param];
      const v2 = exp2.params[param];
      diff[param] = {
        exp1: v1,
        exp2: v2,
        different: JSON.stringify(v1) !== JSON.stringify(v2),
      };
    }

    return diff;
  }

  /**
   * Filter experiments by criteria
   */
  filterExperiments(criteria: {
    strategyName?: string;
    tag?: string;
    status?: BacktestExperiment["status"];
    minSharpeRatio?: number;
    minWinRate?: number;
    dateRangeStart?: string;
  }): BacktestExperiment[] {
    let results = Array.from(this.experiments.values());

    if (criteria.strategyName) {
      results = results.filter((e) => e.strategyName === criteria.strategyName);
    }
    if (criteria.tag) {
      results = results.filter((e) => e.tags.includes(criteria.tag!));
    }
    if (criteria.status) {
      results = results.filter((e) => e.status === criteria.status);
    }
    if (criteria.minSharpeRatio !== undefined) {
      results = results.filter(
        (e) =>
          e.metrics.length > 0 &&
          e.metrics.some((m) => m.sharpeRatio >= criteria.minSharpeRatio!),
      );
    }
    if (criteria.minWinRate !== undefined) {
      results = results.filter(
        (e) =>
          e.metrics.length > 0 && e.metrics.some((m) => m.winRate >= criteria.minWinRate!),
      );
    }
    if (criteria.dateRangeStart) {
      results = results.filter((e) => e.dateRange.start >= criteria.dateRangeStart!);
    }

    return results;
  }

  /**
   * Get experiment history with optional sorting
   */
  getExperimentHistory(
    strategyName: string,
    sortBy: "date" | "sharpeRatio" | "profitFactor" = "date",
    limit?: number,
  ): BacktestExperiment[] {
    let results = this.getExperimentsForStrategy(strategyName);

    if (sortBy === "date") {
      results.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } else if (sortBy === "sharpeRatio") {
      results.sort((a, b) => {
        const aVal =
          a.metrics.length > 0 ? Math.max(...a.metrics.map((m) => m.sharpeRatio)) : -Infinity;
        const bVal =
          b.metrics.length > 0 ? Math.max(...b.metrics.map((m) => m.sharpeRatio)) : -Infinity;
        return bVal - aVal;
      });
    } else if (sortBy === "profitFactor") {
      results.sort((a, b) => {
        const aVal =
          a.metrics.length > 0 ? Math.max(...a.metrics.map((m) => m.profitFactor)) : -Infinity;
        const bVal =
          b.metrics.length > 0 ? Math.max(...b.metrics.map((m) => m.profitFactor)) : -Infinity;
        return bVal - aVal;
      });
    }

    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Get all experiments
   */
  getAllExperiments(): BacktestExperiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * Export experiment as JSON for sharing/analysis
   */
  exportExperiment(experimentId: string): string {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    return JSON.stringify(exp, null, 2);
  }

  /**
   * Generate unique experiment ID
   */
  private generateExperimentId(strategyName: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${strategyName}_${timestamp}_${random}`;
  }
}

// Export singleton instance
export const experimentTracker = new ExperimentTracker();
