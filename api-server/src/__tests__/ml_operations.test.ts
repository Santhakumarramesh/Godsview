/**
 * Tests for ml_operations.ts — Champion/challenger evaluation logic.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateChampionVsChallenger,
  ML_OPS_CONFIG,
  type LivePerformance,
} from "../lib/ml_operations";

// ── Champion vs Challenger Evaluation ──────────────────────────

describe("evaluateChampionVsChallenger", () => {
  const baseChampion: LivePerformance = {
    accuracy: 0.65,
    brier_score: 0.22,
    trade_count: 100,
    win_rate: 0.60,
  };

  describe("insufficient data", () => {
    it("returns insufficient_data when champion has too few trades", () => {
      const champion = { ...baseChampion, trade_count: 5 };
      const challenger = { ...baseChampion, accuracy: 0.70, brier_score: 0.18, trade_count: 100 };
      const result = evaluateChampionVsChallenger(champion, challenger);
      expect(result.verdict).toBe("insufficient_data");
    });

    it("returns insufficient_data when challenger has too few trades", () => {
      const challenger = { ...baseChampion, trade_count: 10 };
      const result = evaluateChampionVsChallenger(baseChampion, challenger);
      expect(result.verdict).toBe("insufficient_data");
    });

    it("returns insufficient_data when both have too few trades", () => {
      const result = evaluateChampionVsChallenger(
        { ...baseChampion, trade_count: 3 },
        { ...baseChampion, trade_count: 7 },
      );
      expect(result.verdict).toBe("insufficient_data");
    });
  });

  describe("challenger wins", () => {
    it("challenger wins with significantly better Brier score", () => {
      const challenger: LivePerformance = {
        accuracy: 0.66,       // slightly better
        brier_score: 0.15,    // much better (lower)
        trade_count: 100,
        win_rate: 0.62,
      };
      const result = evaluateChampionVsChallenger(baseChampion, challenger);
      expect(result.verdict).toBe("challenger_wins");
      expect(result.improvement_pct).toBeGreaterThan(0);
    });

    it("challenger wins with better accuracy and Brier", () => {
      const challenger: LivePerformance = {
        accuracy: 0.72,
        brier_score: 0.17,
        trade_count: 80,
        win_rate: 0.65,
      };
      const result = evaluateChampionVsChallenger(baseChampion, challenger);
      expect(result.verdict).toBe("challenger_wins");
    });
  });

  describe("champion holds", () => {
    it("champion holds when challenger is worse", () => {
      const challenger: LivePerformance = {
        accuracy: 0.55,
        brier_score: 0.30,
        trade_count: 100,
        win_rate: 0.50,
      };
      const result = evaluateChampionVsChallenger(baseChampion, challenger);
      expect(result.verdict).toBe("champion_holds");
      expect(result.improvement_pct).toBeLessThan(0);
    });
  });

  describe("draw", () => {
    it("returns draw when metrics are very similar", () => {
      const challenger: LivePerformance = {
        accuracy: 0.651,      // barely different
        brier_score: 0.219,   // barely different
        trade_count: 100,
        win_rate: 0.60,
      };
      const result = evaluateChampionVsChallenger(baseChampion, challenger);
      expect(result.verdict).toBe("draw");
      expect(Math.abs(result.improvement_pct)).toBeLessThan(ML_OPS_CONFIG.PROMOTION_THRESHOLD_PCT);
    });
  });

  describe("edge cases", () => {
    it("handles zero champion accuracy gracefully", () => {
      const champion: LivePerformance = {
        accuracy: 0,
        brier_score: 0.5,
        trade_count: 50,
        win_rate: 0,
      };
      const challenger: LivePerformance = {
        accuracy: 0.60,
        brier_score: 0.25,
        trade_count: 50,
        win_rate: 0.55,
      };
      const result = evaluateChampionVsChallenger(champion, challenger);
      // Should not throw, and challenger should win (better Brier)
      expect(["challenger_wins", "draw"]).toContain(result.verdict);
    });

    it("handles zero champion Brier gracefully", () => {
      const champion: LivePerformance = {
        accuracy: 0.65,
        brier_score: 0,
        trade_count: 50,
        win_rate: 0.60,
      };
      const challenger: LivePerformance = {
        accuracy: 0.70,
        brier_score: 0.20,
        trade_count: 50,
        win_rate: 0.65,
      };
      const result = evaluateChampionVsChallenger(champion, challenger);
      expect(result).toBeDefined();
      expect(typeof result.verdict).toBe("string");
    });

    it("exactly at MIN_EVALUATION_TRADES is sufficient", () => {
      const min = ML_OPS_CONFIG.MIN_EVALUATION_TRADES;
      const result = evaluateChampionVsChallenger(
        { ...baseChampion, trade_count: min },
        { ...baseChampion, trade_count: min },
      );
      expect(result.verdict).not.toBe("insufficient_data");
    });

    it("one below MIN_EVALUATION_TRADES is insufficient", () => {
      const min = ML_OPS_CONFIG.MIN_EVALUATION_TRADES;
      const result = evaluateChampionVsChallenger(
        { ...baseChampion, trade_count: min - 1 },
        { ...baseChampion, trade_count: min },
      );
      expect(result.verdict).toBe("insufficient_data");
    });
  });

  describe("result structure", () => {
    it("always returns verdict, improvement_pct, and reason", () => {
      const result = evaluateChampionVsChallenger(baseChampion, baseChampion);
      expect(result).toHaveProperty("verdict");
      expect(result).toHaveProperty("improvement_pct");
      expect(result).toHaveProperty("reason");
      expect(typeof result.verdict).toBe("string");
      expect(typeof result.improvement_pct).toBe("number");
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });
});

// ── ML_OPS_CONFIG ──────────────────────────────────────────────

describe("ML_OPS_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(ML_OPS_CONFIG.MIN_EVALUATION_TRADES).toBeGreaterThanOrEqual(10);
    expect(ML_OPS_CONFIG.PROMOTION_THRESHOLD_PCT).toBeGreaterThan(0);
    expect(ML_OPS_CONFIG.SHADOW_MIN_DAYS).toBeGreaterThanOrEqual(1);
    expect(ML_OPS_CONFIG.MAX_RETIRED_VERSIONS).toBeGreaterThanOrEqual(1);
  });
});
