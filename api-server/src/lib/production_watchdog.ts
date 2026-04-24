import {
  getDeploymentReadinessReport,
  type DeploymentReadinessStatus,
} from "./deployment_readiness";
import {
  getAutonomySupervisorSnapshot,
  stopAutonomySupervisor,
} from "./autonomy_supervisor";
import { isKillSwitchActive, setKillSwitchActive } from "./risk_engine";
import { addOpsAlert } from "./ops_monitor";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "production_watchdog" });

const DEFAULT_INTERVAL_MS = 45_000;
const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 10 * 60_000;
const DEFAULT_NOT_READY_TRIP_COUNT = 3;
const DEFAULT_DEGRADED_WARN_COUNT = 4;
const MAX_RECENT_ACTIONS = 120;

export interface ProductionWatchdogPolicy {
  auto_enforce: boolean;
  interval_ms: number;
  include_preflight: boolean;
  not_ready_trip_count: number;
  degraded_warn_count: number;
  auto_pause_autonomy: boolean;
  auto_kill_switch: boolean;
}

export interface ProductionWatchdogAction {
  at: string;
  cycle_reason: string;
  action:
    | "WARN_DEGRADED"
    | "ESCALATE_NOT_READY"
    | "PAUSE_AUTONOMY"
    | "ENGAGE_KILL_SWITCH"
    | "RECOVERED";
  success: boolean;
  detail: string;
}

export interface ProductionWatchdogSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  consecutive_not_ready: number;
  consecutive_degraded: number;
  escalation_active: boolean;
  last_status: DeploymentReadinessStatus | null;
  last_report_at: string | null;
  last_report_summary: {
    failed_critical: number;
    failed_non_critical: number;
  };
  policy: ProductionWatchdogPolicy;
  recent_actions: ProductionWatchdogAction[];
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
let _intervalMs = parseIntervalMs(process.env.PRODUCTION_WATCHDOG_INTERVAL_MS, DEFAULT_INTERVAL_MS);
let _consecutiveNotReady = 0;
let _consecutiveDegraded = 0;
let _escalationActive = false;
let _lastStatus: DeploymentReadinessStatus | null = null;
let _lastReportAtMs: number | null = null;
let _lastReportSummary = {
  failed_critical: 0,
  failed_non_critical: 0,
};
const _recentActions: ProductionWatchdogAction[] = [];

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

function policy(): ProductionWatchdogPolicy {
  return {
    auto_enforce: boolEnv(process.env.PRODUCTION_WATCHDOG_AUTO_ENFORCE, true),
    interval_ms: _intervalMs,
    include_preflight: boolEnv(process.env.PRODUCTION_WATCHDOG_INCLUDE_PREFLIGHT, false),
    not_ready_trip_count: parseIntEnv(
      process.env.PRODUCTION_WATCHDOG_NOT_READY_TRIP_COUNT,
      DEFAULT_NOT_READY_TRIP_COUNT,
      1,
      20,
    ),
    degraded_warn_count: parseIntEnv(
      process.env.PRODUCTION_WATCHDOG_DEGRADED_WARN_COUNT,
      DEFAULT_DEGRADED_WARN_COUNT,
      1,
      20,
    ),
    auto_pause_autonomy: boolEnv(process.env.PRODUCTION_WATCHDOG_AUTO_PAUSE_AUTONOMY, true),
    auto_kill_switch: boolEnv(process.env.PRODUCTION_WATCHDOG_AUTO_KILL_SWITCH, true),
  };
}

function pushAction(action: ProductionWatchdogAction): void {
  _recentActions.unshift(action);
  if (_recentActions.length > MAX_RECENT_ACTIONS) {
    _recentActions.pop();
  }
  _totalActions += 1;
}

function summaryDetail(prefix: string): string {
  return `${prefix}; status=${_lastStatus}, critical_failed=${_lastReportSummary.failed_critical}, non_critical_failed=${_lastReportSummary.failed_non_critical}`;
}

async function runCycleInternal(reason: string): Promise<void> {
  const p = policy();
  const report = await getDeploymentReadinessReport({
    forceRefresh: true,
    includePreflight: p.include_preflight,
  });

  _lastStatus = report.status;
  _lastReportAtMs = Date.now();
  _lastReportSummary = {
    failed_critical: report.summary.failed_critical,
    failed_non_critical: report.summary.failed_non_critical,
  };

  if (report.status === "READY") {
    const hadIncident = _consecutiveNotReady > 0 || _consecutiveDegraded > 0 || _escalationActive;
    _consecutiveNotReady = 0;
    _consecutiveDegraded = 0;
    if (hadIncident) {
      pushAction({
        at: new Date().toISOString(),
        cycle_reason: reason,
        action: "RECOVERED",
        success: true,
        detail: summaryDetail("Readiness recovered"),
      });
      addOpsAlert("info", "[production-watchdog] deployment readiness recovered");
    }
    _escalationActive = false;
    return;
  }

  if (report.status === "DEGRADED") {
    _consecutiveNotReady = 0;
    _consecutiveDegraded += 1;
    if (_consecutiveDegraded === p.degraded_warn_count) {
      const detail = summaryDetail(`Readiness degraded for ${_consecutiveDegraded} consecutive cycles`);
      addOpsAlert("warn", `[production-watchdog] ${detail}`);
      pushAction({
        at: new Date().toISOString(),
        cycle_reason: reason,
        action: "WARN_DEGRADED",
        success: true,
        detail,
      });
    }
    return;
  }

  _consecutiveNotReady += 1;
  _consecutiveDegraded += 1;
  if (_consecutiveNotReady < p.not_ready_trip_count || _escalationActive) {
    return;
  }

  _escalationActive = true;
  const escalationDetail = summaryDetail(
    `Readiness NOT_READY for ${_consecutiveNotReady} consecutive cycles`,
  );
  addOpsAlert("critical", `[production-watchdog] ${escalationDetail}`);
  pushAction({
    at: new Date().toISOString(),
    cycle_reason: reason,
    action: "ESCALATE_NOT_READY",
    success: true,
    detail: escalationDetail,
  });

  if (!p.auto_enforce) {
    return;
  }

  if (p.auto_pause_autonomy) {
    const supervisor = getAutonomySupervisorSnapshot();
    if (supervisor.running) {
      const result = stopAutonomySupervisor();
      pushAction({
        at: new Date().toISOString(),
        cycle_reason: reason,
        action: "PAUSE_AUTONOMY",
        success: result.success,
        detail: result.message,
      });
      if (result.success) {
        addOpsAlert("critical", "[production-watchdog] autonomy supervisor paused due to NOT_READY state");
      }
    }
  }

  if (p.auto_kill_switch && !isKillSwitchActive()) {
    setKillSwitchActive(true);
    pushAction({
      at: new Date().toISOString(),
      cycle_reason: reason,
      action: "ENGAGE_KILL_SWITCH",
      success: true,
      detail: "Risk-engine kill switch engaged by production watchdog",
    });
    addOpsAlert("critical", "[production-watchdog] kill switch engaged due to persistent NOT_READY state");
  }
}

export async function runProductionWatchdogCycle(reason = "manual"): Promise<ProductionWatchdogSnapshot> {
  if (_cycleInFlight) return getProductionWatchdogSnapshot();

  _cycleInFlight = true;
  const startedMs = Date.now();

  try {
    await runCycleInternal(reason);
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[production-watchdog] cycle failed");
  } finally {
    _cycleInFlight = false;
    _lastCycleAtMs = Date.now();
    _lastCycleDurationMs = _lastCycleAtMs - startedMs;
    _totalCycles += 1;
  }

  return getProductionWatchdogSnapshot();
}

export async function startProductionWatchdog(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
}): Promise<{ success: boolean; message: string; interval_ms: number }> {
  if (Number.isFinite(options?.intervalMs)) {
    _intervalMs = Math.max(
      MIN_INTERVAL_MS,
      Math.min(MAX_INTERVAL_MS, Math.round(options?.intervalMs ?? DEFAULT_INTERVAL_MS)),
    );
  }

  if (_running) {
    return { success: false, message: "Production watchdog already running", interval_ms: _intervalMs };
  }

  _running = true;
  _startedAtMs = Date.now();

  _timer = setInterval(() => {
    runProductionWatchdogCycle("scheduled").catch((err) => {
      logger.error({ err }, "[production-watchdog] scheduled cycle failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runProductionWatchdogCycle("start");
  }

  logger.info({ intervalMs: _intervalMs }, "[production-watchdog] started");
  return { success: true, message: "Production watchdog started", interval_ms: _intervalMs };
}

export function stopProductionWatchdog(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Production watchdog not running" };
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[production-watchdog] stopped");
  return { success: true, message: "Production watchdog stopped" };
}

export function resetProductionWatchdogState(): ProductionWatchdogSnapshot {
  _consecutiveNotReady = 0;
  _consecutiveDegraded = 0;
  _escalationActive = false;
  _lastStatus = null;
  _lastReportAtMs = null;
  _lastReportSummary = {
    failed_critical: 0,
    failed_non_critical: 0,
  };
  _lastError = null;
  _recentActions.length = 0;
  _totalActions = 0;
  _totalCycles = 0;
  _lastCycleAtMs = null;
  _lastCycleDurationMs = null;
  _startedAtMs = _running ? _startedAtMs : null;
  return getProductionWatchdogSnapshot();
}

export function getProductionWatchdogSnapshot(): ProductionWatchdogSnapshot {
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
    consecutive_not_ready: _consecutiveNotReady,
    consecutive_degraded: _consecutiveDegraded,
    escalation_active: _escalationActive,
    last_status: _lastStatus,
    last_report_at: toIso(_lastReportAtMs),
    last_report_summary: { ..._lastReportSummary },
    policy: policy(),
    recent_actions: [..._recentActions],
  };
}

export function shouldProductionWatchdogAutoStart(): boolean {
  return boolEnv(process.env.PRODUCTION_WATCHDOG_AUTO_START, true);
}
