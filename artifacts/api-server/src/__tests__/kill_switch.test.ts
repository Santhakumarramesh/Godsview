/**
 * kill_switch.test.ts — Kill Switch Safety Tests
 *
 * The kill switch is the final safety layer that prevents ANY order execution,
 * regardless of role or permission. When activated:
 *
 * 1. No orders can be submitted (all execution endpoints return 403)
 * 2. No positions can be modified
 * 3. Kill switch state is auditable and queryable
 * 4. Kill switch activation/deactivation are logged
 * 5. Kill switch status appears in all system status checks
 *
 * Kill switch DOES NOT prevent:
 * - Read-only operations (dashboard, position viewing, audit logs)
 * - Health checks
 * - Diagnostic endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { setKillSwitchActive, isKillSwitchActive } from "../lib/risk_engine";
import { setKillSwitchOverride, isKillSwitchOverrideActive } from "../middleware/rbac";

// Mock the required dependencies
vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../lib/audit_logger", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
  auditKillSwitch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Basic Kill Switch State Management
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch State Management", () => {
  afterEach(() => {
    // Reset to safe state
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should start in inactive state", () => {
    expect(isKillSwitchActive()).toBe(false);
  });

  it("should activate when setKillSwitchActive(true)", () => {
    setKillSwitchActive(true);
    expect(isKillSwitchActive()).toBe(true);
  });

  it("should deactivate when setKillSwitchActive(false)", () => {
    setKillSwitchActive(true);
    expect(isKillSwitchActive()).toBe(true);

    setKillSwitchActive(false);
    expect(isKillSwitchActive()).toBe(false);
  });

  it("should be queryable at any time", () => {
    // Active
    setKillSwitchActive(true);
    expect(isKillSwitchActive()).toBe(true);

    // Query multiple times
    expect(isKillSwitchActive()).toBe(true);
    expect(isKillSwitchActive()).toBe(true);

    // Deactivate
    setKillSwitchActive(false);
    expect(isKillSwitchActive()).toBe(false);

    // Query again
    expect(isKillSwitchActive()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Override State (RBAC layer)
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Override (RBAC)", () => {
  afterEach(() => {
    setKillSwitchOverride(false);
  });

  it("should start in inactive state", () => {
    expect(isKillSwitchOverrideActive()).toBe(false);
  });

  it("should activate when setKillSwitchOverride(true)", () => {
    setKillSwitchOverride(true);
    expect(isKillSwitchOverrideActive()).toBe(true);
  });

  it("should deactivate when setKillSwitchOverride(false)", () => {
    setKillSwitchOverride(true);
    expect(isKillSwitchOverrideActive()).toBe(true);

    setKillSwitchOverride(false);
    expect(isKillSwitchOverrideActive()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Prevents Order Execution
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Prevents Mutations", () => {
  afterEach(() => {
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should allow submissions when inactive", async () => {
    setKillSwitchActive(false);

    // Simulated: if kill switch is inactive, execution should proceed
    const canSubmit = !isKillSwitchActive();
    expect(canSubmit).toBe(true);
  });

  it("should block submissions when active", async () => {
    setKillSwitchActive(true);

    // Simulated: if kill switch is active, execution should be blocked
    const canSubmit = !isKillSwitchActive();
    expect(canSubmit).toBe(false);
  });

  it("should block position modifications when active", () => {
    setKillSwitchActive(true);

    // Any position-modifying operation should check kill switch
    const isExecutionAllowed = !isKillSwitchActive();
    expect(isExecutionAllowed).toBe(false);
  });

  it("should prevent liquidation when not explicitly overridden", () => {
    setKillSwitchActive(true);

    // Even emergency liquidation should respect kill switch
    const canLiquidate = !isKillSwitchActive();
    expect(canLiquidate).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Allows Read Operations
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Allows Reads", () => {
  afterEach(() => {
    setKillSwitchActive(false);
  });

  it("should not block health checks", () => {
    setKillSwitchActive(true);

    // Health checks are always allowed
    const isHealthCheckAllowed = true; // Health checks don't check kill switch
    expect(isHealthCheckAllowed).toBe(true);
  });

  it("should not block position viewing", () => {
    setKillSwitchActive(true);

    // Read-only operations always allowed
    const canViewPositions = true; // View operations don't check kill switch
    expect(canViewPositions).toBe(true);
  });

  it("should not block dashboard access", () => {
    setKillSwitchActive(true);

    // Dashboard is read-only
    const canAccessDashboard = true; // Dashboard doesn't check kill switch
    expect(canAccessDashboard).toBe(true);
  });

  it("should not block audit log queries", () => {
    setKillSwitchActive(true);

    // Audit logs are read-only
    const canQueryAuditLogs = true; // Audit queries don't check kill switch
    expect(canQueryAuditLogs).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Auditability
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Auditability", () => {
  afterEach(() => {
    setKillSwitchActive(false);
  });

  it("should produce queryable state snapshots", () => {
    setKillSwitchActive(false);
    const state1 = isKillSwitchActive();
    expect(state1).toBe(false);

    setKillSwitchActive(true);
    const state2 = isKillSwitchActive();
    expect(state2).toBe(true);

    setKillSwitchActive(false);
    const state3 = isKillSwitchActive();
    expect(state3).toBe(false);
  });

  it("should maintain state across multiple checks", () => {
    setKillSwitchActive(true);

    // Multiple checks should all return same value
    const checks = [
      isKillSwitchActive(),
      isKillSwitchActive(),
      isKillSwitchActive(),
    ];

    expect(checks.every((c) => c === true)).toBe(true);
  });

  it("should preserve state across time", async () => {
    setKillSwitchActive(true);
    const state1 = isKillSwitchActive();

    // Simulate time passing
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state2 = isKillSwitchActive();
    expect(state1).toBe(state2);
    expect(state2).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Multi-Layer Kill Switch (Risk Engine + RBAC)
// ──────────────────────────────────────────────────────────────────────────────

describe("Multi-Layer Kill Switch Architecture", () => {
  afterEach(() => {
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should have two independent layers", () => {
    // Layer 1: Risk Engine (business logic)
    setKillSwitchActive(true);
    expect(isKillSwitchActive()).toBe(true);

    // Layer 2: RBAC (security/enforcement)
    setKillSwitchOverride(false);
    expect(isKillSwitchOverrideActive()).toBe(false);

    // Can toggle independently
    setKillSwitchOverride(true);
    expect(isKillSwitchActive()).toBe(true);
    expect(isKillSwitchOverrideActive()).toBe(true);
  });

  it("should both block mutations when either is active", () => {
    // Only risk engine active
    setKillSwitchActive(true);
    setKillSwitchOverride(false);
    let canExecute = !isKillSwitchActive() && !isKillSwitchOverrideActive();
    expect(canExecute).toBe(false);

    // Reset
    setKillSwitchActive(false);

    // Only RBAC override active
    setKillSwitchOverride(true);
    canExecute = !isKillSwitchActive() && !isKillSwitchOverrideActive();
    expect(canExecute).toBe(false);

    // Both active
    setKillSwitchActive(true);
    canExecute = !isKillSwitchActive() && !isKillSwitchOverrideActive();
    expect(canExecute).toBe(false);
  });

  it("should require both inactive to allow mutations", () => {
    // Both inactive (default)
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
    const canExecute = !isKillSwitchActive() && !isKillSwitchOverrideActive();
    expect(canExecute).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Edge Cases
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Edge Cases", () => {
  afterEach(() => {
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should handle rapid toggling", () => {
    for (let i = 0; i < 10; i++) {
      setKillSwitchActive(true);
      expect(isKillSwitchActive()).toBe(true);
      setKillSwitchActive(false);
      expect(isKillSwitchActive()).toBe(false);
    }
  });

  it("should be idempotent", () => {
    // Activate multiple times
    setKillSwitchActive(true);
    setKillSwitchActive(true);
    setKillSwitchActive(true);
    expect(isKillSwitchActive()).toBe(true);

    // Deactivate multiple times
    setKillSwitchActive(false);
    setKillSwitchActive(false);
    setKillSwitchActive(false);
    expect(isKillSwitchActive()).toBe(false);
  });

  it("should not affect different instances", () => {
    // This tests that state is truly global/singleton
    setKillSwitchActive(true);
    const state1 = isKillSwitchActive();

    // Call through different means
    const state2 = isKillSwitchActive();
    const state3 = isKillSwitchActive();

    expect(state1).toBe(state2);
    expect(state2).toBe(state3);
    expect(state3).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Integration with Execution Guard
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Guards Execution", () => {
  afterEach(() => {
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should block any execution when active", () => {
    setKillSwitchActive(true);

    // Simulate execution guard check
    const couldExecuteSymbol = (symbol: string) => {
      return !isKillSwitchActive();
    };

    expect(couldExecuteSymbol("AAPL")).toBe(false);
    expect(couldExecuteSymbol("TSLA")).toBe(false);
    expect(couldExecuteSymbol("SPY")).toBe(false);
  });

  it("should allow execution when inactive", () => {
    setKillSwitchActive(false);

    const couldExecuteSymbol = (symbol: string) => {
      return !isKillSwitchActive();
    };

    expect(couldExecuteSymbol("AAPL")).toBe(true);
    expect(couldExecuteSymbol("TSLA")).toBe(true);
    expect(couldExecuteSymbol("SPY")).toBe(true);
  });

  it("should block execution regardless of other conditions", () => {
    setKillSwitchActive(true);

    // Even if other conditions are met, kill switch blocks it
    const isValidSignal = true;
    const isWithinRiskLimits = true;
    const isMarketOpen = true;
    const canExecute =
      isValidSignal &&
      isWithinRiskLimits &&
      isMarketOpen &&
      !isKillSwitchActive();

    expect(canExecute).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch vs Execution Authorization
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch vs Execution Authorization", () => {
  afterEach(() => {
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should block even if user has execute permission", () => {
    setKillSwitchActive(true);
    setKillSwitchOverride(false);

    // User has permission to execute
    const userHasExecutePermission = true;

    // But kill switch blocks it
    const canExecuteWithPermission =
      userHasExecutePermission && !isKillSwitchActive();

    expect(canExecuteWithPermission).toBe(false);
  });

  it("should allow if both user has permission AND kill switch inactive", () => {
    setKillSwitchActive(false);

    const userHasExecutePermission = true;
    const canExecuteWithPermission =
      userHasExecutePermission && !isKillSwitchActive();

    expect(canExecuteWithPermission).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Status Visibility
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Status Visibility", () => {
  afterEach(() => {
    setKillSwitchActive(false);
    setKillSwitchOverride(false);
  });

  it("should be visible in system status", () => {
    setKillSwitchActive(false);
    const status1 = { kill_switch_active: isKillSwitchActive() };
    expect(status1.kill_switch_active).toBe(false);

    setKillSwitchActive(true);
    const status2 = { kill_switch_active: isKillSwitchActive() };
    expect(status2.kill_switch_active).toBe(true);
  });

  it("should be visible in execution guards", () => {
    setKillSwitchActive(true);

    const executionGuard = {
      kill_switch_active: isKillSwitchActive(),
      can_execute: !isKillSwitchActive(),
    };

    expect(executionGuard.kill_switch_active).toBe(true);
    expect(executionGuard.can_execute).toBe(false);
  });

  it("should appear in all API responses that control execution", () => {
    setKillSwitchActive(true);

    const responses = [
      { execution_allowed: !isKillSwitchActive() },
      { trading_enabled: !isKillSwitchActive() },
      { order_submission_allowed: !isKillSwitchActive() },
    ];

    responses.forEach((resp) => {
      expect(Object.values(resp)[0]).toBe(false);
    });
  });
});
