import { describe, expect, it } from "vitest";
import { findRetestConfirmation } from "../src/retest";
import type { Bar, OrderBlock1H } from "../src/types";

const b = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  Timestamp: new Date(Date.UTC(2026, 0, 1, i, 0, 0)).toISOString(),
  Open: o, High: h, Low: l, Close: c, Volume: 1,
});

const ob: OrderBlock1H = { obIndex: 0, bosIndex: 1, obLow: 100, obHigh: 102, displacementATR: 2 };

describe("findRetestConfirmation", () => {
  it("returns 'confirmed' when a bar touches the zone AND closes bullish", () => {
    const bars: Bar[] = [
      b(0, 99, 103, 99, 102),
      b(1, 102, 110, 101.5, 109),
      b(2, 109, 110, 108, 109.5),
      b(3, 109.5, 110, 101, 105),
      b(4, 105, 106, 100.5, 102.5),
      b(5, 102, 104, 101.5, 103.5),
    ];
    const r = findRetestConfirmation(bars, ob, 10);
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed") {
      expect(r.index).toBe(5);
      expect(r.close).toBe(103.5);
    }
  });
  it("returns 'ob_broken' when a bar closes below obLow before any confirmation", () => {
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 99, 98),
    ];
    const r = findRetestConfirmation(bars, ob, 10);
    expect(r.kind).toBe("ob_broken");
    if (r.kind === "ob_broken") expect(r.atIndex).toBe(2);
  });
  it("returns 'expired' when neither happens within maxBars", () => {
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 108, 109.5),
      b(3, 109.5, 110, 108.5, 109.8),
      b(4, 109.8, 110, 109, 109.9),
    ];
    const r = findRetestConfirmation(bars, ob, 3);
    expect(r.kind).toBe("expired");
    if (r.kind === "expired") expect(r.checkedThrough).toBe(4);
  });
});
