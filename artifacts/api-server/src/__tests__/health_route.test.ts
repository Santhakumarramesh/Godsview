/**
 * health_route.test.ts — Phase 53
 *
 * Tests for system health and readiness endpoints:
 *
 *   GET /healthz      — liveness probe
 *   GET /readyz       — readiness probe (DB + service checks)
 *   GET /metrics      — Prometheus-format metrics snapshot
 *   GET /degradation  — service degradation snapshot
 *   GET /db-health    — DB-specific health check
 *
 * Heavy dependencies mocked:
 *   @workspace/db (checkDbHealth), ../lib/metrics, ../lib/degradation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    checkDbHealth: vi.fn(async () => ({
      ok: true,
      latencyMs: 2,
    })),
  };
});

vi.mock("../lib/metrics", () => ({
  collectMetrics: vi.fn(() => ({
    requests_total: 100,
    errors_total: 1,
    uptime_seconds: 3600,
    memory_rss_mb: 128,
  })),
}));

vi.mock("../lib/degradation", () => ({
  getDegradationSnapshot: vi.fn(() => ({
    services: { db: "healthy", alpaca: "healthy", macro: "healthy" },
    degradedCount: 0,
    totalCount: 3,
    overall: "healthy",
    checkedAt: new Date().toISOString(),
  })),
}));

const alpacaMocks = vi.hoisted(() => ({
  getAccount: vi.fn(async () => ({ account_number: "paper-123" })),
  getAlpacaCredentialStatus: vi.fn(() => ({
    keyConfigured: false,
    secretConfigured: false,
    keyPrefix: null,
    keyKind: "missing",
    hasValidTradingKey: false,
  })),
  getAlpacaAuthFailureState: vi.fn(() => ({
    active: false,
    remainingMs: 0,
    cooldownMs: 60_000,
    status: null,
    message: null,
    occurredAt: null,
    count: 0,
  })),
}));

vi.mock("../lib/alpaca", () => ({
  getAccount: alpacaMocks.getAccount,
  getAlpacaCredentialStatus: alpacaMocks.getAlpacaCredentialStatus,
  getAlpacaAuthFailureState: alpacaMocks.getAlpacaAuthFailureState,
}));

const orderbookMocks = vi.hoisted(() => ({
  getOrderbookAuthFailureState: vi.fn(() => ({
    active: false,
    remainingMs: 0,
    cooldownMs: 60_000,
    status: null,
    message: null,
    occurredAt: null,
    count: 0,
  })),
}));

vi.mock("../lib/market/orderbook", () => ({
  getOrderbookAuthFailureState: orderbookMocks.getOrderbookAuthFailureState,
}));

const reasoningMocks = vi.hoisted(() => ({
  getReasoningFallbackState: vi.fn(() => ({
    totalFallbacks: 0,
    consecutiveFallbacks: 0,
    lastFallbackAt: null,
    lastError: null,
    lastSymbol: null,
    warnCooldownMs: 30_000,
  })),
}));

vi.mock("../lib/reasoning_engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/reasoning_engine")>();
  return {
    ...original,
    getReasoningFallbackState: reasoningMocks.getReasoningFallbackState,
  };
});

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import healthRouter from "../routes/health";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", healthRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
  alpacaMocks.getAccount.mockReset();
  alpacaMocks.getAccount.mockResolvedValue({ account_number: "paper-123" });
  alpacaMocks.getAlpacaCredentialStatus.mockReset();
  alpacaMocks.getAlpacaCredentialStatus.mockReturnValue({
    keyConfigured: false,
    secretConfigured: false,
    keyPrefix: null,
    keyKind: "missing",
    hasValidTradingKey: false,
  });
  alpacaMocks.getAlpacaAuthFailureState.mockReset();
  alpacaMocks.getAlpacaAuthFailureState.mockReturnValue({
    active: false,
    remainingMs: 0,
    cooldownMs: 60_000,
    status: null,
    message: null,
    occurredAt: null,
    count: 0,
  });
  orderbookMocks.getOrderbookAuthFailureState.mockReset();
  orderbookMocks.getOrderbookAuthFailureState.mockReturnValue({
    active: false,
    remainingMs: 0,
    cooldownMs: 60_000,
    status: null,
    message: null,
    occurredAt: null,
    count: 0,
  });
  reasoningMocks.getReasoningFallbackState.mockReset();
  reasoningMocks.getReasoningFallbackState.mockReturnValue({
    totalFallbacks: 0,
    consecutiveFallbacks: 0,
    lastFallbackAt: null,
    lastError: null,
    lastSymbol: null,
    warnCooldownMs: 30_000,
  });
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
// GET /healthz
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const { status, data } = await get("/healthz");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.status).toBe("ok");
  });

  it("includes uptime field", async () => {
    const { data } = await get("/healthz");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("uptime");
    expect(typeof d.uptime).toBe("number");
  });

  it("includes startedAt ISO timestamp", async () => {
    const { data } = await get("/healthz");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("startedAt");
    expect(typeof d.startedAt).toBe("string");
  });

  it("includes memoryMB field", async () => {
    const { data } = await get("/healthz");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("memoryMB");
    expect(typeof d.memoryMB).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /readyz
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /readyz", () => {
  it("returns 200 when all checks pass", async () => {
    const { status } = await get("/readyz");
    // 200 = healthy, 503 = degraded
    expect([200, 503]).toContain(status);
  });

  it("response has checks object", async () => {
    const { data } = await get("/readyz");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("checks");
    expect(typeof d.checks).toBe("object");
  });

  it("response has overall status field", async () => {
    const { data } = await get("/readyz");
    const d = data as Record<string, unknown>;
    // Could be 'ok', 'degraded', 'healthy', etc.
    const hasStatusField = "status" in d || "overall" in d || "ready" in d;
    expect(hasStatusField).toBe(true);
  });

  it("database check present in checks", async () => {
    const { data } = await get("/readyz");
    const checks = (data as Record<string, unknown>).checks as Record<string, unknown>;
    expect(checks).toHaveProperty("database");
  });

  it("returns 200 when DB is healthy (mock)", async () => {
    const { status } = await get("/readyz");
    // With mock returning ok:true, should be 200
    expect(status).toBe(200);
  });

  it("returns 503 when DB check fails", async () => {
    const { checkDbHealth } = await import("@workspace/db");
    vi.mocked(checkDbHealth).mockResolvedValueOnce({
      ok: false,
      latencyMs: 0,
      error: "Connection refused",
    } as any);

    const { status } = await get("/readyz");
    expect(status).toBe(503);
  });

  it("marks alpaca as degraded for unsupported key kind", async () => {
    alpacaMocks.getAlpacaCredentialStatus.mockReturnValue({
      keyConfigured: true,
      secretConfigured: true,
      keyPrefix: "CK",
      keyKind: "broker",
      hasValidTradingKey: false,
    });

    const { data } = await get("/readyz");
    const checks = (data as Record<string, any>).checks;

    expect(checks.alpaca.status).toBe("degraded");
    expect(String(checks.alpaca.error)).toMatch(/broker/i);
  });

  it("marks alpaca as degraded when account call returns error payload", async () => {
    alpacaMocks.getAlpacaCredentialStatus.mockReturnValue({
      keyConfigured: true,
      secretConfigured: true,
      keyPrefix: "PK",
      keyKind: "paper",
      hasValidTradingKey: true,
    });
    alpacaMocks.getAccount.mockResolvedValue({
      error: "unauthorized",
      message: "bad credentials",
    });

    const { data } = await get("/readyz");
    const checks = (data as Record<string, any>).checks;

    expect(checks.alpaca.status).toBe("degraded");
    expect(String(checks.alpaca.error)).toMatch(/unauthorized/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /metrics
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /metrics", () => {
  it("returns 200", async () => {
    const { status } = await get("/metrics");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/metrics");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /degradation
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /degradation", () => {
  it("returns 200", async () => {
    const { status } = await get("/degradation");
    expect(status).toBe(200);
  });

  it("response has expected shape", async () => {
    const { data } = await get("/degradation");
    expect(typeof data).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth-failures
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /auth-failures", () => {
  it("returns 200 with alpaca and orderbook auth states", async () => {
    const { status, data } = await get("/auth-failures");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("alpaca");
    expect(d).toHaveProperty("orderbook");
    expect(d).toHaveProperty("generatedAt");
  });

  it("includes active cooldown details when auth failures are present", async () => {
    alpacaMocks.getAlpacaAuthFailureState.mockReturnValueOnce({
      active: true,
      remainingMs: 41_000,
      cooldownMs: 60_000,
      status: 401,
      message: "unauthorized",
      occurredAt: "2026-04-04T00:00:00.000Z",
      count: 3,
    });
    orderbookMocks.getOrderbookAuthFailureState.mockReturnValueOnce({
      active: true,
      remainingMs: 12_000,
      cooldownMs: 60_000,
      status: 401,
      message: "auth failed",
      occurredAt: "2026-04-04T00:00:01.000Z",
      count: 2,
    });

    const { data } = await get("/auth-failures");
    const d = data as Record<string, any>;

    expect(d.alpaca.authFailure.active).toBe(true);
    expect(d.alpaca.authFailure.status).toBe(401);
    expect(d.orderbook.authFailure.active).toBe(true);
    expect(d.orderbook.authFailure.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reasoning-fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /reasoning-fallback", () => {
  it("returns 200 with reasoning fallback state", async () => {
    const { status, data } = await get("/reasoning-fallback");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("claudeConfigured");
    expect(d).toHaveProperty("reasoningFallback");
    expect(d).toHaveProperty("generatedAt");
  });

  it("returns fallback counters and last error fields", async () => {
    reasoningMocks.getReasoningFallbackState.mockReturnValueOnce({
      totalFallbacks: 12,
      consecutiveFallbacks: 3,
      lastFallbackAt: "2026-04-04T00:00:00.000Z",
      lastError: "Claude Timeout",
      lastSymbol: "BTCUSD",
      warnCooldownMs: 30_000,
    });

    const { data } = await get("/reasoning-fallback");
    const d = data as Record<string, any>;
    expect(d.reasoningFallback.totalFallbacks).toBe(12);
    expect(d.reasoningFallback.consecutiveFallbacks).toBe(3);
    expect(d.reasoningFallback.lastError).toMatch(/Timeout/);
    expect(d.reasoningFallback.lastSymbol).toBe("BTCUSD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /db-health
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /db-health", () => {
  it("returns 200 when DB healthy", async () => {
    const { status } = await get("/db-health");
    expect(status).toBe(200);
  });

  it("response contains ok field", async () => {
    const { data } = await get("/db-health");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("ok");
    expect(d.ok).toBe(true);
  });

  it("returns 503 when DB unhealthy", async () => {
    const { checkDbHealth } = await import("@workspace/db");
    vi.mocked(checkDbHealth).mockResolvedValueOnce({
      ok: false,
      latencyMs: 0,
      error: "timeout",
    } as any);

    const { status } = await get("/db-health");
    expect(status).toBe(503);
  });
});
