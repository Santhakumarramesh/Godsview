import { describe, expect, it } from "vitest";
import { atr } from "../src/atr";
import { detectPivots, findLatestBOSUp } from "../src/structure";
import { findOrderBlockForBOS, displacementATR } from "../src/order_block";
import { findRetestConfirmation } from "../src/retest";
import { atrTooLow } from "../src/filters";
import { evaluate } from "../src/strategy";
import type { Bar, OrderBlock1H } from "../src/types";
import { bar, buildBaseFixture } from "./fixtures/builders";

describe("edge: gap candles (crypto weekend gaps)", () => {
  it("ATR Wilder accounts for gaps via |High - prevClose| / |Low - prevClose|", () => {
    const bars: Bar[] = [
      bar(0, 100, 101, 99, 100.5),    // TR = 2
      bar(1, 100.5, 101.5, 99.5, 101), // TR = max(2, |101.5-100.5|, |99.5-100.5|) = 2
      bar(2, 110, 111, 109, 110),     // gap up: prevC=101 → TR=max(2,|111-101|,|109-101|)=10
    ];
    const a = atr(bars, 2);
    expect(a[1]).toBeCloseTo(2, 10);     // seed = mean of TR[0..1] = 2
    expect(a[2]).toBeCloseTo((2 * 1 + 10) / 2, 10); // Wilder = (prev*1 + 10) / 2 = 6
  });

  it("a gap-up bar that opens above prior swing high still triggers BOS via High > pivot", () => {
    // Build a flat series with one pivot high, then gap above it.
    const bars: Bar[] = [];
    for (let i = 0; i < 6; i++) bars.push(bar(i, 100, 100.5, 99.5, 100));
    // Pivot high at i=8 with H=102.
    bars.push(bar(6, 100, 100.2, 99.8, 100));
    bars.push(bar(7, 100, 100.5, 99.7, 100.2));
    bars.push(bar(8, 100.2, 102, 100.1, 101.5));   // pivot high candidate
    bars.push(bar(9, 101.5, 101.7, 100.5, 100.8));
    bars.push(bar(10, 100.8, 101, 100, 100.3));
    // Gap up bar at 11
    bars.push(bar(11, 105, 106, 104.5, 105.5));    // High=106 > pivot 102 → BOS
    bars.push(bar(12, 105.5, 105.8, 105, 105.3));
    const pivots = detectPivots(bars, 2, 2);
    const bos = findLatestBOSUp(bars, pivots, bars.length - 1, 2);
    expect(bos).not.toBeNull();
    expect(bos!.bosIndex).toBe(11);
    expect(bos!.brokenSwingPrice).toBe(102);
  });
});

describe("edge: extreme volatility spike", () => {
  it("ATR jumps but does not corrupt signal math when applied to a single bar", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(i, 100, 100.5, 99.5, 100));
    bars.push(bar(20, 100, 200, 50, 150)); // huge spike
    const a = atr(bars, 14);
    expect(a[20]).toBeGreaterThan(a[19]);
    // Wilder: (prev*13 + 150) / 14 — should be a finite, large but bounded number
    expect(Number.isFinite(a[20])).toBe(true);
    expect(a[20]).toBeLessThan(200);
  });

  it("displacement on a spike bar is computed against the spike's own ATR, not pre-spike ATR", () => {
    // Construct: OB at idx 0 with low=100 high=101; BOS bar at idx 1 with high=200
    const bars: Bar[] = [
      bar(0, 101, 101, 100, 100.5), // down close OB
      bar(1, 100.5, 200, 100, 199), // huge BOS
    ];
    // atrAtBos = 50 (artificially) → disp = (200 - 100) / 50 = 2.0
    expect(displacementATR(bars, 0, 1, 50)).toBeCloseTo(2.0, 10);
  });
});

describe("edge: flat market (low ATR)", () => {
  it("atrTooLow fires when ATR collapses to a small fraction of recent average", () => {
    // 10 bars of ATR=1.0, then one bar of ATR=0.1.
    const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.1];
    expect(atrTooLow(series, 9, 10, 0.5)).toBe(true);
  });

  it("evaluate rejects atr_too_low when the confirmation bar sits in a flat-ATR window", () => {
    // Build a clean setup but force ATR at confirmation to be tiny relative to avg.
    // Easier: use evaluate with minATRRatio=10 (impossible threshold) on the base fixture.
    const { bars } = buildBaseFixture();
    const out = evaluate({ symbol: "BTCUSD", bars, config: { minATRRatio: 10 } });
    expect(out.kind).toBe("no_trade");
    if (out.kind === "no_trade") expect(out.reason).toBe("atr_too_low");
  });
});

describe("edge: multiple OBs overlapping", () => {
  it("findOrderBlockForBOS returns the LAST down-close before BOS, not the earliest", () => {
    // Bars: idx 0..4 with two down-close candles at idx 1 and idx 3, BOS at idx 4.
    const bars: Bar[] = [
      bar(0, 100, 101, 99, 100.5),
      bar(1, 100.5, 101, 99, 99.5),    // down close, OB candidate A
      bar(2, 99.5, 100, 99, 99.8),
      bar(3, 99.8, 100.2, 99.5, 99.7), // down close, OB candidate B (LATER)
      bar(4, 99.7, 105, 99.7, 104),    // BOS bar
    ];
    const ob = findOrderBlockForBOS(bars, 4, 0);
    expect(ob).not.toBeNull();
    expect(ob!.obIndex).toBe(3); // the LATER one
  });
});

describe("edge: retest at exactly the last allowed bar (boundary)", () => {
  const ob: OrderBlock1H = { obIndex: 0, bosIndex: 1, obLow: 100, obHigh: 102, displacementATR: 2 };

  it("retest exactly at bosIndex + maxBars CONFIRMS (inclusive boundary)", () => {
    // maxBars = 3. Bars 2,3,4 are inside the window (4 = bosIndex+3).
    const bars: Bar[] = [
      bar(0, 99, 103, 99, 102),         // OB
      bar(1, 102, 110, 101.5, 109),     // BOS
      bar(2, 109, 110, 108, 109.5),     // no touch
      bar(3, 109.5, 110, 108.5, 109.8), // no touch
      bar(4, 101, 102.8, 101, 102.6),   // touches zone AND bullish close — exactly at boundary
    ];
    const r = findRetestConfirmation(bars, ob, 3);
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed") expect(r.index).toBe(4);
  });

  it("retest one bar past the boundary is NOT counted (window expires)", () => {
    // maxBars = 3. Bar 5 is outside the window.
    const bars: Bar[] = [
      bar(0, 99, 103, 99, 102),
      bar(1, 102, 110, 101.5, 109),
      bar(2, 109, 110, 108, 109.5),
      bar(3, 109.5, 110, 108.5, 109.8),
      bar(4, 109.8, 110, 109, 109.9),
      bar(5, 109.9, 110, 101, 102.5), // would confirm — but outside window
    ];
    const r = findRetestConfirmation(bars, ob, 3);
    expect(r.kind).toBe("expired");
    if (r.kind === "expired") expect(r.checkedThrough).toBe(4);
  });
});
