/**
 * Phase 6 — In-process counter module.
 *
 * Tracks:
 *   - total_requests          (every HTTP response observed)
 *   - failed_requests         (4xx + 5xx responses)
 *   - order_executions        (POST /api/alpaca/orders that returned 200)
 *   - order_attempts          (POST /api/alpaca/orders, any outcome)
 *   - reconciliation_runs     (manual + scheduled reconciler invocations)
 *
 * `rejected_trades` is computed at read time from the persisted
 * execution_audit log so the count survives process restarts. The
 * counters above are in-process only and reset on restart.
 *
 * Pure data interface — no I/O, no logging. Increment via the
 * counter_middleware (HTTP responses) or via direct calls from
 * downstream callers that already exist (e.g. reconciler.run()).
 */

let totalRequests = 0;
let failedRequests = 0;
let orderExecutions = 0;
let orderAttempts = 0;
let reconciliationRuns = 0;
const startedAt = Date.now();

export function incTotalRequests(): void { totalRequests += 1; }
export function incFailedRequests(): void { failedRequests += 1; }
export function incOrderAttempt(): void { orderAttempts += 1; }
export function incOrderExecution(): void { orderExecutions += 1; }
export function incReconciliationRun(): void { reconciliationRuns += 1; }

export interface CountersSnapshot {
  total_requests: number;
  failed_requests: number;
  order_attempts: number;
  order_executions: number;
  reconciliation_runs: number;
  uptime_sec: number;
  started_at: string;
  snapshot_at: string;
}

export function snapshotCounters(): CountersSnapshot {
  return {
    total_requests: totalRequests,
    failed_requests: failedRequests,
    order_attempts: orderAttempts,
    order_executions: orderExecutions,
    reconciliation_runs: reconciliationRuns,
    uptime_sec: Math.floor((Date.now() - startedAt) / 1000),
    started_at: new Date(startedAt).toISOString(),
    snapshot_at: new Date().toISOString(),
  };
}

/** Reset all counters (used by tests). */
export function _resetCountersForTests(): void {
  totalRequests = 0;
  failedRequests = 0;
  orderExecutions = 0;
  orderAttempts = 0;
  reconciliationRuns = 0;
}
