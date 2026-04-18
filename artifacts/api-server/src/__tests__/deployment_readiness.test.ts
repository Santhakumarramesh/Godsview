import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  executionSafetyRunning: true,
  executionSafetyLastError: null as string | null,
  executionSafetyExpected: true,
  executionSafetyStartedAgeMs: 20_000,
  executionSafetyLastCycleAgeMs: 10_000 as number | null,
  executionSafetyTotalCycles: 3,
  killSwitchActive: false,
  systemMode: "paper" as "demo" | "paper" | "live_disabled" | "live_enabled",
  supervisorExpected: true,
  supervisorRunning: true,
  supervisorStartedAgeMs: 20_000,
  supervisorLastTickAgeMs: 10_000 as number | null,
  supervisorTotalTicks: 3,
  watchdogExpected: true,
  watchdogRunning: true,
  watchdogStartedAgeMs: 20_000,
  watchdogLastCycleAgeMs: 10_000 as number | null,
  watchdogTotalCycles: 2,
  debugSchedulerExpected: true,
  debugSchedulerRunning: true,
  debugSchedulerStartedAgeMs: 20_000,
  debugSchedulerLastCycleAgeMs: 10_000 as number | null,
  debugSchedulerTotalCycles: 2,
  debugSchedulerLastError: null as string | null,
  debugSchedulerLastStatus: "HEALTHY" as "HEALTHY" | "DEGRADED" | "CRITICAL",
}));

function isoFromAgeMs(ageMs: number | null): string | null {
  if (ageMs === null) return null;
  return new Date(Date.now() - ageMs).toISOString();
}

function resetRuntime(): void {
  runtime.executionSafetyRunning = true;
  runtime.executionSafetyLastError = null;
  runtime.executionSafetyExpected = true;
  runtime.executionSafetyStartedAgeMs = 20_000;
  runtime.executionSafetyLastCycleAgeMs = 10_000;
  runtime.executionSafetyTotalCycles = 3;
  runtime.killSwitchActive = false;
  runtime.systemMode = "paper";
  runtime.supervisorExpected = true;
  runtime.supervisorRunning = true;
  runtime.supervisorStartedAgeMs = 20_000;
  runtime.supervisorLastTickAgeMs = 10_000;
  runtime.supervisorTotalTicks = 3;
  runtime.watchdogExpected = true;
  runtime.watchdogRunning = true;
  runtime.watchdogStartedAgeMs = 20_000;
  runtime.watchdogLastCycleAgeMs = 10_000;
  runtime.watchdogTotalCycles = 2;
  runtime.debugSchedulerExpected = true;
  runtime.debugSchedulerRunning = true;
  runtime.debugSchedulerStartedAgeMs = 20_000;
  runtime.debugSchedulerLastCycleAgeMs = 10_000;
  runtime.debugSchedulerTotalCycles = 2;
  runtime.debugSchedulerLastError = null;
  runtime.debugSchedulerLastStatus = "HEALTHY";
}

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("@workspace/db", () => ({
  checkDbHealth: vi.fn(async () => ({
    ok: true,
    driver: "mock",
    latencyMs: 1,
  })),
  // drizzle-orm re-exports (now provided by @workspace/db)
  and:       (..._args: unknown[]) => ({ type: "and" }),
  or:        (..._args: unknown[]) => ({ type: "or" }),
  eq:        (..._args: unknown[]) => ({ type: "eq" }),
  ne:        (..._args: unknown[]) => ({ type: "ne" }),
  gt:        (..._args: unknown[]) => ({ type: "gt" }),
  gte:       (..._args: unknown[]) => ({ type: "gte" }),
  lt:        (..._args: unknown[]) => ({ type: "lt" }),
  lte:       (..._args: unknown[]) => ({ type: "lte" }),
  isNotNull: (..._args: unknown[]) => ({ type: "isNotNull" }),
  isNull:    (..._args: unknown[]) => ({ type: "isNull" }),
  desc:      (..._args: unknown[]) => ({ type: "desc" }),
  asc:       (..._args: unknown[]) => ({ type: "asc" }),
  inArray:   (..._args: unknown[]) => ({ type: "inArray" }),
  notInArray:(..._args: unknown[]) => ({ type: "notInArray" }),
  count:     (..._args: unknown[]) => 0,
  sum:       (..._args: unknown[]) => 0,
  max:       (..._args: unknown[]) => null,
  min:       (..._args: unknown[]) => null,
  between:   (..._args: unknown[]) => null,
  like:      (..._args: unknown[]) => null,
  ilike:     (..._args: unknown[]) => null,
  exists:    (..._args: unknown[]) => null,
  not:       (..._args: unknown[]) => null,
  sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
}));

vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: vi.fn(() => ({
    level: "OPEN",
    position_size_multiplier: 1,
  })),
}));

vi.mock("../lib/preflight", () => ({
  runPreflight: vi.fn(async () => ({
    passed: true,
    duration_ms: 5,
    checks: [],
  })),
}));

vi.mock("../lib/portfolio_risk_guard", () => ({
  getLatestPortfolioRiskSnapshot: vi.fn(() => ({
    risk_state: "NORMAL",
    one_day_var_pct: 0,
  })),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => runtime.killSwitchActive),
  getRiskEngineSnapshot: vi.fn(() => ({
    config: {
      maxRiskPerTradePct: 0.01,
    },
  })),
}));

vi.mock("../lib/runtime_config", () => ({
  runtimeConfig: {
    get systemMode() {
      return runtime.systemMode;
    },
    nodeEnv: "test",
    hasAlpacaKeys: true,
    hasOperatorToken: true,
    hasAnthropicKey: true,
  },
}));

vi.mock("../lib/startup_state", () => ({
  getStartupSnapshot: vi.fn(() => ({
    mlBootstrap: {
      state: "ready",
      error: null,
    },
  })),
}));

vi.mock("../lib/autonomy_supervisor", () => ({
  shouldAutonomySupervisorAutoStart: vi.fn(() => runtime.supervisorExpected),
  getAutonomySupervisorSnapshot: vi.fn(() => ({
    running: runtime.supervisorRunning,
    started_at: isoFromAgeMs(runtime.supervisorStartedAgeMs),
    last_tick_at: isoFromAgeMs(runtime.supervisorLastTickAgeMs),
    total_ticks: runtime.supervisorTotalTicks,
    total_heal_actions: 0,
    services: [
      { expected: true, health: "HEALTHY" },
      { expected: true, health: "HEALTHY" },
    ],
  })),
}));

vi.mock("../lib/strategy_governor", () => ({
  getStrategyGovernorSnapshot: vi.fn(() => ({
    running: true,
    total_cycles: 1,
    last_error: null,
  })),
}));

vi.mock("../lib/strategy_allocator", () => ({
  getStrategyAllocatorSnapshot: vi.fn(() => ({
    running: true,
    total_cycles: 1,
    allocation_count: 0,
    last_error: null,
  })),
}));

vi.mock("../lib/strategy_evolution_scheduler", () => ({
  getStrategyEvolutionSnapshot: vi.fn(() => ({
    running: true,
    total_cycles: 1,
    last_error: null,
  })),
}));

vi.mock("../lib/production_watchdog", () => ({
  shouldProductionWatchdogAutoStart: vi.fn(() => runtime.watchdogExpected),
  getProductionWatchdogSnapshot: vi.fn(() => ({
    running: runtime.watchdogRunning,
    started_at: isoFromAgeMs(runtime.watchdogStartedAgeMs),
    last_cycle_at: isoFromAgeMs(runtime.watchdogLastCycleAgeMs),
    total_cycles: runtime.watchdogTotalCycles,
    interval_ms: 45_000,
    escalation_active: false,
    consecutive_not_ready: 0,
    consecutive_degraded: 0,
    last_status: "READY",
    last_error: null,
  })),
}));

vi.mock("../lib/execution_safety_supervisor", () => ({
  shouldExecutionSafetySupervisorAutoStart: vi.fn(() => runtime.executionSafetyExpected),
  getExecutionSafetySupervisorSnapshot: vi.fn(() => ({
    running: runtime.executionSafetyRunning,
    started_at: isoFromAgeMs(runtime.executionSafetyStartedAgeMs),
    last_cycle_at: isoFromAgeMs(runtime.executionSafetyLastCycleAgeMs),
    total_cycles: runtime.executionSafetyTotalCycles,
    last_error: runtime.executionSafetyLastError,
    consecutive_warn: 0,
    consecutive_blocked: 0,
  })),
}));

vi.mock("../lib/execution_incident_guard", () => ({
  getExecutionIncidentSnapshot: vi.fn(() => ({
    level: "NORMAL",
    halt_active: false,
    window_failures: 0,
    window_rejections: 0,
  })),
}));

vi.mock("../lib/execution_market_guard", () => ({
  getExecutionMarketGuardSnapshot: vi.fn(() => ({
    level: "NORMAL",
    halt_active: false,
    window_critical: 0,
    window_warn: 0,
  })),
}));

vi.mock("../lib/execution_autonomy_guard", () => ({
  getExecutionAutonomyGuardSnapshot: vi.fn(() => ({
    level: "NORMAL",
    halt_active: false,
    window_blocks: 0,
    window_warn: 0,
  })),
}));

vi.mock("../lib/execution_idempotency", () => ({
  getExecutionIdempotencySnapshot: vi.fn(() => ({
    entries: 1,
    policy: {
      require_key_in_live_mode: true,
    },
  })),
}));

vi.mock("../lib/autonomy_debug_scheduler", () => ({
  shouldAutonomyDebugSchedulerAutoStart: vi.fn(() => runtime.debugSchedulerExpected),
  getAutonomyDebugSchedulerSnapshot: vi.fn(() => ({
    running: runtime.debugSchedulerRunning,
    started_at: isoFromAgeMs(runtime.debugSchedulerStartedAgeMs),
    last_cycle_at: isoFromAgeMs(runtime.debugSchedulerLastCycleAgeMs),
    total_cycles: runtime.debugSchedulerTotalCycles,
    last_error: runtime.debugSchedulerLastError,
    last_status: runtime.debugSchedulerLastStatus,
  })),
}));

describe("deployment_readiness execution safety integration", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();
    delete process.env.DEPLOYMENT_READINESS_KILL_SWITCH_CRITICAL;
  });

  it("includes execution safety supervisor health in readiness payload", async () => {
    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    expect(report.status).toBe("READY");
    expect(report.autonomy.execution_safety_supervisor_running).toBe(true);
    expect(report.autonomy.execution_safety_supervisor_last_error).toBeNull();
    expect(report.autonomy.autonomy_supervisor_heartbeat_fresh).toBe(true);
    expect(report.autonomy.production_watchdog_heartbeat_fresh).toBe(true);
    expect(report.autonomy.execution_safety_supervisor_heartbeat_fresh).toBe(true);
    expect(report.autonomy.autonomy_debug_scheduler_heartbeat_fresh).toBe(true);

    const check = report.checks.find((item) => item.name === "Execution safety supervisor running");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(true);
    expect(check?.passed).toBe(true);
  });

  it("fails readiness when execution safety supervisor is not running", async () => {
    runtime.executionSafetyRunning = false;
    runtime.executionSafetyLastError = "stopped";

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Execution safety supervisor running");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(true);
    expect(check?.passed).toBe(false);
    expect(report.status).toBe("NOT_READY");
    expect(report.summary.failed_critical).toBeGreaterThanOrEqual(1);
    expect(report.autonomy.execution_safety_supervisor_running).toBe(false);
    expect(report.autonomy.execution_safety_supervisor_last_error).toBe("stopped");
  });

  it("fails readiness as NOT_READY when kill switch is active with critical gate enabled", async () => {
    runtime.killSwitchActive = true;
    process.env.DEPLOYMENT_READINESS_KILL_SWITCH_CRITICAL = "true";

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Kill switch is inactive");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(true);
    expect(check?.passed).toBe(false);
    expect(report.status).toBe("NOT_READY");
    expect(report.summary.failed_critical).toBeGreaterThanOrEqual(1);
    expect(report.risk.kill_switch_active).toBe(true);
  });

  it("degrades readiness (not critical) when kill switch gate is configured non-critical", async () => {
    runtime.killSwitchActive = true;
    process.env.DEPLOYMENT_READINESS_KILL_SWITCH_CRITICAL = "false";

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Kill switch is inactive");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(false);
    expect(check?.passed).toBe(false);
    expect(report.status).toBe("DEGRADED");
    expect(report.summary.failed_critical).toBe(0);
    expect(report.summary.failed_non_critical).toBeGreaterThanOrEqual(1);
    expect(report.risk.kill_switch_active).toBe(true);
  });

  it("includes autonomy debug scheduler state in readiness payload", async () => {
    runtime.debugSchedulerExpected = true;
    runtime.debugSchedulerRunning = true;
    runtime.debugSchedulerLastStatus = "HEALTHY";
    runtime.debugSchedulerLastError = null;

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    expect(report.autonomy.autonomy_debug_scheduler_expected).toBe(true);
    expect(report.autonomy.autonomy_debug_scheduler_running).toBe(true);
    expect(report.autonomy.autonomy_debug_scheduler_last_error).toBeNull();
    expect(report.autonomy.autonomy_debug_scheduler_last_status).toBe("HEALTHY");
    expect(report.autonomy.autonomy_debug_scheduler_heartbeat_fresh).toBe(true);

    const check = report.checks.find((item) => item.name === "Autonomy debug scheduler running");
    expect(check).toBeDefined();
    expect(check?.passed).toBe(true);
  });

  it("marks NOT_READY in live mode when autonomy supervisor heartbeat is stale", async () => {
    runtime.systemMode = "live_enabled";
    runtime.supervisorExpected = true;
    runtime.supervisorRunning = true;
    runtime.supervisorLastTickAgeMs = 10 * 60_000;
    runtime.supervisorStartedAgeMs = 12 * 60_000;
    runtime.supervisorTotalTicks = 5;

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Autonomy supervisor heartbeat fresh");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(true);
    expect(check?.passed).toBe(false);
    expect(report.autonomy.autonomy_supervisor_heartbeat_fresh).toBe(false);
    expect(report.status).toBe("NOT_READY");
  });

  it("marks DEGRADED in paper mode when execution safety supervisor heartbeat is stale", async () => {
    runtime.systemMode = "paper";
    runtime.executionSafetyExpected = true;
    runtime.executionSafetyRunning = true;
    runtime.executionSafetyLastCycleAgeMs = 10 * 60_000;
    runtime.executionSafetyStartedAgeMs = 12 * 60_000;
    runtime.executionSafetyTotalCycles = 4;

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Execution safety supervisor heartbeat fresh");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(false);
    expect(check?.passed).toBe(false);
    expect(report.autonomy.execution_safety_supervisor_heartbeat_fresh).toBe(false);
    expect(report.status).toBe("DEGRADED");
  });

  it("treats debug scheduler as fresh during warmup before first cycle", async () => {
    runtime.debugSchedulerExpected = true;
    runtime.debugSchedulerRunning = true;
    runtime.debugSchedulerTotalCycles = 0;
    runtime.debugSchedulerLastCycleAgeMs = null;
    runtime.debugSchedulerStartedAgeMs = 30_000;

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Autonomy debug scheduler heartbeat fresh");
    expect(check).toBeDefined();
    expect(check?.passed).toBe(true);
    expect(report.autonomy.autonomy_debug_scheduler_heartbeat_fresh).toBe(true);
  });

  it("marks NOT_READY in live mode when expected debug scheduler is down", async () => {
    runtime.systemMode = "live_enabled";
    runtime.debugSchedulerExpected = true;
    runtime.debugSchedulerRunning = false;
    runtime.debugSchedulerLastStatus = "CRITICAL";
    runtime.debugSchedulerLastError = "stopped";

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Autonomy debug scheduler running");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(true);
    expect(check?.passed).toBe(false);
    expect(report.status).toBe("NOT_READY");
  });

  it("marks DEGRADED in paper mode when expected debug scheduler is down", async () => {
    runtime.systemMode = "paper";
    runtime.debugSchedulerExpected = true;
    runtime.debugSchedulerRunning = false;
    runtime.debugSchedulerLastStatus = "CRITICAL";
    runtime.debugSchedulerLastError = "stopped";

    const mod = await import("../lib/deployment_readiness");
    mod.resetDeploymentReadinessCache();
    const report = await mod.getDeploymentReadinessReport({ forceRefresh: true });

    const check = report.checks.find((item) => item.name === "Autonomy debug scheduler running");
    expect(check).toBeDefined();
    expect(check?.critical).toBe(false);
    expect(check?.passed).toBe(false);
    expect(report.status).toBe("DEGRADED");
  });
});
