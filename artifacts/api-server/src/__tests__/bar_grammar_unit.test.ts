/**
 * bar_grammar_unit.test.ts — Phase 71
 *
 * Tests the sequential bar-grammar labeler:
 *   - labelBars: HH/HL/LH/LL classification, BOS/CHoCH events, bias tracking
 *   - classifyBar: single-bar classification against known state
 *   - createInitialState: bootstrap from first bar
 *   - computeGrammarSummary: counts and structureBias
 *   - extractSwingPivots: swing high/low extraction
 *   - isBullishStructure / isBearishStructure: pattern recognition
 *
 * All functions are pure — no mocks required.
 */

import { describe, it, expect } from "vitest";

import {
  labelBars,
  classifyBar,
  createInitialState,
  computeGrammarSummary,
  extractSwingPivots,
  isBullishStructure,
  isBearishStructure,
  type RawBar,
  type GrammarBar,
  type GrammarState,
  type BarLabel,
  type StructureEvent,
  type MarketBias,
} from "../lib/bar_grammar";

// ── Test helpers ───────────────────────────────────────────────────────────────

let tsCounter = 0;

function makeBar(o: number, h: number, l: number, c: number, v = 1000): RawBar {
  tsCounter++;
  return {
    timestamp: `2026-01-01T${String(tsCounter).padStart(4, "0")}:00Z`,
    open: o, high: h, low: l, close: c, volume: v,
  };
}

function makeState(overrides: Partial<GrammarState> = {}): GrammarState {
  return {
    bias: "neutral",
    lastSwingHigh: null,
    lastSwingLow: null,
    swingHighHistory: [],
    swingLowHistory: [],
    bosCount: 0,
    chochCount: 0,
    ...overrides,
  };
}

// Minimal bullish trending series: each bar makes higher highs and higher lows
function makeBullishSeries(count = 8): RawBar[] {
  const bars: RawBar[] = [];
  let base = 100;
  for (let i = 0; i < count; i++) {
    const o = base;
    const h = base + 5;
    const l = base - 1;
    const c = base + 4;
    bars.push(makeBar(o, h, l, c));
    base += 5;
  }
  return bars;
}

// Minimal bearish trending series: each bar makes lower lows and lower highs
function makeBearishSeries(count = 8): RawBar[] {
  const bars: RawBar[] = [];
  let base = 200;
  for (let i = 0; i < count; i++) {
    const o = base;
    const h = base + 1;
    const l = base - 5;
    const c = base - 4;
    bars.push(makeBar(o, h, l, c));
    base -= 5;
  }
  return bars;
}

// ── createInitialState ────────────────────────────────────────────────────────

describe("createInitialState", () => {
  it("sets lastSwingHigh to bar.high and lastSwingLow to bar.low", () => {
    const bar = makeBar(100, 105, 98, 102);
    const state = createInitialState(bar);
    expect(state.lastSwingHigh).toBe(105);
    expect(state.lastSwingLow).toBe(98);
  });

  it("initialises bias as neutral", () => {
    const bar = makeBar(100, 110, 90, 105);
    const state = createInitialState(bar);
    expect(state.bias).toBe("neutral");
  });

  it("seeds swingHighHistory and swingLowHistory with first bar values", () => {
    const bar = makeBar(50, 55, 48, 52);
    const state = createInitialState(bar);
    expect(state.swingHighHistory).toEqual([55]);
    expect(state.swingLowHistory).toEqual([48]);
  });

  it("bosCount and chochCount start at 0", () => {
    const state = createInitialState(makeBar(100, 105, 98, 102));
    expect(state.bosCount).toBe(0);
    expect(state.chochCount).toBe(0);
  });
});

// ── classifyBar ───────────────────────────────────────────────────────────────

describe("classifyBar — label detection", () => {
  it("returns neutral when no swing context exists (null high/low)", () => {
    const bar = makeBar(100, 105, 98, 102);
    const { label } = classifyBar(bar, makeState());
    expect(label).toBe("neutral");
  });

  it("labels HH when bar.high > lastSwingHigh", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 90 });
    const bar = makeBar(98, 105, 95, 102); // high 105 > 100
    const { label } = classifyBar(bar, state);
    expect(label).toBe("HH");
  });

  it("labels LL when bar.low < lastSwingLow", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 90 });
    const bar = makeBar(92, 95, 85, 88); // low 85 < 90
    const { label } = classifyBar(bar, state);
    expect(label).toBe("LL");
  });

  it("labels HL when bar.low > lastSwingLow but no new high", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80 });
    const bar = makeBar(85, 95, 83, 92); // low 83 > 80, high 95 < 100
    const { label } = classifyBar(bar, state);
    expect(label).toBe("HL");
  });

  it("labels LH when bar.high < lastSwingHigh and low equals lastSwingLow", () => {
    const state = makeState({ lastSwingHigh: 110, lastSwingLow: 80 });
    // low == lastSwingLow (not higher, not lower) → no HL, no LL; high < lastSwingHigh → LH
    const bar = makeBar(100, 105, 80, 103); // high 105 < 110, low 80 == lastSwingLow
    const { label } = classifyBar(bar, state);
    expect(label).toBe("LH");
  });

  it("HH takes precedence when bar simultaneously makes higher high and higher low", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80 });
    const bar = makeBar(90, 110, 85, 108); // high 110 > 100, low 85 > 80 — HH wins
    const { label } = classifyBar(bar, state);
    expect(label).toBe("HH");
  });

  it("LL takes precedence when bar makes lower low (even with HL candidate)", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80 });
    const bar = makeBar(85, 99, 75, 90); // low 75 < 80, high 99 < 100
    const { label } = classifyBar(bar, state);
    expect(label).toBe("LL");
  });
});

describe("classifyBar — event detection", () => {
  it("fires BOS_UP when close > lastSwingHigh in neutral bias", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80, bias: "neutral" });
    const bar = makeBar(98, 108, 95, 103); // close 103 > 100
    const { event } = classifyBar(bar, state);
    expect(event).toBe("BOS_UP");
  });

  it("fires BOS_DOWN when close < lastSwingLow in neutral bias", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80, bias: "neutral" });
    const bar = makeBar(82, 85, 75, 78); // close 78 < 80
    const { event } = classifyBar(bar, state);
    expect(event).toBe("BOS_DOWN");
  });

  it("fires CHoCH_UP when close > lastSwingHigh in bearish bias (trend reversal)", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80, bias: "bearish" });
    const bar = makeBar(98, 108, 95, 103); // close 103 > 100 while bias is bearish
    const { event } = classifyBar(bar, state);
    expect(event).toBe("CHoCH_UP");
  });

  it("fires CHoCH_DOWN when close < lastSwingLow in bullish bias (trend reversal)", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80, bias: "bullish" });
    const bar = makeBar(82, 85, 75, 78); // close 78 < 80 while bias is bullish
    const { event } = classifyBar(bar, state);
    expect(event).toBe("CHoCH_DOWN");
  });

  it("fires BOS_UP (not CHoCH) when bias is already bullish", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80, bias: "bullish" });
    const bar = makeBar(98, 108, 95, 103);
    const { event } = classifyBar(bar, state);
    expect(event).toBe("BOS_UP");
  });

  it("returns null event when close is within swing range", () => {
    const state = makeState({ lastSwingHigh: 110, lastSwingLow: 90 });
    const bar = makeBar(100, 105, 98, 102); // close 102 within [90, 110]
    const { event } = classifyBar(bar, state);
    expect(event).toBeNull();
  });
});

// ── labelBars ────────────────────────────────────────────────────────────────

describe("labelBars — basic", () => {
  it("returns labeled array with same length as input", () => {
    const bars = makeBullishSeries(5);
    const { labeled } = labelBars(bars);
    expect(labeled).toHaveLength(5);
  });

  it("each labeled bar has required fields", () => {
    const bars = makeBullishSeries(3);
    const { labeled } = labelBars(bars);
    for (const bar of labeled) {
      expect(bar).toHaveProperty("index");
      expect(bar).toHaveProperty("label");
      expect(bar).toHaveProperty("event");
      expect(bar).toHaveProperty("bias");
      expect(bar).toHaveProperty("lastSwingHigh");
      expect(bar).toHaveProperty("lastSwingLow");
    }
  });

  it("index is sequential from 0", () => {
    const bars = makeBullishSeries(5);
    const { labeled } = labelBars(bars);
    labeled.forEach((bar, i) => expect(bar.index).toBe(i));
  });

  it("returns a GrammarState object", () => {
    const { state } = labelBars(makeBullishSeries(5));
    expect(state).toHaveProperty("bias");
    expect(state).toHaveProperty("lastSwingHigh");
    expect(state).toHaveProperty("lastSwingLow");
    expect(state).toHaveProperty("bosCount");
    expect(state).toHaveProperty("chochCount");
  });

  it("empty input returns empty labeled and neutral state", () => {
    const { labeled, state } = labelBars([]);
    expect(labeled).toHaveLength(0);
    expect(state.bias).toBe("neutral");
    expect(state.lastSwingHigh).toBeNull();
    expect(state.lastSwingLow).toBeNull();
  });
});

describe("labelBars — bullish trending series", () => {
  it("successive higher highs are labeled HH", () => {
    const bars = makeBullishSeries(6);
    const { labeled } = labelBars(bars);
    const hhBars = labeled.filter((b) => b.label === "HH");
    // After the first bar sets the context, subsequent higher bars should be HH
    expect(hhBars.length).toBeGreaterThan(0);
  });

  it("eventually sets bias to bullish via BOS_UP", () => {
    const bars = makeBullishSeries(8);
    const { state } = labelBars(bars);
    // Consistently rising close prices should trigger BOS_UP and bias = bullish
    expect(state.bias).toBe("bullish");
  });

  it("bosCount increments on BOS events", () => {
    const bars = makeBullishSeries(6);
    const { state } = labelBars(bars);
    expect(state.bosCount).toBeGreaterThan(0);
  });

  it("swingHighHistory grows as new highs are made", () => {
    const bars = makeBullishSeries(6);
    const { state } = labelBars(bars);
    expect(state.swingHighHistory.length).toBeGreaterThan(1);
  });
});

describe("labelBars — bearish trending series", () => {
  it("successive lower lows are labeled LL", () => {
    const bars = makeBearishSeries(6);
    const { labeled } = labelBars(bars);
    const llBars = labeled.filter((b) => b.label === "LL");
    expect(llBars.length).toBeGreaterThan(0);
  });

  it("eventually sets bias to bearish via BOS_DOWN", () => {
    const bars = makeBearishSeries(8);
    const { state } = labelBars(bars);
    expect(state.bias).toBe("bearish");
  });

  it("swingLowHistory grows as new lows are made", () => {
    const bars = makeBearishSeries(6);
    const { state } = labelBars(bars);
    expect(state.swingLowHistory.length).toBeGreaterThan(1);
  });
});

describe("labelBars — CHoCH detection", () => {
  it("CHoCH_DOWN fires when price breaks swing low after bullish bias is established", () => {
    // First build bullish bias, then add a crash bar
    const upBars = makeBullishSeries(8);
    const { state: bullishState } = labelBars(upBars);
    expect(bullishState.bias).toBe("bullish");

    // Crash bar: close well below established swing low
    const swingLow = bullishState.lastSwingLow!;
    const crashBar = makeBar(
      swingLow - 2, swingLow + 1, swingLow - 20, swingLow - 15,
    );
    const { labeled } = labelBars([crashBar], bullishState);
    expect(labeled[0].event).toBe("CHoCH_DOWN");
  });

  it("CHoCH_UP fires when price breaks swing high after bearish bias is established", () => {
    const downBars = makeBearishSeries(8);
    const { state: bearishState } = labelBars(downBars);
    expect(bearishState.bias).toBe("bearish");

    const swingHigh = bearishState.lastSwingHigh!;
    const rocketBar = makeBar(
      swingHigh + 2, swingHigh + 25, swingHigh - 1, swingHigh + 20,
    );
    const { labeled } = labelBars([rocketBar], bearishState);
    expect(labeled[0].event).toBe("CHoCH_UP");
  });
});

describe("labelBars — state continuation (streaming)", () => {
  it("state from first batch is accepted as initialState for second batch", () => {
    const batch1 = makeBullishSeries(5);
    const batch2 = makeBullishSeries(5);

    const { labeled: l1, state: s1 } = labelBars(batch1);
    const { labeled: l2 } = labelBars(batch2, s1);

    // Second batch continues from where first batch left off
    expect(l2[0].lastSwingHigh).toBeGreaterThanOrEqual(
      l1[l1.length - 1].lastSwingHigh!,
    );
  });

  it("bias carries forward into continuation batch", () => {
    const batch1 = makeBullishSeries(8);
    const { state: s1 } = labelBars(batch1);
    expect(s1.bias).toBe("bullish");

    // Second batch inherits bullish bias
    const batch2 = [makeBar(s1.lastSwingHigh! - 5, s1.lastSwingHigh! - 3, s1.lastSwingLow! + 2, s1.lastSwingHigh! - 4)];
    const { labeled: l2 } = labelBars(batch2, s1);
    expect(l2[0].bias).toBe("bullish"); // no new BOS, bias unchanged
  });

  it("bosCount accumulates across batches", () => {
    const batch1 = makeBullishSeries(6);
    const { state: s1 } = labelBars(batch1);
    const bosBatch1 = s1.bosCount;

    const batch2 = makeBullishSeries(6);
    const { state: s2 } = labelBars(batch2, s1);
    expect(s2.bosCount).toBeGreaterThanOrEqual(bosBatch1);
  });
});

// ── computeGrammarSummary ─────────────────────────────────────────────────────

describe("computeGrammarSummary", () => {
  it("returns an object with all required count fields", () => {
    const { labeled } = labelBars(makeBullishSeries(8));
    const summary = computeGrammarSummary(labeled);
    expect(summary).toHaveProperty("hhCount");
    expect(summary).toHaveProperty("hlCount");
    expect(summary).toHaveProperty("lhCount");
    expect(summary).toHaveProperty("llCount");
    expect(summary).toHaveProperty("neutralCount");
    expect(summary).toHaveProperty("bosUpCount");
    expect(summary).toHaveProperty("bosDownCount");
    expect(summary).toHaveProperty("chochUpCount");
    expect(summary).toHaveProperty("chochDownCount");
    expect(summary).toHaveProperty("structureBias");
    expect(summary).toHaveProperty("bullishBars");
    expect(summary).toHaveProperty("bearishBars");
  });

  it("total label counts sum to labeled.length", () => {
    const bars = makeBullishSeries(10);
    const { labeled } = labelBars(bars);
    const s = computeGrammarSummary(labeled);
    const totalLabels = s.hhCount + s.hlCount + s.lhCount + s.llCount + s.neutralCount;
    expect(totalLabels).toBe(labeled.length);
  });

  it("structureBias is bullish for bullish series", () => {
    const { labeled } = labelBars(makeBullishSeries(10));
    const { structureBias } = computeGrammarSummary(labeled);
    expect(structureBias).toBe("bullish");
  });

  it("structureBias is bearish for bearish series", () => {
    const { labeled } = labelBars(makeBearishSeries(10));
    const { structureBias } = computeGrammarSummary(labeled);
    expect(structureBias).toBe("bearish");
  });

  it("all counts are non-negative integers", () => {
    const { labeled } = labelBars(makeBullishSeries(8));
    const s = computeGrammarSummary(labeled);
    const fields: (keyof typeof s)[] = [
      "hhCount", "hlCount", "lhCount", "llCount", "neutralCount",
      "bosUpCount", "bosDownCount", "chochUpCount", "chochDownCount",
      "bullishBars", "bearishBars",
    ];
    for (const f of fields) {
      const val = s[f];
      if (typeof val === "number") {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(val)).toBe(true);
      }
    }
  });

  it("bullishBars counts bars where close > open", () => {
    const bullishBar = makeBar(100, 110, 98, 108); // close > open
    const bearishBar = makeBar(110, 112, 95, 97);  // close < open
    const dojiBar    = makeBar(100, 105, 95, 100); // close = open
    const { labeled } = labelBars([bullishBar, bearishBar, dojiBar]);
    const { bullishBars, bearishBars } = computeGrammarSummary(labeled);
    expect(bullishBars).toBe(1);
    expect(bearishBars).toBe(1);
  });

  it("returns neutral structureBias for empty input", () => {
    const { structureBias } = computeGrammarSummary([]);
    expect(structureBias).toBe("neutral");
  });
});

// ── extractSwingPivots ────────────────────────────────────────────────────────

describe("extractSwingPivots", () => {
  it("returns highs and lows arrays", () => {
    const { labeled } = labelBars(makeBullishSeries(6));
    const { highs, lows } = extractSwingPivots(labeled);
    expect(Array.isArray(highs)).toBe(true);
    expect(Array.isArray(lows)).toBe(true);
  });

  it("each high has index, price, and timestamp fields", () => {
    const { labeled } = labelBars(makeBullishSeries(6));
    const { highs } = extractSwingPivots(labeled);
    for (const h of highs) {
      expect(h).toHaveProperty("index");
      expect(h).toHaveProperty("price");
      expect(h).toHaveProperty("timestamp");
      expect(typeof h.price).toBe("number");
    }
  });

  it("highs array contains HH and LH bars only", () => {
    const { labeled } = labelBars(makeBullishSeries(8));
    const { highs } = extractSwingPivots(labeled);
    const pivotIndices = new Set(highs.map((h) => h.index));
    for (const bar of labeled) {
      if (pivotIndices.has(bar.index)) {
        expect(["HH", "LH"]).toContain(bar.label);
      }
    }
  });

  it("lows array contains LL and HL bars only", () => {
    const { labeled } = labelBars(makeBearishSeries(8));
    const { lows } = extractSwingPivots(labeled);
    const pivotIndices = new Set(lows.map((l) => l.index));
    for (const bar of labeled) {
      if (pivotIndices.has(bar.index)) {
        expect(["LL", "HL"]).toContain(bar.label);
      }
    }
  });

  it("returns empty arrays when all bars are neutral", () => {
    // Single bar — first is neutral
    const bar = makeBar(100, 105, 98, 102);
    const { labeled } = labelBars([bar]);
    const { highs, lows } = extractSwingPivots(labeled);
    expect(highs).toHaveLength(0);
    expect(lows).toHaveLength(0);
  });
});

// ── isBullishStructure / isBearishStructure ───────────────────────────────────

describe("isBullishStructure", () => {
  it("returns true for a clean bullish series (all HH/HL)", () => {
    const { labeled } = labelBars(makeBullishSeries(10));
    expect(isBullishStructure(labeled)).toBe(true);
  });

  it("returns false for a bearish series", () => {
    const { labeled } = labelBars(makeBearishSeries(10));
    expect(isBullishStructure(labeled)).toBe(false);
  });

  it("returns false when fewer than 2 structural bars in lookback", () => {
    const { labeled } = labelBars([makeBar(100, 105, 98, 102)]); // all neutral
    expect(isBullishStructure(labeled, 6)).toBe(false);
  });

  it("lookback parameter controls how many structural bars are checked", () => {
    const { labeled } = labelBars(makeBullishSeries(10));
    // Default lookback=6 and lookback=2 should both return true for clean bullish
    expect(isBullishStructure(labeled, 2)).toBe(true);
    expect(isBullishStructure(labeled, 6)).toBe(true);
  });
});

describe("isBearishStructure", () => {
  it("returns true for a clean bearish series (all LH/LL)", () => {
    const { labeled } = labelBars(makeBearishSeries(10));
    expect(isBearishStructure(labeled)).toBe(true);
  });

  it("returns false for a bullish series", () => {
    const { labeled } = labelBars(makeBullishSeries(10));
    expect(isBearishStructure(labeled)).toBe(false);
  });

  it("returns false when fewer than 2 structural bars in lookback", () => {
    const { labeled } = labelBars([makeBar(100, 105, 98, 102)]);
    expect(isBearishStructure(labeled, 6)).toBe(false);
  });
});

// ── BarLabel / StructureEvent / MarketBias type coverage ─────────────────────

describe("BarLabel type", () => {
  it("all five label values are valid BarLabel", () => {
    const labels: BarLabel[] = ["HH", "HL", "LH", "LL", "neutral"];
    expect(labels).toHaveLength(5);
    expect(labels).toContain("HH");
    expect(labels).toContain("neutral");
  });
});

describe("StructureEvent type", () => {
  it("all four events plus null are valid StructureEvent values", () => {
    const events: StructureEvent[] = ["BOS_UP", "BOS_DOWN", "CHoCH_UP", "CHoCH_DOWN", null];
    expect(events).toHaveLength(5);
    expect(events).toContain("CHoCH_UP");
    expect(events).toContain(null);
  });
});

describe("MarketBias type", () => {
  it("bullish/bearish/neutral are the three valid bias values", () => {
    const biases: MarketBias[] = ["bullish", "bearish", "neutral"];
    expect(biases).toHaveLength(3);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("single bar: label is neutral, event is null", () => {
    const { labeled } = labelBars([makeBar(100, 105, 98, 102)]);
    expect(labeled[0].label).toBe("neutral");
    expect(labeled[0].event).toBeNull();
  });

  it("two identical bars: second bar labels neutral (no swing broken)", () => {
    const bar1 = makeBar(100, 105, 98, 102);
    const bar2 = makeBar(100, 105, 98, 102); // exact same range
    const { labeled } = labelBars([bar1, bar2]);
    // bar2 high == lastSwingHigh (not greater) → no HH
    // bar2 low == lastSwingLow (not less) → no LL
    expect(labeled[1].label).toBe("neutral");
  });

  it("does not mutate passed initialState", () => {
    const state: GrammarState = {
      bias: "neutral",
      lastSwingHigh: 100,
      lastSwingLow: 80,
      swingHighHistory: [100],
      swingLowHistory: [80],
      bosCount: 0,
      chochCount: 0,
    };
    const originalHigh = state.lastSwingHigh;
    labelBars(makeBullishSeries(5), state);
    // Original state should be unchanged
    expect(state.lastSwingHigh).toBe(originalHigh);
  });

  it("lastSwingHigh in labeled bar reflects updated state after bar is processed", () => {
    const bars = [
      makeBar(100, 105, 98, 102),  // sets initial swing high to 105
      makeBar(104, 110, 100, 108), // new HH → lastSwingHigh should be 110
    ];
    const { labeled } = labelBars(bars);
    expect(labeled[1].lastSwingHigh).toBe(110);
  });

  it("very volatile bar that both makes HH and BOS_UP gets correct event", () => {
    const state = makeState({ lastSwingHigh: 100, lastSwingLow: 80, bias: "neutral" });
    const bar = makeBar(95, 120, 90, 115); // high 120 > 100 (HH), close 115 > 100 (BOS_UP)
    const { label, event } = classifyBar(bar, state);
    expect(label).toBe("HH");
    expect(event).toBe("BOS_UP");
  });

  it("handles large series (1000 bars) without error", () => {
    const bars: RawBar[] = [];
    for (let i = 0; i < 1000; i++) {
      const p = 100 + Math.sin(i * 0.1) * 20;
      bars.push(makeBar(p, p + 2, p - 2, p + 1));
    }
    expect(() => labelBars(bars)).not.toThrow();
    const { labeled, state } = labelBars(bars);
    expect(labeled).toHaveLength(1000);
    expect(["bullish", "bearish", "neutral"]).toContain(state.bias);
  });
});
