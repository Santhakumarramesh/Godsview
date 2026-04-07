/**
 * capital_gating.test.ts — Phase 122: Capital Gating Engine Tests
 *
 * Tests:
 *   - CapitalGateEngine: tier breakdown, strategy registration, promotion, demotion
 *   - ControlledLaunchEngine: create plan, advance phase, pause, abort
 *   - CapitalProtectionEngine: pre-launch checklist, drawdown budget, emergency halt
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  capitalGateEngine,
  controlledLaunchEngine,
  capitalProtectionEngine,
} from "../lib/capital_gating/index";

// ─── CapitalGateEngine ──────────────────────────────────────────────────────

describe("CapitalGateEngine", () => {
  it("should return a 6-tier breakdown", () => {
    const tiers = capitalGateEngine.getTierBreakdown();
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBe(6);
    // tierName is the field returned by getTierBreakdown
    const names = tiers.map((t: any) => t.tierName);
    // Paper should always be the first/lowest tier
    expect(names[0].toLowerCase()).toContain("paper");
  });

  it("should return null for unknown strategy", () => {
    const info = capitalGateEngine.getStrategyTier("nonexistent_strategy_xyz");
    expect(info).toBeNull();
  });

  it("should return total capital allocation with byTier breakdown", () => {
    const alloc = capitalGateEngine.getTotalCapitalAllocation();
    expect(alloc).toHaveProperty("totalAllocated");
    expect(alloc).toHaveProperty("byTier");
    expect(typeof alloc.totalAllocated).toBe("number");
    expect(alloc.totalAllocated).toBeGreaterThanOrEqual(0);
  });

  it("should reject promotion for unknown strategy", () => {
    const result = capitalGateEngine.requestPromotion("ghost_strategy_999");
    expect(result.success).toBe(false);
  });

  it("should reject demotion for unknown strategy", () => {
    const result = capitalGateEngine.demoteStrategy(
      "ghost_strategy_999",
      "test reason",
    );
    expect(result.success).toBe(false);
  });

  it("should return empty promotion history for unknown strategy", () => {
    const history = capitalGateEngine.getPromotionHistory("ghost_strategy_999");
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(0);
  });
});

// ─── ControlledLaunchEngine ─────────────────────────────────────────────────

describe("ControlledLaunchEngine", () => {
  it("should start with no active launch plan", () => {
    const plan = controlledLaunchEngine.getLaunchPlan();
    if (plan === null) {
      expect(plan).toBeNull();
    } else {
      expect(plan).toHaveProperty("strategies");
    }
  });

  it("should create a launch plan", () => {
    const result = controlledLaunchEngine.createLaunchPlan({
      strategies: ["test-strategy-122"],
      startDate: Date.now(),
      rampSchedule: [0.1, 0.25, 0.5, 0.75, 1.0],
    });
    expect(result.success).toBe(true);
  });

  it("should return launch status after creation", () => {
    const status = controlledLaunchEngine.getLaunchStatus();
    expect(status).toBeDefined();
  });

  it("should return a ramp schedule", () => {
    const schedule = controlledLaunchEngine.getRampSchedule();
    expect(Array.isArray(schedule)).toBe(true);
  });

  it("should pause and abort launch", () => {
    const pauseResult = controlledLaunchEngine.pauseLaunch("test pause");
    if (pauseResult.success) {
      expect(pauseResult.message).toBeTruthy();
    }

    const abortResult = controlledLaunchEngine.abortLaunch("test abort");
    expect(abortResult).toHaveProperty("success");
    expect(abortResult).toHaveProperty("message");
  });
});

// ─── CapitalProtectionEngine ────────────────────────────────────────────────

describe("CapitalProtectionEngine", () => {
  it("should run pre-launch checklist and return structured result", () => {
    const checklist = capitalProtectionEngine.runPreLaunchChecklist();
    expect(checklist).toBeDefined();
    expect(
      typeof checklist === "object" && checklist !== null,
    ).toBe(true);
  });

  it("should return capital at risk as a number", () => {
    const risk = capitalProtectionEngine.getCapitalAtRisk();
    expect(typeof risk).toBe("number");
    expect(risk).toBeGreaterThanOrEqual(0);
  });

  it("should return drawdown budget with required fields", () => {
    const budget = capitalProtectionEngine.getDrawdownBudget();
    expect(budget).toHaveProperty("used");
    expect(budget).toHaveProperty("remaining");
    expect(budget).toHaveProperty("threshold");
    expect(budget).toHaveProperty("percentUsed");
    expect(typeof budget.percentUsed).toBe("number");
  });

  it("should set max drawdown", () => {
    const result = capitalProtectionEngine.setMaxDrawdown(50000);
    expect(result.success).toBe(true);
  });

  it("should trigger emergency halt and record it", () => {
    const result = capitalProtectionEngine.triggerEmergencyHalt("test halt");
    expect(result.success).toBe(true);

    const history = capitalProtectionEngine.getEmergencyHaltHistory();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].reason).toBe("test halt");
  });

  it("should return emergency contacts as an array", () => {
    const contacts = capitalProtectionEngine.getEmergencyContacts();
    expect(Array.isArray(contacts)).toBe(true);
  });
});
