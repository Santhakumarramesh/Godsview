import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  supervisorRunning: true,
  schedulerRunning: true,
  schedulerInFlight: false,
  schedulerStatus: "HEALTHY" as "HEALTHY" | "DEGRADED" | "CRITICAL" | null,
  schedulerConsecutiveCritical: 0,
  watchdogRunning: true,
  watchdogStatus: "READY" as "READY" | "DEGRADED" | "NOT_READY" | null,
  watchdogEscalation: false,
  killSwitch: false,
}));

function resetRuntime(): void {
  runtime.supervisorRunning = true;
  runtime.schedulerRunning = true;
  runtime.schedulerInFlight = false;
  runtime.schedulerStatus = "HEALTHY";
  runtime.schedulerConsecutiveCritical = 0;
  runtime.watchdogRunning = true;
  runtime.watchdogStatus = "READY";
  runtime.watchdogEscalation = false;
  runtime.killSwitch = false;
}

vi.mock("../lib/autonomy_debug_scheduler", () => ({
  getAutonomyDebugSchedulerSnapshot: vi.fn(() => ({
    running: runtime.schedulerRunning,
    cycle_in_flight: runtime.schedulerInFlight,
    started_at: null,
    last_cycle_at: null,
    last_cycle_duration_ms: null,
    last_error: null,
    total_cycles: 0,
    total_actions: 0,
    total_fix_actions: 0,
    interval_ms: 60_000,
    consecutive_critical: runtime.schedulerConsecutiveCritical,
    last_status: runtime.schedulerStatus,
    last_issue_count: runtime.schedulerStatus === "CRITICAL" ? 3 : 0,
    last_critical_issues: runtime.schedulerStatus === "CRITICAL" ? 2 : 0,
    last_warn_issues: runtime.schedulerStatus === "DEGRADED" ? 2 : 0,
    policy: {
      auto_enforce: true,
      interval_ms: 60_000,
      include_preflight: false,
      auto_fix_on_degraded: true,
      auto_fix_on_critical: true,
      critical_alert_threshold: 2,
    },
    recent_actions: [],
  })),
  runAutonomyDebugSchedulerCycle: vi.fn(async () => {
    runtime.schedulerStatus = "HEALTHY";
    runtime.schedulerConsecutiveCritical = 0;
    return {
      running: true,
      cycle_in_flight: false,
      started_at: null,
      last_cycle_at: new Date().toISOString(),
      last_cycle_duration_ms: 10,
      last_error: null,
      total_cycles: 1,
      total_actions: 1,
      total_fix_actions: 1,
      interval_ms: 60_000,
      consecutive_critical: 0,
      last_status: "HEALTHY" as const,
      last_issue_count: 0,
      last_critical_issues: 0,
      last_warn_issues: 0,
      policy: {
        auto_enforce: true,
        interval_ms: 60_000,
        include_preflight: false,
        auto_fix_on_degraded: true,
        auto_fix_on_critical: true,
        critical_alert_threshold: 2,
      },
      recent_actions: [],
    };
  }),
}));

vi.mock("../lib/production_watchdog", () => ({
  getProductionWatchdogSnapshot: vi.fn(() => ({
    running: runtime.watchdogRunning,
    cycle_in_flight: false,
    started_at: null,
    last_cycle_at: null,
    last_cycle_duration_ms: null,
    last_error: null,
    total_cycles: 0,
    total_actions: 0,
    interval_ms: 45_000,
    consecutive_not_ready: 0,
    consecutive_degraded: 0,
    escalation_active: runtime.watchdogEscalation,
    last_status: runtime.watchdogStatus,
    last_report_at: null,
    last_report_summary: { failed_critical: 0, failed_non_critical: 0 },
    policy: {
      auto_enforce: true,
      interval_ms: 45_000,
      include_preflight: false,
      not_ready_trip_count: 3,
      degraded_warn_count: 4,
      auto_pause_autonomy: true,
      auto_kill_switch: true,
    },
    recent_actions: [],
  })),
}));

vi.mock("../lib/autonomy_supervisor", () => ({
  getAutonomySupervisorSnapshot: vi.fn(() => ({
    running: runtime.supervisorRunning,
    services: [],
    total_ticks: 0,
    total_heal_actions: 0,
    last_error: null,
    last_tick_at: null,
  })),
}));

vi.mock("../lib/risk_engine", () => ({
  setKillSwitchActive: vi.fn((active: boolean) => {
    runtime.killSwitch = Boolean(active);
    return { runtime: { killSwitchActive: runtime.killSwitch }, config: {} };
  }),
}));

describe("execution_autonomy_guard", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();

    delete process.env.EXEC_AUTONOMY_GUARD_AUTO_RUN_SCHEDULER_ON_BLOCK;
    delete process.env.EXEC_AUTONOMY_GUARD_BLOCK_SCHEDULER_DEGRADED;
    delete process.env.EXEC_AUTONOMY_GUARD_BLOCK_WATCHDOG_DEGRADED;
    delete process.env.EXEC_AUTONOMY_GUARD_MAX_CONSECUTIVE_BLOCKS;
    delete process.env.EXEC_AUTONOMY_GUARD_MAX_BLOCKS_WINDOW;
    delete process.env.EXEC_AUTONOMY_GUARD_SYNC_KILL_SWITCH_ON_HALT;
  });

  it("blocks when scheduler is CRITICAL and auto-heal is disabled", async () => {
    process.env.EXEC_AUTONOMY_GUARD_AUTO_RUN_SCHEDULER_ON_BLOCK = "false";
    runtime.schedulerStatus = "CRITICAL";
    runtime.schedulerConsecutiveCritical = 2;

    const guard = await import("../lib/execution_autonomy_guard");
    const decision = await guard.evaluateExecutionAutonomyGuard({ symbol: "BTCUSD", autoHeal: false });

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe("BLOCK");
    expect(decision.reasons).toContain("scheduler_status_critical");
  });

  it("auto-heals by running scheduler cycle and allows execution after recovery", async () => {
    process.env.EXEC_AUTONOMY_GUARD_AUTO_RUN_SCHEDULER_ON_BLOCK = "true";
    runtime.schedulerStatus = "CRITICAL";
    runtime.schedulerConsecutiveCritical = 3;

    const guard = await import("../lib/execution_autonomy_guard");
    const decision = await guard.evaluateExecutionAutonomyGuard({ symbol: "ETHUSD", autoHeal: true });

    expect(decision.allowed).toBe(true);
    expect(decision.action === "ALLOW" || decision.action === "WARN").toBe(true);
    expect(decision.snapshot.recent_events.some((event) => event.type === "AUTO_HEAL_ATTEMPT")).toBe(true);
  });

  it("halts after consecutive autonomy blocks and engages kill switch when configured", async () => {
    process.env.EXEC_AUTONOMY_GUARD_AUTO_RUN_SCHEDULER_ON_BLOCK = "false";
    process.env.EXEC_AUTONOMY_GUARD_MAX_CONSECUTIVE_BLOCKS = "2";
    process.env.EXEC_AUTONOMY_GUARD_SYNC_KILL_SWITCH_ON_HALT = "true";
    runtime.watchdogStatus = "NOT_READY";

    const guard = await import("../lib/execution_autonomy_guard");
    await guard.evaluateExecutionAutonomyGuard({ symbol: "AAPL", autoHeal: false });
    const decision = await guard.evaluateExecutionAutonomyGuard({ symbol: "AAPL", autoHeal: false });

    expect(decision.snapshot.halt_active).toBe(true);
    expect(decision.snapshot.level).toBe("HALT");
    expect(runtime.killSwitch).toBe(true);

    const reset = guard.resetExecutionAutonomyGuard({ reason: "test_reset", clearKillSwitch: true });
    expect(reset.halt_active).toBe(false);
  });
});

