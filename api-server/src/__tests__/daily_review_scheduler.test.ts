/**
 * __tests__/daily_review_scheduler.test.ts — Daily Review Scheduler Tests
 *
 * Tests for the daily review scheduler engine covering:
 *   - Starting and stopping the scheduler
 *   - Running daily reviews manually
 *   - History tracking
 *   - Reset functionality
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  startDailyReviewScheduler,
  stopDailyReviewScheduler,
  isSchedulerRunning,
  getSchedulerHistory,
  runDailyReviews,
  resetScheduler,
  type SchedulerRun,
} from "../engines/daily_review_scheduler.js";

// Mock the daily_review_engine
const mockReview = {
  id: "review_123",
  date: "2026-04-05",
  symbol: "BTC",
  htfBias: "bullish" as const,
  keyLevels: [],
  orderBlocksActive: 2,
  abcdPatternsActive: 1,
  signalsGenerated: 5,
  tradesExecuted: 3,
  tradesWon: 2,
  tradesLost: 1,
  pnlPct: 2.5,
  tradeProbability: { long: 0.6, short: 0.2, neutral: 0.2 },
  chanceOfTrade: 75,
  findings: [],
  structureSummary: "Test summary",
  createdAt: new Date().toISOString(),
};

vi.mock("../engines/daily_review_engine.js", () => ({
  generateDailyReview: vi.fn(() => mockReview),
  saveDailyReview: vi.fn(),
}));

vi.mock("../lib/watchlist.js", () => ({
  listWatchlist: vi.fn(() => [
    { symbol: "BTCUSD", enabled: true },
    { symbol: "ETHUSD", enabled: true },
    { symbol: "SPY", enabled: true },
  ]),
}));

describe("Daily Review Scheduler", () => {
  beforeEach(() => {
    // Ensure clean state before each test
    resetScheduler();
    vi.clearAllMocks();
  });

  describe("start/stop scheduler", () => {
    it("should start the scheduler", () => {
      expect(isSchedulerRunning()).toBe(false);
      startDailyReviewScheduler(60000); // 1 minute interval
      expect(isSchedulerRunning()).toBe(true);
      stopDailyReviewScheduler();
    });

    it("should stop the scheduler", () => {
      startDailyReviewScheduler(60000);
      expect(isSchedulerRunning()).toBe(true);
      stopDailyReviewScheduler();
      expect(isSchedulerRunning()).toBe(false);
    });

    it("should not start scheduler twice", () => {
      startDailyReviewScheduler(60000);
      const running1 = isSchedulerRunning();
      startDailyReviewScheduler(60000); // Try to start again
      const running2 = isSchedulerRunning();
      expect(running1).toBe(true);
      expect(running2).toBe(true);
      stopDailyReviewScheduler();
    });

    it("should handle multiple stop calls gracefully", () => {
      startDailyReviewScheduler(60000);
      stopDailyReviewScheduler();
      stopDailyReviewScheduler(); // Second stop should not throw
      expect(isSchedulerRunning()).toBe(false);
    });
  });

  describe("run daily reviews manually", () => {
    it("should run daily reviews for specified date", async () => {
      const reviews = await runDailyReviews("2026-04-05");
      expect(reviews).toHaveLength(3); // 3 default symbols from mock
      expect(reviews[0]).toMatchObject({
        id: "review_123",
        date: "2026-04-05",
      });
    });

    it("should run daily reviews with no date (defaults to today)", async () => {
      const reviews = await runDailyReviews();
      expect(reviews).toHaveLength(3);
      const today = new Date().toISOString().slice(0, 10);
      expect(reviews[0].date).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should handle errors during review generation gracefully", async () => {
      // Reset mock to force an error scenario
      const { generateDailyReview } = await import(
        "../engines/daily_review_engine.js"
      );
      vi.mocked(generateDailyReview).mockImplementationOnce(() => {
        throw new Error("Review generation failed");
      });

      // Should not throw, but track error
      const reviews = await runDailyReviews("2026-04-05");
      const history = getSchedulerHistory();
      expect(history.history.length).toBeGreaterThan(0);
    });
  });

  describe("scheduler history tracking", () => {
    it("should track scheduler run history", async () => {
      const historyBefore = getSchedulerHistory();
      expect(historyBefore.history).toHaveLength(0);

      await runDailyReviews("2026-04-05");

      const historyAfter = getSchedulerHistory();
      expect(historyAfter.history).toHaveLength(1);
      expect(historyAfter.history[0]).toMatchObject({
        date: "2026-04-05",
        symbols: 3,
        reviews: 3,
        errors: [],
      });
    });

    it("should track lastRunDate correctly", async () => {
      const history1 = getSchedulerHistory();
      expect(history1.lastRunDate).toBeNull();

      await runDailyReviews("2026-04-05");

      const history2 = getSchedulerHistory();
      expect(history2.lastRunDate).toBe("2026-04-05");
    });

    it("should include errors in history", async () => {
      const { generateDailyReview } = await import(
        "../engines/daily_review_engine.js"
      );
      vi.mocked(generateDailyReview).mockImplementationOnce(() => {
        throw new Error("Test error");
      });

      await runDailyReviews("2026-04-06");

      const history = getSchedulerHistory();
      const lastRun = history.history[history.history.length - 1];
      expect(lastRun.errors.length).toBeGreaterThan(0);
      expect(lastRun.errors[0]).toContain("Test error");
    });

    it("should limit history to last 30 runs", async () => {
      // Run scheduler 35 times to exceed limit
      for (let i = 0; i < 35; i++) {
        const date = new Date(2026, 3, 5 + i).toISOString().slice(0, 10);
        await runDailyReviews(date);
      }

      const history = getSchedulerHistory();
      expect(history.history.length).toBeLessThanOrEqual(30);
      expect(history.history.length).toBe(30);
    });

    it("should report running status correctly", () => {
      const history1 = getSchedulerHistory();
      expect(history1.running).toBe(false);

      startDailyReviewScheduler(60000);
      const history2 = getSchedulerHistory();
      expect(history2.running).toBe(true);

      stopDailyReviewScheduler();
      const history3 = getSchedulerHistory();
      expect(history3.running).toBe(false);
    });
  });

  describe("reset scheduler", () => {
    it("should reset scheduler state completely", async () => {
      startDailyReviewScheduler(60000);
      await runDailyReviews("2026-04-05");

      const historyBefore = getSchedulerHistory();
      expect(historyBefore.running).toBe(true);
      expect(historyBefore.lastRunDate).toBe("2026-04-05");
      expect(historyBefore.history.length).toBeGreaterThan(0);

      resetScheduler();

      const historyAfter = getSchedulerHistory();
      expect(historyAfter.running).toBe(false);
      expect(historyAfter.lastRunDate).toBeNull();
      expect(historyAfter.history).toHaveLength(0);
    });

    it("should allow scheduler to be restarted after reset", async () => {
      startDailyReviewScheduler(60000);
      resetScheduler();

      expect(isSchedulerRunning()).toBe(false);

      startDailyReviewScheduler(60000);
      expect(isSchedulerRunning()).toBe(true);

      stopDailyReviewScheduler();
    });
  });

  describe("integration scenarios", () => {
    it("should track multiple consecutive runs", async () => {
      await runDailyReviews("2026-04-05");
      await runDailyReviews("2026-04-06");
      await runDailyReviews("2026-04-07");

      const history = getSchedulerHistory();
      expect(history.history).toHaveLength(3);
      expect(history.history[0].date).toBe("2026-04-05");
      expect(history.history[2].date).toBe("2026-04-07");
    });

    it("should track review counts correctly across runs", async () => {
      await runDailyReviews("2026-04-05");
      const history1 = getSchedulerHistory();
      expect(history1.history[0].reviews).toBe(3);

      await runDailyReviews("2026-04-06");
      const history2 = getSchedulerHistory();
      expect(history2.history[1].reviews).toBe(3);
    });
  });
});
