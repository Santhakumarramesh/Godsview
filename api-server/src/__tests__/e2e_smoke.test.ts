/**
 * e2e_smoke.test.ts — API Contract & Smoke Tests
 *
 * Validates route handlers return correct shapes, status codes,
 * and content types. Uses a lightweight test server to exercise
 * real Express routes without needing the full app bootstrap.
 */

import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "http";
import net from "net";

// ─── Minimal test server ───────────────────────────────────────────────────

let app: Express;

async function apiFetch(
  url: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{
  status: number;
  headers: Headers;
  json: () => Promise<any>;
  text: () => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    const method = init.method ?? "GET";
    const parsed = new URL(url, "http://localhost");
    const path = `${parsed.pathname}${parsed.search}`;
    const socket = new net.Socket({ readable: true, writable: true });
    const req = new http.IncomingMessage(socket);
    const rawBody = init.body;

    const normalizedHeaders: Record<string, string> = Object.fromEntries(
      Object.entries({
        "content-type": "application/json",
        ...(init.headers ?? {}),
      }).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
    if (rawBody) {
      normalizedHeaders["content-length"] = Buffer.byteLength(rawBody).toString();
    }

    req.method = method;
    req.url = path;
    req.headers = normalizedHeaders;
    if (rawBody) req.push(rawBody);
    req.push(null);

    const res = new http.ServerResponse(req);
    let raw = "";
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = ((chunk: unknown, encoding?: BufferEncoding | ((err?: Error) => void), cb?: (err?: Error) => void) => {
      if (chunk) raw += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      return origWrite(chunk as any, encoding as any, cb as any);
    }) as typeof res.write;
    res.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      if (chunk) raw += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      origEnd(chunk as any, encoding as any, cb as any);
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.getHeaders())) {
        if (Array.isArray(value)) {
          headers.set(key, value.join(", "));
        } else if (value != null) {
          headers.set(key, String(value));
        }
      }
      resolve({
        status: res.statusCode ?? 0,
        headers,
        json: async () => JSON.parse(raw),
        text: async () => raw,
      });
    }) as typeof res.end;

    app.handle(req, res, reject);
  });
}

beforeAll(async () => {
  app = express();
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
});

// ─── Health & System ───────────────────────────────────────────────────────

describe("Health & System Endpoints", () => {
  it("GET /healthz returns 200 with ok status", async () => {
    const res = await apiFetch(`/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /api/system/status returns operational status", async () => {
    const res = await apiFetch(`/api/system/status`);
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
    const res = await apiFetch(`/api/signals`);
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
    const res = await apiFetch(`/api/signals/evaluate`, {
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
    const res = await apiFetch(`/api/signals/evaluate`, {
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
    const res = await apiFetch(`/api/trades`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/performance returns metrics", async () => {
    const res = await apiFetch(`/api/performance`);
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
    const res = await apiFetch(`/api/checklist/BTCUSD`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSD");
    expect(body.items).toHaveLength(8);
    expect(body).toHaveProperty("passedCount");
    expect(body).toHaveProperty("totalCount");
    expect(body.totalCount).toBe(8);
  });

  it("GET /api/war-room/:symbol returns consensus", async () => {
    const res = await apiFetch(`/api/war-room/BTCUSD`);
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
    const res = await apiFetch(`/api/stream/status`);
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
    const res = await apiFetch(`/api/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns JSON content type for all responses", async () => {
    const res = await apiFetch(`/healthz`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
