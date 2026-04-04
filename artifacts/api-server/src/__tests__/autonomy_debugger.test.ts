import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  readinessStatus: "READY" as "READY" | "DEGRADED" | "NOT_READY",
  killSwitch: false,
  supervisorRunning: false,
  supervisorLastTickAt: null as string | null,
  governorRunning: false,
  governorLastCycleAt: null as string | null,
  allocatorRunning: false,
  allocatorLastCycleAt: null as string | null,
  evolutionRunning: false,
  evolutionLastCycleAt: null as string | null,
  watchdogRunning: false,
  watchdogLastCycleAt: null as string | null,
  executionSafetyRunning: false,
  executionSafetyLastCycleAt: null as string | null,
}));

function resetRuntime(): void {
  runtime.readinessStatus = "READY";
  runtime.killSwitch = false;
  runtime.supervisorRunning = false;
  runtime.supervisorLastTickAt = null;
  runtime.governorRunning = false;
  runtime.governorLastCycleAt = null;
  runtime.allocatorRunning = false;
  runtime.allocatorLastCycleAt = null;
  runtime.evolutionRunning = false;
  runtime.evolutionLastCycleAt = null;
  runtime.watchdogRunning = false;
  runtime.watchdogLastCycleAt = null;
  runtime.executionSafetyRunning = false;
  runtime.executionSafetyLastCycleAt = null;
}

vi.mock("../lib/deployment_readiness", () => ({
  getDeploymentReadinessReport: vi.fn(async () => ({
    generated_at: new Date().toISOString(),
    status: runtime.readinessStatus,
    summary: {
      total: 10,
      passed: runtime.readinessStatus === "READY" ? 10 : 7,
      failed_critical: runtime.readinessStatus === "NOT_READY" ? 2 : 0,
      failed_non_critical: runtime.readinessStatus === "READY" ? 0 : 3,
    },
    checks: [],
  })),
}));

vi.mock("../lib/autonomy_supervisor", () => ({
  shouldAutonomySupervisorAutoStart: vi.fn(() => true),
  getAutonomySupervisorSnapshot: vi.fn(() => ({
    running: runtime.supervisorRunning,
    last_error: null,
    last_tick_at: runtime.supervisorLastTickAt,
    services: [
      { expected: true, health: runtime.supervisorRunning ? "HEALTHY" : "STOPPED" },
      { expected: true, health: runtime.supervisorRunning ? "HEALTHY" : "STOPPED" },
    ],
  })),
  startAutonomySupervisor: vi.fn(async () => {
    runtime.supervisorRunning = true;
    runtime.supervisorLastTickAt = new Date().toISOString();
    return { success: true, message: "Autonomy supervisor started", interval_ms: 30_000 };
  }),
  runAutonomySupervisorTick: vi.fn(async () => {
    runtime.supervisorLastTickAt = new Date().toISOString();
    return {
      running: runtime.supervisorRunning,
      last_error: null,
      last_tick_at: runtime.supervisorLastTickAt,
      services: [],
    };
  }),
}));

vi.mock("../lib/strategy_governor", () => ({
  shouldStrategyGovernorAutoStart: vi.fn(() => true),
  getStrategyGovernorSnapshot: vi.fn(() => ({
    running: runtime.governorRunning,
    last_error: null,
    last_cycle_at: runtime.governorLastCycleAt,
  })),
  startStrategyGovernor: vi.fn(async () => {
    runtime.governorRunning = true;
    runtime.governorLastCycleAt = new Date().toISOString();
    return { success: true, message: "Strategy governor started", interval_ms: 600_000 };
  }),
  runStrategyGovernorCycle: vi.fn(async () => {
    runtime.governorLastCycleAt = new Date().toISOString();
    return {
      running: runtime.governorRunning,
      last_error: null,
      last_cycle_at: runtime.governorLastCycleAt,
      total_cycles: 0,
      last_validation_status: "INSUFFICIENT",
    };
  }),
}));

vi.mock("../lib/strategy_allocator", () => ({
  shouldStrategyAllocatorAutoStart: vi.fn(() => true),
  getStrategyAllocatorSnapshot: vi.fn(() => ({
    running: runtime.allocatorRunning,
    last_error: null,
    last_cycle_at: runtime.allocatorLastCycleAt,
    allocation_count: 0,
    last_validation_status: "INSUFFICIENT",
  })),
  startStrategyAllocator: vi.fn(async () => {
    runtime.allocatorRunning = true;
    runtime.allocatorLastCycleAt = new Date().toISOString();
    return { success: true, message: "Strategy allocator started", interval_ms: 480_000 };
  }),
  runStrategyAllocatorCycle: vi.fn(async () => {
    runtime.allocatorLastCycleAt = new Date().toISOString();
    return {
      running: runtime.allocatorRunning,
      last_error: null,
      last_cycle_at: runtime.allocatorLastCycleAt,
      allocation_count: 0,
      last_validation_status: "INSUFFICIENT",
      total_cycles: 0,
    };
  }),
}));

vi.mock("../lib/strategy_evolution_scheduler", () => ({
  shouldStrategyEvolutionAutoStart: vi.fn(() => true),
  getStrategyEvolutionSnapshot: vi.fn(() => ({
    running: runtime.evolutionRunning,
    last_error: null,
    last_cycle_at: runtime.evolutionLastCycleAt,
    evaluated_strategies: [],
    optimized_strategies: [],
  })),
  startStrategyEvolutionScheduler: vi.fn(async () => {
    runtime.evolutionRunning = true;
    runtime.evolutionLastCycleAt = new Date().toISOString();
    return { success: true, message: "Strategy evolution scheduler started", interval_ms: 900_000 };
  }),
  runStrategyEvolutionCycle: vi.fn(async () => {
    runtime.evolutionLastCycleAt = new Date().toISOString();
    return {
      running: runtime.evolutionRunning,
      last_error: null,
      last_cycle_at: runtime.evolutionLastCycleAt,
      evaluated_strategies: [],
      optimized_strategies: [],
      total_cycles: 0,
    };
  }),
}));

vi.mock("../lib/production_watchdog", () => ({
  shouldProductionWatchdogAutoStart: vi.fn(() => true),
  getProductionWatchdogSnapshot: vi.fn(() => ({
    running: runtime.watchdogRunning,
    last_error: null,
    last_cycle_at: runtime.watchdogLastCycleAt,
    last_status: runtime.readinessStatus,
    escalation_active: false,
  })),
  startProductionWatchdog: vi.fn(async () => {
    runtime.watchdogRunning = true;
    runtime.watchdogLastCycleAt = new Date().toISOString();
    return { success: true, message: "Production watchdog started", interval_ms: 45_000 };
  }),
  runProductionWatchdogCycle: vi.fn(async () => {
    runtime.watchdogLastCycleAt = new Date().toISOString();
    return {
      running: runtime.watchdogRunning,
      last_error: null,
      last_cycle_at: runtime.watchdogLastCycleAt,
      last_status: runtime.readinessStatus,
      escalation_active: false,
      total_cycles: 0,
      total_escalations: 0,
    };
  }),
}));

vi.mock("../lib/execution_safety_supervisor", () => ({
  shouldExecutionSafetySupervisorAutoStart: vi.fn(() => true),
  getExecutionSafetySupervisorSnapshot: vi.fn(() => ({
    running: runtime.executionSafetyRunning,
    last_error: null,
    last_cycle_at: runtime.executionSafetyLastCycleAt,
    consecutive_warn: 0,
    consecutive_blocked: 0,
    last_summary: {
      autonomy_action: "ALLOW",
      market_action: "ALLOW",
      portfolio_state: "NORMAL",
      incident_level: "NORMAL",
      incident_halt: false,
      blocked_reasons: [],
      warning_reasons: [],
    },
  })),
  startExecutionSafetySupervisor: vi.fn(async () => {
    runtime.executionSafetyRunning = true;
    runtime.executionSafetyLastCycleAt = new Date().toISOString();
    return { success: true, message: "Execution safety supervisor started", interval_ms: 45_000, heartbeat_symbol: "BTCUSD" };
  }),
  runExecutionSafetySupervisorCycle: vi.fn(async () => {
    runtime.executionSafetyLastCycleAt = new Date().toISOString();
    return {
      running: runtime.executionSafetyRunning,
      last_error: null,
      last_cycle_at: runtime.executionSafetyLastCycleAt,
      consecutive_warn: 0,
      consecutive_blocked: 0,
      total_cycles: 0,
      total_actions: 0,
      interval_ms: 45_000,
      last_summary: null,
      policy: {
        auto_enforce: true,
        interval_ms: 45_000,
        heartbeat_symbol: "BTCUSD",
        include_market_guard: true,
        include_portfolio_risk: true,
        auto_heal_autonomy: true,
        warn_alert_threshold: 3,
        block_alert_threshold: 2,
        auto_kill_switch_on_block: true,
      },
      recent_actions: [],
      cycle_in_flight: false,
      started_at: null,
      last_cycle_duration_ms: null,
    };
  }),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => runtime.killSwitch),
}));

vi.mock("../lib/ops_monitor", () => ({
  addOpsAlert: vi.fn(),
}));

describe("autonomy_debugger", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();
  });

  it("flags critical issues when readiness is NOT_READY and services are stopped", async () => {
    runtime.readinessStatus = "NOT_READY";
    const mod = await import("../lib/autonomy_debugger");
    const snapshot = await mod.getAutonomyDebugSnapshot({ forceReadiness: true });

    expect(snapshot.overall_status).toBe("CRITICAL");
    expect(snapshot.issues.some((issue) => issue.code === "READINESS_NOT_READY")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "AUTONOMY_SUPERVISOR_STOPPED")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "PRODUCTION_WATCHDOG_STOPPED")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "EXECUTION_SAFETY_SUPERVISOR_STOPPED")).toBe(true);
  });

  it("auto-fix starts expected stopped services", async () => {
    runtime.readinessStatus = "DEGRADED";
    const mod = await import("../lib/autonomy_debugger");
    const result = await mod.runAutonomyDebugAutoFix({ forceReadiness: true });

    expect(result.fixes.length).toBeGreaterThanOrEqual(6);
    expect(result.fixes.every((fix) => fix.success)).toBe(true);
    expect(runtime.supervisorRunning).toBe(true);
    expect(runtime.governorRunning).toBe(true);
    expect(runtime.allocatorRunning).toBe(true);
    expect(runtime.evolutionRunning).toBe(true);
    expect(runtime.watchdogRunning).toBe(true);
    expect(runtime.executionSafetyRunning).toBe(true);
  });

  it("flags stale services and runs stale-cycle auto-fix", async () => {
    runtime.supervisorRunning = true;
    runtime.governorRunning = true;
    runtime.allocatorRunning = true;
    runtime.evolutionRunning = true;
    runtime.watchdogRunning = true;
    runtime.executionSafetyRunning = true;

    runtime.governorLastCycleAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

    const mod = await import("../lib/autonomy_debugger");
    const snapshot = await mod.getAutonomyDebugSnapshot({ forceReadiness: true });
    expect(snapshot.issues.some((issue) => issue.code === "STRATEGY_GOVERNOR_STALE")).toBe(true);

    const result = await mod.runAutonomyDebugAutoFix({ forceReadiness: true });
    const staleFix = result.fixes.find((fix) => fix.service === "strategy_governor");
    expect(staleFix).toBeDefined();
    expect(staleFix?.success).toBe(true);
  });
});
