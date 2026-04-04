import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  readinessStatus: "READY" as "READY" | "DEGRADED" | "NOT_READY",
  killSwitch: false,
  supervisorRunning: false,
  governorRunning: false,
  allocatorRunning: false,
  evolutionRunning: false,
  watchdogRunning: false,
}));

function resetRuntime(): void {
  runtime.readinessStatus = "READY";
  runtime.killSwitch = false;
  runtime.supervisorRunning = false;
  runtime.governorRunning = false;
  runtime.allocatorRunning = false;
  runtime.evolutionRunning = false;
  runtime.watchdogRunning = false;
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
    last_tick_at: null,
    services: [
      { expected: true, health: runtime.supervisorRunning ? "HEALTHY" : "STOPPED" },
      { expected: true, health: runtime.supervisorRunning ? "HEALTHY" : "STOPPED" },
    ],
  })),
  startAutonomySupervisor: vi.fn(async () => {
    runtime.supervisorRunning = true;
    return { success: true, message: "Autonomy supervisor started", interval_ms: 30_000 };
  }),
}));

vi.mock("../lib/strategy_governor", () => ({
  shouldStrategyGovernorAutoStart: vi.fn(() => true),
  getStrategyGovernorSnapshot: vi.fn(() => ({
    running: runtime.governorRunning,
    last_error: null,
    last_cycle_at: null,
  })),
  startStrategyGovernor: vi.fn(async () => {
    runtime.governorRunning = true;
    return { success: true, message: "Strategy governor started", interval_ms: 600_000 };
  }),
}));

vi.mock("../lib/strategy_allocator", () => ({
  shouldStrategyAllocatorAutoStart: vi.fn(() => true),
  getStrategyAllocatorSnapshot: vi.fn(() => ({
    running: runtime.allocatorRunning,
    last_error: null,
    last_cycle_at: null,
    allocation_count: 0,
    last_validation_status: "INSUFFICIENT",
  })),
  startStrategyAllocator: vi.fn(async () => {
    runtime.allocatorRunning = true;
    return { success: true, message: "Strategy allocator started", interval_ms: 480_000 };
  }),
}));

vi.mock("../lib/strategy_evolution_scheduler", () => ({
  shouldStrategyEvolutionAutoStart: vi.fn(() => true),
  getStrategyEvolutionSnapshot: vi.fn(() => ({
    running: runtime.evolutionRunning,
    last_error: null,
    last_cycle_at: null,
    evaluated_strategies: [],
    optimized_strategies: [],
  })),
  startStrategyEvolutionScheduler: vi.fn(async () => {
    runtime.evolutionRunning = true;
    return { success: true, message: "Strategy evolution scheduler started", interval_ms: 900_000 };
  }),
}));

vi.mock("../lib/production_watchdog", () => ({
  shouldProductionWatchdogAutoStart: vi.fn(() => true),
  getProductionWatchdogSnapshot: vi.fn(() => ({
    running: runtime.watchdogRunning,
    last_error: null,
    last_cycle_at: null,
    last_status: runtime.readinessStatus,
    escalation_active: false,
  })),
  startProductionWatchdog: vi.fn(async () => {
    runtime.watchdogRunning = true;
    return { success: true, message: "Production watchdog started", interval_ms: 45_000 };
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
  });

  it("auto-fix starts expected stopped services", async () => {
    runtime.readinessStatus = "DEGRADED";
    const mod = await import("../lib/autonomy_debugger");
    const result = await mod.runAutonomyDebugAutoFix({ forceReadiness: true });

    expect(result.fixes.length).toBeGreaterThanOrEqual(5);
    expect(result.fixes.every((fix) => fix.success)).toBe(true);
    expect(runtime.supervisorRunning).toBe(true);
    expect(runtime.governorRunning).toBe(true);
    expect(runtime.allocatorRunning).toBe(true);
    expect(runtime.evolutionRunning).toBe(true);
    expect(runtime.watchdogRunning).toBe(true);
  });
});

