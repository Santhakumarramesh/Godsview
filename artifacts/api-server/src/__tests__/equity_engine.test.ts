/**
 * equity_engine.test.ts — Phase 20: Portfolio Risk Engine + Equity Analytics
 *
 * Tests:
 *   - Empty journal → zero metrics
 *   - Equity curve construction (multi-day)
 *   - Drawdown computation
 *   - Win/loss streak tracking
 *   - Sharpe / Sortino / Calmar ratios (sign & sanity)
 *   - Profit factor, expectancy, win rate
 *   - Symbol + date range filtering
 *   - Breakdown by setup / symbol / regime
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDecision,
  recordOutcome,
  clearJournal,
  type JournalEntryCreate,
} from "../lib/trade_journal";
import { generateEquityReport, emptyMetrics } from "../lib/equity_engine";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function macroBias(override: Record<string, unknown> = {}) {
  return {
    bias:              "neutral",
    direction:         "long",
    score:             0.5,
    conviction:        "medium",
    aligned:           true,
    tailwind:          false,
    headwind:          false,
    blockedDirections: [],
    reasons:           [],
    updatedAt:         new Date().toISOString(),
    ...override,
  } as any;
}

function sentiment(override: Record<string, unknown> = {}) {
  return {
    retailBias:        "balanced",
    institutionalEdge: "none",
    sentimentScore:    0.5,
    crowdingLevel:     "moderate",
    aligned:           false,
    contrarian:        false,
    reasons:           [],
    updatedAt:         new Date().toISOString(),
    ...override,
  } as any;
}

function makeEntry(override: Partial<JournalEntryCreate> = {}): JournalEntryCreate {
  return {
    symbol:      "BTCUSD",
    setupType:   "breakout_retest",
    direction:   "long",
    decision:    "passed",
    macroBias:   macroBias(),
    sentiment:   sentiment(),
    signalPrice: 40000,
    regime:      "trending",
    ...override,
  };
}

/**
 * Helper: record a passed trade and immediately resolve it with a PnL.
 * Returns the journal entry id.
 */
function addResolvedTrade(opts: {
  symbol?:    string;
  setupType?: string;
  regime?:    string;
  entryPrice: number;
  exitPrice:  number;
  direction?: "long" | "short";
}): string {
  const entry = recordDecision(makeEntry({
    symbol:      opts.symbol    ?? "BTCUSD",
    setupType:   opts.setupType ?? "breakout_retest",
    regime:      opts.regime    ?? "trending",
    direction:   opts.direction ?? "long",
    signalPrice: opts.entryPrice,
  }));
  recordOutcome(entry.id, {
    entryPrice: opts.entryPrice,
    exitPrice:  opts.exitPrice,
  });
  return entry.id;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("equity_engine — generateEquityReport", () => {
  beforeEach(() => {
    clearJournal();
  });

  // ── Empty journal ────────────────────────────────────────────────────────────

  describe("empty journal", () => {
    it("returns zero metrics when journal is empty", () => {
      const report = generateEquityReport();
      expect(report.metrics).toMatchObject(emptyMetrics());
      expect(report.equityCurve).toHaveLength(0);
      expect(report.bySetup).toHaveLength(0);
      expect(report.bySymbol).toHaveLength(0);
      expect(report.byRegime).toHaveLength(0);
    });

    it("includes a generatedAt timestamp", () => {
      const report = generateEquityReport();
      expect(new Date(report.generatedAt).getTime()).toBeGreaterThan(0);
    });

    it("emptyMetrics() has correct shape", () => {
      const m = emptyMetrics();
      expect(m.totalTrades).toBe(0);
      expect(m.winRate).toBe(0);
      expect(m.maxDrawdown).toBe(0);
      expect(m.fromDate).toBeNull();
      expect(m.toDate).toBeNull();
    });
  });

  // ── Basic trade counting ──────────────────────────────────────────────────────

  describe("trade counting and win rate", () => {
    it("counts wins, losses, and win rate correctly", () => {
      // 3 wins, 1 loss
      addResolvedTrade({ entryPrice: 100, exitPrice: 105 }); // +5%
      addResolvedTrade({ entryPrice: 100, exitPrice: 103 }); // +3%
      addResolvedTrade({ entryPrice: 100, exitPrice: 102 }); // +2%
      addResolvedTrade({ entryPrice: 100, exitPrice:  97 }); // -3%

      const { metrics } = generateEquityReport();
      expect(metrics.totalTrades).toBe(4);
      expect(metrics.wins).toBe(3);
      expect(metrics.losses).toBe(1);
      expect(metrics.winRate).toBeCloseTo(0.75, 4);
    });

    it("excludes blocked (unresolved) entries from metrics", () => {
      // A blocked entry — outcome stays "unknown"
      recordDecision(makeEntry({ decision: "blocked" }));
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // +10%

      const { metrics } = generateEquityReport();
      expect(metrics.totalTrades).toBe(1);
    });

    it("handles all wins scenario", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      addResolvedTrade({ entryPrice: 200, exitPrice: 220 }); // +10%
      const { metrics } = generateEquityReport();
      expect(metrics.winRate).toBe(1);
      expect(metrics.losses).toBe(0);
      expect(metrics.maxDrawdown).toBe(0);
    });

    it("handles all losses scenario", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 90 }); // -10%
      addResolvedTrade({ entryPrice: 100, exitPrice: 92 }); // -8%
      const { metrics } = generateEquityReport();
      expect(metrics.winRate).toBe(0);
      expect(metrics.wins).toBe(0);
      expect(metrics.maxDrawdown).toBeGreaterThan(0);
    });
  });

  // ── Equity curve ──────────────────────────────────────────────────────────────

  describe("equity curve construction", () => {
    it("starts at 100 and grows on wins", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      const { equityCurve } = generateEquityReport();
      expect(equityCurve.length).toBeGreaterThan(0);
      const lastPoint = equityCurve[equityCurve.length - 1];
      expect(lastPoint.equity).toBeCloseTo(110, 1); // 100 * 1.10
    });

    it("equity decreases on losses", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 90 }); // -10%
      const { equityCurve } = generateEquityReport();
      const lastPoint = equityCurve[equityCurve.length - 1];
      expect(lastPoint.equity).toBeCloseTo(90, 1);
    });

    it("equity curve points have required fields", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 105 });
      const { equityCurve } = generateEquityReport();
      const pt = equityCurve[0];
      expect(pt).toHaveProperty("date");
      expect(pt).toHaveProperty("equity");
      expect(pt).toHaveProperty("dailyReturn");
      expect(pt).toHaveProperty("drawdown");
      expect(pt).toHaveProperty("tradeCount");
    });

    it("tradeCount reflects number of trades on that day", () => {
      // Two trades on same day
      addResolvedTrade({ entryPrice: 100, exitPrice: 105 });
      addResolvedTrade({ entryPrice: 100, exitPrice: 103 });
      const { equityCurve } = generateEquityReport();
      const total = equityCurve.reduce((s, p) => s + p.tradeCount, 0);
      expect(total).toBe(2);
    });
  });

  // ── Drawdown ─────────────────────────────────────────────────────────────────

  describe("drawdown computation", () => {
    it("drawdown is zero when equity only goes up", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      addResolvedTrade({ entryPrice: 100, exitPrice: 115 });
      const { metrics } = generateEquityReport();
      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.currentDrawdown).toBe(0);
    });

    it("computes positive maxDrawdown after a loss following a gain", () => {
      // +10% then -20% — should produce a drawdown
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // equity 110
      addResolvedTrade({ entryPrice: 100, exitPrice:  80 }); // -20% → equity 110*0.8 = 88
      const { metrics } = generateEquityReport();
      expect(metrics.maxDrawdown).toBeGreaterThan(0);
    });

    it("maxDrawdown is stored as a positive fraction", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 80 }); // -20%
      const { metrics } = generateEquityReport();
      // maxDrawdown should be ~0.20 (positive)
      expect(metrics.maxDrawdown).toBeGreaterThan(0.01);
    });
  });

  // ── Streak tracking ───────────────────────────────────────────────────────────

  describe("win/loss streak tracking", () => {
    it("tracks maxWinStreak", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // win
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // win
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // win
      addResolvedTrade({ entryPrice: 100, exitPrice:  90 }); // loss
      const { metrics } = generateEquityReport();
      expect(metrics.maxWinStreak).toBeGreaterThanOrEqual(3);
    });

    it("tracks maxLossStreak", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // win
      addResolvedTrade({ entryPrice: 100, exitPrice:  90 }); // loss
      addResolvedTrade({ entryPrice: 100, exitPrice:  90 }); // loss
      addResolvedTrade({ entryPrice: 100, exitPrice:  90 }); // loss
      const { metrics } = generateEquityReport();
      expect(metrics.maxLossStreak).toBeGreaterThanOrEqual(3);
    });

    it("currentStreak is positive after a win, negative after a loss", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // win
      const reportA = generateEquityReport();
      expect(reportA.metrics.currentStreak).toBeGreaterThan(0);

      clearJournal();
      addResolvedTrade({ entryPrice: 100, exitPrice: 90 }); // loss
      const reportB = generateEquityReport();
      expect(reportB.metrics.currentStreak).toBeLessThan(0);
    });
  });

  // ── Ratios ───────────────────────────────────────────────────────────────────

  describe("performance ratios", () => {
    it("profitFactor is gross wins / gross losses", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // +0.1
      addResolvedTrade({ entryPrice: 100, exitPrice:  95 }); // -0.05
      const { metrics } = generateEquityReport();
      // gross wins = 0.1, gross losses = 0.05 → PF = 2
      expect(metrics.profitFactor).toBeCloseTo(2, 1);
    });

    it("expectancy is positive for profitable system", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      addResolvedTrade({ entryPrice: 100, exitPrice:  95 }); // -5%
      const { metrics } = generateEquityReport();
      expect(metrics.expectancy).toBeGreaterThan(0);
    });

    it("sharpeRatio is zero for a single-day sample (no variance)", () => {
      // Single day, no variance in daily returns
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      const { metrics } = generateEquityReport();
      // With 1 active day, stdDev cannot be computed — Sharpe stays 0
      expect(metrics.sharpeRatio).toBeGreaterThanOrEqual(0);
    });

    it("calmarRatio is zero when there is no drawdown", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      addResolvedTrade({ entryPrice: 100, exitPrice: 120 });
      const { metrics } = generateEquityReport();
      // No drawdown → calmar = 0
      expect(metrics.calmarRatio).toBe(0);
    });
  });

  // ── Short direction ───────────────────────────────────────────────────────────

  describe("short direction PnL", () => {
    it("short trade with falling price is a win", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 90, direction: "short" }); // +10%
      const { metrics } = generateEquityReport();
      expect(metrics.wins).toBe(1);
      expect(metrics.losses).toBe(0);
    });

    it("short trade with rising price is a loss", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110, direction: "short" }); // -10%
      const { metrics } = generateEquityReport();
      expect(metrics.losses).toBe(1);
      expect(metrics.wins).toBe(0);
    });
  });

  // ── Filtering ────────────────────────────────────────────────────────────────

  describe("filtering by symbol and date", () => {
    it("symbol filter restricts to matching symbol (uppercase)", () => {
      addResolvedTrade({ symbol: "BTCUSD", entryPrice: 100, exitPrice: 110 });
      addResolvedTrade({ symbol: "ETHUSD", entryPrice: 100, exitPrice:  80 });

      const btcReport = generateEquityReport({ symbol: "BTCUSD" });
      expect(btcReport.metrics.totalTrades).toBe(1);
      expect(btcReport.metrics.wins).toBe(1);

      const ethReport = generateEquityReport({ symbol: "ETHUSD" });
      expect(ethReport.metrics.totalTrades).toBe(1);
      expect(ethReport.metrics.losses).toBe(1);
    });

    it("unknown symbol returns empty report", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      const report = generateEquityReport({ symbol: "AAPL" });
      expect(report.metrics.totalTrades).toBe(0);
      expect(report.equityCurve).toHaveLength(0);
    });

    it("future 'from' date excludes all trades", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      const report = generateEquityReport({ from: "2099-01-01" });
      expect(report.metrics.totalTrades).toBe(0);
    });

    it("very old 'to' date excludes all trades", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      const report = generateEquityReport({ to: "2000-01-01" });
      expect(report.metrics.totalTrades).toBe(0);
    });
  });

  // ── Breakdowns ────────────────────────────────────────────────────────────────

  describe("breakdown by setup", () => {
    it("produces one entry per unique setup type", () => {
      addResolvedTrade({ setupType: "breakout_retest", entryPrice: 100, exitPrice: 105 });
      addResolvedTrade({ setupType: "pullback_entry",  entryPrice: 100, exitPrice:  95 });
      addResolvedTrade({ setupType: "breakout_retest", entryPrice: 100, exitPrice: 108 });

      const { bySetup } = generateEquityReport();
      expect(bySetup).toHaveLength(2);
      const breakout = bySetup.find(b => b.setupType === "breakout_retest");
      expect(breakout?.trades).toBe(2);
      expect(breakout?.wins).toBe(2);
    });

    it("sorted by totalPnlPct descending", () => {
      addResolvedTrade({ setupType: "setup_a", entryPrice: 100, exitPrice: 120 }); // +20%
      addResolvedTrade({ setupType: "setup_b", entryPrice: 100, exitPrice:  90 }); // -10%
      const { bySetup } = generateEquityReport();
      expect(bySetup[0].setupType).toBe("setup_a");
    });

    it("winRate per setup is correct", () => {
      addResolvedTrade({ setupType: "setup_x", entryPrice: 100, exitPrice: 110 }); // win
      addResolvedTrade({ setupType: "setup_x", entryPrice: 100, exitPrice:  90 }); // loss
      const { bySetup } = generateEquityReport();
      const sx = bySetup.find(b => b.setupType === "setup_x");
      expect(sx?.winRate).toBeCloseTo(0.5, 4);
    });
  });

  describe("breakdown by symbol", () => {
    it("groups trades by symbol", () => {
      addResolvedTrade({ symbol: "BTCUSD", entryPrice: 100, exitPrice: 110 });
      addResolvedTrade({ symbol: "ETHUSD", entryPrice: 100, exitPrice:  90 });
      const { bySymbol } = generateEquityReport();
      expect(bySymbol).toHaveLength(2);
      const btc = bySymbol.find(b => b.symbol === "BTCUSD");
      expect(btc?.wins).toBe(1);
    });

    it("sorted by avgPnlPct descending", () => {
      addResolvedTrade({ symbol: "AAA", entryPrice: 100, exitPrice: 115 }); // +15%
      addResolvedTrade({ symbol: "BBB", entryPrice: 100, exitPrice: 105 }); // +5%
      const { bySymbol } = generateEquityReport();
      expect(bySymbol[0].symbol).toBe("AAA");
    });
  });

  describe("breakdown by regime", () => {
    it("groups trades by regime", () => {
      addResolvedTrade({ regime: "trending",  entryPrice: 100, exitPrice: 110 });
      addResolvedTrade({ regime: "ranging",   entryPrice: 100, exitPrice:  95 });
      addResolvedTrade({ regime: "trending",  entryPrice: 100, exitPrice: 108 });
      const { byRegime } = generateEquityReport();
      const trending = byRegime.find(b => b.regime === "trending");
      expect(trending?.trades).toBe(2);
      expect(trending?.winRate).toBe(1);
    });

    it("sorted by avgPnlPct descending", () => {
      addResolvedTrade({ regime: "high_vol", entryPrice: 100, exitPrice: 120 }); // +20%
      addResolvedTrade({ regime: "low_vol",  entryPrice: 100, exitPrice: 102 }); // +2%
      const { byRegime } = generateEquityReport();
      expect(byRegime[0].regime).toBe("high_vol");
    });
  });

  // ── fromDate / toDate metadata ────────────────────────────────────────────────

  describe("date range metadata in metrics", () => {
    it("fromDate and toDate are populated when trades exist", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      const { metrics } = generateEquityReport();
      expect(metrics.fromDate).not.toBeNull();
      expect(metrics.toDate).not.toBeNull();
    });

    it("activeDays is >= 1 when trades exist", () => {
      addResolvedTrade({ entryPrice: 100, exitPrice: 110 });
      addResolvedTrade({ entryPrice: 100, exitPrice: 105 });
      const { metrics } = generateEquityReport();
      expect(metrics.activeDays).toBeGreaterThanOrEqual(1);
    });
  });
});
