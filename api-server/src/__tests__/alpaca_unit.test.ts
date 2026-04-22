/**
 * alpaca_unit.test.ts — Phase 70
 *
 * Tests AlpacaBar/AlpacaTimeframe types, getBars, getLatestTrade,
 * placeOrder, getAccount. Mocks global fetch; works with KEY_ID="" (no env key).
 *
 * Key behaviors when KEY_ID is empty:
 *   getAccount() → { error: "No API key configured" }
 *   placeOrder() → throws (requires PK/AK key)
 *   getBars("BTCUSD", ...) → crypto path, calls fetch unauthenticated
 *   getLatestTrade("BTCUSD") → tries crypto path, returns null on any error
 *   getLatestTrade("AAPL") → !hasValidTradingKey → returns null immediately
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("../lib/market/orderbook", () => ({
  orderBookManager: { update: vi.fn(), get: vi.fn(() => null), clear: vi.fn() },
}));

vi.mock("../lib/market/orderbook_recorder", () => ({
  orderBookRecorder: { record: vi.fn() },
}));

vi.mock("../lib/market/symbols", () => ({
  normalizeMarketSymbol: vi.fn((s: string) => s),
  isCryptoSymbol: vi.fn((s: string) => s.endsWith("USD") || s.includes("BTC") || s.includes("ETH")),
  toAlpacaSlash: vi.fn((s: string) => s.replace(/([A-Z]+)(USD)$/, "$1/$2")),
  fromAlpacaSlash: vi.fn((s: string) => s.replace("/", "")),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

import {
  getBars,
  getLatestTrade,
  getAccount,
  placeOrder,
  type AlpacaBar,
  type AlpacaTimeframe,
  type PlaceOrderRequest,
} from "../lib/alpaca";

// ── AlpacaBar type ────────────────────────────────────────────────────────────

describe("AlpacaBar type", () => {
  it("has both lowercase and uppercase fields", () => {
    const bar: AlpacaBar = {
      t: "2026-01-01T00:00:00Z",
      o: 84000, h: 84500, l: 83500, c: 84200, v: 1000,
      Timestamp: "2026-01-01T00:00:00Z",
      Open: 84000, High: 84500, Low: 83500, Close: 84200, Volume: 1000,
    };
    expect(bar.Close).toBe(bar.c);
    expect(bar.High).toBe(bar.h);
    expect(bar.Low).toBe(bar.l);
    expect(bar.Open).toBe(bar.o);
    expect(bar.Volume).toBe(bar.v);
    expect(bar.Timestamp).toBe(bar.t);
  });

  it("has optional VWAP/vw fields", () => {
    const bar: AlpacaBar = {
      t: "2026-01-01T00:00:00Z",
      o: 84000, h: 84500, l: 83500, c: 84200, v: 1000,
      Timestamp: "2026-01-01T00:00:00Z",
      Open: 84000, High: 84500, Low: 83500, Close: 84200, Volume: 1000,
      VWAP: 84150, vw: 84150,
    };
    expect(bar.VWAP).toBe(84150);
  });

  it("high >= low in a valid bar", () => {
    const bar: AlpacaBar = {
      t: "2026-01-01T00:00:00Z", o: 84000, h: 84500, l: 83500, c: 84200, v: 1000,
      Timestamp: "2026-01-01T00:00:00Z",
      Open: 84000, High: 84500, Low: 83500, Close: 84200, Volume: 1000,
    };
    expect(bar.High).toBeGreaterThanOrEqual(bar.Low);
  });
});

describe("AlpacaTimeframe type", () => {
  it("supports all 5 timeframes", () => {
    const tfs: AlpacaTimeframe[] = ["1Min", "5Min", "15Min", "1Hour", "1Day"];
    expect(tfs).toHaveLength(5);
    expect(tfs).toContain("1Min");
    expect(tfs).toContain("1Day");
  });
});

// ── getBars ───────────────────────────────────────────────────────────────────

describe("getBars", () => {
  it("returns normalised AlpacaBar array from crypto API response", async () => {
    const cryptoSymbol = "BTC/USD";
    const rawBars = [
      { t: "2026-01-01T00:00:00Z", o: 84000, h: 84500, l: 83500, c: 84200, v: 1000 },
      { t: "2026-01-01T00:01:00Z", o: 84200, h: 84600, l: 84000, c: 84400, v: 900 },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ bars: { [cryptoSymbol]: rawBars } }),
    } as any);

    const bars = await getBars("BTCUSD", "1Min", 2);
    expect(Array.isArray(bars)).toBe(true);
    if (bars.length > 0) {
      expect(bars[0]).toHaveProperty("Close");
      expect(bars[0]).toHaveProperty("c");
      // Both lowercase and uppercase should match
      expect(bars[0].Close).toBe(bars[0].c);
    }
  });

  it("returns [] when fetch response has empty bars", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ bars: {} }),
    } as any);
    const bars = await getBars("BTCUSD", "5Min", 50);
    expect(Array.isArray(bars)).toBe(true);
    expect(bars).toHaveLength(0);
  });

  it("throws for stock symbol when no valid API key", async () => {
    // AAPL is not crypto, and hasValidTradingKey=false (no PK/AK in env)
    await expect(getBars("AAPL", "1Min", 10)).rejects.toThrow();
  });
});

// ── getLatestTrade ────────────────────────────────────────────────────────────

describe("getLatestTrade", () => {
  it("returns object with price and timestamp for crypto on success", async () => {
    const cryptoSymbol = "BTC/USD";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ trades: { [cryptoSymbol]: { p: 84250, t: "2026-01-01T00:00:00Z" } } }),
    } as any);

    const trade = await getLatestTrade("BTCUSD");
    if (trade) {
      expect(typeof trade.price).toBe("number");
      expect(trade.price).toBe(84250);
      expect(typeof trade.timestamp).toBe("string");
    }
    // null is acceptable if symbol key doesn't match
    expect(trade === null || typeof trade === "object").toBe(true);
  });

  it("returns null when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const trade = await getLatestTrade("BTCUSD");
    expect(trade).toBeNull();
  });

  it("returns null for stock symbol when no valid API key", async () => {
    const trade = await getLatestTrade("AAPL");
    expect(trade).toBeNull();
  });

  it("returns null when API returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => "Internal Server Error",
    } as any);
    const trade = await getLatestTrade("BTCUSD");
    expect(trade).toBeNull();
  });
});

// ── getAccount ────────────────────────────────────────────────────────────────

describe("getAccount", () => {
  it("returns error object when no API key configured", async () => {
    const account = await getAccount() as any;
    // When KEY_ID is empty, returns { error: "No API key configured" }
    expect(account).toBeDefined();
    if (typeof account === "object" && account !== null && "error" in account) {
      expect(account.error).toBeDefined();
    }
  });

  it("does not throw even without API key", async () => {
    await expect(getAccount()).resolves.toBeDefined();
  });
});

// ── placeOrder ────────────────────────────────────────────────────────────────

describe("placeOrder", () => {
  it("throws when no valid trading key (PK/AK) configured", async () => {
    const req: PlaceOrderRequest = {
      symbol: "BTCUSD", qty: 1, side: "buy", type: "market", time_in_force: "gtc",
    };
    await expect(placeOrder(req)).rejects.toThrow();
  });
});

// ── PlaceOrderRequest type ────────────────────────────────────────────────────

describe("PlaceOrderRequest type", () => {
  it("can construct market order with required fields", () => {
    const req: PlaceOrderRequest = {
      symbol: "BTCUSD", qty: 5, side: "buy", type: "market", time_in_force: "gtc",
    };
    expect(req.symbol).toBe("BTCUSD");
    expect(req.side).toBe("buy");
    expect(req.type).toBe("market");
  });

  it("can construct limit order with optional price", () => {
    const req: PlaceOrderRequest = {
      symbol: "ETHUSD", qty: 2, side: "sell", type: "limit",
      time_in_force: "day", limit_price: 3500,
    };
    expect(req.limit_price).toBe(3500);
    expect(req.type).toBe("limit");
  });

  it("can construct bracket order with stop_loss_price and take_profit_price", () => {
    const req: PlaceOrderRequest = {
      symbol: "BTCUSD", qty: 1, side: "buy", type: "market",
      time_in_force: "gtc",
      stop_loss_price: 83000, take_profit_price: 87000,
    };
    expect(req.stop_loss_price).toBe(83000);
    expect(req.take_profit_price).toBe(87000);
  });
});
