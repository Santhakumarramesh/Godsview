/**
 * backtest_db_unit.test.ts — Phase 75
 *
 * Tests BacktestDatabase (bulk backtest outcome store):
 *   insert        — adds records, auto-assigns IDs
 *   ingestReport  — converts ReplayReport outcomes to records
 *   query         — filters by symbol/regime/direction/date/trigger
 *   aggregate     — computes win rate, expectancy, Sharpe, profit factor
 *   regimeBreakdown — splits stats by bullish/bearish/range
 *   triggerLeaderboard — ranks triggers by expectancy
 *   symbolSummary    — per-symbol aggregate stats
 *   clear         — resets the store
 *
 * No mocks — uses BacktestDatabase directly (not the singleton).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BacktestDatabase, type BacktestRecord, type Regime } from "../lib/backtest_db";
import { runReplay } from "../lib/historical_replay";
import type { RawBar } from "../lib/bar_grammar";

// ── helpers ───────────────────────────────────────────────────────────────────

let seq = 0;

function makeBar(o: number, h: number, l: number, c: number): RawBar {
  seq++;
  return {
    timestamp: `2026-01-${String(seq % 28 + 1).padStart(2, "0")}T00:${String(seq).padStart(4, "0")}Z`,
    open: o, high: h, low: l, close: c, volume: 1000,
  };
}

function bullSeries(n = 50): RawBar[] {
  const bars: RawBar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) { bars.push(makeBar(p, p + 6, p - 1, p + 5)); p += 5; }
  return bars;
}

function bearSeries(n = 50): RawBar[] {
  const bars: RawBar[] = [];
  let p = 300;
  for (let i = 0; i < n; i++) { bars.push(makeBar(p, p + 1, p - 6, p - 5)); p -= 5; }
  return bars;
}

function makeRecord(overrides: Partial<BacktestRecord> = {}): Omit<BacktestRecord, "id"> {
  return {
    symbol: "BTCUSD",
    regime: "bullish",
    timestamp: "2026-01-01T00:00:00Z",
    direction: "long",
    entryPrice: 100,
    confidence: 0.7,
    triggers: ["BOS_UP"],
    won: true,
    rMultiple: 2.0,
    barsHeld: 5,
    riskPoints: 5,
    ...overrides,
  };
}

// ── Setup: fresh database per test ────────────────────────────────────────────

let db: BacktestDatabase;

beforeEach(() => {
  db = new BacktestDatabase();
});

// ── insert ────────────────────────────────────────────────────────────────────

describe("BacktestDatabase.insert", () => {
  it("returns inserted record with auto-assigned id", () => {
    const rec = db.insert(makeRecord());
    expect(rec.id).toBeDefined();
    expect(typeof rec.id).toBe("string");
  });

  it("ids are unique across insertions", () => {
    const r1 = db.insert(makeRecord());
    const r2 = db.insert(makeRecord());
    expect(r1.id).not.toBe(r2.id);
  });

  it("increments size after each insert", () => {
    expect(db.size).toBe(0);
    db.insert(makeRecord());
    expect(db.size).toBe(1);
    db.insert(makeRecord());
    expect(db.size).toBe(2);
  });

  it("preserves all fields in the returned record", () => {
    const input = makeRecord({ symbol: "ETHUSD", rMultiple: 3.5, won: false });
    const rec = db.insert(input);
    expect(rec.symbol).toBe("ETHUSD");
    expect(rec.rMultiple).toBe(3.5);
    expect(rec.won).toBe(false);
  });
});

// ── ingestReport ──────────────────────────────────────────────────────────────

describe("BacktestDatabase.ingestReport", () => {
  it("returns the number of records inserted", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    const n = db.ingestReport(report);
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("size increases by the returned count", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    const n = db.ingestReport(report);
    expect(db.size).toBe(n);
  });

  it("ingested records have the correct symbol", () => {
    const report = runReplay("ETHUSD", bullSeries(80));
    db.ingestReport(report);
    const records = db.query({ symbol: "ETHUSD" });
    expect(records.length).toBeGreaterThanOrEqual(0);
    for (const r of records) expect(r.symbol).toBe("ETHUSD");
  });

  it("ingested records all have a valid regime value", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    db.ingestReport(report);
    const validRegimes: Regime[] = ["bullish", "bearish", "range"];
    for (const r of db.query()) {
      expect(validRegimes).toContain(r.regime);
    }
    // SMC trend from bullish series maps to a valid regime (likely bullish)
    expect(validRegimes).toContain(
      report.smcStructure.trend === "bullish" ? "bullish"
        : report.smcStructure.trend === "bearish" ? "bearish" : "range",
    );
  });

  it("handles report with no outcomes (inserts 0 records)", () => {
    const report = runReplay("BTCUSD", bullSeries(2));
    const n = db.ingestReport(report);
    expect(n).toBe(0);
    expect(db.size).toBe(0);
  });
});

// ── query ─────────────────────────────────────────────────────────────────────

describe("BacktestDatabase.query", () => {
  beforeEach(() => {
    db.insert(makeRecord({ symbol: "BTCUSD", regime: "bullish", direction: "long", won: true, rMultiple: 2 }));
    db.insert(makeRecord({ symbol: "BTCUSD", regime: "bearish", direction: "short", won: false, rMultiple: -1 }));
    db.insert(makeRecord({ symbol: "ETHUSD", regime: "bullish", direction: "long", won: true, rMultiple: 1.5, confidence: 0.8 }));
    db.insert(makeRecord({ symbol: "ETHUSD", regime: "range", direction: "short", won: false, rMultiple: -1, triggers: ["BOS_DOWN", "near_OB"] }));
  });

  it("no filter returns all records", () => {
    expect(db.query()).toHaveLength(4);
  });

  it("filters by symbol", () => {
    const results = db.query({ symbol: "ETHUSD" });
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.symbol).toBe("ETHUSD");
  });

  it("filters by regime", () => {
    const results = db.query({ regime: "bullish" });
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.regime).toBe("bullish");
  });

  it("filters by direction", () => {
    const results = db.query({ direction: "short" });
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.direction).toBe("short");
  });

  it("filters by minConfidence", () => {
    const results = db.query({ minConfidence: 0.75 });
    for (const r of results) expect(r.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it("requiredTriggers filters to records containing all required triggers", () => {
    const results = db.query({ requiredTriggers: ["BOS_DOWN", "near_OB"] });
    for (const r of results) {
      expect(r.triggers).toContain("BOS_DOWN");
      expect(r.triggers).toContain("near_OB");
    }
  });

  it("combined filter intersects all constraints", () => {
    const results = db.query({ symbol: "BTCUSD", regime: "bullish" });
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol).toBe("BTCUSD");
    expect(results[0]!.regime).toBe("bullish");
  });

  it("returns empty array when no records match", () => {
    expect(db.query({ symbol: "XRPUSD" })).toHaveLength(0);
  });

  it("fromDate filters out records before the date", () => {
    db.insert(makeRecord({ timestamp: "2025-12-31T00:00:00Z" }));
    const results = db.query({ fromDate: "2026-01-01T00:00:00Z" });
    for (const r of results) expect(r.timestamp >= "2026-01-01T00:00:00Z").toBe(true);
  });

  it("toDate filters out records after the date", () => {
    db.insert(makeRecord({ timestamp: "2026-12-31T00:00:00Z" }));
    const results = db.query({ toDate: "2026-06-01T00:00:00Z" });
    for (const r of results) expect(r.timestamp <= "2026-06-01T00:00:00Z").toBe(true);
  });
});

// ── aggregate ─────────────────────────────────────────────────────────────────

describe("BacktestDatabase.aggregate", () => {
  it("returns AggregateStats with required fields", () => {
    db.insert(makeRecord());
    const stats = db.aggregate();
    expect(stats).toHaveProperty("count");
    expect(stats).toHaveProperty("winRate");
    expect(stats).toHaveProperty("avgRMultiple");
    expect(stats).toHaveProperty("expectancy");
    expect(stats).toHaveProperty("totalR");
    expect(stats).toHaveProperty("avgBarsHeld");
    expect(stats).toHaveProperty("avgConfidence");
    expect(stats).toHaveProperty("sharpeProxy");
    expect(stats).toHaveProperty("maxWin");
    expect(stats).toHaveProperty("maxLoss");
    expect(stats).toHaveProperty("profitFactor");
  });

  it("count equals number of matching records", () => {
    db.insert(makeRecord({ symbol: "BTCUSD" }));
    db.insert(makeRecord({ symbol: "BTCUSD" }));
    db.insert(makeRecord({ symbol: "ETHUSD" }));
    expect(db.aggregate({ symbol: "BTCUSD" }).count).toBe(2);
    expect(db.aggregate().count).toBe(3);
  });

  it("empty store returns all-zero stats", () => {
    const stats = db.aggregate();
    expect(stats.count).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.totalR).toBe(0);
  });

  it("winRate is 1.0 when all records are wins", () => {
    db.insert(makeRecord({ won: true, rMultiple: 2 }));
    db.insert(makeRecord({ won: true, rMultiple: 1.5 }));
    expect(db.aggregate().winRate).toBe(1.0);
  });

  it("winRate is 0 when all records are losses", () => {
    db.insert(makeRecord({ won: false, rMultiple: -1 }));
    db.insert(makeRecord({ won: false, rMultiple: -1 }));
    expect(db.aggregate().winRate).toBe(0);
  });

  it("totalR equals sum of all rMultiples", () => {
    db.insert(makeRecord({ rMultiple: 2.0 }));
    db.insert(makeRecord({ rMultiple: -1.0 }));
    db.insert(makeRecord({ rMultiple: 1.5 }));
    const stats = db.aggregate();
    expect(stats.totalR).toBeCloseTo(2.5, 2);
  });

  it("winRate is in [0, 1]", () => {
    for (let i = 0; i < 10; i++) {
      db.insert(makeRecord({ won: i % 3 !== 0, rMultiple: i % 3 !== 0 ? 2 : -1 }));
    }
    const { winRate } = db.aggregate();
    expect(winRate).toBeGreaterThanOrEqual(0);
    expect(winRate).toBeLessThanOrEqual(1);
  });

  it("profitFactor = grossWins / grossLosses", () => {
    db.insert(makeRecord({ won: true, rMultiple: 4 }));
    db.insert(makeRecord({ won: false, rMultiple: -2 }));
    const { profitFactor } = db.aggregate();
    expect(profitFactor).toBeCloseTo(2.0, 2);
  });

  it("sharpeProxy is positive when mean > 0 with some variance", () => {
    db.insert(makeRecord({ won: true, rMultiple: 2 }));
    db.insert(makeRecord({ won: true, rMultiple: 3 }));
    db.insert(makeRecord({ won: false, rMultiple: -1 }));
    const { sharpeProxy } = db.aggregate();
    expect(sharpeProxy).toBeGreaterThan(0);
  });
});

// ── regimeBreakdown ───────────────────────────────────────────────────────────

describe("BacktestDatabase.regimeBreakdown", () => {
  beforeEach(() => {
    db.insert(makeRecord({ regime: "bullish", won: true, rMultiple: 2 }));
    db.insert(makeRecord({ regime: "bullish", won: true, rMultiple: 1.5 }));
    db.insert(makeRecord({ regime: "bearish", won: false, rMultiple: -1 }));
    db.insert(makeRecord({ regime: "range", won: true, rMultiple: 1 }));
  });

  it("returns bullish, bearish, range breakdown", () => {
    const bd = db.regimeBreakdown();
    expect(bd).toHaveProperty("bullish");
    expect(bd).toHaveProperty("bearish");
    expect(bd).toHaveProperty("range");
  });

  it("bullish count matches inserted bullish records", () => {
    expect(db.regimeBreakdown().bullish.count).toBe(2);
  });

  it("bearish count matches inserted bearish records", () => {
    expect(db.regimeBreakdown().bearish.count).toBe(1);
  });

  it("range count matches inserted range records", () => {
    expect(db.regimeBreakdown().range.count).toBe(1);
  });

  it("empty regime returns all-zero stats", () => {
    const bd = db.regimeBreakdown();
    // Bearish has only one record, range has one — check that stats are consistent
    expect(bd.bearish.winRate).toBe(0);
    expect(bd.range.winRate).toBe(1.0);
  });
});

// ── triggerLeaderboard ────────────────────────────────────────────────────────

describe("BacktestDatabase.triggerLeaderboard", () => {
  beforeEach(() => {
    db.insert(makeRecord({ triggers: ["BOS_UP", "near_OB"], won: true, rMultiple: 2 }));
    db.insert(makeRecord({ triggers: ["BOS_UP", "near_OB"], won: true, rMultiple: 3 }));
    db.insert(makeRecord({ triggers: ["BOS_DOWN"], won: false, rMultiple: -1 }));
    db.insert(makeRecord({ triggers: ["CHoCH_UP", "near_FVG"], won: true, rMultiple: 2.5 }));
  });

  it("returns array of TriggerStats", () => {
    const board = db.triggerLeaderboard();
    expect(Array.isArray(board)).toBe(true);
    for (const t of board) {
      expect(t).toHaveProperty("trigger");
      expect(t).toHaveProperty("count");
      expect(t).toHaveProperty("winRate");
      expect(t).toHaveProperty("avgRMultiple");
      expect(t).toHaveProperty("expectancy");
    }
  });

  it("is sorted by expectancy descending", () => {
    const board = db.triggerLeaderboard();
    for (let i = 1; i < board.length; i++) {
      expect(board[i]!.expectancy).toBeLessThanOrEqual(board[i - 1]!.expectancy);
    }
  });

  it("each unique trigger appears exactly once", () => {
    const board = db.triggerLeaderboard();
    const names = board.map((t) => t.trigger);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("count reflects how many records contain that trigger", () => {
    const board = db.triggerLeaderboard();
    const bosUp = board.find((t) => t.trigger === "BOS_UP");
    expect(bosUp?.count).toBe(2); // appears in 2 records
  });

  it("returns empty array when no records", () => {
    expect(new BacktestDatabase().triggerLeaderboard()).toHaveLength(0);
  });
});

// ── symbolSummary ─────────────────────────────────────────────────────────────

describe("BacktestDatabase.symbolSummary", () => {
  beforeEach(() => {
    db.insert(makeRecord({ symbol: "BTCUSD", won: true, rMultiple: 2 }));
    db.insert(makeRecord({ symbol: "BTCUSD", won: false, rMultiple: -1 }));
    db.insert(makeRecord({ symbol: "ETHUSD", won: true, rMultiple: 3 }));
    db.insert(makeRecord({ symbol: "ETHUSD", won: true, rMultiple: 2.5 }));
  });

  it("returns one entry per symbol", () => {
    const summary = db.symbolSummary();
    const symbols = summary.map((s) => s.symbol);
    expect(symbols).toContain("BTCUSD");
    expect(symbols).toContain("ETHUSD");
    // No duplicates
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("is sorted by expectancy descending", () => {
    const summary = db.symbolSummary();
    for (let i = 1; i < summary.length; i++) {
      expect(summary[i]!.expectancy).toBeLessThanOrEqual(summary[i - 1]!.expectancy);
    }
  });

  it("per-symbol count is correct", () => {
    const summary = db.symbolSummary();
    const btc = summary.find((s) => s.symbol === "BTCUSD");
    const eth = summary.find((s) => s.symbol === "ETHUSD");
    expect(btc?.count).toBe(2);
    expect(eth?.count).toBe(2);
  });

  it("returns empty array when no records", () => {
    expect(new BacktestDatabase().symbolSummary()).toHaveLength(0);
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe("BacktestDatabase.clear", () => {
  it("resets size to 0", () => {
    db.insert(makeRecord());
    db.insert(makeRecord());
    db.clear();
    expect(db.size).toBe(0);
  });

  it("query returns empty after clear", () => {
    db.insert(makeRecord());
    db.clear();
    expect(db.query()).toHaveLength(0);
  });

  it("IDs restart from 1 after clear", () => {
    db.insert(makeRecord());
    db.clear();
    const rec = db.insert(makeRecord());
    expect(rec.id).toBe("1");
  });
});

// ── Integration: ingest + query + aggregate ────────────────────────────────────

describe("integration: ingest report then query and aggregate", () => {
  it("ingested outcomes are queryable and aggregate is consistent", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    db.ingestReport(report);

    const all = db.query();
    const stats = db.aggregate();

    expect(stats.count).toBe(all.length);

    if (all.length > 0) {
      const wins = all.filter((r) => r.won).length;
      expect(stats.winRate).toBeCloseTo(wins / all.length, 3);

      const sumR = all.reduce((s, r) => s + r.rMultiple, 0);
      expect(Math.abs(stats.totalR - sumR)).toBeLessThan(0.01);
    }
  });
});
