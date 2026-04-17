import { logger as _logger } from "./logger";
import {
  getAutonomyDebugSchedulerSnapshot,
  runAutonomyDebugSchedulerCycle,
} from "./autonomy_debug_scheduler";
import { getProductionWatchdogSnapshot } from "./production_watchdog";
import { getAutonomySupervisorSnapshot } from "./autonomy_supervisor";
import { setKillSwitchActive } from "./risk_engine";
import { loadGuardState, persistGuardState } from "./guard_state_persistence";

export type ExecutionAutonomyGuardLevel = "NORMAL" | "WATCH" | "HALT";
export type ExecutionAutonomyGuardAction = "ALLOW" | "WARN" | "BLOCK";
export type ExecutionAutonomyGuardReason =
  | "guard_halted"
  | "autonomy_supervisor_stopped"
  | "scheduler_stopped"
  | "scheduler_status_degraded"
  | "scheduler_status_critical"
  | "scheduler_critical_streak"
  | "watchdog_stopped"
  | "watchdog_status_degraded"
  | "watchdog_status_not_ready"
  | "watchdog_escalation_active";

export interface ExecutionAutonomyGuardPolicy {
  window_ms: number;
  max_blocks_window: number;
  max_warn_window: number;
  max_consecutive_blocks: number;
  auto_halt: boolean;
  sync_kill_switch_on_halt: boolean;
  require_autonomy_supervisor_running: boolean;
  require_scheduler_running: boolean;
  require_watchdog_running: boolean;
  block_on_scheduler_critical: boolean;
  block_on_scheduler_degraded: boolean;
  scheduler_critical_streak_threshold: number;
  warn_on_scheduler_degraded: boolean;
  block_on_watchdog_not_ready: boolean;
  block_on_watchdog_degraded: boolean;
  warn_on_watchdog_degraded: boolean;
  block_on_watchdog_escalation: boolean;
  auto_run_scheduler_cycle_on_block: boolean;
}

export interface ExecutionAutonomyGuardEvent {
  at: string;
  symbol: string;
  type:
    | "EVAL_ALLOW"
    | "EVAL_WARN"
    | "EVAL_BLOCK"
    | "GUARD_HALT"
    | "GUARD_RESET"
    | "AUTO_HEAL_ATTEMPT"
    | "AUTO_HEAL_RECOVERED";
  severity: "info" | "warn" | "critical";
  detail: string;
  reasons: ExecutionAutonomyGuardReason[];
}

export interface ExecutionAutonomyGuardSnapshot {
  level: ExecutionAutonomyGuardLevel;
  halt_active: boolean;
  running_window_ms: number;
  consecutive_blocks: number;
  window_blocks: number;
  window_warn: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  policy: ExecutionAutonomyGuardPolicy;
  last_evaluation: {
    at: string | null;
    symbol: string | null;
    action: ExecutionAutonomyGuardAction;
    allowed: boolean;
    reasons: ExecutionAutonomyGuardReason[];
    status: {
      supervisor_running: boolean;
      scheduler_running: boolean;
      scheduler_cycle_in_flight: boolean;
      scheduler_last_status: "HEALTHY" | "DEGRADED" | "CRITICAL" | null;
      scheduler_consecutive_critical: number;
      watchdog_running: boolean;
      watchdog_last_status: "READY" | "DEGRADED" | "NOT_READY" | null;
      watchdog_escalation_active: boolean;
    } | null;
  };
  recent_events: ExecutionAutonomyGuardEvent[];
}

export interface ExecutionAutonomyGuardDecision {
  allowed: boolean;
  level: ExecutionAutonomyGuardLevel;
  action: ExecutionAutonomyGuardAction;
  reasons: ExecutionAutonomyGuardReason[];
  snapshot: ExecutionAutonomyGuardSnapshot;
}

const logger = _logger.child({ module: "execution_autonomy_guard" });
const MAX_RECENT_EVENTS = 200;
const STATE_FILE = "execution_autonomy_guard_state.json";

const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_MAX_BLOCKS_WINDOW = 4;
const DEFAULT_MAX_WARN_WINDOW = 8;
const DEFAULT_MAX_CONSECUTIVE_BLOCKS = 3;
const DEFAULT_SCHEDULER_CRITICAL_STREAK_THRESHOLD = 2;

let _level: ExecutionAutonomyGuardLevel = "NORMAL";
let _haltActive = false;
let _consecutiveBlocks = 0;
let _totalEvents = 0;
let _lastEventAt: string | null = null;
let _lastHaltReason: string | null = null;

const _recentEvents: ExecutionAutonomyGuardEvent[] = [];
const _blockTimes: number[] = [];
const _warnTimes: number[] = [];
const MAX_BLOCK_WARN_ENTRIES = 1000;

let _lastEvaluation: ExecutionAutonomyGuardSnapshot["last_evaluation"] = {
  at: null,
  symbol: null,
  action: "ALLOW",
  allowed: true,
  reasons: [],
  status: null,
};

interface PersistedExecutionAutonomyGuardState {
  level: ExecutionAutonomyGuardLevel;
  halt_active: boolean;
  consecutive_blocks: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  recent_events: ExecutionAutonomyGuardEvent[];
  block_times: number[];
  warn_times: number[];
  last_evaluation: ExecutionAutonomyGuardSnapshot["last_evaluation"];
  persisted_at: string;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseIntEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function policy(): ExecutionAutonomyGuardPolicy {
  return {
    window_ms: parseIntEnv(process.env.EXEC_AUTONOMY_GUARD_WINDOW_MS, DEFAULT_WINDOW_MS, 60_000, 2 * 60 * 60_000),
    max_blocks_window: parseIntEnv(
      process.env.EXEC_AUTONOMY_GUARD_MAX_BLOCKS_WINDOW,
      DEFAULT_MAX_BLOCKS_WINDOW,
      1,
      100,
    ),
    max_warn_window: parseIntEnv(
      process.env.EXEC_AUTONOMY_GUARD_MAX_WARN_WINDOW,
      DEFAULT_MAX_WARN_WINDOW,
      1,
      200,
    ),
    max_consecutive_blocks: parseIntEnv(
      process.env.EXEC_AUTONOMY_GUARD_MAX_CONSECUTIVE_BLOCKS,
      DEFAULT_MAX_CONSECUTIVE_BLOCKS,
      1,
      50,
    ),
    auto_halt: boolEnv(process.env.EXEC_AUTONOMY_GUARD_AUTO_HALT, true),
    sync_kill_switch_on_halt: boolEnv(process.env.EXEC_AUTONOMY_GUARD_SYNC_KILL_SWITCH_ON_HALT, false),
    require_autonomy_supervisor_running: boolEnv(process.env.EXEC_AUTONOMY_GUARD_REQUIRE_SUPERVISOR, true),
    require_scheduler_running: boolEnv(process.env.EXEC_AUTONOMY_GUARD_REQUIRE_SCHEDULER, true),
    require_watchdog_running: boolEnv(process.env.EXEC_AUTONOMY_GUARD_REQUIRE_WATCHDOG, true),
    block_on_scheduler_critical: boolEnv(process.env.EXEC_AUTONOMY_GUARD_BLOCK_SCHEDULER_CRITICAL, true),
    block_on_scheduler_degraded: boolEnv(process.env.EXEC_AUTONOMY_GUARD_BLOCK_SCHEDULER_DEGRADED, false),
    scheduler_critical_streak_threshold: parseIntEnv(
      process.env.EXEC_AUTONOMY_GUARD_SCHEDULER_CRITICAL_STREAK,
      DEFAULT_SCHEDULER_CRITICAL_STREAK_THRESHOLD,
      1,
      20,
    ),
    warn_on_scheduler_degraded: boolEnv(process.env.EXEC_AUTONOMY_GUARD_WARN_SCHEDULER_DEGRADED, true),
    block_on_watchdog_not_ready: boolEnv(process.env.EXEC_AUTONOMY_GUARD_BLOCK_WATCHDOG_NOT_READY, true),
    block_on_watchdog_degraded: boolEnv(process.env.EXEC_AUTONOMY_GUARD_BLOCK_WATCHDOG_DEGRADED, false),
    warn_on_watchdog_degraded: boolEnv(process.env.EXEC_AUTONOMY_GUARD_WARN_WATCHDOG_DEGRADED, true),
    block_on_watchdog_escalation: boolEnv(process.env.EXEC_AUTONOMY_GUARD_BLOCK_WATCHDOG_ESCALATION, true),
    auto_run_scheduler_cycle_on_block: boolEnv(process.env.EXEC_AUTONOMY_GUARD_AUTO_RUN_SCHEDULER_ON_BLOCK, true),
  };
}

function pushEvent(event: ExecutionAutonomyGuardEvent): void {
  _recentEvents.unshift(event);
  if (_recentEvents.length > MAX_RECENT_EVENTS) _recentEvents.pop();
  _totalEvents += 1;
  _lastEventAt = event.at;
}

function numericTimes(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v));
}

function persistState(): void {
  const payload: PersistedExecutionAutonomyGuardState = {
    level: _level,
    halt_active: _haltActive,
    consecutive_blocks: _consecutiveBlocks,
    total_events: _totalEvents,
    last_event_at: _lastEventAt,
    last_halt_reason: _lastHaltReason,
    recent_events: [..._recentEvents],
    block_times: [..._blockTimes],
    warn_times: [..._warnTimes],
    last_evaluation: {
      ..._lastEvaluation,
      reasons: [..._lastEvaluation.reasons],
      status: _lastEvaluation.status ? { ..._lastEvaluation.status } : null,
    },
    persisted_at: new Date().toISOString(),
  };
  persistGuardState(STATE_FILE, payload);
}

function pruneWindow(nowMs: number, p: ExecutionAutonomyGuardPolicy): void {
  const cutoff = nowMs - p.window_ms;
  while (_blockTimes.length > 0 && _blockTimes[0] < cutoff) _blockTimes.shift();
  while (_warnTimes.length > 0 && _warnTimes[0] < cutoff) _warnTimes.shift();
}

function currentStatus(): NonNullable<ExecutionAutonomyGuardSnapshot["last_evaluation"]["status"]> {
  const supervisor = getAutonomySupervisorSnapshot();
  const scheduler = getAutonomyDebugSchedulerSnapshot();
  const watchdog = getProductionWatchdogSnapshot();
  return {
    supervisor_running: supervisor.running,
    scheduler_running: scheduler.running,
    scheduler_cycle_in_flight: scheduler.cycle_in_flight,
    scheduler_last_status: scheduler.last_status,
    scheduler_consecutive_critical: scheduler.consecutive_critical,
    watchdog_running: watchdog.running,
    watchdog_last_status: watchdog.last_status,
    watchdog_escalation_active: watchdog.escalation_active,
  };
}

function analyzeStatus(
  status: NonNullable<ExecutionAutonomyGuardSnapshot["last_evaluation"]["status"]>,
  p: ExecutionAutonomyGuardPolicy,
): { blockReasons: ExecutionAutonomyGuardReason[]; warnReasons: ExecutionAutonomyGuardReason[] } {
  const blockReasons: ExecutionAutonomyGuardReason[] = [];
  const warnReasons: ExecutionAutonomyGuardReason[] = [];

  if (p.require_autonomy_supervisor_running && !status.supervisor_running) {
    blockReasons.push("autonomy_supervisor_stopped");
  }
  if (p.require_scheduler_running && !status.scheduler_running) {
    blockReasons.push("scheduler_stopped");
  }
  if (p.require_watchdog_running && !status.watchdog_running) {
    blockReasons.push("watchdog_stopped");
  }

  if (status.scheduler_last_status === "CRITICAL" && p.block_on_scheduler_critical) {
    blockReasons.push("scheduler_status_critical");
  } else if (status.scheduler_last_status === "DEGRADED") {
    if (p.block_on_scheduler_degraded) blockReasons.push("scheduler_status_degraded");
    else if (p.warn_on_scheduler_degraded) warnReasons.push("scheduler_status_degraded");
  }

  if (status.scheduler_consecutive_critical >= p.scheduler_critical_streak_threshold) {
    blockReasons.push("scheduler_critical_streak");
  }

  if (status.watchdog_escalation_active && p.block_on_watchdog_escalation) {
    blockReasons.push("watchdog_escalation_active");
  }

  if (status.watchdog_last_status === "NOT_READY" && p.block_on_watchdog_not_ready) {
    blockReasons.push("watchdog_status_not_ready");
  } else if (status.watchdog_last_status === "DEGRADED") {
    if (p.block_on_watchdog_degraded) blockReasons.push("watchdog_status_degraded");
    else if (p.warn_on_watchdog_degraded) warnReasons.push("watchdog_status_degraded");
  }

  return { blockReasons, warnReasons };
}

function maybeHalt(reason: string, p: ExecutionAutonomyGuardPolicy): void {
  if (_haltActive) return;
  _level = "HALT";
  _haltActive = true;
  _lastHaltReason = reason;
  pushEvent({
    at: new Date().toISOString(),
    symbol: "SYSTEM",
    type: "GUARD_HALT",
    severity: "critical",
    detail: reason,
    reasons: ["guard_halted"],
  });
  logger.fatal({ reason }, "[autonomy-guard] HALT triggered");
  if (p.sync_kill_switch_on_halt) {
    setKillSwitchActive(true);
  }
  persistState();
}

function applyDecisionTelemetry(
  nowMs: number,
  symbol: string,
  action: ExecutionAutonomyGuardAction,
  reasons: ExecutionAutonomyGuardReason[],
  p: ExecutionAutonomyGuardPolicy,
): void {
  if (action === "BLOCK") {
    _consecutiveBlocks += 1;
    _blockTimes.push(nowMs);
    if (_blockTimes.length > MAX_BLOCK_WARN_ENTRIES) _blockTimes.splice(0, _blockTimes.length - MAX_BLOCK_WARN_ENTRIES);
  } else {
    _consecutiveBlocks = 0;
    if (action === "WARN") {
      _warnTimes.push(nowMs);
      if (_warnTimes.length > MAX_BLOCK_WARN_ENTRIES) _warnTimes.splice(0, _warnTimes.length - MAX_BLOCK_WARN_ENTRIES);
    }
  }

  pruneWindow(nowMs, p);

  if (_haltActive) {
    _level = "HALT";
  } else {
    _level = action === "ALLOW" ? "NORMAL" : "WATCH";
  }

  if (!_haltActive && action === "BLOCK" && p.auto_halt) {
    if (_consecutiveBlocks >= p.max_consecutive_blocks) {
      maybeHalt(`consecutive_blocks_exceeded:${_consecutiveBlocks}/${p.max_consecutive_blocks}`, p);
    } else if (_blockTimes.length >= p.max_blocks_window) {
      maybeHalt(`blocks_window_exceeded:${_blockTimes.length}/${p.max_blocks_window}`, p);
    }
  }

  pushEvent({
    at: new Date(nowMs).toISOString(),
    symbol,
    type: action === "ALLOW" ? "EVAL_ALLOW" : action === "WARN" ? "EVAL_WARN" : "EVAL_BLOCK",
    severity: action === "ALLOW" ? "info" : action === "WARN" ? "warn" : "critical",
    detail: reasons.length > 0 ? reasons.join(",") : "autonomy_guard_ok",
    reasons,
  });
}

export async function evaluateExecutionAutonomyGuard(input?: {
  symbol?: string;
  autoHeal?: boolean;
}): Promise<ExecutionAutonomyGuardDecision> {
  const p = policy();
  const nowMs = Date.now();
  const symbol = String(input?.symbol ?? "SYSTEM").trim().toUpperCase() || "SYSTEM";

  if (_haltActive) {
    _lastEvaluation = {
      at: new Date(nowMs).toISOString(),
      symbol,
      action: "BLOCK",
      allowed: false,
      reasons: ["guard_halted"],
      status: currentStatus(),
    };
    applyDecisionTelemetry(nowMs, symbol, "BLOCK", ["guard_halted"], p);
    persistState();
    return {
      allowed: false,
      level: _level,
      action: "BLOCK",
      reasons: ["guard_halted"],
      snapshot: getExecutionAutonomyGuardSnapshot(),
    };
  }

  let status = currentStatus();
  let analysis = analyzeStatus(status, p);
  let reasons = analysis.blockReasons.length > 0 ? analysis.blockReasons : analysis.warnReasons;
  let action: ExecutionAutonomyGuardAction =
    analysis.blockReasons.length > 0 ? "BLOCK" : analysis.warnReasons.length > 0 ? "WARN" : "ALLOW";

  const canAutoHeal =
    input?.autoHeal !== false &&
    p.auto_run_scheduler_cycle_on_block &&
    action === "BLOCK" &&
    !status.scheduler_cycle_in_flight;

  if (canAutoHeal) {
    pushEvent({
      at: new Date(nowMs).toISOString(),
      symbol,
      type: "AUTO_HEAL_ATTEMPT",
      severity: "warn",
      detail: "run_autonomy_debug_scheduler_cycle",
      reasons: [...analysis.blockReasons],
    });
    try {
      await runAutonomyDebugSchedulerCycle("execution_autonomy_guard");
      status = currentStatus();
      analysis = analyzeStatus(status, p);
      reasons = analysis.blockReasons.length > 0 ? analysis.blockReasons : analysis.warnReasons;
      action = analysis.blockReasons.length > 0 ? "BLOCK" : analysis.warnReasons.length > 0 ? "WARN" : "ALLOW";
      if (analysis.blockReasons.length === 0) {
        pushEvent({
          at: new Date().toISOString(),
          symbol,
          type: "AUTO_HEAL_RECOVERED",
          severity: "info",
          detail: "autonomy_guard_recovered_after_scheduler_cycle",
          reasons: [],
        });
      }
    } catch (err) {
      logger.warn({ err }, "[autonomy-guard] auto-heal scheduler cycle failed");
    }
  }

  const allowed = action !== "BLOCK" && !_haltActive;
  _lastEvaluation = {
    at: new Date(nowMs).toISOString(),
    symbol,
    action,
    allowed,
    reasons,
    status,
  };

  applyDecisionTelemetry(nowMs, symbol, action, reasons, p);
  persistState();

  return {
    allowed,
    level: _level,
    action,
    reasons,
    snapshot: getExecutionAutonomyGuardSnapshot(),
  };
}

export function canExecuteByAutonomyGuard(): { allowed: boolean; reason: string | null; snapshot: ExecutionAutonomyGuardSnapshot } {
  const snapshot = getExecutionAutonomyGuardSnapshot();
  if (!snapshot.halt_active) {
    return { allowed: true, reason: null, snapshot };
  }
  return {
    allowed: false,
    reason: snapshot.last_halt_reason ?? "execution_autonomy_guard_halt",
    snapshot,
  };
}

export function resetExecutionAutonomyGuard(input?: {
  reason?: string;
  clearKillSwitch?: boolean;
}): ExecutionAutonomyGuardSnapshot {
  _level = "NORMAL";
  _haltActive = false;
  _consecutiveBlocks = 0;
  _lastHaltReason = null;
  _blockTimes.length = 0;
  _warnTimes.length = 0;

  pushEvent({
    at: new Date().toISOString(),
    symbol: "SYSTEM",
    type: "GUARD_RESET",
    severity: "info",
    detail: "autonomy_guard_reset",
    reasons: [],
  });

  if (input?.clearKillSwitch) {
    setKillSwitchActive(false);
  }

  logger.warn({ reason: input?.reason ?? "manual_reset" }, "[autonomy-guard] reset");
  persistState();
  return getExecutionAutonomyGuardSnapshot();
}

function loadState(): void {
  const payload = loadGuardState<PersistedExecutionAutonomyGuardState>(STATE_FILE);
  if (!payload) return;

  const level = payload.level;
  _level = level === "NORMAL" || level === "WATCH" || level === "HALT" ? level : "NORMAL";
  _haltActive = Boolean(payload.halt_active);
  _consecutiveBlocks = clampInt(Number(payload.consecutive_blocks ?? 0), 0, 10_000);
  _totalEvents = clampInt(Number(payload.total_events ?? 0), 0, 10_000_000);
  _lastEventAt = payload.last_event_at ?? null;
  _lastHaltReason = payload.last_halt_reason ?? null;

  _recentEvents.length = 0;
  for (const event of Array.isArray(payload.recent_events) ? payload.recent_events.slice(0, MAX_RECENT_EVENTS) : []) {
    if (!event || typeof event !== "object") continue;
    if (typeof event.at !== "string" || typeof event.symbol !== "string" || typeof event.type !== "string") continue;
    _recentEvents.push(event);
  }

  _blockTimes.length = 0;
  _blockTimes.push(...numericTimes(payload.block_times));
  _warnTimes.length = 0;
  _warnTimes.push(...numericTimes(payload.warn_times));

  if (payload.last_evaluation && typeof payload.last_evaluation === "object") {
    _lastEvaluation = {
      at: typeof payload.last_evaluation.at === "string" ? payload.last_evaluation.at : null,
      symbol: typeof payload.last_evaluation.symbol === "string" ? payload.last_evaluation.symbol : null,
      action:
        payload.last_evaluation.action === "ALLOW" ||
        payload.last_evaluation.action === "WARN" ||
        payload.last_evaluation.action === "BLOCK"
          ? payload.last_evaluation.action
          : "ALLOW",
      allowed: Boolean(payload.last_evaluation.allowed),
      reasons: Array.isArray(payload.last_evaluation.reasons)
        ? payload.last_evaluation.reasons.filter((reason): reason is ExecutionAutonomyGuardReason => typeof reason === "string")
        : [],
      status: payload.last_evaluation.status ?? null,
    };
  }
}

export function getExecutionAutonomyGuardSnapshot(): ExecutionAutonomyGuardSnapshot {
  const p = policy();
  const nowMs = Date.now();
  pruneWindow(nowMs, p);
  return {
    level: _level,
    halt_active: _haltActive,
    running_window_ms: p.window_ms,
    consecutive_blocks: _consecutiveBlocks,
    window_blocks: _blockTimes.length,
    window_warn: _warnTimes.length,
    total_events: _totalEvents,
    last_event_at: _lastEventAt,
    last_halt_reason: _lastHaltReason,
    policy: p,
    last_evaluation: {
      ..._lastEvaluation,
      reasons: [..._lastEvaluation.reasons],
      status: _lastEvaluation.status ? { ..._lastEvaluation.status } : null,
    },
    recent_events: [..._recentEvents],
  };
}

loadState();

