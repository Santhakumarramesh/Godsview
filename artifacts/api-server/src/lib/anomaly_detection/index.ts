/**
 * anomaly_detection/index.ts — Phase 85: Anomaly Detection
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ZScoreDetector       — flag points beyond N standard deviations.
 *   2. IQRDetector          — interquartile range outliers.
 *   3. EWMADetector         — exponentially weighted moving average + bands.
 *   4. ChangePointDetector  — CUSUM-based change point detection.
 *   5. AnomalyRegistry      — anomaly events store with classification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Detectors ─────────────────────────────────────────────────────────────

export interface AnomalyPoint {
  index: number;
  value: number;
  score: number;
  reason: string;
}

export class ZScoreDetector {
  detect(series: number[], threshold = 3.0): AnomalyPoint[] {
    if (series.length < 2) return [];
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
    const std = Math.sqrt(variance);
    if (std === 0) return [];
    const out: AnomalyPoint[] = [];
    for (let i = 0; i < series.length; i++) {
      const z = (series[i]! - mean) / std;
      if (Math.abs(z) > threshold) {
        out.push({ index: i, value: series[i]!, score: Math.abs(z), reason: `z=${z.toFixed(2)}` });
      }
    }
    return out;
  }
}

export class IQRDetector {
  detect(series: number[], multiplier = 1.5): AnomalyPoint[] {
    if (series.length < 4) return [];
    const sorted = [...series].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
    const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
    const iqr = q3 - q1;
    const lower = q1 - multiplier * iqr;
    const upper = q3 + multiplier * iqr;
    const out: AnomalyPoint[] = [];
    for (let i = 0; i < series.length; i++) {
      const v = series[i]!;
      if (v < lower || v > upper) {
        const distance = v < lower ? lower - v : v - upper;
        const score = iqr > 0 ? distance / iqr : 1;
        out.push({
          index: i, value: v, score,
          reason: v < lower ? `below ${lower.toFixed(2)}` : `above ${upper.toFixed(2)}`,
        });
      }
    }
    return out;
  }
}

export class EWMADetector {
  detect(series: number[], alpha = 0.3, threshold = 3.0): AnomalyPoint[] {
    if (series.length === 0) return [];
    const out: AnomalyPoint[] = [];
    let mean = series[0]!;
    let variance = 0;
    for (let i = 1; i < series.length; i++) {
      const v = series[i]!;
      const std = Math.sqrt(variance);
      const z = std > 0 ? (v - mean) / std : 0;
      if (Math.abs(z) > threshold) {
        out.push({ index: i, value: v, score: Math.abs(z), reason: `EWMA z=${z.toFixed(2)}` });
      }
      const delta = v - mean;
      mean = mean + alpha * delta;
      variance = (1 - alpha) * (variance + alpha * delta * delta);
    }
    return out;
  }
}

export class ChangePointDetector {
  detect(series: number[], threshold = 5.0): AnomalyPoint[] {
    if (series.length < 4) return [];
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    let cusumPos = 0, cusumNeg = 0;
    const out: AnomalyPoint[] = [];
    for (let i = 0; i < series.length; i++) {
      const dev = series[i]! - mean;
      cusumPos = Math.max(0, cusumPos + dev);
      cusumNeg = Math.min(0, cusumNeg + dev);
      const score = Math.max(cusumPos, -cusumNeg);
      if (score > threshold) {
        out.push({ index: i, value: series[i]!, score, reason: `CUSUM=${score.toFixed(2)}` });
        cusumPos = 0; cusumNeg = 0;
      }
    }
    return out;
  }
}

// ── Anomaly Registry ──────────────────────────────────────────────────────

export type AnomalyKind = "spike" | "drop" | "drift" | "outlier" | "change_point" | "missing_data";
export type AnomalyClassification = "false_positive" | "noise" | "actionable" | "critical" | "unclassified";

export interface AnomalyEvent {
  id: string;
  metric: string;
  detectorKind: "z_score" | "iqr" | "ewma" | "cusum" | "manual";
  kind: AnomalyKind;
  detectedAt: number;
  observedValue: number;
  score: number;
  reason: string;
  classification: AnomalyClassification;
  classifiedBy?: string;
  classifiedAt?: number;
  context: Record<string, unknown>;
}

export class AnomalyRegistry {
  private readonly events: AnomalyEvent[] = [];

  record(params: Omit<AnomalyEvent, "id" | "detectedAt" | "classification">): AnomalyEvent {
    const event: AnomalyEvent = {
      id: `ano_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      detectedAt: Date.now(),
      classification: "unclassified",
      ...params,
    };
    this.events.push(event);
    if (this.events.length > 10_000) this.events.shift();
    if (params.score > 5) logger.warn({ metric: params.metric, score: params.score }, "[Anomaly] High-score event");
    return event;
  }

  classify(id: string, classification: AnomalyClassification, classifiedBy: string): AnomalyEvent | null {
    const e = this.events.find((x) => x.id === id);
    if (!e) return null;
    e.classification = classification;
    e.classifiedBy = classifiedBy;
    e.classifiedAt = Date.now();
    return e;
  }

  list(filter?: { metric?: string; kind?: AnomalyKind; classification?: AnomalyClassification }): AnomalyEvent[] {
    let out = [...this.events];
    if (filter?.metric) out = out.filter((e) => e.metric === filter.metric);
    if (filter?.kind) out = out.filter((e) => e.kind === filter.kind);
    if (filter?.classification) out = out.filter((e) => e.classification === filter.classification);
    return out.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  stats(): {
    total: number; unclassified: number; falsePositives: number;
    actionable: number; critical: number; precision: number;
  } {
    const total = this.events.length;
    const unclassified = this.events.filter((e) => e.classification === "unclassified").length;
    const falsePositives = this.events.filter((e) => e.classification === "false_positive").length;
    const actionable = this.events.filter((e) => e.classification === "actionable").length;
    const critical = this.events.filter((e) => e.classification === "critical").length;
    const classified = total - unclassified;
    const precision = classified > 0 ? (actionable + critical) / classified : 0;
    return { total, unclassified, falsePositives, actionable, critical, precision };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const zScoreDetector = new ZScoreDetector();
export const iqrDetector = new IQRDetector();
export const ewmaDetector = new EWMADetector();
export const changePointDetector = new ChangePointDetector();
export const anomalyRegistry = new AnomalyRegistry();
