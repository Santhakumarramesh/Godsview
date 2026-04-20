/**
 * @gv/api-client — Phase 7 portfolio rebalance endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/rebalance.py:
 *
 *   api.rebalance.plans            — plan CRUD + FSM transitions
 *   api.rebalance.intents          — per-symbol intent rows + filters
 *
 * The rebalancer cron proposes a `RebalancePlan` per account on a schedule;
 * an operator reviews, approves (`rebalance_execute` governance), and the
 * execution engine drains the plan's intents into the Phase 4 bus. A plan
 * is inert until approval — all mutations flow through the documented FSM:
 *
 *   proposed ─► approved ─► executing ─► complete
 *         │         │            │
 *         ▼         ▼            ▼
 *      rejected  cancelled    failed
 *
 * Approval requires a paired governance approval id (`approvalId`) on the
 * `approve` call; the server cross-checks the approval row and rejects
 * the call with 409 if the approval is missing, not quorate, or scoped to
 * a different plan.
 */
import type {
  RebalanceIntent,
  RebalanceIntentFilter,
  RebalanceIntentsList,
  RebalancePlan,
  RebalancePlanApproveRequest,
  RebalancePlanCancelRequest,
  RebalancePlanDetail,
  RebalancePlanFilter,
  RebalancePlanRejectRequest,
  RebalancePlanRequest,
  RebalancePlansList,
} from "@gv/types";
import type { ApiClient } from "../client.js";

// ───────────────────────────── query-string helper ──────────────────────

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ───────────────────────────── plans ───────────────────────────────────

export interface RebalancePlanEndpoints {
  /** GET /rebalance/plans — list plans (filter by account / status / trigger). */
  list: (filter?: RebalancePlanFilter) => Promise<RebalancePlansList>;
  /** GET /rebalance/plans/:id */
  get: (id: string) => Promise<RebalancePlan>;
  /** GET /rebalance/plans/:id/detail — plan + ordered intents. */
  detail: (id: string) => Promise<RebalancePlanDetail>;
  /**
   * POST /rebalance/plans — propose a plan. Operator-triggered plans pass
   * `trigger=manual` + `reason`; the cron omits both and passes
   * `trigger=scheduled`.
   */
  propose: (req: RebalancePlanRequest) => Promise<RebalancePlan>;
  /**
   * POST /rebalance/plans/:id/approve — flip proposed → approved. Requires
   * a paired `rebalance_execute` governance approval id.
   */
  approve: (
    id: string,
    req: RebalancePlanApproveRequest,
  ) => Promise<RebalancePlan>;
  /** POST /rebalance/plans/:id/reject — decline a proposed plan. */
  reject: (
    id: string,
    req: RebalancePlanRejectRequest,
  ) => Promise<RebalancePlan>;
  /** POST /rebalance/plans/:id/cancel — cancel an approved-but-unexecuted plan. */
  cancel: (
    id: string,
    req: RebalancePlanCancelRequest,
  ) => Promise<RebalancePlan>;
  /**
   * POST /rebalance/plans/:id/execute — flip approved → executing. Kicks
   * off the drain loop; subsequent state is pushed over SSE on
   * `/ops/events` and written back to the plan row.
   */
  execute: (id: string, reason: string) => Promise<RebalancePlan>;
}

export function rebalancePlanEndpoints(
  client: ApiClient,
): RebalancePlanEndpoints {
  return {
    list: (filter = { limit: 100 } as RebalancePlanFilter) =>
      client.get<RebalancePlansList>(`/rebalance/plans${qs(filter)}`),
    get: (id) =>
      client.get<RebalancePlan>(`/rebalance/plans/${encodeURIComponent(id)}`),
    detail: (id) =>
      client.get<RebalancePlanDetail>(
        `/rebalance/plans/${encodeURIComponent(id)}/detail`,
      ),
    propose: (req) => client.post<RebalancePlan>(`/rebalance/plans`, req),
    approve: (id, req) =>
      client.post<RebalancePlan>(
        `/rebalance/plans/${encodeURIComponent(id)}/approve`,
        req,
      ),
    reject: (id, req) =>
      client.post<RebalancePlan>(
        `/rebalance/plans/${encodeURIComponent(id)}/reject`,
        req,
      ),
    cancel: (id, req) =>
      client.post<RebalancePlan>(
        `/rebalance/plans/${encodeURIComponent(id)}/cancel`,
        req,
      ),
    execute: (id, reason) =>
      client.post<RebalancePlan>(
        `/rebalance/plans/${encodeURIComponent(id)}/execute`,
        { reason },
      ),
  };
}

// ───────────────────────────── intents ─────────────────────────────────

export interface RebalanceIntentEndpoints {
  /** GET /rebalance/intents — filter by plan / strategy / symbol / status. */
  list: (filter?: RebalanceIntentFilter) => Promise<RebalanceIntentsList>;
  /** GET /rebalance/intents/:id */
  get: (id: string) => Promise<RebalanceIntent>;
  /**
   * POST /rebalance/intents/:id/retry — re-route a failed intent through
   * the adapter registry. Admin-gated; no effect on `filled` / `cancelled`
   * intents.
   */
  retry: (id: string, reason: string) => Promise<RebalanceIntent>;
  /** POST /rebalance/intents/:id/cancel — mark a queued intent cancelled. */
  cancel: (id: string, reason: string) => Promise<RebalanceIntent>;
}

export function rebalanceIntentEndpoints(
  client: ApiClient,
): RebalanceIntentEndpoints {
  return {
    list: (filter = { limit: 100 } as RebalanceIntentFilter) =>
      client.get<RebalanceIntentsList>(`/rebalance/intents${qs(filter)}`),
    get: (id) =>
      client.get<RebalanceIntent>(
        `/rebalance/intents/${encodeURIComponent(id)}`,
      ),
    retry: (id, reason) =>
      client.post<RebalanceIntent>(
        `/rebalance/intents/${encodeURIComponent(id)}/retry`,
        { reason },
      ),
    cancel: (id, reason) =>
      client.post<RebalanceIntent>(
        `/rebalance/intents/${encodeURIComponent(id)}/cancel`,
        { reason },
      ),
  };
}
