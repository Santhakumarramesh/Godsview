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

  // ── M5c: obBreakBufferPct buffer behavior ───────────────────────────────────
  it("default behavior (buffer = 0): a bar closing 0.1% below obLow IS broken (strict baseline)", () => {
    // ob.obLow = 100. A bar that closes at 99.9 (0.1% below) must invalidate
    // under the default strict rule. Preserves M5b production behavior.
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 99.9, 99.9),  // Close=99.9 < obLow=100 → broken (default)
    ];
    const r = findRetestConfirmation(bars, ob, 10);  // default buffer = 0
    expect(r.kind).toBe("ob_broken");
    if (r.kind === "ob_broken") expect(r.atIndex).toBe(2);
  });

  it("with buffer = 0.2% (0.002): a 0.1% wick-spike close BELOW obLow does NOT invalidate", () => {
    // Close=99.9, obLow=100, effectiveLow = 100 * (1 - 0.002) = 99.8
    // Close 99.9 > effectiveLow 99.8 → NOT broken; keep walking forward.
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 99.9, 99.9),    // 0.1% below obLow but ABOVE effectiveLow
      b(3, 99.9, 102, 99.7, 101.5),  // touches zone & bullish close → confirmed
    ];
    const r = findRetestConfirmation(bars, ob, 10, 0.002);
    expect(r.kind).not.toBe("ob_broken");
  });

  it("with buffer = 0.2%: a real structural break (>0.2% below obLow) STILL invalidates", () => {
    // Close=99.5, obLow=100, effectiveLow = 99.8. Close 99.5 < 99.8 → broken.
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 99, 99.5),
    ];
    const r = findRetestConfirmation(bars, ob, 10, 0.002);
    expect(r.kind).toBe("ob_broken");
    if (r.kind === "ob_broken") expect(r.atIndex).toBe(2);
  });

  it("buffer is clamped: negative is treated as 0 (strict baseline)", () => {
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 99.99, 99.99),
    ];
    const r = findRetestConfirmation(bars, ob, 10, -1);
    expect(r.kind).toBe("ob_broken");
  });

  it("buffer is clamped at 5% even with misconfigured huge value", () => {
    // ob.obLow = 100. A bar closing 10% below MUST still invalidate even
    // with a misconfigured huge buffer, because cap is 5% (effectiveLow=95).
    const bars: Bar[] = [
      b(0, 101, 103, 100, 100.5),
      b(1, 100.5, 110, 100.5, 109),
      b(2, 109, 110, 88, 90),
    ];
    const r = findRetestConfirmation(bars, ob, 10, 0.99);
    expect(r.kind).toBe("ob_broken");
  });
});
