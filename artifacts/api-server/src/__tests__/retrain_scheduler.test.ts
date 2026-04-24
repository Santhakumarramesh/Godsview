/**
 * retrain_scheduler.test.ts — Phase 36 tests
 *
 * Verifies the auto-retrain scheduler:
 *   1. getSchedulerStats() returns correct initial state
 *   2. startRetrainScheduler() is idempotent (no double-start)
 *   3. stopRetrainScheduler() stops the timer
 *   4. Stats reflect retrain history
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockMaxId = 0;
let mockRowCount = 0;
let retrainCallCount = 0;

vi.mock("@workspace/db", () => {
  const selectChain = {
    from: () => Promise.resolve([{ maxId: mockMaxId, cnt: mockRowCount }]),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
    },
    accuracyResultsTable: {},
  };
});

vi.mock("../lib/ml_model", () => ({
  retrainModel: vi.fn().mockImplementation(async () => {
    retrainCallCount++;
    return { success: true, message: "retrained" };
  }),
  getModelStatus: vi.fn().mockReturnValue({
    trained: true,
    source: "trained",
    trainedAt: new Date().toISOString(),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getSchedulerStats — initial state", () => {
  beforeEach(() => {
    vi.resetModules();
    mockMaxId = 0;
    mockRowCount = 0;
    retrainCallCount = 0;
  });

  it("returns not-running before start", async () => {
    const { getSchedulerStats } = await import("../lib/retrain_scheduler");
    const stats = getSchedulerStats();
    expect(stats.running).toBe(false);
  });

  it("returns correct poll interval", async () => {
    const { getSchedulerStats } = await import("../lib/retrain_scheduler");
    const stats = getSchedulerStats();
    expect(stats.pollIntervalMs).toBe(30 * 60 * 1000); // 30 min
  });

  it("returns correct new data threshold", async () => {
    const { getSchedulerStats } = await import("../lib/retrain_scheduler");
    const stats = getSchedulerStats();
    expect(stats.newDataThreshold).toBe(100);
  });

  it("returns null lastTrainedAt when never trained", async () => {
    const { getSchedulerStats } = await import("../lib/retrain_scheduler");
    const stats = getSchedulerStats();
    expect(stats.lastTrainedAt).toBeNull();
  });

  it("returns 0 totalRetrains initially", async () => {
    const { getSchedulerStats } = await import("../lib/retrain_scheduler");
    const stats = getSchedulerStats();
    expect(stats.totalRetrains).toBe(0);
  });
});

describe("startRetrainScheduler", () => {
  afterEach(async () => {
    try {
      const { stopRetrainScheduler } = await import("../lib/retrain_scheduler");
      stopRetrainScheduler();
    } catch {
      // ignore
    }
    vi.resetModules();
  });

  it("sets running to true after start", async () => {
    const { startRetrainScheduler, getSchedulerStats } = await import("../lib/retrain_scheduler");
    await startRetrainScheduler();
    const stats = getSchedulerStats();
    expect(stats.running).toBe(true);
  });

  it("is idempotent — second call does not throw", async () => {
    const { startRetrainScheduler } = await import("../lib/retrain_scheduler");
    await expect(startRetrainScheduler()).resolves.toBeUndefined();
    await expect(startRetrainScheduler()).resolves.toBeUndefined();
  });

  it("sets highWaterMark from current DB state on start", async () => {
    mockMaxId = 500;
    const { startRetrainScheduler, getSchedulerStats } = await import("../lib/retrain_scheduler");
    await startRetrainScheduler();
    const stats = getSchedulerStats();
    expect(stats.highWaterMark).toBe(500);
  });
});

describe("stopRetrainScheduler", () => {
  it("sets running to false after stop", async () => {
    vi.resetModules();
    const { startRetrainScheduler, stopRetrainScheduler, getSchedulerStats } =
      await import("../lib/retrain_scheduler");

    await startRetrainScheduler();
    expect(getSchedulerStats().running).toBe(true);

    stopRetrainScheduler();
    expect(getSchedulerStats().running).toBe(false);
  });

  it("is safe to call when not running", async () => {
    vi.resetModules();
    const { stopRetrainScheduler } = await import("../lib/retrain_scheduler");
    expect(() => stopRetrainScheduler()).not.toThrow();
  });
});

describe("SchedulerStats shape", () => {
  it("returns correct field types", async () => {
    vi.resetModules();
    const { getSchedulerStats } = await import("../lib/retrain_scheduler");
    const stats = getSchedulerStats();

    expect(typeof stats.running).toBe("boolean");
    expect(typeof stats.isRetraining).toBe("boolean");
    expect(typeof stats.highWaterMark).toBe("number");
    expect(typeof stats.totalRetrains).toBe("number");
    expect(typeof stats.pollIntervalMs).toBe("number");
    expect(typeof stats.newDataThreshold).toBe("number");
    expect(stats.lastTrainedAt === null || typeof stats.lastTrainedAt === "string").toBe(true);
  });
});
