/**
 * E2E Smoke Tests — verifies critical API endpoints respond correctly
 * without requiring a running database (tests in-memory engines only).
 *
 * These tests import the express app directly and use supertest-like
 * fetch calls. No external dependencies needed beyond vitest.
 */
import { describe, it, expect } from "vitest";

// Use node's built-in fetch against a test server
import { createServer, type Server } from "node:http";
import express from "express";
import { Router } from "express";

// Import engine routes directly
import checklistRouter from "../routes/checklist";
import macroRouter from "../routes/macro";
import portfolioRouter from "../routes/portfolio";
import featuresRouter from "../routes/features";
import engineHealthRouter from "../routes/engine_health";

function createTestApp() {
  const app = express();
  app.use(express.json());
  const r = Router();
  r.use("/api/checklist", checklistRouter);
  r.use("/api/macro", macroRouter);
  r.use("/api/portfolio", portfolioRouter);
  r.use("/api/features", featuresRouter);
  r.use(engineHealthRouter);
  app.use(r);
  return app;
}

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = createTestApp();
  return new Promise((resolve) => {
    server = createServer(app).listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    server?.close(() => resolve());
  });
}

describe("E2E Smoke Tests", () => {
  it("GET /engine-health returns healthy status", async () => {
    await startServer();
    try {
      const res = await fetch(`${baseUrl}/engine-health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("engines");
      expect(body).toHaveProperty("timestamp");
      expect(["healthy", "degraded", "operational"]).toContain(body.status);
    } finally {
      await stopServer();
    }
  });

  it("POST /api/features/compute returns feature vector", async () => {
    await startServer();
    try {
      const bars = Array.from({ length: 30 }, (_, i) => ({
        open: 100 + i * 0.5,
        high: 101 + i * 0.5,
        low: 99 + i * 0.5,
        close: 100.5 + i * 0.5,
        volume: 1000 + i * 10,
        timestamp: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
      }));

      const res = await fetch(`${baseUrl}/api/features/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bars, symbol: "BTCUSD", timeframe: "1m" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.features).toHaveProperty("symbol", "BTCUSD");
      expect(body.features).toHaveProperty("rsi_14");
      expect(body.features).toHaveProperty("atr_14");
      expect(body.bars_used).toBe(30);
    } finally {
      await stopServer();
    }
  });

  it("POST /api/portfolio/compute returns allocations", async () => {
    await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/portfolio/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: [
            { symbol: "BTCUSD", conviction: 0.8, realized_vol: 0.5, sector: "crypto", current_qty: 0, current_price: 67000 },
          ],
          equity: 100000,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("positions");
      expect(body).toHaveProperty("total_allocated_pct");
      expect(body.positions).toHaveLength(1);
    } finally {
      await stopServer();
    }
  });

  it("POST /api/features/compute rejects empty bars", async () => {
    await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/features/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bars: [], symbol: "BTC", timeframe: "1m" }),
      });

      expect(res.status).toBe(400);
    } finally {
      await stopServer();
    }
  });

  it("POST /api/portfolio/compute rejects missing equity", async () => {
    await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/portfolio/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: [] }),
      });

      expect(res.status).toBe(400);
    } finally {
      await stopServer();
    }
  });
});
