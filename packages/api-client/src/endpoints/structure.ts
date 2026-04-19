import type {
  Fvg,
  MarketContext,
  OrderBlock,
  StructureEvent,
  Timeframe,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface StructureEventQuery {
  tf?: Timeframe;
  /** ISO-8601 inclusive lower bound. */
  fromTs?: string;
  /** ISO-8601 exclusive upper bound. */
  toTs?: string;
  limit?: number;
}

export interface StructureEventListResponse {
  events: StructureEvent[];
  total: number;
}

export interface OrderBlockListResponse {
  orderBlocks: OrderBlock[];
  total: number;
}

export interface FvgListResponse {
  fvgs: Fvg[];
  total: number;
}

export interface ListZonesQuery {
  tf?: Timeframe;
  /** Filter to currently-active (non-violated/non-mitigated) zones only. */
  activeOnly?: boolean;
  limit?: number;
}

export interface StructureEndpoints {
  /** GET /structure/symbols/:id/events */
  listEvents: (
    symbolId: string,
    q?: StructureEventQuery,
  ) => Promise<StructureEventListResponse>;
  /** GET /structure/symbols/:id/order-blocks */
  listOrderBlocks: (
    symbolId: string,
    q?: ListZonesQuery,
  ) => Promise<OrderBlockListResponse>;
  /** GET /structure/symbols/:id/fvgs */
  listFvgs: (symbolId: string, q?: ListZonesQuery) => Promise<FvgListResponse>;
  /** GET /structure/symbols/:id/context — fused HTF+LTF context. */
  getContext: (symbolId: string) => Promise<MarketContext>;
}

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function structureEndpoints(client: ApiClient): StructureEndpoints {
  return {
    listEvents: (symbolId, q = {}) =>
      client.get<StructureEventListResponse>(
        `/structure/symbols/${encodeURIComponent(symbolId)}/events${qs(q)}`,
      ),
    listOrderBlocks: (symbolId, q = {}) =>
      client.get<OrderBlockListResponse>(
        `/structure/symbols/${encodeURIComponent(symbolId)}/order-blocks${qs(q)}`,
      ),
    listFvgs: (symbolId, q = {}) =>
      client.get<FvgListResponse>(
        `/structure/symbols/${encodeURIComponent(symbolId)}/fvgs${qs(q)}`,
      ),
    getContext: (symbolId) =>
      client.get<MarketContext>(`/structure/symbols/${encodeURIComponent(symbolId)}/context`),
  };
}
