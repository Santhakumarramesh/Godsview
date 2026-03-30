/**
 * GodsView API Hooks
 * Typed React Query hooks for every API endpoint.
 * Matches the Express API server routes in artifacts/api-server/src/routes/
 */
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";

// ─── Base Fetch ──────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${res.statusText} — ${body}`);
  }
  return res.json();
}

// ─── Health ──────────────────────────────────────────────────────────────────
export function useHealthz() {
  return useQuery({ queryKey: ["healthz"], queryFn: () => apiFetch<{ status: string }>("/healthz"), staleTime: 30_000 });
}
// ─── Alpaca: Account & Positions ─────────────────────────────────────────────
export interface AlpacaAccount {
  id: string; equity: string; cash: string; buying_power: string;
  portfolio_value: string; status: string; currency: string;
  last_equity: string; long_market_value: string; short_market_value: string;
}

export interface AlpacaPosition {
  symbol: string; qty: string; side: string; avg_entry_price: string;
  current_price: string; market_value: string; unrealized_pl: string;
  unrealized_plpc: string; asset_class: string;
}

export interface AlpacaOrder {
  id: string; symbol: string; qty: string; side: string; type: string;
  time_in_force: string; status: string; filled_avg_price: string;
  created_at: string; filled_at: string;
}

export function useAlpacaAccount() {
  return useQuery({ queryKey: ["alpaca", "account"], queryFn: () => apiFetch<AlpacaAccount>("/alpaca/account"), staleTime: 15_000 });
}

export function useAlpacaPositions() {
  return useQuery({ queryKey: ["alpaca", "positions"], queryFn: () => apiFetch<AlpacaPosition[]>("/alpaca/positions"), refetchInterval: 10_000 });
}
export function useAlpacaPositionsLive() {
  return useQuery({ queryKey: ["alpaca", "positions", "live"], queryFn: () => apiFetch<AlpacaPosition[]>("/alpaca/positions/live"), refetchInterval: 5_000 });
}

export function useAlpacaOrders() {
  return useQuery({ queryKey: ["alpaca", "orders"], queryFn: () => apiFetch<AlpacaOrder[]>("/alpaca/orders"), staleTime: 10_000 });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: { symbol: string; qty: number; side: "buy" | "sell"; type: string; time_in_force: string; limit_price?: number; stop_price?: number }) =>
      apiFetch<AlpacaOrder>("/alpaca/orders", { method: "POST", body: JSON.stringify(order) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alpaca"] }); },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => apiFetch<void>(`/alpaca/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alpaca", "orders"] }); },
  });
}

export function useCancelAllOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/alpaca/orders", { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alpaca", "orders"] }); },
  });
}
export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (symbol: string) => apiFetch<void>(`/alpaca/positions/${symbol}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alpaca", "positions"] }); },
  });
}

// ─── Alpaca: Market Data ─────────────────────────────────────────────────────
export interface TickerData { symbol: string; price: number; change: number; change_pct: number; volume?: number; }
export interface CandleBar { t: string; o: number; h: number; l: number; c: number; v: number; }

export function useAlpacaTicker(symbols: string[]) {
  return useQuery({
    queryKey: ["alpaca", "ticker", symbols.join(",")],
    queryFn: () => apiFetch<Record<string, TickerData>>(`/alpaca/ticker?symbols=${symbols.join(",")}`),
    refetchInterval: 5_000,
    enabled: symbols.length > 0,
  });
}

export function useAlpacaBars(symbol: string, timeframe = "1Hour", limit = 100) {
  return useQuery({
    queryKey: ["alpaca", "bars", symbol, timeframe, limit],
    queryFn: () => apiFetch<CandleBar[]>(`/alpaca/bars?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`),
    staleTime: 60_000,
    enabled: !!symbol,
  });
}
export function useAlpacaCandles(symbol: string, timeframe = "1Min", limit = 60) {
  return useQuery({
    queryKey: ["alpaca", "candles", symbol, timeframe],
    queryFn: () => apiFetch<CandleBar[]>(`/alpaca/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`),
    refetchInterval: 10_000,
    enabled: !!symbol,
  });
}

export function usePositionSize(symbol: string, stopDistance: number) {
  return useQuery({
    queryKey: ["alpaca", "size", symbol, stopDistance],
    queryFn: () => apiFetch<{ qty: number; risk: number; equity: number }>(`/alpaca/size?symbol=${symbol}&stop_distance=${stopDistance}`),
    enabled: !!symbol && stopDistance > 0,
  });
}

// ─── Alpaca: Analysis ────────────────────────────────────────────────────────
export function useAnalyze() {
  return useMutation({
    mutationFn: (params: { symbol: string; timeframe?: string }) =>
      apiFetch<any>("/alpaca/analyze", { method: "POST", body: JSON.stringify(params) }),
  });
}

export function useBacktest() {
  return useMutation({
    mutationFn: (params: { symbol: string; start?: string; end?: string }) =>
      apiFetch<any>("/alpaca/backtest", { method: "POST", body: JSON.stringify(params) }),
  });
}
export function useAccuracy() {
  return useQuery({ queryKey: ["alpaca", "accuracy"], queryFn: () => apiFetch<any>("/alpaca/accuracy"), staleTime: 120_000 });
}

// ─── Brain ───────────────────────────────────────────────────────────────────
export interface BrainEntity {
  id: number; symbol: string; entity_type: string; name?: string;
  sector?: string; regime?: string; volatility?: number; last_price?: number;
  state_json?: string; updated_at: string;
}

export interface BrainMemory {
  id: number; entity_id: number; memory_type: string; content: string;
  confidence: number; source?: string; created_at: string;
}

export interface BrainSnapshot {
  entities: BrainEntity[]; relations: any[]; memories: BrainMemory[];
  timestamp: string;
}

export function useBrainEntities(symbols?: string[]) {
  const params = symbols?.length ? `?symbols=${symbols.join(",")}` : "";
  return useQuery({ queryKey: ["brain", "entities", params], queryFn: () => apiFetch<BrainEntity[]>(`/brain/entities${params}`), staleTime: 30_000 });
}

export function useBrainSnapshot() {
  return useQuery({ queryKey: ["brain", "snapshot"], queryFn: () => apiFetch<BrainSnapshot>("/brain/snapshot"), staleTime: 30_000 });
}
export function useBrainConsciousness() {
  return useQuery({ queryKey: ["brain", "consciousness"], queryFn: () => apiFetch<any>("/brain/consciousness"), staleTime: 15_000, refetchInterval: 15_000 });
}

export function useSymbolMemories(symbol: string) {
  return useQuery({ queryKey: ["brain", symbol, "memories"], queryFn: () => apiFetch<BrainMemory[]>(`/brain/${symbol}/memories`), staleTime: 60_000, enabled: !!symbol });
}

export function useSymbolContext(symbol: string) {
  return useQuery({ queryKey: ["brain", symbol, "context"], queryFn: () => apiFetch<any>(`/brain/${symbol}/context`), staleTime: 30_000, enabled: !!symbol });
}

export function useBrainUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbols: string[] }) => apiFetch<any>("/brain/update", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain"] }); },
  });
}

export function useBrainEvolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/brain/evolve", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain"] }); },
  });
}
// ─── Market / Orderbook ──────────────────────────────────────────────────────
export function useOrderbookSnapshot(symbol: string) {
  return useQuery({
    queryKey: ["orderbook", symbol],
    queryFn: () => apiFetch<any>(`/orderbook/snapshot?symbol=${symbol}`),
    refetchInterval: 3_000, enabled: !!symbol,
  });
}

export function useMicrostructure(symbol: string, timeframe = "1Min") {
  return useQuery({
    queryKey: ["market", "microstructure", symbol, timeframe],
    queryFn: () => apiFetch<any>(`/market/microstructure?symbol=${symbol}&timeframe=${timeframe}`),
    staleTime: 15_000, enabled: !!symbol,
  });
}

export function useLiquidityZones(symbol: string) {
  return useQuery({
    queryKey: ["market", "liquidity-zones", symbol],
    queryFn: () => apiFetch<any>(`/market/liquidity-zones?symbol=${symbol}`),
    staleTime: 30_000, enabled: !!symbol,
  });
}

export function useVolumeProfile(symbol: string) {
  return useQuery({
    queryKey: ["market", "volume-profile", symbol],
    queryFn: () => apiFetch<any>(`/market/volume-profile?symbol=${symbol}`),
    staleTime: 30_000, enabled: !!symbol,
  });
}
export function useCandleIntelligence(symbol: string) {
  return useQuery({
    queryKey: ["market", "candle-intelligence", symbol],
    queryFn: () => apiFetch<any>(`/market/candle-intelligence?symbol=${symbol}`),
    staleTime: 15_000, enabled: !!symbol,
  });
}

export function useCVD(symbol: string) {
  return useQuery({
    queryKey: ["market", "cvd", symbol],
    queryFn: () => apiFetch<any>(`/market/cvd?symbol=${symbol}`),
    refetchInterval: 10_000, enabled: !!symbol,
  });
}

// ─── Strict Setup / Setup Explorer ───────────────────────────────────────────
export function useStrictSetup(symbol: string) {
  return useQuery({
    queryKey: ["market", "strict-setup", symbol],
    queryFn: () => apiFetch<any>(`/market/strict-setup?symbol=${symbol}`),
    staleTime: 30_000, enabled: !!symbol,
  });
}

export function useSetupMatrix() {
  return useQuery({
    queryKey: ["market", "strict-setup", "matrix"],
    queryFn: () => apiFetch<any>("/market/strict-setup/matrix"),
    staleTime: 60_000,
  });
}
export function useSetupReport(setupType: string) {
  return useQuery({
    queryKey: ["market", "strict-setup", "report", setupType],
    queryFn: () => apiFetch<any>(`/market/strict-setup/report?setup_type=${setupType}`),
    staleTime: 120_000, enabled: !!setupType,
  });
}

// ─── Performance ─────────────────────────────────────────────────────────────
export function usePerformance(days = 30) {
  return useQuery({
    queryKey: ["performance", days],
    queryFn: () => apiFetch<any>(`/performance?days=${days}`),
    staleTime: 60_000,
  });
}

// ─── System ──────────────────────────────────────────────────────────────────
export function useSystemStatus() {
  return useQuery({ queryKey: ["system", "status"], queryFn: () => apiFetch<any>("/system/status"), refetchInterval: 30_000 });
}

export function useSystemDiagnostics() {
  return useQuery({ queryKey: ["system", "diagnostics"], queryFn: () => apiFetch<any>("/system/diagnostics"), staleTime: 30_000 });
}

export function useModelDiagnostics() {
  return useQuery({ queryKey: ["system", "model", "diagnostics"], queryFn: () => apiFetch<any>("/system/model/diagnostics"), staleTime: 60_000 });
}
export function useProofBySetup() {
  return useQuery({ queryKey: ["system", "proof", "by-setup"], queryFn: () => apiFetch<any>("/system/proof/by-setup"), staleTime: 120_000 });
}

export function useProofByRegime() {
  return useQuery({ queryKey: ["system", "proof", "by-regime"], queryFn: () => apiFetch<any>("/system/proof/by-regime"), staleTime: 120_000 });
}

export function useOosVsIs() {
  return useQuery({ queryKey: ["system", "proof", "oos-vs-is"], queryFn: () => apiFetch<any>("/system/proof/oos-vs-is"), staleTime: 120_000 });
}

// ─── Risk ────────────────────────────────────────────────────────────────────
export interface RiskConfig {
  kill_switch: boolean; max_daily_loss: number; max_exposure_pct: number;
  max_concurrent_positions: number; max_trades_per_session: number;
  cooldown_minutes: number; degraded_data_block: boolean;
  session_allowlist: string[]; news_lockout: boolean;
}

export function useRiskConfig() {
  return useQuery({ queryKey: ["system", "risk"], queryFn: () => apiFetch<RiskConfig>("/system/risk"), staleTime: 30_000 });
}

export function useUpdateRiskConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<RiskConfig>) => apiFetch<RiskConfig>("/system/risk", { method: "PUT", body: JSON.stringify(config) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", "risk"] }); },
  });
}
export function useKillSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (active: boolean) => apiFetch<any>("/system/kill-switch", { method: "POST", body: JSON.stringify({ active }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", "risk"] }); qc.invalidateQueries({ queryKey: ["alpaca"] }); },
  });
}

export function useResetRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/system/risk/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", "risk"] }); },
  });
}

// ─── Research ────────────────────────────────────────────────────────────────
export function useResearchLatest() {
  return useQuery({ queryKey: ["research", "latest"], queryFn: () => apiFetch<any>("/research/openbb/latest"), staleTime: 300_000 });
}

// ─── Signals (from generated client) ─────────────────────────────────────────
export function useSignals() {
  return useQuery({ queryKey: ["signals"], queryFn: () => apiFetch<any[]>("/signals"), refetchInterval: 15_000 });
}

// ─── Trades (from generated client) ──────────────────────────────────────────
export function useTrades() {
  return useQuery({ queryKey: ["trades"], queryFn: () => apiFetch<any[]>("/trades"), staleTime: 30_000 });
}

export function useCreateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trade: any) => apiFetch<any>("/trades", { method: "POST", body: JSON.stringify(trade) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trades"] }); },
  });
}