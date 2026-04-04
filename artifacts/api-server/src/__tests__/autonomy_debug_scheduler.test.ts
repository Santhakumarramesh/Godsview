import { beforeEach, describe, expect, it, vi } from "vitest";

type Status = "HEALTHY" | "DEGRADED" | "CRITICAL";

const runtime = vi.hoisted(() => ({
  statuses: [] as Status[],
  criticalCounts: [] as number[],
  warnCounts: [] as number[],
  fixSuccesses: 1,
  fixFailures: 0,
  killSwitch: false,
  alerts: [] as Array<{ level: "info" | "warn" | "critical"; message: string }>,
}));

function resetRuntime(): void {
  runtime.statuses = [];
  runtime.criticalCounts = [];
  runtime.warnCounts = [];
  runtime.fixSuccesses = 1;
  runtime.fixFailures = 0;
  runtime.killSwitch = false;
  runtime.alerts = [];
}

function makeSnapshot(status: Status, critical: number, warn: number) {
  return {
    generated_at: new Date().toISOString(),
    overall_status: status,
    readiness_status: status === "HEALTHY" ? "READY" : "DEGRADED",
    readiness_summary: { failed_critical: critical, failed_non_critical: warn },
    kill_switch_active: false,
    supervisor_health: {
      expected_services: 5,
      healthy_services: status === "CRITICAL" ? 2 : 5,
      ratio: status === "CRITICAL" ? 0.4 : 1,
    },
    services: [],
    issues: [
      ...Array.from({ length: critical }).map((_, idx) => ({
        code: `CRIT_${idx}`,
        severity: "critical" as const,
        summary: "critical issue",
        detail: "critical issue detail",
        recommendation: "fix critical",
      })),
      ...Array.from({ length: warn }).map((_, idx) => ({
        code: `WARN_${idx}`,
        severity: "warn" as const,
        summary: "warn issue",
        detail: "warn issue detail",
        recommendation: "fix warning",
      })),
    ],
    recommendations: [],
  };
}

vi.mock("../lib/autonomy_debugger", () => ({
  getAutonomyDebugSnapshot: vi.fn(async () => {
    const status = runtime.statuses.shift() ?? "HEALTHY";
    const critical = runtime.criticalCounts.shift() ?? 0;
    const warn = runtime.warnCounts.shift() ?? 0;
    return makeSnapshot(status, critical, warn);
  }),
  runAutonomyDebugAutoFix: vi.fn(async () => ({
    fixes: [
      ...Array.from({ length: runtime.fixSuccesses }).map(() => ({
        service: "strategy_allocator",
        attempted: true,
        success: true,
        detail: "ok",
      })),
      ...Array.from({ length: runtime.fixFailures }).map(() => ({
        service: "strategy_governor",
        attempted: true,
        success: false,
        detail: "failed",
      })),
    ],
    snapshot: makeSnapshot("HEALTHY", 0, 0),
  })),
}));

vi.mock("../lib/ops_monitor", () => ({
  addOpsAlert: vi.fn((level: "info" | "warn" | "critical", message: string) => {
    runtime.alerts.push({ level, message });
  }),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => runtime.killSwitch),
  setKillSwitchActive: vi.fn((active: boolean) => {
    runtime.killSwitch = Boolean(active);
    return {
      runtime: { killSwitchActive: runtime.killSwitch, updatedAt: new Date().toISOString() },
      config: {},
    };
  }),
}));

describe("autonomy_debug_scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();

    delete process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_ENFORCE;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_INTERVAL_MS;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_INCLUDE_PREFLIGHT;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_FIX_ON_DEGRADED;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_FIX_ON_CRITICAL;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_CRITICAL_ALERT_THRESHOLD;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_KILL_ON_CRITICAL_STREAK;
    delete process.env.AUTONOMY_DEBUG_SCHEDULER_KILL_SWITCH_THRESHOLD;
  });

  it("raises a critical streak alert and auto-fixes on repeated CRITICAL snapshots", async () => {
    process.env.AUTONOMY_DEBUG_SCHEDULER_CRITICAL_ALERT_THRESHOLD = "2";
    process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_FIX_ON_CRITICAL = "true";

    runtime.statuses = ["CRITICAL", "CRITICAL"];
    runtime.criticalCounts = [2, 3];
    runtime.warnCounts = [1, 0];
    runtime.fixSuccesses = 1;
    runtime.fixFailures = 0;

    const scheduler = await import("../lib/autonomy_debug_scheduler");
    await scheduler.runAutonomyDebugSchedulerCycle("critical-1");
    await scheduler.runAutonomyDebugSchedulerCycle("critical-2");

    const snapshot = scheduler.getAutonomyDebugSchedulerSnapshot();
    expect(snapshot.last_status).toBe("CRITICAL");
    expect(snapshot.consecutive_critical).toBe(2);
    expect(snapshot.total_fix_actions).toBe(2);
    expect(snapshot.recent_actions.some((action) => action.action === "ALERT_CRITICAL_STREAK")).toBe(true);
    expect(runtime.alerts.some((alert) => alert.level === "critical")).toBe(true);
  });

  it("emits recovered action when CRITICAL state returns to HEALTHY", async () => {
    runtime.statuses = ["CRITICAL", "HEALTHY"];
    runtime.criticalCounts = [1, 0];
    runtime.warnCounts = [0, 0];

    const scheduler = await import("../lib/autonomy_debug_scheduler");
    await scheduler.runAutonomyDebugSchedulerCycle("critical");
    await scheduler.runAutonomyDebugSchedulerCycle("healthy");

    const snapshot = scheduler.getAutonomyDebugSchedulerSnapshot();
    expect(snapshot.last_status).toBe("HEALTHY");
    expect(snapshot.consecutive_critical).toBe(0);
    expect(snapshot.recent_actions.some((action) => action.action === "RECOVERED")).toBe(true);
    expect(runtime.alerts.some((alert) => alert.level === "info")).toBe(true);
  });

  it("starts and stops scheduler cleanly", async () => {
    const scheduler = await import("../lib/autonomy_debug_scheduler");

    const started = await scheduler.startAutonomyDebugScheduler({ intervalMs: 12_000, runImmediate: false });
    expect(started.success).toBe(true);
    expect(scheduler.getAutonomyDebugSchedulerSnapshot().running).toBe(true);
    expect(scheduler.getAutonomyDebugSchedulerSnapshot().interval_ms).toBe(15_000);

    const stopped = scheduler.stopAutonomyDebugScheduler();
    expect(stopped.success).toBe(true);
    expect(scheduler.getAutonomyDebugSchedulerSnapshot().running).toBe(false);
  });

  it("engages kill switch when critical streak crosses kill-switch threshold", async () => {
    process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_KILL_ON_CRITICAL_STREAK = "true";
    process.env.AUTONOMY_DEBUG_SCHEDULER_KILL_SWITCH_THRESHOLD = "2";
    process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_FIX_ON_CRITICAL = "false";

    runtime.statuses = ["CRITICAL", "CRITICAL"];
    runtime.criticalCounts = [2, 2];
    runtime.warnCounts = [0, 0];
    runtime.killSwitch = false;

    const scheduler = await import("../lib/autonomy_debug_scheduler");
    await scheduler.runAutonomyDebugSchedulerCycle("critical-1");
    await scheduler.runAutonomyDebugSchedulerCycle("critical-2");

    const snapshot = scheduler.getAutonomyDebugSchedulerSnapshot();
    expect(snapshot.kill_switch_active).toBe(true);
    expect(snapshot.kill_switch_engaged_by_scheduler).toBe(true);
    expect(snapshot.recent_actions.some((action) => action.action === "ENGAGE_KILL_SWITCH")).toBe(true);
    expect(runtime.alerts.some((alert) => alert.message.includes("kill switch engaged"))).toBe(true);
  });
});
