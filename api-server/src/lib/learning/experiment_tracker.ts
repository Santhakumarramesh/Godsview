/**
 * Phase 95 — Experiment Tracker
 *
 * MLflow-style experiment tracking for strategy variants.
 * Records parameters, metrics, and artifacts for each strategy run.
 * Enables comparison, selection, and rollback of strategy versions.
 */

export interface ExperimentRun {
  runId: string;
  experimentId: string;
  strategyId: string;
  symbol: string;
  startedAt: Date;
  endedAt?: Date;
  status: "running" | "completed" | "failed" | "stopped";
  // Parameters used for this run
  parameters: Record<string, number | string | boolean>;
  // Metrics computed after run
  metrics: Record<string, number>;
  // Tags for organization
  tags: Record<string, string>;
  // Artifacts (references to files, charts, etc.)
  artifacts: ExperimentArtifact[];
  // Parent run ID (for nested experiments)
  parentRunId?: string;
  notes: string;
}

export interface ExperimentArtifact {
  name: string;
  type: "equity_curve" | "trade_log" | "parameter_snapshot" | "chart" | "model" | "report";
  path: string;
  size: number;
  createdAt: Date;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  runs: ExperimentRun[];
  bestRunId: string | null;
  bestMetric: string; // which metric to optimize
  bestMetricValue: number;
}

export interface ComparisonResult {
  runs: ExperimentRun[];
  parameterDiffs: Record<string, { runId: string; value: number | string | boolean }[]>;
  metricComparison: Record<string, { runId: string; value: number; rank: number }[]>;
  bestRun: ExperimentRun;
  recommendation: string;
}

export class ExperimentTracker {
  private experiments: Map<string, Experiment> = new Map();
  private runs: Map<string, ExperimentRun> = new Map();
  private runCounter = 0;

  /** Create a new experiment */
  createExperiment(name: string, description: string, bestMetric = "sharpe_ratio"): string {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.experiments.set(id, {
      id,
      name,
      description,
      createdAt: new Date(),
      runs: [],
      bestRunId: null,
      bestMetric,
      bestMetricValue: -Infinity,
    });
    return id;
  }

  /** Start a new run within an experiment */
  startRun(
    experimentId: string,
    strategyId: string,
    symbol: string,
    parameters: Record<string, number | string | boolean>,
    tags: Record<string, string> = {},
    parentRunId?: string
  ): string {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    this.runCounter++;
    const runId = `run_${this.runCounter}_${Date.now()}`;
    const run: ExperimentRun = {
      runId,
      experimentId,
      strategyId,
      symbol,
      startedAt: new Date(),
      status: "running",
      parameters,
      metrics: {},
      tags,
      artifacts: [],
      parentRunId,
      notes: "",
    };

    this.runs.set(runId, run);
    experiment.runs.push(run);
    return runId;
  }

  /** Log metrics for a run */
  logMetrics(runId: string, metrics: Record<string, number>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    Object.assign(run.metrics, metrics);
  }

  /** Log a single metric */
  logMetric(runId: string, key: string, value: number): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.metrics[key] = value;
  }

  /** Log parameters */
  logParameters(runId: string, params: Record<string, number | string | boolean>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    Object.assign(run.parameters, params);
  }

  /** Add an artifact reference */
  logArtifact(runId: string, artifact: Omit<ExperimentArtifact, "createdAt">): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.artifacts.push({ ...artifact, createdAt: new Date() });
  }

  /** Set tags */
  setTags(runId: string, tags: Record<string, string>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    Object.assign(run.tags, tags);
  }

  /** End a run */
  endRun(runId: string, status: "completed" | "failed" | "stopped" = "completed", notes = ""): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.endedAt = new Date();
    run.status = status;
    run.notes = notes;

    // Update best run for experiment
    if (status === "completed") {
      const experiment = this.experiments.get(run.experimentId);
      if (experiment) {
        const metricValue = run.metrics[experiment.bestMetric] ?? -Infinity;
        if (metricValue > experiment.bestMetricValue) {
          experiment.bestMetricValue = metricValue;
          experiment.bestRunId = runId;
        }
      }
    }
  }

  /** Compare multiple runs */
  compareRuns(runIds: string[]): ComparisonResult {
    const runs = runIds.map((id) => this.runs.get(id)).filter(Boolean) as ExperimentRun[];

    if (runs.length === 0) {
      return {
        runs: [],
        parameterDiffs: {},
        metricComparison: {},
        bestRun: {} as ExperimentRun,
        recommendation: "No runs to compare",
      };
    }

    // Find parameter differences
    const allParams = new Set<string>();
    for (const run of runs) {
      for (const key of Object.keys(run.parameters)) {
        allParams.add(key);
      }
    }

    const parameterDiffs: Record<string, { runId: string; value: number | string | boolean }[]> = {};
    for (const param of allParams) {
      const values = runs.map((r) => ({ runId: r.runId, value: r.parameters[param] }));
      const unique = new Set(values.map((v) => JSON.stringify(v.value)));
      if (unique.size > 1) {
        parameterDiffs[param] = values;
      }
    }

    // Compare metrics
    const allMetrics = new Set<string>();
    for (const run of runs) {
      for (const key of Object.keys(run.metrics)) {
        allMetrics.add(key);
      }
    }

    const metricComparison: Record<string, { runId: string; value: number; rank: number }[]> = {};
    for (const metric of allMetrics) {
      const values = runs
        .map((r) => ({ runId: r.runId, value: r.metrics[metric] ?? 0 }))
        .sort((a, b) => b.value - a.value);
      metricComparison[metric] = values.map((v, i) => ({ ...v, rank: i + 1 }));
    }

    // Find best run by Sharpe ratio
    const bestRun = runs.reduce((best, run) => {
      const sharpe = run.metrics["sharpe_ratio"] ?? 0;
      const bestSharpe = best.metrics["sharpe_ratio"] ?? 0;
      return sharpe > bestSharpe ? run : best;
    }, runs[0]);

    const recommendation = this.generateRecommendation(runs, bestRun);

    return {
      runs,
      parameterDiffs,
      metricComparison,
      bestRun,
      recommendation,
    };
  }

  private generateRecommendation(runs: ExperimentRun[], bestRun: ExperimentRun): string {
    const sharpe = bestRun.metrics["sharpe_ratio"] ?? 0;
    const winRate = bestRun.metrics["win_rate"] ?? 0;
    const pf = bestRun.metrics["profit_factor"] ?? 0;

    if (sharpe > 1.5 && pf > 2) {
      return `Strong candidate: Run ${bestRun.runId} shows excellent risk-adjusted returns (Sharpe: ${sharpe.toFixed(2)}, PF: ${pf.toFixed(2)})`;
    }
    if (sharpe > 0.5 && pf > 1) {
      return `Promising: Run ${bestRun.runId} shows positive edge (Sharpe: ${sharpe.toFixed(2)}, PF: ${pf.toFixed(2)}). Consider further optimization.`;
    }
    return `No strong candidate found. Best run ${bestRun.runId} has Sharpe ${sharpe.toFixed(2)}. Consider adjusting strategy parameters.`;
  }

  /** Get experiment details */
  getExperiment(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  /** Get run details */
  getRun(runId: string): ExperimentRun | undefined {
    return this.runs.get(runId);
  }

  /** List all experiments */
  listExperiments(): Experiment[] {
    return Array.from(this.experiments.values());
  }

  /** Search runs by tags */
  searchRuns(tags: Record<string, string>): ExperimentRun[] {
    return Array.from(this.runs.values()).filter((run) =>
      Object.entries(tags).every(([key, value]) => run.tags[key] === value)
    );
  }

  /** Get best run for an experiment */
  getBestRun(experimentId: string): ExperimentRun | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || !experiment.bestRunId) return null;
    return this.runs.get(experiment.bestRunId) ?? null;
  }
}
