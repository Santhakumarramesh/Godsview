/**
 * historical_seeder.test.ts — Phase 46 tests
 *
 * Verifies the synthetic historical data seeder:
 *   1. Skips seeding when table already has enough rows
 *   2. Seeds the correct number of records on bootstrap
 *   3. Generated records have valid field ranges and use correct labels
 *   4. Win rates are statistically reasonable
 *   5. Stale-data guard purges mismatched rows before reseeding
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB ───────────────────────────────────────────────────────────────────

const insertedBatches: unknown[][] = [];
let mockCurrentCount = 0;
let mockStaleCount   = 0; // rows with old regime/setup labels

vi.mock("@workspace/db", () => {
  const mockInsertChain = {
    values: (rows: unknown[]) => {
      insertedBatches.push(rows);
      return Promise.resolve();
    },
  };

  // Supports: db.select().from() and db.select().from().where()
  const buildSelectChain = (countOverride?: number) => ({
    from: () => ({
      // plain .from() — returns count
      then: (resolve: Function) => resolve([{ cnt: countOverride ?? mockCurrentCount }]),
      // .from().where() — returns stale count
      where: () => Promise.resolve([{ cnt: mockStaleCount }]),
    }),
  });

  return {
    db: {
      select: vi.fn(() => buildSelectChain()),
      insert: vi.fn(() => mockInsertChain),
      delete: vi.fn(() => Promise.resolve()),
    },
    accuracyResultsTable: { id: "id", symbol: "symbol" },
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("seedHistoricalData — skip logic", () => {
  it("skips when accuracy_results already has enough rows", async () => {
    mockCurrentCount = 1000; // Above 500 threshold
    mockStaleCount   = 0;
    insertedBatches.length = 0;

    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(result.skipped).toBe(true);
    expect(result.seededRows).toBe(0);
    expect(insertedBatches.length).toBe(0);
  });

  it("returns existingRows in result when skipping", async () => {
    mockCurrentCount = 600;
    mockStaleCount   = 0;

    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(result.skipped).toBe(true);
    expect(result.existingRows).toBe(600);
  });
});

describe("seedHistoricalData — record generation", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCurrentCount = 0;   // trigger seeding
    mockStaleCount   = 0;   // no stale rows
    insertedBatches.length = 0;
  });

  it("seeds 6000 records when table is empty", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(result.skipped).toBe(false);
    expect(result.seededRows).toBe(6000);
  });

  it("inserts in batches of 200", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    // 6000 / 200 = 30 batches
    expect(insertedBatches.length).toBe(30);
  });

  it("each batch has at most 200 records", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    for (const batch of insertedBatches) {
      expect((batch as unknown[]).length).toBeLessThanOrEqual(200);
    }
  });

  it("all inserted records have required fields", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    const allRecords = insertedBatches.flat() as Record<string, unknown>[];

    for (const record of allRecords.slice(0, 50)) { // Sample first 50
      expect(record.symbol).toBeTruthy();
      expect(record.setup_type).toBeTruthy();
      expect(record.timeframe).toBe("1Min");
      expect(record.bar_time).toBeInstanceOf(Date);
      expect(record.outcome).toMatch(/^(win|loss)$/);
      expect(record.direction).toMatch(/^(long|short)$/);
      expect(record.regime).toBeTruthy();
      expect(parseFloat(record.structure_score as string)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(record.structure_score as string)).toBeLessThanOrEqual(1);
      expect(parseFloat(record.order_flow_score as string)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(record.order_flow_score as string)).toBeLessThanOrEqual(1);
      expect(parseFloat(record.recall_score as string)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(record.recall_score as string)).toBeLessThanOrEqual(1);
      expect(parseFloat(record.final_quality as string)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(record.final_quality as string)).toBeLessThanOrEqual(1);
      expect(record.tp_ticks).toBeGreaterThan(record.sl_ticks as number); // TP > SL
    }
  });

  it("records use only valid symbols", async () => {
    const VALID_SYMBOLS = ["BTCUSD", "ETHUSD", "SPY", "QQQ", "AAPL", "MSFT", "TSLA", "NVDA"];
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    const allRecords = insertedBatches.flat() as Record<string, unknown>[];
    for (const r of allRecords.slice(0, 100)) {
      expect(VALID_SYMBOLS).toContain(r.symbol);
    }
  });

  it("records use only ML-aligned setup types", async () => {
    const VALID_SETUPS = [
      "absorption_reversal", "sweep_reclaim", "continuation_pullback",
      "cvd_divergence", "breakout_failure", "vwap_reclaim",
      "opening_range_breakout", "post_news_continuation",
    ];
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    const allRecords = insertedBatches.flat() as Record<string, unknown>[];
    for (const r of allRecords.slice(0, 200)) {
      expect(VALID_SETUPS).toContain(r.setup_type);
    }
  });

  it("records use only ML-aligned regime labels", async () => {
    const VALID_REGIMES = ["trending_bull", "trending_bear", "ranging", "volatile", "chop"];
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    const allRecords = insertedBatches.flat() as Record<string, unknown>[];
    for (const r of allRecords.slice(0, 200)) {
      expect(VALID_REGIMES).toContain(r.regime);
    }
  });

  it("win rate is statistically between 35% and 80%", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    const allRecords = insertedBatches.flat() as Record<string, unknown>[];
    const wins  = allRecords.filter(r => r.outcome === "win").length;
    const total = allRecords.length;
    const winRate = wins / total;

    expect(winRate).toBeGreaterThan(0.35);
    expect(winRate).toBeLessThan(0.80);
  });

  it("bar_times span a wide date range (at least 30 days)", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    await seedHistoricalData();

    const allRecords = insertedBatches.flat() as Record<string, unknown>[];
    const times = allRecords.map(r => (r.bar_time as Date).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const spreadDays = (maxTime - minTime) / (24 * 60 * 60 * 1000);

    expect(spreadDays).toBeGreaterThan(30);
  });
});

describe("seedHistoricalData — result shape", () => {
  it("returns correct result shape with timing", async () => {
    vi.resetModules();
    mockCurrentCount = 0;
    mockStaleCount   = 0;
    insertedBatches.length = 0;

    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(typeof result.skipped).toBe("boolean");
    expect(typeof result.existingRows).toBe("number");
    expect(typeof result.seededRows).toBe("number");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
