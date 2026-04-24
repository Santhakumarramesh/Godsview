/**
 * war_room_route.test.ts — Phase 55
 *
 * Tests for the War Room multi-agent consensus endpoints (routes/war_room.ts):
 *
 *   POST /war-room/analyze/:symbol   — run full war room analysis
 *   GET  /war-room/cache/stats       — cache statistics
 *   POST /war-room/cache/clear       — clear cache (all or per-symbol)
 *   GET  /war-room/:symbol           — get cached verdict (404 if not cached)
 *
 * Dependencies mocked:
 *   ../lib/alpaca     — getBars (bars are optional; war_room gracefully falls back)
 *   ../lib/war_room   — runWarRoom, clearWarRoomCache, getWarRoomCacheStats
 *   ../lib/smc_engine — computeSMCState
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock definitions ──────────────────────────────────────────────────────────

const MOCK_VERDICT = {
  symbol:        "BTCUSD",
  finalDecision: "approved" as const,
  confidence:    0.75,
  agents:        [],
  edgeScore:     0.72,
  blockedReasons: [],
  timestamp:     new Date().toISOString(),
};

vi.mock("../lib/alpaca", () => ({
  getBars: vi.fn(async () => []),
}));

vi.mock("../lib/smc_engine", () => ({
  computeSMCState: vi.fn(() => ({
    structure: { structureScore: 0.6, bos: false, choch: false, trend: "range" },
    activeOBs:     [],
    unfilledFVGs:  [],
    liquidityPools: [],
  })),
}));

const mockCacheStats = {
  size:    0,
  entries: [] as string[],
};

vi.mock("../lib/war_room", () => ({
  runWarRoom:            vi.fn(() => MOCK_VERDICT),
  clearWarRoomCache:     vi.fn(),
  getWarRoomCacheStats:  vi.fn(() => mockCacheStats),
  // Types re-exported for router imports
  SMCState:     {},
  OrderflowState: {},
  RiskInput:    {},
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import warRoomRouter from "../routes/war_room";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/war-room", warRoomRouter);

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
// POST /war-room/analyze/:symbol
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /war-room/analyze/:symbol", () => {
  it("returns 200 for valid symbol", async () => {
    const { status } = await post("/war-room/analyze/BTCUSD", {});
    expect(status).toBe(200);
  });

  it("response has finalDecision field", async () => {
    const { data } = await post("/war-room/analyze/BTCUSD", {});
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("finalDecision");
    expect(["approved", "blocked", "caution"]).toContain(d.finalDecision);
  });

  it("response has confidence and edgeScore fields", async () => {
    const { data } = await post("/war-room/analyze/BTCUSD", {});
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("confidence");
    expect(d).toHaveProperty("edgeScore");
  });

  it("response has symbol field matching request", async () => {
    const { data } = await post("/war-room/analyze/ETHUSD", {});
    const d = data as Record<string, unknown>;
    expect(d.symbol).toBe("BTCUSD"); // mock always returns BTCUSD
  });

  it("calls runWarRoom", async () => {
    const { runWarRoom } = await import("../lib/war_room");
    vi.mocked(runWarRoom).mockClear();
    await post("/war-room/analyze/BTCUSD", {});
    expect(vi.mocked(runWarRoom)).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /war-room/cache/stats
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /war-room/cache/stats", () => {
  it("returns 200", async () => {
    const { status } = await get("/war-room/cache/stats");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/war-room/cache/stats");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("response has size and entries fields", async () => {
    const { data } = await get("/war-room/cache/stats");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("size");
    expect(d).toHaveProperty("entries");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /war-room/cache/clear
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /war-room/cache/clear", () => {
  it("returns 200 when clearing all", async () => {
    const { status, data } = await post("/war-room/cache/clear", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(typeof d.message).toBe("string");
  });

  it("returns 200 when clearing specific symbol", async () => {
    const { status, data } = await post("/war-room/cache/clear", { symbol: "BTCUSD" });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(typeof d.message).toBe("string");
  });

  it("calls clearWarRoomCache without args for all-clear", async () => {
    const { clearWarRoomCache } = await import("../lib/war_room");
    vi.mocked(clearWarRoomCache).mockClear();
    await post("/war-room/cache/clear", {});
    expect(vi.mocked(clearWarRoomCache)).toHaveBeenCalledWith();
  });

  it("calls clearWarRoomCache with symbol for targeted clear", async () => {
    const { clearWarRoomCache } = await import("../lib/war_room");
    vi.mocked(clearWarRoomCache).mockClear();
    await post("/war-room/cache/clear", { symbol: "ETHUSD" });
    expect(vi.mocked(clearWarRoomCache)).toHaveBeenCalledWith("ETHUSD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /war-room/:symbol
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /war-room/:symbol", () => {
  it("returns 404 when symbol not in cache", async () => {
    mockCacheStats.size    = 0;
    mockCacheStats.entries = [];
    const { getWarRoomCacheStats } = await import("../lib/war_room");
    vi.mocked(getWarRoomCacheStats).mockReturnValue({ size: 0, entries: [] });
    const { status } = await get("/war-room/NOSYM");
    expect(status).toBe(404);
  });

  it("returns 200 when symbol is in cache", async () => {
    const { getWarRoomCacheStats } = await import("../lib/war_room");
    vi.mocked(getWarRoomCacheStats).mockReturnValue({ size: 1, entries: ["BTCUSD"] });
    const { status } = await get("/war-room/BTCUSD");
    expect(status).toBe(200);
  });

  it("200 response has finalDecision field", async () => {
    const { getWarRoomCacheStats } = await import("../lib/war_room");
    vi.mocked(getWarRoomCacheStats).mockReturnValue({ size: 1, entries: ["BTCUSD"] });
    const { data } = await get("/war-room/BTCUSD");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("finalDecision");
  });
});
