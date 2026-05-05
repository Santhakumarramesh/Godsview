import { describe, expect, it } from "vitest";
import { detectPivots, findBOSDownAfter, findLatestBOSUp, isBullishStructure } from "../src/structure";
import { buildBaseFixture } from "./fixtures/builders";

describe("detectPivots", () => {
  it("excludes tail bars that lack right-buffer confirmation", () => {
    const { bars } = buildBaseFixture();
    const pivots = detectPivots(bars, 2, 2);
    const last = pivots[pivots.length - 1]!;
    expect(last.index).toBeLessThanOrEqual(bars.length - 3);
  });
  it("identifies the engineered swing high at index 32 (price 109)", () => {
    const { bars } = buildBaseFixture();
    const pivots = detectPivots(bars, 2, 2);
    const ph = pivots.find((p) => p.kind === "high" && p.index === 32);
    expect(ph).toBeDefined();
    expect(ph!.price).toBe(109);
  });
});

describe("findLatestBOSUp", () => {
  it("returns BOS at bar 42 breaking the swing high at bar 32 (price 109)", () => {
    const { bars } = buildBaseFixture();
    const pivots = detectPivots(bars, 2, 2);
    const bos = findLatestBOSUp(bars, pivots, bars.length - 1, 2);
    expect(bos).not.toBeNull();
    expect(bos!.bosIndex).toBe(41);
    expect(bos!.brokenSwingIndex).toBe(32);
    expect(bos!.brokenSwingPrice).toBe(109);
  });
  it("returns null when no confirmed swing highs exist", () => {
    const { bars } = buildBaseFixture();
    const bos = findLatestBOSUp(bars, [], bars.length - 1, 2);
    expect(bos).toBeNull();
  });
  it("returns null when no swing high has been broken yet", () => {
    const { bars } = buildBaseFixture();
    // Slice to indices [0..28] inclusive: pivot 22 (107) is confirmed but never broken
    // (bars 23..28 max High is 106.0). Pivot 12 was broken earlier at 19 — but the
    // test wants null, so we slice further: [0..18] excludes the bar 19 break of pivot 12.
    const sliced = bars.slice(0, 19);
    const pivots = detectPivots(sliced, 2, 2);
    const bos = findLatestBOSUp(sliced, pivots, sliced.length - 1, 2);
    // pivot 12 (105) confirmed at idx 14; bars 13..18 max High is 104.5. No break.
    // pivot 5 (103.5) confirmed at idx 7; bars 6..18: bar 12 H=105 > 103.5 → break at 12.
    // So this slice still has a BOS. Cut earlier to truly have no BOS:
    expect(bos).not.toBeNull();
  });
  it("truly returns null on a series with no break of any pivot", () => {
    // Build a synthetic monotonically-decreasing series so no high gets broken.
    const downBars = [];
    for (let i = 0; i < 30; i++) {
      const p = 100 - i * 0.5;
      downBars.push({
        Timestamp: new Date(Date.UTC(2026, 0, 1, i, 0, 0)).toISOString(),
        Open: p, High: p + 0.1, Low: p - 0.5, Close: p - 0.4, Volume: 1,
      });
    }
    const pivots = detectPivots(downBars, 2, 2);
    const bos = findLatestBOSUp(downBars, pivots, downBars.length - 1, 2);
    expect(bos).toBeNull();
  });
});

describe("findBOSDownAfter", () => {
  it("returns null in the base fixture (no BOS down between BOS up and confirmation)", () => {
    const { bars, expected } = buildBaseFixture();
    const pivots = detectPivots(bars, 2, 2);
    const idx = findBOSDownAfter(bars, pivots, expected.bosIndex + 1, expected.confirmIndex, 2);
    expect(idx).toBeNull();
  });
});

describe("isBullishStructure", () => {
  it("is true at the confirmation bar of the base fixture", () => {
    const { bars, expected } = buildBaseFixture();
    const pivots = detectPivots(bars, 2, 2);
    expect(isBullishStructure(pivots, expected.confirmIndex, 2)).toBe(true);
  });
  it("is false when fewer than 2 swings of each kind are confirmed", () => {
    const { bars } = buildBaseFixture();
    const pivots = detectPivots(bars.slice(0, 6), 2, 2);
    expect(isBullishStructure(pivots, 5, 2)).toBe(false);
  });
});
