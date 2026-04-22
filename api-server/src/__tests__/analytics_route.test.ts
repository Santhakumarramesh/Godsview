/**
 * analytics_route.test.ts — Phase 51
 *
 * Tests for all 10 analytics endpoints:
 *
 *  Equity:
 *   GET  /api/analytics/equity             — full report
 *   GET  /api/analytics/metrics            — metrics only
 *   GET  /api/analytics/equity/curve       — equity curve array
 *  Breakdowns:
 *   GET  /api/analytics/breakdown/setup    — per-setup stats
 *   GET  /api/analytics/breakdown/symbol   — per-symbol stats
 *   GET  /api/analytics/breakdown/regime   — per-regime stats
 *  Circuit Breaker (pure in-memory):
 *   GET  /api/analytics/circuit-breaker          — status
 *   POST /api/analytics/circuit-breaker/check    — force evaluation
 *   POST /api/analytics/circuit-breaker/reset    — manual reset
 *   POST /api/analytics/circuit-breaker/trip     — manual halt
 *   GET  /api/analytics/circuit-breaker/history  — trip history
 *
 * No mocking needed — equity_engine and circuit_breaker are pure in-memory.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import analyticsRouter from "../routes/analytics";
import { resetCircuitBreaker } from "../lib/circuit_breaker";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", analyticsRouter);

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

beforeEach(() => {
  // Reset circuit breaker between tests so state doesn't bleed
  resetCircuitBreaker();
});

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const request = http.request(
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
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const get  = (path: string) => httpReq("GET", path);
const post = (path: string, body?: unknown) => httpReq("POST", path, body ?? {});

// ─────────────────────────────────────────────────────────────────────────────
// Equity endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/analytics/equity", () => {
  it("returns 200 with report object", async () => {
    const { status, data } = await get("/api/analytics/equity");
    expect(status).toBe(200);
    expect((data as Record<string, unknown>)).toHaveProperty("report");
  });

  it("report has metrics and generatedAt", async () => {
    const { data } = await get("/api/analytics/equity");
    const report = (data as Record<string, unknown>).report as Record<string, unknown>;
    expect(report).toHaveProperty("metrics");
    expect(report).toHaveProperty("generatedAt");
    expect(() => new Date(report.generatedAt as string)).not.toThrow();
  });

  it("report has equityCurve array", async () => {
    const { data } = await get("/api/analytics/equity");
    const report = (data as Record<string, unknown>).report as Record<string, unknown>;
    expect(report).toHaveProperty("equityCurve");
    expect(Array.isArray(report.equityCurve)).toBe(true);
  });

  it("accepts optional symbol query param", async () => {
    const { status } = await get("/api/analytics/equity?symbol=BTCUSD");
    expect(status).toBe(200);
  });

  it("accepts optional from/to date params", async () => {
    const { status } = await get("/api/analytics/equity?from=2025-01-01&to=2025-12-31");
    expect(status).toBe(200);
  });
});

describe("GET /api/analytics/metrics", () => {
  it("returns 200 with metrics and generatedAt", async () => {
    const { status, data } = await get("/api/analytics/metrics");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("metrics");
    expect(d).toHaveProperty("generatedAt");
  });

  it("metrics object has expected fields", async () => {
    const { data } = await get("/api/analytics/metrics");
    const metrics = (data as Record<string, unknown>).metrics as Record<string, unknown>;
    // Equity engine always returns a metrics object with these keys
    expect(metrics).toHaveProperty("totalTrades");
    expect(metrics).toHaveProperty("winRate");
    expect(metrics).toHaveProperty("profitFactor");
    expect(metrics).toHaveProperty("totalPnlPct");
  });

  it("winRate is between 0 and 1", async () => {
    const { data } = await get("/api/analytics/metrics");
    const winRate = ((data as Record<string, unknown>).metrics as Record<string, unknown>).winRate as number;
    expect(winRate).toBeGreaterThanOrEqual(0);
    expect(winRate).toBeLessThanOrEqual(1);
  });
});

describe("GET /api/analytics/equity/curve", () => {
  it("returns 200 with curve array and count", async () => {
    const { status, data } = await get("/api/analytics/equity/curve");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("curve");
    expect(d).toHaveProperty("count");
    expect(d).toHaveProperty("generatedAt");
    expect(Array.isArray(d.curve)).toBe(true);
    expect(typeof d.count).toBe("number");
  });

  it("count equals curve.length", async () => {
    const { data } = await get("/api/analytics/equity/curve");
    const d = data as Record<string, unknown>;
    expect(d.count).toBe((d.curve as unknown[]).length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Breakdown endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/analytics/breakdown/setup", () => {
  it("returns 200 with bySetup map and generatedAt", async () => {
    const { status, data } = await get("/api/analytics/breakdown/setup");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("bySetup");
    expect(d).toHaveProperty("generatedAt");
    expect(typeof d.bySetup).toBe("object");
  });
});

describe("GET /api/analytics/breakdown/symbol", () => {
  it("returns 200 with bySymbol map and generatedAt", async () => {
    const { status, data } = await get("/api/analytics/breakdown/symbol");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("bySymbol");
    expect(d).toHaveProperty("generatedAt");
  });
});

describe("GET /api/analytics/breakdown/regime", () => {
  it("returns 200 with byRegime map and generatedAt", async () => {
    const { status, data } = await get("/api/analytics/breakdown/regime");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("byRegime");
    expect(d).toHaveProperty("generatedAt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/analytics/circuit-breaker", () => {
  it("returns 200 with status object", async () => {
    const { status, data } = await get("/api/analytics/circuit-breaker");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("status");
    const cbStatus = d.status as Record<string, unknown>;
    // CircuitBreakerSnapshot has breaker, rateLimiter, killSwitch, tradingAllowed
    expect(cbStatus).toHaveProperty("breaker");
    expect(cbStatus).toHaveProperty("tradingAllowed");
    expect(typeof cbStatus.tradingAllowed).toBe("boolean");
  });

  it("starts with armed=false after reset", async () => {
    const { data } = await get("/api/analytics/circuit-breaker");
    const cbStatus = (data as Record<string, unknown>).status as Record<string, unknown>;
    // After reset, breaker.state should be CLOSED
    const breaker = cbStatus.breaker as Record<string, unknown>;
    expect(breaker.state).toBe("CLOSED");
  });
});

describe("POST /api/analytics/circuit-breaker/check", () => {
  it("returns 200 with status object", async () => {
    const { status, data } = await post("/api/analytics/circuit-breaker/check");
    expect(status).toBe(200);
    expect((data as Record<string, unknown>)).toHaveProperty("status");
  });
});

describe("POST /api/analytics/circuit-breaker/reset", () => {
  it("returns 200 with status and reset:true", async () => {
    const { status, data } = await post("/api/analytics/circuit-breaker/reset");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    // resetCircuitBreaker() now returns void, not status
    // The endpoint returns { reset: true }
    expect(d.reset).toBe(true);
  });

  it("leaves breaker in non-tripped state", async () => {
    // Trip the breaker first
    await post("/api/analytics/circuit-breaker/trip", { reason: "test_trip" });
    // Then reset
    await post("/api/analytics/circuit-breaker/reset");
    // Verify not armed (breaker.state should be CLOSED)
    const { data } = await get("/api/analytics/circuit-breaker");
    const cbStatus = (data as Record<string, unknown>).status as Record<string, unknown>;
    const breaker = cbStatus.breaker as Record<string, unknown>;
    expect(breaker.state).toBe("CLOSED");
  });
});

describe("POST /api/analytics/circuit-breaker/trip", () => {
  it("returns 200 with status and tripped:true", async () => {
    const { status, data } = await post("/api/analytics/circuit-breaker/trip", { reason: "test_halt" });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("status");
    expect(d.tripped).toBe(true);
    // Clean up
    await post("/api/analytics/circuit-breaker/reset");
  });

  it("GET /circuit-breaker reflects armed state", async () => {
    await post("/api/analytics/circuit-breaker/trip", { reason: "state_test" });
    const { data } = await get("/api/analytics/circuit-breaker");
    const cbStatus = (data as Record<string, unknown>).status as Record<string, unknown>;
    const breaker = cbStatus.breaker as Record<string, unknown>;
    // After trip, breaker.state should be OPEN
    expect(breaker.state).toBe("OPEN");
    await post("/api/analytics/circuit-breaker/reset");
  });

  it("uses default reason when omitted", async () => {
    const { status } = await post("/api/analytics/circuit-breaker/trip");
    expect(status).toBe(200);
    await post("/api/analytics/circuit-breaker/reset");
  });
});

describe("GET /api/analytics/circuit-breaker/history", () => {
  it("returns 200 with history array and count", async () => {
    const { status, data } = await get("/api/analytics/circuit-breaker/history");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    // getTripHistory() returns { totalTrips, lastTrip, lastReason }
    expect(d).toHaveProperty("count");
    expect(typeof d.count).toBe("number");
  });

  it("records a trip in history after tripping", async () => {
    await post("/api/analytics/circuit-breaker/trip", { reason: "history_test" });
    const { data } = await get("/api/analytics/circuit-breaker/history");
    const d = data as Record<string, unknown>;
    // count should be > 0 after a trip
    expect(d.count).toBeGreaterThan(0);
    await post("/api/analytics/circuit-breaker/reset");
  });
});
