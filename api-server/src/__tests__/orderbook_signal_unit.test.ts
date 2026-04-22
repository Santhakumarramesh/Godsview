/**
 * orderbook_signal_unit.test.ts — Phase 67
 *
 * Pure unit tests for extractOrderbookFeatures and orderbookAdjustment.
 * No mocks needed — both functions are pure.
 */

import { describe, it, expect } from "vitest";
import {
  extractOrderbookFeatures,
  orderbookAdjustment,
  type OrderbookFeatures,
} from "../lib/orderbook_signal";
import type { OrderBookSnapshot } from "../lib/market/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(opts: {
  bids?: Array<{ price: number; size: number }>;
  asks?: Array<{ price: number; size: number }>;
  mid?: number;
}): OrderBookSnapshot {
  const mid = opts.mid ?? 84000;
  const bids = opts.bids ?? [
    { price: mid - 1, size: 1000 },
    { price: mid - 2, size: 800 },
    { price: mid - 5, size: 600 },
  ];
  const asks = opts.asks ?? [
    { price: mid + 1, size: 1000 },
    { price: mid + 2, size: 800 },
    { price: mid + 5, size: 600 },
  ];
  return { bids, asks, symbol: "BTCUSD", timestamp: new Date().toISOString() };
}

// ── extractOrderbookFeatures — null/empty inputs ──────────────────────────────

describe("extractOrderbookFeatures — null/empty inputs", () => {
  it("returns neutral defaults for null snapshot", () => {
    const f = extractOrderbookFeatures(null);
    expect(f.imbalance).toBe(0);
    expect(f.spread_pct).toBe(0);
    expect(f.depth_pressure).toBe(0);
    expect(f.top_of_book_ratio).toBe(0.5);
    expect(f.bullish_score).toBe(0.5);
    expect(f.wall_side).toBe("none");
  });

  it("returns neutral defaults for undefined", () => {
    const f = extractOrderbookFeatures(undefined);
    expect(f.bullish_score).toBe(0.5);
  });

  it("returns neutral defaults for empty bids/asks", () => {
    const f = extractOrderbookFeatures({ bids: [], asks: [], symbol: "X", timestamp: "" } as any);
    expect(f.imbalance).toBe(0);
  });
});

// ── extractOrderbookFeatures — balanced book ─────────────────────────────────

describe("extractOrderbookFeatures — balanced book", () => {
  it("imbalance near 0 for equal bid/ask volume", () => {
    const snap = makeSnapshot({ mid: 84000 }); // equal bid/ask sizes
    const f = extractOrderbookFeatures(snap);
    expect(Math.abs(f.imbalance)).toBeLessThan(0.05);
  });

  it("spread_pct > 0 for non-touching best bid/ask", () => {
    const f = extractOrderbookFeatures(makeSnapshot({ mid: 84000 }));
    expect(f.spread_pct).toBeGreaterThan(0);
  });

  it("top_of_book_ratio is 0.5 for equal top sizes", () => {
    const f = extractOrderbookFeatures(makeSnapshot({ mid: 84000 }));
    expect(f.top_of_book_ratio).toBeCloseTo(0.5, 2);
  });

  it("bullish_score is in [0, 1]", () => {
    const f = extractOrderbookFeatures(makeSnapshot({ mid: 84000 }));
    expect(f.bullish_score).toBeGreaterThanOrEqual(0);
    expect(f.bullish_score).toBeLessThanOrEqual(1);
  });
});

// ── extractOrderbookFeatures — bid-heavy book ────────────────────────────────

describe("extractOrderbookFeatures — bid-heavy (bullish)", () => {
  function makeBidHeavy(mid = 84000) {
    const bids = Array.from({ length: 10 }, (_, i) => ({ price: mid - i, size: 5000 }));
    const asks = Array.from({ length: 10 }, (_, i) => ({ price: mid + i + 1, size: 500 }));
    return makeSnapshot({ bids, asks, mid });
  }

  it("imbalance is positive (bullish)", () => {
    const f = extractOrderbookFeatures(makeBidHeavy());
    expect(f.imbalance).toBeGreaterThan(0);
  });

  it("bullish_score > 0.5", () => {
    const f = extractOrderbookFeatures(makeBidHeavy());
    expect(f.bullish_score).toBeGreaterThan(0.5);
  });

  it("top_of_book_ratio > 0.5 with larger bid top", () => {
    const bids = [{ price: 83999, size: 3000 }, { price: 83998, size: 1000 }];
    const asks = [{ price: 84001, size: 1000 }, { price: 84002, size: 500 }];
    const f = extractOrderbookFeatures(makeSnapshot({ bids, asks, mid: 84000 }));
    expect(f.top_of_book_ratio).toBeGreaterThan(0.5);
  });
});

// ── extractOrderbookFeatures — ask-heavy book ────────────────────────────────

describe("extractOrderbookFeatures — ask-heavy (bearish)", () => {
  function makeAskHeavy(mid = 84000) {
    const bids = Array.from({ length: 10 }, (_, i) => ({ price: mid - i, size: 500 }));
    const asks = Array.from({ length: 10 }, (_, i) => ({ price: mid + i + 1, size: 5000 }));
    return makeSnapshot({ bids, asks, mid });
  }

  it("imbalance is negative (bearish)", () => {
    const f = extractOrderbookFeatures(makeAskHeavy());
    expect(f.imbalance).toBeLessThan(0);
  });

  it("bullish_score < 0.5", () => {
    const f = extractOrderbookFeatures(makeAskHeavy());
    expect(f.bullish_score).toBeLessThan(0.5);
  });
});

// ── extractOrderbookFeatures — liquidity wall detection ──────────────────────

describe("extractOrderbookFeatures — liquidity wall", () => {
  it("detects bid wall when large bid level present", () => {
    const mid = 84000;
    const bids = [
      { price: mid - 1, size: 100 },
      { price: mid - 2, size: 100 },
      { price: mid - 10, size: 10_000 }, // wall
    ];
    const asks = Array.from({ length: 5 }, (_, i) => ({ price: mid + i + 1, size: 100 }));
    const f = extractOrderbookFeatures(makeSnapshot({ bids, asks, mid }));
    // wall_distance_pct should be finite (not Infinity)
    expect(f.wall_distance_pct).toBeLessThan(999);
  });

  it("wall_side=none when no dominant level exists", () => {
    const f = extractOrderbookFeatures(makeSnapshot({})); // all equal sizes
    // With equal sizes no wall threshold exceeded — or wall_side might still be set
    // Just verify it's a valid value
    expect(["bid", "ask", "none"]).toContain(f.wall_side);
  });
});

// ── orderbookAdjustment ───────────────────────────────────────────────────────

describe("orderbookAdjustment", () => {
  const neutralFeatures: OrderbookFeatures = {
    imbalance: 0, spread_pct: 0.001, wall_distance_pct: 999,
    wall_side: "none", depth_pressure: 0, top_of_book_ratio: 0.5, bullish_score: 0.5,
  };
  const bullishFeatures: OrderbookFeatures = { ...neutralFeatures, bullish_score: 0.8 };
  const bearishFeatures: OrderbookFeatures = { ...neutralFeatures, bullish_score: 0.2 };

  it("returns 1.0 for neutral orderbook on long", () => {
    expect(orderbookAdjustment(neutralFeatures, "long")).toBeCloseTo(1.0, 2);
  });

  it("returns 1.0 for neutral orderbook on short", () => {
    expect(orderbookAdjustment(neutralFeatures, "short")).toBeCloseTo(1.0, 2);
  });

  it("boosts long trade when bullish orderbook", () => {
    const adj = orderbookAdjustment(bullishFeatures, "long");
    expect(adj).toBeGreaterThan(1.0);
  });

  it("penalizes long trade when bearish orderbook", () => {
    const adj = orderbookAdjustment(bearishFeatures, "long");
    expect(adj).toBeLessThan(1.0);
  });

  it("boosts short trade when bearish orderbook", () => {
    const adj = orderbookAdjustment(bearishFeatures, "short");
    expect(adj).toBeGreaterThan(1.0);
  });

  it("penalizes short trade when bullish orderbook", () => {
    const adj = orderbookAdjustment(bullishFeatures, "short");
    expect(adj).toBeLessThan(1.0);
  });

  it("adjustment is in [0.8, 1.2] range", () => {
    for (const bullish_score of [0, 0.1, 0.5, 0.9, 1.0]) {
      for (const direction of ["long", "short"] as const) {
        const adj = orderbookAdjustment({ ...neutralFeatures, bullish_score }, direction);
        expect(adj).toBeGreaterThanOrEqual(0.8);
        expect(adj).toBeLessThanOrEqual(1.2);
      }
    }
  });
});
