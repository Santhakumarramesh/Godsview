/**
 * capacity_planning/index.ts — Phase 65: Capacity Planning + Auto-Scaling
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ResourceMonitor       — CPU, memory, connections, queue depth.
 *   2. ForecastEngine        — linear + EWMA forecasts for horizon planning.
 *   3. ScalingRecommender    — scale-up / scale-down / steady signals.
 *   4. LoadPatternDetector   — detect daily / weekly / session patterns.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Resource Monitor ───────────────────────────────────────────────────────

export type ResourceKind = "cpu" | "memory" | "connections" | "queue_depth" | "disk" | "network_bps";

export interface ResourceSample {
  at: number;
  kind: ResourceKind;
  value: number;
  unit: string;
  host?: string;
}

export class ResourceMonitor {
  private readonly samples: ResourceSample[] = [];
  private readonly maxSamples = 100_000;

  record(kind: ResourceKind, value: number, unit: string, host?: string): ResourceSample {
    const sample: ResourceSample = { at: Date.now(), kind, value, unit, host };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return sample;
  }

  series(kind: ResourceKind, sinceMs = 60 * 60 * 1000): ResourceSample[] {
    const since = Date.now() - sinceMs;
    return this.samples.filter((s) => s.kind === kind && s.at >= since);
  }

  current(kind: ResourceKind): ResourceSample | null {
    const s = this.samples.filter((x) => x.kind === kind);
    return s.length > 0 ? s[s.length - 1]! : null;
  }

  stats(kind: ResourceKind, sinceMs = 60 * 60 * 1000): {
    kind: ResourceKind;
    count: number;
    avg: number;
    min: number;
    max: number;
    p95: number;
    last: number;
  } {
    const series = this.series(kind, sinceMs).map((s) => s.value).sort((a, b) => a - b);
    if (series.length === 0) return { kind, count: 0, avg: 0, min: 0, max: 0, p95: 0, last: 0 };
    const avg = series.reduce((s, v) => s + v, 0) / series.length;
    const p95 = series[Math.min(series.length - 1, Math.floor(series.length * 0.95))]!;
    const last = this.current(kind)?.value ?? 0;
    return { kind, count: series.length, avg, min: series[0]!, max: series[series.length - 1]!, p95, last };
  }
}

// ── Forecast ──────────────────────────────────────────────────────────────

export class ForecastEngine {
  linear(samples: number[], horizon: number): number[] {
    const n = samples.length;
    if (n < 2) return Array(horizon).fill(n > 0 ? samples[0] : 0);
    const xMean = (n - 1) / 2;
    const yMean = samples.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (samples[i]! - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;
    const out: number[] = [];
    for (let i = 0; i < horizon; i++) out.push(intercept + slope * (n + i));
    return out;
  }

  ewma(samples: number[], alpha = 0.3, horizon = 1): number[] {
    if (samples.length === 0) return Array(horizon).fill(0);
    let s = samples[0]!;
    for (let i = 1; i < samples.length; i++) s = alpha * samples[i]! + (1 - alpha) * s;
    return Array(horizon).fill(s);
  }

  combined(samples: number[], horizon: number): {
    linear: number[];
    ewma: number[];
    blended: number[];
  } {
    const linear = this.linear(samples, horizon);
    const ewma = this.ewma(samples, 0.3, horizon);
    const blended = linear.map((v, i) => 0.6 * v + 0.4 * (ewma[i] ?? v));
    return { linear, ewma, blended };
  }
}

// ── Scaling Recommender ───────────────────────────────────────────────────

export type ScalingAction = "scale_up" | "scale_down" | "steady" | "alert";

export interface ScalingRecommendation {
  kind: ResourceKind;
  action: ScalingAction;
  currentUtilization: number;
  forecastUtilization: number;
  urgency: "low" | "medium" | "high";
  reason: string;
  suggestedChangePct: number;
}

export interface ThresholdConfig {
  scaleUpPct: number;   // e.g. 75 → scale up if util > 75%
  scaleDownPct: number; // e.g. 30 → scale down if util < 30%
  alertPct: number;     // e.g. 90 → alert immediately
}

export const DEFAULT_THRESHOLDS: Record<ResourceKind, ThresholdConfig> = {
  cpu: { scaleUpPct: 70, scaleDownPct: 25, alertPct: 90 },
  memory: { scaleUpPct: 75, scaleDownPct: 30, alertPct: 92 },
  connections: { scaleUpPct: 80, scaleDownPct: 30, alertPct: 95 },
  queue_depth: { scaleUpPct: 70, scaleDownPct: 20, alertPct: 90 },
  disk: { scaleUpPct: 75, scaleDownPct: 30, alertPct: 95 },
  network_bps: { scaleUpPct: 80, scaleDownPct: 30, alertPct: 95 },
};

export class ScalingRecommender {
  constructor(
    private readonly monitor: ResourceMonitor,
    private readonly forecast: ForecastEngine,
  ) {}

  recommend(kind: ResourceKind, capacity: number, horizon = 12): ScalingRecommendation {
    const series = this.monitor.series(kind, 60 * 60 * 1000).map((s) => s.value);
    const stats = this.monitor.stats(kind, 60 * 60 * 1000);
    const currentUtil = capacity > 0 ? (stats.last / capacity) * 100 : 0;
    const forecasted = this.forecast.combined(series, horizon).blended;
    const forecastMax = Math.max(...forecasted, 0);
    const forecastUtil = capacity > 0 ? (forecastMax / capacity) * 100 : 0;
    const th = DEFAULT_THRESHOLDS[kind];

    let action: ScalingAction = "steady";
    let urgency: ScalingRecommendation["urgency"] = "low";
    let reason = "within bounds";
    let suggestedChangePct = 0;

    if (currentUtil >= th.alertPct || forecastUtil >= th.alertPct) {
      action = "alert";
      urgency = "high";
      reason = `util ${Math.max(currentUtil, forecastUtil).toFixed(1)}% > alert ${th.alertPct}%`;
      suggestedChangePct = Math.max(50, Math.ceil((forecastUtil - th.scaleUpPct) / 10) * 10);
    } else if (forecastUtil >= th.scaleUpPct) {
      action = "scale_up";
      urgency = forecastUtil >= (th.scaleUpPct + th.alertPct) / 2 ? "high" : "medium";
      reason = `forecast util ${forecastUtil.toFixed(1)}% > scale-up ${th.scaleUpPct}%`;
      suggestedChangePct = Math.max(20, Math.ceil((forecastUtil - th.scaleUpPct) / 10) * 10);
    } else if (currentUtil < th.scaleDownPct && forecastUtil < th.scaleDownPct) {
      action = "scale_down";
      urgency = "low";
      reason = `util ${currentUtil.toFixed(1)}% < scale-down ${th.scaleDownPct}%`;
      suggestedChangePct = -Math.max(10, Math.floor((th.scaleDownPct - currentUtil) / 10) * 10);
    }

    return { kind, action, currentUtilization: currentUtil, forecastUtilization: forecastUtil, urgency, reason, suggestedChangePct };
  }
}

// ── Load Pattern Detector ─────────────────────────────────────────────────

export interface LoadPattern {
  kind: "daily" | "weekly" | "spiky" | "growing" | "flat";
  confidence: number;
  description: string;
}

export class LoadPatternDetector {
  detect(samples: ResourceSample[]): LoadPattern {
    if (samples.length < 20) return { kind: "flat", confidence: 0.5, description: "not enough data" };
    const values = samples.map((s) => s.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? std / mean : 0;

    // Check trend
    const first = values.slice(0, Math.floor(values.length / 2));
    const second = values.slice(Math.floor(values.length / 2));
    const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
    const secondAvg = second.reduce((a, b) => a + b, 0) / second.length;
    const growthRate = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;

    if (Math.abs(growthRate) > 0.2) {
      return { kind: "growing", confidence: Math.min(1, Math.abs(growthRate)), description: `${(growthRate * 100).toFixed(1)}% change` };
    }
    if (cv > 0.5) {
      return { kind: "spiky", confidence: Math.min(1, cv), description: `CV ${cv.toFixed(2)}` };
    }
    const spanMs = samples[samples.length - 1]!.at - samples[0]!.at;
    const hours = spanMs / (60 * 60 * 1000);
    if (hours >= 24) return { kind: "daily", confidence: 0.7, description: `${hours.toFixed(1)}h of data` };
    if (hours >= 24 * 7) return { kind: "weekly", confidence: 0.8, description: `${hours.toFixed(1)}h of data` };
    return { kind: "flat", confidence: 1 - cv, description: `CV ${cv.toFixed(2)}` };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const resourceMonitor = new ResourceMonitor();
export const forecastEngine = new ForecastEngine();
export const scalingRecommender = new ScalingRecommender(resourceMonitor, forecastEngine);
export const loadPatternDetector = new LoadPatternDetector();

// Emit a line so logger isn't unused if tree-shaken importer keeps this file.
export function __ping(): string { logger.debug?.("[Capacity] ping"); return "ok"; }
