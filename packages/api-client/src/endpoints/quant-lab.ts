/**
 * @gv/api-client — Phase 5 quant-lab endpoints.
 *
 * Surfaces served by the control-plane quant-lab module
 * (services/control_plane/app/routes/quant_lab.py +
 *  services/control_plane/app/routes/replay_v5.py):
 *
 *   api.strategies        — CRUD + version history
 *   api.backtests         — enqueue, list, detail, trades, equity curve
 *   api.quantReplay       — enqueue, list, frames (streaming via SSE)
 *   api.experiments       — hypothesis groupings over backtests
 *   api.rankings          — A|B|C tier snapshots (nightly + on-demand)
 *   api.promotion         — FSM-audited promote / demote events
 *
 * All factories lean on the shared `ApiClient` singleton so bearer-token
 * injection + correlation-id propagation flow for free. Response shapes
 * mirror the Pydantic v2 DTOs exactly (camelCase wire format).
 */
import type {
  BacktestEquityOut,
  BacktestFilter,
  BacktestRequest,
  BacktestRun,
  BacktestTradesOut,
  BacktestsListOut,
  Experiment,
  ExperimentFilter,
  ExperimentsListOut,
  PromotionEventsListOut,
  PromotionRequest,
  QuantReplayFramesOut,
  RankingsListOut,
  ReplayRun,
  ReplayRunRequest,
  ReplayRunsListOut,
  Strategy,
  StrategyFilter,
  StrategyRanking,
  StrategyVersion,
  StrategiesListOut,
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

// ───────────────────────────── strategies ───────────────────────────────

export interface StrategyCreateRequest {
  name: string;
  description?: string;
  setupType: Strategy["setupType"];
  /** The initial active StrategyVersion config. */
  initialVersion: Omit<
    StrategyVersion,
    "id" | "strategyId" | "version" | "createdAt" | "createdByUserId"
  >;
}

export interface StrategyEndpoints {
  /** GET /quant/strategies */
  list: (filter?: StrategyFilter) => Promise<StrategiesListOut>;
  /** GET /quant/strategies/:id */
  get: (id: string) => Promise<Strategy>;
  /** POST /quant/strategies — admin only. */
  create: (req: StrategyCreateRequest) => Promise<Strategy>;
  /** GET /quant/strategies/:id/versions */
  listVersions: (id: string) => Promise<{ versions: StrategyVersion[] }>;
  /** POST /quant/strategies/:id/versions — admin only. */
  addVersion: (
    id: string,
    req: Omit<
      StrategyVersion,
      "id" | "strategyId" | "version" | "createdAt" | "createdByUserId"
    >,
  ) => Promise<StrategyVersion>;
  /** POST /quant/strategies/:id/versions/:versionId/activate — admin only. */
  activateVersion: (id: string, versionId: string) => Promise<Strategy>;
}

export function strategyEndpoints(client: ApiClient): StrategyEndpoints {
  return {
    list: (filter = { limit: 50 } as StrategyFilter) =>
      client.get<StrategiesListOut>(`/quant/strategies${qs(filter)}`),
    get: (id) =>
      client.get<Strategy>(`/quant/strategies/${encodeURIComponent(id)}`),
    create: (req) => client.post<Strategy>(`/quant/strategies`, req),
    listVersions: (id) =>
      client.get<{ versions: StrategyVersion[] }>(
        `/quant/strategies/${encodeURIComponent(id)}/versions`,
      ),
    addVersion: (id, req) =>
      client.post<StrategyVersion>(
        `/quant/strategies/${encodeURIComponent(id)}/versions`,
        req,
      ),
    activateVersion: (id, versionId) =>
      client.post<Strategy>(
        `/quant/strategies/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/activate`,
        {},
      ),
  };
}

// ───────────────────────────── backtests ────────────────────────────────

export interface BacktestEndpoints {
  /** GET /quant/backtests */
  list: (filter?: BacktestFilter) => Promise<BacktestsListOut>;
  /** GET /quant/backtests/:id */
  get: (id: string) => Promise<BacktestRun>;
  /** POST /quant/backtests — admin only. */
  create: (req: BacktestRequest) => Promise<BacktestRun>;
  /** GET /quant/backtests/:id/trades — paginated trade ledger. */
  listTrades: (
    id: string,
    opts?: { offset?: number; limit?: number },
  ) => Promise<BacktestTradesOut>;
  /** GET /quant/backtests/:id/equity — equity curve points. */
  getEquity: (id: string) => Promise<BacktestEquityOut>;
  /** POST /quant/backtests/:id/cancel — admin only. Best-effort. */
  cancel: (id: string) => Promise<BacktestRun>;
}

export function backtestEndpoints(client: ApiClient): BacktestEndpoints {
  return {
    list: (filter = { limit: 50 } as BacktestFilter) =>
      client.get<BacktestsListOut>(`/quant/backtests${qs(filter)}`),
    get: (id) =>
      client.get<BacktestRun>(`/quant/backtests/${encodeURIComponent(id)}`),
    create: (req) => client.post<BacktestRun>(`/quant/backtests`, req),
    listTrades: (id, opts = {}) =>
      client.get<BacktestTradesOut>(
        `/quant/backtests/${encodeURIComponent(id)}/trades${qs(opts)}`,
      ),
    getEquity: (id) =>
      client.get<BacktestEquityOut>(
        `/quant/backtests/${encodeURIComponent(id)}/equity`,
      ),
    cancel: (id) =>
      client.post<BacktestRun>(
        `/quant/backtests/${encodeURIComponent(id)}/cancel`,
        {},
      ),
  };
}

// ───────────────────────────── replay (quant) ───────────────────────────

export interface QuantReplayEndpoints {
  /** GET /quant/replay */
  list: (opts?: {
    status?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<ReplayRunsListOut>;
  /** GET /quant/replay/:id */
  get: (id: string) => Promise<ReplayRun>;
  /** POST /quant/replay — enqueue a new replay run. */
  create: (req: ReplayRunRequest) => Promise<ReplayRun>;
  /** GET /quant/replay/:id/frames — paginated historical frames. */
  listFrames: (
    id: string,
    opts?: { offset?: number; limit?: number },
  ) => Promise<QuantReplayFramesOut>;
  /**
   * Browser-side SSE URL for live streaming when `stepMs` > 0. Callers
   * build an EventSource against this URL directly (no fetch wrapper).
   */
  streamUrl: (id: string) => string;
  /** POST /quant/replay/:id/cancel */
  cancel: (id: string) => Promise<ReplayRun>;
}

export function quantReplayEndpoints(client: ApiClient): QuantReplayEndpoints {
  return {
    list: (opts = {}) =>
      client.get<ReplayRunsListOut>(`/quant/replay${qs(opts)}`),
    get: (id) =>
      client.get<ReplayRun>(`/quant/replay/${encodeURIComponent(id)}`),
    create: (req) => client.post<ReplayRun>(`/quant/replay`, req),
    listFrames: (id, opts = {}) =>
      client.get<QuantReplayFramesOut>(
        `/quant/replay/${encodeURIComponent(id)}/frames${qs(opts)}`,
      ),
    streamUrl: (id) =>
      `${client.baseUrl}/quant/replay/${encodeURIComponent(id)}/stream`,
    cancel: (id) =>
      client.post<ReplayRun>(
        `/quant/replay/${encodeURIComponent(id)}/cancel`,
        {},
      ),
  };
}

// ───────────────────────────── experiments ──────────────────────────────

export interface ExperimentCreateRequest {
  name: string;
  hypothesis?: string;
  strategyId: string;
}

export interface ExperimentEndpoints {
  /** GET /quant/experiments */
  list: (filter?: ExperimentFilter) => Promise<ExperimentsListOut>;
  /** GET /quant/experiments/:id */
  get: (id: string) => Promise<Experiment>;
  /** POST /quant/experiments — admin only. */
  create: (req: ExperimentCreateRequest) => Promise<Experiment>;
  /** POST /quant/experiments/:id/backtests/:backtestId — attach a run. */
  attachBacktest: (id: string, backtestId: string) => Promise<Experiment>;
  /** POST /quant/experiments/:id/complete — admin-only verdict write. */
  complete: (
    id: string,
    body: { winningBacktestId: string | null; verdict: string },
  ) => Promise<Experiment>;
}

export function experimentEndpoints(client: ApiClient): ExperimentEndpoints {
  return {
    list: (filter = { limit: 50 } as ExperimentFilter) =>
      client.get<ExperimentsListOut>(`/quant/experiments${qs(filter)}`),
    get: (id) =>
      client.get<Experiment>(`/quant/experiments/${encodeURIComponent(id)}`),
    create: (req) => client.post<Experiment>(`/quant/experiments`, req),
    attachBacktest: (id, backtestId) =>
      client.post<Experiment>(
        `/quant/experiments/${encodeURIComponent(id)}/backtests/${encodeURIComponent(backtestId)}`,
        {},
      ),
    complete: (id, body) =>
      client.post<Experiment>(
        `/quant/experiments/${encodeURIComponent(id)}/complete`,
        body,
      ),
  };
}

// ───────────────────────────── rankings + promotion ─────────────────────

export interface RankingEndpoints {
  /** GET /quant/rankings — latest ranking snapshot across strategies. */
  latest: () => Promise<RankingsListOut>;
  /** GET /quant/rankings/history?strategyId= */
  history: (strategyId: string) => Promise<{ rankings: StrategyRanking[] }>;
  /** POST /quant/rankings/recompute — admin only. Kicks off a ranking pass. */
  recompute: () => Promise<RankingsListOut>;
}

export function rankingEndpoints(client: ApiClient): RankingEndpoints {
  return {
    latest: () => client.get<RankingsListOut>(`/quant/rankings`),
    history: (strategyId) =>
      client.get<{ rankings: StrategyRanking[] }>(
        `/quant/rankings/history${qs({ strategyId })}`,
      ),
    recompute: () =>
      client.post<RankingsListOut>(`/quant/rankings/recompute`, {}),
  };
}

export interface PromotionEndpoints {
  /** GET /quant/strategies/:id/promotion — full FSM event log. */
  history: (strategyId: string) => Promise<PromotionEventsListOut>;
  /** POST /quant/strategies/:id/promote — admin only. */
  promote: (
    strategyId: string,
    req: PromotionRequest,
  ) => Promise<Strategy>;
  /** POST /quant/strategies/:id/demote — admin or auto. */
  demote: (strategyId: string, req: PromotionRequest) => Promise<Strategy>;
}

export function promotionEndpoints(client: ApiClient): PromotionEndpoints {
  return {
    history: (strategyId) =>
      client.get<PromotionEventsListOut>(
        `/quant/strategies/${encodeURIComponent(strategyId)}/promotion`,
      ),
    promote: (strategyId, req) =>
      client.post<Strategy>(
        `/quant/strategies/${encodeURIComponent(strategyId)}/promote`,
        req,
      ),
    demote: (strategyId, req) =>
      client.post<Strategy>(
        `/quant/strategies/${encodeURIComponent(strategyId)}/demote`,
        req,
      ),
  };
}
