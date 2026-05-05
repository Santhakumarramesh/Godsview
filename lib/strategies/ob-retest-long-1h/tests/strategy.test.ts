import { describe, expect, it } from "vitest";
import { evaluate } from "../src/strategy";
import { buildBaseFixture } from "./fixtures/builders";

describe("evaluate (end-to-end, slim signal)", () => {
  it("emits a long signal on the engineered base fixture", () => {
    const { bars, expected } = buildBaseFixture();
    const out = evaluate({ symbol: "BTCUSD", bars });
    expect(out.kind).toBe("long");
    if (out.kind !== "long") return;
    expect(out.timestamp).toBe(bars[expected.confirmIndex]!.Timestamp);
    expect(out.entry).toBeCloseTo(108.8, 10);
    expect(out.stop).toBeLessThan(expected.obLow);
    expect(out.target).toBeGreaterThan(out.entry);
    // invalidation.obLow matches OB low; expireAt is bars[bosIndex+24] timestamp (clamped).
    expect(out.invalidation.obLow).toBe(expected.obLow);
    const wantExpireIdx = Math.min(expected.bosIndex + 24, bars.length - 1);
    expect(out.invalidation.expireAt).toBe(bars[wantExpireIdx]!.Timestamp);
    // Output shape: only allowed keys.
    const allowed = new Set(["kind","timestamp","entry","stop","target","invalidation"]);
    for (const k of Object.keys(out)) expect(allowed.has(k)).toBe(true);
  });

  it("rejects with insufficient_bars (single reason) for short input", () => {
    const out = evaluate({ symbol: "BTCUSD", bars: [] });
    expect(out.kind).toBe("no_trade");
    if (out.kind === "no_trade") {
      expect(out.reason).toBe("insufficient_bars");
      // shape check
      const allowed = new Set(["kind","timestamp","reason"]);
      for (const k of Object.keys(out)) expect(allowed.has(k)).toBe(true);
    }
  });

  it("rejects (no_trade) when impulse displacement is too small", () => {
    const { bars } = buildBaseFixture();
    const mod = bars.map((b, i) => {
      if (i === 32) return { ...b, High: 107.2, Close: 107.0 };
      if (i === 41) return { ...b, High: 107.4, Close: 107.0 };
      if (i === 42) return { ...b, High: 107.3, Close: 107.2 };
      return b;
    });
    const out = evaluate({ symbol: "BTCUSD", bars: mod });
    expect(out.kind).toBe("no_trade");
  });

  it("rejects with ob_broken_before_retest", () => {
    const { bars } = buildBaseFixture();
    const mod = bars.map((b, i) =>
      i === 44 ? { ...b, Open: 109.5, High: 109.6, Low: 105.0, Close: 105.5 } : b,
    );
    const out = evaluate({ symbol: "BTCUSD", bars: mod });
    expect(out.kind).toBe("no_trade");
    if (out.kind === "no_trade") expect(out.reason).toBe("ob_broken_before_retest");
  });

  it("rejects with retest_window_expired", () => {
    const { bars } = buildBaseFixture();
    const mod = bars.map((b, i) =>
      i >= 43 ? { ...b, Open: 111.0, High: 112.0, Low: 110.5, Close: 111.5 } : b,
    );
    const out = evaluate({ symbol: "BTCUSD", bars: mod });
    expect(out.kind).toBe("no_trade");
    if (out.kind === "no_trade") expect(out.reason).toBe("retest_window_expired");
  });

  it("rejects with news_window", () => {
    const { bars, expected } = buildBaseFixture();
    const newsTs = bars[expected.confirmIndex]!.Timestamp;
    const out = evaluate({
      symbol: "BTCUSD", bars,
      news: [{ ts: newsTs, severity: "high" }],
    });
    expect(out.kind).toBe("no_trade");
    if (out.kind === "no_trade") expect(out.reason).toBe("news_window");
  });

  it("rejects (no_trade) when bullish structure is forced down", () => {
    const { bars } = buildBaseFixture();
    const mod = bars.map((b, i) =>
      i >= 33 && i <= 36 ? { ...b, Open: 90, High: 91, Low: 80, Close: 89 } : b,
    );
    const out = evaluate({ symbol: "BTCUSD", bars: mod });
    expect(out.kind).toBe("no_trade");
  });
});
