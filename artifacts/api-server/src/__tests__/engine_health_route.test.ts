/**
 * engine_health_route.test.ts — Phase 56
 *
 * Tests for GET /engine-health (routes/engine_health.ts).
 *
 * Dependencies mocked:
 *   ../lib/ops_monitor   — getOpsSnapshot
 *   ../lib/war_room      — getWarRoomCacheStats
 *   ../lib/macro_engine  — checkNewsLockout, getMacroContext
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mocks (must precede router import) ────────────────────────────────────────

vi.mock("../lib/ops_monitor", () => ({
  getOpsSnapshot: vi.fn(() => ({
    alerts: [],
    engine_status: {
      smc:        { error_count: 0, run_count: 5, last_run_ms: Date.now() },
      features:   { error_count: 0, run_count: 3, last_run_ms: Date.now() },
    },
  })),
  markEngineRun:   vi.fn(),
  markEngineError: vi.fn(),
  addAlert:        vi.fn(),
  clearOpsAlerts:  vi.fn(),
}));

vi.mock("../lib/war_room", () => ({
  getWarRoomCacheStats: vi.fn(() => ({ size: 2, entries: ["BTCUSD", "ETHUSD"] })),
  runWarRoom:           vi.fn(),
  clearWarRoomCache:    vi.fn(),
}));

vi.mock("../lib/macro_engine", () => ({
  checkNewsLockout:  vi.fn(() => false),
  getMacroContext:   vi.fn(() => ({
    lockout_active: false,
    news_count_24h: 3,
    risk_level:     "low",
  })),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import engineHealthRouter from "../routes/engine_health";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", engineHealthRouter);

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
// GET /engine-health
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /engine-health", () => {
  it("returns 200", async () => {
    const { status } = await get("/engine-health");
    expect(status).toBe(200);
  });

  it("response has status field", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("status");
    expect(typeof d.status).toBe("string");
  });

  it("status is one of healthy/degraded/operational", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(["healthy", "degraded", "operational"]).toContain(d.status);
  });

  it("response has engines object", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("engines");
    expect(typeof d.engines).toBe("object");
  });

  it("engines contains war_room and macro keys", async () => {
    const { data } = await get("/engine-health");
    const engines = (data as Record<string, unknown>).engines as Record<string, unknown>;
    expect(engines).toHaveProperty("war_room");
    expect(engines).toHaveProperty("macro");
  });

  it("ops_alerts is an array", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.ops_alerts)).toBe(true);
  });

  it("response has latency_ms and timestamp", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("latency_ms");
    expect(d).toHaveProperty("timestamp");
    expect(typeof d.latency_ms).toBe("number");
  });

  it("returns healthy when no errors in ops_monitor", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    // With mock returning error_count: 0, all engines should be ready → healthy
    expect(d.status).toBe("healthy");
  });

  it("returns degraded when an engine has errors", async () => {
    const { getOpsSnapshot } = await import("../lib/ops_monitor");
    vi.mocked(getOpsSnapshot).mockReturnValueOnce({
      alerts: [],
      engine_status: {
        smc: { error_count: 5, run_count: 5, last_run_ms: Date.now() },
      },
    } as any);
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(d.status).toBe("degraded");
  });
});
