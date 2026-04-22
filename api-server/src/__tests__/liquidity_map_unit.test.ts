/**
 * liquidity_map_unit.test.ts — Phase 73b
 *
 * Tests market/liquidityMap.ts pure functions:
 *   computeLiquidityZones  — clusters order book levels into zones
 *   computeMicrostructure  — derives spread, imbalance, absorbing flags
 *   computeDepthCurve      — cumulative depth ladder
 *
 * No mocks — all functions are pure and side-effect free.
 */

import { describe, it, expect } from "vitest";
import {
  computeLiquidityZones,
  computeMicrostructure,
  computeDepthCurve,
} from "../lib/market/liquidityMap";
import type { OrderBookSnapshot } from "../lib/market/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  opts: Partial<OrderBookSnapshot> = {},
): OrderBookSnapshot {
  return {
    symbol: "BTCUSD",
    timestamp: "2026-01-01T00:00:00.000Z",
    receivedAt: Date.now(),
    source: "rest",
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    ...opts,
  };
}

// ── computeLiquidityZones ─────────────────────────────────────────────────────

describe("computeLiquidityZones", () => {
  it("returns bids and asks arrays", () => {
    const snap = makeSnapshot(
      [[99_900, 1.5], [99_800, 0.8]],
      [[100_100, 2.0], [100_200, 1.0]],
    );
    const { bids, asks } = computeLiquidityZones(snap);
    expect(Array.isArray(bids)).toBe(true);
    expect(Array.isArray(asks)).toBe(true);
  });

  it("returns empty arrays when snapshot has no bids/asks (no mid)", () => {
    const snap = makeSnapshot([], []);
    const { bids, asks } = computeLiquidityZones(snap);
    expect(bids).toHaveLength(0);
    expect(asks).toHaveLength(0);
  });

  it("each zone has required fields", () => {
    const snap = makeSnapshot(
      [[99_900, 1.0]],
      [[100_100, 1.0]],
    );
    const { bids, asks } = computeLiquidityZones(snap);
    for (const zone of [...bids, ...asks]) {
      expect(zone).toHaveProperty("price");
      expect(zone).toHaveProperty("priceMin");
      expect(zone).toHaveProperty("priceMax");
      expect(zone).toHaveProperty("size");
      expect(zone).toHaveProperty("side");
      expect(zone).toHaveProperty("strength");
    }
  });

  it("bid zones have side='bid', ask zones have side='ask'", () => {
    const snap = makeSnapshot(
      [[99_900, 1.0], [99_800, 0.5]],
      [[100_100, 1.0], [100_200, 0.5]],
    );
    const { bids, asks } = computeLiquidityZones(snap);
    for (const z of bids) expect(z.side).toBe("bid");
    for (const z of asks) expect(z.side).toBe("ask");
  });

  it("strength of largest zone is 1.0", () => {
    const snap = makeSnapshot(
      [[99_900, 5.0], [99_800, 1.0]],
      [[100_100, 3.0]],
    );
    const { bids } = computeLiquidityZones(snap);
    const maxStrength = Math.max(...bids.map((z) => z.strength));
    expect(maxStrength).toBe(1);
  });

  it("strength values are in [0, 1]", () => {
    const snap = makeSnapshot(
      [[99_900, 1.0], [99_800, 2.0], [99_700, 0.5]],
      [[100_100, 1.5], [100_200, 0.8]],
    );
    const { bids, asks } = computeLiquidityZones(snap);
    for (const z of [...bids, ...asks]) {
      expect(z.strength).toBeGreaterThanOrEqual(0);
      expect(z.strength).toBeLessThanOrEqual(1);
    }
  });

  it("minSize filter removes zones below threshold", () => {
    const snap = makeSnapshot(
      [[99_900, 0.01], [99_800, 10.0]],
      [[100_100, 0.01], [100_200, 10.0]],
    );
    const { bids } = computeLiquidityZones(snap, { minSize: 1.0 });
    expect(bids.every((z) => z.size >= 1.0)).toBe(true);
  });

  it("topN limits result count", () => {
    const bidLevels: Array<[number, number]> = Array.from({ length: 30 }, (_, i) => [
      99_000 - i * 10, 1.0,
    ]);
    const snap = makeSnapshot(bidLevels, [[100_100, 1.0]]);
    const { bids } = computeLiquidityZones(snap, { topN: 5 });
    expect(bids.length).toBeLessThanOrEqual(5);
  });

  it("bid zones are sorted descending (best bid first)", () => {
    const snap = makeSnapshot(
      [[99_700, 1.0], [99_900, 2.0], [99_800, 1.5]],
      [[100_100, 1.0]],
    );
    const { bids } = computeLiquidityZones(snap);
    for (let i = 1; i < bids.length; i++) {
      expect(bids[i]!.price).toBeLessThanOrEqual(bids[i - 1]!.price);
    }
  });

  it("ask zones are sorted ascending (best ask first)", () => {
    const snap = makeSnapshot(
      [[99_900, 1.0]],
      [[100_300, 1.0], [100_100, 2.0], [100_200, 1.5]],
    );
    const { asks } = computeLiquidityZones(snap);
    for (let i = 1; i < asks.length; i++) {
      expect(asks[i]!.price).toBeGreaterThanOrEqual(asks[i - 1]!.price);
    }
  });

  it("levels in same price bucket are merged into one zone", () => {
    // Two levels very close together should cluster into one zone
    const snap = makeSnapshot(
      [[100_000, 1.0], [100_001, 1.0]], // same bucket at 0.1% bucket size (mid ~100050)
      [[100_100, 1.0]],
    );
    const { bids } = computeLiquidityZones(snap, { bucketPct: 0.5 }); // 0.5% bucket is ~500 wide
    // Both 100000 and 100001 fall in same bucket
    expect(bids.length).toBe(1);
    expect(bids[0]!.size).toBeCloseTo(2.0, 4);
  });
});

// ── computeMicrostructure ─────────────────────────────────────────────────────

describe("computeMicrostructure", () => {
  it("has all required output fields", () => {
    const snap = makeSnapshot([[99_900, 1.0]], [[100_100, 1.0]]);
    const ms = computeMicrostructure(snap);
    expect(ms).toHaveProperty("symbol");
    expect(ms).toHaveProperty("bestBid");
    expect(ms).toHaveProperty("bestAsk");
    expect(ms).toHaveProperty("spread");
    expect(ms).toHaveProperty("spreadBps");
    expect(ms).toHaveProperty("mid");
    expect(ms).toHaveProperty("imbalance");
    expect(ms).toHaveProperty("topBidVolume");
    expect(ms).toHaveProperty("topAskVolume");
    expect(ms).toHaveProperty("absorbingBid");
    expect(ms).toHaveProperty("absorbingAsk");
    expect(ms).toHaveProperty("snapshot");
  });

  it("computes spread correctly as bestAsk - bestBid", () => {
    const snap = makeSnapshot([[99_900, 1.0]], [[100_100, 1.0]]);
    const { spread, bestBid, bestAsk } = computeMicrostructure(snap);
    expect(spread).toBeCloseTo(bestAsk - bestBid, 2);
  });

  it("computes mid as (bestAsk + bestBid) / 2", () => {
    const snap = makeSnapshot([[99_900, 1.0]], [[100_100, 1.0]]);
    const { mid, bestBid, bestAsk } = computeMicrostructure(snap);
    expect(mid).toBeCloseTo((bestBid + bestAsk) / 2, 2);
  });

  it("imbalance is 1.0 when all volume is on bid side", () => {
    const bids: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [
      99_900 - i * 10, 1.0,
    ]);
    const snap = makeSnapshot(bids, [[100_100, 0.0001]]); // negligible ask
    const { imbalance } = computeMicrostructure(snap);
    expect(imbalance).toBeGreaterThan(0.9);
  });

  it("imbalance is -1.0 when all volume is on ask side", () => {
    const asks: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [
      100_100 + i * 10, 1.0,
    ]);
    const snap = makeSnapshot([[99_900, 0.0001]], asks);
    const { imbalance } = computeMicrostructure(snap);
    expect(imbalance).toBeLessThan(-0.9);
  });

  it("imbalance is near 0 when bid and ask volumes are equal", () => {
    const bids: Array<[number, number]> = Array.from({ length: 5 }, (_, i) => [99_900 - i * 10, 1.0]);
    const asks: Array<[number, number]> = Array.from({ length: 5 }, (_, i) => [100_100 + i * 10, 1.0]);
    const snap = makeSnapshot(bids, asks);
    const { imbalance } = computeMicrostructure(snap);
    expect(Math.abs(imbalance)).toBeLessThan(0.05);
  });

  it("absorbingBid is true when imbalance > 0.3", () => {
    const bids: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [99_900 - i * 10, 5.0]);
    const asks: Array<[number, number]> = [[100_100, 0.1]];
    const snap = makeSnapshot(bids, asks);
    const { absorbingBid } = computeMicrostructure(snap);
    expect(absorbingBid).toBe(true);
  });

  it("absorbingAsk is true when imbalance < -0.3", () => {
    const asks: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [100_100 + i * 10, 5.0]);
    const snap = makeSnapshot([[99_900, 0.1]], asks);
    const { absorbingAsk } = computeMicrostructure(snap);
    expect(absorbingAsk).toBe(true);
  });

  it("spreadBps is in reasonable range for a ~100k BTC price", () => {
    const snap = makeSnapshot([[99_900, 1.0]], [[100_100, 1.0]]);
    const { spreadBps } = computeMicrostructure(snap);
    // 200 / 100000 * 10000 = 20 bps
    expect(spreadBps).toBeCloseTo(20, 0);
  });

  it("handles empty bids/asks (no crash)", () => {
    const snap = makeSnapshot([], []);
    expect(() => computeMicrostructure(snap)).not.toThrow();
  });

  it("returns snapshot reference", () => {
    const snap = makeSnapshot([[99_900, 1.0]], [[100_100, 1.0]]);
    const ms = computeMicrostructure(snap);
    expect(ms.snapshot).toBe(snap);
  });
});

// ── computeDepthCurve ─────────────────────────────────────────────────────────

describe("computeDepthCurve", () => {
  it("returns an array of entries with price, size, cumulativeSize", () => {
    const levels = [
      { price: 100, size: 1 },
      { price: 101, size: 2 },
      { price: 102, size: 3 },
    ];
    const curve = computeDepthCurve(levels);
    for (const entry of curve) {
      expect(entry).toHaveProperty("price");
      expect(entry).toHaveProperty("size");
      expect(entry).toHaveProperty("cumulativeSize");
    }
  });

  it("cumulativeSize increases monotonically", () => {
    const levels = [
      { price: 100, size: 1 },
      { price: 101, size: 2 },
      { price: 102, size: 3 },
    ];
    const curve = computeDepthCurve(levels);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.cumulativeSize).toBeGreaterThanOrEqual(curve[i - 1]!.cumulativeSize);
    }
  });

  it("final cumulativeSize equals sum of all sizes", () => {
    const levels = [
      { price: 100, size: 1.5 },
      { price: 101, size: 2.5 },
      { price: 102, size: 1.0 },
    ];
    const curve = computeDepthCurve(levels);
    const totalSize = levels.reduce((s, l) => s + l.size, 0);
    expect(curve[curve.length - 1]!.cumulativeSize).toBeCloseTo(totalSize, 4);
  });

  it("respects maxLevels parameter", () => {
    const levels = Array.from({ length: 50 }, (_, i) => ({ price: 100 + i, size: 1 }));
    const curve = computeDepthCurve(levels, 10);
    expect(curve).toHaveLength(10);
  });

  it("returns empty array for empty input", () => {
    expect(computeDepthCurve([])).toHaveLength(0);
  });

  it("single level: cumulativeSize equals size", () => {
    const curve = computeDepthCurve([{ price: 100, size: 5 }]);
    expect(curve[0]!.cumulativeSize).toBe(5);
  });

  it("price is preserved unchanged", () => {
    const levels = [{ price: 99_999.5, size: 0.25 }];
    const curve = computeDepthCurve(levels);
    expect(curve[0]!.price).toBe(99_999.5);
  });
});
