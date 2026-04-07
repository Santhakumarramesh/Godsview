/**
 * Market Intelligence API Hooks — Phase 143
 * Bloomberg data, News Monitor, Brain Nodes, TradingView overlays
 */
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/* ═══════════════════════════════════════════════════════
   Bloomberg Terminal Data
   ═══════════════════════════════════════════════════════ */

export function useMarketSnapshot(symbols: string[]) {
  return useQuery({
    queryKey: ["market", "snapshot", symbols],
    queryFn: () => apiFetch<any>(`/market/snapshot?symbols=${symbols.join(",")}`),
    refetchInterval: 5_000,
  });
}

export function useSectorHeatmap(period = "1d") {
  return useQuery({
    queryKey: ["market", "sectors", period],
    queryFn: () => apiFetch<any>(`/market/sectors?period=${period}`),
    staleTime: 60_000,
  });
}

export function useEconomicIndicators() {
  return useQuery({
    queryKey: ["market", "economic-indicators"],
    queryFn: () => apiFetch<any>("/market/economic-indicators"),
    staleTime: 300_000,
  });
}

export function useYieldCurve() {
  return useQuery({
    queryKey: ["market", "yield-curve"],
    queryFn: () => apiFetch<any>("/market/yield-curve"),
    staleTime: 60_000,
  });
}

export function useCorrelationMatrix(symbols: string[], period = "3m") {
  return useQuery({
    queryKey: ["market", "correlation", symbols, period],
    queryFn: () => apiFetch<any>(`/market/correlation?symbols=${symbols.join(",")}&period=${period}`),
    staleTime: 300_000,
  });
}

export function useRiskAnalytics(horizon = "1d") {
  return useQuery({
    queryKey: ["risk", "analytics", horizon],
    queryFn: () => apiFetch<any>(`/risk/analytics?horizon=${horizon}`),
    refetchInterval: 10_000,
  });
}

/* ═══════════════════════════════════════════════════════
   News Monitor
   ═══════════════════════════════════════════════════════ */

export function useNewsFeed(opts?: { symbol?: string; category?: string; impact?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (opts?.symbol) qs.set("symbol", opts.symbol);
  if (opts?.category) qs.set("category", opts.category);
  if (opts?.impact) qs.set("impact", opts.impact);
  qs.set("limit", String(opts?.limit ?? 20));
  return useQuery({
    queryKey: ["news", "monitor", opts],
    queryFn: () => apiFetch<any>(`/news/monitor?${qs}`),
    refetchInterval: 30_000,
  });
}

export function useNewsSentiment() {
  return useQuery({
    queryKey: ["news", "sentiment"],
    queryFn: () => apiFetch<any>("/news/sentiment"),
    refetchInterval: 30_000,
  });
}

/* ═══════════════════════════════════════════════════════
   Brain Nodes
   ═══════════════════════════════════════════════════════ */

export function useBrainNodes() {
  return useQuery({
    queryKey: ["brain", "nodes"],
    queryFn: () => apiFetch<any>("/brain/nodes"),
    refetchInterval: 3_000,
  });
}

export function useBrainEvents() {
  return useQuery({
    queryKey: ["brain", "events"],
    queryFn: () => apiFetch<any>("/brain/events"),
    refetchInterval: 5_000,
  });
}

/* ═══════════════════════════════════════════════════════
   TradingView Overlays
   ═══════════════════════════════════════════════════════ */

export function useTradingViewOverlay(symbol: string, timeframe = "5m") {
  return useQuery({
    queryKey: ["tradingview", "overlay", symbol, timeframe],
    queryFn: () => apiFetch<any>(`/tradingview/overlay/${symbol}?timeframe=${timeframe}`),
    refetchInterval: 10_000,
    enabled: !!symbol,
  });
}

export function useMarketBars(symbol: string, timeframe = "5m", limit = 200) {
  return useQuery({
    queryKey: ["market", "bars", symbol, timeframe, limit],
    queryFn: () => apiFetch<any>(`/market/bars/${symbol}?timeframe=${timeframe}&limit=${limit}`),
    refetchInterval: 15_000,
    enabled: !!symbol,
  });
}

export function useMarketRegime(symbol = "SPY") {
  return useQuery({
    queryKey: ["market", "regime", symbol],
    queryFn: () => apiFetch<any>(`/market/regime?symbol=${symbol}`),
    refetchInterval: 15_000,
  });
}

export function useMarketSmc(symbol: string, timeframe = "15m") {
  return useQuery({
    queryKey: ["market", "smc", symbol, timeframe],
    queryFn: () => apiFetch<any>(`/market/smc/${symbol}?timeframe=${timeframe}`),
    refetchInterval: 15_000,
    enabled: !!symbol,
  });
}
