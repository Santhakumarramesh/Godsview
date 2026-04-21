import type { ApiClient } from "../client.js";

export interface MarketQuote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: number;
}

export interface MarketBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketEndpoints {
  getSymbols: () => Promise<{ symbols: string[] }>;
  getQuote: (symbol: string) => Promise<MarketQuote>;
  getBars: (symbol: string, timeframe?: string) => Promise<{ bars: MarketBar[] }>;
}

export function marketEndpoints(client: ApiClient): MarketEndpoints {
  return {
    getSymbols: () => client.get<{ symbols: string[] }>("/v1/market/symbols"),
    getQuote: (symbol: string) =>
      client.get<MarketQuote>(`/v1/market/quote/${symbol}`),
    getBars: (symbol: string, timeframe?: string) =>
      client.get<{ bars: MarketBar[] }>(
        `/v1/market/bars/${symbol}?timeframe=${timeframe || "1D"}`
      ),
  };
}
