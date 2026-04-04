import {
  getAutonomyDebugSnapshot,
  runAutonomyDebugAutoFix,
  type AutonomyDebugOverallStatus,
} from "./autonomy_debugger";
import { addOpsAlert } from "./ops_monitor";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "autonomy_debug_scheduler" });

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 20 * 60_000;
const DEFAULT_CRITICAL_ALERT_THRESHOLD = 2;
const MAX_RECENT_ACTIONS = 120;

export interface AutonomyDebugSchedulerPolicy {
  auto_enforce: boolean;
  interval_ms: number;
  include_preflight: boolean;
  auto_fix_on_degraded: boolean;
  auto_fix_on_critical: boolean;
  critical_alert_threshold: number;
}

export interface AutonomyDebugSchedulerAction {
  at: string;
  cycle_reason: string;
  action: "EVALUATE" | "AUTO_FIX" | "ALERT_CRITICAL_STREAK" | "RECOVERED";
  success: boolean;
  detail: string;
}

export interface AutonomyDebugSchedulerSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  total_fix_actions: number;
  interval_ms: number;
  consecutive_critical: number;
  last_status: AutonomyDebugOverallStatus | null;
  last_issue_count: number;
  last_critical_issues: number;
  last_warn_issues: number;
  policy: AutonomyDebugSchedulerPolicy;
  recent_actions: AutonomyDebugSchedulerAction[];
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
let _totalFixActions = 0;
let _intervalMs = parseIntervalMs(process.env.AUTONOMY_DEBUG_SCHEDULER_INTERVAL_MS, DEFAULT_INTERVAL_MS);
let _consecutiveCritical = 0;
let _lastStatus: AutonomyDebugOverallStatus | null = null;
let _lastIssueCount = 0;
let _lastCriticalIssues = 0;
let _lastWarnIssues = 0;
const _recentActions: AutonomyDebugSchedulerAction[] = [];

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

function policy(): AutonomyDebugSchedulerPolicy {
  return {
    auto_enforce: boolEnv(process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_ENFORCE, true),
    interval_ms: _intervalMs,
    include_preflight: boolEnv(process.env.AUTONOMY_DEBUG_SCHEDULER_INCLUDE_PREFLIGHT, false),
    auto_fix_on_degraded: boolEnv(process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_FIX_ON_DEGRADED, true),
    auto_fix_on_critical: boolEnv(process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_FIX_ON_CRITICAL, true),
    critical_alert_threshold: parseIntEnv(
      process.env.AUTONOMY_DEBUG_SCHEDULER_CRITICAL_ALERT_THRESHOLD,
      DEFAULT_CRITICAL_ALERT_THRESHOLD,
      1,
      10,
    ),
  };
}

function pushAction(action: AutonomyDebugSchedulerAction): void {
  _recentActions.unshift(action);
  if (_recentActions.length > MAX_RECENT_ACTIONS) {
    _recentActions.pop();
  }
  _totalActions += 1;
}

async function runCycleInternal(reason: string): Promise<void> {
  const p = policy();
  const snapshot = await getAutonomyDebugSnapshot({
    includePreflight: p.include_preflight,
    forceReadiness: true,
  });

  const criticalIssues = snapshot.issues.filter((issue) => issue.severity === "critical").length;
  const warnIssues = snapshot.issues.filter((issue) => issue.severity === "warn").length;
  _lastStatus = snapshot.overall_status;
  _lastIssueCount = snapshot.issues.length;
  _lastCriticalIssues = criticalIssues;
  _lastWarnIssues = warnIssues;

  pushAction({
    at: new Date().toISOString(),
    cycle_reason: reason,
    action: "EVALUATE",
    success: snapshot.overall_status !== "CRITICAL",
    detail: `status=${snapshot.overall_status},issues=${snapshot.issues.length},critical=${criticalIssues},warn=${warnIssues}`,
  });

  if (snapshot.overall_status === "CRITICAL") {
    _consecutiveCritical += 1;
  } else {
    const hadCriticalRun = _consecutiveCritical > 0;
    _consecutiveCritical = 0;
    if (hadCriticalRun && snapshot.overall_status === "HEALTHY") {
      addOpsAlert("info", "[autonomy-debug-scheduler] autonomy debug recovered to HEALTHY");
      pushAction({
        at: new Date().toISOString(),
        cycle_reason: reason,
        action: "RECOVERED",
        success: true,
        detail: "Recovered from prior critical debug streak",
      });
    }
  }

  if (_consecutiveCritical === p.critical_alert_threshold) {
    addOpsAlert(
      "critical",
      `[autonomy-debug-scheduler] critical debug status for ${_consecutiveCritical} consecutive cycles`,
    );
    pushAction({
      at: new Date().toISOString(),
      cycle_reason: reason,
      action: "ALERT_CRITICAL_STREAK",
      success: true,
      detail: `critical_streak=${_consecutiveCritical}`,
    });
  }

  const shouldFix =
    p.auto_enforce &&
    (
      (snapshot.overall_status === "CRITICAL" && p.auto_fix_on_critical) ||
      (snapshot.overall_status === "DEGRADED" && p.auto_fix_on_degraded)
    );

  if (!shouldFix) {
    return;
  }

  const fix = await runAutonomyDebugAutoFix({
    includePreflight: p.include_preflight,
    forceReadiness: true,
  });
  const successCount = fix.fixes.filter((step) => step.success).length;
  const failureCount = fix.fixes.filter((step) => !step.success).length;
  _totalFixActions += successCount;
  pushAction({
    at: new Date().toISOString(),
    cycle_reason: reason,
    action: "AUTO_FIX",
    success: failureCount === 0,
    detail: `attempted=${fix.fixes.length},succeeded=${successCount},failed=${failureCount},next_status=${fix.snapshot.overall_status}`,
  });
}

export async function runAutonomyDebugSchedulerCycle(reason = "manual"): Promise<AutonomyDebugSchedulerSnapshot> {
  if (_cycleInFlight) return getAutonomyDebugSchedulerSnapshot();

  _cycleInFlight = true;
  const startedMs = Date.now();

  try {
    await runCycleInternal(reason);
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[autonomy-debug-scheduler] cycle failed");
  } finally {
    _cycleInFlight = false;
    _lastCycleAtMs = Date.now();
    _lastCycleDurationMs = _lastCycleAtMs - startedMs;
    _totalCycles += 1;
  }

  return getAutonomyDebugSchedulerSnapshot();
}

export async function startAutonomyDebugScheduler(options?: {
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
    return { success: false, message: "Autonomy debug scheduler already running", interval_ms: _intervalMs };
  }

  _running = true;
  _startedAtMs = Date.now();

  _timer = setInterval(() => {
    runAutonomyDebugSchedulerCycle("scheduled").catch((err) => {
      logger.error({ err }, "[autonomy-debug-scheduler] scheduled cycle failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runAutonomyDebugSchedulerCycle("start");
  }

  logger.info({ intervalMs: _intervalMs }, "[autonomy-debug-scheduler] started");
  return { success: true, message: "Autonomy debug scheduler started", interval_ms: _intervalMs };
}

export function stopAutonomyDebugScheduler(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Autonomy debug scheduler not running" };
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[autonomy-debug-scheduler] stopped");
  return { success: true, message: "Autonomy debug scheduler stopped" };
}

export function resetAutonomyDebugSchedulerState(): AutonomyDebugSchedulerSnapshot {
  _lastError = null;
  _lastCycleAtMs = null;
  _lastCycleDurationMs = null;
  _totalCycles = 0;
  _totalActions = 0;
  _totalFixActions = 0;
  _consecutiveCritical = 0;
  _lastStatus = null;
  _lastIssueCount = 0;
  _lastCriticalIssues = 0;
  _lastWarnIssues = 0;
  _recentActions.length = 0;
  if (!_running) {
    _startedAtMs = null;
  }
  return getAutonomyDebugSchedulerSnapshot();
}

export function getAutonomyDebugSchedulerSnapshot(): AutonomyDebugSchedulerSnapshot {
  return {
    running: _running,
    cycle_in_flight: _cycleInFlight,
    started_at: toIso(_startedAtMs),
    last_cycle_at: toIso(_lastCycleAtMs),
    last_cycle_duration_ms: _lastCycleDurationMs,
    last_error: _lastError,
    total_cycles: _totalCycles,
    total_actions: _totalActions,
    total_fix_actions: _totalFixActions,
    interval_ms: _intervalMs,
    consecutive_critical: _consecutiveCritical,
    last_status: _lastStatus,
    last_issue_count: _lastIssueCount,
    last_critical_issues: _lastCriticalIssues,
    last_warn_issues: _lastWarnIssues,
    policy: policy(),
    recent_actions: [..._recentActions],
  };
}

export function shouldAutonomyDebugSchedulerAutoStart(): boolean {
  return boolEnv(process.env.AUTONOMY_DEBUG_SCHEDULER_AUTO_START, true);
}

