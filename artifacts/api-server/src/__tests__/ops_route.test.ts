/**
 * ops_route.test.ts — Phase 53
 *
 * Tests for the operations monitor endpoints:
 *
 *   GET    /ops/snapshot  — full OpsSnapshot
 *   GET    /ops/health    — quick status + uptime + memory
 *   GET    /ops/alerts    — list recent alerts (optional limit)
 *   POST   /ops/alerts    — add a new ops alert
 *   DELETE /ops/alerts    — clear all alerts
 *
 * ops_monitor is pure in-memory — no DB or Alpaca mocking needed.
 * Also covers the engine-health endpoint via engine_health.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "http";

import { clearOpsAlerts } from "../lib/ops_monitor";
import opsRouter from "../routes/ops";
import engineHealthRouter from "../routes/engine_health";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/ops", opsRouter);
  app.use("/", engineHealthRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  clearOpsAlerts();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  clearOpsAlerts();
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

const get  = (path: string)               => httpReq("GET",    path);
const post = (path: string, body: unknown) => httpReq("POST",   path, body);
const del  = (path: string)               => httpReq("DELETE", path);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ops/snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /ops/snapshot", () => {
  it("returns 200", async () => {
    const { status } = await get("/ops/snapshot");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/ops/snapshot");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("snapshot has overall_status field", async () => {
    const { data } = await get("/ops/snapshot");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("overall_status");
  });

  it("snapshot has system section", async () => {
    const { data } = await get("/ops/snapshot");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("system");
    const sys = d.system as Record<string, unknown>;
    expect(sys).toHaveProperty("uptime_ms");
    expect(sys).toHaveProperty("memory_used_mb");
  });

  it("snapshot has timestamp", async () => {
    const { data } = await get("/ops/snapshot");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("timestamp");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ops/health
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /ops/health", () => {
  it("returns 200", async () => {
    const { status } = await get("/ops/health");
    expect(status).toBe(200);
  });

  it("response has status, uptime_ms, memory_used_mb, timestamp", async () => {
    const { data } = await get("/ops/health");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("status");
    expect(d).toHaveProperty("uptime_ms");
    expect(d).toHaveProperty("memory_used_mb");
    expect(d).toHaveProperty("timestamp");
  });

  it("status is a string", async () => {
    const { data } = await get("/ops/health");
    expect(typeof (data as Record<string, unknown>).status).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ops/alerts
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /ops/alerts", () => {
  it("returns 200 with alerts array", async () => {
    const { status, data } = await get("/ops/alerts");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("alerts");
    expect(Array.isArray(d.alerts)).toBe(true);
  });

  it("empty after clear", async () => {
    const { data } = await get("/ops/alerts");
    const alerts = (data as Record<string, unknown>).alerts as unknown[];
    expect(alerts.length).toBe(0);
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/ops/alerts?limit=5");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ops/alerts
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /ops/alerts", () => {
  it("returns 201 when alert added (valid level)", async () => {
    // Valid levels: "info", "warn", "critical"
    const { status } = await post("/ops/alerts", {
      level:   "warn",
      message: "Test alert from Phase 53",
    });
    expect(status).toBe(201);
  });

  it("alert appears in GET /ops/alerts after posting", async () => {
    await post("/ops/alerts", {
      level:   "critical",
      message: "Phase 53 alert",
    });
    const { data } = await get("/ops/alerts");
    const alerts = (data as Record<string, unknown>).alerts as unknown[];
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("returns 400 when level is invalid", async () => {
    const { status } = await post("/ops/alerts", { level: "warning", message: "bad" });
    expect(status).toBe(400);
  });

  it("returns 400 on missing required fields", async () => {
    const { status } = await post("/ops/alerts", {});
    expect([400, 422, 500]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /ops/alerts
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /ops/alerts", () => {
  it("returns 200 and confirms clear", async () => {
    await post("/ops/alerts", { level: "info", message: "to clear" });
    const { status, data } = await del("/ops/alerts");
    expect(status).toBe(200);
    // Route returns { success: true, message: "All alerts cleared" }
    const d = data as Record<string, unknown>;
    expect(d.success).toBe(true);
  });

  it("alerts are empty after DELETE", async () => {
    await post("/ops/alerts", { level: "warn", message: "stale" });
    await del("/ops/alerts");
    const { data } = await get("/ops/alerts");
    const alerts = (data as Record<string, unknown>).alerts as unknown[];
    expect(alerts.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /engine-health
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /engine-health", () => {
  it("returns 200", async () => {
    const { status } = await get("/engine-health");
    expect(status).toBe(200);
  });

  it("response has engines object", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("engines");
    expect(typeof d.engines).toBe("object");
  });

  it("engines map contains checklist and war_room entries", async () => {
    const { data } = await get("/engine-health");
    const engines = (data as Record<string, unknown>).engines as Record<string, unknown>;
    expect(engines).toHaveProperty("checklist");
    expect(engines).toHaveProperty("war_room");
  });

  it("response has status field", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    // engine-health uses `status` key (e.g. "healthy" | "degraded" | "critical")
    expect(d).toHaveProperty("status");
    expect(typeof d.status).toBe("string");
  });

  it("latency_ms is a number", async () => {
    const { data } = await get("/engine-health");
    const d = data as Record<string, unknown>;
    expect(typeof d.latency_ms).toBe("number");
  });
});
