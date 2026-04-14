/**
 * observability/index.ts — Phase 56 (formerly 118)
 * ─────────────────────────────────────────────────────────────────────────────
 * Advanced observability primitives:
 *
 *   1. TraceEngine     — correlation-id based distributed tracing with spans,
 *                        p50/p95/p99 latency, and per-span metadata.
 *   2. MetricsPipeline — counter / gauge / histogram pipeline with dashboard
 *                        snapshots.
 *   3. AlertRulesEngine — fires alerts on gt/lt/eq/rate_change conditions.
 *
 * All engines are pure in-memory and safe for unit tests. Ring-buffered to
 * avoid unbounded growth in long-running processes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Trace Engine ─────────────────────────────────────────────────────────────

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: "ok" | "error" | "cancelled";
  attributes: Record<string, string | number | boolean>;
  events: Array<{ at: number; name: string; data?: Record<string, unknown> }>;
}

export interface Trace {
  traceId: string;
  rootSpanId: string;
  startedAt: number;
  finishedAt?: number;
  totalDurationMs?: number;
  spanCount: number;
  hasError: boolean;
}

export class TraceEngine {
  private readonly spans = new Map<string, Span>();
  private readonly traces = new Map<string, Trace>();
  private readonly maxSpans: number;

  constructor(maxSpans = 10_000) {
    this.maxSpans = maxSpans;
  }

  startSpan(params: {
    name: string;
    service: string;
    traceId?: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }): Span {
    const spanId = this._newId("span");
    const traceId = params.traceId ?? this._newId("trace");
    const span: Span = {
      spanId,
      traceId,
      parentSpanId: params.parentSpanId,
      name: params.name,
      service: params.service,
      startedAt: Date.now(),
      status: "ok",
      attributes: { ...(params.attributes ?? {}) },
      events: [],
    };
    this.spans.set(spanId, span);

    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        rootSpanId: spanId,
        startedAt: span.startedAt,
        spanCount: 1,
        hasError: false,
      });
    } else {
      const trace = this.traces.get(traceId)!;
      trace.spanCount++;
    }

    this._evictIfNeeded();
    return span;
  }

  finishSpan(spanId: string, status: Span["status"] = "ok"): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.finishedAt = Date.now();
    span.durationMs = span.finishedAt - span.startedAt;
    span.status = status;

    const trace = this.traces.get(span.traceId);
    if (trace) {
      trace.finishedAt = span.finishedAt;
      trace.totalDurationMs = (trace.finishedAt ?? span.finishedAt) - trace.startedAt;
      if (status === "error") trace.hasError = true;
    }
  }

  addEvent(spanId: string, name: string, data?: Record<string, unknown>): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.events.push({ at: Date.now(), name, data });
  }

  getTrace(traceId: string): { trace: Trace; spans: Span[] } | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;
    const spans = Array.from(this.spans.values()).filter((s) => s.traceId === traceId);
    return { trace, spans };
  }

  getLatencyStats(name: string): { count: number; p50: number; p95: number; p99: number; avg: number } {
    const durations = Array.from(this.spans.values())
      .filter((s) => s.name === name && s.durationMs !== undefined)
      .map((s) => s.durationMs!)
      .sort((a, b) => a - b);

    if (durations.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0 };
    const p = (q: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))]!;
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    return { count: durations.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), avg };
  }

  recentTraces(limit = 50): Trace[] {
    return Array.from(this.traces.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  private _newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private _evictIfNeeded(): void {
    if (this.spans.size <= this.maxSpans) return;
    const excess = this.spans.size - this.maxSpans;
    const oldest = Array.from(this.spans.entries())
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
      .slice(0, excess);
    for (const [id] of oldest) this.spans.delete(id);
  }
}

// ── Metrics Pipeline ──────────────────────────────────────────────────────────

export type MetricKind = "counter" | "gauge" | "histogram";

export interface MetricPoint {
  name: string;
  kind: MetricKind;
  value: number;
  labels: Record<string, string>;
  at: number;
}

export class MetricsPipeline {
  private readonly points: MetricPoint[] = [];
  private readonly maxPoints: number;

  constructor(maxPoints = 50_000) {
    this.maxPoints = maxPoints;
  }

  counter(name: string, delta = 1, labels: Record<string, string> = {}): void {
    this._push({ name, kind: "counter", value: delta, labels, at: Date.now() });
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this._push({ name, kind: "gauge", value, labels, at: Date.now() });
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    this._push({ name, kind: "histogram", value, labels, at: Date.now() });
  }

  snapshot(name: string, sinceMs = 300_000): {
    name: string;
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  } {
    const since = Date.now() - sinceMs;
    const values = this.points.filter((p) => p.name === name && p.at >= since).map((p) => p.value);
    if (values.length === 0) return { name, count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    const sum = values.reduce((s, v) => s + v, 0);
    return {
      name,
      count: values.length,
      sum,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  dashboard(): Array<{ name: string; count: number; avg: number; max: number }> {
    const names = new Set(this.points.map((p) => p.name));
    return Array.from(names).map((name) => {
      const snap = this.snapshot(name);
      return { name, count: snap.count, avg: snap.avg, max: snap.max };
    });
  }

  private _push(p: MetricPoint): void {
    this.points.push(p);
    if (this.points.length > this.maxPoints) {
      this.points.splice(0, this.points.length - this.maxPoints);
    }
  }
}

// ── Alert Rules Engine ────────────────────────────────────────────────────────

export type AlertCondition = "gt" | "lt" | "eq" | "rate_change";

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: AlertCondition;
  threshold: number;
  windowMs: number;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertRule["severity"];
  firedAt: number;
  observedValue: number;
  threshold: number;
  message: string;
}

export class AlertRulesEngine {
  private readonly rules = new Map<string, AlertRule>();
  private readonly events: AlertEvent[] = [];

  constructor(private readonly metrics: MetricsPipeline) {}

  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  listRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  evaluate(): AlertEvent[] {
    const fired: AlertEvent[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      const snap = this.metrics.snapshot(rule.metric, rule.windowMs);
      if (snap.count === 0) continue;

      let matched = false;
      const observed = snap.avg;
      switch (rule.condition) {
        case "gt":
          matched = observed > rule.threshold;
          break;
        case "lt":
          matched = observed < rule.threshold;
          break;
        case "eq":
          matched = Math.abs(observed - rule.threshold) < 1e-9;
          break;
        case "rate_change": {
          const half = this.metrics.snapshot(rule.metric, rule.windowMs / 2);
          matched = half.avg !== 0 && Math.abs(half.avg - observed) / Math.max(Math.abs(observed), 1e-9) > rule.threshold;
          break;
        }
      }

      if (matched) {
        const event: AlertEvent = {
          id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          firedAt: Date.now(),
          observedValue: observed,
          threshold: rule.threshold,
          message: `${rule.name}: observed ${observed.toFixed(3)} ${rule.condition} ${rule.threshold}`,
        };
        this.events.push(event);
        fired.push(event);
        logger.warn({ rule: rule.name, observed, threshold: rule.threshold }, "[AlertRules] Fired");
      }
    }
    if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000);
    return fired;
  }

  recentEvents(limit = 50): AlertEvent[] {
    return this.events.slice(-limit).reverse();
  }
}

// ── Singletons ───────────────────────────────────────────────────────────────

export const traceEngine = new TraceEngine();
export const metricsPipeline = new MetricsPipeline();
export const alertRulesEngine = new AlertRulesEngine(metricsPipeline);
