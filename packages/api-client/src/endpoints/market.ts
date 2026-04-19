import type {
  Bar,
  BarSeries,
  Quote,
  Symbol,
  Timeframe,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface MarketSymbolListResponse {
  symbols: Symbol[];
  total: number;
}

export interface ListSymbolsQuery {
  assetClass?: "equity" | "crypto" | "forex" | "futures" | "index";
  exchange?: string;
  active?: boolean;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface BarsQuery {
  tf: Timeframe;
  /** Inclusive lower bound (ISO-8601). */
  fromTs?: string;
  /** Exclusive upper bound (ISO-8601). */
  toTs?: string;
  /** Default 500, max 5000. */
  limit?: number;
}

export interface MarketEndpoints {
  /** GET /market/symbols */
  listSymbols: (q?: ListSymbolsQuery) => Promise<MarketSymbolListResponse>;
  /** GET /market/symbols/:id */
  getSymbol: (symbolId: string) => Promise<Symbol>;
  /** GET /market/symbols/:id/bars */
  getBars: (symbolId: string, q: BarsQuery) => Promise<BarSeries>;
  /** GET /market/symbols/:id/quote */
  getQuote: (symbolId: string) => Promise<Quote>;
  /** GET /market/symbols/:id/bars/last — single most recent closed bar. */
  getLastBar: (symbolId: string, tf: Timeframe) => Promise<Bar>;
}

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function marketEndpoints(client: ApiClient): MarketEndpoints {
  return {
    listSymbols: (q = {}) =>
      client.get<MarketSymbolListResponse>(`/market/symbols${qs(q)}`),
    getSymbol: (symbolId) => client.get<Symbol>(`/market/symbols/${encodeURIComponent(symbolId)}`),
    getBars: (symbolId, q) =>
      client.get<BarSeries>(
        `/market/symbols/${encodeURIComponent(symbolId)}/bars${qs(q)}`,
      ),
    getQuote: (symbolId) => client.get<Quote>(`/market/symbols/${encodeURIComponent(symbolId)}/quote`),
    getLastBar: (symbolId, tf) =>
      client.get<Bar>(`/market/symbols/${encodeURIComponent(symbolId)}/bars/last${qs({ tf })}`),
  };
}
