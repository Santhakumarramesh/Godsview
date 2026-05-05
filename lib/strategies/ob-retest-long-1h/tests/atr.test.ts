import { describe, expect, it } from "vitest";
import { atr, smaIgnoreNaN, trueRange } from "../src/atr";
import type { Bar } from "../src/types";

const b = (o: number, h: number, l: number, c: number): Bar => ({
  Timestamp: "2026-01-01T00:00:00.000Z", Open: o, High: h, Low: l, Close: c, Volume: 1,
});

describe("trueRange", () => {
  it("equals High - Low when prevClose is null", () => {
    expect(trueRange(b(10, 12, 9, 11), null)).toBe(3);
  });
  it("uses |High - prevClose| if it is the largest", () => {
    expect(trueRange(b(10, 12, 9, 11), 5)).toBe(7);
  });
  it("uses |Low - prevClose| if it is the largest", () => {
    expect(trueRange(b(10, 12, 9, 11), 20)).toBe(11);
  });
});

describe("atr (Wilder)", () => {
  it("returns NaN for indices before period-1", () => {
    const bars = [b(1, 2, 0, 1), b(1, 2, 0, 1), b(1, 2, 0, 1)];
    const a = atr(bars, 3);
    expect(Number.isNaN(a[0])).toBe(true);
    expect(Number.isNaN(a[1])).toBe(true);
    expect(Number.isFinite(a[2])).toBe(true);
  });
  it("first valid value equals simple mean of first `period` TRs", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 5; i++) bars.push(b(0.5, 1.0, 0.0, 0.5));
    const a = atr(bars, 3);
    expect(a[2]).toBeCloseTo(1.0, 10);
  });
  it("applies Wilder smoothing for bars after the seed window", () => {
    const bars: Bar[] = [
      b(0, 1, 0, 0.5),
      b(0.5, 1.5, 0.5, 1.0),
      b(1.0, 6.0, 1.0, 5.5),
    ];
    const a = atr(bars, 2);
    expect(a[1]).toBeCloseTo(1.0, 10);
    expect(a[2]).toBeCloseTo(3.0, 10);
  });
  it("returns all NaN when bars.length < period", () => {
    const bars = [b(1, 2, 0, 1)];
    const a = atr(bars, 3);
    expect(a.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe("smaIgnoreNaN", () => {
  it("averages over the trailing window, skipping NaN values", () => {
    const v = [NaN, NaN, 1, 2, 3];
    expect(smaIgnoreNaN(v, 3, 4)).toBeCloseTo(2.0, 10);
  });
  it("returns NaN when no usable values fall in the window", () => {
    const v = [NaN, NaN, NaN];
    expect(Number.isNaN(smaIgnoreNaN(v, 3, 2))).toBe(true);
  });
});
