import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino({ name: "observability" });

// Types
export interface Span {
  spanId: string;
  spanName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  data?: Record<string, any>;
  result?: Record<string, any>;
}

export interface Trace {
  traceId: string;
  correlationId: string;
  operation: string;
  metadata?: Record<string, any>;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: "success" | "error" | "timeout";
  spans: Span[];
}

export interface Metric {
  metricId: string;
  name: string;
  value: number;
  type: "counter" | "gauge" | "histogram";
  tags?: Record<string, string>;
  timestamp: number;
  buckets?: number[]; // for histograms
}

export interface AlertRule {
  ruleId: string;
  name: string;
  metric: string;
  condition: "gt" | "lt" | "eq" | "rate_change";
  threshold: number;
  window: number; // milliseconds
  severity: "low" | "medium" | "high" | "critical";
  actions: string[];
  active: boolean;
  createdAt: number;
}

export interface Alert {
  alertId: string;
  ruleId: string;
  ruleName: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  triggeredAt: number;
  acknowledged: boolean;
  acknowledgedAt?: number;
  value: number;
  threshold: number;
}

export interface RequestLog {
  correlationId: string;
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: number;
}

// TraceEngine
export class TraceEngine {
  private traces: Map<string, Trace> = new Map();

  startTrace(
    operation: string,
    metadata?: Record<string, any>
  ): { traceId: string; correlationId: string } {
    const traceId = `trace_${randomUUID()}`;
    const correlationId = `cor_${randomUUID()}`;

    const trace: Trace = {
      traceId,
      correlationId,
      operation,
      metadata,
      startTime: Date.now(),
      spans: [],
    };

    this.traces.set(traceId, trace);
    logger.debug({ traceId, operation }, "Trace started");
    return { traceId, correlationId };
  }

  addSpan(
    traceId: string,
    spanName: string,
    data?: Record<string, any>
  ): string | null {
    const trace = this.traces.get(traceId);
    if (!trace) {
      logger.warn({ traceId }, "Trace not found");
      return null;
    }

    const spanId = `span_${randomUUID()}`;
    const span: Span = {
      spanId,
      spanName,
      startTime: Date.now(),
      data,
    };

    trace.spans.push(span);
    logger.debug({ traceId, spanId, spanName }, "Span added");
    return spanId;
  }

  endSpan(
    traceId: string,
    spanId: string,
    result?: Record<string, any>
  ): boolean {
    const trace = this.traces.get(traceId);
    if (!trace) {
      logger.warn({ traceId }, "Trace not found");
      return false;
    }

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) {
      logger.warn({ traceId, spanId }, "Span not found");
      return false;
    }

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.result = result;
    logger.debug(
      { traceId, spanId, duration: span.duration },
      "Span ended"
    );
    return true;
  }

  endTrace(
    traceId: string,
    status: "success" | "error" | "timeout"
  ): boolean {
    const trace = this.traces.get(traceId);
    if (!trace) {
      logger.warn({ traceId }, "Trace not found");
      return false;
    }

    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.status = status;
    logger.debug(
      { traceId, status, duration: trace.duration },
      "Trace ended"
    );
    return true;
  }

  getTrace(traceId: string): Trace | null {
    return this.traces.get(traceId) || null;
  }

  searchTraces(filters: {
    operation?: string;
    status?: "success" | "error" | "timeout";
    minDuration?: number;
    since?: number;
  }): Trace[] {
    const results: Trace[] = [];

    for (const trace of this.traces.values()) {
      if (filters.operation && trace.operation !== filters.operation) continue;
      if (filters.status && trace.status !== filters.status) continue;
      if (filters.minDuration && (!trace.duration || trace.duration < filters.minDuration))
        continue;
      if (filters.since && trace.startTime < filters.since) continue;

      results.push(trace);
    }

    return results;
  }

  getTraceMetrics(): {
    total: number;
    byStatus: Record<string, number>;
    avgDuration: number;
    p95Duration: number;
    errorRate: number;
  } {
    const traces = Array.from(this.traces.values());
    const durations = traces
      .filter((t) => t.duration !== undefined)
      .map((t) => t.duration as number)
      .sort((a, b) => a - b);

    const byStatus: Record<string, number> = {
      success: 0,
      error: 0,
      timeout: 0,
    };

    for (const trace of traces) {
      if (trace.status) {
        byStatus[trace.status]++;
      }
    }

    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    const p95Index = Math.ceil(durations.length * 0.95) - 1;
    const p95Duration =
      durations.length > 0 ? durations[Math.max(0, p95Index)] : 0;

    const errorRate =
      traces.length > 0
        ? (byStatus.error + byStatus.timeout) / traces.length
        : 0;

    return {
      total: traces.length,
      byStatus,
      avgDuration,
      p95Duration,
      errorRate,
    };
  }

  _clearTraceEngine(): void {
    this.traces.clear();
    logger.debug("TraceEngine cleared");
  }
}

// MetricsPipeline
export class MetricsPipeline {
  private metrics: Map<string, Metric> = new Map();

  recordMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): string {
    const metricId = `met_${randomUUID()}`;
    const metric: Metric = {
      metricId,
      name,
      value,
      type: "gauge",
      tags,
      timestamp: Date.now(),
    };

    this.metrics.set(metricId, metric);
    logger.debug({ name, value, tags }, "Metric recorded");
    return metricId;
  }

  recordCounter(
    name: string,
    increment: number,
    tags?: Record<string, string>
  ): string {
    const metricId = `met_${randomUUID()}`;
    const metric: Metric = {
      metricId,
      name,
      value: increment,
      type: "counter",
      tags,
      timestamp: Date.now(),
    };

    this.metrics.set(metricId, metric);
    logger.debug({ name, increment, tags }, "Counter recorded");
    return metricId;
  }

  recordGauge(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): string {
    const metricId = `met_${randomUUID()}`;
    const metric: Metric = {
      metricId,
      name,
      value,
      type: "gauge",
      tags,
      timestamp: Date.now(),
    };

    this.metrics.set(metricId, metric);
    logger.debug({ name, value, tags }, "Gauge recorded");
    return metricId;
  }

  recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): string {
    const metricId = `met_${randomUUID()}`;
    const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    const metric: Metric = {
      metricId,
      name,
      value,
      type: "histogram",
      tags,
      timestamp: Date.now(),
      buckets,
    };

    this.metrics.set(metricId, metric);
    logger.debug({ name, value, tags }, "Histogram recorded");
    return metricId;
  }

  getMetrics(
    name?: string,
    since?: number
  ): Metric[] {
    const results: Metric[] = [];

    for (const metric of this.metrics.values()) {
      if (name && metric.name !== name) continue;
      if (since && metric.timestamp < since) continue;
      results.push(metric);
    }

    return results;
  }

  getMetricsSummary(): Record<string, { count: number; avg: number; latest: number }> {
    const summary: Record<
      string,
      { count: number; avg: number; latest: number }
    > = {};

    for (const metric of this.metrics.values()) {
      if (!summary[metric.name]) {
        summary[metric.name] = {
          count: 0,
          avg: 0,
          latest: 0,
        };
      }

      const entry = summary[metric.name];
      entry.count++;
      entry.avg = (entry.avg * (entry.count - 1) + metric.value) / entry.count;
      entry.latest = metric.value;
    }

    return summary;
  }

  getDashboard(): {
    totalMetrics: number;
    uniqueNames: number;
    metricsByType: Record<string, number>;
    recentActivity: number;
  } {
    const metrics = Array.from(this.metrics.values());
    const uniqueNames = new Set(metrics.map((m) => m.name)).size;
    const metricsByType: Record<string, number> = {
      counter: 0,
      gauge: 0,
      histogram: 0,
    };

    for (const metric of metrics) {
      metricsByType[metric.type]++;
    }

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentActivity = metrics.filter((m) => m.timestamp > fiveMinutesAgo)
      .length;

    return {
      totalMetrics: metrics.length,
      uniqueNames,
      metricsByType,
      recentActivity,
    };
  }

  _clearMetricsPipeline(): void {
    this.metrics.clear();
    logger.debug("MetricsPipeline cleared");
  }
}

// AlertRulesEngine
export class AlertRulesEngine {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Map<string, Alert> = new Map();

  createRule(config: {
    name: string;
    metric: string;
    condition: "gt" | "lt" | "eq" | "rate_change";
    threshold: number;
    window: number;
    severity: "low" | "medium" | "high" | "critical";
    actions: string[];
  }): string {
    const ruleId = `rule_${randomUUID()}`;
    const rule: AlertRule = {
      ruleId,
      name: config.name,
      metric: config.metric,
      condition: config.condition,
      threshold: config.threshold,
      window: config.window,
      severity: config.severity,
      actions: config.actions,
      active: true,
      createdAt: Date.now(),
    };

    this.rules.set(ruleId, rule);
    logger.debug({ ruleId, name: config.name }, "Alert rule created");
    return ruleId;
  }

  evaluateRules(currentMetrics: Map<string, number>): Alert[] {
    const triggeredAlerts: Alert[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.active) continue;

      const currentValue = currentMetrics.get(rule.metric);
      if (currentValue === undefined) continue;

      let triggered = false;

      switch (rule.condition) {
        case "gt":
          triggered = currentValue > rule.threshold;
          break;
        case "lt":
          triggered = currentValue < rule.threshold;
          break;
        case "eq":
          triggered = currentValue === rule.threshold;
          break;
        case "rate_change":
          triggered = Math.abs(currentValue - rule.threshold) > rule.threshold * 0.1;
          break;
      }

      if (triggered) {
        const alertId = `alert_${randomUUID()}`;
        const alert: Alert = {
          alertId,
          ruleId: rule.ruleId,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Alert rule "${rule.name}" triggered (${rule.condition} ${rule.threshold})`,
          triggeredAt: Date.now(),
          acknowledged: false,
          value: currentValue,
          threshold: rule.threshold,
        };

        this.alerts.set(alertId, alert);
        triggeredAlerts.push(alert);
        logger.warn(
          { alertId, ruleName: rule.name, value: currentValue },
          "Alert triggered"
        );
      }
    }

    return triggeredAlerts;
  }

  getAlerts(filters?: {
    severity?: string;
    acknowledged?: boolean;
    since?: number;
  }): Alert[] {
    const results: Alert[] = [];

    for (const alert of this.alerts.values()) {
      if (
        filters?.severity &&
        alert.severity !== filters.severity
      )
        continue;
      if (filters?.acknowledged !== undefined && alert.acknowledged !== filters.acknowledged)
        continue;
      if (filters?.since && alert.triggeredAt < filters.since)
        continue;

      results.push(alert);
    }

    return results;
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      logger.warn({ alertId }, "Alert not found");
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = Date.now();
    logger.debug({ alertId }, "Alert acknowledged");
    return true;
  }

  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  deleteRule(ruleId: string): boolean {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      logger.debug({ ruleId }, "Alert rule deleted");
    }
    return deleted;
  }

  getAlertStats(): {
    total: number;
    bySeverity: Record<string, number>;
    acknowledgedRate: number;
    topTriggered: string;
  } {
    const alerts = Array.from(this.alerts.values());
    const bySeverity: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const alert of alerts) {
      bySeverity[alert.severity]++;
    }

    const acknowledgedCount = alerts.filter((a) => a.acknowledged).length;
    const acknowledgedRate = alerts.length > 0 ? acknowledgedCount / alerts.length : 0;

    const ruleCount: Map<string, number> = new Map();
    for (const alert of alerts) {
      ruleCount.set(alert.ruleName, (ruleCount.get(alert.ruleName) || 0) + 1);
    }

    let topTriggered = "";
    let maxCount = 0;
    for (const [ruleName, count] of ruleCount.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topTriggered = ruleName;
      }
    }

    return {
      total: alerts.length,
      bySeverity,
      acknowledgedRate,
      topTriggered,
    };
  }

  _clearAlertRulesEngine(): void {
    this.rules.clear();
    this.alerts.clear();
    logger.debug("AlertRulesEngine cleared");
  }
}

// CorrelationIdMiddleware
export class CorrelationIdMiddleware {
  private requestLogs: Map<string, RequestLog> = new Map();

  generateCorrelationId(): string {
    return `cor_${randomUUID()}`;
  }

  logRequest(
    correlationId: string,
    method: string,
    path: string,
    statusCode: number,
    duration: number
  ): void {
    const log: RequestLog = {
      correlationId,
      method,
      path,
      statusCode,
      duration,
      timestamp: Date.now(),
    };

    this.requestLogs.set(correlationId, log);
    logger.debug(
      { correlationId, method, path, statusCode, duration },
      "Request logged"
    );
  }

  getRequestLog(correlationId: string): RequestLog | null {
    return this.requestLogs.get(correlationId) || null;
  }

  getRecentRequests(limit: number = 20): RequestLog[] {
    const logs = Array.from(this.requestLogs.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return logs;
  }

  _clearCorrelationIdMiddleware(): void {
    this.requestLogs.clear();
    logger.debug("CorrelationIdMiddleware cleared");
  }
}

// Singleton instances
export const traceEngine = new TraceEngine();
export const metricsPipeline = new MetricsPipeline();
export const alertRulesEngine = new AlertRulesEngine();
export const correlationMiddleware = new CorrelationIdMiddleware();
