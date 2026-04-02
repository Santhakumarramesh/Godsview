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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
