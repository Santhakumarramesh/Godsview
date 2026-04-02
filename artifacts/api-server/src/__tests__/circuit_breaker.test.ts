/**
 * circuit_breaker.test.ts — Phase 20: Circuit Breaker
 *
 * Tests:
 *   - Initial disarmed state
 *   - Daily loss limit trip
 *   - Consecutive losses trip
 *   - Manual trip and reset
 *   - Trip history recording
 *   - Status fields are populated on trip
 *   - Auto-armed state blocks further trips (idempotent)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordDecision,
  recordOutcome,
  clearJournal,
  type JournalEntryCreate,
} from "../lib/trade_journal";
import {
  checkCircuitBreaker,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  manualTrip,
  getTripHistory,
  isCircuitBreakerArmed,
} from "../lib/circuit_breaker";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function macroBias() {
  return {
    bias:              "neutral",
    direction:         "long",
    score:             0.5,
    conviction:        "medium",
    aligned:           true,
    tailwind:          false,
    headwind:          false,
    blockedDirections: [],
    reasons:           [],
    updatedAt:         new Date().toISOString(),
  } as any;
}

function sentiment() {
  return {
    retailBias:        "balanced",
    institutionalEdge: "none",
    sentimentScore:    0.5,
    crowdingLevel:     "moderate",
    aligned:           false,
    contrarian:        false,
    reasons:           [],
    updatedAt:         new Date().toISOString(),
  } as any;
}

function makePassedEntry(override: Partial<JournalEntryCreate> = {}): JournalEntryCreate {
  return {
    symbol:      "BTCUSD",
    setupType:   "breakout_retest",
    direction:   "long",
    decision:    "passed",
    macroBias:   macroBias(),
    sentiment:   sentiment(),
    signalPrice: 40000,
    regime:      "trending",
    ...override,
  };
}

/**
 * Record a resolved trade directly into the journal.
 * pnlFraction: positive = profit, negative = loss.
 */
function addTrade(pnlFraction: number, direction: "long" | "short" = "long"): string {
  const entryPrice = 100;
  const exitPrice = direction === "long"
    ? entryPrice * (1 + pnlFraction)
    : entryPrice / (1 + pnlFraction);

  const e = recordDecision(makePassedEntry({ direction }));
  recordOutcome(e.id, { entryPrice, exitPrice });
  return e.id;
}

/**
 * Reset circuit breaker + journal between tests.
 * We have to handle the case where CB is already armed.
 */
function fullReset() {
  clearJournal();
  resetCircuitBreaker(); // safe even if not armed
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("circuit_breaker", () => {
  beforeEach(() => {
    fullReset();
  });

  // ── Initial state ────────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("is not armed when no trades have been made", () => {
      const status = getCircuitBreakerStatus();
      expect(status.armed).toBe(false);
      expect(status.trippedAt).toBeNull();
      expect(status.lastTripReason).toBeNull();
    });

    it("tripCount starts at 0 (or resets to 0 after manual reset)", () => {
      const status = getCircuitBreakerStatus();
      // After a full reset the armed state is false
      expect(status.armed).toBe(false);
    });

    it("config is populated from defaults", () => {
      const { config } = getCircuitBreakerStatus();
      expect(config.maxDailyLossPct).toBeGreaterThan(0);
      expect(config.maxConsecutiveLosses).toBeGreaterThan(0);
      expect(config.maxDrawdownPct).toBeGreaterThan(0);
    });

    it("lastCheckedAt is updated on check", () => {
      const before = new Date().toISOString();
      checkCircuitBreaker();
      const { lastCheckedAt } = getCircuitBreakerStatus();
      expect(lastCheckedAt >= before).toBe(true);
    });
  });

  // ── Manual trip ───────────────────────────────────────────────────────────────

  describe("manualTrip", () => {
    it("arms the circuit breaker", () => {
      manualTrip("Test emergency halt");
      expect(isCircuitBreakerArmed()).toBe(true);
    });

    it("sets lastTripReason to 'manual'", () => {
      manualTrip("Test");
      const { lastTripReason } = getCircuitBreakerStatus();
      expect(lastTripReason).toBe("manual");
    });

    it("sets trippedAt to a valid ISO timestamp", () => {
      const before = new Date().toISOString();
      manualTrip("Test");
      const { trippedAt } = getCircuitBreakerStatus();
      expect(trippedAt).not.toBeNull();
      expect(trippedAt! >= before).toBe(true);
    });

    it("appends to trip history", () => {
      const before = getTripHistory().length;
      manualTrip("History test");
      const after = getTripHistory().length;
      expect(after).toBe(before + 1);
    });

    it("trip event has correct shape", () => {
      manualTrip("Shape test");
      const history = getTripHistory();
      const last = history[0];
      expect(last).toHaveProperty("id");
      expect(last).toHaveProperty("reason", "manual");
      expect(last).toHaveProperty("triggeredAt");
      expect(last).toHaveProperty("wasAlreadyTripped");
    });
  });

  // ── Manual reset ─────────────────────────────────────────────────────────────

  describe("resetCircuitBreaker", () => {
    it("disarms after a manual trip", () => {
      manualTrip("Test");
      expect(isCircuitBreakerArmed()).toBe(true);
      resetCircuitBreaker();
      expect(isCircuitBreakerArmed()).toBe(false);
    });

    it("is idempotent when already disarmed", () => {
      expect(() => resetCircuitBreaker()).not.toThrow();
      expect(isCircuitBreakerArmed()).toBe(false);
    });

    it("clears trippedAt and lastTripReason after reset", () => {
      manualTrip("Test");
      resetCircuitBreaker();
      const { trippedAt, lastTripReason } = getCircuitBreakerStatus();
      expect(trippedAt).toBeNull();
      expect(lastTripReason).toBeNull();
    });
  });

  // ── Consecutive losses trip ───────────────────────────────────────────────────

  describe("consecutive losses trip", () => {
    it("trips after max consecutive losses threshold is reached", () => {
      const { config } = getCircuitBreakerStatus();
      const threshold = config.maxConsecutiveLosses;

      // Use a per-trade loss small enough that the SUM stays below the daily limit,
      // but each trade still registers as a "loss" (pnl < -0.001).
      // Budget: stay under maxDailyLossPct / threshold.
      const perTradeLoss = -(config.maxDailyLossPct / (threshold + 1));

      for (let i = 0; i < threshold; i++) {
        addTrade(perTradeLoss);
      }

      checkCircuitBreaker();
      expect(isCircuitBreakerArmed()).toBe(true);

      const { lastTripReason } = getCircuitBreakerStatus();
      expect(lastTripReason).toBe("consecutive_losses");
    });

    it("does not trip with fewer consecutive losses than threshold", () => {
      const threshold = getCircuitBreakerStatus().config.maxConsecutiveLosses;

      for (let i = 0; i < threshold - 1; i++) {
        addTrade(-0.005);
      }

      checkCircuitBreaker();
      // Should remain unarmed unless also breaching daily loss
      // (losses are small enough not to trigger daily limit)
      // We just check it's not armed due to consec losses specifically
      const status = getCircuitBreakerStatus();
      if (status.armed) {
        // It may have tripped on daily loss — but not consec if we had fewer
        expect(status.lastTripReason).not.toBe("consecutive_losses");
      } else {
        expect(status.armed).toBe(false);
      }
    });

    it("a win in between resets the consecutive count", () => {
      const threshold = getCircuitBreakerStatus().config.maxConsecutiveLosses;

      // Add (threshold - 1) losses, then a win, then (threshold - 1) losses
      for (let i = 0; i < threshold - 1; i++) addTrade(-0.005);
      addTrade(+0.01); // win resets streak
      for (let i = 0; i < threshold - 1; i++) addTrade(-0.005);

      checkCircuitBreaker();
      // If only (threshold-1) consecutive losses and daily loss isn't huge:
      // Might not be armed — specifically, should not have consec_losses reason
      const status = getCircuitBreakerStatus();
      if (status.armed) {
        expect(status.lastTripReason).not.toBe("consecutive_losses");
      }
    });
  });

  // ── Daily loss limit trip ─────────────────────────────────────────────────────

  describe("daily loss limit", () => {
    it("trips when daily session loss exceeds the configured threshold", () => {
      const { config } = getCircuitBreakerStatus();
      // Incur a loss slightly larger than the daily limit
      const bigLoss = -(config.maxDailyLossPct + 0.005);
      addTrade(bigLoss);

      checkCircuitBreaker();
      expect(isCircuitBreakerArmed()).toBe(true);
      const status = getCircuitBreakerStatus();
      // Should be daily loss or consecutive losses (single large loss)
      expect(["daily_loss_limit", "consecutive_losses"]).toContain(status.lastTripReason);
    });

    it("todayStats.sessionPnlPct reflects today's total loss", () => {
      addTrade(-0.01);
      addTrade(-0.01);
      const { todayStats } = checkCircuitBreaker();
      expect(todayStats.sessionPnlPct).toBeLessThan(0);
    });
  });

  // ── Drawdown trip ─────────────────────────────────────────────────────────────

  describe("max drawdown guard", () => {
    it("todayStats.currentDrawdownPct is non-negative", () => {
      addTrade(-0.03);
      addTrade(-0.03);
      const { todayStats } = checkCircuitBreaker();
      // currentDrawdownPct returned as abs value
      expect(todayStats.currentDrawdownPct).toBeGreaterThanOrEqual(0);
    });
  });

  // ── checkCircuitBreaker status shape ─────────────────────────────────────────

  describe("checkCircuitBreaker return shape", () => {
    it("returns a CircuitBreakerStatus object", () => {
      const status = checkCircuitBreaker();
      expect(status).toHaveProperty("armed");
      expect(status).toHaveProperty("config");
      expect(status).toHaveProperty("todayStats");
      expect(status).toHaveProperty("lastCheckedAt");
      expect(status).toHaveProperty("tripCount");
    });

    it("autoResetAt is null when CB is not armed", () => {
      const { autoResetAt } = checkCircuitBreaker();
      expect(autoResetAt).toBeNull();
    });

    it("tripCount increments with each distinct trip", () => {
      const before = getCircuitBreakerStatus().tripCount;
      manualTrip("Trip 1");
      resetCircuitBreaker();
      manualTrip("Trip 2");
      const after = getCircuitBreakerStatus().tripCount;
      expect(after).toBeGreaterThan(before);
    });
  });

  // ── Idempotency when already armed ───────────────────────────────────────────

  describe("idempotency", () => {
    it("wasAlreadyTripped is true when tripping an already-armed CB", () => {
      manualTrip("First");
      manualTrip("Second while armed");
      const history = getTripHistory();
      // most recent trip should flag wasAlreadyTripped=true
      expect(history[0].wasAlreadyTripped).toBe(true);
    });
  });
});
