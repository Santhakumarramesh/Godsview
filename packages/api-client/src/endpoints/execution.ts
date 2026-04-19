/**
 * @gv/api-client — Phase 4 execution + risk + broker + replay endpoints.
 *
 * Endpoints served by `services/control_plane/app/routes/execution.py`
 * (paper gate — already in Phase 3) and
 * `app/routes/live_execution.py`, `app/routes/risk.py`,
 * `app/routes/broker.py`, `app/routes/replay.py` (Phase 4 PR3+).
 *
 *   api.liveExecution   — POST /setups/:id/approve-live, gate preview
 *   api.risk            — GET + PATCH /risk/budget, GET /risk/equity
 *   api.broker          — GET /broker/positions, GET /broker/fills
 *   api.liveTrades      — GET list + detail + PATCH status
 *   api.replay          — GET /replay/:symbolId (cursor frames)
 *
 * All factories lean on the `ApiClient` singleton — they carry the
 * bearer-token injection + correlation-id propagation for free.
 */
import type {
  AccountEquity,
  BrokerFill,
  GateDecision,
  LiveGateInput,
  LiveTrade,
  LiveTradeFilter,
  LiveTradeStatus,
  Position,
  ReplayFrame,
  RiskBudget,
  Setup,
  SetupApprovalRequest,
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

export interface LiveApprovalResponse {
  setup: Setup;
  liveTrade: LiveTrade;
}

export interface LiveGatePreviewRequest {
  setupId: string;
  sizeMultiplier?: number;
}

export interface LiveGatePreviewResponse {
  decision: GateDecision;
  input: LiveGateInput;
}

export interface LiveExecutionEndpoints {
  /** POST /setups/:id/approve-live — Phase 4 live approval. */
  approve: (
    setupId: string,
    req?: SetupApprovalRequest,
  ) => Promise<LiveApprovalResponse>;
  /** POST /execution/live/preview — run the gate without submitting. */
  previewGate: (req: LiveGatePreviewRequest) => Promise<LiveGatePreviewResponse>;
}

export function liveExecutionEndpoints(client: ApiClient): LiveExecutionEndpoints {
  return {
    approve: (setupId, req = { mode: "live" } as SetupApprovalRequest) =>
      client.post<LiveApprovalResponse>(
        `/setups/${encodeURIComponent(setupId)}/approve-live`,
        req,
      ),
    previewGate: (req) =>
      client.post<LiveGatePreviewResponse>(`/execution/live/preview`, req),
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
  /** GET /risk/equity — latest broker equity snapshot. */
  getEquity: (accountId: string) => Promise<AccountEquity>;
}

export function riskEndpoints(client: ApiClient): RiskEndpoints {
  return {
    getBudget: (accountId) =>
      client.get<RiskBudget>(
        `/risk/budget${qs({ accountId })}`,
      ),
    patchBudget: (accountId, patch) =>
      client.patch<RiskBudget>(
        `/risk/budget${qs({ accountId })}`,
        patch,
      ),
    getEquity: (accountId) =>
      client.get<AccountEquity>(
        `/risk/equity${qs({ accountId })}`,
      ),
  };
}

// ───────────────────────────── broker ───────────────────────────────────

export interface BrokerPositionsResponse {
  items: Position[];
  observedAt: string;
}

export interface BrokerFillsResponse {
  items: BrokerFill[];
  nextCursor: string | null;
}

export interface BrokerFillsFilter {
  accountId: string;
  symbolId?: string;
  clientOrderId?: string;
  fromTs?: string;
  toTs?: string;
  cursor?: string;
  limit?: number;
}

export interface BrokerEndpoints {
  /** GET /broker/positions — live positions for an account. */
  listPositions: (accountId: string) => Promise<BrokerPositionsResponse>;
  /** GET /broker/fills — historical broker fills with optional filters. */
  listFills: (filter: BrokerFillsFilter) => Promise<BrokerFillsResponse>;
}

export function brokerEndpoints(client: ApiClient): BrokerEndpoints {
  return {
    listPositions: (accountId) =>
      client.get<BrokerPositionsResponse>(
        `/broker/positions${qs({ accountId })}`,
      ),
    listFills: (filter) =>
      client.get<BrokerFillsResponse>(`/broker/fills${qs(filter)}`),
  };
}

// ───────────────────────────── live trades ──────────────────────────────

export interface LiveTradesListResponse {
  items: LiveTrade[];
  nextCursor: string | null;
  total: number;
}

export interface LiveTradeStatusPatchRequest {
  status: LiveTradeStatus;
  note?: string;
}

export interface LiveTradeEndpoints {
  /** GET /live-trades */
  list: (filter?: LiveTradeFilter) => Promise<LiveTradesListResponse>;
  /** GET /live-trades/:id */
  get: (id: string) => Promise<LiveTrade>;
  /** PATCH /live-trades/:id/status — admin only; FSM-enforced. */
  patchStatus: (
    id: string,
    req: LiveTradeStatusPatchRequest,
  ) => Promise<LiveTrade>;
  /** POST /live-trades/:id/cancel — cancels any open broker order. */
  cancel: (id: string, note?: string) => Promise<LiveTrade>;
}

export function liveTradeEndpoints(client: ApiClient): LiveTradeEndpoints {
  return {
    list: (filter = { limit: 50 } as LiveTradeFilter) =>
      client.get<LiveTradesListResponse>(`/live-trades${qs(filter)}`),
    get: (id) =>
      client.get<LiveTrade>(`/live-trades/${encodeURIComponent(id)}`),
    patchStatus: (id, req) =>
      client.patch<LiveTrade>(
        `/live-trades/${encodeURIComponent(id)}/status`,
        req,
      ),
    cancel: (id, note) =>
      client.post<LiveTrade>(
        `/live-trades/${encodeURIComponent(id)}/cancel`,
        { note },
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
