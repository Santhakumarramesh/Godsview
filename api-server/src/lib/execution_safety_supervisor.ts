import { logger as _logger } from "./logger";
import { addOpsAlert } from "./ops_monitor";
import { isKillSwitchActive, setKillSwitchActive } from "./risk_engine";
import {
  evaluateExecutionAutonomyGuard,
  type ExecutionAutonomyGuardAction,
} from "./execution_autonomy_guard";
import {
  evaluateExecutionMarketGuard,
  type ExecutionMarketGuardAction,
} from "./execution_market_guard";
import { getExecutionIncidentSnapshot } from "./execution_incident_guard";
import {
  evaluatePortfolioRisk,
  type PortfolioRiskState,
} from "./portfolio_risk_guard";

const logger = _logger.child({ module: "execution_safety_supervisor" });

const DEFAULT_INTERVAL_MS = 45_000;
const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 10 * 60_000;
const DEFAULT_WARN_ALERT_THRESHOLD = 3;
const DEFAULT_BLOCK_ALERT_THRESHOLD = 2;
const MAX_RECENT_ACTIONS = 120;

export interface ExecutionSafetySupervisorPolicy {
  auto_enforce: boolean;
  interval_ms: number;
  heartbeat_symbol: string;
  include_market_guard: boolean;
  include_portfolio_risk: boolean;
  auto_heal_autonomy: boolean;
  warn_alert_threshold: number;
  block_alert_threshold: number;
  auto_kill_switch_on_block: boolean;
}

export interface ExecutionSafetySupervisorSummary {
  autonomy_action: ExecutionAutonomyGuardAction;
  market_action: ExecutionMarketGuardAction | null;
  portfolio_state: PortfolioRiskState | null;
  incident_level: "NORMAL" | "WATCH" | "HALT";
  incident_halt: boolean;
  blocked_reasons: string[];
  warning_reasons: string[];
}

export interface ExecutionSafetySupervisorAction {
  at: string;
  cycle_reason: string;
  action: "EVALUATE" | "ALERT_WARN_STREAK" | "ALERT_BLOCK_STREAK" | "ENGAGE_KILL_SWITCH" | "RECOVERED";
  success: boolean;
  detail: string;
}

export interface ExecutionSafetySupervisorSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  consecutive_warn: number;
  consecutive_blocked: number;
  last_summary: ExecutionSafetySupervisorSummary | null;
  policy: ExecutionSafetySupervisorPolicy;
  recent_actions: ExecutionSafetySupervisorAction[];
}

let _running = false;
let _cycleInFlight = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startedAtMs: number | null = null;
let _lastCycleAtMs: number | null = null;
let _lastCycleDurationMs: number | null = null;
let _lastError: string | null = null;
let _totalCycles = 0;
let _totalActions = 0;
let _intervalMs = parseIntervalMs(process.env.EXEC_SAFETY_SUPERVISOR_INTERVAL_MS, DEFAULT_INTERVAL_MS);
let _heartbeatSymbol = normalizeSymbol(process.env.EXEC_SAFETY_SUPERVISOR_HEARTBEAT_SYMBOL);
let _consecutiveWarn = 0;
let _consecutiveBlocked = 0;
let _lastSummary: ExecutionSafetySupervisorSummary | null = null;
const _recentActions: ExecutionSafetySupervisorAction[] = [];

function normalizeSymbol(raw: string | undefined): string {
  const value = String(raw ?? "").trim().toUpperCase();
  return value || "BTCUSD";
}

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseIntervalMs(raw: string | undefined, fallback: number): number {
  return parseIntEnv(raw, fallback, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function policy(): ExecutionSafetySupervisorPolicy {
  return {
    auto_enforce: boolEnv(process.env.EXEC_SAFETY_SUPERVISOR_AUTO_ENFORCE, true),
    interval_ms: _intervalMs,
    heartbeat_symbol: _heartbeatSymbol,
    include_market_guard: boolEnv(process.env.EXEC_SAFETY_SUPERVISOR_INCLUDE_MARKET_GUARD, true),
    include_portfolio_risk: boolEnv(process.env.EXEC_SAFETY_SUPERVISOR_INCLUDE_PORTFOLIO_RISK, true),
    auto_heal_autonomy: boolEnv(process.env.EXEC_SAFETY_SUPERVISOR_AUTO_HEAL_AUTONOMY, true),
    warn_alert_threshold: parseIntEnv(
      process.env.EXEC_SAFETY_SUPERVISOR_WARN_ALERT_THRESHOLD,
      DEFAULT_WARN_ALERT_THRESHOLD,
      1,
      20,
    ),
    block_alert_threshold: parseIntEnv(
      process.env.EXEC_SAFETY_SUPERVISOR_BLOCK_ALERT_THRESHOLD,
      DEFAULT_BLOCK_ALERT_THRESHOLD,
      1,
      20,
    ),
    auto_kill_switch_on_block: boolEnv(process.env.EXEC_SAFETY_SUPERVISOR_AUTO_KILL_ON_BLOCK, true),
  };
}

function pushAction(action: ExecutionSafetySupervisorAction): void {
  _recentActions.unshift(action);
  if (_recentActions.length > MAX_RECENT_ACTIONS) {
    _recentActions.pop();
  }
  _totalActions += 1;
}

async function runCycleInternal(reason: string): Promise<void> {
  const p = policy();
  const symbol = p.heartbeat_symbol;
  const blockedReasons: string[] = [];
  const warningReasons: string[] = [];

  const autonomy = await evaluateExecutionAutonomyGuard({
    symbol,
    autoHeal: p.auto_heal_autonomy,
  });
  if (autonomy.action === "BLOCK") blockedReasons.push(...autonomy.reasons.map((r) => `autonomy:${r}`));
  if (autonomy.action === "WARN") warningReasons.push(...autonomy.reasons.map((r) => `autonomy:${r}`));

  let marketAction: ExecutionMarketGuardAction | null = null;
  if (p.include_market_guard) {
    const market = await evaluateExecutionMarketGuard({ symbol });
    marketAction = market.action;
    if (market.action === "BLOCK") blockedReasons.push(...market.reasons.map((r) => `market:${r}`));
    if (market.action === "WARN") warningReasons.push(...market.reasons.map((r) => `market:${r}`));
  }

  let portfolioState: PortfolioRiskState | null = null;
  if (p.include_portfolio_risk) {
    const portfolio = await evaluatePortfolioRisk({
      candidateSymbol: symbol,
      forceRefresh: true,
      autoHalt: false,
    });
    portfolioState = portfolio.risk_state;
    if (portfolio.risk_state === "HALT") blockedReasons.push("portfolio:HALT");
    if (portfolio.risk_state === "CRITICAL" || portfolio.risk_state === "ELEVATED") {
      warningReasons.push(`portfolio:${portfolio.risk_state}`);
    }
  }

  const incident = getExecutionIncidentSnapshot();
  if (incident.halt_active || incident.level === "HALT") {
    blockedReasons.push(`incident:${incident.last_halt_reason ?? "halt_active"}`);
  } else if (incident.level === "WATCH") {
    warningReasons.push("incident:WATCH");
  }

  _lastSummary = {
    autonomy_action: autonomy.action,
    market_action: marketAction,
    portfolio_state: portfolioState,
    incident_level: incident.level,
    incident_halt: incident.halt_active,
    blocked_reasons: blockedReasons,
    warning_reasons: warningReasons,
  };

  const blocked = blockedReasons.length > 0;
  const warn = !blocked && warningReasons.length > 0;
  const hadIncident = _consecutiveBlocked > 0 || _consecutiveWarn > 0;

  if (blocked) {
    _consecutiveBlocked += 1;
    _consecutiveWarn = 0;
  } else if (warn) {
    _consecutiveWarn += 1;
    _consecutiveBlocked = 0;
  } else {
    _consecutiveWarn = 0;
    _consecutiveBlocked = 0;
  }

  pushAction({
    at: new Date().toISOString(),
    cycle_reason: reason,
    action: "EVALUATE",
    success: !blocked,
    detail:
      `autonomy=${autonomy.action}` +
      `,market=${marketAction ?? "SKIP"}` +
      `,portfolio=${portfolioState ?? "SKIP"}` +
      `,incident=${incident.level}` +
      `,blocked=${blockedReasons.length}` +
      `,warn=${warningReasons.length}`,
  });

  if (warn && _consecutiveWarn === p.warn_alert_threshold) {
    const detail = `warning streak ${_consecutiveWarn} cycles (${warningReasons.join(", ") || "warn"})`;
    addOpsAlert("warn", `[execution-safety-supervisor] ${detail}`);
    pushAction({
      at: new Date().toISOString(),
      cycle_reason: reason,
      action: "ALERT_WARN_STREAK",
      success: true,
      detail,
    });
  }

  if (blocked && _consecutiveBlocked === p.block_alert_threshold) {
    const detail = `blocked streak ${_consecutiveBlocked} cycles (${blockedReasons.join(", ") || "blocked"})`;
    addOpsAlert("critical", `[execution-safety-supervisor] ${detail}`);
    pushAction({
      at: new Date().toISOString(),
      cycle_reason: reason,
      action: "ALERT_BLOCK_STREAK",
      success: true,
      detail,
    });
  }

  if (!blocked && !warn && hadIncident) {
    addOpsAlert("info", "[execution-safety-supervisor] execution safety recovered");
    pushAction({
      at: new Date().toISOString(),
      cycle_reason: reason,
      action: "RECOVERED",
      success: true,
      detail: "Execution safety recovered to healthy state",
    });
  }

  if (blocked && p.auto_enforce && p.auto_kill_switch_on_block && !isKillSwitchActive()) {
    setKillSwitchActive(true);
    pushAction({
      at: new Date().toISOString(),
      cycle_reason: reason,
      action: "ENGAGE_KILL_SWITCH",
      success: true,
      detail: `Kill switch engaged due to blocked execution safety (${blockedReasons[0] ?? "blocked"})`,
    });
    addOpsAlert("critical", "[execution-safety-supervisor] kill switch engaged by blocked safety cycle");
  }
}

export async function runExecutionSafetySupervisorCycle(reason = "manual"): Promise<ExecutionSafetySupervisorSnapshot> {
  if (_cycleInFlight) return getExecutionSafetySupervisorSnapshot();

  _cycleInFlight = true;
  const startedMs = Date.now();

  try {
    await runCycleInternal(reason);
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[execution-safety-supervisor] cycle failed");
  } finally {
    _cycleInFlight = false;
    _lastCycleAtMs = Date.now();
    _lastCycleDurationMs = _lastCycleAtMs - startedMs;
    _totalCycles += 1;
  }

  return getExecutionSafetySupervisorSnapshot();
}

export async function startExecutionSafetySupervisor(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
  heartbeatSymbol?: string;
}): Promise<{ success: boolean; message: string; interval_ms: number; heartbeat_symbol: string }> {
  if (Number.isFinite(options?.intervalMs)) {
    _intervalMs = Math.max(
      MIN_INTERVAL_MS,
      Math.min(MAX_INTERVAL_MS, Math.round(options?.intervalMs ?? DEFAULT_INTERVAL_MS)),
    );
  }
  if (options?.heartbeatSymbol) {
    _heartbeatSymbol = normalizeSymbol(options.heartbeatSymbol);
  }

  if (_running) {
    return {
      success: false,
      message: "Execution safety supervisor already running",
      interval_ms: _intervalMs,
      heartbeat_symbol: _heartbeatSymbol,
    };
  }

  _running = true;
  _startedAtMs = Date.now();

  _timer = setInterval(() => {
    runExecutionSafetySupervisorCycle("scheduled").catch((err) => {
      logger.error({ err }, "[execution-safety-supervisor] scheduled cycle failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runExecutionSafetySupervisorCycle("start");
  }

  logger.info({ intervalMs: _intervalMs, heartbeatSymbol: _heartbeatSymbol }, "[execution-safety-supervisor] started");
  return {
    success: true,
    message: "Execution safety supervisor started",
    interval_ms: _intervalMs,
    heartbeat_symbol: _heartbeatSymbol,
  };
}

export function stopExecutionSafetySupervisor(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Execution safety supervisor not running" };
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[execution-safety-supervisor] stopped");
  return { success: true, message: "Execution safety supervisor stopped" };
}

export function resetExecutionSafetySupervisorState(): ExecutionSafetySupervisorSnapshot {
  _lastError = null;
  _lastCycleAtMs = null;
  _lastCycleDurationMs = null;
  _totalCycles = 0;
  _totalActions = 0;
  _consecutiveWarn = 0;
  _consecutiveBlocked = 0;
  _lastSummary = null;
  _recentActions.length = 0;
  if (!_running) {
    _startedAtMs = null;
  }
  return getExecutionSafetySupervisorSnapshot();
}

export function getExecutionSafetySupervisorSnapshot(): ExecutionSafetySupervisorSnapshot {
  return {
    running: _running,
    cycle_in_flight: _cycleInFlight,
    started_at: toIso(_startedAtMs),
    last_cycle_at: toIso(_lastCycleAtMs),
    last_cycle_duration_ms: _lastCycleDurationMs,
    last_error: _lastError,
    total_cycles: _totalCycles,
    total_actions: _totalActions,
    interval_ms: _intervalMs,
    consecutive_warn: _consecutiveWarn,
    consecutive_blocked: _consecutiveBlocked,
    last_summary: _lastSummary ? {
      ..._lastSummary,
      blocked_reasons: [..._lastSummary.blocked_reasons],
      warning_reasons: [..._lastSummary.warning_reasons],
    } : null,
    policy: policy(),
    recent_actions: [..._recentActions],
  };
}

export function shouldExecutionSafetySupervisorAutoStart(): boolean {
  return boolEnv(process.env.EXEC_SAFETY_SUPERVISOR_AUTO_START, true);
}

