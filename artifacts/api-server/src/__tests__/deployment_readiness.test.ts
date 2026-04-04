import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  executionSafetyRunning: true,
  executionSafetyLastError: null as string | null,
  killSwitchActive: false,
  systemMode: "paper_enabled" as "dry_run" | "paper_enabled" | "live_enabled",
  debugSchedulerExpected: true,
  debugSchedulerRunning: true,
  debugSchedulerLastError: null as string | null,
  debugSchedulerLastStatus: "HEALTHY" as "HEALTHY" | "DEGRADED" | "CRITICAL",
}));

function resetRuntime(): void {
  runtime.executionSafetyRunning = true;
  runtime.executionSafetyLastError = null;
  runtime.killSwitchActive = false;
  runtime.systemMode = "paper_enabled";
  runtime.debugSchedulerExpected = true;
  runtime.debugSchedulerRunning = true;
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
  getAutonomySupervisorSnapshot: vi.fn(() => ({
    running: true,
    total_ticks: 3,
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
  getProductionWatchdogSnapshot: vi.fn(() => ({
    running: true,
    last_status: "READY",
    last_error: null,
  })),
}));

vi.mock("../lib/execution_safety_supervisor", () => ({
  getExecutionSafetySupervisorSnapshot: vi.fn(() => ({
    running: runtime.executionSafetyRunning,
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

    const check = report.checks.find((item) => item.name === "Autonomy debug scheduler running");
    expect(check).toBeDefined();
    expect(check?.passed).toBe(true);
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
    runtime.systemMode = "paper_enabled";
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
