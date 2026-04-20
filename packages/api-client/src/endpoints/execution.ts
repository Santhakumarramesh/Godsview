/**
 * @gv/api-client — Phase 4 execution + risk + broker + replay endpoints.
 *
 * Endpoints served by `services/control_plane/app/routes/execution.py`
 * (paper gate, live preview, approve-live, /live-trades admin mux) +
 * `app/routes/live_trades.py`, `app/routes/risk.py`,
 * `app/routes/broker.py`, `app/routes/replay.py`.
 *
 *   api.liveExecution   — POST /execution/live/preview (dry-run),
 *                         POST /setups/:id/approve-live (submit).
 *   api.risk            — GET /risk/budget, PATCH /risk/budget,
 *                         GET /risk/equity.
 *   api.broker          — GET /broker/positions, GET /broker/fills.
 *   api.liveTrades      — GET list + detail, PATCH status, POST cancel.
 *   api.replay          — GET /replay/:symbolId (cursor frames).
 *
 * All factories lean on the `ApiClient` singleton — they carry the
 * bearer-token injection + correlation-id propagation for free.
 * Response envelopes mirror the server DTOs verbatim (verified via
 * `packages/api-client/openapi.json`).
 */
import type {
  AccountEquity,
  BrokerFillsOut,
  BrokerPositionsOut,
  LiveApprovalOut,
  LivePreviewIn,
  LivePreviewOut,
  LiveTrade,
  LiveTradeFilter,
  LiveTradeStatus,
  LiveTradesListOut,
  OverrideRisk,
  ReplayFrame,
  RiskBudget,
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

// ───────────────────────────── live execution ───────────────────────────

export interface LiveExecutionEndpoints {
  /**
   * POST /execution/live/preview — dry-run the live gate without side
   * effects. Returns the gate verdict + (on approve) the sizing
   * projection + risk projection so operators can eyeball the math
   * before clicking approve-live.
   */
  previewGate: (req: LivePreviewIn) => Promise<LivePreviewOut>;
  /**
   * POST /setups/:id/approve-live — admin-only. On approve, submits
   * the order via the broker adapter and returns the freshly-minted
   * LiveTrade row. On reject, `approved: false` + the gate's
   * enumerated `reason` code.
   */
  approve: (
    setupId: string,
    req: LivePreviewIn,
  ) => Promise<LiveApprovalOut>;
}

export function liveExecutionEndpoints(client: ApiClient): LiveExecutionEndpoints {
  return {
    previewGate: (req) =>
      client.post<LivePreviewOut>(`/execution/live/preview`, req),
    approve: (setupId, req) =>
      client.post<LiveApprovalOut>(
        `/setups/${encodeURIComponent(setupId)}/approve-live`,
        req,
      ),
  };
}

// ───────────────────────────── risk ─────────────────────────────────────

export interface RiskEndpoints {
  /** GET /risk/budget */
  getBudget: (accountId: string) => Promise<RiskBudget>;
  /** PATCH /risk/budget — admin only. */
  patchBudget: (
    accountId: string,
    patch: Partial<RiskBudget>,
  ) => Promise<RiskBudget>;
  /**
   * GET /risk/equity — latest equity snapshot. Pass
   * `refresh: true` to force a broker pull before returning.
   */
  getEquity: (accountId: string, refresh?: boolean) => Promise<AccountEquity>;
}

export function riskEndpoints(client: ApiClient): RiskEndpoints {
  return {
    getBudget: (accountId) =>
      client.get<RiskBudget>(`/risk/budget${qs({ accountId })}`),
    patchBudget: (accountId, patch) =>
      client.patch<RiskBudget>(`/risk/budget${qs({ accountId })}`, patch),
    getEquity: (accountId, refresh) =>
      client.get<AccountEquity>(
        `/risk/equity${qs({ accountId, refresh })}`,
      ),
  };
}

// ───────────────────────────── broker ───────────────────────────────────

export interface BrokerFillsFilter {
  accountId: string;
  symbolId?: string;
  clientOrderId?: string;
  fromTs?: string;
  toTs?: string;
  offset?: number;
  limit?: number;
}

export interface BrokerEndpoints {
  /** GET /broker/positions — live positions for an account. */
  listPositions: (accountId: string) => Promise<BrokerPositionsOut>;
  /** GET /broker/fills — historical broker fills with optional filters. */
  listFills: (filter: BrokerFillsFilter) => Promise<BrokerFillsOut>;
}

export function brokerEndpoints(client: ApiClient): BrokerEndpoints {
  return {
    listPositions: (accountId) =>
      client.get<BrokerPositionsOut>(
        `/broker/positions${qs({ accountId })}`,
      ),
    listFills: (filter) =>
      client.get<BrokerFillsOut>(`/broker/fills${qs(filter)}`),
  };
}

// ───────────────────────────── live trades ──────────────────────────────

export interface LiveTradeStatusPatchRequest {
  status: LiveTradeStatus;
  pnlR?: number;
  realizedPnLDollars?: number;
  avgFillPrice?: number;
  filledQty?: number;
  commission?: number;
  note?: string;
}

export interface LiveTradeCancelRequest {
  reason?: string;
}

export interface LiveTradeEndpoints {
  /** GET /live-trades */
  list: (filter?: LiveTradeFilter) => Promise<LiveTradesListOut>;
  /** GET /live-trades/:id */
  get: (id: string) => Promise<LiveTrade>;
  /** PATCH /live-trades/:id/status — admin only; FSM-enforced. */
  patchStatus: (
    id: string,
    req: LiveTradeStatusPatchRequest,
  ) => Promise<LiveTrade>;
  /**
   * POST /live-trades/:id/cancel — admin only. Cancels the open
   * broker order via `client_order_id` and flips the row to
   * `cancelled`. Broker outage surfaces as 503 with the row still
   * in its prior status.
   */
  cancel: (id: string, req?: LiveTradeCancelRequest) => Promise<LiveTrade>;
}

export function liveTradeEndpoints(client: ApiClient): LiveTradeEndpoints {
  return {
    list: (filter = { limit: 100 } as LiveTradeFilter) =>
      client.get<LiveTradesListOut>(`/live-trades${qs(filter)}`),
    get: (id) =>
      client.get<LiveTrade>(`/live-trades/${encodeURIComponent(id)}`),
    patchStatus: (id, req) =>
      client.patch<LiveTrade>(
        `/live-trades/${encodeURIComponent(id)}/status`,
        req,
      ),
    cancel: (id, req = {}) =>
      client.post<LiveTrade>(
        `/live-trades/${encodeURIComponent(id)}/cancel`,
        req,
      ),
  };
}

// ───────────────────────────── replay ───────────────────────────────────

export interface ReplayCursor {
  symbolId: string;
  fromTs: string;
  toTs: string;
  /** "1m", "5m", "1h", etc. Defaults to "1m" if the server decides. */
  tf?: string;
  limit?: number;
}

export interface ReplayFramesResponse {
  frames: ReplayFrame[];
  nextCursor: string | null;
}

export interface ReplayEndpoints {
  /** GET /replay/:symbolId — paginated replay frames. */
  getFrames: (cursor: ReplayCursor) => Promise<ReplayFramesResponse>;
}

export function replayEndpoints(client: ApiClient): ReplayEndpoints {
  return {
    getFrames: ({ symbolId, ...rest }) =>
      client.get<ReplayFramesResponse>(
        `/replay/${encodeURIComponent(symbolId)}${qs(rest)}`,
      ),
  };
}

/**
 * Re-export the override-risk type so callers of `previewGate` can
 * build requests without importing from `@gv/types` directly.
 */
export type { OverrideRisk };
