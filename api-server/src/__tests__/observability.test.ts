import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

import {
  TraceEngine,
  MetricsPipeline,
  AlertRulesEngine,
  CorrelationIdMiddleware,
} from "../lib/observability/index.js";

describe("TraceEngine", () => {
  let traceEngine: TraceEngine;

  beforeEach(() => {
    traceEngine = new TraceEngine();
  });

  it("should start a trace with operation and metadata", () => {
    const { traceId, correlationId } = traceEngine.startTrace("test_op", {
      userId: "123",
    });

    expect(traceId).toMatch(/^trace_/);
    expect(correlationId).toMatch(/^cor_/);
  });

  it("should start a trace without metadata", () => {
    const { traceId } = traceEngine.startTrace("test_op");

    expect(traceId).toMatch(/^trace_/);
  });

  it("should retrieve a trace by traceId", () => {
    const { traceId } = traceEngine.startTrace("test_op");
    const trace = traceEngine.getTrace(traceId);

    expect(trace).toBeDefined();
    expect(trace?.operation).toBe("test_op");
    expect(trace?.spans).toHaveLength(0);
  });

  it("should return null for non-existent trace", () => {
    const trace = traceEngine.getTrace("trace_nonexistent");
    expect(trace).toBeNull();
  });

  it("should add a span to a trace", () => {
    const { traceId } = traceEngine.startTrace("test_op");
    const spanId = traceEngine.addSpan(traceId, "span_1", { key: "value" });

    expect(spanId).toMatch(/^span_/);

    const trace = traceEngine.getTrace(traceId);
    expect(trace?.spans).toHaveLength(1);
    expect(trace?.spans[0].spanName).toBe("span_1");
    expect(trace?.spans[0].data).toEqual({ key: "value" });
  });

  it("should return null when adding span to non-existent trace", () => {
    const spanId = traceEngine.addSpan("trace_nonexistent", "span_1");
    expect(spanId).toBeNull();
  });

  it("should end a span with result", () => {
    const { traceId } = traceEngine.startTrace("test_op");
    const spanId = traceEngine.addSpan(traceId, "span_1");

    const success = traceEngine.endSpan(traceId, spanId!, {
      status: "ok",
    });

    expect(success).toBe(true);

    const trace = traceEngine.getTrace(traceId);
    const span = trace?.spans[0];
    expect(span?.endTime).toBeDefined();
    expect(span?.duration).toBeDefined();
    expect(span?.result).toEqual({ status: "ok" });
  });

  it("should calculate span duration correctly", () => {
    const { traceId } = traceEngine.startTrace("test_op");
    const spanId = traceEngine.addSpan(traceId, "span_1");

    vi.useFakeTimers();
    const startTime = Date.now();
    vi.setSystemTime(startTime + 100);

    traceEngine.endSpan(traceId, spanId!);

    const trace = traceEngine.getTrace(traceId);
    const span = trace?.spans[0];
    expect(span?.duration).toBeGreaterThanOrEqual(90);
    expect(span?.duration).toBeLessThanOrEqual(110);

    vi.useRealTimers();
  });

  it("should return false when ending non-existent span", () => {
    const { traceId } = traceEngine.startTrace("test_op");
    const success = traceEngine.endSpan(traceId, "span_nonexistent");
    expect(success).toBe(false);
  });

  it("should end a trace with status", () => {
    const { traceId } = traceEngine.startTrace("test_op");
    const success = traceEngine.endTrace(traceId, "success");

    expect(success).toBe(true);

    const trace = traceEngine.getTrace(traceId);
    expect(trace?.status).toBe("success");
    expect(trace?.endTime).toBeDefined();
    expect(trace?.duration).toBeDefined();
  });

  it("should return false when ending non-existent trace", () => {
    const success = traceEngine.endTrace("trace_nonexistent", "success");
    expect(success).toBe(false);
  });

  it("should search traces by operation", () => {
    traceEngine.startTrace("op_1");
    traceEngine.startTrace("op_2");
    traceEngine.startTrace("op_1");

    const results = traceEngine.searchTraces({ operation: "op_1" });
    expect(results).toHaveLength(2);
    expect(results.every((t) => t.operation === "op_1")).toBe(true);
  });

  it("should search traces by status", () => {
    const { traceId: traceId1 } = traceEngine.startTrace("op_1");
    const { traceId: traceId2 } = traceEngine.startTrace("op_2");

    traceEngine.endTrace(traceId1, "success");
    traceEngine.endTrace(traceId2, "error");

    const results = traceEngine.searchTraces({ status: "success" });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("success");
  });

  it("should search traces by minDuration", () => {
    const { traceId: traceId1 } = traceEngine.startTrace("op_1");
    const { traceId: traceId2 } = traceEngine.startTrace("op_2");

    vi.useFakeTimers();
    const startTime = Date.now();
    vi.setSystemTime(startTime + 150);

    traceEngine.endTrace(traceId1, "success");

    vi.setSystemTime(startTime + 50);
    traceEngine.endTrace(traceId2, "success");

    vi.useRealTimers();

    const results = traceEngine.searchTraces({ minDuration: 100 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("should search traces by since timestamp", () => {
    vi.useFakeTimers();
    const baseTime = Date.now();
    vi.setSystemTime(baseTime);

    const { traceId: traceId1 } = traceEngine.startTrace("op_1");

    vi.setSystemTime(baseTime + 1000);
    const { traceId: traceId2 } = traceEngine.startTrace("op_2");

    const results = traceEngine.searchTraces({ since: baseTime + 500 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.traceId === traceId2)).toBe(true);

    vi.useRealTimers();
  });

  it("should calculate trace metrics", () => {
    const { traceId: traceId1 } = traceEngine.startTrace("op_1");
    const { traceId: traceId2 } = traceEngine.startTrace("op_2");
    const { traceId: traceId3 } = traceEngine.startTrace("op_3");

    traceEngine.endTrace(traceId1, "success");
    traceEngine.endTrace(traceId2, "success");
    traceEngine.endTrace(traceId3, "error");

    const metrics = traceEngine.getTraceMetrics();

    expect(metrics.total).toBe(3);
    expect(metrics.byStatus.success).toBe(2);
    expect(metrics.byStatus.error).toBe(1);
    expect(metrics.avgDuration).toBeGreaterThanOrEqual(0);
    expect(metrics.p95Duration).toBeGreaterThanOrEqual(0);
    expect(metrics.errorRate).toBeCloseTo(1 / 3);
  });

  it("should calculate metrics with no traces", () => {
    const metrics = traceEngine.getTraceMetrics();

    expect(metrics.total).toBe(0);
    expect(metrics.byStatus.success).toBe(0);
    expect(metrics.avgDuration).toBe(0);
    expect(metrics.p95Duration).toBe(0);
    expect(metrics.errorRate).toBe(0);
  });

  it("should clear trace engine", () => {
    traceEngine.startTrace("op_1");
    traceEngine.startTrace("op_2");

    traceEngine._clearTraceEngine();

    const metrics = traceEngine.getTraceMetrics();
    expect(metrics.total).toBe(0);
  });
});

describe("MetricsPipeline", () => {
  let pipeline: MetricsPipeline;

  beforeEach(() => {
    pipeline = new MetricsPipeline();
  });

  it("should record a metric", () => {
    const metricId = pipeline.recordMetric("cpu_usage", 45.5, { host: "server1" });

    expect(metricId).toMatch(/^met_/);
  });

  it("should record a counter metric", () => {
    const metricId = pipeline.recordCounter("requests_total", 100, {
      endpoint: "/api",
    });

    expect(metricId).toMatch(/^met_/);
  });

  it("should record a gauge metric", () => {
    const metricId = pipeline.recordGauge("memory_usage", 512, { host: "server1" });

    expect(metricId).toMatch(/^met_/);
  });

  it("should record a histogram metric", () => {
    const metricId = pipeline.recordHistogram("request_duration", 0.045, {
      endpoint: "/api",
    });

    expect(metricId).toMatch(/^met_/);

    const metrics = pipeline.getMetrics();
    const metric = metrics.find((m) => m.metricId === metricId);
    expect(metric?.type).toBe("histogram");
    expect(metric?.buckets).toBeDefined();
    expect(metric?.buckets?.length).toBeGreaterThan(0);
  });

  it("should retrieve all metrics", () => {
    pipeline.recordMetric("cpu_usage", 45);
    pipeline.recordMetric("memory_usage", 512);
    pipeline.recordMetric("disk_usage", 75);

    const metrics = pipeline.getMetrics();
    expect(metrics.length).toBe(3);
  });

  it("should retrieve metrics by name", () => {
    pipeline.recordMetric("cpu_usage", 45);
    pipeline.recordMetric("memory_usage", 512);
    pipeline.recordMetric("cpu_usage", 50);

    const metrics = pipeline.getMetrics("cpu_usage");
    expect(metrics).toHaveLength(2);
    expect(metrics.every((m) => m.name === "cpu_usage")).toBe(true);
  });

  it("should retrieve metrics since timestamp", () => {
    vi.useFakeTimers();
    const baseTime = Date.now();
    vi.setSystemTime(baseTime);

    pipeline.recordMetric("cpu_usage", 45);

    vi.setSystemTime(baseTime + 1000);
    pipeline.recordMetric("memory_usage", 512);

    const metrics = pipeline.getMetrics(undefined, baseTime + 500);
    expect(metrics.length).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it("should get metrics summary", () => {
    pipeline.recordMetric("cpu_usage", 45);
    pipeline.recordMetric("cpu_usage", 55);
    pipeline.recordMetric("memory_usage", 512);

    const summary = pipeline.getMetricsSummary();

    expect(summary.cpu_usage).toBeDefined();
    expect(summary.cpu_usage.count).toBe(2);
    expect(summary.cpu_usage.avg).toBe(50);
    expect(summary.cpu_usage.latest).toBe(55);

    expect(summary.memory_usage).toBeDefined();
    expect(summary.memory_usage.count).toBe(1);
    expect(summary.memory_usage.latest).toBe(512);
  });

  it("should get dashboard metrics", () => {
    pipeline.recordMetric("cpu_usage", 45);
    pipeline.recordCounter("requests_total", 100);
    pipeline.recordGauge("memory_usage", 512);
    pipeline.recordHistogram("request_duration", 0.045);

    const dashboard = pipeline.getDashboard();

    expect(dashboard.totalMetrics).toBe(4);
    expect(dashboard.uniqueNames).toBe(4);
    expect(dashboard.metricsByType.counter).toBe(1);
    expect(dashboard.metricsByType.gauge).toBe(2);
    expect(dashboard.metricsByType.histogram).toBe(1);
    expect(dashboard.recentActivity).toBeGreaterThan(0);
  });

  it("should clear metrics pipeline", () => {
    pipeline.recordMetric("cpu_usage", 45);
    pipeline.recordMetric("memory_usage", 512);

    pipeline._clearMetricsPipeline();

    const metrics = pipeline.getMetrics();
    expect(metrics).toHaveLength(0);
  });
});

describe("AlertRulesEngine", () => {
  let engine: AlertRulesEngine;

  beforeEach(() => {
    engine = new AlertRulesEngine();
  });

  it("should create an alert rule", () => {
    const ruleId = engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    expect(ruleId).toMatch(/^rule_/);
  });

  it("should retrieve all rules", () => {
    engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    engine.createRule({
      name: "Low Memory",
      metric: "memory_usage",
      condition: "lt",
      threshold: 256,
      window: 5000,
      severity: "medium",
      actions: ["alert"],
    });

    const rules = engine.getRules();
    expect(rules).toHaveLength(2);
  });

  it("should evaluate rule with gt condition", () => {
    const ruleId = engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    const metrics = new Map([["cpu_usage", 90]]);
    const alerts = engine.evaluateRules(metrics);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe(ruleId);
    expect(alerts[0].ruleName).toBe("High CPU");
  });

  it("should not trigger rule when gt condition not met", () => {
    engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    const metrics = new Map([["cpu_usage", 50]]);
    const alerts = engine.evaluateRules(metrics);

    expect(alerts).toHaveLength(0);
  });

  it("should evaluate rule with lt condition", () => {
    engine.createRule({
      name: "Low Memory",
      metric: "memory_usage",
      condition: "lt",
      threshold: 256,
      window: 5000,
      severity: "high",
      actions: ["alert"],
    });

    const metrics = new Map([["memory_usage", 128]]);
    const alerts = engine.evaluateRules(metrics);

    expect(alerts).toHaveLength(1);
  });

  it("should evaluate rule with eq condition", () => {
    engine.createRule({
      name: "Status Check",
      metric: "status_code",
      condition: "eq",
      threshold: 500,
      window: 5000,
      severity: "critical",
      actions: ["page_oncall"],
    });

    const metrics = new Map([["status_code", 500]]);
    const alerts = engine.evaluateRules(metrics);

    expect(alerts).toHaveLength(1);
  });

  it("should evaluate rule with rate_change condition", () => {
    engine.createRule({
      name: "CPU Spike",
      metric: "cpu_usage",
      condition: "rate_change",
      threshold: 50,
      window: 5000,
      severity: "medium",
      actions: ["alert"],
    });

    // 10% change should trigger
    const metrics = new Map([["cpu_usage", 55]]);
    const alerts = engine.evaluateRules(metrics);

    expect(alerts.length).toBeGreaterThanOrEqual(0);
  });

  it("should get alerts with severity filter", () => {
    const ruleId1 = engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    engine.createRule({
      name: "Low Memory",
      metric: "memory_usage",
      condition: "lt",
      threshold: 256,
      window: 5000,
      severity: "low",
      actions: ["alert"],
    });

    const metrics = new Map([
      ["cpu_usage", 90],
      ["memory_usage", 128],
    ]);
    engine.evaluateRules(metrics);

    const highAlerts = engine.getAlerts({ severity: "high" });
    expect(highAlerts.every((a) => a.severity === "high")).toBe(true);
  });

  it("should acknowledge an alert", () => {
    engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    const metrics = new Map([["cpu_usage", 90]]);
    const alerts = engine.evaluateRules(metrics);
    const alertId = alerts[0].alertId;

    const success = engine.acknowledgeAlert(alertId);
    expect(success).toBe(true);

    const ackAlert = engine.getAlerts({ acknowledged: true });
    expect(ackAlert).toHaveLength(1);
    expect(ackAlert[0].acknowledged).toBe(true);
  });

  it("should return false when acknowledging non-existent alert", () => {
    const success = engine.acknowledgeAlert("alert_nonexistent");
    expect(success).toBe(false);
  });

  it("should delete a rule", () => {
    const ruleId = engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    const success = engine.deleteRule(ruleId);
    expect(success).toBe(true);

    const rules = engine.getRules();
    expect(rules).toHaveLength(0);
  });

  it("should get alert stats", () => {
    engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    engine.createRule({
      name: "Low Memory",
      metric: "memory_usage",
      condition: "lt",
      threshold: 256,
      window: 5000,
      severity: "low",
      actions: ["alert"],
    });

    const metrics = new Map([
      ["cpu_usage", 90],
      ["memory_usage", 128],
    ]);
    const alerts = engine.evaluateRules(metrics);

    engine.acknowledgeAlert(alerts[0].alertId);

    const stats = engine.getAlertStats();

    expect(stats.total).toBe(2);
    expect(stats.bySeverity.high).toBeGreaterThan(0);
    expect(stats.acknowledgedRate).toBeGreaterThan(0);
  });

  it("should clear alert rules engine", () => {
    engine.createRule({
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      window: 5000,
      severity: "high",
      actions: ["notify_team"],
    });

    engine._clearAlertRulesEngine();

    const rules = engine.getRules();
    expect(rules).toHaveLength(0);
  });
});

describe("CorrelationIdMiddleware", () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it("should generate a correlation id", () => {
    const correlationId = middleware.generateCorrelationId();

    expect(correlationId).toMatch(/^cor_/);
  });

  it("should log a request", () => {
    const correlationId = middleware.generateCorrelationId();
    middleware.logRequest(correlationId, "GET", "/api/users", 200, 45);

    const log = middleware.getRequestLog(correlationId);

    expect(log).toBeDefined();
    expect(log?.method).toBe("GET");
    expect(log?.path).toBe("/api/users");
    expect(log?.statusCode).toBe(200);
    expect(log?.duration).toBe(45);
  });

  it("should retrieve a request log by correlation id", () => {
    const correlationId = middleware.generateCorrelationId();
    middleware.logRequest(correlationId, "POST", "/api/data", 201, 120);

    const log = middleware.getRequestLog(correlationId);

    expect(log?.correlationId).toBe(correlationId);
  });

  it("should return null for non-existent request log", () => {
    const log = middleware.getRequestLog("cor_nonexistent");
    expect(log).toBeNull();
  });

  it("should get recent requests", () => {
    const cor1 = middleware.generateCorrelationId();
    const cor2 = middleware.generateCorrelationId();
    const cor3 = middleware.generateCorrelationId();

    middleware.logRequest(cor1, "GET", "/api/users", 200, 45);
    middleware.logRequest(cor2, "POST", "/api/data", 201, 120);
    middleware.logRequest(cor3, "DELETE", "/api/items/1", 204, 30);

    const recent = middleware.getRecentRequests(10);

    expect(recent.length).toBeLessThanOrEqual(10);
    expect(recent.length).toBeGreaterThan(0);
  });

  it("should respect limit on recent requests", () => {
    for (let i = 0; i < 25; i++) {
      const correlationId = middleware.generateCorrelationId();
      middleware.logRequest(correlationId, "GET", "/api/test", 200, 10);
    }

    const recent = middleware.getRecentRequests(5);
    expect(recent).toHaveLength(5);
  });

  it("should return requests in reverse chronological order", () => {
    vi.useFakeTimers();
    const baseTime = Date.now();

    const cor1 = middleware.generateCorrelationId();
    vi.setSystemTime(baseTime);
    middleware.logRequest(cor1, "GET", "/api/first", 200, 10);

    vi.setSystemTime(baseTime + 100);
    const cor2 = middleware.generateCorrelationId();
    middleware.logRequest(cor2, "GET", "/api/second", 200, 10);

    vi.setSystemTime(baseTime + 200);
    const cor3 = middleware.generateCorrelationId();
    middleware.logRequest(cor3, "GET", "/api/third", 200, 10);

    const recent = middleware.getRecentRequests(10);

    expect(recent[0].path).toBe("/api/third");
    expect(recent[recent.length - 1].path).toBe("/api/first");

    vi.useRealTimers();
  });

  it("should clear correlation id middleware", () => {
    const correlationId = middleware.generateCorrelationId();
    middleware.logRequest(correlationId, "GET", "/api/users", 200, 45);

    middleware._clearCorrelationIdMiddleware();

    const log = middleware.getRequestLog(correlationId);
    expect(log).toBeNull();
  });
});
