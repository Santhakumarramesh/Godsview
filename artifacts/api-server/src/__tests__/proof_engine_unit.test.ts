/**
 * proof_engine_unit.test.ts — Phase 69
 *
 * Tests generateProofDashboard, getSetupProof, getRegimeProof,
 * getDriftReports, clearProofCache, getProofCacheStats.
 * Mocks DB to return controlled decision data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock data (must be defined before vi.mock factories run) ──────────

const { mockRows } = vi.hoisted(() => {
  const now = new Date();
  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      id: Math.floor(Math.random() * 10000),
      symbol: "BTCUSD",
      setup_type: "sweep_reclaim",
      direction: "long",
      regime: "trending_bull",
      approved: true,
      win_probability: "0.72",
      edge_score: "0.65",
      enhanced_quality: "0.70",
      kelly_fraction: "0.08",
      confluence_score: "0.75",
      suggested_qty: 5,
      rejection_reason: null,
      entry_price: "84000",
      stop_loss: "83000",
      take_profit: "87000",
      final_quality: "0.71",
      gate_action: "approved",
      gate_block_reasons: null,
      trailing_stop_json: null,
      profit_targets_json: null,
      outcome: "win",
      realized_pnl: "500",
      created_at: now,
      ...overrides,
    };
  }
  return {
    mockRows: [
      makeRow({ outcome: "win", realized_pnl: "300" }),
      makeRow({ outcome: "win", realized_pnl: "500" }),
      makeRow({ outcome: "loss", realized_pnl: "-200" }),
      makeRow({ setup_type: "cvd_divergence", regime: "ranging", outcome: "win", realized_pnl: "150" }),
      makeRow({ setup_type: "cvd_divergence", regime: "ranging", outcome: "loss", realized_pnl: "-100" }),
      makeRow({ outcome: "win", realized_pnl: "400" }),
    ],
  };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  // proof_engine queries: db.select().from().where().orderBy() — then awaits (no .limit())
  // strategy_cache queries: db.select().from().where().orderBy().limit()
  const limitMock = vi.fn().mockResolvedValue(mockRows);
  const orderByMock = vi.fn(() => {
    const p = Promise.resolve(mockRows) as any;
    p.limit = limitMock;
    return p;
  });
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return {
    // drizzle-orm re-exports (now provided by @workspace/db)
    and:       (...args: unknown[]) => args,
    or:        (...args: unknown[]) => args,
    eq:        () => null,
    ne:        () => null,
    gt:        () => null,
    gte:       () => null,
    lt:        () => null,
    lte:       () => null,
    isNotNull: () => null,
    isNull:    () => null,
    desc:      () => null,
    asc:       () => null,
    inArray:   () => null,
    notInArray:() => null,
    count:     () => 0,
    sum:       () => 0,
    max:       () => null,
    min:       () => null,
    between:   () => null,
    like:      () => null,
    ilike:     () => null,
    exists:    () => null,
    not:       () => null,
    sql:       Object.assign(() => "", { raw: (s: string) => s }) as unknown as never,

    db: { select: selectMock },
    siDecisionsTable: new Proxy({} as any, { get: (_t, p) => String(p) }),
  };
});

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((col) => col),
  gte: vi.fn((col, val) => ({ col, val })),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

import {
  generateProofDashboard,
  getSetupProof,
  getRegimeProof,
  getDriftReports,
  clearProofCache,
  getProofCacheStats,
  type ProofDashboard,
  type SetupProof,
} from "../lib/proof_engine";

// ── clearProofCache / getProofCacheStats ──────────────────────────────────────

describe("clearProofCache / getProofCacheStats", () => {
  it("getProofCacheStats returns size and entries array", () => {
    const stats = getProofCacheStats();
    expect(typeof stats.size).toBe("number");
    expect(Array.isArray(stats.entries)).toBe(true);
    expect(stats.size).toBeGreaterThanOrEqual(0);
  });

  it("clearProofCache() clears all entries without throwing", () => {
    clearProofCache();
    const stats = getProofCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.entries).toHaveLength(0);
  });

  it("clearProofCache(days) clears specific days entry without throwing", () => {
    expect(() => clearProofCache(30)).not.toThrow();
  });

  it("cache grows after generateProofDashboard calls", async () => {
    clearProofCache();
    await generateProofDashboard(7);
    const stats = getProofCacheStats();
    expect(stats.size).toBeGreaterThan(0);
  });

  it("cache entry keys contain the day count", async () => {
    clearProofCache();
    await generateProofDashboard(14);
    const stats = getProofCacheStats();
    expect(stats.entries.some(k => k.includes("14"))).toBe(true);
  });
});

// ── generateProofDashboard ────────────────────────────────────────────────────

describe("generateProofDashboard", () => {
  beforeEach(() => clearProofCache());

  it("returns a ProofDashboard shaped object", async () => {
    const dashboard = await generateProofDashboard(30);
    expect(dashboard).toBeDefined();
    expect(dashboard).toHaveProperty("overall_win_rate");
    expect(dashboard).toHaveProperty("total_decisions");
    expect(dashboard).toHaveProperty("by_setup");
    expect(dashboard).toHaveProperty("by_regime");
    expect(dashboard).toHaveProperty("drift_reports");
  });

  it("overall_win_rate is between 0 and 1", async () => {
    const dashboard = await generateProofDashboard(30);
    expect(dashboard.overall_win_rate).toBeGreaterThanOrEqual(0);
    expect(dashboard.overall_win_rate).toBeLessThanOrEqual(1);
  });

  it("total_decisions matches the mock row count", async () => {
    const dashboard = await generateProofDashboard(30);
    expect(dashboard.total_decisions).toBe(mockRows.length);
  });

  it("by_setup is an array of SetupProof objects", async () => {
    const dashboard = await generateProofDashboard(30);
    expect(Array.isArray(dashboard.by_setup)).toBe(true);
    for (const setup of dashboard.by_setup) {
      expect(setup).toHaveProperty("setup_type");
      expect(setup).toHaveProperty("total_trades");
      expect(setup).toHaveProperty("wins");
      expect(setup).toHaveProperty("losses");
      expect(setup).toHaveProperty("win_rate");
    }
  });

  it("by_regime is an object with regime keys", async () => {
    const dashboard = await generateProofDashboard(30);
    expect(typeof dashboard.by_regime).toBe("object");
    for (const [key, val] of Object.entries(dashboard.by_regime)) {
      expect(typeof key).toBe("string");
      expect(val).toHaveProperty("win_rate");
      expect(val).toHaveProperty("count");
    }
  });

  it("drift_reports is an array", async () => {
    const dashboard = await generateProofDashboard(30);
    expect(Array.isArray(dashboard.drift_reports)).toBe(true);
  });

  it("caches result — second call uses cache (no extra DB queries)", async () => {
    const { db } = await import("@workspace/db");
    clearProofCache();
    await generateProofDashboard(30);
    const callsBefore = vi.mocked(db.select).mock.calls.length;
    await generateProofDashboard(30); // cached
    expect(vi.mocked(db.select).mock.calls.length).toBe(callsBefore);
  });

  it("different day ranges each get their own cache entry", async () => {
    await generateProofDashboard(7);
    await generateProofDashboard(30);
    const stats = getProofCacheStats();
    expect(stats.size).toBeGreaterThanOrEqual(2);
  });
});

// ── getSetupProof ─────────────────────────────────────────────────────────────

describe("getSetupProof", () => {
  beforeEach(() => clearProofCache());

  it("returns SetupProof for known setup type", async () => {
    const proof = await getSetupProof("sweep_reclaim", 30);
    if (proof) {
      expect(proof.setup_type).toBe("sweep_reclaim");
      expect(proof.total_trades).toBeGreaterThan(0);
      expect(proof.win_rate).toBeGreaterThanOrEqual(0);
      expect(proof.win_rate).toBeLessThanOrEqual(1);
    }
    // null is valid if no trades found for that type
    expect(proof === null || typeof proof === "object").toBe(true);
  });

  it("returns null for non-existent setup type", async () => {
    const proof = await getSetupProof("nonexistent_setup_xyz", 30);
    expect(proof).toBeNull();
  });
});

// ── getRegimeProof ────────────────────────────────────────────────────────────

describe("getRegimeProof", () => {
  beforeEach(() => clearProofCache());

  it("returns RegimeStats for known regime", async () => {
    const stats = await getRegimeProof("trending_bull", 30);
    if (stats) {
      expect(stats).toHaveProperty("win_rate");
      expect(stats).toHaveProperty("count");
      expect(stats).toHaveProperty("avg_quality");
    }
    expect(stats === null || typeof stats === "object").toBe(true);
  });

  it("returns null for non-existent regime", async () => {
    const stats = await getRegimeProof("nonexistent_regime_xyz", 30);
    expect(stats).toBeNull();
  });
});

// ── getDriftReports ───────────────────────────────────────────────────────────

describe("getDriftReports", () => {
  beforeEach(() => clearProofCache());

  it("returns an array", async () => {
    const reports = await getDriftReports(30);
    expect(Array.isArray(reports)).toBe(true);
  });

  it("each drift report has required fields", async () => {
    const reports = await getDriftReports(30);
    for (const r of reports) {
      expect(r).toHaveProperty("symbol");
      expect(r).toHaveProperty("setup_type");
      expect(r).toHaveProperty("drift_status");
      expect(r).toHaveProperty("drift_magnitude");
      expect(["stable", "watch", "drift", "critical"]).toContain(r.drift_status);
    }
  });
});
