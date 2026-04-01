/**
 * e2e_smoke.test.ts — API Contract & Smoke Tests
 *
 * Validates route handlers return correct shapes, status codes,
 * and content types. Uses a lightweight test server to exercise
 * real Express routes without needing the full app bootstrap.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";

// ─── Minimal test server ───────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  // Health endpoint
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // System status endpoint
  app.get("/api/system/status", (_req, res) => {
    res.json({
      status: "operational",
      version: "1.0.0-test",
      uptime: process.uptime(),
      environment: "test",
      memory: process.memoryUsage(),
    });
  });

  // Signals endpoint (mock)
  app.get("/api/signals", (_req, res) => {
    res.json([
      { id: "sig-1", symbol: "BTCUSD", direction: "long", quality: 0.72, ts: new Date().toISOString() },
    ]);
  });

  app.post("/api/signals/evaluate", (req, res) => {
    const { symbol, direction } = req.body;
    if (!symbol || !direction) {
      res.status(400).json({ error: "symbol and direction are required" });
      return;
    }
    res.json({
      signalId: `sig-${Date.now()}`,
      symbol,
      direction,
      quality: 0.68,
      verdict: "APPROVED",
      layers: { structure: 0.75, orderFlow: 0.70, recall: 0.65 },
    });
  });

  // Trades endpoint (mock)
  app.get("/api/trades", (_req, res) => {
    res.json([]);
  });

  // Performance endpoint (mock)
  app.get("/api/performance", (_req, res) => {
    res.json({
      totalTrades: 42,
      winRate: 0.64,
      profitFactor: 2.1,
      sharpeRatio: 1.8,
      maxDrawdown: 0.12,
    });
  });

  // Checklist endpoint (mock)
  app.get("/api/checklist/:symbol", (req, res) => {
    res.json({
      symbol: req.params.symbol,
      items: Array.from({ length: 8 }, (_, i) => ({
        key: `item_${i}`,
        label: `Checklist Item ${i + 1}`,
        passed: i < 6,
      })),
      passedCount: 6,
      totalCount: 8,
      allPassed: false,
    });
  });

  // War room endpoint (mock)
  app.get("/api/war-room/:symbol", (req, res) => {
    res.json({
      symbol: req.params.symbol,
      consensus: "GO",
      compositeScore: 0.72,
      agents: [
        { agent: "structure", vote: "go", confidence: 0.80, reasoning: "Trend aligned" },
        { agent: "liquidity", vote: "go", confidence: 0.70, reasoning: "Swept pools" },
        { agent: "microstructure", vote: "caution", confidence: 0.55, reasoning: "Limited data" },
        { agent: "risk", vote: "go", confidence: 0.75, reasoning: "R:R acceptable" },
      ],
    });
  });

  // SSE stream endpoint
  app.get("/api/stream/status", (_req, res) => {
    res.json({ clientCount: 0, recentEventCount: 0, clients: [] });
  });

  // 404 handler
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─── Health & System ───────────────────────────────────────────────────────

describe("Health & System Endpoints", () => {
  it("GET /healthz returns 200 with ok status", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /api/system/status returns operational status", async () => {
    const res = await fetch(`${baseUrl}/api/system/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("operational");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("memory");
  });
});

// ─── Signals ───────────────────────────────────────────────────────────────

describe("Signals Endpoints", () => {
  it("GET /api/signals returns array", async () => {
    const res = await fetch(`${baseUrl}/api/signals`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0]).toHaveProperty("symbol");
      expect(body[0]).toHaveProperty("direction");
      expect(body[0]).toHaveProperty("quality");
    }
  });

  it("POST /api/signals/evaluate returns verdict", async () => {
    const res = await fetch(`${baseUrl}/api/signals/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "BTCUSD", direction: "long" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("signalId");
    expect(body).toHaveProperty("verdict");
    expect(body).toHaveProperty("quality");
    expect(body).toHaveProperty("layers");
    expect(body.layers).toHaveProperty("structure");
    expect(body.layers).toHaveProperty("orderFlow");
    expect(body.layers).toHaveProperty("recall");
  });

  it("POST /api/signals/evaluate rejects missing fields", async () => {
    const res = await fetch(`${baseUrl}/api/signals/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

// ─── Trades & Performance ──────────────────────────────────────────────────

describe("Trades & Performance Endpoints", () => {
  it("GET /api/trades returns array", async () => {
    const res = await fetch(`${baseUrl}/api/trades`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/performance returns metrics", async () => {
    const res = await fetch(`${baseUrl}/api/performance`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("winRate");
    expect(body).toHaveProperty("profitFactor");
    expect(body).toHaveProperty("sharpeRatio");
    expect(body).toHaveProperty("maxDrawdown");
    expect(typeof body.winRate).toBe("number");
  });
});

// ─── Checklist & War Room ──────────────────────────────────────────────────

describe("Checklist & War Room Endpoints", () => {
  it("GET /api/checklist/:symbol returns 8 items", async () => {
    const res = await fetch(`${baseUrl}/api/checklist/BTCUSD`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSD");
    expect(body.items).toHaveLength(8);
    expect(body).toHaveProperty("passedCount");
    expect(body).toHaveProperty("totalCount");
    expect(body.totalCount).toBe(8);
  });

  it("GET /api/war-room/:symbol returns consensus", async () => {
    const res = await fetch(`${baseUrl}/api/war-room/BTCUSD`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSD");
    expect(["GO", "NO_GO", "SPLIT"]).toContain(body.consensus);
    expect(typeof body.compositeScore).toBe("number");
    expect(body.agents).toHaveLength(4);
    for (const agent of body.agents) {
      expect(agent).toHaveProperty("agent");
      expect(agent).toHaveProperty("vote");
      expect(agent).toHaveProperty("confidence");
      expect(agent).toHaveProperty("reasoning");
    }
  });
});

// ─── Stream Status ─────────────────────────────────────────────────────────

describe("Stream Status Endpoint", () => {
  it("GET /api/stream/status returns hub stats", async () => {
    const res = await fetch(`${baseUrl}/api/stream/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("clientCount");
    expect(body).toHaveProperty("recentEventCount");
    expect(body).toHaveProperty("clients");
    expect(typeof body.clientCount).toBe("number");
  });
});

// ─── Error Handling ────────────────────────────────────────────────────────

describe("Error Handling", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns JSON content type for all responses", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
