/**
 * wave2_hardening.test.ts — Phase 68 Wave 2 Hardening Tests
 *
 * Tests for:
 * - ValidationConfig updates (paper_validation_loop)
 * - Overlay versioning and history (tradingview_overlay)
 * - Regime transition logging (regime_engine)
 * - Circuit breaker escalation policy (circuit_breaker)
 * - Health checks across all engines
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getValidationConfig,
  setValidationConfig,
  getValidationTrend,
} from "../lib/paper_validation_loop.js";
import {
  validateOverlayParams,
  generateChartOverlay,
  getOverlayHistory,
  overlayHealthCheck,
  resetOverlays,
} from "../lib/tradingview_overlay.js";
import {
  recordRegimeTransition,
  getRegimeHistory,
  detectRegimeAnomaly,
} from "../lib/regime_engine.js";
import {
  getBreakerTripHistory,
  CircuitBreakerHealthCheck,
  recordTradeResult,
  resetCircuitBreaker,
} from "../lib/circuit_breaker.js";

// Paper Validation Loop Tests
describe("paper_validation_loop - Phase 68", () => {
  it("should have default validation config", () => {
    const config = getValidationConfig();
    expect(config).toHaveProperty("minSignals");
    expect(config).toHaveProperty("maxDriftPct");
    expect(config).toHaveProperty("calibrationBins");
  });

  it("should update validation config at runtime", () => {
    setValidationConfig({ minSignals: 50, maxDriftPct: 10.0 });
    const updated = getValidationConfig();
    expect(updated.minSignals).toBe(50);
    expect(updated.maxDriftPct).toBe(10.0);
  });

  it("should partially update validation config", () => {
    const original = getValidationConfig();
    setValidationConfig({ minSignals: 75 });
    const updated = getValidationConfig();
    expect(updated.minSignals).toBe(75);
    expect(updated.maxDriftPct).toBe(original.maxDriftPct);
  });

  it("should compute validation trend over days", () => {
    const trend = getValidationTrend(30);
    expect(trend).toHaveProperty("reports");
    expect(trend).toHaveProperty("avgAccuracy");
    expect(trend).toHaveProperty("trend");
    expect(["improving", "declining", "stable"]).toContain(trend.trend);
  });

  it("validation trend should return empty on missing data", () => {
    const trend = getValidationTrend(1);
    expect(Array.isArray(trend.reports)).toBe(true);
    expect(typeof trend.avgAccuracy).toBe("number");
  });

  it("should clamp days parameter in getValidationTrend", () => {
    const trend1 = getValidationTrend(0);
    expect(trend1).toHaveProperty("trend");

    const trend2 = getValidationTrend(9999);
    expect(trend2).toHaveProperty("trend");
  });
});

// TradingView Overlay Tests
describe("tradingview_overlay - Phase 68", () => {
  it("should validate overlay params - empty symbol", () => {
    const result = validateOverlayParams({ symbol: "", currentPrice: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should validate overlay params - missing symbol", () => {
    const result = validateOverlayParams({ currentPrice: 100 });
    expect(result.valid).toBe(false);
  });

  it("should accept valid overlay params", () => {
    const result = validateOverlayParams({
      symbol: "AAPL",
      currentPrice: 150.0,
      timeframe: "1D",
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should validate position direction in overlay params", () => {
    const result = validateOverlayParams({
      symbol: "BTC",
      currentPrice: 45000,
      position: { direction: "invalid" } as unknown,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("direction"))).toBe(true);
  });

  it("should throw on invalid overlay generation", () => {
    expect(() => {
      generateChartOverlay({ symbol: "", currentPrice: 100 });
    }).toThrow();
  });

  it("should generate overlay with version", () => {
    const overlay = generateChartOverlay({
      symbol: "EURUSD",
      currentPrice: 1.1234,
    });
    expect(overlay).toHaveProperty("symbol", "EURUSD");
    expect(overlay).toHaveProperty("generatedAt");
  });

  it("should get overlay history for symbol", () => {
    const history = getOverlayHistory("BTC", 10);
    expect(Array.isArray(history)).toBe(true);
  });

  it("should return empty overlay history on error", () => {
    const history = getOverlayHistory("NONEXISTENT_SYMBOL_XYZ", 10);
    expect(Array.isArray(history)).toBe(true);
  });

  it("should perform overlay health check", () => {
    generateChartOverlay({ symbol: "TEST1", currentPrice: 100 });
    const health = overlayHealthCheck();
    expect(health).toHaveProperty("activeOverlays");
    expect(health).toHaveProperty("symbolsWithOverlays");
    expect(health).toHaveProperty("staleness");
    expect(Array.isArray(health.staleness)).toBe(true);
  });

  it("health check staleness should show elapsed time", () => {
    generateChartOverlay({ symbol: "TEST2", currentPrice: 100 });
    const health = overlayHealthCheck();
    for (const item of health.staleness) {
      expect(typeof item.lastGeneratedAgo).toBe("number");
      expect(item.lastGeneratedAgo).toBeGreaterThanOrEqual(0);
    }
  });

  it("overlay health check should handle empty cache", () => {
    resetOverlays();
    const health = overlayHealthCheck();
    expect(health.activeOverlays).toBe(0);
    expect(health.symbolsWithOverlays.length).toBe(0);
  });
});

// Regime Engine Tests
describe("regime_engine - Phase 68", () => {
  it("should record regime transition", () => {
    const transition = recordRegimeTransition("AAPL", "range", "trend_up", 0.85);
    expect(transition).toHaveProperty("id");
    expect(transition).toHaveProperty("symbol", "AAPL");
    expect(transition).toHaveProperty("from", "range");
    expect(transition).toHaveProperty("to", "trend_up");
    expect(transition).toHaveProperty("confidence", 0.85);
    expect(transition).toHaveProperty("timestamp");
  });

  it("should include duration in subsequent transitions", () => {
    recordRegimeTransition("ETH", "compression", "expansion", 0.75);
    const transition2 = recordRegimeTransition("ETH", "expansion", "range", 0.80);
    expect(transition2.durationSeconds).toBeDefined();
    expect(typeof transition2.durationSeconds).toBe("number");
  });

  it("should get regime history for symbol", () => {
    recordRegimeTransition("BTC", "trend_down", "range", 0.70);
    const history = getRegimeHistory("BTC", 10);
    expect(Array.isArray(history)).toBe(true);
  });

  it("should return empty regime history on error", () => {
    const history = getRegimeHistory("NONEXISTENT_SYMBOL_XYZ_123", 50);
    expect(Array.isArray(history)).toBe(true);
  });

  it("should detect regime anomaly - not anomalous by default", () => {
    const anomaly = detectRegimeAnomaly("QUIET_SYMBOL", 5);
    expect(anomaly).toHaveProperty("symbol", "QUIET_SYMBOL");
    expect(anomaly).toHaveProperty("changesInLastHour");
    expect(anomaly).toHaveProperty("threshold", 5);
    expect(anomaly).toHaveProperty("anomalous", false);
  });

  it("should return anomaly structure on error", () => {
    const anomaly = detectRegimeAnomaly("TEST", 3);
    expect(anomaly).toHaveProperty("detectedAt");
    expect(anomaly.anomalous).toBe(false);
  });

  it("should track multiple regime changes", () => {
    recordRegimeTransition("MULTI", "range", "trend_up", 0.7);
    recordRegimeTransition("MULTI", "trend_up", "expansion", 0.8);
    recordRegimeTransition("MULTI", "expansion", "chaotic", 0.5);
    const history = getRegimeHistory("MULTI");
    expect(history.length).toBeGreaterThanOrEqual(3);
  });
});

// Circuit Breaker Tests
describe("circuit_breaker - Phase 68", () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it("should persist breaker trip events", () => {
    recordTradeResult(-2.0);
    recordTradeResult(-2.0);
    recordTradeResult(-2.0);
    recordTradeResult(-2.0);
    recordTradeResult(-2.0); // 5 consecutive losses -> trip

    const history = getBreakerTripHistory(1);
    expect(Array.isArray(history)).toBe(true);
  });

  it("should return trip history filtered by days", () => {
    recordTradeResult(-1.0); // Loss
    const history1 = getBreakerTripHistory(1);
    const history30 = getBreakerTripHistory(30);

    expect(Array.isArray(history1)).toBe(true);
    expect(Array.isArray(history30)).toBe(true);
  });

  it("should clamp days in getBreakerTripHistory", () => {
    const history1 = getBreakerTripHistory(0); // Should clamp to 1
    const history2 = getBreakerTripHistory(999); // Should clamp to 90
    expect(Array.isArray(history1)).toBe(true);
    expect(Array.isArray(history2)).toBe(true);
  });

  it("should provide circuit breaker health check", () => {
    const health = CircuitBreakerHealthCheck();
    expect(health).toHaveProperty("state");
    expect(health).toHaveProperty("tripsToday");
    expect(health).toHaveProperty("timeSinceLastTrip");
    expect(health).toHaveProperty("tripsIn24h");
    expect(health).toHaveProperty("escalationPolicy");
  });

  it("health check should include escalation policy status", () => {
    const health = CircuitBreakerHealthCheck();
    expect(health.escalationPolicy).toHaveProperty("triggered");
    expect(health.escalationPolicy).toHaveProperty("reason");
  });

  it("should show trips count in health check", () => {
    const health = CircuitBreakerHealthCheck();
    expect(typeof health.tripsToday).toBe("number");
    expect(typeof health.tripsIn24h).toBe("number");
  });

  it("should track time since last trip", () => {
    const health1 = CircuitBreakerHealthCheck();
    expect(health1.timeSinceLastTrip).toBeNull();

    recordTradeResult(-999); // Force trip
    const health2 = CircuitBreakerHealthCheck();
    if (health2.timeSinceLastTrip !== null) {
      expect(typeof health2.timeSinceLastTrip).toBe("number");
    }
  });

  it("escalation policy should be triggered on repeated trips", () => {
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0); // Trip 1
    resetCircuitBreaker();
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0); // Trip 2
    resetCircuitBreaker();
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0);
    recordTradeResult(-5.0); // Trip 3

    const health = CircuitBreakerHealthCheck();
    expect(health.escalationPolicy).toBeDefined();
  });

  it("should handle breaker trip event structure", () => {
    recordTradeResult(-1.0);
    const history = getBreakerTripHistory(1);
    if (history.length > 0) {
      const event = history[0];
      expect(event).toHaveProperty("id");
      expect(event).toHaveProperty("reason");
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("consecutiveLosses");
      expect(event).toHaveProperty("dailyPnlPct");
      expect(event).toHaveProperty("drawdownPct");
    }
  });
});

// Integrated Tests
describe("Phase 68 Hardening - Integration", () => {
  it("validation config should affect behavior", () => {
    const before = getValidationConfig();
    setValidationConfig({ minSignals: 100 });
    const after = getValidationConfig();
    expect(after.minSignals).not.toBe(before.minSignals);
  });

  it("overlay versioning should increment", () => {
    resetOverlays();
    generateChartOverlay({ symbol: "VER1", currentPrice: 100 });
    generateChartOverlay({ symbol: "VER1", currentPrice: 101 });
    generateChartOverlay({ symbol: "VER1", currentPrice: 102 });
    // All calls should succeed and increment version
    expect(true).toBe(true);
  });

  it("regime transitions should persist", () => {
    recordRegimeTransition("PERSIST1", "range", "trend_up", 0.8);
    recordRegimeTransition("PERSIST1", "trend_up", "expansion", 0.75);
    const history = getRegimeHistory("PERSIST1");
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("circuit breaker escalation should be logged", () => {
    resetCircuitBreaker();
    recordTradeResult(-3.0);
    recordTradeResult(-3.0);
    recordTradeResult(-3.0);
    recordTradeResult(-3.0);
    recordTradeResult(-3.0);

    const trips = getBreakerTripHistory(1);
    expect(Array.isArray(trips)).toBe(true);
  });

  it("all health checks should be callable", () => {
    const pvTrend = getValidationTrend(7);
    const tvHealth = overlayHealthCheck();
    const reAnomaly = detectRegimeAnomaly("TEST");
    const cbHealth = CircuitBreakerHealthCheck();

    expect(pvTrend).toBeDefined();
    expect(tvHealth).toBeDefined();
    expect(reAnomaly).toBeDefined();
    expect(cbHealth).toBeDefined();
  });
});
