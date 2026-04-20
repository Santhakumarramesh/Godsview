/**
 * @gv/api-client — Phase 5 learning + governance endpoints.
 *
 * Surfaces served by the control-plane learning modules
 * (services/control_plane/app/routes/learning.py +
 *  services/control_plane/app/routes/regime.py +
 *  services/control_plane/app/routes/data_truth.py):
 *
 *   api.learning        — append + query LearningEvent bus
 *   api.calibration     — read the ConfidenceCalibration curves
 *   api.regime          — current + historical regime snapshots
 *   api.session         — per-session intelligence rollups
 *   api.dataTruth       — real-time ingest health + kill-switch
 *   api.strategyDNA     — regime × session performance grid
 */
import type {
  CalibrationCurvesOut,
  DataTruthStatusOut,
  LearningEvent,
  LearningEventFilter,
  LearningEventsListOut,
  RegimeCurrentOut,
  RegimeHistoryFilter,
  RegimeHistoryOut,
  SessionIntelOut,
  StrategyDNAListOut,
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

// ───────────────────────────── learning events ─────────────────────────

export interface LearningEndpoints {
  /** GET /learning/events — paginated learning event bus tail. */
  listEvents: (
    filter?: LearningEventFilter,
  ) => Promise<LearningEventsListOut>;
  /** GET /learning/events/:id */
  getEvent: (id: string) => Promise<LearningEvent>;
  /**
   * POST /learning/events — admin only. Used by internal workers to
   * append events; the UI rarely calls this directly.
   */
  appendEvent: (
    event: Omit<LearningEvent, "id" | "ingestedAt">,
  ) => Promise<LearningEvent>;
}

export function learningEndpoints(client: ApiClient): LearningEndpoints {
  return {
    listEvents: (filter = { limit: 100 } as LearningEventFilter) =>
      client.get<LearningEventsListOut>(`/learning/events${qs(filter)}`),
    getEvent: (id) =>
      client.get<LearningEvent>(
        `/learning/events/${encodeURIComponent(id)}`,
      ),
    appendEvent: (event) =>
      client.post<LearningEvent>(`/learning/events`, event),
  };
}

// ───────────────────────────── calibration ──────────────────────────────

export interface CalibrationEndpoints {
  /**
   * GET /learning/calibration — latest per (strategy|setupType|tf)
   * calibration curves. All scopes returned by default; narrow with
   * `strategyId`.
   */
  curves: (opts?: {
    strategyId?: string;
    setupType?: string;
    tf?: string;
  }) => Promise<CalibrationCurvesOut>;
  /** POST /learning/calibration/recompute — admin only. */
  recompute: () => Promise<CalibrationCurvesOut>;
}

export function calibrationEndpoints(client: ApiClient): CalibrationEndpoints {
  return {
    curves: (opts = {}) =>
      client.get<CalibrationCurvesOut>(`/learning/calibration${qs(opts)}`),
    recompute: () =>
      client.post<CalibrationCurvesOut>(
        `/learning/calibration/recompute`,
        {},
      ),
  };
}

// ───────────────────────────── regime ───────────────────────────────────

export interface RegimeEndpoints {
  /** GET /regime/current — latest per (symbolId, tf). */
  current: () => Promise<RegimeCurrentOut>;
  /** GET /regime/history */
  history: (filter: RegimeHistoryFilter) => Promise<RegimeHistoryOut>;
}

export function regimeEndpoints(client: ApiClient): RegimeEndpoints {
  return {
    current: () => client.get<RegimeCurrentOut>(`/regime/current`),
    history: (filter) =>
      client.get<RegimeHistoryOut>(`/regime/history${qs(filter)}`),
  };
}

// ───────────────────────────── session intel ───────────────────────────

export interface SessionEndpoints {
  /** GET /sessions/intel — per-session rollup across symbols. */
  intel: (opts?: { symbolId?: string }) => Promise<SessionIntelOut>;
}

export function sessionEndpoints(client: ApiClient): SessionEndpoints {
  return {
    intel: (opts = {}) =>
      client.get<SessionIntelOut>(`/sessions/intel${qs(opts)}`),
  };
}

// ───────────────────────────── data truth + kill switch ─────────────────

export interface DataTruthEndpoints {
  /** GET /data-truth/status — overall health + per-check detail. */
  status: () => Promise<DataTruthStatusOut>;
  /**
   * POST /data-truth/kill-switch/reset — admin only. Clears a tripped
   * kill switch. Body: { reason }.
   */
  resetKillSwitch: (reason: string) => Promise<DataTruthStatusOut>;
}

export function dataTruthEndpoints(client: ApiClient): DataTruthEndpoints {
  return {
    status: () => client.get<DataTruthStatusOut>(`/data-truth/status`),
    resetKillSwitch: (reason) =>
      client.post<DataTruthStatusOut>(`/data-truth/kill-switch/reset`, {
        reason,
      }),
  };
}

// ───────────────────────────── strategy DNA ─────────────────────────────

export interface StrategyDNAEndpoints {
  /** GET /quant/strategies/:id/dna — regime × session performance grid. */
  get: (strategyId: string) => Promise<StrategyDNAListOut>;
  /** GET /quant/dna — every strategy's latest DNA snapshot. */
  listAll: () => Promise<StrategyDNAListOut>;
}

export function strategyDNAEndpoints(
  client: ApiClient,
): StrategyDNAEndpoints {
  return {
    get: (strategyId) =>
      client.get<StrategyDNAListOut>(
        `/quant/strategies/${encodeURIComponent(strategyId)}/dna`,
      ),
    listAll: () => client.get<StrategyDNAListOut>(`/quant/dna`),
  };
}
