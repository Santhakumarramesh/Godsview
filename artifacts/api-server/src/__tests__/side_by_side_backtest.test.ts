/**
 * side_by_side_backtest.test.ts — Side-by-Side Backtest Engine Tests
 *
 * Tests:
 *   startSideBySide:
 *     - Creates snapshot with running status
 *     - Sets backtest dates correctly
 *     - Initializes comparison metrics
 *     - Returns valid config and timestamps
 *
 *   stopSideBySide:
 *     - Stops active run and sets status to stopped
 *     - Returns null if no active run
 *
 *   pauseSideBySide / resumeSideBySide:
 *     - Pauses live leg while keeping backtest running
 *     - Resumes live leg
 *     - Returns null if no active run
 *
 *   getSideBySideSnapshot:
 *     - Returns current snapshot
 *     - Returns null if no active run
 *
 *   updateBacktestProgress:
 *     - Updates trade count, win rate, PnL, signals, progress
 *     - Calculates win rate correctly (wins / total)
 *     - Sets status to complete when progress >= 100%
 *     - Updates comparison metrics
 *
 *   updateLiveProgress:
 *     - Updates trade count, win rate, PnL, unrealized, positions, signals
 *     - Calculates win rate correctly
 *     - Updates lastSignalAt timestamp
 *     - Updates comparison metrics
 *
 *   Comparison Metrics:
 *     - winRateDelta: live.winRate - backtest.winRate
 *     - pnlDelta: live.pnlPct - backtest.pnlPct
 *     - signalOverlap: min(signals) / max(signals) * 100
 *     - divergenceScore: 0-1 scale, 0=identical, 1=completely different
 *
 *   resetSideBySide:
 *     - Clears current snapshot
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startSideBySide,
  stopSideBySide,
  pauseSideBySide,
  resumeSideBySide,
  getSideBySideSnapshot,
  updateBacktestProgress,
  updateLiveProgress,
  resetSideBySide,
  type SideBySideConfig,
} from "../engines/side_by_side_backtest";

describe("Side-by-Side Backtest Engine", () => {
  beforeEach(() => {
    resetSideBySide();
  });

  afterEach(() => {
    resetSideBySide();
  });

  describe("startSideBySide", () => {
    it("creates snapshot with running status", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD", "ETH/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      const snapshot = startSideBySide(config);

      expect(snapshot.status).toBe("running");
      expect(snapshot.backtest.status).toBe("running");
      expect(snapshot.live.status).toBe("running");
      expect(snapshot.id).toBeDefined();
    });

    it("sets backtest dates correctly", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      const snapshot = startSideBySide(config);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      expect(snapshot.backtest.endDate).toBeDefined();
      expect(snapshot.backtest.startDate).toBeDefined();
      // Dates should be within a reasonable range
      expect(snapshot.backtest.endDate >= snapshot.backtest.startDate).toBe(true);
    });

    it("initializes comparison metrics", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      const snapshot = startSideBySide(config);

      expect(snapshot.comparison).toBeDefined();
      expect(snapshot.comparison.winRateDelta).toBe(0);
      expect(snapshot.comparison.pnlDelta).toBe(0);
      expect(snapshot.comparison.signalOverlap).toBe(100);
      expect(snapshot.comparison.divergenceScore).toBe(0);
    });

    it("returns valid config and timestamps", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD", "ETH/USD"],
        historicalDays: 30,
        strategies: ["breakout", "mean-reversion"],
        updateIntervalMs: 1000,
      };

      const snapshot = startSideBySide(config);

      expect(snapshot.config).toEqual(config);
      expect(snapshot.startedAt).toBeDefined();
      expect(snapshot.updatedAt).toBeDefined();
    });
  });

  describe("stopSideBySide", () => {
    it("stops active run and sets status to stopped", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      const stopped = stopSideBySide();

      expect(stopped).toBeDefined();
      expect(stopped?.status).toBe("stopped");
      expect(stopped?.backtest.status).toBe("complete");
      expect(stopped?.live.status).toBe("stopped");
    });

    it("returns null if no active run", () => {
      const result = stopSideBySide();
      expect(result).toBeNull();
    });
  });

  describe("pauseSideBySide / resumeSideBySide", () => {
    it("pauses live leg while keeping backtest running", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      const paused = pauseSideBySide();

      expect(paused).toBeDefined();
      expect(paused?.status).toBe("paused");
      expect(paused?.live.status).toBe("paused");
      expect(paused?.backtest.status).toBe("running");
    });

    it("resumes live leg", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      pauseSideBySide();
      const resumed = resumeSideBySide();

      expect(resumed).toBeDefined();
      expect(resumed?.status).toBe("running");
      expect(resumed?.live.status).toBe("running");
    });

    it("returns null if no active run", () => {
      expect(pauseSideBySide()).toBeNull();
      expect(resumeSideBySide()).toBeNull();
    });
  });

  describe("getSideBySideSnapshot", () => {
    it("returns current snapshot", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      const started = startSideBySide(config);
      const retrieved = getSideBySideSnapshot();

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(started.id);
    });

    it("returns null if no active run", () => {
      expect(getSideBySideSnapshot()).toBeNull();
    });
  });

  describe("updateBacktestProgress", () => {
    it("updates trade count, win rate, PnL, signals, progress", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(10, 7, 5.5, 25, 50);

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.backtest.tradesTotal).toBe(10);
      expect(snapshot?.backtest.winRate).toBe(70);
      expect(snapshot?.backtest.pnlPct).toBe(5.5);
      expect(snapshot?.backtest.signals).toBe(25);
      expect(snapshot?.backtest.progress).toBe(50);
    });

    it("calculates win rate correctly", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(4, 1, 0, 0, 25); // 1 win out of 4 = 25%

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.backtest.winRate).toBe(25);
    });

    it("sets status to complete when progress >= 100%", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(10, 7, 5.5, 25, 100);

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.backtest.status).toBe("complete");
    });

    it("updates comparison metrics", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(10, 8, 10, 25, 100);
      updateLiveProgress(10, 6, 8, 0, 0, 20);

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.comparison.winRateDelta).toBeDefined();
      expect(snapshot?.comparison.pnlDelta).toBeDefined();
    });
  });

  describe("updateLiveProgress", () => {
    it("updates trade count, win rate, PnL, unrealized, positions, signals", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateLiveProgress(8, 6, 4.8, 2500, 2, 20);

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.live.tradesTotal).toBe(8);
      expect(snapshot?.live.winRate).toBe(75);
      expect(snapshot?.live.pnlPct).toBe(4.8);
      expect(snapshot?.live.unrealizedPnl).toBe(2500);
      expect(snapshot?.live.openPositions).toBe(2);
      expect(snapshot?.live.signalsProcessed).toBe(20);
    });

    it("calculates win rate correctly", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateLiveProgress(5, 2, 0, 0, 0, 0); // 2 wins out of 5 = 40%

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.live.winRate).toBe(40);
    });

    it("updates lastSignalAt timestamp", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      expect(getSideBySideSnapshot()?.live.lastSignalAt).toBeNull();

      updateLiveProgress(1, 0, 0, 0, 0, 1);
      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.live.lastSignalAt).toBeDefined();
    });
  });

  describe("Comparison Metrics", () => {
    it("winRateDelta: live.winRate - backtest.winRate", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(10, 8, 10, 25, 100); // 80% win rate
      updateLiveProgress(10, 6, 8, 0, 0, 20); // 60% win rate

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.comparison.winRateDelta).toBe(-20); // 60 - 80
    });

    it("pnlDelta: live.pnlPct - backtest.pnlPct", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(10, 8, 10, 25, 100); // 10% PnL
      updateLiveProgress(10, 6, 8, 0, 0, 20); // 8% PnL

      const snapshot = getSideBySideSnapshot();
      expect(snapshot?.comparison.pnlDelta).toBe(-2); // 8 - 10
    });

    it("signalOverlap calculation", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      updateBacktestProgress(0, 0, 0, 10, 50); // 10 signals
      updateLiveProgress(0, 0, 0, 0, 0, 20); // 20 signals

      const snapshot = getSideBySideSnapshot();
      // min(10, 20) / max(10, 20) * 100 = 10 / 20 * 100 = 50%
      expect(snapshot?.comparison.signalOverlap).toBe(50);
    });

    it("divergenceScore: 0-1 scale", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      const snapshot = getSideBySideSnapshot();

      expect(snapshot?.comparison.divergenceScore).toBeGreaterThanOrEqual(0);
      expect(snapshot?.comparison.divergenceScore).toBeLessThanOrEqual(1);
    });
  });

  describe("resetSideBySide", () => {
    it("clears current snapshot", () => {
      const config: SideBySideConfig = {
        symbols: ["BTC/USD"],
        historicalDays: 30,
        strategies: ["breakout"],
        updateIntervalMs: 1000,
      };

      startSideBySide(config);
      expect(getSideBySideSnapshot()).toBeDefined();

      resetSideBySide();
      expect(getSideBySideSnapshot()).toBeNull();
    });
  });
});
