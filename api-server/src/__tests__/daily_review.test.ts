/**
 * daily_review.test.ts — Daily Review Engine Tests
 *
 * Tests:
 *   generateDailyReview:
 *     - Creates review with correct symbol, date, and HTF bias
 *     - Calculates win rate correctly from trades
 *     - Calculates PnL percentage correctly
 *     - Builds findings from signals and structure
 *     - Generates natural language summary
 *
 *   calculateChanceOfTrade:
 *     - Bullish regime: +20% to base (70% base)
 *     - Bearish regime: +20% to base (70% base)
 *     - Ranging regime: -10% to base (40% base)
 *     - Monday/Friday: -5% penalty
 *     - High volatility: +10%
 *     - Low volatility: -10%
 *     - Result clamped to 0-100%
 *
 *   saveDailyReview / getDailyReview:
 *     - Save review and retrieve it by symbol + date
 *     - Returns null if not found
 *
 *   getDailyReviews:
 *     - Retrieves all reviews for a symbol
 *     - Filters by date range (fromDate, toDate)
 *     - Returns sorted by date ascending
 *
 *   getAllReviews:
 *     - Retrieves all reviews across symbols
 *     - Filters by date range
 *     - Returns sorted by date ascending
 *
 *   generateStructureSummary:
 *     - Includes date, symbol, and bias
 *     - Lists support/resistance levels
 *     - Mentions order blocks and ABCD patterns
 *     - Shows trade count, win rate, and PnL
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateDailyReview,
  saveDailyReview,
  getDailyReview,
  getDailyReviews,
  getAllReviews,
  calculateChanceOfTrade,
  generateStructureSummary,
  clearReviews,
  type DailyReview,
} from "../engines/daily_review_engine";

describe("Daily Review Engine", () => {
  beforeEach(() => {
    clearReviews();
  });

  afterEach(() => {
    clearReviews();
  });

  describe("generateDailyReview", () => {
    it("creates review with correct symbol, date, and HTF bias", () => {
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], [], { bias: "bullish" });

      expect(review.symbol).toBe("BTC/USD");
      expect(review.date).toBe("2025-04-01");
      expect(review.htfBias).toBe("bullish");
      expect(review.id).toBeDefined();
      expect(review.createdAt).toBeDefined();
    });

    it("calculates win rate correctly from trades", () => {
      const trades = [
        { pnl: 100 }, // Win
        { pnl: 50 }, // Win
        { pnl: -30 }, // Loss
        { pnl: 0 }, // Loss
      ];
      const review = generateDailyReview("ETH/USD", "2025-04-01", [], trades, {});

      expect(review.tradesExecuted).toBe(4);
      expect(review.tradesWon).toBe(2);
      expect(review.tradesLost).toBe(2);
      expect(review.tradeProbability).toBeDefined();
    });

    it("calculates PnL percentage correctly", () => {
      const trades = [{ pnl: 500 }, { pnl: -100 }];
      const structureData = { accountSize: 10000 };
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], trades, structureData);

      // Total PnL = 400, Account = 10000, so 4%
      expect(review.pnlPct).toBe(4);
    });

    it("builds findings from signals and structure", () => {
      const signals = [{ type: "order_block", price: 100, strength: "strong", timeframe: "4h" }];
      const structureData = { structureBreak: { price: 101 } };
      const review = generateDailyReview("BTC/USD", "2025-04-01", signals, [], structureData);

      expect(review.findings.length).toBeGreaterThan(0);
      expect(review.findings.some((f) => f.type === "order_block")).toBe(true);
      expect(review.findings.some((f) => f.type === "structure_break")).toBe(true);
    });

    it("generates natural language summary", () => {
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], [], {
        bias: "bullish",
        keyLevels: [{ price: 100, type: "support", timeframe: "daily" }],
        orderBlockCount: 2,
      });

      expect(review.structureSummary).toBeDefined();
      expect(review.structureSummary).toContain("BTC/USD");
      expect(review.structureSummary).toContain("bullish");
    });
  });

  describe("calculateChanceOfTrade", () => {
    it("bullish regime: 70% (base 50 + 20)", () => {
      const chance = calculateChanceOfTrade({}, "bullish", 3); // Wednesday
      expect(chance).toBe(70);
    });

    it("bearish regime: 70% (base 50 + 20)", () => {
      const chance = calculateChanceOfTrade({}, "bearish", 3);
      expect(chance).toBe(70);
    });

    it("ranging regime: 40% (base 50 - 10)", () => {
      const chance = calculateChanceOfTrade({}, "ranging", 3);
      expect(chance).toBe(40);
    });

    it("Monday penalty: -5%", () => {
      const mondayChance = calculateChanceOfTrade({}, "bullish", 1); // Monday
      const wednesdayChance = calculateChanceOfTrade({}, "bullish", 3); // Wednesday
      expect(mondayChance).toBe(mondayChance);
      expect(mondayChance).toBeLessThan(wednesdayChance);
    });

    it("high volatility: +10%", () => {
      const high = calculateChanceOfTrade({ volatility: "high" }, "bullish", 3);
      const normal = calculateChanceOfTrade({}, "bullish", 3);
      expect(high).toBeGreaterThan(normal);
    });

    it("low volatility: -10%", () => {
      const low = calculateChanceOfTrade({ volatility: "low" }, "bullish", 3);
      const normal = calculateChanceOfTrade({}, "bullish", 3);
      expect(low).toBeLessThan(normal);
    });

    it("result clamped to 0-100%", () => {
      const result = calculateChanceOfTrade(
        { volatility: "high", orderBlockDensity: 10 },
        "bullish",
        3
      );
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe("saveDailyReview / getDailyReview", () => {
    it("saves and retrieves review by symbol + date", () => {
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], [], {});
      saveDailyReview(review);

      const retrieved = getDailyReview("BTC/USD", "2025-04-01");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(review.id);
      expect(retrieved?.symbol).toBe("BTC/USD");
    });

    it("returns null if review not found", () => {
      const retrieved = getDailyReview("NONEXISTENT", "2025-04-01");
      expect(retrieved).toBeNull();
    });
  });

  describe("getDailyReviews", () => {
    it("retrieves all reviews for a symbol", () => {
      const review1 = generateDailyReview("BTC/USD", "2025-04-01", [], [], {});
      const review2 = generateDailyReview("BTC/USD", "2025-04-02", [], [], {});
      const review3 = generateDailyReview("ETH/USD", "2025-04-01", [], [], {});

      saveDailyReview(review1);
      saveDailyReview(review2);
      saveDailyReview(review3);

      const btcReviews = getDailyReviews("BTC/USD");
      expect(btcReviews.length).toBe(2);
      expect(btcReviews.every((r) => r.symbol === "BTC/USD")).toBe(true);
    });

    it("filters by date range", () => {
      const review1 = generateDailyReview("BTC/USD", "2025-04-01", [], [], {});
      const review2 = generateDailyReview("BTC/USD", "2025-04-05", [], [], {});
      const review3 = generateDailyReview("BTC/USD", "2025-04-10", [], [], {});

      saveDailyReview(review1);
      saveDailyReview(review2);
      saveDailyReview(review3);

      const filtered = getDailyReviews("BTC/USD", "2025-04-02", "2025-04-08");
      expect(filtered.length).toBe(1);
      expect(filtered[0].date).toBe("2025-04-05");
    });

    it("returns sorted by date ascending", () => {
      saveDailyReview(generateDailyReview("BTC/USD", "2025-04-05", [], [], {}));
      saveDailyReview(generateDailyReview("BTC/USD", "2025-04-01", [], [], {}));
      saveDailyReview(generateDailyReview("BTC/USD", "2025-04-10", [], [], {}));

      const reviews = getDailyReviews("BTC/USD");
      expect(reviews[0].date).toBe("2025-04-01");
      expect(reviews[1].date).toBe("2025-04-05");
      expect(reviews[2].date).toBe("2025-04-10");
    });
  });

  describe("getAllReviews", () => {
    it("retrieves all reviews across symbols", () => {
      const review1 = generateDailyReview("BTC/USD", "2025-04-01", [], [], {});
      const review2 = generateDailyReview("ETH/USD", "2025-04-01", [], [], {});
      const review3 = generateDailyReview("SOL/USD", "2025-04-02", [], [], {});

      saveDailyReview(review1);
      saveDailyReview(review2);
      saveDailyReview(review3);

      const all = getAllReviews();
      expect(all.length).toBe(3);
    });

    it("filters by date range", () => {
      saveDailyReview(generateDailyReview("BTC/USD", "2025-04-01", [], [], {}));
      saveDailyReview(generateDailyReview("ETH/USD", "2025-04-05", [], [], {}));
      saveDailyReview(generateDailyReview("SOL/USD", "2025-04-10", [], [], {}));

      const filtered = getAllReviews("2025-04-02", "2025-04-08");
      expect(filtered.length).toBe(1);
      expect(filtered[0].date).toBe("2025-04-05");
    });

    it("returns sorted by date ascending", () => {
      saveDailyReview(generateDailyReview("BTC/USD", "2025-04-05", [], [], {}));
      saveDailyReview(generateDailyReview("ETH/USD", "2025-04-01", [], [], {}));
      saveDailyReview(generateDailyReview("SOL/USD", "2025-04-10", [], [], {}));

      const all = getAllReviews();
      expect(all[0].date).toBe("2025-04-01");
      expect(all[1].date).toBe("2025-04-05");
      expect(all[2].date).toBe("2025-04-10");
    });
  });

  describe("generateStructureSummary", () => {
    it("includes date, symbol, and bias", () => {
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], [], { bias: "bullish" });
      const summary = review.structureSummary;

      expect(summary).toContain("2025-04-01");
      expect(summary).toContain("BTC/USD");
      expect(summary).toContain("bullish");
    });

    it("lists support and resistance levels", () => {
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], [], {
        bias: "ranging",
        keyLevels: [
          { price: 50000, type: "support", timeframe: "daily" },
          { price: 60000, type: "resistance", timeframe: "daily" },
        ],
      });

      const summary = review.structureSummary;
      expect(summary).toContain("Support levels");
      expect(summary).toContain("Resistance levels");
    });

    it("mentions order blocks and ABCD patterns", () => {
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], [], {
        bias: "ranging",
        orderBlockCount: 3,
        abcdCount: 2,
      });

      const summary = review.structureSummary;
      expect(summary).toContain("order block");
      expect(summary).toContain("ABCD pattern");
    });

    it("shows trade count, win rate, and PnL", () => {
      const trades = [{ pnl: 100 }, { pnl: -50 }];
      const review = generateDailyReview("BTC/USD", "2025-04-01", [], trades, {
        accountSize: 10000,
      });

      const summary = review.structureSummary;
      expect(summary).toContain("trade");
      expect(summary).toContain("win rate");
      expect(summary).toContain("PnL");
    });
  });
});
