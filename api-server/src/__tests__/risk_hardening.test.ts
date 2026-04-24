/**
 * Tests for Phase 4: Risk + Execution Hardening
 *
 * Tests: kill switch, exposure guard, live mode gate, pre-trade guard
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  activateKillSwitch,
  deactivateKillSwitch,
  getKillSwitchState,
  guardOrderSubmission,
  isTradingAllowed,
  _resetKillSwitch,
} from "../lib/risk/kill_switch";
import {
  checkExposure,
  guardExposure,
  type PortfolioSnapshot,
  _resetExposureLimits,
} from "../lib/risk/exposure_guard";
import {
  evaluateLivePreflight,
  isLiveModeAvailable,
  type StrategyEvidence,
  type SystemHealthSnapshot,
} from "../lib/risk/live_mode_gate";

// ── Kill Switch Tests ───────────────────────────────────────────────────────

describe("Kill Switch", () => {
  beforeEach(() => _resetKillSwitch());

  it("starts inactive", () => {
    const state = getKillSwitchState();
    expect(state.active).toBe(false);
    expect(state.tripCount).toBe(0);
  });

  it("activates and blocks trading", () => {
    const result = activateKillSwitch("drawdown_halt", "system");
    expect(result).toBe(true);
    expect(isTradingAllowed()).toBe(false);
    expect(getKillSwitchState().active).toBe(true);
    expect(getKillSwitchState().reason).toBe("drawdown_halt");
  });

  it("blocks duplicate activations", () => {
    activateKillSwitch("drawdown_halt");
    const second = activateKillSwitch("operator_manual");
    expect(second).toBe(false);
    expect(getKillSwitchState().tripCount).toBe(1);
  });

  it("guardOrderSubmission throws when active", () => {
    activateKillSwitch("circuit_breaker_escalation");
    expect(() => guardOrderSubmission("AAPL:momentum")).toThrow(/Kill switch active/);
  });

  it("cannot be deactivated by system", () => {
    activateKillSwitch("drawdown_halt");
    const result = deactivateKillSwitch("system");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires operator/);
  });

  it("can be deactivated by operator with cooldown", () => {
    activateKillSwitch("operator_manual");
    const result = deactivateKillSwitch("operator_sakthi");
    expect(result.success).toBe(true);
    expect(getKillSwitchState().active).toBe(false);
    expect(getKillSwitchState().cooldownUntil).not.toBeNull();
  });

  it("blocks trading during cooldown", () => {
    activateKillSwitch("operator_manual");
    deactivateKillSwitch("operator_sakthi");
    // Cooldown is 30 min, so trading should still be blocked
    expect(isTradingAllowed()).toBe(false);
  });
});

// ── Exposure Guard Tests ────────────────────────────────────────────────────

describe("Exposure Guard", () => {
  beforeEach(() => _resetExposureLimits());

  const makePortfolio = (overrides?: Partial<PortfolioSnapshot>): PortfolioSnapshot => ({
    totalCapital: 100000,
    openPositions: [],
    dailyNewPositionCount: 0,
    date: "2026-04-07",
    ...overrides,
  });

  it("approves a valid small position", () => {
    const result = checkExposure(
      { symbol: "AAPL", strategy: "momentum", notionalValue: 3000, direction: "long" },
      makePortfolio(),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects oversized position", () => {
    const result = checkExposure(
      { symbol: "AAPL", strategy: "momentum", notionalValue: 10000, direction: "long" },
      makePortfolio(),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "max_position_size")).toBe(true);
  });

  it("rejects when portfolio exposure exceeded", () => {
    const portfolio = makePortfolio({
      openPositions: [
        { symbol: "MSFT", strategy: "momentum", notionalValue: 58000, direction: "long", entryTime: "" },
      ],
    });
    const result = checkExposure(
      { symbol: "AAPL", strategy: "momentum", notionalValue: 4000, direction: "long" },
      portfolio,
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "max_portfolio_exposure")).toBe(true);
  });

  it("rejects when max concurrent positions reached", () => {
    const positions = Array.from({ length: 8 }, (_, i) => ({
      symbol: `SYM${i}`,
      strategy: "test",
      notionalValue: 2000,
      direction: "long" as const,
      entryTime: "",
    }));
    const portfolio = makePortfolio({ openPositions: positions });
    const result = checkExposure(
      { symbol: "NEW", strategy: "test", notionalValue: 2000, direction: "long" },
      portfolio,
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "max_concurrent_positions")).toBe(true);
  });

  it("rejects duplicate same-direction position", () => {
    const portfolio = makePortfolio({
      openPositions: [
        { symbol: "AAPL", strategy: "momentum", notionalValue: 3000, direction: "long", entryTime: "" },
      ],
    });
    const result = checkExposure(
      { symbol: "AAPL", strategy: "momentum", notionalValue: 3000, direction: "long" },
      portfolio,
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "duplicate_position")).toBe(true);
  });

  it("guardExposure throws on violation", () => {
    expect(() =>
      guardExposure(
        { symbol: "AAPL", strategy: "x", notionalValue: 100000, direction: "long" },
        makePortfolio(),
      ),
    ).toThrow(/Exposure guard violation/);
  });
});

// ── Live Mode Gate Tests ────────────────────────────────────────────────────

describe("Live Mode Gate", () => {
  const goodEvidence: StrategyEvidence = {
    strategyId: "momentum_v1",
    walkForwardPassed: true,
    oosWinRate: 0.58,
    oosSharpe: 1.2,
    oosDegrade: 0.10,
    paperTradingDays: 45,
    paperTradingTrades: 80,
    paperTradingWinRate: 0.55,
    paperTradingPnl: 2500,
    calibrationDrift: 0.05,
    lastReviewedAt: "2026-04-01T10:00:00Z",
    operatorApproved: true,
  };

  const goodHealth: SystemHealthSnapshot = {
    dataFeedHealthy: true,
    dataFeedLatencyMs: 200,
    brokerConnected: true,
    brokerLatencyMs: 150,
    killSwitchActive: false,
    killSwitchCooldown: false,
    riskLimitsConfigured: true,
    memoryUsagePct: 45,
    cpuUsagePct: 30,
    uptimeMinutes: 60,
  };

  it("approves with full evidence and healthy system", () => {
    const result = evaluateLivePreflight(goodEvidence, goodHealth, "live");
    expect(result.allPassed).toBe(true);
    expect(result.recommendation).toBe("approve");
    expect(result.blockers).toHaveLength(0);
  });

  it("denies when walk-forward not passed", () => {
    const evidence = { ...goodEvidence, walkForwardPassed: false };
    const result = evaluateLivePreflight(evidence, goodHealth, "live");
    expect(result.allPassed).toBe(false);
    expect(result.blockers.some(b => b.includes("Walk-forward"))).toBe(true);
  });

  it("denies when paper trading insufficient", () => {
    const evidence = { ...goodEvidence, paperTradingDays: 10, paperTradingTrades: 15 };
    const result = evaluateLivePreflight(evidence, goodHealth, "live");
    expect(result.allPassed).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(2);
  });

  it("denies when kill switch is active", () => {
    const health = { ...goodHealth, killSwitchActive: true };
    const result = evaluateLivePreflight(goodEvidence, health, "live");
    expect(result.allPassed).toBe(false);
  });

  it("denies when operator not approved", () => {
    const evidence = { ...goodEvidence, operatorApproved: false };
    const result = evaluateLivePreflight(evidence, goodHealth, "live");
    expect(result.allPassed).toBe(false);
    expect(result.blockers.some(b => b.includes("Operator"))).toBe(true);
  });

  it("denies when mode is paper", () => {
    const result = evaluateLivePreflight(goodEvidence, goodHealth, "paper");
    expect(result.allPassed).toBe(false);
  });

  it("isLiveModeAvailable returns false for paper mode", () => {
    const result = isLiveModeAvailable(goodHealth, "paper");
    expect(result.available).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("isLiveModeAvailable returns true for live mode with healthy system", () => {
    const result = isLiveModeAvailable(goodHealth, "live");
    expect(result.available).toBe(true);
  });
});
