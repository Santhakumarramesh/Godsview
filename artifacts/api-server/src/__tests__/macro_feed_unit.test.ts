import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLiveMacroSnapshot } from "../lib/macro_feed";
import { getBars } from "../lib/alpaca";

vi.mock("../lib/alpaca", () => ({
  getBars: vi.fn(),
  isAlpacaAuthFailureError: vi.fn(() => false),
}));

function makeBars(limit: number, startPrice: number, step: number, volume = 1000) {
  const bars = [];
  const baseTs = Date.parse("2026-04-04T00:00:00.000Z");
  for (let i = 0; i < limit; i++) {
    const close = startPrice + step * i;
    bars.push({
      t: new Date(baseTs + i * 60_000).toISOString(),
      o: close - step * 0.4,
      h: close + step * 0.8,
      l: close - step * 0.8,
      c: close,
      v: volume + i * 10,
      Timestamp: new Date(baseTs + i * 60_000).toISOString(),
      Open: close - step * 0.4,
      High: close + step * 0.8,
      Low: close - step * 0.8,
      Close: close,
      Volume: volume + i * 10,
    });
  }
  return bars;
}

describe("fetchLiveMacroSnapshot", () => {
  const getBarsMock = vi.mocked(getBars);

  beforeEach(() => {
    getBarsMock.mockReset();
  });

  it("uses shared alpaca wrapper bars and returns full quality snapshot", async () => {
    getBarsMock.mockImplementation(async (symbol: string, timeframe: string, limit: number) => {
      const normalized = String(symbol).replace("/", "").toUpperCase();
      if (timeframe === "1Day" && normalized === "UUP") return makeBars(limit, 29, 0.02, 50_000);
      if (timeframe === "1Day" && normalized === "VIXY") return makeBars(limit, 16, 0.05, 30_000);
      if (timeframe === "1Min" && normalized === "BTCUSD") return makeBars(limit, 50_000, 8, 1_200);
      return [];
    });

    const snapshot = await fetchLiveMacroSnapshot("long", "BTC/USD", "crypto");

    expect(snapshot.dataQuality).toBe("full");
    expect(snapshot.macroBiasInput.assetClass).toBe("crypto");
    expect(snapshot.macroBiasInput.intendedDirection).toBe("long");
    expect(snapshot.sentimentInput.assetClass).toBe("crypto");
    expect(snapshot.sentimentInput.intendedDirection).toBe("long");
    expect(getBarsMock).toHaveBeenCalled();
  });

  it("gracefully degrades to stale quality when market data fetch fails", async () => {
    getBarsMock.mockRejectedValue(new Error("401 unauthorized"));

    const snapshot = await fetchLiveMacroSnapshot("short", "BTC/USD", "crypto");

    expect(snapshot.dataQuality).toBe("stale");
    expect(snapshot.macroBiasInput.intendedDirection).toBe("short");
    expect(snapshot.sentimentInput.intendedDirection).toBe("short");
  });
});
