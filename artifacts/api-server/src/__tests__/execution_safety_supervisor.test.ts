import { beforeEach, describe, expect, it, vi } from "vitest";

type Action = "ALLOW" | "WARN" | "BLOCK";
type RiskState = "NORMAL" | "ELEVATED" | "CRITICAL" | "HALT";
type IncidentLevel = "NORMAL" | "WATCH" | "HALT";

const runtime = vi.hoisted(() => ({
  autonomyActions: [] as Action[],
  marketActions: [] as Action[],
  riskStates: [] as RiskState[],
  incidentLevels: [] as IncidentLevel[],
  incidentHalts: [] as boolean[],
  killSwitch: false,
  alerts: [] as Array<{ level: "info" | "warn" | "critical"; message: string }>,
}));

function resetRuntime(): void {
  runtime.autonomyActions = [];
  runtime.marketActions = [];
  runtime.riskStates = [];
  runtime.incidentLevels = [];
  runtime.incidentHalts = [];
  runtime.killSwitch = false;
  runtime.alerts = [];
}

function next<T>(arr: T[], fallback: T): T {
  return arr.length > 0 ? (arr.shift() as T) : fallback;
}

vi.mock("../lib/execution_autonomy_guard", () => ({
  evaluateExecutionAutonomyGuard: vi.fn(async () => {
    const action = next(runtime.autonomyActions, "ALLOW");
    return {
      allowed: action !== "BLOCK",
      level: action === "BLOCK" ? "HALT" : action === "WARN" ? "WATCH" : "NORMAL",
      action,
      reasons: action === "ALLOW" ? [] : [action === "BLOCK" ? "autonomy_block" : "autonomy_warn"],
      snapshot: { level: "NORMAL", halt_active: false },
    };
  }),
}));

vi.mock("../lib/execution_market_guard", () => ({
  evaluateExecutionMarketGuard: vi.fn(async () => {
    const action = next(runtime.marketActions, "ALLOW");
    return {
      allowed: action !== "BLOCK",
      level: action === "BLOCK" ? "HALT" : action === "WARN" ? "WATCH" : "NORMAL",
      action,
      reasons: action === "ALLOW" ? [] : [action === "BLOCK" ? "market_block" : "market_warn"],
      snapshot: { level: "NORMAL", halt_active: false },
    };
  }),
}));

vi.mock("../lib/portfolio_risk_guard", () => ({
  evaluatePortfolioRisk: vi.fn(async () => ({
    generated_at: new Date().toISOString(),
    account_equity: 100000,
    peak_equity: 100000,
    drawdown_pct: 0,
    one_day_var_usd: 0,
    one_day_var_pct: 0,
    var_confidence: 0.95,
    avg_pair_correlation: 0,
    max_pair_correlation: 0,
    correlated_pairs: [],
    open_positions: [],
    limits: {
      max_drawdown_pct: 0.15,
      max_var_pct: 0.02,
      max_avg_correlation: 0.7,
      max_pair_correlation: 0.9,
    },
    breaches: [],
    risk_state: next(runtime.riskStates, "NORMAL"),
    candidate_symbol: "BTCUSD",
    candidate_max_correlation: 0,
  })),
}));

vi.mock("../lib/execution_incident_guard", () => ({
  getExecutionIncidentSnapshot: vi.fn(() => ({
    level: next(runtime.incidentLevels, "NORMAL"),
    halt_active: next(runtime.incidentHalts, false),
    running_window_ms: 0,
    consecutive_failures: 0,
    window_failures: 0,
    window_rejections: 0,
    window_slippage_spikes: 0,
    total_events: 0,
    last_event_at: null,
    last_halt_reason: null,
    policy: {
      window_ms: 0,
      max_failures_window: 0,
      max_rejections_window: 0,
      max_consecutive_failures: 0,
      max_slippage_bps: 0,
      max_slippage_spikes_window: 0,
      auto_halt: true,
    },
    recent_events: [],
  })),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => runtime.killSwitch),
  setKillSwitchActive: vi.fn((active: boolean) => {
    runtime.killSwitch = Boolean(active);
    return { runtime: { killSwitchActive: runtime.killSwitch }, config: {} };
  }),
}));

vi.mock("../lib/ops_monitor", () => ({
  addOpsAlert: vi.fn((level: "info" | "warn" | "critical", message: string) => {
    runtime.alerts.push({ level, message });
  }),
}));

describe("execution_safety_supervisor", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();

    delete process.env.EXEC_SAFETY_SUPERVISOR_BLOCK_ALERT_THRESHOLD;
    delete process.env.EXEC_SAFETY_SUPERVISOR_WARN_ALERT_THRESHOLD;
    delete process.env.EXEC_SAFETY_SUPERVISOR_AUTO_KILL_ON_BLOCK;
    delete process.env.EXEC_SAFETY_SUPERVISOR_INCLUDE_MARKET_GUARD;
    delete process.env.EXEC_SAFETY_SUPERVISOR_INCLUDE_PORTFOLIO_RISK;
  });

  it("alerts and engages kill switch on blocked streak", async () => {
    process.env.EXEC_SAFETY_SUPERVISOR_BLOCK_ALERT_THRESHOLD = "2";
    process.env.EXEC_SAFETY_SUPERVISOR_AUTO_KILL_ON_BLOCK = "true";

    runtime.autonomyActions = ["BLOCK", "BLOCK"];
    runtime.marketActions = ["ALLOW", "ALLOW"];
    runtime.riskStates = ["NORMAL", "NORMAL"];
    runtime.incidentLevels = ["NORMAL", "NORMAL"];
    runtime.incidentHalts = [false, false];

    const supervisor = await import("../lib/execution_safety_supervisor");
    await supervisor.runExecutionSafetySupervisorCycle("block-1");
    await supervisor.runExecutionSafetySupervisorCycle("block-2");

    const snapshot = supervisor.getExecutionSafetySupervisorSnapshot();
    expect(snapshot.consecutive_blocked).toBe(2);
    expect(snapshot.recent_actions.some((action) => action.action === "ALERT_BLOCK_STREAK")).toBe(true);
    expect(snapshot.recent_actions.some((action) => action.action === "ENGAGE_KILL_SWITCH")).toBe(true);
    expect(runtime.alerts.some((alert) => alert.level === "critical")).toBe(true);
    expect(runtime.killSwitch).toBe(true);
  });

  it("emits warning streak alert and recovers on healthy cycle", async () => {
    process.env.EXEC_SAFETY_SUPERVISOR_WARN_ALERT_THRESHOLD = "2";
    runtime.autonomyActions = ["WARN", "WARN", "ALLOW"];
    runtime.marketActions = ["ALLOW", "ALLOW", "ALLOW"];
    runtime.riskStates = ["NORMAL", "NORMAL", "NORMAL"];
    runtime.incidentLevels = ["NORMAL", "NORMAL", "NORMAL"];
    runtime.incidentHalts = [false, false, false];

    const supervisor = await import("../lib/execution_safety_supervisor");
    await supervisor.runExecutionSafetySupervisorCycle("warn-1");
    await supervisor.runExecutionSafetySupervisorCycle("warn-2");
    await supervisor.runExecutionSafetySupervisorCycle("recovered");

    const snapshot = supervisor.getExecutionSafetySupervisorSnapshot();
    expect(snapshot.consecutive_warn).toBe(0);
    expect(snapshot.consecutive_blocked).toBe(0);
    expect(snapshot.recent_actions.some((action) => action.action === "ALERT_WARN_STREAK")).toBe(true);
    expect(snapshot.recent_actions.some((action) => action.action === "RECOVERED")).toBe(true);
  });

  it("starts and stops scheduler cleanly", async () => {
    const supervisor = await import("../lib/execution_safety_supervisor");

    const started = await supervisor.startExecutionSafetySupervisor({
      intervalMs: 12_000,
      runImmediate: false,
      heartbeatSymbol: "spy",
    });
    expect(started.success).toBe(true);
    expect(started.heartbeat_symbol).toBe("SPY");
    expect(supervisor.getExecutionSafetySupervisorSnapshot().running).toBe(true);

    const stopped = supervisor.stopExecutionSafetySupervisor();
    expect(stopped.success).toBe(true);
    expect(supervisor.getExecutionSafetySupervisorSnapshot().running).toBe(false);
  });
});

