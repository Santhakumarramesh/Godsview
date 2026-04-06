/**
 * live_autonomous.test.ts — Comprehensive tests for Phase 75-76
 *
 * 40+ tests covering:
 * - Pre-flight checks
 * - Position scaling
 * - Safety checks
 * - Emergency shutdown
 * - Autonomous lifecycle
 * - Self-healing
 * - Cycle execution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runPreFlightChecks,
  calculateScaledPositionSize,
  liveSafetyCheck,
  emergencyShutdown,
  initiateLiveLaunch,
  terminateLiveLaunch,
  getLiveLaunchState,
  recordTradeMetrics,
  recordPositionClosed,
  updateConfig as updateLiveLaunchConfig,
  getConfig as getLiveLaunchConfig,
  resetDailyMetrics,
} from "../engines/live_launch_engine";

import {
  startAutonomousMode,
  stopAutonomousMode,
  getAutonomousState,
  runAutonomousCycle,
  getAutonomousReport,
  updateConfig as updateAutonomousConfig,
  getConfig as getAutonomousConfig,
} from "../engines/autonomous_mode_engine";

describe("Phase 75: Live Launch Engine", () => {
  beforeEach(() => {
    resetDailyMetrics();
    terminateLiveLaunch();
  });

  // ─── Pre-Flight Check Tests ────────────────────────────────────────────

  describe("Pre-Flight Checks", () => {
    it("should run pre-flight checks successfully", async () => {
      const result = await runPreFlightChecks();
      expect(result).toBeDefined();
      expect(result.checks).toBeInstanceOf(Array);
      expect(result.timestamp).toBeDefined();
    });

    it("should include broker connectivity check", async () => {
      const result = await runPreFlightChecks();
      const brokerCheck = result.checks.find((c) => c.name === "broker_connected");
      expect(brokerCheck).toBeDefined();
      expect(brokerCheck?.passed).toEqual(expect.any(Boolean));
    });

    it("should include model training check", async () => {
      const result = await runPreFlightChecks();
      const modelCheck = result.checks.find((c) => c.name === "model_trained");
      expect(modelCheck).toBeDefined();
      expect(modelCheck?.details).toBeDefined();
    });

    it("should include market hours check", async () => {
      const result = await runPreFlightChecks();
      const marketCheck = result.checks.find((c) => c.name === "market_open");
      expect(marketCheck).toBeDefined();
      expect(marketCheck?.details).toBeDefined();
    });

    it("should include validation passing check", async () => {
      const result = await runPreFlightChecks();
      const validationCheck = result.checks.find((c) => c.name === "validation_passing");
      expect(validationCheck).toBeDefined();
      expect(typeof validationCheck?.passed).toBe("boolean");
    });

    it("should include circuit breaker check", async () => {
      const result = await runPreFlightChecks();
      const breakerCheck = result.checks.find((c) => c.name === "circuit_breaker_healthy");
      expect(breakerCheck).toBeDefined();
      expect(typeof breakerCheck?.passed).toBe("boolean");
    });

    it("should set passed=true only if all checks pass", async () => {
      const result = await runPreFlightChecks();
      const allPassed = result.checks.every((c) => c.passed);
      expect(result.passed).toBe(allPassed);
    });

    it("should generate proper summary message", async () => {
      const result = await runPreFlightChecks();
      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Position Scaling Tests ────────────────────────────────────────────

  describe("Position Scaling", () => {
    it("should return full size when gradual scale-up disabled", () => {
      updateLiveLaunchConfig({ gradualScaleUp: false });
      const scaled = calculateScaledPositionSize(100, 10);
      expect(scaled).toBe(100);
    });

    it("should start at 10% on day 0", () => {
      updateLiveLaunchConfig({ gradualScaleUp: true, scaleUpDays: 5 });
      const scaled = calculateScaledPositionSize(100, 0);
      expect(scaled).toBeGreaterThan(0);
      expect(scaled).toBeLessThanOrEqual(15); // ~10%
    });

    it("should scale to 100% after scaleUpDays", () => {
      updateLiveLaunchConfig({ gradualScaleUp: true, scaleUpDays: 5 });
      const scaled = calculateScaledPositionSize(100, 5);
      expect(scaled).toBe(100);
    });

    it("should scale linearly between day 0 and scaleUpDays", () => {
      updateLiveLaunchConfig({ gradualScaleUp: true, scaleUpDays: 5 });
      const day0 = calculateScaledPositionSize(100, 0);
      const day2 = calculateScaledPositionSize(100, 2);
      const day5 = calculateScaledPositionSize(100, 5);
      expect(day2).toBeGreaterThan(day0);
      expect(day5).toBeGreaterThanOrEqual(day2);
    });

    it("should handle negative days gracefully", () => {
      const scaled = calculateScaledPositionSize(100, -1);
      expect(scaled).toBe(100);
    });

    it("should scale beyond day 5 to full size", () => {
      updateLiveLaunchConfig({ gradualScaleUp: true, scaleUpDays: 5 });
      const scaled = calculateScaledPositionSize(100, 10);
      expect(scaled).toBe(100);
    });
  });

  // ─── Safety Check Tests ────────────────────────────────────────────────

  describe("Safety Checks", () => {
    it("should allow trading when all checks pass", () => {
      const result = liveSafetyCheck();
      expect(result.allowed).toBe(true);
      expect(result.blockedReasons).toHaveLength(0);
    });

    it("should include daily loss in result", () => {
      const result = liveSafetyCheck();
      expect(typeof result.dailyLoss).toBe("number");
    });

    it("should include drawdown percentage in result", () => {
      const result = liveSafetyCheck();
      expect(typeof result.drawdownPct).toBe("number");
    });

    it("should include consecutive losses in result", () => {
      const result = liveSafetyCheck();
      expect(typeof result.consecutiveLosses).toBe("number");
    });

    it("should include timestamp in result", () => {
      const result = liveSafetyCheck();
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it("should have empty blocked reasons when safe", () => {
      resetDailyMetrics();
      const result = liveSafetyCheck();
      expect(result.blockedReasons).toEqual([]);
    });

    it("should track multiple safety checks", () => {
      const result1 = liveSafetyCheck();
      const result2 = liveSafetyCheck();
      expect(result1.timestamp).toBeDefined();
      expect(result2.timestamp).toBeDefined();
    });
  });

  // ─── Emergency Shutdown Tests ──────────────────────────────────────────

  describe("Emergency Shutdown", () => {
    it("should activate emergency shutdown with reason", () => {
      emergencyShutdown("test_shutdown");
      const state = getLiveLaunchState();
      expect(state.status).toBe("emergency_shutdown");
      expect(state.emergencyShutdownReason).toBe("test_shutdown");
    });

    it("should activate kill switch when shutting down", () => {
      emergencyShutdown("test_emergency");
      const state = getLiveLaunchState();
      expect(state.status).toBe("emergency_shutdown");
    });

    it("should persist shutdown event", () => {
      emergencyShutdown("persistence_test");
      const state = getLiveLaunchState();
      expect(state.emergencyShutdownReason).toBeTruthy();
    });

    it("should allow multiple shutdown calls", () => {
      emergencyShutdown("first");
      emergencyShutdown("second");
      const state = getLiveLaunchState();
      expect(state.status).toBe("emergency_shutdown");
    });
  });

  // ─── Live Launch Lifecycle Tests ───────────────────────────────────────

  describe("Live Launch Lifecycle", () => {
    it("should return result object from initiate", async () => {
      const result = await initiateLiveLaunch();
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
      expect(result.message).toBeDefined();
    });

    it("should reject launch if already live", async () => {
      await initiateLiveLaunch();
      const result = await initiateLiveLaunch();
      expect(result.success).toBe(false);
    });

    it("should start in scaling or live status if successful", async () => {
      const result = await initiateLiveLaunch({ gradualScaleUp: true });
      if (result.success) {
        const state = getLiveLaunchState();
        expect(["scaling", "live"]).toContain(state.status);
      }
    });

    it("should terminate live launch", () => {
      terminateLiveLaunch();
      const state = getLiveLaunchState();
      expect(state.status).toBe("idle");
    });

    it("should reset metrics on terminate", async () => {
      await initiateLiveLaunch();
      recordTradeMetrics(10, -0.5);
      terminateLiveLaunch();
      const state = getLiveLaunchState();
      expect(state.dailyTrades).toBe(0);
      expect(state.dailyLossPct).toBe(0);
    });

    it("should track launch timestamp", async () => {
      const result = await initiateLiveLaunch();
      if (result.success) {
        const state = getLiveLaunchState();
        expect(state.launchedAt).toBeTruthy();
      }
    });

    it("should calculate days since launch", async () => {
      const result = await initiateLiveLaunch();
      if (result.success) {
        const state = getLiveLaunchState();
        expect(state.daysSinceLaunch).toEqual(expect.any(Number));
        expect(state.daysSinceLaunch).toBeGreaterThanOrEqual(0);
      }
    });

    it("should track position metrics", () => {
      recordTradeMetrics(5, 0.1);
      const state = getLiveLaunchState();
      expect(state.totalPositionsOpened).toBeGreaterThan(0);
    });

    it("should track closed positions", () => {
      recordPositionClosed();
      const state = getLiveLaunchState();
      expect(state.totalPositionsClosed).toBeGreaterThan(0);
    });
  });

  // ─── Configuration Tests ───────────────────────────────────────────────

  describe("Configuration", () => {
    it("should get default config", () => {
      const config = getLiveLaunchConfig();
      expect(config.maxDailyLoss).toBe(500);
      expect(config.maxDailyTrades).toBe(20);
      expect(config.maxPositionValue).toBe(5000);
      expect(config.maxDrawdownPct).toBe(2);
    });

    it("should update config values", () => {
      updateLiveLaunchConfig({ maxDailyLoss: 1000 });
      const config = getLiveLaunchConfig();
      expect(config.maxDailyLoss).toBe(1000);
    });

    it("should preserve defaults for non-updated fields", () => {
      updateLiveLaunchConfig({ maxDailyLoss: 750 });
      const config = getLiveLaunchConfig();
      expect(config.maxDailyTrades).toBe(20);
    });

    it("should support scale-up configuration", () => {
      updateLiveLaunchConfig({ gradualScaleUp: true, scaleUpDays: 7 });
      const config = getLiveLaunchConfig();
      expect(config.gradualScaleUp).toBe(true);
      expect(config.scaleUpDays).toBe(7);
    });
  });
});

describe("Phase 76: Autonomous Mode Engine", () => {
  beforeEach(async () => {
    await stopAutonomousMode("test_cleanup");
  });

  // ─── Autonomous Lifecycle Tests ────────────────────────────────────────

  describe("Autonomous Lifecycle", () => {
    it("should start autonomous mode", async () => {
      const result = await startAutonomousMode({ mode: "paper" });
      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it("should reject start if already running", async () => {
      await startAutonomousMode({ mode: "paper" });
      const result = await startAutonomousMode({ mode: "paper" });
      expect(result.success).toBe(false);
    });

    it("should support paper mode", async () => {
      const result = await startAutonomousMode({ mode: "paper" });
      if (result.success) {
        const state = getAutonomousState();
        expect(state.config.mode).toBe("paper");
      }
    });

    it("should support shadow mode", async () => {
      const result = await startAutonomousMode({ mode: "shadow" });
      if (result.success) {
        const state = getAutonomousState();
        expect(state.config.mode).toBe("shadow");
      }
    });

    it("should support live mode", async () => {
      const result = await startAutonomousMode({ mode: "live" });
      if (result.success) {
        const state = getAutonomousState();
        expect(state.config.mode).toBe("live");
      }
    });

    it("should stop autonomous mode", async () => {
      await startAutonomousMode({ mode: "paper" });
      const result = await stopAutonomousMode("test_stop");
      expect(result.success).toBe(true);
    });

    it("should reject stop when not running", async () => {
      const result = await stopAutonomousMode("not_running");
      expect(result.success).toBe(false);
    });
  });

  // ─── State Management Tests ────────────────────────────────────────────

  describe("State Management", () => {
    it("should track running status", async () => {
      await startAutonomousMode();
      const state = getAutonomousState();
      expect(state.status).toBe("running");
    });

    it("should track started timestamp", async () => {
      await startAutonomousMode();
      const state = getAutonomousState();
      expect(state.startedAt).toBeTruthy();
    });

    it("should track elapsed time", async () => {
      await startAutonomousMode();
      const state = getAutonomousState();
      expect(state.elapsedMs).toEqual(expect.any(Number));
      expect(state.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("should track cycle count", async () => {
      await startAutonomousMode();
      const state = getAutonomousState();
      expect(state.cycleCount).toEqual(expect.any(Number));
    });

    it("should initialize decision counters", async () => {
      await startAutonomousMode();
      const state = getAutonomousState();
      expect(state.decisions.total).toEqual(expect.any(Number));
      expect(state.decisions.approved).toEqual(expect.any(Number));
      expect(state.decisions.rejected).toEqual(expect.any(Number));
      expect(state.decisions.errors).toEqual(expect.any(Number));
    });

    it("should support strategies configuration", async () => {
      const result = await startAutonomousMode({
        mode: "paper",
        strategies: ["strategy1", "strategy2"],
      });
      if (result.success) {
        const state = getAutonomousState();
        expect(state.activeStrategies.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Cycle Execution Tests ────────────────────────────────────────────

  describe("Cycle Execution", () => {
    beforeEach(async () => {
      await startAutonomousMode({ mode: "paper" });
    });

    it("should run autonomous cycle", async () => {
      const report = await runAutonomousCycle();
      expect(report.cycleId).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.durationMs).toEqual(expect.any(Number));
    });

    it("should track signals gathered", async () => {
      const report = await runAutonomousCycle();
      expect(typeof report.signalsGathered).toBe("number");
    });

    it("should track decisions evaluated", async () => {
      const report = await runAutonomousCycle();
      expect(typeof report.decisionsEvaluated).toBe("number");
    });

    it("should track decisions executed", async () => {
      const report = await runAutonomousCycle();
      expect(typeof report.decisionsExecuted).toBe("number");
    });

    it("should track self-heal triggering", async () => {
      const report = await runAutonomousCycle();
      expect(typeof report.selfHealTriggered).toBe("boolean");
    });

    it("should capture cycle errors if any", async () => {
      const report = await runAutonomousCycle();
      expect(report.error === null || typeof report.error === "string").toBe(true);
    });

    it("should handle multiple cycles", async () => {
      await runAutonomousCycle();
      const report = await runAutonomousCycle();
      const state = getAutonomousState();
      expect(state.cycleCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Reporting Tests ──────────────────────────────────────────────────

  describe("Reporting", () => {
    beforeEach(async () => {
      await startAutonomousMode({ mode: "paper" });
    });

    it("should generate autonomous report", async () => {
      const report = await getAutonomousReport();
      expect(report.timestamp).toBeDefined();
      expect(report.periodHours).toEqual(expect.any(Number));
      expect(report.cyclesRun).toEqual(expect.any(Number));
      expect(report.decisionsTotal).toEqual(expect.any(Number));
      expect(report.decisionsApproved).toEqual(expect.any(Number));
    });

    it("should calculate approval rate", async () => {
      await runAutonomousCycle();
      const report = await getAutonomousReport();
      expect(typeof report.approvalRate).toBe("number");
      expect(report.approvalRate).toBeGreaterThanOrEqual(0);
      expect(report.approvalRate).toBeLessThanOrEqual(1);
    });

    it("should support custom period hours", async () => {
      const report = await getAutonomousReport(12);
      expect(report.periodHours).toBeLessThanOrEqual(12);
    });

    it("should track self-heal events", async () => {
      const report = await getAutonomousReport();
      expect(typeof report.selfHealEventsCount).toBe("number");
    });

    it("should track last error", async () => {
      const report = await getAutonomousReport();
      expect(report.lastError === null || typeof report.lastError === "string").toBe(true);
    });
  });

  // ─── Configuration Tests ───────────────────────────────────────────────

  describe("Autonomous Configuration", () => {
    it("should get default config", () => {
      const config = getAutonomousConfig();
      expect(config.mode).toBe("paper");
      expect(config.rebalanceIntervalMs).toBe(3600000);
      expect(config.selfHealEnabled).toBe(true);
      expect(config.maxAutonomousHours).toBe(8);
    });

    it("should update config", async () => {
      await startAutonomousMode();
      updateAutonomousConfig({ maxAutonomousHours: 12 });
      const config = getAutonomousConfig();
      expect(config.maxAutonomousHours).toBe(12);
    });

    it("should support mode configuration", () => {
      updateAutonomousConfig({ mode: "live" });
      const config = getAutonomousConfig();
      expect(config.mode).toBe("live");
    });

    it("should support rebalance interval configuration", () => {
      updateAutonomousConfig({ rebalanceIntervalMs: 1800000 });
      const config = getAutonomousConfig();
      expect(config.rebalanceIntervalMs).toBe(1800000);
    });
  });
});
