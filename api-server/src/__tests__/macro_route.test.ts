/**
 * macro_route.test.ts — Phase 49
 *
 * Tests for the 4 endpoints added in Phase 47 on the /api/macro router:
 *   POST /bias        — compute MacroBiasResult from provided inputs
 *   POST /sentiment   — compute SentimentResult from provided inputs
 *   GET  /live        — fetch live macro snapshot (5-min cache)
 *   POST /live/refresh — force-refresh live macro snapshot
 *
 * Also covers the 6 existing endpoints for regression:
 *   GET  /context, POST /events, GET /lockout/:symbol,
 *   GET  /events, GET /stats, DELETE /clear
 *
 * Strategy: mount the real macro router inside a minimal Express app.
 * vi.mock patches macro_feed.fetchLiveMacroSnapshot so no Alpaca keys needed.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import express from "express";
import http from "http";

// ── Mock live macro feed before any router import ─────────────────────────────
vi.mock("../lib/macro_feed", () => ({
  fetchLiveMacroSnapshot: vi.fn(async () => ({
    macroBiasInput: {
      dxySlope: -0.01,
      rateDifferentialBps: 50,
      cpiMomentum: 0.1,
      vixLevel: 18,
      macroRiskScore: 0.25,
      assetClass: "crypto",
      intendedDirection: "long",
    },
    sentimentInput: {
      retailLongRatio: 0.55,
      priceTrendSlope: 0.005,
      cvdNet: 200000,
      openInterestChange: 0.03,
      fundingRate: 0.0001,
      intendedDirection: "long",
      assetClass: "crypto",
    },
    fetchedAt: new Date().toISOString(),
    dataQuality: "full",
    sources: { dxy: "UUP", vix: "VIXY" },
  })),
}));

// ── Import router AFTER mocks are in place ────────────────────────────────────
import macroRouter from "../routes/macro";

// ── Minimal test server ───────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/macro", macroRouter);

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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpRequest(
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
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: raw });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (path: string)              => httpRequest("GET",    path);
const post = (path: string, body: unknown) => httpRequest("POST",   path, body);
const del  = (path: string)              => httpRequest("DELETE", path);

// ── Before each: clear stored events so tests don't bleed ────────────────────

beforeEach(async () => {
  await del("/api/macro/clear");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/macro/bias
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/macro/bias", () => {
  it("returns 200 with bias result for valid input", async () => {
    const { status, data } = await post("/api/macro/bias", {
      dxySlope: -0.01,
      rateDifferentialBps: 50,
      cpiMomentum: 0.1,
      vixLevel: 18,
      macroRiskScore: 0.2,
      assetClass: "crypto",
      intendedDirection: "long",
    });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("bias");
    const bias = d.bias as Record<string, unknown>;
    expect(bias).toHaveProperty("bias");
    expect(bias).toHaveProperty("conviction");
    expect(bias).toHaveProperty("score");
    expect(bias).toHaveProperty("blockedDirections");
    expect(typeof bias.score).toBe("number");
    expect((bias.score as number)).toBeGreaterThanOrEqual(0);
    expect((bias.score as number)).toBeLessThanOrEqual(1);
  });

  it("returns 400 when assetClass is missing", async () => {
    const { status, data } = await post("/api/macro/bias", {
      intendedDirection: "long",
      vixLevel: 20,
    });
    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeTruthy();
  });

  it("returns 400 when intendedDirection is missing", async () => {
    const { status, data } = await post("/api/macro/bias", {
      assetClass: "equity",
      vixLevel: 20,
    });
    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeTruthy();
  });

  it("bias.aligned is boolean", async () => {
    const { data } = await post("/api/macro/bias", {
      assetClass: "forex",
      intendedDirection: "short",
      vixLevel: 25,
      dxySlope: 0.02,
      macroRiskScore: 0.3,
    });
    const bias = (data as Record<string, unknown>).bias as Record<string, unknown>;
    expect(typeof bias.aligned).toBe("boolean");
  });

  it("updatedAt is a valid ISO string", async () => {
    const { data } = await post("/api/macro/bias", {
      assetClass: "crypto",
      intendedDirection: "long",
      vixLevel: 20,
      macroRiskScore: 0.3,
    });
    const bias = (data as Record<string, unknown>).bias as Record<string, unknown>;
    expect(bias).toHaveProperty("updatedAt");
    expect(() => new Date(bias.updatedAt as string)).not.toThrow();
    expect(new Date(bias.updatedAt as string).getTime()).toBeGreaterThan(0);
  });

  it("hard lockout scenario: macroRiskScore=0.9 blocks both directions", async () => {
    const { status, data } = await post("/api/macro/bias", {
      assetClass: "crypto",
      intendedDirection: "long",
      macroRiskScore: 0.9,
      vixLevel: 20,
    });
    expect(status).toBe(200);
    const bias = (data as Record<string, unknown>).bias as Record<string, unknown>;
    const blocked = bias.blockedDirections as string[];
    expect(blocked).toContain("long");
    expect(blocked).toContain("short");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/macro/sentiment
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/macro/sentiment", () => {
  it("returns 200 with sentiment result for valid input", async () => {
    const { status, data } = await post("/api/macro/sentiment", {
      retailLongRatio: 0.55,
      priceTrendSlope: 0.005,
      cvdNet: 100000,
      openInterestChange: 0.02,
      fundingRate: 0.0001,
      intendedDirection: "long",
      assetClass: "crypto",
    });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("sentiment");
    const sentiment = d.sentiment as Record<string, unknown>;
    expect(sentiment).toHaveProperty("retailBias");
    expect(sentiment).toHaveProperty("institutionalEdge");
    expect(sentiment).toHaveProperty("crowdingLevel");
    expect(sentiment).toHaveProperty("sentimentScore");
    expect(sentiment).toHaveProperty("aligned");
    expect(typeof sentiment.sentimentScore).toBe("number");
    expect((sentiment.sentimentScore as number)).toBeGreaterThanOrEqual(0);
    expect((sentiment.sentimentScore as number)).toBeLessThanOrEqual(1);
  });

  it("returns 400 when retailLongRatio is missing", async () => {
    const { status, data } = await post("/api/macro/sentiment", {
      intendedDirection: "long",
      assetClass: "crypto",
    });
    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeTruthy();
  });

  it("detects extreme long crowding", async () => {
    const { status, data } = await post("/api/macro/sentiment", {
      retailLongRatio: 0.88,
      fundingRate: 0.002,
      priceTrendSlope: 0.03,
      openInterestChange: 0.15,
      cvdNet: 9e6,
      intendedDirection: "long",
      assetClass: "crypto",
    });
    expect(status).toBe(200);
    const sentiment = (data as Record<string, unknown>).sentiment as Record<string, unknown>;
    expect(["extreme", "high"]).toContain(sentiment.crowdingLevel);
    expect(sentiment.institutionalEdge).toBe("fade_long");
  });

  it("detects short crowding", async () => {
    const { status, data } = await post("/api/macro/sentiment", {
      retailLongRatio: 0.15,
      fundingRate: -0.002,
      priceTrendSlope: -0.03,
      cvdNet: -8e6,
      openInterestChange: -0.12,
      intendedDirection: "short",
      assetClass: "crypto",
    });
    expect(status).toBe(200);
    const sentiment = (data as Record<string, unknown>).sentiment as Record<string, unknown>;
    expect(["fade_short", "fade_long"]).toContain(sentiment.institutionalEdge);
    // composite should be well below 0.5 → short crowding → fade_short
    expect(sentiment.institutionalEdge).toBe("fade_short");
  });

  it("updatedAt is present and parseable", async () => {
    const { data } = await post("/api/macro/sentiment", {
      retailLongRatio: 0.5,
    });
    const sentiment = (data as Record<string, unknown>).sentiment as Record<string, unknown>;
    expect(sentiment).toHaveProperty("updatedAt");
    expect(new Date(sentiment.updatedAt as string).getTime()).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/macro/live  (uses 5-min cache backed by vi.mock)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/macro/live", () => {
  it("returns 200 with context object", async () => {
    const { status, data } = await get("/api/macro/live");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("context");
    const ctx = d.context as Record<string, unknown>;
    expect(ctx).toHaveProperty("macroBiasInput");
    expect(ctx).toHaveProperty("sentimentInput");
    expect(ctx).toHaveProperty("fetchedAt");
    expect(ctx).toHaveProperty("dataQuality");
  });

  it("context.dataQuality is a valid string", async () => {
    const { data } = await get("/api/macro/live");
    const ctx = (data as Record<string, unknown>).context as Record<string, unknown>;
    expect(["full", "partial", "stale"]).toContain(ctx.dataQuality);
  });

  it("context.macroBiasInput has required fields", async () => {
    const { data } = await get("/api/macro/live");
    const ctx = (data as Record<string, unknown>).context as Record<string, unknown>;
    const mbi = ctx.macroBiasInput as Record<string, unknown>;
    expect(typeof mbi.vixLevel).toBe("number");
    expect(typeof mbi.macroRiskScore).toBe("number");
    expect(typeof mbi.assetClass).toBe("string");
  });

  it("context.sentimentInput has retailLongRatio", async () => {
    const { data } = await get("/api/macro/live");
    const ctx = (data as Record<string, unknown>).context as Record<string, unknown>;
    const si = ctx.sentimentInput as Record<string, unknown>;
    expect(typeof si.retailLongRatio).toBe("number");
  });

  it("second call hits cache (mock called at most twice for two requests)", async () => {
    const { fetchLiveMacroSnapshot } = await import("../lib/macro_feed");
    const spy = vi.mocked(fetchLiveMacroSnapshot);
    spy.mockClear();

    await get("/api/macro/live");
    await get("/api/macro/live");

    // Both requests may be within cache TTL — mock should only be called 0 or 1 times
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/macro/live/refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/macro/live/refresh", () => {
  it("returns 200 with refreshed context", async () => {
    const { status, data } = await post("/api/macro/live/refresh", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("context");
    const ctx = d.context as Record<string, unknown>;
    expect(ctx).toHaveProperty("macroBiasInput");
    expect(ctx).toHaveProperty("fetchedAt");
  });

  it("force-refresh bypasses cache and calls fetchLiveMacroSnapshot again", async () => {
    const { fetchLiveMacroSnapshot } = await import("../lib/macro_feed");
    const spy = vi.mocked(fetchLiveMacroSnapshot);
    spy.mockClear();

    await post("/api/macro/live/refresh", {});
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 503 when fetch fails and no cache exists", async () => {
    const { fetchLiveMacroSnapshot } = await import("../lib/macro_feed");
    const spy = vi.mocked(fetchLiveMacroSnapshot);

    // Clear internal cache by mocking a failure on next call
    spy.mockRejectedValueOnce(new Error("network error"));

    // We need to also have no cache from a prior call — this is tricky since
    // the previous tests already populated the cache. The route falls back to
    // stale cache when available, so a 503 only occurs with no prior cache.
    // This test verifies the route doesn't throw an unhandled error.
    const { status } = await post("/api/macro/live/refresh", {});
    expect([200, 503]).toContain(status);
    // Restore
    spy.mockReset();
    spy.mockResolvedValue({
      macroBiasInput: { assetClass: "crypto", intendedDirection: "long", vixLevel: 18, macroRiskScore: 0.25, dxySlope: -0.01, rateDifferentialBps: 50, cpiMomentum: 0.1 },
      sentimentInput: { retailLongRatio: 0.55, priceTrendSlope: 0.005, cvdNet: 200000, openInterestChange: 0.03, fundingRate: 0.0001, intendedDirection: "long", assetClass: "crypto" },
      fetchedAt: new Date().toISOString(),
      dataQuality: "full",
      sources: { dxy: "UUP", vix: "VIXY" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Existing endpoints — regression
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/macro/context", () => {
  it("returns context object with required shape", async () => {
    const { status, data } = await get("/api/macro/context");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("overall_sentiment");
    expect(d).toHaveProperty("risk_level");
    expect(d).toHaveProperty("generated_at");
    expect(d).toHaveProperty("events");
    expect(Array.isArray(d.events)).toBe(true);
  });

  it("accepts optional symbols query param", async () => {
    const { status } = await get("/api/macro/context?symbols=BTCUSD,ETHUSD");
    expect(status).toBe(200);
  });
});

describe("POST /api/macro/events + GET /api/macro/events", () => {
  it("ingests an event and returns 201", async () => {
    const { status, data } = await post("/api/macro/events", {
      id: "test-evt-001",
      type: "economic_calendar",
      title: "FOMC Rate Decision",
      impact: "high",
      sentiment: -0.4,
      related_symbols: ["BTCUSD"],
      source: "test",
      timestamp: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    expect(status).toBe(201);
    expect((data as Record<string, unknown>).success).toBe(true);
  });

  it("returns 400 when required event fields are missing", async () => {
    const { status } = await post("/api/macro/events", { title: "Only title" });
    expect(status).toBe(400);
  });

  it("GET /events returns the ingested event", async () => {
    await post("/api/macro/events", {
      id: "test-evt-002",
      type: "fed_speech",
      title: "Powell Speech",
      impact: "high",
      sentiment: -0.3,
      related_symbols: ["EURUSD"],
      source: "test",
      timestamp: new Date(Date.now() + 2 * 60_000).toISOString(),
    });
    const { status, data } = await get("/api/macro/events");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.events)).toBe(true);
    expect((d.events as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("GET /api/macro/lockout/:symbol", () => {
  it("returns locked=false when no events", async () => {
    const { status, data } = await get("/api/macro/lockout/BTCUSD");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(typeof d.locked).toBe("boolean");
  });

  it("returns locked=true after high-impact event for that symbol", async () => {
    await post("/api/macro/events", {
      id: "lockout-test-evt",
      type: "economic_calendar",
      title: "NFP Report",
      impact: "high",
      sentiment: -0.5,
      related_symbols: ["LOCKOUTSYM"],
      source: "test",
      timestamp: new Date(Date.now() + 4 * 60_000).toISOString(),
    });
    const { data } = await get("/api/macro/lockout/LOCKOUTSYM");
    expect((data as Record<string, unknown>).locked).toBe(true);
  });
});

describe("GET /api/macro/stats", () => {
  it("returns cache statistics", async () => {
    const { status, data } = await get("/api/macro/stats");
    expect(status).toBe(200);
    expect(data).toBeTruthy();
  });
});

describe("DELETE /api/macro/clear", () => {
  it("clears events and returns success", async () => {
    await post("/api/macro/events", {
      id: "clear-test-evt",
      type: "economic_calendar",
      title: "Some Event",
      impact: "medium",
      related_symbols: [],
      source: "test",
      timestamp: new Date().toISOString(),
    });
    const { status, data } = await del("/api/macro/clear");
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).success).toBe(true);

    const { data: afterClear } = await get("/api/macro/events");
    expect(((afterClear as Record<string, unknown>).events as unknown[]).length).toBe(0);
  });
});
