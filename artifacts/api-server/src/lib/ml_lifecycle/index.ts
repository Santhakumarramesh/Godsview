/**
 * ml_lifecycle/index.ts — Phase 74: ML Model Lifecycle
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ModelRegistry          — versioned model artifacts.
 *   2. ModelDriftMonitor      — feature + prediction drift detection (PSI).
 *   3. ModelMetricsTracker    — accuracy, precision, recall, AUC, calibration.
 *   4. RetrainingTriggerEng   — emit retraining triggers from drift / metrics.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Model Registry ─────────────────────────────────────────────────────────

export type ModelStatus = "training" | "evaluating" | "staging" | "production" | "shadow" | "archived";
export type ModelKind = "classifier" | "regressor" | "ranker" | "embedding" | "policy";

export interface Model {
  id: string;
  name: string;
  version: string;
  kind: ModelKind;
  status: ModelStatus;
  framework: string;          // e.g. "pytorch", "sklearn", "xgboost"
  artifactUri: string;
  trainedAt: number;
  promotedAt?: number;
  archivedAt?: number;
  trainingDataset: string;
  featureSchema: string[];
  hyperparameters: Record<string, number | string | boolean>;
  metrics: Record<string, number>;
}

export class ModelRegistry {
  private readonly models = new Map<string, Model>();

  register(params: Omit<Model, "id" | "trainedAt" | "status">): Model {
    const id = `mdl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const model: Model = { id, status: "training", trainedAt: Date.now(), ...params };
    this.models.set(id, model);
    logger.info({ modelId: id, name: params.name, version: params.version }, "[ML] Model registered");
    return model;
  }

  promote(id: string, status: ModelStatus): Model | null {
    const m = this.models.get(id);
    if (!m) return null;
    m.status = status;
    if (status === "production") m.promotedAt = Date.now();
    if (status === "archived") m.archivedAt = Date.now();
    return m;
  }

  current(name: string): Model | null {
    return Array.from(this.models.values())
      .filter((m) => m.name === name && m.status === "production")
      .sort((a, b) => (b.promotedAt ?? 0) - (a.promotedAt ?? 0))[0] ?? null;
  }

  list(filter?: { name?: string; status?: ModelStatus; kind?: ModelKind }): Model[] {
    let out = Array.from(this.models.values());
    if (filter?.name) out = out.filter((m) => m.name === filter.name);
    if (filter?.status) out = out.filter((m) => m.status === filter.status);
    if (filter?.kind) out = out.filter((m) => m.kind === filter.kind);
    return out.sort((a, b) => b.trainedAt - a.trainedAt);
  }

  get(id: string): Model | null {
    return this.models.get(id) ?? null;
  }
}

// ── Drift Monitor (PSI) ───────────────────────────────────────────────────

export type DriftLevel = "stable" | "moderate" | "significant";

export interface DriftReport {
  modelId: string;
  feature: string;
  psi: number;
  level: DriftLevel;
  baseline: number[];
  current: number[];
  computedAt: number;
}

export class ModelDriftMonitor {
  private readonly reports: DriftReport[] = [];

  /**
   * Population Stability Index. PSI <0.1 stable, 0.1-0.25 moderate, >0.25 significant.
   * Buckets divided over baseline range with equal-width.
   */
  computePSI(baseline: number[], current: number[], buckets = 10): number {
    if (baseline.length === 0 || current.length === 0) return 0;
    const min = Math.min(...baseline, ...current);
    const max = Math.max(...baseline, ...current);
    if (max === min) return 0;
    const width = (max - min) / buckets;
    const baseDist = new Array(buckets).fill(0);
    const curDist = new Array(buckets).fill(0);
    for (const v of baseline) baseDist[Math.min(buckets - 1, Math.floor((v - min) / width))]++;
    for (const v of current) curDist[Math.min(buckets - 1, Math.floor((v - min) / width))]++;
    const baseTotal = baseline.length;
    const curTotal = current.length;
    let psi = 0;
    for (let i = 0; i < buckets; i++) {
      const bp = (baseDist[i] / baseTotal) || 1e-6;
      const cp = (curDist[i] / curTotal) || 1e-6;
      psi += (cp - bp) * Math.log(cp / bp);
    }
    return Math.max(0, psi);
  }

  evaluate(modelId: string, feature: string, baseline: number[], current: number[]): DriftReport {
    const psi = this.computePSI(baseline, current);
    const level: DriftLevel = psi < 0.1 ? "stable" : psi < 0.25 ? "moderate" : "significant";
    const report: DriftReport = {
      modelId, feature, psi, level,
      baseline, current,
      computedAt: Date.now(),
    };
    this.reports.push(report);
    if (this.reports.length > 5000) this.reports.shift();
    if (level === "significant") logger.warn({ modelId, feature, psi }, "[ML] Significant drift");
    return report;
  }

  recent(modelId?: string, limit = 100): DriftReport[] {
    let out = this.reports;
    if (modelId) out = out.filter((r) => r.modelId === modelId);
    return out.slice(-limit).reverse();
  }
}

// ── Metrics Tracker ────────────────────────────────────────────────────────

export interface MetricSnapshot {
  modelId: string;
  at: number;
  metrics: Record<string, number>;
}

export class ModelMetricsTracker {
  private readonly snapshots: MetricSnapshot[] = [];

  record(modelId: string, metrics: Record<string, number>): MetricSnapshot {
    const snap: MetricSnapshot = { modelId, at: Date.now(), metrics: { ...metrics } };
    this.snapshots.push(snap);
    if (this.snapshots.length > 10_000) this.snapshots.shift();
    return snap;
  }

  trend(modelId: string, metric: string, sinceMs = 24 * 60 * 60 * 1000): { at: number; value: number }[] {
    const since = Date.now() - sinceMs;
    return this.snapshots
      .filter((s) => s.modelId === modelId && s.at >= since && metric in s.metrics)
      .map((s) => ({ at: s.at, value: s.metrics[metric]! }));
  }

  delta(modelId: string, metric: string): { current?: number; baseline?: number; deltaPct?: number } {
    const all = this.snapshots.filter((s) => s.modelId === modelId && metric in s.metrics);
    if (all.length === 0) return {};
    if (all.length === 1) return { current: all[0]!.metrics[metric] };
    const baseline = all[0]!.metrics[metric]!;
    const current = all[all.length - 1]!.metrics[metric]!;
    const deltaPct = baseline !== 0 ? ((current - baseline) / Math.abs(baseline)) * 100 : 0;
    return { current, baseline, deltaPct };
  }

  recent(modelId: string, limit = 50): MetricSnapshot[] {
    return this.snapshots.filter((s) => s.modelId === modelId).slice(-limit).reverse();
  }
}

// ── Retraining Triggers ───────────────────────────────────────────────────

export type TriggerReason =
  | "drift_significant" | "metric_degraded" | "scheduled" | "data_volume" | "manual";

export interface RetrainingTrigger {
  id: string;
  modelId: string;
  reason: TriggerReason;
  emittedAt: number;
  details: Record<string, unknown>;
  acknowledged: boolean;
}

export interface TriggerPolicy {
  driftThreshold: number;       // PSI threshold
  metricDegradationPct: number; // negative pct to fire
  metric: string;               // e.g. "auc"
  scheduledIntervalMs?: number;
}

export class RetrainingTriggerEngine {
  private readonly triggers: RetrainingTrigger[] = [];
  private readonly policies = new Map<string, TriggerPolicy>();

  constructor(
    private readonly drift: ModelDriftMonitor,
    private readonly metrics: ModelMetricsTracker,
  ) {}

  setPolicy(modelId: string, policy: TriggerPolicy): void {
    this.policies.set(modelId, policy);
  }

  evaluate(modelId: string): RetrainingTrigger[] {
    const policy = this.policies.get(modelId);
    if (!policy) return [];
    const fired: RetrainingTrigger[] = [];

    // Drift-triggered
    const driftReports = this.drift.recent(modelId, 50);
    const significantDrift = driftReports.find((r) => r.psi >= policy.driftThreshold);
    if (significantDrift) {
      fired.push(this._fire(modelId, "drift_significant", { feature: significantDrift.feature, psi: significantDrift.psi }));
    }

    // Metric-degradation triggered
    const delta = this.metrics.delta(modelId, policy.metric);
    if (delta.deltaPct !== undefined && delta.deltaPct < policy.metricDegradationPct) {
      fired.push(this._fire(modelId, "metric_degraded", {
        metric: policy.metric, deltaPct: delta.deltaPct, current: delta.current, baseline: delta.baseline,
      }));
    }

    return fired;
  }

  fireScheduled(modelId: string): RetrainingTrigger {
    return this._fire(modelId, "scheduled", { at: Date.now() });
  }

  fireManual(modelId: string, note: string): RetrainingTrigger {
    return this._fire(modelId, "manual", { note });
  }

  acknowledge(id: string): RetrainingTrigger | null {
    const t = this.triggers.find((x) => x.id === id);
    if (!t) return null;
    t.acknowledged = true;
    return t;
  }

  list(modelId?: string): RetrainingTrigger[] {
    return (modelId ? this.triggers.filter((t) => t.modelId === modelId) : this.triggers).reverse();
  }

  private _fire(modelId: string, reason: TriggerReason, details: Record<string, unknown>): RetrainingTrigger {
    const trigger: RetrainingTrigger = {
      id: `trg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      modelId, reason, details,
      emittedAt: Date.now(),
      acknowledged: false,
    };
    this.triggers.push(trigger);
    if (this.triggers.length > 1000) this.triggers.shift();
    logger.info({ modelId, reason }, "[ML] Retraining trigger emitted");
    return trigger;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const modelRegistry = new ModelRegistry();
export const driftMonitor = new ModelDriftMonitor();
export const metricsTracker = new ModelMetricsTracker();
export const retrainingEngine = new RetrainingTriggerEngine(driftMonitor, metricsTracker);
