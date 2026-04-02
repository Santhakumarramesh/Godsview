/**
 * orderbook_route.test.ts — Phase 56
 *
 * Tests for the order book and market microstructure REST endpoints
 * (routes/orderbook.ts):
 *
 *   GET /api/orderbook/snapshot          — fetch order book snapshot
 *   GET /api/orderbook/replay            — replay window (REST only)
 *   GET /api/orderbook/recorder/status   — recorder status
 *   GET /api/market/microstructure       — top-of-book metrics
 *   GET /api/market/liquidity-zones      — clustered liquidity zones
 *   GET /api/market/volume-profile       — volume profile from bars
 *   GET /api/market/candle-intelligence  — candle annotations
 *   GET /api/market/cvd                  — cumulative volume delta
 *
 * NOTE: GET /api/orderbook/stream is SSE; excluded from these tests.
 *
 * Dependencies mocked:
 *   ../lib/market/orderbook          — orderBookManager
 *   ../lib/market/orderbook_recorder — orderBookRecorder
 *   ../lib/market/liquidityMap       — computeLiquidityZones, computeMicrostructure
 *   ../lib/market/symbols            — isCryptoSymbol, normalizeMarketSymbol
 *   ../lib/alpaca                    — getBars
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_SNAPSHOT = {
  symbol:     "BTCUSD",
  timestamp:  new Date().toISOString(),
  receivedAt: Date.now(),
  source:     "alpaca",
  asks:       [{ price: 42100, size: 0.5 }, { price: 42200, size: 1.2 }],
  bids:       [{ price: 42000, size: 0.8 }, { price: 41900, size: 2.0 }],
};

const MOCK_MICROSTRUCTURE = {
  symbol:       "BTCUSD",
  timestamp:    new Date().toISOString(),
  mid:          42050,
  bestBid:      42000,
  bestAsk:      42100,
  spread:       100,
  spreadBps:    2.38,
  imbalance:    0.05,
  topBidVolume: 0.8,
  topAskVolume: 0.5,
  absorbingBid: false,
  absorbingAsk: false,
};

const MOCK_LIQUIDITY = {
  asks: [{ price: 42100, strength: 0.8, volume: 0.5 }],
  bids: [{ price: 42000, strength: 0.9, volume: 0.8 }],
};

const MOCK_BARS = Array.from({ length: 20 }, (_, i) => ({
  Open:      42000 + i,
  High:      42100 + i,
  Low:       41900 + i,
  Close:     42050 + i,
  Volume:    1000 + i,
  VWAP:      42025 + i,
  Timestamp: new Date(Date.now() - (20 - i) * 60_000).toISOString(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/market/orderbook", () => ({
  orderBookManager: {
    fetchSnapshot:  vi.fn(async () => MOCK_SNAPSHOT),
    getSnapshot:    vi.fn(() => MOCK_SNAPSHOT),
    subscribe:      vi.fn(),
    unsubscribe:    vi.fn(),
  },
}));

vi.mock("../lib/market/orderbook_recorder", () => ({
  orderBookRecorder: {
    getStatus:        vi.fn(() => ({ recording: true, frames: 120, symbols: ["BTCUSD"] })),
    getReplayWindow:  vi.fn(() => ({
      symbol:    "BTCUSD",
      startMs:   Date.now() - 900_000,
      endMs:     Date.now(),
      frames:    [],
      ticks:     [],
      frameCount: 0,
      tickCount:  0,
    })),
  },
}));

vi.mock("../lib/market/liquidityMap", () => ({
  computeMicrostructure: vi.fn(() => MOCK_MICROSTRUCTURE),
  computeLiquidityZones:  vi.fn(() => MOCK_LIQUIDITY),
}));

vi.mock("../lib/market/symbols", () => ({
  isCryptoSymbol:        vi.fn(() => true),
  normalizeMarketSymbol: vi.fn((sym: string) => sym || "BTCUSD"),
}));

vi.mock("../lib/alpaca", () => ({
  getBars: vi.fn(async () => MOCK_BARS),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import orderbookRouter from "../routes/orderbook";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/api", orderbookRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

function get(path: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orderbook/snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/orderbook/snapshot", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/orderbook/snapshot");
    expect(status).toBe(200);
  });

  it("response has symbol, asks, bids", async () => {
    const { data } = await get("/api/orderbook/snapshot");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(Array.isArray(d.asks)).toBe(true);
    expect(Array.isArray(d.bids)).toBe(true);
  });

  it("response has bestAsk, bestBid, spread", async () => {
    const { data } = await get("/api/orderbook/snapshot");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("bestAsk");
    expect(d).toHaveProperty("bestBid");
    expect(d).toHaveProperty("spread");
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/api/orderbook/snapshot?symbol=ETHUSD");
    expect(status).toBe(200);
  });

  it("accepts depth query param", async () => {
    const { status } = await get("/api/orderbook/snapshot?depth=10");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orderbook/replay
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/orderbook/replay", () => {
  it("returns 200 with valid time window", async () => {
    const end   = Date.now();
    const start = end - 5 * 60 * 1000;
    const { status } = await get(`/api/orderbook/replay?start=${start}&end=${end}`);
    expect(status).toBe(200);
  });

  it("response has symbol, frames, ticks", async () => {
    const end   = Date.now();
    const start = end - 5 * 60 * 1000;
    const { data } = await get(`/api/orderbook/replay?start=${start}&end=${end}`);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(Array.isArray(d.frames)).toBe(true);
    expect(d).toHaveProperty("ticks");
  });

  it("returns 400 when start >= end", async () => {
    const ts = Date.now();
    const { status } = await get(`/api/orderbook/replay?start=${ts}&end=${ts - 1000}`);
    expect(status).toBe(400);
  });

  it("returns 400 for invalid time params", async () => {
    const { status } = await get("/api/orderbook/replay?start=not-a-date&end=also-not");
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orderbook/recorder/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/orderbook/recorder/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/orderbook/recorder/status");
    expect(status).toBe(200);
  });

  it("response has recording field", async () => {
    const { data } = await get("/api/orderbook/recorder/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("recording");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/microstructure
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/microstructure", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/market/microstructure");
    expect(status).toBe(200);
  });

  it("response has mid, spread, imbalance", async () => {
    const { data } = await get("/api/market/microstructure");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("mid");
    expect(d).toHaveProperty("spread");
    expect(d).toHaveProperty("imbalance");
  });

  it("response has signal field", async () => {
    const { data } = await get("/api/market/microstructure");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("signal");
    expect(["bid_absorption", "ask_absorption", "neutral"]).toContain(d.signal);
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/api/market/microstructure?symbol=ETHUSD");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/liquidity-zones
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/liquidity-zones", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/market/liquidity-zones");
    expect(status).toBe(200);
  });

  it("response has askZones, bidZones, allZones arrays", async () => {
    const { data } = await get("/api/market/liquidity-zones");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.askZones)).toBe(true);
    expect(Array.isArray(d.bidZones)).toBe(true);
    expect(Array.isArray(d.allZones)).toBe(true);
  });

  it("response has symbol and mid", async () => {
    const { data } = await get("/api/market/liquidity-zones");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("mid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/volume-profile
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/volume-profile", () => {
  it("returns 200 with sufficient bars", async () => {
    const { status } = await get("/api/market/volume-profile");
    expect(status).toBe(200);
  });

  it("response has levels array and poc", async () => {
    const { data } = await get("/api/market/volume-profile");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.levels)).toBe(true);
    expect(d).toHaveProperty("poc");
  });

  it("response has vah and val", async () => {
    const { data } = await get("/api/market/volume-profile");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("vah");
    expect(d).toHaveProperty("val");
  });

  it("returns 400 when getBars returns fewer than 5 bars", async () => {
    const { getBars } = await import("../lib/alpaca");
    vi.mocked(getBars).mockResolvedValueOnce([
      { Open: 42000, High: 42100, Low: 41900, Close: 42050, Volume: 100, Timestamp: new Date().toISOString() },
    ] as any);
    const { status } = await get("/api/market/volume-profile");
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/candle-intelligence
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/candle-intelligence", () => {
  it("returns 200 with bars", async () => {
    const { status } = await get("/api/market/candle-intelligence");
    expect(status).toBe(200);
  });

  it("response has bars array and summary", async () => {
    const { data } = await get("/api/market/candle-intelligence");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.bars)).toBe(true);
    expect(d).toHaveProperty("summary");
  });

  it("bars have imbalance and reversal_score", async () => {
    const { data } = await get("/api/market/candle-intelligence");
    const bars = (data as Record<string, unknown>).bars as Array<Record<string, unknown>>;
    if (bars.length > 0) {
      expect(bars[0]).toHaveProperty("imbalance");
      expect(bars[0]).toHaveProperty("reversal_score");
    }
  });

  it("accepts symbol and timeframe params", async () => {
    const { status } = await get("/api/market/candle-intelligence?symbol=ETHUSD&timeframe=5Min");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/cvd
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/cvd", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/market/cvd");
    expect(status).toBe(200);
  });

  it("response has bars array, regime, cvd_total", async () => {
    const { data } = await get("/api/market/cvd");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.bars)).toBe(true);
    expect(d).toHaveProperty("regime");
    expect(d).toHaveProperty("cvd_total");
  });

  it("regime is a known value", async () => {
    const { data } = await get("/api/market/cvd");
    const d = data as Record<string, unknown>;
    const knownRegimes = ["bull_trend", "bear_trend", "ranging", "bull_exhaustion", "bear_exhaustion", "transitioning"];
    expect(knownRegimes).toContain(d.regime);
  });

  it("accepts timeframe query param", async () => {
    const { status } = await get("/api/market/cvd?timeframe=15Min");
    expect(status).toBe(200);
  });

  it("returns empty bars gracefully when getBars returns empty", async () => {
    const { getBars } = await import("../lib/alpaca");
    vi.mocked(getBars).mockResolvedValueOnce([] as any);
    const { status, data } = await get("/api/market/cvd");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.cvd_total).toBe(0);
  });
});
