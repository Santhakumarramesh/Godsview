/**
 * Tests for alignment_engine.ts — Divergence computation, verdict logic,
 * drift detection, and utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  computeRateDivergence,
  computeRelativeDivergence,
  computeDivergence,
  determineVerdict,
  determineDriftDirection,
  detectDriftEvents,
  computeSharpeFromPnls,
  computeMaxDrawdownPct,
  runAlignmentCheck,
  ALIGNMENT_THRESHOLDS,
  type BacktestMetrics,
  type LiveMetrics,
} from "../lib/alignment_engine";

// ── Rate Divergence ────────────────────────────────────────────

describe("computeRateDivergence", () => {
  it("returns 0 for identical values", () => {
    expect(computeRateDivergence(0.65, 0.65)).toBeCloseTo(0, 6);
  });

  it("returns absolute difference", () => {
    expect(computeRateDivergence(0.70, 0.60)).toBeCloseTo(0.10, 6);
  });

  it("is symmetric", () => {
    expect(computeRateDivergence(0.50, 0.75)).toBeCloseTo(
      computeRateDivergence(0.75, 0.50), 6
    );
  });

  it("handles zero values", () => {
    expect(computeRateDivergence(0, 0.5)).toBeCloseTo(0.5, 6);
  });
});

// ── Relative Divergence ────────────────────────────────────────

describe("computeRelativeDivergence", () => {
  it("returns 0 for identical values", () => {
    expect(computeRelativeDivergence(100, 100)).toBeCloseTo(0, 6);
  });

  it("returns ratio of difference to max", () => {
    // |100 - 50| / max(100, 50) = 50/100 = 0.5
    expect(computeRelativeDivergence(100, 50)).toBeCloseTo(0.5, 6);
  });

  it("handles negative values", () => {
    // |-50 - 50| / max(50, 50) = 100/50 = 2.0
    expect(computeRelativeDivergence(-50, 50)).toBeCloseTo(2.0, 6);
  });

  it("handles both zero with floor of 1", () => {
    // |0 - 0| / max(0, 0, 1) = 0
    expect(computeRelativeDivergence(0, 0)).toBeCloseTo(0, 6);
  });

  it("uses floor of 1 for very small values", () => {
    // |0.5 - 0| / max(0.5, 0, 1) = 0.5/1 = 0.5
    expect(computeRelativeDivergence(0.5, 0)).toBeCloseTo(0.5, 6);
  });
});

// ── Full Divergence Computation ────────────────────────────────

describe("computeDivergence", () => {
  const perfectBt: BacktestMetrics = {
    win_rate: 0.65, avg_pnl: 50, sharpe: 1.5,
    max_drawdown_pct: 10, avg_slippage_bps: 5, trade_count: 100,
  };

  it("returns composite near 1.0 for identical metrics", () => {
    const div = computeDivergence(perfectBt, { ...perfectBt });
    expect(div.composite).toBeCloseTo(1.0, 1);
    expect(div.win_rate).toBeCloseTo(0, 4);
    expect(div.pnl).toBeCloseTo(0, 4);
    expect(div.sharpe).toBeCloseTo(0, 4);
    expect(div.slippage).toBeCloseTo(0, 4);
  });

  it("returns lower composite for moderate divergence", () => {
    const live: LiveMetrics = {
      win_rate: 0.55, avg_pnl: 30, sharpe: 0.8,
      max_drawdown_pct: 15, avg_slippage_bps: 10, trade_count: 80,
    };
    const div = computeDivergence(perfectBt, live);
    expect(div.composite).toBeGreaterThan(0.2);
    expect(div.composite).toBeLessThan(0.9);
    expect(div.win_rate).toBeCloseTo(0.10, 2);
  });

  it("returns very low composite for severe divergence", () => {
    const live: LiveMetrics = {
      win_rate: 0.30, avg_pnl: -20, sharpe: -0.5,
      max_drawdown_pct: 35, avg_slippage_bps: 25, trade_count: 50,
    };
    const div = computeDivergence(perfectBt, live);
    expect(div.composite).toBeLessThan(0.4);
  });

  it("composite is clamped to [0, 1]", () => {
    const div = computeDivergence(perfectBt, { ...perfectBt });
    expect(div.composite).toBeGreaterThanOrEqual(0);
    expect(div.composite).toBeLessThanOrEqual(1);

    const terrible: LiveMetrics = {
      win_rate: 0, avg_pnl: -1000, sharpe: -5,
      max_drawdown_pct: 100, avg_slippage_bps: 100, trade_count: 5,
    };
    const divBad = computeDivergence(perfectBt, terrible);
    expect(divBad.composite).toBeGreaterThanOrEqual(0);
    expect(divBad.composite).toBeLessThanOrEqual(1);
  });
});

// ── Verdict Determination ──────────────────────────────────────

describe("determineVerdict", () => {
  it("returns 'aligned' for high composite with sufficient trades", () => {
    expect(determineVerdict(0.85, 50, 50)).toBe("aligned");
  });

  it("returns 'drifting' for moderate composite", () => {
    expect(determineVerdict(0.55, 50, 50)).toBe("drifting");
  });

  it("returns 'diverged' for low composite", () => {
    expect(determineVerdict(0.20, 50, 50)).toBe("diverged");
  });

  it("returns 'insufficient_data' when bt trades < MIN_TRADES", () => {
    expect(determineVerdict(0.90, 5, 50)).toBe("insufficient_data");
  });

  it("returns 'insufficient_data' when live trades < MIN_TRADES", () => {
    expect(determineVerdict(0.90, 50, 3)).toBe("insufficient_data");
  });

  it("boundary: composite exactly at drifting threshold", () => {
    expect(determineVerdict(ALIGNMENT_THRESHOLDS.COMPOSITE_DRIFTING, 20, 20)).toBe("aligned");
  });

  it("boundary: composite exactly at diverged threshold", () => {
    expect(determineVerdict(ALIGNMENT_THRESHOLDS.COMPOSITE_DIVERGED, 20, 20)).toBe("drifting");
  });
});

// ── Drift Direction ────────────────────────────────────────────

describe("determineDriftDirection", () => {
  const base: BacktestMetrics = {
    win_rate: 0.65, avg_pnl: 50, sharpe: 1.5,
    max_drawdown_pct: 10, avg_slippage_bps: 5, trade_count: 100,
  };

  it("returns 'backtest_optimistic' when bt looks better", () => {
    const live: LiveMetrics = {
      win_rate: 0.50, avg_pnl: 20, sharpe: 0.5,
      max_drawdown_pct: 20, avg_slippage_bps: 10, trade_count: 80,
    };
    expect(determineDriftDirection(base, live)).toBe("backtest_optimistic");
  });

  it("returns 'backtest_pessimistic' when live outperforms", () => {
    const live: LiveMetrics = {
      win_rate: 0.80, avg_pnl: 100, sharpe: 2.5,
      max_drawdown_pct: 5, avg_slippage_bps: 2, trade_count: 80,
    };
    expect(determineDriftDirection(base, live)).toBe("backtest_pessimistic");
  });

  it("returns null when metrics are nearly identical", () => {
    const live: LiveMetrics = {
      ...base,
      win_rate: 0.66, avg_pnl: 50.5, sharpe: 1.55,
    };
    expect(determineDriftDirection(base, live)).toBeNull();
  });

  it("returns 'mixed' when some metrics favor each side equally", () => {
    const live: LiveMetrics = {
      win_rate: 0.75,  // live better (+0.10)
      avg_pnl: 20,     // bt better (-30)
      sharpe: 1.5,     // same
      max_drawdown_pct: 5, avg_slippage_bps: 5, trade_count: 80,
    };
    // btBetter=1 (pnl), liveBetter=1 (win_rate) → mixed
    expect(determineDriftDirection(base, live)).toBe("mixed");
  });
});

// ── Drift Event Detection ──────────────────────────────────────

describe("detectDriftEvents", () => {
  const baseBt: BacktestMetrics = {
    win_rate: 0.65, avg_pnl: 50, sharpe: 1.5,
    max_drawdown_pct: 10, avg_slippage_bps: 5, trade_count: 100,
  };

  it("returns empty array when all metrics aligned", () => {
    const live: LiveMetrics = { ...baseBt };
    const div = computeDivergence(baseBt, live);
    const events = detectDriftEvents(baseBt, live, div);
    expect(events).toHaveLength(0);
  });

  it("detects win rate warning", () => {
    const live: LiveMetrics = { ...baseBt, win_rate: 0.53 }; // 12% diff
    const div = computeDivergence(baseBt, live);
    const events = detectDriftEvents(baseBt, live, div);
    const wrEvt = events.find(e => e.metric === "win_rate");
    expect(wrEvt).toBeDefined();
    expect(wrEvt!.severity).toBe("warning");
  });

  it("detects win rate critical", () => {
    const live: LiveMetrics = { ...baseBt, win_rate: 0.40 }; // 25% diff
    const div = computeDivergence(baseBt, live);
    const events = detectDriftEvents(baseBt, live, div);
    const wrEvt = events.find(e => e.metric === "win_rate");
    expect(wrEvt).toBeDefined();
    expect(wrEvt!.severity).toBe("critical");
  });

  it("detects slippage warning", () => {
    const live: LiveMetrics = { ...baseBt, avg_slippage_bps: 12 }; // 7 bps diff
    const div = computeDivergence(baseBt, live);
    const events = detectDriftEvents(baseBt, live, div);
    const slEvt = events.find(e => e.metric === "slippage");
    expect(slEvt).toBeDefined();
    expect(slEvt!.severity).toBe("warning");
  });

  it("can detect multiple drift events simultaneously", () => {
    const live: LiveMetrics = {
      win_rate: 0.35, avg_pnl: -10, sharpe: -0.5,
      max_drawdown_pct: 30, avg_slippage_bps: 25, trade_count: 80,
    };
    const div = computeDivergence(baseBt, live);
    const events = detectDriftEvents(baseBt, live, div);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every(e => e.severity === "critical" || e.severity === "warning")).toBe(true);
  });
});

// ── Sharpe from PnLs ──────────────────────────────────────────

describe("computeSharpeFromPnls", () => {
  it("returns 0 for empty array", () => {
    expect(computeSharpeFromPnls([])).toBe(0);
  });

  it("returns 0 for single value", () => {
    expect(computeSharpeFromPnls([10])).toBe(0);
  });

  it("returns positive Sharpe for consistently positive PnLs", () => {
    const pnls = [10, 12, 8, 11, 9, 13, 10, 11];
    expect(computeSharpeFromPnls(pnls)).toBeGreaterThan(0);
  });

  it("returns negative Sharpe for consistently negative PnLs", () => {
    const pnls = [-10, -12, -8, -11, -9, -13, -10, -11];
    expect(computeSharpeFromPnls(pnls)).toBeLessThan(0);
  });

  it("returns higher Sharpe for lower volatility (non-zero variance)", () => {
    const lowVol = [10, 10.1, 9.9, 10, 10.1, 9.9, 10, 10];
    const highVol = [10, -5, 25, -10, 30, -5, 20, 15];
    // lowVol has ~10 mean with tiny stddev → very high Sharpe
    // highVol has ~10 mean with large stddev → lower Sharpe
    expect(computeSharpeFromPnls(lowVol)).toBeGreaterThan(computeSharpeFromPnls(highVol));
  });

  it("caps at 3 or -3 for zero stddev", () => {
    const allSame = [5, 5, 5, 5]; // stdDev = 0, mean > 0
    expect(computeSharpeFromPnls(allSame)).toBe(3);
  });
});

// ── Max Drawdown ──────────────────────────────────────────────

describe("computeMaxDrawdownPct", () => {
  it("returns 0 for empty array", () => {
    expect(computeMaxDrawdownPct([])).toBe(0);
  });

  it("returns 0 for all positive PnLs", () => {
    expect(computeMaxDrawdownPct([10, 10, 10, 10])).toBe(0);
  });

  it("computes drawdown from peak", () => {
    // Cumulative: 10, 20, 10, 20
    // Peak at 20, then drops to 10 = 50% DD
    const pnls = [10, 10, -10, 10];
    expect(computeMaxDrawdownPct(pnls)).toBeCloseTo(50, 0);
  });

  it("handles total loss", () => {
    // Cumulative: 100, 0
    const pnls = [100, -100];
    expect(computeMaxDrawdownPct(pnls)).toBeCloseTo(100, 0);
  });

  it("returns largest drawdown when multiple exist", () => {
    // Cumulative: 10, 20, 15, 25, 10
    // DD1: peak=20, trough=15 → 25%, DD2: peak=25, trough=10 → 60%
    const pnls = [10, 10, -5, 10, -15];
    expect(computeMaxDrawdownPct(pnls)).toBeCloseTo(60, 0);
  });
});

// ── Full Alignment Check ──────────────────────────────────────

describe("runAlignmentCheck", () => {
  const bt: BacktestMetrics = {
    win_rate: 0.65, avg_pnl: 50, sharpe: 1.5,
    max_drawdown_pct: 10, avg_slippage_bps: 5, trade_count: 100,
  };

  it("produces 'aligned' result for matching metrics", () => {
    const live: LiveMetrics = { ...bt, trade_count: 80 };
    const result = runAlignmentCheck("strat_1", bt, live, {
      period_start: new Date("2025-01-01"),
      period_end: new Date("2025-02-01"),
    });
    expect(result.verdict).toBe("aligned");
    expect(result.strategy_id).toBe("strat_1");
    expect(result.divergence.composite).toBeGreaterThan(0.9);
    expect(result.drift_events).toHaveLength(0);
  });

  it("produces 'diverged' result for severely different metrics", () => {
    const live: LiveMetrics = {
      win_rate: 0.30, avg_pnl: -30, sharpe: -1,
      max_drawdown_pct: 40, avg_slippage_bps: 30, trade_count: 50,
    };
    const result = runAlignmentCheck("strat_2", bt, live, {
      period_start: new Date("2025-01-01"),
      period_end: new Date("2025-02-01"),
      symbol: "SPY",
    });
    expect(result.verdict).toBe("diverged");
    expect(result.symbol).toBe("SPY");
    expect(result.drift_events.length).toBeGreaterThan(0);
    expect(result.drift_direction).toBe("backtest_optimistic");
  });

  it("produces 'insufficient_data' when trade counts are low", () => {
    const live: LiveMetrics = { ...bt, trade_count: 3 };
    const result = runAlignmentCheck("strat_3", bt, live, {
      period_start: new Date("2025-01-01"),
      period_end: new Date("2025-02-01"),
    });
    expect(result.verdict).toBe("insufficient_data");
  });

  it("includes regime in result", () => {
    const live: LiveMetrics = { ...bt };
    const result = runAlignmentCheck("strat_4", bt, live, {
      period_start: new Date("2025-01-01"),
      period_end: new Date("2025-02-01"),
      regime: "bullish",
    });
    expect(result.regime).toBe("bullish");
  });
});
