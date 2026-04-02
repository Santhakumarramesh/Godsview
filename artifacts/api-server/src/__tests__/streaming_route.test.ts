/**
 * streaming_route.test.ts — Phase 57
 *
 * Tests for the SSE streaming endpoints (routes/streaming.ts):
 *
 *   GET /api/stream/status     — hub stats (REST, not SSE)
 *
 * SSE endpoints (signals/stream, candles/stream, stream, alerts/stream)
 * are verified to return text/event-stream headers and do NOT close
 * the connection immediately (SSE connections stay open).
 * The test aborts these requests after header receipt to avoid hanging.
 *
 * Dependencies mocked:
 *   ../lib/signal_stream  — signalHub (addClient, removeClient, status, replay)
 *   ../lib/alpaca_stream  — alpacaStream (subscribe, unsubscribe)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/signal_stream", () => ({
  signalHub: {
    addClient:    vi.fn((res: any, _filter?: unknown) => {
      // Set SSE headers and flush so the client sees them
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      res.write(": connected\n\n");
      return "client-mock-id";
    }),
    removeClient: vi.fn(),
    status:       vi.fn(() => ({
      connected_clients: 2,
      events_sent:       150,
      uptime_ms:         60_000,
    })),
    replay:       vi.fn(),
  },
  publishAlert:  vi.fn(),
  publishCandle: vi.fn(),
  addSSEClient:  vi.fn(),
  getSSEClientCount: vi.fn(() => 2),
}));

vi.mock("../lib/alpaca_stream", () => ({
  alpacaStream: {
    subscribe:   vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import streamingRouter from "../routes/streaming";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", streamingRouter);

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

/** Make an SSE request and resolve as soon as headers arrive, then abort. */
function getSseHeaders(path: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: "GET" }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers as any });
      // Destroy to avoid keeping the connection open
      res.destroy();
    });
    req.on("error", (err) => {
      // Ignore ECONNRESET from our own destroy
      if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
      reject(err);
    });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stream/status  (REST)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/stream/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/stream/status");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/api/stream/status");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("response has connected_clients field", async () => {
    const { data } = await get("/api/stream/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("connected_clients");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSE endpoints — verify Content-Type header
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/signals/stream (SSE)", () => {
  it("responds with text/event-stream Content-Type", async () => {
    const { status, headers } = await getSseHeaders("/api/signals/stream");
    expect(status).toBe(200);
    expect(String(headers["content-type"] ?? "")).toContain("text/event-stream");
  });
});

describe("GET /api/stream (SSE)", () => {
  it("responds with text/event-stream Content-Type", async () => {
    const { status, headers } = await getSseHeaders("/api/stream");
    expect(status).toBe(200);
    expect(String(headers["content-type"] ?? "")).toContain("text/event-stream");
  });

  it("accepts filter query param", async () => {
    const { status } = await getSseHeaders("/api/stream?filter=signal,alert");
    expect(status).toBe(200);
  });
});

describe("GET /api/alerts/stream (SSE)", () => {
  it("responds with text/event-stream Content-Type", async () => {
    const { status, headers } = await getSseHeaders("/api/alerts/stream");
    expect(status).toBe(200);
    expect(String(headers["content-type"] ?? "")).toContain("text/event-stream");
  });
});

describe("GET /api/candles/stream (SSE)", () => {
  it("responds with text/event-stream Content-Type", async () => {
    const { status, headers } = await getSseHeaders("/api/candles/stream?symbol=BTCUSD&timeframe=5Min");
    expect(status).toBe(200);
    expect(String(headers["content-type"] ?? "")).toContain("text/event-stream");
  });
});
