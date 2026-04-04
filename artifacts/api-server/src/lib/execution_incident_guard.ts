import { setKillSwitchActive } from "./risk_engine";
import { logger as _logger } from "./logger";

export type ExecutionIncidentLevel = "NORMAL" | "WATCH" | "HALT";

export interface ExecutionIncidentPolicy {
  window_ms: number;
  max_failures_window: number;
  max_rejections_window: number;
  max_consecutive_failures: number;
  max_slippage_bps: number;
  max_slippage_spikes_window: number;
  auto_halt: boolean;
}

export interface ExecutionIncidentEvent {
  at: string;
  symbol: string;
  type: "EXECUTION_OK" | "ORDER_REJECTED" | "ORDER_ERROR" | "EXECUTION_BLOCKED" | "SLIPPAGE_SPIKE" | "GUARD_RESET" | "GUARD_HALT";
  severity: "info" | "warn" | "critical";
  detail: string;
  mode?: string;
  reason?: string;
  slippage_bps?: number;
}

export interface ExecutionIncidentSnapshot {
  level: ExecutionIncidentLevel;
  halt_active: boolean;
  running_window_ms: number;
  consecutive_failures: number;
  window_failures: number;
  window_rejections: number;
  window_slippage_spikes: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  policy: ExecutionIncidentPolicy;
  recent_events: ExecutionIncidentEvent[];
}

const logger = _logger.child({ module: "execution_incident_guard" });
const MAX_RECENT_EVENTS = 200;

const DEFAULT_WINDOW_MS = 20 * 60_000;
const DEFAULT_MAX_FAILURES_WINDOW = 6;
const DEFAULT_MAX_REJECTIONS_WINDOW = 4;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_MAX_SLIPPAGE_BPS = 35;
const DEFAULT_MAX_SLIPPAGE_SPIKES_WINDOW = 3;

let _level: ExecutionIncidentLevel = "NORMAL";
let _haltActive = false;
let _consecutiveFailures = 0;
let _totalEvents = 0;
let _lastEventAt: string | null = null;
let _lastHaltReason: string | null = null;

const _recentEvents: ExecutionIncidentEvent[] = [];
const _failureTimes: number[] = [];
const _rejectionTimes: number[] = [];
const _slippageSpikeTimes: number[] = [];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseIntEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

function parseFloatEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return clampFloat(parsed, min, max);
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function policy(): ExecutionIncidentPolicy {
  return {
    window_ms: parseIntEnv(process.env.EXEC_INCIDENT_WINDOW_MS, DEFAULT_WINDOW_MS, 60_000, 2 * 60 * 60_000),
    max_failures_window: parseIntEnv(process.env.EXEC_INCIDENT_MAX_FAILURES_WINDOW, DEFAULT_MAX_FAILURES_WINDOW, 1, 50),
    max_rejections_window: parseIntEnv(process.env.EXEC_INCIDENT_MAX_REJECTIONS_WINDOW, DEFAULT_MAX_REJECTIONS_WINDOW, 1, 50),
    max_consecutive_failures: parseIntEnv(process.env.EXEC_INCIDENT_MAX_CONSECUTIVE_FAILURES, DEFAULT_MAX_CONSECUTIVE_FAILURES, 1, 20),
    max_slippage_bps: parseFloatEnv(process.env.EXEC_INCIDENT_MAX_SLIPPAGE_BPS, DEFAULT_MAX_SLIPPAGE_BPS, 2, 300),
    max_slippage_spikes_window: parseIntEnv(process.env.EXEC_INCIDENT_MAX_SLIPPAGE_SPIKES_WINDOW, DEFAULT_MAX_SLIPPAGE_SPIKES_WINDOW, 1, 20),
    auto_halt: boolEnv(process.env.EXEC_INCIDENT_AUTO_HALT, true),
  };
}

function pushEvent(event: ExecutionIncidentEvent): void {
  _recentEvents.unshift(event);
  if (_recentEvents.length > MAX_RECENT_EVENTS) _recentEvents.pop();
  _totalEvents += 1;
  _lastEventAt = event.at;
}

function pruneWindow(nowMs: number, p: ExecutionIncidentPolicy): void {
  const cutoff = nowMs - p.window_ms;
  while (_failureTimes.length > 0 && _failureTimes[0] < cutoff) _failureTimes.shift();
  while (_rejectionTimes.length > 0 && _rejectionTimes[0] < cutoff) _rejectionTimes.shift();
  while (_slippageSpikeTimes.length > 0 && _slippageSpikeTimes[0] < cutoff) _slippageSpikeTimes.shift();
}

function maybeHalt(reason: string, p: ExecutionIncidentPolicy): void {
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
    reason,
  });
  logger.fatal({ reason }, "[incident-guard] HALT triggered");
  if (p.auto_halt) {
    setKillSwitchActive(true);
  }
}

function evaluateThresholds(nowMs: number, p: ExecutionIncidentPolicy): void {
  pruneWindow(nowMs, p);
  const failures = _failureTimes.length;
  const rejections = _rejectionTimes.length;
  const slippageSpikes = _slippageSpikeTimes.length;

  const watch =
    failures >= Math.max(2, Math.floor(p.max_failures_window / 2)) ||
    rejections >= Math.max(2, Math.floor(p.max_rejections_window / 2)) ||
    _consecutiveFailures >= Math.max(1, p.max_consecutive_failures - 1) ||
    slippageSpikes >= Math.max(1, Math.floor(p.max_slippage_spikes_window / 2));

  if (_haltActive) return;

  if (failures >= p.max_failures_window) {
    maybeHalt(`failures_window_exceeded:${failures}/${p.max_failures_window}`, p);
    return;
  }
  if (rejections >= p.max_rejections_window) {
    maybeHalt(`rejections_window_exceeded:${rejections}/${p.max_rejections_window}`, p);
    return;
  }
  if (_consecutiveFailures >= p.max_consecutive_failures) {
    maybeHalt(`consecutive_failures_exceeded:${_consecutiveFailures}/${p.max_consecutive_failures}`, p);
    return;
  }
  if (slippageSpikes >= p.max_slippage_spikes_window) {
    maybeHalt(`slippage_spikes_window_exceeded:${slippageSpikes}/${p.max_slippage_spikes_window}`, p);
    return;
  }

  _level = watch ? "WATCH" : "NORMAL";
}

export function recordExecutionAttempt(input: {
  symbol: string;
  outcome: "EXECUTED" | "REJECTED" | "ERROR" | "BLOCKED";
  detail?: string;
  mode?: string;
  reason?: string;
}): ExecutionIncidentSnapshot {
  const p = policy();
  const nowMs = Date.now();

  if (input.outcome === "EXECUTED") {
    _consecutiveFailures = 0;
    pushEvent({
      at: new Date(nowMs).toISOString(),
      symbol: String(input.symbol ?? "UNKNOWN").toUpperCase(),
      type: "EXECUTION_OK",
      severity: "info",
      detail: input.detail ?? "order_executed",
      mode: input.mode,
      reason: input.reason,
    });
  } else if (input.outcome === "BLOCKED") {
    pushEvent({
      at: new Date(nowMs).toISOString(),
      symbol: String(input.symbol ?? "UNKNOWN").toUpperCase(),
      type: "EXECUTION_BLOCKED",
      severity: _haltActive ? "critical" : "warn",
      detail: input.detail ?? "execution_blocked",
      mode: input.mode,
      reason: input.reason,
    });
  } else {
    _consecutiveFailures += 1;
    _failureTimes.push(nowMs);
    if (input.outcome === "REJECTED") _rejectionTimes.push(nowMs);
    pushEvent({
      at: new Date(nowMs).toISOString(),
      symbol: String(input.symbol ?? "UNKNOWN").toUpperCase(),
      type: input.outcome === "REJECTED" ? "ORDER_REJECTED" : "ORDER_ERROR",
      severity: "warn",
      detail: input.detail ?? (input.outcome === "REJECTED" ? "order_rejected" : "order_error"),
      mode: input.mode,
      reason: input.reason,
    });
  }

  evaluateThresholds(nowMs, p);
  return getExecutionIncidentSnapshot();
}

export function recordExecutionSlippage(input: {
  symbol: string;
  expected_price: number;
  executed_price: number;
  side: "buy" | "sell";
}): ExecutionIncidentSnapshot {
  const p = policy();
  const nowMs = Date.now();
  const expected = Number(input.expected_price);
  const executed = Number(input.executed_price);
  if (!Number.isFinite(expected) || !Number.isFinite(executed) || expected <= 0 || executed <= 0) {
    return getExecutionIncidentSnapshot();
  }

  const slippageBps = Math.abs(executed - expected) / expected * 10_000;
  if (slippageBps > p.max_slippage_bps) {
    _slippageSpikeTimes.push(nowMs);
    pushEvent({
      at: new Date(nowMs).toISOString(),
      symbol: String(input.symbol ?? "UNKNOWN").toUpperCase(),
      type: "SLIPPAGE_SPIKE",
      severity: slippageBps > p.max_slippage_bps * 1.8 ? "critical" : "warn",
      detail: `${input.side}_slippage_spike`,
      slippage_bps: Number(slippageBps.toFixed(2)),
      reason: `limit=${p.max_slippage_bps}`,
    });
    evaluateThresholds(nowMs, p);
  }
  return getExecutionIncidentSnapshot();
}

export function canExecuteByIncidentGuard(): { allowed: boolean; reason: string | null; snapshot: ExecutionIncidentSnapshot } {
  const snapshot = getExecutionIncidentSnapshot();
  if (!snapshot.halt_active) {
    return { allowed: true, reason: null, snapshot };
  }
  return {
    allowed: false,
    reason: snapshot.last_halt_reason ?? "execution_incident_guard_halt",
    snapshot,
  };
}

export function resetExecutionIncidentGuard(input?: {
  reason?: string;
  clearKillSwitch?: boolean;
}): ExecutionIncidentSnapshot {
  _level = "NORMAL";
  _haltActive = false;
  _consecutiveFailures = 0;
  _lastHaltReason = null;
  _failureTimes.length = 0;
  _rejectionTimes.length = 0;
  _slippageSpikeTimes.length = 0;

  pushEvent({
    at: new Date().toISOString(),
    symbol: "SYSTEM",
    type: "GUARD_RESET",
    severity: "info",
    detail: "incident_guard_reset",
    reason: input?.reason ?? "manual_reset",
  });

  if (input?.clearKillSwitch) {
    setKillSwitchActive(false);
  }

  logger.warn({ reason: input?.reason ?? "manual_reset" }, "[incident-guard] reset");
  return getExecutionIncidentSnapshot();
}

export function getExecutionIncidentSnapshot(): ExecutionIncidentSnapshot {
  const p = policy();
  const nowMs = Date.now();
  pruneWindow(nowMs, p);
  return {
    level: _level,
    halt_active: _haltActive,
    running_window_ms: p.window_ms,
    consecutive_failures: _consecutiveFailures,
    window_failures: _failureTimes.length,
    window_rejections: _rejectionTimes.length,
    window_slippage_spikes: _slippageSpikeTimes.length,
    total_events: _totalEvents,
    last_event_at: _lastEventAt,
    last_halt_reason: _lastHaltReason,
    policy: p,
    recent_events: [..._recentEvents],
  };
}
