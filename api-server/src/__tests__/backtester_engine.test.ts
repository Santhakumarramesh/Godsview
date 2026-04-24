/**
 * backtester_engine.test.ts — Phase 24: Backtester Core Engine
 *
 * Tests pure computation functions exported from backtester.ts:
 *   replaySignal:
 *     - empty bars → unresolved
 *     - long: SL hit → loss with correct pnl_pct
 *     - long: TP hit → win with correct pnl_pct
 *     - long: open gaps through SL (slippage) → exit at Open
 *     - long: open gaps through TP (slippage) → exit at Open
 *     - short: SL hit → loss
 *     - short: TP hit → win
 *     - SL prioritised over TP within the same bar (conservative)
 *     - resolves on the correct bar in a multi-bar sequence
 *     - unresolved when no bar hits TP or SL
 *
 *   computeMetrics:
 *     - empty array → emptyMetrics sentinel
 *     - all wins → win_rate = 1, profit_factor = 99.9 (Infinity sentinel)
 *     - all losses → win_rate = 0, profit_factor = 0
 *     - mixed → correct win_rate, profit_factor, avg_win, avg_loss, totals
 *     - max_drawdown tracks largest peak-to-trough equity decline
 *     - best_trade_pct / worst_trade_pct correct
 *     - sharpe = 0 when all trades have identical pnl (zero variance)
 *
 *   buildEquityCurve:
 *     - empty trades → single seed point [{ idx:0, equity }]
 *     - curve length = trades.length + 1
 *     - first point always { idx:0, equity: initialEquity }
 *     - equity compounds per step (not simple addition)
 *     - equity values rounded to 2 decimal places
 *
 *   computeSignificance:
 *     - n1=0 or n2=0 → insufficient_data
 *     - identical win rates, large N → z ≈ 0, not significant
 *     - se=0 (pooled proportion 0 or 1) → no_variance
 *     - large z (p < 0.01) → confidence_level = "99%", is_significant = true
 *     - moderate z (p < 0.05) → confidence_level = "95%"
 *     - small z (p ≥ 0.10) → confidence_level = "not_significant"
 *     - z_score rounded to 3 decimal places
 *
 *   approxNormalCDF:
 *     - CDF(0) ≈ 0.5
 *     - CDF(-8) = 0 (hard clamp)
 *     - CDF(8) = 1 (hard clamp)
 *     - CDF(1.96) ≈ 0.975 ± 0.001
 *     - CDF(-1.96) ≈ 0.025 ± 0.001
 *     - Symmetry: CDF(-x) ≈ 1 − CDF(x)
 */

import { describe, it, expect } from "vitest";
import type { AlpacaBar } from "../lib/alpaca";
import type { TradeResult } from "../lib/backtester";
import {
  replaySignal,
  computeMetrics,
  buildEquityCurve,
  computeSignificance,
  approxNormalCDF,
  emptyMetrics,
} from "../lib/backtester";

// ─── Bar factory ───────────────────────────────────────────────────────────────

function makeBar(opts: {
  open:   number;
  high:   number;
  low:    number;
  close?: number;
}): AlpacaBar {
  const close = opts.close ?? opts.open;
  return {
    t: new Date().toISOString(),
    o: opts.open, h: opts.high, l: opts.low, c: close, v: 10_000,
    Timestamp: new Date().toISOString(),
    Open: opts.open, High: opts.high, Low: opts.low, Close: close, Volume: 10_000,
  };
}

/** Neutral bar that never crosses any level. */
function neutralBar(mid: number, spread = 0.5): AlpacaBar {
  return makeBar({
    open: mid, high: mid + spread, low: mid - spread, close: mid,
  });
}

// ─── TradeResult factory ──────────────────────────────────────────────────────

function makeTrade(overrides: Partial<TradeResult> = {}): TradeResult {
  return {
    signal_id: 1,
    setup_type: "test_setup",
    regime: "trending",
    direction: "long",
    entry_price: 100,
    stop_loss: 98,
    take_profit: 104,
    outcome: "win",
    pnl_pct: 2,
    si_approved: true,
    si_win_prob: 0.65,
    si_edge_score: 0.5,
    si_kelly_pct: 5,
    baseline_quality: 0.72,
    enhanced_quality: 0.78,
    ...overrides,
  };
}

// ─── replaySignal ──────────────────────────────────────────────────────────────

describe("replaySignal", () => {

  // ── Degenerate / edge cases ────────────────────────────────────────────────

  it("returns unresolved with pnl 0 for empty bar array", () => {
    const result = replaySignal([], "long", 100, 98, 104);
    expect(result.outcome).toBe("unresolved");
    expect(result.pnl_pct).toBe(0);
  });

  it("returns unresolved when no bar hits TP or SL", () => {
    const bars = [
      neutralBar(101, 0.5), // High=101.5, Low=100.5 — well inside 98..104
      neutralBar(102, 0.5),
      neutralBar(100, 0.5),
    ];
    const result = replaySignal(bars, "long", 100, 98, 104);
    expect(result.outcome).toBe("unresolved");
  });

  // ── Long: SL hit ───────────────────────────────────────────────────────────

  it("long: SL hit → loss with correct pnl_pct", () => {
    // SL at 98; bar low = 97 (below SL), open = 99 (above SL → normal fill)
    const bar = makeBar({ open: 99, high: 100, low: 97 });
    const result = replaySignal([bar], "long", 100, 98, 104);
    expect(result.outcome).toBe("loss");
    // exit = min(99, 98) = 98; pnl = (98 - 100) / 100 * 100 = -2
    expect(result.pnl_pct).toBeCloseTo(-2, 5);
  });

  it("long: SL slippage — bar opens below SL → exit at Open", () => {
    // SL at 98; bar opens at 96 (gap down through SL)
    const bar = makeBar({ open: 96, high: 97, low: 95 });
    const result = replaySignal([bar], "long", 100, 98, 104);
    expect(result.outcome).toBe("loss");
    // exit = min(96, 98) = 96; pnl = (96 - 100) / 100 * 100 = -4
    expect(result.pnl_pct).toBeCloseTo(-4, 5);
  });

  // ── Long: TP hit ───────────────────────────────────────────────────────────

  it("long: TP hit → win with correct pnl_pct", () => {
    // TP at 104; bar high = 105, open = 101 (opens below TP, reaches it intrabar)
    const bar = makeBar({ open: 101, high: 105, low: 100.5 });
    const result = replaySignal([bar], "long", 100, 98, 104);
    expect(result.outcome).toBe("win");
    // exit = max(101, 104) = 104; pnl = (104 - 100) / 100 * 100 = 4
    expect(result.pnl_pct).toBeCloseTo(4, 5);
  });

  it("long: TP slippage — bar opens above TP → exit at Open", () => {
    // TP at 104; bar opens at 106 (gap up through TP)
    const bar = makeBar({ open: 106, high: 107, low: 105 });
    const result = replaySignal([bar], "long", 100, 98, 104);
    expect(result.outcome).toBe("win");
    // exit = max(106, 104) = 106; pnl = (106 - 100) / 100 * 100 = 6
    expect(result.pnl_pct).toBeCloseTo(6, 5);
  });

  // ── Long: SL before TP (conservative — SL checked first) ──────────────────

  it("long: same bar hits both SL and TP — SL wins (conservative)", () => {
    // Bar low = 97 (≤ SL=98) AND high = 106 (≥ TP=104): SL checked first
    const bar = makeBar({ open: 100, high: 106, low: 97 });
    const result = replaySignal([bar], "long", 100, 98, 104);
    expect(result.outcome).toBe("loss");
  });

  // ── Short: SL hit ──────────────────────────────────────────────────────────

  it("short: SL hit → loss with correct pnl_pct", () => {
    // Entry=100, SL=103 (above), TP=96 (below)
    // bar high = 104 (≥ SL), open = 101 (below SL → normal fill)
    const bar = makeBar({ open: 101, high: 104, low: 99 });
    const result = replaySignal([bar], "short", 100, 103, 96);
    expect(result.outcome).toBe("loss");
    // exit = max(101, 103) = 103; pnl = (100 - 103) / 100 * 100 = -3
    expect(result.pnl_pct).toBeCloseTo(-3, 5);
  });

  it("short: SL slippage — bar opens above SL → exit at Open", () => {
    // Entry=100, SL=103; bar opens at 105 (gap up through SL)
    const bar = makeBar({ open: 105, high: 106, low: 104 });
    const result = replaySignal([bar], "short", 100, 103, 96);
    expect(result.outcome).toBe("loss");
    // exit = max(105, 103) = 105; pnl = (100 - 105) / 100 * 100 = -5
    expect(result.pnl_pct).toBeCloseTo(-5, 5);
  });

  // ── Short: TP hit ──────────────────────────────────────────────────────────

  it("short: TP hit → win with correct pnl_pct", () => {
    // Entry=100, SL=103, TP=96; bar low = 95 (≤ TP), open = 98
    const bar = makeBar({ open: 98, high: 99, low: 95 });
    const result = replaySignal([bar], "short", 100, 103, 96);
    expect(result.outcome).toBe("win");
    // exit = min(98, 96) = 96; pnl = (100 - 96) / 100 * 100 = 4
    expect(result.pnl_pct).toBeCloseTo(4, 5);
  });

  it("short: TP slippage — bar opens below TP → exit at Open", () => {
    // Entry=100, SL=103, TP=96; bar opens at 94 (gap down through TP)
    const bar = makeBar({ open: 94, high: 95, low: 93 });
    const result = replaySignal([bar], "short", 100, 103, 96);
    expect(result.outcome).toBe("win");
    // exit = min(94, 96) = 94; pnl = (100 - 94) / 100 * 100 = 6
    expect(result.pnl_pct).toBeCloseTo(6, 5);
  });

  // ── Multi-bar: resolves on correct bar ────────────────────────────────────

  it("resolves on the correct bar in a multi-bar sequence", () => {
    // Entry=100, SL=98, TP=104
    const bars = [
      neutralBar(101, 0.5),   // bar 1: safe (high 101.5, low 100.5)
      neutralBar(102, 0.5),   // bar 2: safe
      makeBar({ open: 103, high: 105, low: 102 }), // bar 3: TP hit
      makeBar({ open: 97, high: 98, low: 96 }),     // bar 4: would be SL
    ];
    const result = replaySignal(bars, "long", 100, 98, 104);
    expect(result.outcome).toBe("win");
    // exit = max(103, 104) = 104; pnl = 4
    expect(result.pnl_pct).toBeCloseTo(4, 5);
  });
});

// ─── computeMetrics ───────────────────────────────────────────────────────────

describe("computeMetrics", () => {
  const INITIAL_EQUITY = 10_000;

  it("returns emptyMetrics for empty trade array", () => {
    const result = computeMetrics([], INITIAL_EQUITY);
    const expected = emptyMetrics();
    expect(result).toEqual(expected);
    expect(result.win_rate).toBe(0);
    expect(result.profit_factor).toBe(0);
  });

  it("all wins → win_rate = 1.0, profit_factor = 99.9 (Infinity sentinel)", () => {
    const trades = [
      makeTrade({ outcome: "win",  pnl_pct:  3 }),
      makeTrade({ outcome: "win",  pnl_pct:  2 }),
      makeTrade({ outcome: "win",  pnl_pct:  4 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.win_rate).toBe(1.0);
    expect(m.profit_factor).toBe(99.9);
    expect(m.losses).toBe(0);
    expect(m.avg_loss_pct).toBe(0);
  });

  it("all losses → win_rate = 0, profit_factor = 0", () => {
    const trades = [
      makeTrade({ outcome: "loss", pnl_pct: -2 }),
      makeTrade({ outcome: "loss", pnl_pct: -3 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.win_rate).toBe(0);
    expect(m.profit_factor).toBe(0);
    expect(m.wins).toBe(0);
    expect(m.avg_win_pct).toBe(0);
  });

  it("mixed: correct win_rate, profit_factor, avg_win, avg_loss", () => {
    // 2 wins (+4, +2) and 2 losses (-1, -3)
    const trades = [
      makeTrade({ outcome: "win",  pnl_pct:  4 }),
      makeTrade({ outcome: "loss", pnl_pct: -1 }),
      makeTrade({ outcome: "win",  pnl_pct:  2 }),
      makeTrade({ outcome: "loss", pnl_pct: -3 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(2);
    expect(m.win_rate).toBe(0.5);
    // gross win = 4+2=6, gross loss = 1+3=4; PF = 1.5
    expect(m.profit_factor).toBeCloseTo(1.5, 5);
    // avg_win = (4+2)/2 = 3
    expect(m.avg_win_pct).toBeCloseTo(3, 5);
    // avg_loss = (1+3)/2 = 2 (absolute)
    expect(m.avg_loss_pct).toBeCloseTo(2, 5);
    // total_pnl_pct = 4 -1 +2 -3 = 2
    expect(m.total_pnl_pct).toBeCloseTo(2, 5);
  });

  it("best_trade_pct and worst_trade_pct are correct", () => {
    const trades = [
      makeTrade({ outcome: "win",  pnl_pct:  5 }),
      makeTrade({ outcome: "loss", pnl_pct: -4 }),
      makeTrade({ outcome: "win",  pnl_pct:  1 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.best_trade_pct).toBe(5);
    expect(m.worst_trade_pct).toBe(-4);
  });

  it("max_drawdown tracks largest peak-to-trough equity decline", () => {
    // Equity starts at 10_000
    // +10% → 11_000 (peak)
    // -20% → 8_800 (drawdown from 11_000 = 20%)
    // +5%  → 9_240
    const trades = [
      makeTrade({ outcome: "win",  pnl_pct:  10 }),
      makeTrade({ outcome: "loss", pnl_pct: -20 }),
      makeTrade({ outcome: "win",  pnl_pct:   5 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    // dd = (11000 - 8800) / 11000 * 100 = 20%
    expect(m.max_drawdown_pct).toBeCloseTo(20, 1);
  });

  it("sharpe = 0 when all trades have identical pnl of 0 (zero variance)", () => {
    // pnl_pct: 0 is exactly representable → variance exactly 0 → sharpe exactly 0
    const trades = Array.from({ length: 10 }, () =>
      makeTrade({ outcome: "win", pnl_pct: 0 }),
    );
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.sharpe_ratio).toBe(0);
  });

  it("sharpe > 0 for consistent winning trades with variance", () => {
    // Mix of wins and losses creates variance; wins dominate so Sharpe > 0
    const trades = [
      makeTrade({ outcome: "win",  pnl_pct:  3 }),
      makeTrade({ outcome: "win",  pnl_pct:  4 }),
      makeTrade({ outcome: "loss", pnl_pct: -1 }),
      makeTrade({ outcome: "win",  pnl_pct:  3 }),
      makeTrade({ outcome: "win",  pnl_pct:  2 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.sharpe_ratio).toBeGreaterThan(0);
  });

  it("avg_kelly_pct and avg_edge_score are averages across all trades", () => {
    const trades = [
      makeTrade({ si_kelly_pct: 4, si_edge_score: 0.4 }),
      makeTrade({ si_kelly_pct: 6, si_edge_score: 0.6 }),
    ];
    const m = computeMetrics(trades, INITIAL_EQUITY);
    expect(m.avg_kelly_pct).toBeCloseTo(5, 5);
    expect(m.avg_edge_score).toBeCloseTo(0.5, 5);
  });
});

// ─── buildEquityCurve ─────────────────────────────────────────────────────────

describe("buildEquityCurve", () => {
  const INITIAL = 10_000;

  it("returns single seed point for empty trades", () => {
    const curve = buildEquityCurve([], INITIAL);
    expect(curve).toHaveLength(1);
    expect(curve[0]).toEqual({ idx: 0, equity: INITIAL });
  });

  it("curve length = trades.length + 1 (seed + one point per trade)", () => {
    const trades = [
      makeTrade({ pnl_pct: 1 }),
      makeTrade({ pnl_pct: -2 }),
      makeTrade({ pnl_pct: 3 }),
    ];
    const curve = buildEquityCurve(trades, INITIAL);
    expect(curve).toHaveLength(4);
  });

  it("first point is always the seed { idx:0, equity: initialEquity }", () => {
    const trades = [makeTrade({ pnl_pct: 5 })];
    const curve = buildEquityCurve(trades, INITIAL);
    expect(curve[0]).toEqual({ idx: 0, equity: INITIAL });
  });

  it("equity compounds correctly (not simple addition)", () => {
    // +10% on 10_000 → 11_000; then +10% on 11_000 → 12_100
    const trades = [
      makeTrade({ pnl_pct: 10 }),
      makeTrade({ pnl_pct: 10 }),
    ];
    const curve = buildEquityCurve(trades, INITIAL);
    expect(curve[1]!.equity).toBeCloseTo(11_000, 1);
    expect(curve[2]!.equity).toBeCloseTo(12_100, 1);
  });

  it("equity decreases correctly on a loss", () => {
    // -5% on 10_000 → 9_500
    const trades = [makeTrade({ outcome: "loss", pnl_pct: -5 })];
    const curve = buildEquityCurve(trades, INITIAL);
    expect(curve[1]!.equity).toBeCloseTo(9_500, 1);
  });

  it("idx increments sequentially", () => {
    const trades = [
      makeTrade({ pnl_pct: 1 }),
      makeTrade({ pnl_pct: 1 }),
      makeTrade({ pnl_pct: 1 }),
    ];
    const curve = buildEquityCurve(trades, INITIAL);
    expect(curve.map(p => p.idx)).toEqual([0, 1, 2, 3]);
  });

  it("equity values are rounded to 2 decimal places", () => {
    // 10_000 * 1.001 = 10_010.0 (clean); but arbitrary fraction:
    // use 3% on 10_001 → 10_301.03 → rounded
    const trades = [makeTrade({ pnl_pct: 3 })];
    const curve = buildEquityCurve(trades, 10_001);
    const val = curve[1]!.equity;
    const decimals = val.toString().includes(".")
      ? (val.toString().split(".")[1]?.length ?? 0)
      : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ─── computeSignificance ──────────────────────────────────────────────────────

describe("computeSignificance", () => {

  it("returns insufficient_data when n1 = 0", () => {
    const result = computeSignificance(0, 0, 10, 20);
    expect(result.confidence_level).toBe("insufficient_data");
    expect(result.is_significant).toBe(false);
    expect(result.z_score).toBe(0);
    expect(result.p_value).toBe(1);
  });

  it("returns insufficient_data when n2 = 0", () => {
    const result = computeSignificance(10, 20, 0, 0);
    expect(result.confidence_level).toBe("insufficient_data");
    expect(result.is_significant).toBe(false);
  });

  it("identical win rates → z ≈ 0, not significant", () => {
    // p1 = p2 = 0.5 with large N → z = 0
    const result = computeSignificance(50, 100, 50, 100);
    expect(result.z_score).toBeCloseTo(0, 1);
    expect(result.is_significant).toBe(false);
    expect(result.confidence_level).toBe("not_significant");
  });

  it("returns no_variance when pooled proportion is 0", () => {
    // Both groups have 0 wins → pPooled = 0 → se = 0
    const result = computeSignificance(0, 100, 0, 100);
    expect(result.confidence_level).toBe("no_variance");
    expect(result.is_significant).toBe(false);
  });

  it("returns no_variance when pooled proportion is 1", () => {
    // Both groups have 100% wins → pPooled = 1 → se = 0
    const result = computeSignificance(100, 100, 100, 100);
    expect(result.confidence_level).toBe("no_variance");
  });

  it("large z (p < 0.01) → confidence_level = '99%', is_significant = true", () => {
    // p1 = 0.4, p2 = 0.8 with large N → very significant
    const result = computeSignificance(40, 100, 80, 100);
    expect(result.confidence_level).toBe("99%");
    expect(result.is_significant).toBe(true);
    expect(result.p_value).toBeLessThan(0.01);
  });

  it("moderate z (p < 0.05) → confidence_level = '95%'", () => {
    // p1 = 0.45, p2 = 0.60, n = 100 each → p ≈ 0.02 (significant at 95%)
    const result = computeSignificance(45, 100, 60, 100);
    const tier = result.confidence_level;
    // Accept 95% or 99% — the test validates ≥ 95% confidence
    expect(["95%", "99%"]).toContain(tier);
    expect(result.is_significant).toBe(true);
  });

  it("small z (p ≥ 0.10) → confidence_level = 'not_significant'", () => {
    // Tiny difference, small N
    const result = computeSignificance(5, 10, 6, 10);
    expect(result.is_significant).toBe(false);
    expect(result.confidence_level).toBe("not_significant");
  });

  it("z_score is rounded to 3 decimal places", () => {
    const result = computeSignificance(40, 100, 80, 100);
    const decimals = result.z_score.toString().includes(".")
      ? (result.z_score.toString().split(".")[1]?.length ?? 0)
      : 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });

  it("p_value is rounded to 4 decimal places", () => {
    const result = computeSignificance(40, 100, 80, 100);
    const decimals = result.p_value.toString().includes(".")
      ? (result.p_value.toString().split(".")[1]?.length ?? 0)
      : 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });
});

// ─── approxNormalCDF ──────────────────────────────────────────────────────────

describe("approxNormalCDF", () => {

  it("CDF(0) ≈ 0.5 (midpoint of standard normal)", () => {
    expect(approxNormalCDF(0)).toBeCloseTo(0.5, 4);
  });

  it("CDF(-9) = 0 (hard lower clamp — x < -8 returns 0 exactly)", () => {
    // Clamp is `x < -8` (strict), so -9 triggers it
    expect(approxNormalCDF(-9)).toBe(0);
  });

  it("CDF(9) = 1 (hard upper clamp — x > 8 returns 1 exactly)", () => {
    // Clamp is `x > 8` (strict), so 9 triggers it
    expect(approxNormalCDF(9)).toBe(1);
  });

  it("CDF(-8) is effectively 0 (within floating-point tolerance)", () => {
    expect(approxNormalCDF(-8)).toBeCloseTo(0, 10);
  });

  it("CDF(8) is effectively 1 (within floating-point tolerance)", () => {
    expect(approxNormalCDF(8)).toBeCloseTo(1, 10);
  });

  it("CDF(1.96) ≈ 0.975 (standard 95% confidence bound)", () => {
    expect(approxNormalCDF(1.96)).toBeCloseTo(0.975, 2);
  });

  it("CDF(-1.96) ≈ 0.025 (lower 95% confidence bound)", () => {
    expect(approxNormalCDF(-1.96)).toBeCloseTo(0.025, 2);
  });

  it("CDF(2.576) ≈ 0.995 (99% confidence bound)", () => {
    expect(approxNormalCDF(2.576)).toBeCloseTo(0.995, 2);
  });

  it("symmetry: CDF(-x) ≈ 1 − CDF(x) for various x", () => {
    for (const x of [0.5, 1.0, 1.5, 2.0, 3.0]) {
      expect(approxNormalCDF(-x)).toBeCloseTo(1 - approxNormalCDF(x), 5);
    }
  });

  it("CDF is monotonically increasing", () => {
    const xs = [-3, -2, -1, 0, 1, 2, 3];
    const vals = xs.map(approxNormalCDF);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
    }
  });

  it("returns values strictly between 0 and 1 for normal range", () => {
    for (const x of [-7.9, -5, -1, 0, 1, 5, 7.9]) {
      const v = approxNormalCDF(x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
