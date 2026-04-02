import { describe, it, expect } from "vitest";
import {
  computeFeatures,
  computeFeatureSeries,
  computeRSI,
  computeATR,
  getSessionLabel,
  type OHLCV,
} from "../lib/feature_pipeline";

function makeBars(count: number, basePrice: number = 100): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * 2; // slight upward bias
    price += change;
    const high = price + Math.random() * 1.5;
    const low = price - Math.random() * 1.5;
    bars.push({
      open: price - change * 0.3,
      high,
      low,
      close: price,
      volume: 1000 + Math.random() * 500,
      timestamp: new Date(Date.now() - (count - i) * 60_000).toISOString(),
    });
  }
  return bars;
}

describe("Feature Pipeline", () => {
  it("computes a full feature vector", () => {
    const bars = makeBars(30);
    const features = computeFeatures(bars, "BTCUSD", "1m");

    expect(features.symbol).toBe("BTCUSD");
    expect(features.timeframe).toBe("1m");
    expect(typeof features.log_return).toBe("number");
    expect(typeof features.rsi_14).toBe("number");
    expect(features.rsi_14).toBeGreaterThanOrEqual(0);
    expect(features.rsi_14).toBeLessThanOrEqual(100);
    expect(typeof features.atr_14).toBe("number");
    expect(typeof features.realized_vol).toBe("number");
    expect(typeof features.relative_volume).toBe("number");
    expect(features.session_label).toBeTruthy();
  });

  it("throws on empty bars", () => {
    expect(() => computeFeatures([], "BTC", "1m")).toThrow();
  });

  it("computes series for sliding window", () => {
    const bars = makeBars(50);
    const series = computeFeatureSeries(bars, "ETHUSD", "5m");

    expect(series.length).toBeGreaterThan(0);
    expect(series.length).toBeLessThanOrEqual(bars.length);
    expect(series[0].symbol).toBe("ETHUSD");
  });
});

describe("RSI", () => {
  it("returns 50 for insufficient data", () => {
    expect(computeRSI([100, 101], 14)).toBe(50);
  });

  it("returns near 100 for all gains", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const rsi = computeRSI(closes, 14);
    expect(rsi).toBeGreaterThan(90);
  });

  it("returns near 0 for all losses", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    const rsi = computeRSI(closes, 14);
    expect(rsi).toBeLessThan(10);
  });
});

describe("ATR", () => {
  it("returns 0 for insufficient data", () => {
    expect(computeATR([], 14)).toBe(0);
  });

  it("computes positive ATR for normal bars", () => {
    const bars = makeBars(20);
    const atr = computeATR(bars, 14);
    expect(atr).toBeGreaterThan(0);
  });
});

describe("Session Label", () => {
  it("maps UTC hours to correct sessions", () => {
    // 10:00 UTC = London
    const london = getSessionLabel("2026-03-31T10:00:00Z");
    expect(london).toBe("london");

    // 15:00 UTC = New York
    const ny = getSessionLabel("2026-03-31T15:00:00Z");
    expect(ny).toBe("new_york");

    // 23:00 UTC = Asia
    const asia = getSessionLabel("2026-03-31T23:00:00Z");
    expect(asia).toBe("asia");
  });
});
