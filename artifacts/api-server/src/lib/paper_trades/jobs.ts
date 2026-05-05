/**
 * Phase 5 — Background jobs for the proof system.
 *
 * Two jobs:
 *   1. reconcilerJob    — runs reconcileOrphans() every GODSVIEW_RECONCILER_INTERVAL_MS (default 300_000 = 5 min)
 *   2. dataHealthJob    — checks DB connectivity + integrity violations every GODSVIEW_DATA_HEALTH_INTERVAL_MS (default 60_000)
 *
 * Both jobs:
 *   - are opt-in via GODSVIEW_RUN_RECONCILER / GODSVIEW_RUN_DATA_HEALTH (default OFF in dev, ON in prod-like environments).
 *   - isolate errors per-tick (one failure does not stop the loop).
 *   - emit a structured log on every run.
 *   - call .unref() so they do not keep the event loop alive on shutdown.
 */
import { reconLog } from "../log_channels.js";
import { reconcileOrphans, getLastReconcilerResult } from "./reconciler.js";
import { checkTradeIntegrity } from "./integrity.js";
import { listExecutedTrades } from "./store.js";

const RECONCILE_INTERVAL_MS = Number(process.env.GODSVIEW_RECONCILER_INTERVAL_MS ?? 300_000);
const DATA_HEALTH_INTERVAL_MS = Number(process.env.GODSVIEW_DATA_HEALTH_INTERVAL_MS ?? 60_000);

const RUN_RECONCILER = String(process.env.GODSVIEW_RUN_RECONCILER ?? "").toLowerCase() === "true";
const RUN_DATA_HEALTH = String(process.env.GODSVIEW_RUN_DATA_HEALTH ?? "").toLowerCase() === "true";

let reconHandle: ReturnType<typeof setInterval> | null = null;
let healthHandle: ReturnType<typeof setInterval> | null = null;

let lastHealthResult: { ran_at: string; total_trades: number; total_violations: number; error: string | null } | null = null;
export function getLastHealthResult() { return lastHealthResult; }

export function startProofJobs(): void {
  if (RUN_RECONCILER && reconHandle === null) {
    reconLog.info({ interval_ms: RECONCILE_INTERVAL_MS }, "[jobs] starting reconcilerJob");
    reconHandle = setInterval(() => {
      reconcileOrphans().catch((err) => {
        reconLog.error({ err: (err as Error).message ?? String(err) }, "[jobs] reconcilerJob tick threw");
      });
    }, RECONCILE_INTERVAL_MS);
    if (typeof reconHandle.unref === "function") reconHandle.unref();
  }
  if (RUN_DATA_HEALTH && healthHandle === null) {
    reconLog.info({ interval_ms: DATA_HEALTH_INTERVAL_MS }, "[jobs] starting dataHealthJob");
    healthHandle = setInterval(() => {
      runDataHealth().catch((err) => {
        reconLog.error({ err: (err as Error).message ?? String(err) }, "[jobs] dataHealthJob tick threw");
      });
    }, DATA_HEALTH_INTERVAL_MS);
    if (typeof healthHandle.unref === "function") healthHandle.unref();
  }
}

export function stopProofJobs(): void {
  if (reconHandle !== null) { clearInterval(reconHandle); reconHandle = null; }
  if (healthHandle !== null) { clearInterval(healthHandle); healthHandle = null; }
  reconLog.info("[jobs] stopped");
}

async function runDataHealth(): Promise<void> {
  const startedAt = new Date();
  let total = 0; let violations = 0; let errMsg: string | null = null;
  try {
    const trades = await listExecutedTrades(5_000);
    const report = checkTradeIntegrity(trades);
    total = report.total_trades;
    violations = report.total_violations;
    if (violations > 0) {
      reconLog.warn({ total, violations, by_rule: report.by_rule }, "[jobs] dataHealthJob: integrity violations present");
    } else {
      reconLog.info({ total }, "[jobs] dataHealthJob: integrity clean");
    }
  } catch (err) {
    errMsg = (err as Error).message ?? String(err);
    reconLog.error({ err: errMsg }, "[jobs] dataHealthJob failed");
  }
  lastHealthResult = {
    ran_at: startedAt.toISOString(),
    total_trades: total,
    total_violations: violations,
    error: errMsg,
  };
}

/** Diagnostic accessor for the /api/proof/reconciliation/status endpoint. */
export function snapshotJobsStatus() {
  return {
    reconciler: {
      enabled: RUN_RECONCILER,
      interval_ms: RECONCILE_INTERVAL_MS,
      running: reconHandle !== null,
      last_result: getLastReconcilerResult(),
    },
    data_health: {
      enabled: RUN_DATA_HEALTH,
      interval_ms: DATA_HEALTH_INTERVAL_MS,
      running: healthHandle !== null,
      last_result: getLastHealthResult(),
    },
  };
}
