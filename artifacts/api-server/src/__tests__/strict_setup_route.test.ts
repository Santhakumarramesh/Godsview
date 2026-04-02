/**
 * strict_setup_route.test.ts — Phase 54
 *
 * Tests for the strict sweep-reclaim setup endpoints:
 *
 *   GET /api/market/strict-setup
 *   GET /api/market/strict-setup/backtest
 *   GET /api/market/strict-setup/report
 *   GET /api/market/strict-setup/promotion-check
 *   GET /api/market/strict-setup/matrix
 *
 * External dependencies mocked:
 *   ../lib/alpaca              (getBars)
 *   ../lib/strict_setup_engine (evaluateStrictSweepReclaim)
 *   ../lib/market/orderbook    (orderBookManager)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Generate N synthetic OHLCV bars going forward from now */
function makeBars(count: number) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    Timestamp: new Date(now - (count - i) * 60_000).toISOString(),
    Open:  42000 + i * 5,
    High:  42100 + i * 5,
    Low:   41900 + i * 5,
    Close: 42050 + i * 5,
    Volume: 100 + i,
    // Alpaca also provides lowercase aliases used in some code paths
    t: new Date(now - (count - i) * 60_000).toISOString(),
    o: 42000 + i * 5,
    h: 42100 + i * 5,
    l: 41900 + i * 5,
    c: 42050 + i * 5,
    v: 100 + i,
  }));
}

const MOCK_BARS = makeBars(320);

vi.mock("../lib/alpaca", () => ({
  getBars:           vi.fn(async () => MOCK_BARS),
  getBarsHistorical: vi.fn(async () => MOCK_BARS),
}));

/** Minimal valid StrictSweepReclaimDecision (detected=false keeps backtest rows empty) */
const MOCK_DECISION = {
  detected:             false,
  tradeAllowed:         false,
  blockedReasons:       [],
  direction:            null,
  entryPrice:           null,
  stopLoss:             null,
  takeProfit:           null,
  riskReward:           null,
  confidenceScore:      0.0,
  expectedWinProbability: 0.5,
  timestamp:            new Date().toISOString(),
  session:              "asian" as const,
  gates: {
    htfBiasAligned:    false,
    liquiditySwept:    false,
    structureShift:    false,
    entryZoneTouched:  false,
    rrMinimumMet:      false,
    sessionValid:      false,
    noNewsLockout:     true,
  },
  diagnostics: {
    regime:            "ranging",
    sweepWickRatio:    0,
    atr:               100,
    volumeRatio:       1.0,
    spreadPct:         0.001,
  },
  orderbook:            null,
};

vi.mock("../lib/strict_setup_engine", () => ({
  evaluateStrictSweepReclaim: vi.fn(() => MOCK_DECISION),
}));

vi.mock("../lib/market/orderbook", () => ({
  orderBookManager: {
    getSnapshot:   vi.fn(() => null),
    fetchSnapshot: vi.fn(async () => null),
  },
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import strictSetupRouter from "../routes/strict_setup";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Inject req.log for routes that call req.log.error
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/api", strictSetupRouter);

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
// GET /api/market/strict-setup
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/strict-setup", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/market/strict-setup");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/api/market/strict-setup");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("response has detected field", async () => {
    const { data } = await get("/api/market/strict-setup");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("detected");
    expect(typeof d.detected).toBe("boolean");
  });

  it("response has tradeAllowed field", async () => {
    const { data } = await get("/api/market/strict-setup");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("tradeAllowed");
  });

  it("response has barsUsed field", async () => {
    const { data } = await get("/api/market/strict-setup");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("barsUsed");
    expect(typeof d.barsUsed).toBe("number");
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/api/market/strict-setup?symbol=ETHUSD");
    expect(status).toBe(200);
  });

  it("response has orderbookTimestamp field", async () => {
    const { data } = await get("/api/market/strict-setup");
    const d = data as Record<string, unknown>;
    // orderbookTimestamp is null when no snapshot available
    expect("orderbookTimestamp" in d).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/strict-setup/backtest
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/strict-setup/backtest", () => {
  // Use distinct symbol params so each test hits a fresh cache key
  it("accepts symbol query param BTCUSD", async () => {
    const { status } = await get("/api/market/strict-setup/backtest?symbol=BTCUSD");
    expect(status).toBe(200);
  });

  it("accepts symbol query param ETHUSD", async () => {
    const { status } = await get("/api/market/strict-setup/backtest?symbol=ETHUSD");
    expect(status).toBe(200);
  });

  it("returns 200 with enough bars (default)", async () => {
    const { status } = await get("/api/market/strict-setup/backtest");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/api/market/strict-setup/backtest");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("response has results or summary field", async () => {
    const { data } = await get("/api/market/strict-setup/backtest");
    const d = data as Record<string, unknown>;
    // Route returns { results, summary, symbol, barsScanned, ... }
    const hasResultOrSummary = "results" in d || "summary" in d;
    expect(hasResultOrSummary).toBe(true);
  });

  it("response has symbol and barsScanned fields", async () => {
    const { data } = await get("/api/market/strict-setup/backtest");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("barsScanned");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/strict-setup/report
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/strict-setup/report", () => {
  it("returns 200 with enough bars", async () => {
    const { status } = await get("/api/market/strict-setup/report");
    expect(status).toBe(200);
  });

  it("response has summary field", async () => {
    const { data } = await get("/api/market/strict-setup/report");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("summary");
    expect(typeof d.summary).toBe("object");
  });

  it("summary has expected metrics", async () => {
    const { data } = await get("/api/market/strict-setup/report");
    const summary = (data as Record<string, unknown>).summary as Record<string, unknown>;
    expect(summary).toHaveProperty("detectedSignals");
    expect(summary).toHaveProperty("winRatePct");
    expect(summary).toHaveProperty("expectancyR");
  });

  it("response has attribution and calibration fields", async () => {
    const { data } = await get("/api/market/strict-setup/report");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("attribution");
    expect(d).toHaveProperty("calibration");
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/api/market/strict-setup/report?symbol=ETHUSD");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/strict-setup/promotion-check
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/strict-setup/promotion-check", () => {
  // Use distinct symbol params so each test hits a fresh cache key (avoids cache pollution)
  it("returns 200 with BTCUSD", async () => {
    const { status } = await get("/api/market/strict-setup/promotion-check?symbol=BTCUSD");
    expect(status).toBe(200);
  });

  it("response has promote field (boolean)", async () => {
    const { data } = await get("/api/market/strict-setup/promotion-check?symbol=BTCUSD");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("promote");
    expect(typeof d.promote).toBe("boolean");
  });

  it("response has decision field (PROMOTE or HOLD)", async () => {
    const { data } = await get("/api/market/strict-setup/promotion-check?symbol=BTCUSD");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("decision");
    expect(["PROMOTE", "HOLD"]).toContain(d.decision);
  });

  it("response has failedChecks array", async () => {
    const { data } = await get("/api/market/strict-setup/promotion-check?symbol=BTCUSD");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("failedChecks");
    expect(Array.isArray(d.failedChecks)).toBe(true);
  });

  it("response has nextActions array", async () => {
    const { data } = await get("/api/market/strict-setup/promotion-check?symbol=BTCUSD");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("nextActions");
    expect(Array.isArray(d.nextActions)).toBe(true);
    expect((d.nextActions as unknown[]).length).toBeGreaterThan(0);
  });

  it("accepts ETHUSD symbol", async () => {
    const { status } = await get("/api/market/strict-setup/promotion-check?symbol=ETHUSD");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/market/strict-setup/matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/market/strict-setup/matrix", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/market/strict-setup/matrix");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/api/market/strict-setup/matrix");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("response has matrix or ranked array", async () => {
    const { data } = await get("/api/market/strict-setup/matrix");
    const d = data as Record<string, unknown>;
    // The matrix route returns { matrix: [...], ranked: [...], ... } or similar
    const hasMatrix = "matrix" in d || "ranked" in d || "results" in d || Array.isArray(d);
    expect(hasMatrix).toBe(true);
  });

  it("accepts symbols query param", async () => {
    const { status } = await get("/api/market/strict-setup/matrix?symbols=BTCUSD,ETHUSD");
    expect(status).toBe(200);
  });
});
