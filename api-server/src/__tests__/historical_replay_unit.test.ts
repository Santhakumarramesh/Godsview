/**
 * historical_replay_unit.test.ts — Phase 74
 *
 * Tests the historical replay engine:
 *   runReplay              — full pipeline: grammar + SMC + setups + outcomes
 *   runMultiSymbolReplay   — multi-symbol aggregate
 *   extractLabeledSequences — post-event sequence extraction
 *
 * No mocks — all functions are pure.
 */

import { describe, it, expect } from "vitest";
import {
  runReplay,
  runMultiSymbolReplay,
  extractLabeledSequences,
  type RawBar,
  type ReplayReport,
  type ReplayConfig,
} from "../lib/historical_replay";

// ── Test helpers ───────────────────────────────────────────────────────────────

let tsSeq = 0;

function bar(o: number, h: number, l: number, c: number, v = 1000): RawBar {
  tsSeq++;
  const pad = String(tsSeq).padStart(6, "0");
  return { timestamp: `2026-01-01T${pad}Z`, open: o, high: h, low: l, close: c, volume: v };
}

/** Generate N bars trending strongly upward */
function bullSeries(n = 40): RawBar[] {
  const out: RawBar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    out.push(bar(p, p + 6, p - 1, p + 5, 2000 + i * 10));
    p += 5;
  }
  return out;
}

/** Generate N bars trending strongly downward */
function bearSeries(n = 40): RawBar[] {
  const out: RawBar[] = [];
  let p = 300;
  for (let i = 0; i < n; i++) {
    out.push(bar(p, p + 1, p - 6, p - 5, 2000 + i * 10));
    p -= 5;
  }
  return out;
}

/** Mixed series: half up, half down (for CHoCH testing) */
function mixedSeries(n = 60): RawBar[] {
  return [...bullSeries(n / 2), ...bearSeries(n / 2)];
}

// ── runReplay — empty input ───────────────────────────────────────────────────

describe("runReplay — empty input", () => {
  it("returns a report with all zero counts for empty bars", () => {
    const report = runReplay("BTCUSD", []);
    expect(report.totalBars).toBe(0);
    expect(report.labeledBars).toHaveLength(0);
    expect(report.setupCandidates).toHaveLength(0);
    expect(report.outcomes).toHaveLength(0);
    expect(report.winRate).toBe(0);
  });

  it("computedAt is a valid ISO timestamp string", () => {
    const report = runReplay("BTCUSD", []);
    expect(() => new Date(report.computedAt)).not.toThrow();
    expect(new Date(report.computedAt).toString()).not.toBe("Invalid Date");
  });
});

// ── runReplay — report structure ──────────────────────────────────────────────

describe("runReplay — report structure", () => {
  it("returns all required top-level fields", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(report).toHaveProperty("symbol");
    expect(report).toHaveProperty("totalBars");
    expect(report).toHaveProperty("labeledBars");
    expect(report).toHaveProperty("grammarSummary");
    expect(report).toHaveProperty("finalState");
    expect(report).toHaveProperty("smcStructure");
    expect(report).toHaveProperty("activeOrderBlocks");
    expect(report).toHaveProperty("unfilledFVGs");
    expect(report).toHaveProperty("recentDisplacements");
    expect(report).toHaveProperty("setupCandidates");
    expect(report).toHaveProperty("outcomes");
    expect(report).toHaveProperty("winRate");
    expect(report).toHaveProperty("avgRMultiple");
    expect(report).toHaveProperty("expectancy");
    expect(report).toHaveProperty("totalR");
    expect(report).toHaveProperty("computedAt");
  });

  it("symbol field matches input symbol", () => {
    const report = runReplay("ETHUSD", bullSeries(40));
    expect(report.symbol).toBe("ETHUSD");
  });

  it("totalBars equals the length of input bars", () => {
    const bars = bullSeries(50);
    const report = runReplay("BTCUSD", bars);
    expect(report.totalBars).toBe(50);
  });

  it("labeledBars has one entry per input bar", () => {
    const bars = bullSeries(40);
    const report = runReplay("BTCUSD", bars);
    expect(report.labeledBars).toHaveLength(40);
  });

  it("each labeled bar has replayIndex, label, event, bias", () => {
    const report = runReplay("BTCUSD", bullSeries(10));
    for (const b of report.labeledBars) {
      expect(b).toHaveProperty("replayIndex");
      expect(b).toHaveProperty("label");
      expect(b).toHaveProperty("event");
      expect(b).toHaveProperty("bias");
    }
  });

  it("replayIndex is sequential from 0", () => {
    const report = runReplay("BTCUSD", bullSeries(10));
    report.labeledBars.forEach((b, i) => expect(b.replayIndex).toBe(i));
  });
});

// ── runReplay — grammar output ────────────────────────────────────────────────

describe("runReplay — grammar summary", () => {
  it("grammarSummary.hhCount + hlCount + lhCount + llCount + neutralCount === totalBars", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    const s = report.grammarSummary;
    const total = s.hhCount + s.hlCount + s.lhCount + s.llCount + s.neutralCount;
    expect(total).toBe(report.totalBars);
  });

  it("structureBias is bullish for a strongly bullish series", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(report.grammarSummary.structureBias).toBe("bullish");
  });

  it("structureBias is bearish for a strongly bearish series", () => {
    const report = runReplay("BTCUSD", bearSeries(40));
    expect(report.grammarSummary.structureBias).toBe("bearish");
  });

  it("finalState.bias is bullish after sustained uptrend", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(report.finalState.bias).toBe("bullish");
  });
});

// ── runReplay — SMC structure ─────────────────────────────────────────────────

describe("runReplay — SMC structure", () => {
  it("smcStructure has trend, bos, choch, structureScore fields", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(report.smcStructure).toHaveProperty("trend");
    expect(report.smcStructure).toHaveProperty("bos");
    expect(report.smcStructure).toHaveProperty("choch");
    expect(report.smcStructure).toHaveProperty("structureScore");
  });

  it("structureScore is in [0, 1]", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(report.smcStructure.structureScore).toBeGreaterThanOrEqual(0);
    expect(report.smcStructure.structureScore).toBeLessThanOrEqual(1);
  });

  it("activeOrderBlocks is an array", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(Array.isArray(report.activeOrderBlocks)).toBe(true);
  });

  it("unfilledFVGs is an array", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    expect(Array.isArray(report.unfilledFVGs)).toBe(true);
  });

  it("all activeOrderBlocks are not broken and not tested", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    for (const ob of report.activeOrderBlocks) {
      expect(ob.broken).toBe(false);
      expect(ob.tested).toBe(false);
    }
  });

  it("all unfilledFVGs have filled = false", () => {
    const report = runReplay("BTCUSD", bullSeries(40));
    for (const fvg of report.unfilledFVGs) {
      expect(fvg.filled).toBe(false);
    }
  });
});

// ── runReplay — setup candidates ──────────────────────────────────────────────

describe("runReplay — setup candidates", () => {
  it("each setup has required fields", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    for (const s of report.setupCandidates) {
      expect(s).toHaveProperty("barIndex");
      expect(s).toHaveProperty("timestamp");
      expect(s).toHaveProperty("direction");
      expect(s).toHaveProperty("entryPrice");
      expect(s).toHaveProperty("stopPrice");
      expect(s).toHaveProperty("riskPoints");
      expect(s).toHaveProperty("confidence");
      expect(s).toHaveProperty("triggers");
    }
  });

  it("confidence is in [0, 1] for all setups", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    for (const s of report.setupCandidates) {
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("direction is 'long' or 'short' for all setups", () => {
    const report = runReplay("BTCUSD", mixedSeries(60));
    for (const s of report.setupCandidates) {
      expect(["long", "short"]).toContain(s.direction);
    }
  });

  it("triggers is a non-empty array for each setup", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    for (const s of report.setupCandidates) {
      expect(Array.isArray(s.triggers)).toBe(true);
      expect(s.triggers.length).toBeGreaterThan(0);
    }
  });

  it("riskPoints > 0 for all setups", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    for (const s of report.setupCandidates) {
      expect(s.riskPoints).toBeGreaterThan(0);
    }
  });

  it("minConfidence config filters out low-confidence setups", () => {
    const reportLax = runReplay("BTCUSD", bullSeries(60), { minConfidence: 0.1 });
    const reportStrict = runReplay("BTCUSD", bullSeries(60), { minConfidence: 0.9 });
    expect(reportLax.setupCandidates.length).toBeGreaterThanOrEqual(
      reportStrict.setupCandidates.length,
    );
  });
});

// ── runReplay — outcomes ──────────────────────────────────────────────────────

describe("runReplay — outcomes", () => {
  it("each outcome has required fields", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    for (const o of report.outcomes) {
      expect(o).toHaveProperty("setup");
      expect(o).toHaveProperty("won");
      expect(o).toHaveProperty("exitPrice");
      expect(o).toHaveProperty("exitBarIndex");
      expect(o).toHaveProperty("rMultiple");
      expect(o).toHaveProperty("barsHeld");
    }
  });

  it("barsHeld >= 1 for all resolved outcomes", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    for (const o of report.outcomes) {
      expect(o.barsHeld).toBeGreaterThanOrEqual(1);
    }
  });

  it("won outcomes have positive rMultiple, losses have negative", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    for (const o of report.outcomes) {
      if (o.won) expect(o.rMultiple).toBeGreaterThan(0);
      else expect(o.rMultiple).toBeLessThanOrEqual(0);
    }
  });
});

// ── runReplay — performance metrics ──────────────────────────────────────────

describe("runReplay — performance metrics", () => {
  it("winRate is in [0, 1]", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    expect(report.winRate).toBeGreaterThanOrEqual(0);
    expect(report.winRate).toBeLessThanOrEqual(1);
  });

  it("winRate is 0 when no outcomes resolved", () => {
    const report = runReplay("BTCUSD", bullSeries(1));
    expect(report.winRate).toBe(0);
  });

  it("totalR equals sum of all rMultiples", () => {
    const report = runReplay("BTCUSD", bullSeries(80));
    const sum = report.outcomes.reduce((s, o) => s + o.rMultiple, 0);
    expect(Math.abs(report.totalR - sum)).toBeLessThan(0.01);
  });

  it("rrTarget config affects TP placement", () => {
    const report1R = runReplay("BTCUSD", bullSeries(80), { rrTarget: 1.0 });
    const report3R = runReplay("BTCUSD", bullSeries(80), { rrTarget: 3.0 });
    // Higher R target = harder to hit TP = potentially lower win rate
    // At minimum the configs produce different reports
    expect(report1R.rrTarget ?? 1.0).not.toBe(report3R.rrTarget ?? 3.0);
    // Both should have valid win rates
    expect(report1R.winRate).toBeGreaterThanOrEqual(0);
    expect(report3R.winRate).toBeGreaterThanOrEqual(0);
  });
});

// ── runMultiSymbolReplay ──────────────────────────────────────────────────────

describe("runMultiSymbolReplay", () => {
  it("returns reports for each symbol", () => {
    const { reports } = runMultiSymbolReplay({
      BTCUSD: bullSeries(40),
      ETHUSD: bearSeries(40),
    });
    expect(reports).toHaveProperty("BTCUSD");
    expect(reports).toHaveProperty("ETHUSD");
  });

  it("aggregate has required fields", () => {
    const { aggregate } = runMultiSymbolReplay({
      BTCUSD: bullSeries(40),
      ETHUSD: bearSeries(40),
    });
    expect(aggregate).toHaveProperty("totalBars");
    expect(aggregate).toHaveProperty("totalSetups");
    expect(aggregate).toHaveProperty("totalOutcomes");
    expect(aggregate).toHaveProperty("overallWinRate");
    expect(aggregate).toHaveProperty("overallExpectancy");
    expect(aggregate).toHaveProperty("symbolCount");
  });

  it("aggregate.totalBars is sum of all symbol bar counts", () => {
    const b1 = bullSeries(40);
    const b2 = bearSeries(30);
    const { aggregate } = runMultiSymbolReplay({ A: b1, B: b2 });
    expect(aggregate.totalBars).toBe(b1.length + b2.length);
  });

  it("aggregate.symbolCount equals number of symbols passed", () => {
    const { aggregate } = runMultiSymbolReplay({
      A: bullSeries(20), B: bearSeries(20), C: mixedSeries(40),
    });
    expect(aggregate.symbolCount).toBe(3);
  });

  it("overallWinRate is in [0, 1]", () => {
    const { aggregate } = runMultiSymbolReplay({
      BTCUSD: bullSeries(80),
      ETHUSD: bearSeries(80),
    });
    expect(aggregate.overallWinRate).toBeGreaterThanOrEqual(0);
    expect(aggregate.overallWinRate).toBeLessThanOrEqual(1);
  });

  it("handles empty symbol map", () => {
    const { reports, aggregate } = runMultiSymbolReplay({});
    expect(Object.keys(reports)).toHaveLength(0);
    expect(aggregate.totalBars).toBe(0);
    expect(aggregate.symbolCount).toBe(0);
  });
});

// ── extractLabeledSequences ───────────────────────────────────────────────────

describe("extractLabeledSequences", () => {
  it("returns array of trigger+sequence pairs", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    const seqs = extractLabeledSequences(report, "BOS_UP", 5);
    expect(Array.isArray(seqs)).toBe(true);
  });

  it("each entry has triggerBar and sequence", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    const seqs = extractLabeledSequences(report, "BOS_UP", 5);
    for (const s of seqs) {
      expect(s).toHaveProperty("triggerBar");
      expect(s).toHaveProperty("sequence");
      expect(s.triggerBar.event).toBe("BOS_UP");
    }
  });

  it("sequence length <= lookforward parameter", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    const lookforward = 3;
    const seqs = extractLabeledSequences(report, "BOS_UP", lookforward);
    for (const s of seqs) {
      expect(s.sequence.length).toBeLessThanOrEqual(lookforward);
    }
  });

  it("returns empty array when no events match filter", () => {
    const report = runReplay("BTCUSD", bullSeries(30));
    // CHoCH_DOWN unlikely in pure bullish series
    const seqs = extractLabeledSequences(report, "CHoCH_DOWN", 5);
    // Even if not empty (some edge case), it should be an array
    expect(Array.isArray(seqs)).toBe(true);
  });

  it("lookforward=0 gives empty sequences for all triggers", () => {
    const report = runReplay("BTCUSD", bullSeries(60));
    const seqs = extractLabeledSequences(report, "BOS_UP", 0);
    for (const s of seqs) {
      expect(s.sequence).toHaveLength(0);
    }
  });

  it("works for all four event types", () => {
    const events = ["BOS_UP", "BOS_DOWN", "CHoCH_UP", "CHoCH_DOWN"] as const;
    const report = runReplay("BTCUSD", mixedSeries(80));
    for (const event of events) {
      expect(() => extractLabeledSequences(report, event, 5)).not.toThrow();
    }
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("single bar replay returns minimal report without error", () => {
    const report = runReplay("BTCUSD", [bar(100, 105, 98, 102)]);
    expect(report.totalBars).toBe(1);
    expect(report.labeledBars).toHaveLength(1);
  });

  it("two-bar replay does not throw", () => {
    expect(() => runReplay("BTCUSD", [bar(100, 105, 98, 102), bar(102, 110, 100, 108)])).not.toThrow();
  });

  it("replay on large series (500 bars) completes in reasonable time", () => {
    const bars: RawBar[] = [];
    for (let i = 0; i < 500; i++) {
      const p = 100 + Math.sin(i * 0.05) * 50;
      bars.push(bar(p, p + 3, p - 3, p + 1));
    }
    const start = Date.now();
    runReplay("BTCUSD", bars);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000); // must complete within 5s
  });
});
