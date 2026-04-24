/**
 * alerts_route.test.ts — Phase 55
 *
 * Tests for the combined alerts + execution route (routes/alerts.ts):
 *
 *   GET  /api/alerts
 *   GET  /api/alerts/active
 *   POST /api/alerts/:ts/ack
 *   GET  /api/execution/mode
 *   GET  /api/execution/gate
 *   GET  /api/execution/session
 *
 * All lib dependencies are mocked so tests are deterministic.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mocks (must precede router import) ────────────────────────────────────────

const MOCK_ALERT = {
  type:         "kill_switch_fired",
  severity:     "critical",
  message:      "Kill switch activated",
  details:      { reason: "test", actor: "test" },
  timestamp:    "2026-04-01T00:00:00.000Z",
  acknowledged: false,
};

vi.mock("../lib/alerts", () => ({
  getAlertHistory:   vi.fn(() => [MOCK_ALERT]),
  getActiveAlerts:   vi.fn(() => [MOCK_ALERT]),
  acknowledgeAlert:  vi.fn((ts: string) => ts === MOCK_ALERT.timestamp),
}));

vi.mock("../lib/order_executor", () => ({
  getExecutionMode: vi.fn(() => ({ mode: "paper", canWrite: false, isLive: false })),
}));

vi.mock("../lib/production_gate", () => ({
  getProductionGateStats: vi.fn(() => ({
    totalChecks: 10,
    passed: 8,
    blocked: 2,
    blockReasons: [],
  })),
}));

vi.mock("../lib/session_guard", () => ({
  getFullSessionStatus: vi.fn(() => ({
    equity:  { open: false, premarket: false, regularHours: false },
    crypto:  { open: true,  premarket: true,  regularHours: true  },
    futures: { open: false, premarket: false, regularHours: false },
  })),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import alertsRouter from "../routes/alerts";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", alertsRouter);

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
// GET /api/alerts
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alerts", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alerts");
    expect(status).toBe(200);
  });

  it("response has alerts array", async () => {
    const { data } = await get("/api/alerts");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("alerts");
    expect(Array.isArray(d.alerts)).toBe(true);
  });

  it("alerts contain expected shape", async () => {
    const { data } = await get("/api/alerts");
    const alerts = (data as Record<string, unknown>).alerts as Array<Record<string, unknown>>;
    expect(alerts.length).toBeGreaterThan(0);
    const a = alerts[0]!;
    expect(a).toHaveProperty("type");
    expect(a).toHaveProperty("severity");
    expect(a).toHaveProperty("timestamp");
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/alerts?limit=10");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts/active
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alerts/active", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alerts/active");
    expect(status).toBe(200);
  });

  it("response has alerts array", async () => {
    const { data } = await get("/api/alerts/active");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("alerts");
    expect(Array.isArray(d.alerts)).toBe(true);
  });

  it("active alerts have acknowledged=false", async () => {
    const { data } = await get("/api/alerts/active");
    const alerts = (data as Record<string, unknown>).alerts as Array<Record<string, unknown>>;
    for (const a of alerts) {
      expect(a.acknowledged).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/alerts/:ts/ack
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/alerts/:ts/ack", () => {
  it("returns 200 with acknowledged=true for known timestamp", async () => {
    const ts = encodeURIComponent(MOCK_ALERT.timestamp);
    const { status, data } = await post(`/api/alerts/${ts}/ack`, {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.acknowledged).toBe(true);
  });

  it("returns 404 for unknown timestamp", async () => {
    const ts = encodeURIComponent("1999-01-01T00:00:00.000Z");
    const { status } = await post(`/api/alerts/${ts}/ack`, {});
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/mode
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/mode", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/execution/mode");
    expect(status).toBe(200);
  });

  it("response has mode field", async () => {
    const { data } = await get("/api/execution/mode");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("mode");
    expect(typeof d.mode).toBe("string");
  });

  it("response has canWrite and isLive fields", async () => {
    const { data } = await get("/api/execution/mode");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("canWrite");
    expect(d).toHaveProperty("isLive");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/gate
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/gate", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/execution/gate");
    expect(status).toBe(200);
  });

  it("response has totalChecks field", async () => {
    const { data } = await get("/api/execution/gate");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("totalChecks");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/session
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/session", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/execution/session");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/api/execution/session");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("response has crypto key", async () => {
    const { data } = await get("/api/execution/session");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("crypto");
  });
});
