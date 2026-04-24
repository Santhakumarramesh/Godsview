import { beforeEach, describe, expect, it, vi } from "vitest";

type ReadinessStatus = "READY" | "DEGRADED" | "NOT_READY";

const runtime = {
  statuses: [] as ReadinessStatus[],
  supervisorRunning: true,
  killSwitch: false,
  alerts: [] as Array<{ level: "info" | "warn" | "critical"; message: string }>,
};

function resetRuntime(): void {
  runtime.statuses = [];
  runtime.supervisorRunning = true;
  runtime.killSwitch = false;
  runtime.alerts = [];
}

function nextStatus(): ReadinessStatus {
  return runtime.statuses.shift() ?? "READY";
}

vi.mock("../lib/deployment_readiness", () => ({
  getDeploymentReadinessReport: vi.fn(async () => {
    const status = nextStatus();
    return {
      generated_at: new Date().toISOString(),
      status,
      summary: {
        total: 10,
        passed: status === "READY" ? 10 : status === "DEGRADED" ? 8 : 6,
        failed_critical: status === "NOT_READY" ? 2 : 0,
        failed_non_critical: status === "READY" ? 0 : status === "DEGRADED" ? 2 : 2,
      },
      checks: [],
    };
  }),
}));

vi.mock("../lib/autonomy_supervisor", () => ({
  getAutonomySupervisorSnapshot: vi.fn(() => ({
    running: runtime.supervisorRunning,
    services: [],
    total_ticks: 0,
    total_heal_actions: 0,
  })),
  stopAutonomySupervisor: vi.fn(() => {
    const success = runtime.supervisorRunning;
    runtime.supervisorRunning = false;
    return {
      success,
      message: success ? "Autonomy supervisor stopped" : "Autonomy supervisor not running",
    };
  }),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => runtime.killSwitch),
  setKillSwitchActive: vi.fn((active: boolean) => {
    runtime.killSwitch = Boolean(active);
    return {
      runtime: {
        killSwitchActive: runtime.killSwitch,
        updatedAt: new Date().toISOString(),
      },
      config: {},
    };
  }),
}));

vi.mock("../lib/ops_monitor", () => ({
  addOpsAlert: vi.fn((level: "info" | "warn" | "critical", message: string) => {
    runtime.alerts.push({ level, message });
  }),
}));

describe("production_watchdog", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();

    delete process.env.PRODUCTION_WATCHDOG_INTERVAL_MS;
    delete process.env.PRODUCTION_WATCHDOG_NOT_READY_TRIP_COUNT;
    delete process.env.PRODUCTION_WATCHDOG_DEGRADED_WARN_COUNT;
    delete process.env.PRODUCTION_WATCHDOG_AUTO_ENFORCE;
    delete process.env.PRODUCTION_WATCHDOG_AUTO_PAUSE_AUTONOMY;
    delete process.env.PRODUCTION_WATCHDOG_AUTO_KILL_SWITCH;
    delete process.env.PRODUCTION_WATCHDOG_INCLUDE_PREFLIGHT;
  });

  it("escalates after consecutive NOT_READY cycles and applies safety actions", async () => {
    process.env.PRODUCTION_WATCHDOG_NOT_READY_TRIP_COUNT = "2";
    process.env.PRODUCTION_WATCHDOG_AUTO_PAUSE_AUTONOMY = "true";
    process.env.PRODUCTION_WATCHDOG_AUTO_KILL_SWITCH = "true";

    runtime.statuses = ["NOT_READY", "NOT_READY"];

    const watchdog = await import("../lib/production_watchdog");
    await watchdog.runProductionWatchdogCycle("test-1");
    await watchdog.runProductionWatchdogCycle("test-2");

    const snapshot = watchdog.getProductionWatchdogSnapshot();
    expect(snapshot.last_status).toBe("NOT_READY");
    expect(snapshot.consecutive_not_ready).toBe(2);
    expect(snapshot.escalation_active).toBe(true);
    expect(runtime.supervisorRunning).toBe(false);
    expect(runtime.killSwitch).toBe(true);
    expect(runtime.alerts.some((a) => a.level === "critical")).toBe(true);
  });

  it("emits a warning after sustained DEGRADED status", async () => {
    process.env.PRODUCTION_WATCHDOG_DEGRADED_WARN_COUNT = "2";

    runtime.statuses = ["DEGRADED", "DEGRADED"];

    const watchdog = await import("../lib/production_watchdog");
    await watchdog.runProductionWatchdogCycle("degraded-1");
    await watchdog.runProductionWatchdogCycle("degraded-2");

    const snapshot = watchdog.getProductionWatchdogSnapshot();
    expect(snapshot.last_status).toBe("DEGRADED");
    expect(snapshot.consecutive_degraded).toBe(2);
    expect(snapshot.consecutive_not_ready).toBe(0);
    expect(runtime.killSwitch).toBe(false);
    expect(runtime.supervisorRunning).toBe(true);

    const warnAlerts = runtime.alerts.filter((a) => a.level === "warn");
    expect(warnAlerts).toHaveLength(1);
  });

  it("resets counters and escalation state when readiness recovers", async () => {
    process.env.PRODUCTION_WATCHDOG_NOT_READY_TRIP_COUNT = "2";

    runtime.statuses = ["NOT_READY", "NOT_READY", "READY"];

    const watchdog = await import("../lib/production_watchdog");
    await watchdog.runProductionWatchdogCycle("n1");
    await watchdog.runProductionWatchdogCycle("n2");
    await watchdog.runProductionWatchdogCycle("r1");

    const snapshot = watchdog.getProductionWatchdogSnapshot();
    expect(snapshot.last_status).toBe("READY");
    expect(snapshot.consecutive_not_ready).toBe(0);
    expect(snapshot.consecutive_degraded).toBe(0);
    expect(snapshot.escalation_active).toBe(false);
    expect(snapshot.recent_actions.some((a) => a.action === "RECOVERED")).toBe(true);
  });

  it("starts and stops scheduler cleanly", async () => {
    const watchdog = await import("../lib/production_watchdog");

    const started = await watchdog.startProductionWatchdog({ intervalMs: 12_000, runImmediate: false });
    expect(started.success).toBe(true);
    expect(watchdog.getProductionWatchdogSnapshot().running).toBe(true);

    const stopped = watchdog.stopProductionWatchdog();
    expect(stopped.success).toBe(true);
    expect(watchdog.getProductionWatchdogSnapshot().running).toBe(false);
  });
});
