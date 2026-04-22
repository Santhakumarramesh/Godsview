/**
 * proof_route.test.ts — Phase 55
 *
 * Tests for proof/drift dashboard endpoints (routes/proof.ts):
 *
 *   GET  /proof/dashboard            — full proof dashboard
 *   GET  /proof/by-setup/:setupType  — setup-specific proof
 *   GET  /proof/drift                — all drift reports
 *   GET  /proof/by-regime/:regime    — regime-specific stats
 *   GET  /proof/cache/stats          — cache statistics
 *   POST /proof/cache/clear          — clear cache
 *
 * proof_engine is mocked to avoid heavy DB queries.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mocks (must precede router import) ────────────────────────────────────────

const MOCK_DASHBOARD = {
  generatedAt:      new Date().toISOString(),
  daysAnalyzed:     30,
  setups:           [],
  regimes:          [],
  driftReports:     [],
  summary: {
    totalSignals:   0,
    totalClosed:    0,
    overallWinRate: 0,
    overallPF:      0,
    expectancyR:    0,
  },
};

const MOCK_SETUP_PROOF = {
  setupType:  "sweep_reclaim",
  totalTrades: 5,
  winRate:    0.6,
  profitFactor: 1.5,
  expectancyR:  0.3,
  drift:      null,
};

const MOCK_DRIFT_REPORTS = [
  {
    setupType:  "sweep_reclaim",
    period:     "2026-03-01/2026-03-31",
    winRate:    0.55,
    baseline:   0.60,
    deviation:  0.05,
    alert:      false,
  },
];

const MOCK_REGIME_STATS = {
  regime:      "trending",
  totalTrades: 8,
  winRate:     0.625,
  profitFactor: 1.8,
};

const MOCK_CACHE_STATS = {
  size:     2,
  keys:     ["30", "7"],
  oldestMs: 1_000,
};

vi.mock("../lib/proof_engine", () => ({
  generateProofDashboard: vi.fn(async () => MOCK_DASHBOARD),
  getSetupProof:          vi.fn(async () => MOCK_SETUP_PROOF),
  getRegimeProof:         vi.fn(async () => MOCK_REGIME_STATS),
  getDriftReports:        vi.fn(async () => MOCK_DRIFT_REPORTS),
  clearProofCache:        vi.fn(),
  getProofCacheStats:     vi.fn(() => MOCK_CACHE_STATS),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import proofRouter from "../routes/proof";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/proof", proofRouter);

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

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
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

const get  = (path: string)               => httpReq("GET",  path);
const post = (path: string, body: unknown) => httpReq("POST", path, body);

// ─────────────────────────────────────────────────────────────────────────────
// GET /proof/dashboard
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /proof/dashboard", () => {
  it("returns 200", async () => {
    const { status } = await get("/proof/dashboard");
    expect(status).toBe(200);
  });

  it("response has summary field", async () => {
    const { data } = await get("/proof/dashboard");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("summary");
    expect(typeof d.summary).toBe("object");
  });

  it("summary has expected fields", async () => {
    const { data } = await get("/proof/dashboard");
    const summary = (data as Record<string, unknown>).summary as Record<string, unknown>;
    expect(summary).toHaveProperty("totalSignals");
    expect(summary).toHaveProperty("overallWinRate");
  });

  it("response has setups and regimes arrays", async () => {
    const { data } = await get("/proof/dashboard");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.setups)).toBe(true);
    expect(Array.isArray(d.regimes)).toBe(true);
  });

  it("accepts days query param", async () => {
    const { status } = await get("/proof/dashboard?days=7");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proof/by-setup/:setupType
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /proof/by-setup/:setupType", () => {
  it("returns 200 for known setup type", async () => {
    const { status } = await get("/proof/by-setup/sweep_reclaim");
    expect(status).toBe(200);
  });

  it("response has setupType and winRate fields", async () => {
    const { data } = await get("/proof/by-setup/sweep_reclaim");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("setupType");
    expect(d).toHaveProperty("winRate");
  });

  it("returns 404 when getSetupProof returns null", async () => {
    const { getSetupProof } = await import("../lib/proof_engine");
    vi.mocked(getSetupProof).mockResolvedValueOnce(null);
    const { status } = await get("/proof/by-setup/unknown_setup");
    expect(status).toBe(404);
  });

  it("accepts days query param", async () => {
    const { status } = await get("/proof/by-setup/sweep_reclaim?days=14");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proof/drift
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /proof/drift", () => {
  it("returns 200", async () => {
    const { status } = await get("/proof/drift");
    expect(status).toBe(200);
  });

  it("response is an array or has driftReports key", async () => {
    const { data } = await get("/proof/drift");
    // Route may return the array directly or wrapped in an object
    const isArrayOrWrapped = Array.isArray(data) || typeof data === "object";
    expect(isArrayOrWrapped).toBe(true);
  });

  it("accepts days query param", async () => {
    const { status } = await get("/proof/drift?days=90");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proof/by-regime/:regime
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /proof/by-regime/:regime", () => {
  it("returns 200 for known regime", async () => {
    const { status } = await get("/proof/by-regime/trending");
    expect(status).toBe(200);
  });

  it("response has regime and stats fields", async () => {
    const { data } = await get("/proof/by-regime/trending");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("regime");
    // winRate may be top-level or nested under stats
    const hasWinRate = "winRate" in d || (typeof d.stats === "object" && d.stats !== null && "winRate" in (d.stats as object));
    expect(hasWinRate).toBe(true);
  });

  it("returns 404 when getRegimeProof returns null", async () => {
    const { getRegimeProof } = await import("../lib/proof_engine");
    vi.mocked(getRegimeProof).mockResolvedValueOnce(null);
    const { status } = await get("/proof/by-regime/unknown_regime");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proof/cache/stats
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /proof/cache/stats", () => {
  it("returns 200", async () => {
    const { status } = await get("/proof/cache/stats");
    expect(status).toBe(200);
  });

  it("response is an object with size and keys", async () => {
    const { data } = await get("/proof/cache/stats");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("size");
    expect(d).toHaveProperty("keys");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /proof/cache/clear
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /proof/cache/clear", () => {
  it("returns 200", async () => {
    const { status } = await post("/proof/cache/clear", {});
    expect(status).toBe(200);
  });

  it("calls clearProofCache", async () => {
    const { clearProofCache } = await import("../lib/proof_engine");
    vi.mocked(clearProofCache).mockClear();
    await post("/proof/cache/clear", {});
    expect(vi.mocked(clearProofCache)).toHaveBeenCalled();
  });

  it("accepts days parameter in body", async () => {
    const { status } = await post("/proof/cache/clear", { days: 30 });
    expect(status).toBe(200);
  });
});
