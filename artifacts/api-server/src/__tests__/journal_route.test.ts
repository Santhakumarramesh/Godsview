/**
 * journal_route.test.ts — Phase 52
 *
 * Tests for the trade journal HTTP endpoints:
 *
 *   GET    /journal                 — list entries (filterable + paginated)
 *   GET    /journal/stats           — summary stats
 *   GET    /journal/attribution     — attribution report
 *   GET    /journal/attribution/ytw — YTW gate summary
 *   GET    /journal/:id             — single entry
 *   POST   /journal/outcome/:id     — record trade outcome
 *   DELETE /journal                 — clear journal (dev safety gate)
 *
 * trade_journal and attribution_engine are pure in-memory — no DB mock needed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";

import {
  clearJournal,
  recordDecision,
  type JournalEntryCreate,
} from "../lib/trade_journal";

import journalRouter from "../routes/journal";

// ── Minimal fixture factories ─────────────────────────────────────────────────

const MOCK_MACRO_BIAS: JournalEntryCreate["macroBias"] = {
  bias:               "neutral",
  direction:          "neutral",
  score:              0.5,
  conviction:         "low",
  aligned:            true,
  reasons:            [],
  blockedDirections:  [],
  tailwind:           false,
  headwind:           false,
  computedAt:         new Date().toISOString(),
};

const MOCK_SENTIMENT: JournalEntryCreate["sentiment"] = {
  retailBias:         "neutral",
  institutionalEdge:  "none",
  sentimentScore:     0.5,
  crowdingLevel:      "low",
  aligned:            true,
  contrarian:         false,
  reasons:            [],
  updatedAt:          new Date().toISOString(),
};

function makeEntry(overrides: Partial<JournalEntryCreate> = {}): JournalEntryCreate {
  return {
    symbol:      "BTCUSD",
    setupType:   "sweep_reclaim",
    direction:   "long",
    decision:    "passed",
    macroBias:   MOCK_MACRO_BIAS,
    sentiment:   MOCK_SENTIMENT,
    signalPrice: 42000,
    regime:      "trending",
    ...overrides,
  };
}

function seedEntry(overrides: Partial<JournalEntryCreate> = {}) {
  return recordDecision(makeEntry(overrides));
}

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/journal", journalRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  clearJournal();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  clearJournal();
});

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpReq(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
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
          ...headers,
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

const get  = (path: string, hdrs?: Record<string, string>) => httpReq("GET",    path, undefined, hdrs);
const post = (path: string, body: unknown)                 => httpReq("POST",   path, body);
const del  = (path: string, hdrs?: Record<string, string>) => httpReq("DELETE", path, undefined, hdrs);

// ─────────────────────────────────────────────────────────────────────────────
// GET /journal
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /journal", () => {
  it("returns 200 with entries and count when empty", async () => {
    const { status, data } = await get("/journal");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entries");
    expect(d).toHaveProperty("count");
    expect(Array.isArray(d.entries)).toBe(true);
    expect(d.count).toBe(0);
  });

  it("returns seeded entries", async () => {
    seedEntry({ symbol: "BTCUSD" });
    seedEntry({ symbol: "ETHUSD" });
    const { data } = await get("/journal");
    const d = data as Record<string, unknown>;
    expect(Number(d.count)).toBeGreaterThanOrEqual(2);
  });

  it("filters by symbol", async () => {
    seedEntry({ symbol: "BTCUSD" });
    seedEntry({ symbol: "ETHUSD" });
    const { data } = await get("/journal?symbol=BTCUSD");
    const d = data as Record<string, unknown>;
    const entries = d.entries as Array<Record<string, unknown>>;
    entries.forEach((e) => expect(e.symbol).toBe("BTCUSD"));
  });

  it("filters by decision", async () => {
    seedEntry({ decision: "passed" });
    seedEntry({ decision: "blocked" });
    const { data } = await get("/journal?decision=passed");
    const d = data as Record<string, unknown>;
    const entries = d.entries as Array<Record<string, unknown>>;
    entries.forEach((e) => expect(e.decision).toBe("passed"));
  });

  it("respects limit param", async () => {
    for (let i = 0; i < 5; i++) seedEntry();
    const { data } = await get("/journal?limit=2");
    const d = data as Record<string, unknown>;
    const entries = d.entries as unknown[];
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it("count equals entries array length", async () => {
    seedEntry();
    seedEntry();
    const { data } = await get("/journal");
    const d = data as Record<string, unknown>;
    expect(d.count).toBe((d.entries as unknown[]).length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /journal/stats
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /journal/stats", () => {
  it("returns 200 with stats object", async () => {
    const { status, data } = await get("/journal/stats");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("stats");
  });

  it("stats contains expected fields", async () => {
    const { data } = await get("/journal/stats");
    const stats = (data as Record<string, unknown>).stats as Record<string, unknown>;
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("wins");
    expect(stats).toHaveProperty("losses");
  });

  it("stats.total matches seeded entries", async () => {
    seedEntry();
    seedEntry();
    const { data } = await get("/journal/stats");
    const stats = (data as Record<string, unknown>).stats as Record<string, unknown>;
    expect(Number(stats.total)).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /journal/attribution
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /journal/attribution", () => {
  it("returns 200 with report object", async () => {
    const { status, data } = await get("/journal/attribution");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("report");
  });

  it("accepts symbol filter", async () => {
    const { status } = await get("/journal/attribution?symbol=BTCUSD");
    expect(status).toBe(200);
  });

  it("accepts date range filters", async () => {
    const { status } = await get("/journal/attribution?from=2024-01-01&to=2024-12-31");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /journal/attribution/ytw
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /journal/attribution/ytw", () => {
  it("returns 200 with summary object", async () => {
    const { status, data } = await get("/journal/attribution/ytw");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("summary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /journal/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /journal/:id", () => {
  it("returns 200 with entry when found", async () => {
    const entry = seedEntry({ symbol: "BTCUSD" });
    const { status, data } = await get(`/journal/${entry.id}`);
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
    expect((d.entry as Record<string, unknown>).id).toBe(entry.id);
  });

  it("returns 404 for unknown id", async () => {
    const { status } = await get("/journal/does-not-exist-xyz");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /journal/outcome/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /journal/outcome/:id", () => {
  it("returns 200 with updated entry", async () => {
    const entry = seedEntry({ symbol: "BTCUSD" });
    const { status, data } = await post(`/journal/outcome/${entry.id}`, {
      outcome:   "win",
      exitPrice: 43800,
      pnlUsd:    150,
    });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
  });

  it("returns 404 for unknown id", async () => {
    const { status } = await post("/journal/outcome/ghost-id-999", {
      outcome: "loss",
    });
    expect(status).toBe(404);
  });

  it("returns 400 when body is not an object", async () => {
    const entry = seedEntry();
    const { status } = await post(`/journal/outcome/${entry.id}`, "invalid");
    expect([400, 500]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /journal
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /journal", () => {
  it("returns 403 without X-Confirm-Clear header in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { status } = await del("/journal");
      expect(status).toBe(403);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("clears journal in non-production env", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      seedEntry();
      const { status, data } = await del("/journal");
      expect(status).toBe(200);
      expect((data as Record<string, unknown>).cleared).toBe(true);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("clears with X-Confirm-Clear header in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      seedEntry();
      const { status, data } = await del("/journal", { "x-confirm-clear": "yes" });
      expect(status).toBe(200);
      expect((data as Record<string, unknown>).cleared).toBe(true);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
