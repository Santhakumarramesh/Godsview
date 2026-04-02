/**
 * features_route.test.ts — Phase 55
 *
 * Tests for the feature pipeline endpoints (routes/features.ts):
 *
 *   POST /features/compute   — single feature vector from bars
 *   POST /features/series    — feature vectors for sliding window
 *   GET  /features/indicators — standalone indicator (RSI / session)
 *
 * feature_pipeline functions are pure computation — no external mocking needed.
 * ops_monitor is mocked to avoid side-effect state from markEngineRun/Error.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock ops_monitor (no-op) ──────────────────────────────────────────────────
vi.mock("../lib/ops_monitor", () => ({
  markEngineRun:   vi.fn(),
  markEngineError: vi.fn(),
  getOpsSnapshot:  vi.fn(() => ({})),
  addAlert:        vi.fn(),
  clearOpsAlerts:  vi.fn(),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import featuresRouter from "../routes/features";

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Create N synthetic OHLCV bars */
function makeBars(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    open:      42000 + i,
    high:      42100 + i,
    low:       41900 + i,
    close:     42050 + i,
    volume:    1000 + i,
    timestamp: new Date(Date.now() - (count - i) * 60_000).toISOString(),
  }));
}

const BARS_30 = makeBars(30);
const BARS_50 = makeBars(50);

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/features", featuresRouter);

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

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (path: string)               => httpReq("GET",  path);
const post = (path: string, body: unknown) => httpReq("POST", path, body);

// ─────────────────────────────────────────────────────────────────────────────
// POST /features/compute
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /features/compute", () => {
  it("returns 200 with valid bars and symbol", async () => {
    const { status } = await post("/features/compute", {
      bars:   BARS_30,
      symbol: "BTCUSD",
    });
    expect(status).toBe(200);
  });

  it("response has features object", async () => {
    const { data } = await post("/features/compute", {
      bars:   BARS_30,
      symbol: "BTCUSD",
    });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("features");
    expect(typeof d.features).toBe("object");
  });

  it("response has bars_used and latency_ms", async () => {
    const { data } = await post("/features/compute", {
      bars:   BARS_30,
      symbol: "BTCUSD",
    });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("bars_used");
    expect(d).toHaveProperty("latency_ms");
  });

  it("returns 400 when bars are missing", async () => {
    const { status } = await post("/features/compute", { symbol: "BTCUSD" });
    expect(status).toBe(400);
  });

  it("returns 400 when symbol is missing", async () => {
    const { status } = await post("/features/compute", { bars: BARS_30 });
    expect(status).toBe(400);
  });

  it("returns 400 when bars array is empty", async () => {
    const { status } = await post("/features/compute", { bars: [], symbol: "BTCUSD" });
    expect(status).toBe(400);
  });

  it("accepts timeframe parameter", async () => {
    const { status } = await post("/features/compute", {
      bars:      BARS_30,
      symbol:    "ETHUSD",
      timeframe: "5m",
    });
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /features/series
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /features/series", () => {
  it("returns 200 with 50 bars", async () => {
    const { status } = await post("/features/series", {
      bars:   BARS_50,
      symbol: "BTCUSD",
    });
    expect(status).toBe(200);
  });

  it("response has series array and count", async () => {
    const { data } = await post("/features/series", {
      bars:   BARS_50,
      symbol: "BTCUSD",
    });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("series");
    expect(Array.isArray(d.series)).toBe(true);
    expect(d).toHaveProperty("count");
  });

  it("response has bars_used field", async () => {
    const { data } = await post("/features/series", {
      bars:   BARS_50,
      symbol: "BTCUSD",
    });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("bars_used");
    expect(Number(d.bars_used)).toBe(50);
  });

  it("returns 400 with fewer than 21 bars", async () => {
    const { status } = await post("/features/series", {
      bars:   makeBars(10),
      symbol: "BTCUSD",
    });
    expect(status).toBe(400);
  });

  it("returns 400 when bars are missing", async () => {
    const { status } = await post("/features/series", { symbol: "BTCUSD" });
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /features/indicators
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /features/indicators", () => {
  it("returns 200 for RSI indicator", async () => {
    const values = Array.from({ length: 20 }, (_, i) => 42000 + i).join(",");
    const { status } = await get(`/features/indicators?type=rsi&values=${values}&period=14`);
    expect(status).toBe(200);
  });

  it("RSI response has indicator and value fields", async () => {
    const values = Array.from({ length: 20 }, (_, i) => 42000 + i).join(",");
    const { data } = await get(`/features/indicators?type=rsi&values=${values}`);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("indicator");
    expect(d).toHaveProperty("value");
    expect(d.indicator).toBe("rsi");
  });

  it("returns 200 for session indicator", async () => {
    const { status } = await get(`/features/indicators?type=session&values=42000`);
    expect(status).toBe(200);
  });

  it("session response has value field", async () => {
    const { data } = await get(`/features/indicators?type=session&values=42000`);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("value");
    expect(typeof d.value).toBe("string");
  });

  it("returns 400 for unknown indicator type", async () => {
    const { status } = await get(`/features/indicators?type=unknown&values=42000`);
    expect(status).toBe(400);
  });

  it("returns 400 when type is missing", async () => {
    const { status } = await get(`/features/indicators?values=42000`);
    expect(status).toBe(400);
  });

  it("returns 400 when values is missing", async () => {
    const { status } = await get(`/features/indicators?type=rsi`);
    expect(status).toBe(400);
  });
});
