import { logger } from "./logger";
import { MacroContextService } from "./macro_context_service";
import { getPaperValidationStatus, startPaperValidationLoop } from "./paper_validation_loop";
import { getSchedulerStats, startRetrainScheduler } from "./retrain_scheduler";
import { ScannerScheduler } from "./scanner_scheduler";
import { alpacaStream } from "./alpaca_stream";
import { getReconciliationSnapshot, startReconciler } from "./fill_reconciler";

export type SupervisorServiceName =
  | "alpaca_stream"
  | "fill_reconciler"
  | "scanner_scheduler"
  | "macro_context"
  | "paper_validation"
  | "retrain_scheduler";

export type SupervisorServiceHealth = "HEALTHY" | "DEGRADED" | "STOPPED" | "DISABLED";

export interface SupervisorServiceSnapshot {
  name: SupervisorServiceName;
  expected: boolean;
  running: boolean;
  health: SupervisorServiceHealth;
  detail: string;
  restart_count: number;
  error_count: number;
  last_check_at: string | null;
  last_healthy_at: string | null;
  last_restart_at: string | null;
}

export interface SupervisorPolicy {
  auto_heal: boolean;
  interval_ms: number;
  services: Record<SupervisorServiceName, boolean>;
}

export interface SupervisorAction {
  at: string;
  service: SupervisorServiceName;
  action: "HEAL_START";
  success: boolean;
  detail: string;
}

export interface AutonomySupervisorSnapshot {
  running: boolean;
  tick_in_flight: boolean;
  interval_ms: number;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_duration_ms: number | null;
  last_error: string | null;
  consecutive_failures: number;
  total_ticks: number;
  total_heal_actions: number;
  policy: SupervisorPolicy;
  services: SupervisorServiceSnapshot[];
  recent_actions: SupervisorAction[];
}

interface InternalServiceState {
  restartCount: number;
  errorCount: number;
  lastCheckAtMs: number | null;
  lastHealthyAtMs: number | null;
  lastRestartAtMs: number | null;
  detail: string;
  running: boolean;
  expected: boolean;
  health: SupervisorServiceHealth;
}

interface ServiceCheckResult {
  running: boolean;
  healthy: boolean;
  detail: string;
}

interface ServiceDescriptor {
  name: SupervisorServiceName;
  expected: () => boolean;
  check: () => ServiceCheckResult;
  heal: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 5 * 60_000;
const MAX_RECENT_ACTIONS = 100;

let _running = false;
let _tickInFlight = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startedAtMs: number | null = null;
let _lastTickAtMs: number | null = null;
let _lastTickDurationMs: number | null = null;
let _lastError: string | null = null;
let _consecutiveFailures = 0;
let _totalTicks = 0;
let _totalHealActions = 0;
let _intervalMs = parseIntervalMs(process.env.AUTONOMY_SUPERVISOR_INTERVAL_MS, DEFAULT_INTERVAL_MS);
const _recentActions: SupervisorAction[] = [];
const _serviceState = new Map<SupervisorServiceName, InternalServiceState>();

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseIntervalMs(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, parsed));
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function hasAlpacaCredentials(): boolean {
  const key = process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? "";
  const secret = process.env.ALPACA_SECRET_KEY ?? "";
  return key.trim().length > 0 && secret.trim().length > 0;
}

function buildPolicy(): SupervisorPolicy {
  const alpacaEnabled = hasAlpacaCredentials();
  return {
    auto_heal: boolEnv(process.env.AUTONOMY_SUPERVISOR_AUTO_HEAL, true),
    interval_ms: _intervalMs,
    services: {
      alpaca_stream: alpacaEnabled,
      fill_reconciler: alpacaEnabled,
      scanner_scheduler: alpacaEnabled,
      macro_context: alpacaEnabled,
      paper_validation: boolEnv(process.env.PAPER_VALIDATION_AUTO_START, true),
      retrain_scheduler: boolEnv(process.env.RETRAIN_SCHEDULER_AUTO_START, true),
    },
  };
}

function getState(name: SupervisorServiceName): InternalServiceState {
  const existing = _serviceState.get(name);
  if (existing) return existing;
  const created: InternalServiceState = {
    restartCount: 0,
    errorCount: 0,
    lastCheckAtMs: null,
    lastHealthyAtMs: null,
    lastRestartAtMs: null,
    detail: "never_checked",
    running: false,
    expected: false,
    health: "STOPPED",
  };
  _serviceState.set(name, created);
  return created;
}

function pushAction(action: SupervisorAction): void {
  _recentActions.unshift(action);
  if (_recentActions.length > MAX_RECENT_ACTIONS) {
    _recentActions.pop();
  }
}

function markService(
  name: SupervisorServiceName,
  expected: boolean,
  result: ServiceCheckResult,
): InternalServiceState {
  const state = getState(name);
  const now = Date.now();
  state.expected = expected;
  state.running = result.running;
  state.detail = result.detail;
  state.lastCheckAtMs = now;

  if (!expected) {
    state.health = "DISABLED";
    return state;
  }

  if (result.running && result.healthy) {
    state.health = "HEALTHY";
    state.lastHealthyAtMs = now;
    return state;
  }

  state.health = result.running ? "DEGRADED" : "STOPPED";
  return state;
}

function serviceDescriptors(policy: SupervisorPolicy): ServiceDescriptor[] {
  return [
    {
      name: "alpaca_stream",
      expected: () => policy.services.alpaca_stream,
      check: () => {
        const status = alpacaStream.status();
        const running = status.pollingMode || status.wsState === 0 || status.wsState === 1;
        const healthy = status.authenticated || status.pollingMode;
        return {
          running,
          healthy,
          detail: `auth=${status.authenticated},polling=${status.pollingMode},ws=${status.wsState},ticks=${status.ticksReceived},quotes=${status.quotesReceived}`,
        };
      },
      heal: async () => {
        alpacaStream.start();
      },
    },
    {
      name: "fill_reconciler",
      expected: () => policy.services.fill_reconciler,
      check: () => {
        const snap = getReconciliationSnapshot();
        return {
          running: snap.is_running,
          healthy: snap.is_running,
          detail: `running=${snap.is_running},fills=${snap.fills_today},pnl=${snap.realized_pnl_today.toFixed(2)}`,
        };
      },
      heal: async () => {
        startReconciler();
      },
    },
    {
      name: "scanner_scheduler",
      expected: () => policy.services.scanner_scheduler,
      check: () => {
        const scanner = ScannerScheduler.getInstance();
        const run = scanner.getCurrentRun();
        return {
          running: scanner.isRunning(),
          healthy: scanner.isRunning(),
          detail: `running=${scanner.isRunning()},scans=${scanner.getScanCount()},current=${run?.status ?? "idle"}`,
        };
      },
      heal: async () => {
        ScannerScheduler.getInstance().start();
      },
    },
    {
      name: "macro_context",
      expected: () => policy.services.macro_context,
      check: () => {
        const svc = MacroContextService.getInstance();
        const ctx = svc.getContext();
        return {
          running: svc.isStarted(),
          healthy: svc.isStarted(),
          detail: `running=${svc.isStarted()},refreshes=${ctx.refreshCount},live=${ctx.isLive}`,
        };
      },
      heal: async () => {
        MacroContextService.getInstance().start();
      },
    },
    {
      name: "paper_validation",
      expected: () => policy.services.paper_validation,
      check: () => {
        const status = getPaperValidationStatus();
        return {
          running: status.running,
          healthy: status.running && !status.last_error,
          detail: `running=${status.running},last=${status.last_cycle_at ?? "never"},status=${status.latest_status ?? "none"}`,
        };
      },
      heal: async () => {
        await startPaperValidationLoop({ runImmediate: false });
      },
    },
    {
      name: "retrain_scheduler",
      expected: () => policy.services.retrain_scheduler,
      check: () => {
        const stats = getSchedulerStats();
        return {
          running: stats.running,
          healthy: stats.running,
          detail: `running=${stats.running},retraining=${stats.isRetraining},retrain_count=${stats.totalRetrains}`,
        };
      },
      heal: async () => {
        await startRetrainScheduler();
      },
    },
  ];
}

async function runTickInternal(reason: string): Promise<void> {
  const policy = buildPolicy();
  for (const service of serviceDescriptors(policy)) {
    const expected = service.expected();
    let result: ServiceCheckResult;
    try {
      result = service.check();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const state = getState(service.name);
      state.errorCount += 1;
      state.expected = expected;
      state.running = false;
      state.health = expected ? "STOPPED" : "DISABLED";
      state.detail = `check_failed:${detail}`;
      state.lastCheckAtMs = Date.now();
      continue;
    }

    const state = markService(service.name, expected, result);
    if (!expected || result.running || !policy.auto_heal) continue;

    try {
      await service.heal();
      state.restartCount += 1;
      state.lastRestartAtMs = Date.now();
      _totalHealActions += 1;
      pushAction({
        at: new Date().toISOString(),
        service: service.name,
        action: "HEAL_START",
        success: true,
        detail: `started:${reason}`,
      });
      const rechecked = service.check();
      markService(service.name, expected, rechecked);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      state.errorCount += 1;
      state.health = "DEGRADED";
      state.detail = `heal_failed:${detail}`;
      pushAction({
        at: new Date().toISOString(),
        service: service.name,
        action: "HEAL_START",
        success: false,
        detail,
      });
    }
  }
}

export async function runAutonomySupervisorTick(reason = "manual"): Promise<AutonomySupervisorSnapshot> {
  if (_tickInFlight) return getAutonomySupervisorSnapshot();
  _tickInFlight = true;
  const started = Date.now();
  try {
    await runTickInternal(reason);
    _totalTicks += 1;
    _lastTickAtMs = Date.now();
    _lastTickDurationMs = Date.now() - started;
    _lastError = null;
    _consecutiveFailures = 0;
  } catch (err) {
    _totalTicks += 1;
    _lastTickAtMs = Date.now();
    _lastTickDurationMs = Date.now() - started;
    _lastError = err instanceof Error ? err.message : String(err);
    _consecutiveFailures += 1;
    logger.error({ err }, "[autonomy-supervisor] tick failed");
  } finally {
    _tickInFlight = false;
  }
  return getAutonomySupervisorSnapshot();
}

export async function startAutonomySupervisor(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
}): Promise<{ success: boolean; message: string; interval_ms: number }> {
  if (Number.isFinite(options?.intervalMs)) {
    _intervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(options?.intervalMs ?? DEFAULT_INTERVAL_MS)));
  }

  if (_running) {
    return { success: false, message: "Autonomy supervisor already running", interval_ms: _intervalMs };
  }

  _running = true;
  _startedAtMs = Date.now();
  _timer = setInterval(() => {
    runAutonomySupervisorTick("scheduled").catch((err) => {
      logger.error({ err }, "[autonomy-supervisor] scheduled tick failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runAutonomySupervisorTick("start");
  }

  logger.info({ intervalMs: _intervalMs }, "[autonomy-supervisor] started");
  return { success: true, message: "Autonomy supervisor started", interval_ms: _intervalMs };
}

export function stopAutonomySupervisor(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Autonomy supervisor not running" };
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[autonomy-supervisor] stopped");
  return { success: true, message: "Autonomy supervisor stopped" };
}

export function getAutonomySupervisorSnapshot(): AutonomySupervisorSnapshot {
  const policy = buildPolicy();
  const services = (Object.keys(policy.services) as SupervisorServiceName[]).map((name) => {
    const state = getState(name);
    const hasCheck = state.lastCheckAtMs !== null;
    const expected = hasCheck ? state.expected : Boolean(policy.services[name]);
    const health = hasCheck ? state.health : (expected ? "STOPPED" : "DISABLED");
    const detail = hasCheck ? state.detail : "not_checked";
    return {
      name,
      expected,
      running: state.running,
      health,
      detail,
      restart_count: state.restartCount,
      error_count: state.errorCount,
      last_check_at: toIso(state.lastCheckAtMs),
      last_healthy_at: toIso(state.lastHealthyAtMs),
      last_restart_at: toIso(state.lastRestartAtMs),
    };
  });

  return {
    running: _running,
    tick_in_flight: _tickInFlight,
    interval_ms: _intervalMs,
    started_at: toIso(_startedAtMs),
    last_tick_at: toIso(_lastTickAtMs),
    last_tick_duration_ms: _lastTickDurationMs,
    last_error: _lastError,
    consecutive_failures: _consecutiveFailures,
    total_ticks: _totalTicks,
    total_heal_actions: _totalHealActions,
    policy,
    services,
    recent_actions: [..._recentActions],
  };
}

export function shouldAutonomySupervisorAutoStart(): boolean {
  return boolEnv(process.env.AUTONOMY_SUPERVISOR_AUTO_START, true);
}
