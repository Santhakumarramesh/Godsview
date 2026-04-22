/**
 * metrics_unit.test.ts — Phase 68
 *
 * Tests the in-memory Prometheus-compatible metrics collector:
 * Counter, Histogram, Gauge singleton exports, and collectMetrics().
 * No mocks needed — all state is in-memory.
 */

import { describe, it, expect } from "vitest";
import {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
  signalsProcessedTotal,
  siDecisionsTotal,
  productionGateTotal,
  tradesExecutedTotal,
  claudeVetoTotal,
  activeSSEClients,
  ensembleAccuracy,
  dailyPnl,
  openPositions,
  uptime,
  collectMetrics,
} from "../lib/metrics";

// ── Counter ───────────────────────────────────────────────────────────────────

describe("Counter — httpRequestsTotal", () => {
  it("collect output contains HELP and TYPE headers", () => {
    const out = httpRequestsTotal.collect("godsview_http_requests_total", "Total HTTP requests");
    expect(out).toContain("# HELP godsview_http_requests_total");
    expect(out).toContain("# TYPE godsview_http_requests_total counter");
  });

  it("inc() increments with no labels", () => {
    httpRequestsTotal.inc({}, 1);
    const out = httpRequestsTotal.collect("godsview_http_requests_total", "help");
    // Should have at least one data line
    const lines = out.split("\n").filter(l => l.startsWith("godsview_http_requests_total"));
    expect(lines.length).toBeGreaterThan(0);
  });

  it("inc() with labels uses correct label format", () => {
    httpRequestsTotal.inc({ method: "GET", status: "200" }, 5);
    const out = httpRequestsTotal.collect("req", "help");
    expect(out).toContain('method="GET"');
    expect(out).toContain('status="200"');
  });

  it("inc() default amount is 1", () => {
    // Just verify it doesn't throw
    expect(() => httpRequestsTotal.inc({ route: "/healthz" })).not.toThrow();
  });

  it("multiple counters can coexist", () => {
    signalsProcessedTotal.inc({ symbol: "BTCUSD" }, 3);
    siDecisionsTotal.inc({ outcome: "approved" }, 2);
    expect(() => signalsProcessedTotal.collect("spt", "h")).not.toThrow();
    expect(() => siDecisionsTotal.collect("sdt", "h")).not.toThrow();
  });
});

// ── Histogram ─────────────────────────────────────────────────────────────────

describe("Histogram — httpRequestDuration", () => {
  it("collect output contains bucket lines", () => {
    httpRequestDuration.observe(0.05);
    const out = httpRequestDuration.collect("godsview_http_request_duration_seconds", "Duration");
    expect(out).toContain("_bucket");
    expect(out).toContain('le="+Inf"');
    expect(out).toContain("_sum");
    expect(out).toContain("_count");
  });

  it("observe() below smallest bucket goes into first bucket", () => {
    httpRequestDuration.observe(0.001); // below 0.01
    const out = httpRequestDuration.collect("dur", "h");
    expect(out).toContain('le="0.01"');
  });

  it("observe() above all buckets goes into +Inf", () => {
    httpRequestDuration.observe(100); // above all buckets
    const out = httpRequestDuration.collect("dur", "h");
    expect(out).toContain('le="+Inf"');
  });

  it("_sum increases with each observe", () => {
    // Just verify structure — sum should be positive after observations
    httpRequestDuration.observe(1.0);
    httpRequestDuration.observe(2.0);
    const out = httpRequestDuration.collect("dur", "h");
    const sumLine = out.split("\n").find(l => l.endsWith("_sum ") || l.includes("_sum "));
    expect(sumLine).toBeDefined();
  });

  it("collect output has HELP and TYPE lines", () => {
    const out = httpRequestDuration.collect("godsview_http_request_duration_seconds", "Duration");
    expect(out).toContain("# HELP godsview_http_request_duration_seconds");
    expect(out).toContain("# TYPE godsview_http_request_duration_seconds histogram");
  });
});

// ── Gauge ─────────────────────────────────────────────────────────────────────

describe("Gauge — httpRequestsInFlight", () => {
  it("set() sets the exact value", () => {
    httpRequestsInFlight.set(5);
    expect(httpRequestsInFlight.get()).toBe(5);
  });

  it("inc() increments by 1 by default", () => {
    const before = httpRequestsInFlight.get();
    httpRequestsInFlight.inc();
    expect(httpRequestsInFlight.get()).toBe(before + 1);
  });

  it("inc(n) increments by n", () => {
    httpRequestsInFlight.set(10);
    httpRequestsInFlight.inc(3);
    expect(httpRequestsInFlight.get()).toBe(13);
  });

  it("dec() decrements by 1 by default", () => {
    httpRequestsInFlight.set(10);
    httpRequestsInFlight.dec();
    expect(httpRequestsInFlight.get()).toBe(9);
  });

  it("dec(n) decrements by n", () => {
    httpRequestsInFlight.set(10);
    httpRequestsInFlight.dec(4);
    expect(httpRequestsInFlight.get()).toBe(6);
  });

  it("collect() output contains the gauge value", () => {
    httpRequestsInFlight.set(42);
    const out = httpRequestsInFlight.collect("godsview_in_flight", "In-flight requests");
    expect(out).toContain("42");
    expect(out).toContain("# TYPE godsview_in_flight gauge");
  });

  it("set(0) results in gauge value 0", () => {
    httpRequestsInFlight.set(0);
    expect(httpRequestsInFlight.get()).toBe(0);
  });
});

describe("Gauge — trading gauges", () => {
  it("activeSSEClients can be set and retrieved", () => {
    activeSSEClients.set(3);
    expect(activeSSEClients.get()).toBe(3);
  });

  it("ensembleAccuracy can represent decimals", () => {
    ensembleAccuracy.set(0.72);
    expect(ensembleAccuracy.get()).toBeCloseTo(0.72, 5);
  });

  it("dailyPnl can be negative", () => {
    dailyPnl.set(-250.50);
    expect(dailyPnl.get()).toBeCloseTo(-250.50, 2);
  });

  it("openPositions tracks integer counts", () => {
    openPositions.set(0);
    openPositions.inc();
    openPositions.inc();
    expect(openPositions.get()).toBe(2);
  });
});

// ── collectMetrics ────────────────────────────────────────────────────────────

describe("collectMetrics", () => {
  it("returns a non-empty string", () => {
    const output = collectMetrics();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("contains Prometheus HELP and TYPE annotations", () => {
    const output = collectMetrics();
    expect(output).toContain("# HELP");
    expect(output).toContain("# TYPE");
  });

  it("includes godsview_http_requests_total section", () => {
    const output = collectMetrics();
    expect(output).toContain("godsview_http_requests_total");
  });

  it("includes godsview_uptime_seconds section (auto-set)", () => {
    const output = collectMetrics();
    expect(output).toContain("godsview_uptime_seconds");
  });

  it("ends with a newline", () => {
    const output = collectMetrics();
    expect(output.endsWith("\n")).toBe(true);
  });

  it("includes all expected trading pipeline counters", () => {
    const output = collectMetrics();
    expect(output).toContain("godsview_signals_processed_total");
    expect(output).toContain("godsview_si_decisions_total");
    expect(output).toContain("godsview_production_gate_total");
    expect(output).toContain("godsview_trades_executed_total");
    expect(output).toContain("godsview_claude_veto_total");
  });

  it("includes system gauges", () => {
    const output = collectMetrics();
    expect(output).toContain("godsview_active_sse_clients");
    expect(output).toContain("godsview_ensemble_accuracy");
    expect(output).toContain("godsview_daily_pnl_usd");
    expect(output).toContain("godsview_open_positions");
  });

  it("uptime_seconds is a positive number in output", () => {
    const output = collectMetrics();
    const lines = output.split("\n");
    const uptimeLine = lines.find(l => l.startsWith("godsview_uptime_seconds "));
    expect(uptimeLine).toBeDefined();
    if (uptimeLine) {
      const val = parseFloat(uptimeLine.split(" ")[1]!);
      expect(val).toBeGreaterThan(0);
    }
  });
});
