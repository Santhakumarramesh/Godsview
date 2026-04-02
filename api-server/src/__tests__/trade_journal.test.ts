/**
 * trade_journal.test.ts — Phase 18: Trade Journal + PnL Attribution
 *
 * Tests:
 *   - Trade journal CRUD: record, retrieve, list, clear
 *   - Outcome recording: PnL calculation, outcome classification
 *   - Stats aggregation
 *   - Attribution engine: gate attribution, macro/sentiment segmentation
 *   - Layer verdict logic
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDecision,
  recordOutcome,
  getJournalEntry,
  listJournalEntries,
  getJournalStats,
  clearJournal,
  type JournalEntryCreate,
} from "../lib/trade_journal";
import {
  generateAttributionReport,
  getYtwGateSummary,
} from "../lib/attribution_engine";

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
    setupType:   "breakout",
    direction:   "long",
    decision:    "passed",
    macroBias:   macroBias(),
    sentiment:   sentiment(),
    signalPrice: 50_000,
    regime:      "trending",
    ...override,
  };
}

// ─── Suite 1: Trade Journal CRUD ──────────────────────────────────────────────

describe("TradeJournal — CRUD", () => {
  beforeEach(() => clearJournal());

  it("records a passed decision and retrieves it by ID", () => {
    const e = recordDecision(makeEntry({ decision: "passed" }));
    expect(e.id).toMatch(/^jrn_/);
    expect(e.decision).toBe("passed");
    expect(e.symbol).toBe("BTCUSD");
    expect(e.outcome).toBe("unknown");
    expect(e.pnlPct).toBeNull();

    const fetched = getJournalEntry(e.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(e.id);
  });

  it("records a blocked decision with block reason", () => {
    const e = recordDecision(makeEntry({
      decision:    "blocked",
      blockReason: "macro_bias_block",
    }));
    expect(e.decision).toBe("blocked");
    expect(e.blockReason).toBe("macro_bias_block");
  });

  it("returns undefined for unknown ID", () => {
    expect(getJournalEntry("jrn_nonexistent_0000")).toBeUndefined();
  });

  it("lists entries newest-first", () => {
    for (let i = 0; i < 5; i++) recordDecision(makeEntry({ symbol: `SYM${i}` as any }));
    const entries = listJournalEntries({ limit: 5 });
    expect(entries).toHaveLength(5);
    // Newest first: SYM4 should be first
    expect(entries[0].symbol).toBe("SYM4");
    expect(entries[4].symbol).toBe("SYM0");
  });

  it("filters entries by symbol", () => {
    recordDecision(makeEntry({ symbol: "BTCUSD" }));
    recordDecision(makeEntry({ symbol: "ETHUSD" }));
    const btc = listJournalEntries({ symbol: "BTCUSD" });
    expect(btc.every(e => e.symbol === "BTCUSD")).toBe(true);
    expect(btc.length).toBe(1);
  });

  it("filters entries by decision", () => {
    recordDecision(makeEntry({ decision: "passed" }));
    recordDecision(makeEntry({ decision: "blocked", blockReason: "chop_regime" }));
    const blocked = listJournalEntries({ decision: "blocked" });
    expect(blocked.every(e => e.decision === "blocked")).toBe(true);
    expect(blocked.length).toBe(1);
  });

  it("clears all entries", () => {
    recordDecision(makeEntry());
    recordDecision(makeEntry());
    clearJournal();
    expect(listJournalEntries().length).toBe(0);
  });
});

// ─── Suite 2: Outcome Recording & PnL ─────────────────────────────────────────

describe("TradeJournal — Outcome Recording", () => {
  beforeEach(() => clearJournal());

  it("computes long PnL correctly: 50000 → 52500 = +5%", () => {
    const e = recordDecision(makeEntry({ direction: "long", signalPrice: 50_000 }));
    const updated = recordOutcome(e.id, { entryPrice: 50_000, exitPrice: 52_500 });
    expect(updated).not.toBeNull();
    expect(updated!.pnlPct).toBeCloseTo(0.05, 5);
    expect(updated!.outcome).toBe("win");
  });

  it("computes short PnL correctly: entry 50000 → exit 48000 = +4%", () => {
    const e = recordDecision(makeEntry({ direction: "short", signalPrice: 50_000 }));
    const updated = recordOutcome(e.id, { entryPrice: 50_000, exitPrice: 48_000 });
    expect(updated!.pnlPct).toBeCloseTo(0.04, 5);
    expect(updated!.outcome).toBe("win");
  });

  it("classifies a losing long trade", () => {
    const e = recordDecision(makeEntry({ direction: "long" }));
    const updated = recordOutcome(e.id, { entryPrice: 50_000, exitPrice: 48_000 });
    expect(updated!.pnlPct).toBeCloseTo(-0.04, 5);
    expect(updated!.outcome).toBe("loss");
  });

  it("classifies breakeven within 0.1% band", () => {
    const e = recordDecision(makeEntry({ direction: "long" }));
    const updated = recordOutcome(e.id, { entryPrice: 50_000, exitPrice: 50_040 }); // +0.08%
    expect(updated!.outcome).toBe("breakeven");
  });

  it("accepts manual outcome override without prices", () => {
    const e = recordDecision(makeEntry());
    const updated = recordOutcome(e.id, { outcome: "win" });
    expect(updated!.outcome).toBe("win");
    expect(updated!.pnlPct).toBeNull();
  });

  it("returns null for unknown entry ID", () => {
    const result = recordOutcome("jrn_nonexistent_0000", { outcome: "win" });
    expect(result).toBeNull();
  });
});

// ─── Suite 3: Journal Stats ────────────────────────────────────────────────────

describe("TradeJournal — Stats", () => {
  beforeEach(() => clearJournal());

  it("returns zero stats on empty journal", () => {
    const s = getJournalStats();
    expect(s.total).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.avgPnlPct).toBe(0);
  });

  it("counts wins, losses, and computes win rate", () => {
    // 2 wins, 1 loss
    for (let i = 0; i < 3; i++) {
      const e = recordDecision(makeEntry({ decision: "passed" }));
      const outcome = i < 2 ? "win" : "loss";
      recordOutcome(e.id, { outcome });
    }
    const s = getJournalStats();
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 5);
  });

  it("separates blocked vs passed counts", () => {
    recordDecision(makeEntry({ decision: "passed" }));
    recordDecision(makeEntry({ decision: "passed" }));
    recordDecision(makeEntry({ decision: "blocked", blockReason: "macro_bias_block" }));
    const s = getJournalStats();
    expect(s.passed).toBe(2);
    expect(s.blocked).toBe(1);
    expect(s.total).toBe(3);
  });
});

// ─── Suite 4: Attribution Engine — Gate Attribution ───────────────────────────

describe("AttributionEngine — Gate Attribution", () => {
  beforeEach(() => clearJournal());

  it("returns empty report with no entries", () => {
    const report = generateAttributionReport();
    expect(report.totalEntries).toBe(0);
    expect(report.gateAttribution).toHaveLength(0);
  });

  it("computes save rate for macro_bias_block gate", () => {
    // 3 saves (blocks that would have lost), 1 miss (block that would have won)
    for (let i = 0; i < 4; i++) {
      const e = recordDecision(makeEntry({ decision: "blocked", blockReason: "macro_bias_block" }));
      // saves = "loss" outcome (blocked a trade that would have lost)
      // misses = "win" outcome (blocked a trade that would have won)
      recordOutcome(e.id, { outcome: i < 3 ? "loss" : "win" });
    }
    const report = generateAttributionReport();
    const gate = report.gateAttribution.find(g => g.gate === "macro_bias_block");
    expect(gate).toBeDefined();
    expect(gate!.blocks).toBe(4);
    expect(gate!.saves).toBe(3);
    expect(gate!.misses).toBe(1);
    expect(gate!.saveRate).toBeCloseTo(0.75, 3);
    expect(gate!.netEdge).toBeCloseTo(0.25, 3);
  });

  it("computes sentiment gate attribution", () => {
    for (let i = 0; i < 3; i++) {
      const e = recordDecision(makeEntry({ decision: "blocked", blockReason: "sentiment_crowding_block" }));
      recordOutcome(e.id, { outcome: i < 2 ? "loss" : "win" }); // 2 saves, 1 miss
    }
    const report = generateAttributionReport();
    const gate = report.gateAttribution.find(g => g.gate === "sentiment_crowding_block");
    expect(gate).toBeDefined();
    expect(gate!.saves).toBe(2);
    expect(gate!.misses).toBe(1);
    expect(gate!.saveRate).toBeCloseTo(2 / 3, 3);
  });

  it("computes passed trade win rate", () => {
    for (let i = 0; i < 4; i++) {
      const e = recordDecision(makeEntry({ decision: "passed" }));
      recordOutcome(e.id, { outcome: i < 3 ? "win" : "loss" }); // 3 wins, 1 loss
    }
    const report = generateAttributionReport();
    expect(report.passedWinRate).toBeCloseTo(0.75, 3);
  });

  it("computes blocked miss rate", () => {
    for (let i = 0; i < 4; i++) {
      const e = recordDecision(makeEntry({ decision: "blocked", blockReason: "chop_regime" }));
      // 1 win (miss), 3 losses (saves)
      recordOutcome(e.id, { outcome: i === 0 ? "win" : "loss" });
    }
    const report = generateAttributionReport();
    expect(report.blockedMissRate).toBeCloseTo(0.25, 3);
  });
});

// ─── Suite 5: Attribution Engine — Layer Summary Verdicts ─────────────────────

describe("AttributionEngine — Layer Summary", () => {
  beforeEach(() => clearJournal());

  it("returns insufficient_data verdict with fewer than 5 resolved", () => {
    for (let i = 0; i < 3; i++) {
      const e = recordDecision(makeEntry({ decision: "blocked", blockReason: "macro_bias_block" }));
      recordOutcome(e.id, { outcome: "loss" });
    }
    const report = generateAttributionReport();
    const layer = report.layerSummary.find(l => l.layer.includes("Macro Bias"));
    expect(layer).toBeDefined();
    expect(layer!.verdict).toBe("insufficient_data");
  });

  it("returns helping verdict when macro bias save rate > 60%", () => {
    // 7 saves, 1 miss → saveRate = 7/8 = 87.5%
    for (let i = 0; i < 8; i++) {
      const e = recordDecision(makeEntry({ decision: "blocked", blockReason: "macro_bias_block" }));
      recordOutcome(e.id, { outcome: i < 7 ? "loss" : "win" });
    }
    const report = generateAttributionReport();
    const layer = report.layerSummary.find(l => l.layer.includes("Macro Bias"));
    expect(layer!.verdict).toBe("helping");
  });

  it("returns hurting verdict when macro bias save rate < 40%", () => {
    // 1 save, 7 misses → saveRate = 1/8 = 12.5%
    for (let i = 0; i < 8; i++) {
      const e = recordDecision(makeEntry({ decision: "blocked", blockReason: "macro_bias_block" }));
      recordOutcome(e.id, { outcome: i === 0 ? "loss" : "win" });
    }
    const report = generateAttributionReport();
    const layer = report.layerSummary.find(l => l.layer.includes("Macro Bias"));
    expect(layer!.verdict).toBe("hurting");
  });
});

// ─── Suite 6: YTW Gate Summary ────────────────────────────────────────────────

describe("AttributionEngine — YTW Gate Summary", () => {
  beforeEach(() => clearJournal());

  it("returns null gates when no entries exist", () => {
    const summary = getYtwGateSummary();
    expect(summary.macroBiasGate).toBeNull();
    expect(summary.sentimentGate).toBeNull();
  });

  it("returns gate objects when blocked trades exist", () => {
    const e1 = recordDecision(makeEntry({ decision: "blocked", blockReason: "macro_bias_block" }));
    recordOutcome(e1.id, { outcome: "loss" });
    const e2 = recordDecision(makeEntry({ decision: "blocked", blockReason: "sentiment_crowding_block" }));
    recordOutcome(e2.id, { outcome: "win" });

    const summary = getYtwGateSummary();
    expect(summary.macroBiasGate).not.toBeNull();
    expect(summary.sentimentGate).not.toBeNull();
    expect(summary.macroBiasGate!.blocks).toBe(1);
    expect(summary.sentimentGate!.blocks).toBe(1);
  });
});

// ─── Suite 7: Macro Conviction Segmentation ───────────────────────────────────

describe("AttributionEngine — Macro Conviction Performance", () => {
  beforeEach(() => clearJournal());

  it("segments passed trades by macro conviction and direction", () => {
    // High conviction long: 2 wins
    for (let i = 0; i < 2; i++) {
      const e = recordDecision(makeEntry({
        decision: "passed",
        macroBias: macroBias({ conviction: "high", direction: "long" }),
      }));
      recordOutcome(e.id, { outcome: "win" });
    }
    // Low conviction flat: 1 loss
    {
      const e = recordDecision(makeEntry({
        decision: "passed",
        macroBias: macroBias({ conviction: "low", direction: "flat" }),
      }));
      recordOutcome(e.id, { outcome: "loss" });
    }

    const report = generateAttributionReport();
    const highLong = report.macroConvictionPerformance.find(
      m => m.conviction === "high" && m.direction === "long"
    );
    expect(highLong).toBeDefined();
    expect(highLong!.trades).toBe(2);
    expect(highLong!.winRate).toBe(1.0);
  });
});
