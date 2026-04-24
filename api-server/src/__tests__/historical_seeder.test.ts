/**
 * historical_seeder.test.ts
 *
 * Contract tests for the v3 real-data seeder:
 *   - skip threshold behavior
 *   - stale-row purge behavior
 *   - bootstrap result shape in deterministic test mode
 *
 * Note: tiingo client is mocked to return <50 bars so the seeder
 * intentionally performs no inserts in this suite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const insertedBatches: unknown[][] = [];
let mockCurrentCount = 0;
let mockStaleCount = 0;
let deleteWhereCalls = 0;

vi.mock("../lib/tiingo_client", () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1000 + i,
    source: "synthetic" as const,
  }));

  return {
    getHistoricalBars: vi.fn(async () => ({
      bars,
      has_real_data: false,
      source: "synthetic",
    })),
  };
});

vi.mock("@workspace/db", () => {
  const selectChain = {
    from: () => ({
      where: () => Promise.resolve([{ cnt: mockStaleCount }]),
      then: (resolve: (rows: Array<{ cnt: number }>) => void, reject?: (reason?: unknown) => void) =>
        Promise.resolve([{ cnt: mockCurrentCount }]).then(resolve, reject),
    }),
  };

  const insertChain = {
    values: (rows: unknown[]) => {
      insertedBatches.push(rows);
      return Promise.resolve();
    },
  };

  const deleteChain = {
    where: () => {
      deleteWhereCalls += 1;
      return Promise.resolve();
    },
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => deleteChain),
    },
    accuracyResultsTable: { id: "id", symbol: "symbol" },
  };
});

describe("seedHistoricalData", () => {
  beforeEach(() => {
    vi.resetModules();
    insertedBatches.length = 0;
    mockCurrentCount = 0;
    mockStaleCount = 0;
    deleteWhereCalls = 0;
  });

  it("skips bootstrap when existing rows meet threshold", async () => {
    mockCurrentCount = 1000; // >= 800 threshold

    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(result.skipped).toBe(true);
    expect(result.existingRows).toBe(1000);
    expect(result.seededRows).toBe(0);
    expect(insertedBatches.length).toBe(0);
  });

  it("purges stale rows before threshold check", async () => {
    mockCurrentCount = 1000;
    mockStaleCount = 7;

    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(result.skipped).toBe(true);
    expect(result.purged).toBe(7);
    expect(deleteWhereCalls).toBe(1);
  });

  it("runs bootstrap path when below threshold", async () => {
    mockCurrentCount = 0;
    mockStaleCount = 0;

    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(result.skipped).toBe(false);
    expect(result.existingRows).toBe(0);
    expect(result.seededRows).toBe(0);
    expect(result.symbols_processed).toBe(0);
    expect(result.has_real_data).toBe(false);
    expect(insertedBatches.length).toBe(0);
  });

  it("returns stable result shape", async () => {
    const { seedHistoricalData } = await import("../lib/historical_seeder");
    const result = await seedHistoricalData();

    expect(typeof result.skipped).toBe("boolean");
    expect(typeof result.existingRows).toBe("number");
    expect(typeof result.seededRows).toBe("number");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

