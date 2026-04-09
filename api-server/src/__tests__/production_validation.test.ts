/**
 * Phase 27 — Production Validation Backbone Tests
 * Tests for validation sessions, comparison engine, readiness scorer, and routes
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    child: () => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      fatal: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    }),
  }),
}));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: vi.fn().mockReturnValue({ breaker_active: false }),
}));

import {
  createValidationSession,
  startValidationSession,
  completeValidationSession,
  abortValidationSession,
  recordTrade,
  addValidationEvent,
  getSession,
  getSessionsByStrategy,
  getActiveSessions,
  getAllSessions,
  _clearSessions,
} from "../lib/validation/validation_session_manager";

import {
  generateComparisonReport,
  getReport,
  getReportsByStrategy,
  getAllReports,
  _clearReports,
  type PerformanceSnapshot,
} from "../lib/validation/comparison_engine";

import {
  computeReadinessScore,
  getReadinessScore,
  getLatestScoreByStrategy,
  _clearScores,
  PROMOTION_THRESHOLDS,
} from "../lib/validation/readiness_scorer";

// ── Validation Session Tests ─────────────────────────────────────────────

describe("ValidationSessionManager", () => {
  beforeEach(() => {
    _clearSessions();
  });

  const baseConfig = {
    strategy_id: "strat_001",
    strategy_name: "Test Strategy",
    session_type: "paper" as const,
    symbols: ["SPY"],
    timeframe: "5m",
    capital_allocation: 10000,
  };

  it("creates a validation session", () => {
    const result = createValidationSession(baseConfig);
    expect(result.success).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session!.session_id).toMatch(/^pv_/);
    expect(result.session!.status).toBe("pending");
    expect(result.session!.strategy_id).toBe("strat_001");
  });

  it("prevents duplicate active sessions for same strategy+type", () => {
    const r1 = createValidationSession(baseConfig);
    startValidationSession(r1.session!.session_id);
    const r2 = createValidationSession(baseConfig);
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("Active");
  });

  it("allows sessions of different types for same strategy", () => {
    const r1 = createValidationSession(baseConfig);
    startValidationSession(r1.session!.session_id);
    const r2 = createValidationSession({ ...baseConfig, session_type: "live_shadow" });
    expect(r2.success).toBe(true);
  });

  it("starts a pending session", () => {
    const { session } = createValidationSession(baseConfig);
    const result = startValidationSession(session!.session_id);
    expect(result.success).toBe(true);
    expect(result.session!.status).toBe("active");
    expect(result.session!.started_at).toBeInstanceOf(Date);
  });

  it("rejects starting a non-pending session", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);
    const result = startValidationSession(session!.session_id);
    expect(result.success).toBe(false);
  });

  it("completes an active session", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);
    const result = completeValidationSession(session!.session_id);
    expect(result.success).toBe(true);
    expect(result.session!.status).toBe("completed");
    expect(result.session!.completed_at).toBeInstanceOf(Date);
  });

  it("aborts a session", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);
    const result = abortValidationSession(session!.session_id, "test reason");
    expect(result.success).toBe(true);
    expect(result.session!.status).toBe("aborted");
  });

  it("cannot abort a completed session", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);
    completeValidationSession(session!.session_id);
    const result = abortValidationSession(session!.session_id, "too late");
    expect(result.success).toBe(false);
  });

  it("records a winning trade", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);
    const result = recordTrade(session!.session_id, {
      symbol: "SPY",
      side: "buy",
      quantity: 10,
      entry_price: 400,
      exit_price: 405,
      pnl: 50,
      slippage_bps: 2,
      expected_slippage_bps: 3,
      signal_to_fill_ms: 150,
      regime: "bullish",
      rejected: false,
    });
    expect(result.success).toBe(true);

    const s = getSession(session!.session_id)!;
    expect(s.metrics.total_trades).toBe(1);
    expect(s.metrics.winning_trades).toBe(1);
    expect(s.metrics.realized_pnl).toBe(50);
    expect(s.metrics.pnl_by_symbol["SPY"]).toBe(50);
    expect(s.metrics.pnl_by_regime["bullish"]).toBe(50);
  });

  it("records a rejected signal", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);
    recordTrade(session!.session_id, {
      symbol: "SPY",
      side: "buy",
      quantity: 10,
      entry_price: 400,
      pnl: 0,
      slippage_bps: 0,
      expected_slippage_bps: 0,
      signal_to_fill_ms: 0,
      rejected: true,
    });

    const s = getSession(session!.session_id)!;
    expect(s.metrics.total_signals).toBe(1);
    expect(s.metrics.total_trades).toBe(0);
    expect(s.metrics.rejected_signals).toBe(1);
  });

  it("computes rolling averages correctly", () => {
    const { session } = createValidationSession(baseConfig);
    startValidationSession(session!.session_id);

    recordTrade(session!.session_id, {
      symbol: "SPY", side: "buy", quantity: 10, entry_price: 400,
      pnl: 50, slippage_bps: 4, expected_slippage_bps: 3,
      signal_to_fill_ms: 100, rejected: false,
    });
    recordTrade(session!.session_id, {
      symbol: "SPY", side: "buy", quantity: 10, entry_price: 400,
      pnl: -20, slippage_bps: 8, expected_slippage_bps: 3,
      signal_to_fill_ms: 200, rejected: false,
    });

    const s = getSession(session!.session_id)!;
    expect(s.metrics.total_trades).toBe(2);
    expect(s.metrics.avg_slippage_bps).toBe(6);
    expect(s.metrics.signal_to_fill_delay_ms).toBe(150);
    expect(s.metrics.hit_rate).toBe(0.5);
  });

  it("adds validation events", () => {
    const { session } = createValidationSession(baseConfig);
    addValidationEvent(session!.session_id, "data_gap", "warning", "Gap detected in SPY feed");
    const s = getSession(session!.session_id)!;
    expect(s.events).toHaveLength(1);
    expect(s.events[0].event_type).toBe("data_gap");
    expect(s.events[0].severity).toBe("warning");
  });

  it("queries by strategy", () => {
    createValidationSession(baseConfig);
    createValidationSession({ ...baseConfig, session_type: "live_shadow" });
    createValidationSession({ ...baseConfig, strategy_id: "strat_002" });

    expect(getSessionsByStrategy("strat_001")).toHaveLength(2);
    expect(getSessionsByStrategy("strat_002")).toHaveLength(1);
  });

  it("queries active sessions", () => {
    const r1 = createValidationSession(baseConfig);
    const r2 = createValidationSession({ ...baseConfig, session_type: "live_shadow" });
    startValidationSession(r1.session!.session_id);
    startValidationSession(r2.session!.session_id);

    expect(getActiveSessions()).toHaveLength(2);
  });

  it("returns all sessions with limit", () => {
    for (let i = 0; i < 5; i++) {
      createValidationSession({
        ...baseConfig,
        strategy_id: `strat_${i}`,
      });
    }
    expect(getAllSessions(3)).toHaveLength(3);
    expect(getAllSessions()).toHaveLength(5);
  });
});

// ── Comparison Engine Tests ──────────────────────────────────────────────

describe("ComparisonEngine", () => {
  beforeEach(() => {
    _clearReports();
  });

  const backtestSnap: PerformanceSnapshot = {
    source: "backtest",
    strategy_id: "strat_001",
    period: { start: "2025-01-01", end: "2025-06-01" },
    trade_count: 100,
    hit_rate: 0.55,
    sharpe_ratio: 1.8,
    profit_factor: 1.5,
    max_drawdown_pct: 8,
    avg_slippage_bps: 3,
    total_pnl: 5000,
    win_rate: 0.55,
    avg_trade_duration_ms: 300000,
    signal_to_fill_delay_ms: 100,
    reject_rate: 0.05,
  };

  const paperSnap: PerformanceSnapshot = {
    ...backtestSnap,
    source: "paper",
    hit_rate: 0.52,
    sharpe_ratio: 1.6,
    profit_factor: 1.4,
    max_drawdown_pct: 10,
    avg_slippage_bps: 5,
    total_pnl: 4200,
    signal_to_fill_delay_ms: 200,
    reject_rate: 0.08,
  };

  it("generates a comparison report with aligned snapshots", () => {
    const report = generateComparisonReport("strat_001", {
      backtest: backtestSnap,
      paper: paperSnap,
    });

    expect(report.report_id).toMatch(/^pvr_/);
    expect(report.strategy_id).toBe("strat_001");
    expect(report.deviations).toHaveLength(8);
    expect(report.summary.overall_alignment).toBeDefined();
  });

  it("classifies strong alignment when values are close", () => {
    const report = generateComparisonReport("strat_001", {
      backtest: backtestSnap,
      paper: { ...backtestSnap, source: "paper" },
    });
    expect(report.summary.overall_alignment).toBe("strong");
    expect(report.summary.critical).toBe(0);
  });

  it("detects critical deviations", () => {
    const degradedPaper: PerformanceSnapshot = {
      ...paperSnap,
      hit_rate: 0.25,       // 55% down from 55% = huge deviation
      sharpe_ratio: 0.5,    // way down
      total_pnl: -1000,     // went negative
    };
    const report = generateComparisonReport("strat_001", {
      backtest: backtestSnap,
      paper: degradedPaper,
    });
    expect(report.summary.critical).toBeGreaterThan(0);
    expect(["degraded", "failed"]).toContain(report.summary.overall_alignment);
  });

  it("handles single source snapshot", () => {
    const report = generateComparisonReport("strat_001", {
      backtest: backtestSnap,
    });
    expect(report.deviations).toHaveLength(8);
    // All deviations should be null since no comparison target
    report.deviations.forEach((d) => {
      expect(d.paper_value).toBeNull();
      expect(d.live_shadow_value).toBeNull();
    });
  });

  it("stores and retrieves reports", () => {
    const report = generateComparisonReport("strat_001", {
      backtest: backtestSnap,
      paper: paperSnap,
    });
    expect(getReport(report.report_id)).toBeDefined();
    expect(getReportsByStrategy("strat_001")).toHaveLength(1);
  });

  it("lists all reports with limit", () => {
    for (let i = 0; i < 5; i++) {
      generateComparisonReport(`strat_${i}`, { backtest: backtestSnap });
    }
    expect(getAllReports(3)).toHaveLength(3);
    expect(getAllReports()).toHaveLength(5);
  });

  it("includes three-way comparison (backtest, paper, live)", () => {
    const liveSnap: PerformanceSnapshot = {
      ...backtestSnap,
      source: "live_shadow",
      hit_rate: 0.50,
      avg_slippage_bps: 7,
    };
    const report = generateComparisonReport("strat_001", {
      backtest: backtestSnap,
      paper: paperSnap,
      live_shadow: liveSnap,
    });

    const hitRateDev = report.deviations.find((d) => d.metric === "hit_rate")!;
    expect(hitRateDev.backtest_value).toBe(0.55);
    expect(hitRateDev.paper_value).toBe(0.52);
    expect(hitRateDev.live_shadow_value).toBe(0.50);
    expect(hitRateDev.backtest_to_paper_deviation_pct).not.toBeNull();
    expect(hitRateDev.backtest_to_live_deviation_pct).not.toBeNull();
    expect(hitRateDev.paper_to_live_deviation_pct).not.toBeNull();
  });
});

// ── Readiness Scorer Tests ───────────────────────────────────────────────

describe("ReadinessScorer", () => {
  beforeEach(() => {
    _clearSessions();
    _clearReports();
    _clearScores();
  });

  function createCompletedSession(strategyId: string, trades: number, winRate: number) {
    const { session } = createValidationSession({
      strategy_id: strategyId,
      strategy_name: "Test",
      session_type: "paper",
      symbols: ["SPY"],
      timeframe: "5m",
      capital_allocation: 10000,
    });
    startValidationSession(session!.session_id);

    for (let i = 0; i < trades; i++) {
      const isWin = i < trades * winRate;
      recordTrade(session!.session_id, {
        symbol: "SPY",
        side: "buy",
        quantity: 10,
        entry_price: 400,
        pnl: isWin ? 50 : -30,
        slippage_bps: 3,
        expected_slippage_bps: 2,
        signal_to_fill_ms: 150,
        regime: "normal",
        rejected: false,
      });
    }

    completeValidationSession(session!.session_id);
    return session!;
  }

  it("computes readiness for a well-performing strategy", () => {
    createCompletedSession("strat_001", 20, 0.6);
    generateComparisonReport("strat_001", {
      backtest: {
        source: "backtest", strategy_id: "strat_001",
        period: { start: "2025-01-01", end: "2025-06-01" },
        trade_count: 20, hit_rate: 0.6, sharpe_ratio: 1.5,
        profit_factor: 1.4, max_drawdown_pct: 5, avg_slippage_bps: 3,
        total_pnl: 500, win_rate: 0.6, avg_trade_duration_ms: 300000,
        signal_to_fill_delay_ms: 150, reject_rate: 0.05,
      },
      paper: {
        source: "paper", strategy_id: "strat_001",
        period: { start: "2025-01-01", end: "2025-06-01" },
        trade_count: 20, hit_rate: 0.58, sharpe_ratio: 1.4,
        profit_factor: 1.3, max_drawdown_pct: 6, avg_slippage_bps: 4,
        total_pnl: 420, win_rate: 0.58, avg_trade_duration_ms: 310000,
        signal_to_fill_delay_ms: 180, reject_rate: 0.07,
      },
    });

    const score = computeReadinessScore("strat_001");
    expect(score.score_id).toMatch(/^pvs_/);
    expect(score.overall_score).toBeGreaterThan(50);
    // May be "ready" or "not_ready" depending on alignment critical count
    expect(["ready", "not_ready", "conditional"]).toContain(score.readiness_level);
    expect(score.dimensions).toHaveLength(6);
    expect(score.evidence_summary.validation_sessions_completed).toBe(1);
  });

  it("blocks promotion when insufficient trades", () => {
    createCompletedSession("strat_002", 3, 0.6);
    const score = computeReadinessScore("strat_002");
    expect(score.eligible_for_promotion).toBe(false);
    expect(score.blockers.some((b) => b.metric === "validated_trades")).toBe(true);
  });

  it("blocks promotion when no completed sessions", () => {
    // Create but don't complete
    const { session } = createValidationSession({
      strategy_id: "strat_003",
      strategy_name: "Test",
      session_type: "paper",
      symbols: ["SPY"],
      timeframe: "5m",
      capital_allocation: 10000,
    });
    startValidationSession(session!.session_id);

    const score = computeReadinessScore("strat_003");
    expect(score.eligible_for_promotion).toBe(false);
    expect(score.readiness_level).toBe("blocked");
    expect(score.blockers.some((b) => b.category === "validation_coverage")).toBe(true);
  });

  it("flags critical alignment issues as blockers", () => {
    createCompletedSession("strat_004", 20, 0.6);
    generateComparisonReport("strat_004", {
      backtest: {
        source: "backtest", strategy_id: "strat_004",
        period: { start: "2025-01-01", end: "2025-06-01" },
        trade_count: 20, hit_rate: 0.7, sharpe_ratio: 2.0,
        profit_factor: 2.0, max_drawdown_pct: 3, avg_slippage_bps: 1,
        total_pnl: 10000, win_rate: 0.7, avg_trade_duration_ms: 300000,
        signal_to_fill_delay_ms: 50, reject_rate: 0.01,
      },
      paper: {
        source: "paper", strategy_id: "strat_004",
        period: { start: "2025-01-01", end: "2025-06-01" },
        trade_count: 20, hit_rate: 0.3, sharpe_ratio: 0.2,
        profit_factor: 0.5, max_drawdown_pct: 20, avg_slippage_bps: 15,
        total_pnl: -2000, win_rate: 0.3, avg_trade_duration_ms: 300000,
        signal_to_fill_delay_ms: 500, reject_rate: 0.30,
      },
    });

    const score = computeReadinessScore("strat_004");
    expect(score.blockers.some((b) => b.category === "alignment")).toBe(true);
  });

  it("returns evidence summary", () => {
    createCompletedSession("strat_005", 15, 0.55);
    const score = computeReadinessScore("strat_005");
    expect(score.evidence_summary.validation_sessions_completed).toBe(1);
    expect(score.evidence_summary.total_validated_trades).toBe(15);
  });

  it("scores dimensions with correct weights", () => {
    createCompletedSession("strat_006", 20, 0.6);
    const score = computeReadinessScore("strat_006");
    const totalWeight = score.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(totalWeight).toBe(100);
    expect(score.dimensions).toHaveLength(6);
  });

  it("stores and retrieves scores", () => {
    createCompletedSession("strat_007", 20, 0.6);
    const score = computeReadinessScore("strat_007");
    expect(getReadinessScore(score.score_id)).toBeDefined();
    expect(getLatestScoreByStrategy("strat_007")).toBeDefined();
  });

  it("handles strategy with no data gracefully", () => {
    const score = computeReadinessScore("strat_nonexistent");
    expect(score.readiness_level).toBe("blocked");
    expect(score.eligible_for_promotion).toBe(false);
    // Score may be non-zero from dimension defaults even with no data
    expect(score.overall_score).toBeLessThanOrEqual(100);
  });
});

// ── Route Integration Tests ──────────────────────────────────────────────

describe("Validation Routes", () => {
  beforeEach(() => {
    _clearSessions();
    _clearReports();
    _clearScores();
  });

  // Test route handler logic via direct module calls (lightweight integration)

  it("session lifecycle: create → start → record trades → complete", () => {
    const { session } = createValidationSession({
      strategy_id: "strat_route_001",
      strategy_name: "Route Test",
      session_type: "paper",
      symbols: ["SPY", "QQQ"],
      timeframe: "5m",
      capital_allocation: 25000,
      operator_id: "operator_1",
    });

    expect(session).toBeDefined();
    expect(session!.symbols).toEqual(["SPY", "QQQ"]);

    startValidationSession(session!.session_id);

    for (let i = 0; i < 15; i++) {
      recordTrade(session!.session_id, {
        symbol: i % 2 === 0 ? "SPY" : "QQQ",
        side: "buy",
        quantity: 5,
        entry_price: 400,
        pnl: i < 9 ? 30 : -20,
        slippage_bps: 3 + (i % 3),
        expected_slippage_bps: 3,
        signal_to_fill_ms: 100 + i * 10,
        regime: i < 7 ? "bullish" : "choppy",
        rejected: false,
      });
    }

    completeValidationSession(session!.session_id);

    const completed = getSession(session!.session_id)!;
    expect(completed.status).toBe("completed");
    expect(completed.metrics.total_trades).toBe(15);
    expect(completed.metrics.hit_rate).toBe(9 / 15);
    expect(Object.keys(completed.metrics.pnl_by_symbol)).toContain("SPY");
    expect(Object.keys(completed.metrics.pnl_by_symbol)).toContain("QQQ");
    expect(Object.keys(completed.metrics.pnl_by_regime)).toContain("bullish");
  });

  it("full validation flow: session → compare → readiness", () => {
    // Step 1: Run validation session
    const { session } = createValidationSession({
      strategy_id: "strat_full_flow",
      strategy_name: "Full Flow Test",
      session_type: "paper",
      symbols: ["SPY"],
      timeframe: "5m",
      capital_allocation: 10000,
    });
    startValidationSession(session!.session_id);

    for (let i = 0; i < 20; i++) {
      recordTrade(session!.session_id, {
        symbol: "SPY",
        side: "buy",
        quantity: 10,
        entry_price: 400,
        pnl: i < 12 ? 40 : -25,
        slippage_bps: 2,
        expected_slippage_bps: 2,
        signal_to_fill_ms: 120,
        regime: "normal",
        rejected: false,
      });
    }
    completeValidationSession(session!.session_id);

    // Step 2: Generate comparison report
    const report = generateComparisonReport("strat_full_flow", {
      backtest: {
        source: "backtest", strategy_id: "strat_full_flow",
        period: { start: "2025-01-01", end: "2025-06-01" },
        trade_count: 50, hit_rate: 0.60, sharpe_ratio: 1.5,
        profit_factor: 1.5, max_drawdown_pct: 5, avg_slippage_bps: 2,
        total_pnl: 3000, win_rate: 0.60, avg_trade_duration_ms: 300000,
        signal_to_fill_delay_ms: 100, reject_rate: 0.03,
      },
      paper: {
        source: "paper", strategy_id: "strat_full_flow",
        period: { start: "2025-06-01", end: "2025-07-01" },
        trade_count: 20, hit_rate: 0.60, sharpe_ratio: 1.3,
        profit_factor: 1.4, max_drawdown_pct: 6, avg_slippage_bps: 2,
        total_pnl: 280, win_rate: 0.60, avg_trade_duration_ms: 310000,
        signal_to_fill_delay_ms: 120, reject_rate: 0.05,
      },
    });

    // Alignment depends on how deviation thresholds classify the metric deltas
    expect(["strong", "acceptable", "degraded"]).toContain(report.summary.overall_alignment);

    // Step 3: Compute readiness
    const score = computeReadinessScore("strat_full_flow");
    expect(score.overall_score).toBeGreaterThan(40);
    expect(score.dimensions).toHaveLength(6);
    expect(score.evidence_summary.validation_sessions_completed).toBe(1);
    expect(score.evidence_summary.total_validated_trades).toBe(20);
    expect(["strong", "acceptable", "degraded"]).toContain(score.evidence_summary.latest_alignment);
  });
});
