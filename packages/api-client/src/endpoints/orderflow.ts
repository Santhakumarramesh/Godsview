import type {
  AbsorptionEvent,
  DeltaBar,
  DepthSnapshot,
  ExhaustionEvent,
  ImbalanceEvent,
  LiquidityWall,
  OrderFlowIngest,
  OrderFlowState,
  Timeframe,
  VolumeCluster,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface OrderFlowIngestResponse {
  /** Number of subscribers the snapshot was fanned out to. */
  delivered: number;
  symbolId: string;
  acceptedAt: string;
}

export interface DepthQuery {
  /** Inclusive lower bound (ISO-8601). Default: 30m back. */
  fromTs?: string;
  /** Exclusive upper bound (ISO-8601). Default: now. */
  toTs?: string;
  /** Default 200, max 2000. */
  limit?: number;
}

export interface OrderFlowEventsQuery extends DepthQuery {
  /** Restrict to a single side. */
  side?: "buy" | "sell";
  /** Minimum confidence — applies only to absorption / exhaustion. */
  minConfidence?: number;
}

export interface DepthSnapshotsResponse {
  symbolId: string;
  snapshots: DepthSnapshot[];
  total: number;
}

export interface DeltaBarsResponse {
  symbolId: string;
  tf: Timeframe;
  bars: DeltaBar[];
}

export interface OrderFlowEventsResponse {
  symbolId: string;
  imbalances: ImbalanceEvent[];
  absorptions: AbsorptionEvent[];
  exhaustions: ExhaustionEvent[];
}

export interface BookStructuresResponse {
  symbolId: string;
  walls: LiquidityWall[];
  clusters: VolumeCluster[];
  asOf: string;
}

export interface OrderFlowEndpoints {
  /** POST /orderflow/ingest — admin-only. */
  ingest: (payload: OrderFlowIngest) => Promise<OrderFlowIngestResponse>;
  /** GET /orderflow/symbols/:id/depth */
  getDepth: (
    symbolId: string,
    q?: DepthQuery,
  ) => Promise<DepthSnapshotsResponse>;
  /** GET /orderflow/symbols/:id/delta?tf=… */
  getDeltaBars: (
    symbolId: string,
    q: DepthQuery & { tf: Timeframe },
  ) => Promise<DeltaBarsResponse>;
  /** GET /orderflow/symbols/:id/events */
  getEvents: (
    symbolId: string,
    q?: OrderFlowEventsQuery,
  ) => Promise<OrderFlowEventsResponse>;
  /** GET /orderflow/symbols/:id/book — current walls + clusters. */
  getBookStructures: (symbolId: string) => Promise<BookStructuresResponse>;
  /** GET /orderflow/symbols/:id/state — rolled-up state for the setup scorer. */
  getState: (symbolId: string) => Promise<OrderFlowState>;
}

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function orderflowEndpoints(client: ApiClient): OrderFlowEndpoints {
  return {
    ingest: (payload) =>
      client.post<OrderFlowIngestResponse>("/orderflow/ingest", payload),
    getDepth: (symbolId, q = {}) =>
      client.get<DepthSnapshotsResponse>(
        `/orderflow/symbols/${encodeURIComponent(symbolId)}/depth${qs(q)}`,
      ),
    getDeltaBars: (symbolId, q) =>
      client.get<DeltaBarsResponse>(
        `/orderflow/symbols/${encodeURIComponent(symbolId)}/delta${qs(q)}`,
      ),
    getEvents: (symbolId, q = {}) =>
      client.get<OrderFlowEventsResponse>(
        `/orderflow/symbols/${encodeURIComponent(symbolId)}/events${qs(q)}`,
      ),
    getBookStructures: (symbolId) =>
      client.get<BookStructuresResponse>(
        `/orderflow/symbols/${encodeURIComponent(symbolId)}/book`,
      ),
    getState: (symbolId) =>
      client.get<OrderFlowState>(
        `/orderflow/symbols/${encodeURIComponent(symbolId)}/state`,
      ),
  };
}
