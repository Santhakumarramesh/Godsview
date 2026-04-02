/**
 * metrics_execution_unit.test.ts — Phase 68
 *
 * Tests collectAllMetrics() — verifies it produces valid Prometheus output
 * with execution-layer metrics appended to core metrics.
 * Mocks all sub-system dependencies.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() })),
  },
}));

vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: vi.fn(() => ({
    level: "NORMAL",
    realized_pnl_today: -250,
    unrealized_pnl: 150,
    consecutive_losses: 1,
    position_size_multiplier: 1.0,
    trades_today: 4,
    wins_today: 3,
    losses_today: 1,
    hourly_pnl_velocity: 50,
  })),
}));

vi.mock("../lib/fill_reconciler", () => ({
  getReconciliationSnapshot: vi.fn(() => ({
    fills_today: 8,
    unmatched_fills: 0,
  })),
}));

vi.mock("../lib/position_monitor", () => ({
  getManagedPositions: vi.fn(() => [
    { symbol: "BTCUSD", trail_active: true },
    { symbol: "ETHUSD", trail_active: false },
  ]),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => false),
  getRiskEngineSnapshot: vi.fn(() => ({})),
}));

vi.mock("../lib/production_gate", () => ({
  getProductionGateStats: vi.fn(() => ({ daily_trades: 4 })),
}));

vi.mock("../lib/alerts", () => ({
  getAlertHistory: vi.fn(() => [
    { type: "ensemble_drift", severity: "warning", acknowledged: false, timestamp: new Date().toISOString(), message: "", details: {} },
  ]),
}));

import { getBreakerSnapshot } from "../lib/drawdown_breaker";
import { collectAllMetrics } from "../lib/metrics_execution";

// ── collectAllMetrics ─────────────────────────────────────────────────────────

describe("collectAllMetrics", () => {
  it("returns a non-empty string", () => {
    const output = collectAllMetrics();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("includes core metrics (HTTP requests)", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_http_requests_total");
  });

  it("includes drawdown breaker metrics", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_breaker_level");
    expect(output).toContain("godsview_breaker_realized_pnl_usd");
    expect(output).toContain("godsview_breaker_consecutive_losses");
  });

  it("includes fill reconciler metrics", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_fills_today_total");
    expect(output).toContain("godsview_unmatched_fills_total");
  });

  it("includes managed positions count", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_managed_positions");
  });

  it("includes per-position trail_active gauge", () => {
    const output = collectAllMetrics();
    expect(output).toContain('symbol="BTCUSD"');
    expect(output).toContain('symbol="ETHUSD"');
  });

  it("includes kill switch metric", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_kill_switch");
  });

  it("includes production gate daily trades", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_gate_daily_trades");
  });

  it("includes active alerts gauge", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_active_alerts");
    // 1 unacknowledged alert → value 1
    expect(output).toContain("godsview_active_alerts 1");
  });

  it("ends with a newline", () => {
    const output = collectAllMetrics();
    expect(output.endsWith("\n")).toBe(true);
  });

  it("NORMAL breaker level maps to 0", () => {
    const output = collectAllMetrics();
    expect(output).toContain("godsview_breaker_level 0");
  });

  it("handles sub-system errors gracefully (continues collecting)", () => {
    // Even if a sub-system throws, collectAllMetrics should not throw
    vi.mocked(getBreakerSnapshot).mockImplementationOnce(() => {
      throw new Error("Breaker not initialized");
    });
    expect(() => collectAllMetrics()).not.toThrow();
    // Core metrics should still be present
    const output = collectAllMetrics();
    expect(output).toContain("godsview_http_requests_total");
  });
});
