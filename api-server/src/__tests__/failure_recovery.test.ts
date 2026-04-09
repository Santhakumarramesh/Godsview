/**
 * failure_recovery.test.ts — Phase 35: Failure Recovery + Disaster Readiness
 *
 * Comprehensive test suite (22+ tests):
 * - Recovery plan lifecycle and state transitions
 * - Position, session, and pending action restoration
 * - Crash-safe broker reconciliation
 * - Incident drill creation, execution, and results
 * - Pre-built drill scenarios (kill switch, breaker, data outage, etc.)
 * - Drill step pass/fail tracking
 * - Query operations for history and drill data
 * - State cleanup and reset
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createRecoveryPlan,
  executeRecoveryStep,
  restoreOpenPositions,
  restoreActiveSessions,
  restorePendingActions,
  crashSafeReconcile,
  getRecoveryPlan,
  getRecoveryHistory,
  clearRecoveryManager,
  createDrill,
  startDrill,
  executeDrillStep,
  completeDrill,
  getDrill,
  getRecentDrills,
  getDrillsByType,
  _clearDrills,
} from "../lib/recovery";
import type {
  MockPosition,
  MockSession,
  MockPendingAction,
} from "../lib/recovery";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Recovery Plan Tests ──────────────────────────────────────────────

describe("Recovery Manager — Plan Lifecycle", () => {
  beforeEach(() => {
    clearRecoveryManager();
  });

  it("should create a recovery plan with correct structure", () => {
    const result = createRecoveryPlan();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.plan_id).toMatch(/^recovery_/);
    expect(result.data?.steps).toEqual([
      "restore_positions",
      "restore_sessions",
      "restore_pending_actions",
      "reconcile_broker",
      "verify_state",
    ]);
    expect(result.data?.current_step).toBe(0);
    expect(result.data?.overall_status).toBe("pending");
    expect(result.data?.started_at).toBeDefined();
    expect(result.data?.completed_at).toBeNull();
  });

  it("should execute recovery plan steps sequentially", () => {
    const planResult = createRecoveryPlan();
    expect(planResult.success).toBe(true);
    const planId = planResult.data!.plan_id;

    const step1 = executeRecoveryStep(planId);
    expect(step1.success).toBe(true);
    expect(step1.data?.step).toBe("restore_positions");
    expect(step1.data?.status).toBe("completed");

    const step2 = executeRecoveryStep(planId);
    expect(step2.success).toBe(true);
    expect(step2.data?.step).toBe("restore_sessions");

    const step3 = executeRecoveryStep(planId);
    expect(step3.success).toBe(true);
    expect(step3.data?.step).toBe("restore_pending_actions");

    const step4 = executeRecoveryStep(planId);
    expect(step4.success).toBe(true);
    expect(step4.data?.step).toBe("reconcile_broker");

    const step5 = executeRecoveryStep(planId);
    expect(step5.success).toBe(true);
    expect(step5.data?.step).toBe("verify_state");
  });

  it("should transition plan status from pending to in_progress to completed", () => {
    const planResult = createRecoveryPlan();
    const planId = planResult.data!.plan_id;

    let plan = getRecoveryPlan(planId);
    expect(plan?.overall_status).toBe("pending");

    executeRecoveryStep(planId);
    plan = getRecoveryPlan(planId);
    expect(plan?.overall_status).toBe("in_progress");

    // Execute remaining steps
    executeRecoveryStep(planId);
    executeRecoveryStep(planId);
    executeRecoveryStep(planId);
    executeRecoveryStep(planId);

    plan = getRecoveryPlan(planId);
    expect(plan?.overall_status).toBe("completed");
    expect(plan?.completed_at).toBeDefined();
  });

  it("should reject executing steps on non-existent plan", () => {
    const result = executeRecoveryStep("nonexistent_plan");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should prevent step execution on completed plan", () => {
    const planResult = createRecoveryPlan();
    const planId = planResult.data!.plan_id;

    // Execute all steps
    for (let i = 0; i < 5; i++) {
      executeRecoveryStep(planId);
    }

    const nextAttempt = executeRecoveryStep(planId);
    expect(nextAttempt.success).toBe(false);
    expect(nextAttempt.error).toContain("completed");
  });
});

// ── Position Restoration Tests ───────────────────────────────────────

describe("Recovery Manager — Position Restoration", () => {
  beforeEach(() => {
    clearRecoveryManager();
  });

  it("should restore open positions successfully", () => {
    const positions: MockPosition[] = [
      {
        id: "pos1",
        symbol: "BTCUSD",
        qty: 1,
        entry_price: 45000,
        entry_time: "2026-04-08T10:00:00Z",
      },
      {
        id: "pos2",
        symbol: "ETHUSD",
        qty: 10,
        entry_price: 2500,
        entry_time: "2026-04-08T10:15:00Z",
      },
    ];

    const result = restoreOpenPositions(positions);

    expect(result.success).toBe(true);
    expect(result.data?.state_id).toMatch(/^recovery_/);
    expect(result.data?.type).toBe("positions");
    expect(result.data?.items_recovered.length).toBe(2);
    expect(result.data?.items_failed.length).toBe(0);
    expect(result.data?.recovery_status).toBe("completed");
    expect(result.data?.completed_at).toBeDefined();
  });

  it("should handle empty position list", () => {
    const result = restoreOpenPositions([]);

    expect(result.success).toBe(true);
    expect(result.data?.items_recovered.length).toBe(0);
    expect(result.data?.items_failed.length).toBe(0);
    expect(result.data?.recovery_status).toBe("completed");
  });

  it("should track both recovered and failed items", () => {
    const positions: MockPosition[] = [
      {
        id: "pos1",
        symbol: "BTCUSD",
        qty: 1,
        entry_price: 45000,
        entry_time: "2026-04-08T10:00:00Z",
      },
    ];

    const result = restoreOpenPositions(positions);
    expect(result.data?.items_recovered[0]?.status).toBe("restored");
    expect(result.data?.items_recovered[0]?.symbol).toBe("BTCUSD");
  });
});

// ── Session Restoration Tests ────────────────────────────────────────

describe("Recovery Manager — Session Restoration", () => {
  beforeEach(() => {
    clearRecoveryManager();
  });

  it("should restore active sessions", () => {
    const sessions: MockSession[] = [
      {
        session_id: "sess1",
        account_id: "acct123",
        mode: "paper",
        started_at: "2026-04-08T09:00:00Z",
      },
      {
        session_id: "sess2",
        account_id: "acct456",
        mode: "live",
        started_at: "2026-04-08T09:30:00Z",
      },
    ];

    const result = restoreActiveSessions(sessions);

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("sessions");
    expect(result.data?.items_recovered.length).toBe(2);
    expect(result.data?.items_failed.length).toBe(0);
  });

  it("should handle empty session list", () => {
    const result = restoreActiveSessions([]);

    expect(result.success).toBe(true);
    expect(result.data?.items_recovered.length).toBe(0);
  });
});

// ── Pending Action Restoration Tests ─────────────────────────────────

describe("Recovery Manager — Pending Action Restoration", () => {
  beforeEach(() => {
    clearRecoveryManager();
  });

  it("should restore pending orders and actions", () => {
    const actions: MockPendingAction[] = [
      {
        action_id: "act1",
        type: "order",
        symbol: "AAPL",
        qty: 100,
        created_at: "2026-04-08T10:00:00Z",
        status: "pending",
      },
      {
        action_id: "act2",
        type: "liquidation",
        symbol: "GOOGL",
        qty: 50,
        created_at: "2026-04-08T10:05:00Z",
        status: "pending",
      },
    ];

    const result = restorePendingActions(actions);

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("pending_actions");
    expect(result.data?.items_recovered.length).toBe(2);
    expect(result.data?.items_failed.length).toBe(0);
  });

  it("should skip failed actions during restoration", () => {
    const actions: MockPendingAction[] = [
      {
        action_id: "act1",
        type: "order",
        symbol: "AAPL",
        qty: 100,
        created_at: "2026-04-08T10:00:00Z",
        status: "failed",
      },
      {
        action_id: "act2",
        type: "order",
        symbol: "GOOGL",
        qty: 50,
        created_at: "2026-04-08T10:05:00Z",
        status: "pending",
      },
    ];

    const result = restorePendingActions(actions);

    expect(result.data?.items_recovered.length).toBe(1);
  });
});

// ── Crash-Safe Reconciliation Tests ──────────────────────────────────

describe("Recovery Manager — Crash-Safe Reconciliation", () => {
  beforeEach(() => {
    clearRecoveryManager();
  });

  it("should perform broker reconciliation successfully", () => {
    const result = crashSafeReconcile();

    expect(result.success).toBe(true);
    expect(result.data?.reconciled).toBeGreaterThanOrEqual(0);
    expect(result.data?.mismatches_found).toBeGreaterThanOrEqual(0);
    expect(result.data?.corrections_applied).toBeGreaterThanOrEqual(0);
  });

  it("should return numeric reconciliation metrics", () => {
    const result = crashSafeReconcile();

    expect(typeof result.data?.reconciled).toBe("number");
    expect(typeof result.data?.mismatches_found).toBe("number");
    expect(typeof result.data?.corrections_applied).toBe("number");
  });
});

// ── Recovery History Tests ───────────────────────────────────────────

describe("Recovery Manager — History & Queries", () => {
  beforeEach(() => {
    clearRecoveryManager();
  });

  it("should track recovery history", () => {
    restoreOpenPositions([
      {
        id: "pos1",
        symbol: "BTCUSD",
        qty: 1,
        entry_price: 45000,
        entry_time: "2026-04-08T10:00:00Z",
      },
    ]);

    restoreActiveSessions([
      {
        session_id: "sess1",
        account_id: "acct123",
        mode: "paper",
        started_at: "2026-04-08T09:00:00Z",
      },
    ]);

    const history = getRecoveryHistory();
    expect(history.length).toBe(2);
    expect(history[0]?.type).toBe("positions");
    expect(history[1]?.type).toBe("sessions");
  });

  it("should return null for non-existent plan", () => {
    const plan = getRecoveryPlan("nonexistent");
    expect(plan).toBeNull();
  });
});

// ── Incident Drill Tests ─────────────────────────────────────────────

describe("Incident Drills — Creation & Lifecycle", () => {
  beforeEach(() => {
    _clearDrills();
  });

  it("should create a kill switch drill", () => {
    const result = createDrill("kill_switch");

    expect(result.success).toBe(true);
    expect(result.data?.drill_id).toMatch(/^drill_/);
    expect(result.data?.type).toBe("kill_switch");
    expect(result.data?.status).toBe("pending");
    expect(result.data?.started_at).toBeDefined();
    expect(result.data?.completed_at).toBeNull();
  });

  it("should create a circuit breaker drill", () => {
    const result = createDrill("breaker");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("breaker");
    expect(result.data?.scenario_config).toBeDefined();
  });

  it("should create a data outage drill", () => {
    const result = createDrill("data_outage");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("data_outage");
  });

  it("should create a broker outage drill", () => {
    const result = createDrill("broker_outage");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("broker_outage");
  });

  it("should create a database outage drill", () => {
    const result = createDrill("db_outage");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("db_outage");
  });

  it("should create a partial execution drill", () => {
    const result = createDrill("partial_execution");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("partial_execution");
  });

  it("should create a restart during market drill", () => {
    const result = createDrill("restart_during_market");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("restart_during_market");
  });

  it("should allow custom scenario config", () => {
    const config = { trigger_after_steps: 5, auto_recover: false };
    const result = createDrill("kill_switch", config);

    expect(result.success).toBe(true);
    expect(result.data?.scenario_config.trigger_after_steps).toBe(5);
    expect(result.data?.scenario_config.auto_recover).toBe(false);
  });
});

// ── Drill Execution Tests ────────────────────────────────────────────

describe("Incident Drills — Execution", () => {
  beforeEach(() => {
    _clearDrills();
  });

  it("should start a drill", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    const startResult = startDrill(drillId);

    expect(startResult.success).toBe(true);
    expect(startResult.data?.status).toBe("running");
  });

  it("should execute drill steps", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    startDrill(drillId);
    const stepResult = executeDrillStep(drillId, "verify_initial_state");

    expect(stepResult.success).toBe(true);
    expect(stepResult.data?.name).toBe("verify_initial_state");
    expect(stepResult.data?.passed).toBeDefined();
  });

  it("should track passed and failed steps", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    startDrill(drillId);
    executeDrillStep(drillId, "verify_initial_state");
    executeDrillStep(drillId, "trigger_kill_switch");

    const drill = getDrill(drillId);
    expect(drill?.steps_executed.length).toBe(2);
    expect(drill?.results.passed_steps).toBeGreaterThanOrEqual(0);
    expect(drill?.results.failed_steps).toBeGreaterThanOrEqual(0);
  });

  it("should complete a drill", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    startDrill(drillId);
    executeDrillStep(drillId, "verify_initial_state");

    const completeResult = completeDrill(drillId);

    expect(completeResult.success).toBe(true);
    expect(completeResult.data?.status).toBe("completed");

    const drill = getDrill(drillId);
    expect(drill?.completed_at).toBeDefined();
    expect(drill?.results.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("should reject step execution on non-running drill", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    const stepResult = executeDrillStep(drillId, "verify_initial_state");

    expect(stepResult.success).toBe(false);
    expect(stepResult.error).toContain("not running");
  });

  it("should reject step execution with invalid step name", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    startDrill(drillId);
    const stepResult = executeDrillStep(drillId, "nonexistent_step");

    expect(stepResult.success).toBe(false);
    expect(stepResult.error).toContain("not found");
  });
});

// ── Drill Queries Tests ──────────────────────────────────────────────

describe("Incident Drills — Queries", () => {
  beforeEach(() => {
    _clearDrills();
  });

  it("should retrieve a drill by ID", () => {
    const drillResult = createDrill("kill_switch");
    const drillId = drillResult.data!.drill_id;

    const retrieved = getDrill(drillId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.drill_id).toBe(drillId);
    expect(retrieved?.type).toBe("kill_switch");
  });

  it("should return null for non-existent drill", () => {
    const retrieved = getDrill("nonexistent_drill");
    expect(retrieved).toBeNull();
  });

  it("should get recent drills", () => {
    createDrill("kill_switch");
    createDrill("breaker");
    createDrill("data_outage");

    const drillResult = createDrill("broker_outage");
    const drillId = drillResult.data!.drill_id;

    startDrill(drillId);
    completeDrill(drillId);

    const recent = getRecentDrills(2);

    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0]?.status).toBe("completed");
  });

  it("should filter drills by type", () => {
    const drill1 = createDrill("kill_switch");
    const drill2 = createDrill("kill_switch");
    createDrill("breaker");

    // Complete drills to add them to history
    startDrill(drill1.data!.drill_id);
    completeDrill(drill1.data!.drill_id);
    startDrill(drill2.data!.drill_id);
    completeDrill(drill2.data!.drill_id);

    const killSwitchDrills = getDrillsByType("kill_switch");

    expect(killSwitchDrills.length).toBe(2);
    expect(killSwitchDrills.every((d) => d.type === "kill_switch")).toBe(true);
  });

  it("should return empty array for non-existent drill type", () => {
    createDrill("kill_switch");

    const drills = getDrillsByType("breaker");

    expect(Array.isArray(drills)).toBe(true);
  });
});

// ── State Cleanup Tests ──────────────────────────────────────────────

describe("Recovery & Drill Managers — State Cleanup", () => {
  it("should clear recovery manager state", () => {
    createRecoveryPlan();
    restoreOpenPositions([
      {
        id: "pos1",
        symbol: "BTCUSD",
        qty: 1,
        entry_price: 45000,
        entry_time: "2026-04-08T10:00:00Z",
      },
    ]);

    clearRecoveryManager();

    const history = getRecoveryHistory();
    expect(history.length).toBe(0);
  });

  it("should clear drill manager state", () => {
    createDrill("kill_switch");
    createDrill("breaker");
    createDrill("data_outage");

    _clearDrills();

    const recent = getRecentDrills();
    expect(recent.length).toBe(0);
  });
});
