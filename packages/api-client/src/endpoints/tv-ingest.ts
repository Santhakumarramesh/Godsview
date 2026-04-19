import type {
  SignalAuditEvent,
  SignalStatus,
  TvSignal,
  TvSignalPayload,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface TvSignalListQuery {
  status?: SignalStatus;
  symbolId?: string;
  fromTs?: string;
  toTs?: string;
  limit?: number;
  cursor?: string;
}

export interface TvSignalListResponse {
  signals: TvSignal[];
  total: number;
  nextCursor?: string | null;
}

export interface ReplayRequest {
  /** If true, the signal runs through the pipeline even if already deduped. */
  force?: boolean;
}

export interface TvIngestEndpoints {
  /** GET /tv/signals */
  listSignals: (q?: TvSignalListQuery) => Promise<TvSignalListResponse>;
  /** GET /tv/signals/:id */
  getSignal: (signalId: string) => Promise<TvSignal>;
  /** GET /tv/signals/:id/audit */
  getSignalAudit: (signalId: string) => Promise<SignalAuditEvent[]>;
  /** POST /tv/signals/:id/replay — operator action, re-runs pipeline. */
  replaySignal: (signalId: string, body?: ReplayRequest) => Promise<TvSignal>;
  /**
   * POST /tv/signals/dry-run — validate + dedup-check a payload without
   * persisting. Used by the operator to sanity-test a Pine alert.
   */
  dryRun: (payload: TvSignalPayload) => Promise<TvSignal>;
}

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function tvIngestEndpoints(client: ApiClient): TvIngestEndpoints {
  return {
    listSignals: (q = {}) =>
      client.get<TvSignalListResponse>(`/tv/signals${qs(q)}`),
    getSignal: (signalId) => client.get<TvSignal>(`/tv/signals/${encodeURIComponent(signalId)}`),
    getSignalAudit: (signalId) =>
      client.get<SignalAuditEvent[]>(`/tv/signals/${encodeURIComponent(signalId)}/audit`),
    replaySignal: (signalId, body = {}) =>
      client.post<TvSignal>(`/tv/signals/${encodeURIComponent(signalId)}/replay`, body),
    dryRun: (payload) => client.post<TvSignal>(`/tv/signals/dry-run`, payload),
  };
}
