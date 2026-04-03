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

export type StrategyTier = "SEED" | "LEARNING" | "PROVEN" | "ELITE" | "DEGRADING" | "SUSPENDED";

export interface WalkForwardWindowMetrics {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  expectancy_r: number;
  max_drawdown_pct: number;
  avg_rr: number;
  avg_quality: number;
}

export interface WalkForwardWindowResult {
  window_index: number;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  selected_quality_threshold: number;
  train: WalkForwardWindowMetrics;
  test: WalkForwardWindowMetrics;
  passed: boolean;
  fail_reasons: string[];
}

export interface WalkForwardResult {
  strategy_id: string;
  strategy_filter: {
    setup_type: string | null;
    regime: string | null;
    symbol: string | null;
  };
  config: {
    lookback_days: number;
    train_days: number;
    test_days: number;
    step_days: number;
    min_train_samples: number;
    min_test_samples: number;
    min_win_rate: number;
    min_profit_factor: number;
    max_drawdown_pct: number;
  };
  sample_size: number;
  windows: WalkForwardWindowResult[];
  aggregate_oos: WalkForwardWindowMetrics & {
    pass_rate: number;
    windows_passed: number;
    windows_total: number;
  };
  stability: {
    score: number;
    win_rate_cv: number;
    profit_factor_cv: number;
    sharpe_cv: number;
    expectancy_cv: number;
    threshold_cv: number;
  };
  promotion: {
    action: "PROMOTE" | "HOLD" | "DEGRADE" | "SUSPEND";
    current_tier: StrategyTier;
    next_tier: StrategyTier;
    reasons: string[];
    scored_at: string;
  };
  generated_at: string;
}

export interface StrategyTierSnapshot {
  strategy_id: string;
  tier: StrategyTier;
  updated_at: string;
  notes: string[];
  aggregate_oos: WalkForwardResult["aggregate_oos"];
}

export function useWalkForwardBacktest(
  strategyId: string,
  params?: Partial<{
    lookback_days: number;
    train_days: number;
    test_days: number;
    step_days: number;
    min_train_samples: number;
    min_test_samples: number;
    min_win_rate: number;
    min_profit_factor: number;
    max_drawdown_pct: number;
  }>,
  options?: Omit<UseQueryOptions<WalkForwardResult>, "queryKey" | "queryFn">,
) {
  const query = new URLSearchParams();
  if (params?.lookback_days != null) query.set("lookback_days", String(params.lookback_days));
  if (params?.train_days != null) query.set("train_days", String(params.train_days));
  if (params?.test_days != null) query.set("test_days", String(params.test_days));
  if (params?.step_days != null) query.set("step_days", String(params.step_days));
  if (params?.min_train_samples != null) query.set("min_train_samples", String(params.min_train_samples));
  if (params?.min_test_samples != null) query.set("min_test_samples", String(params.min_test_samples));
  if (params?.min_win_rate != null) query.set("min_win_rate", String(params.min_win_rate));
  if (params?.min_profit_factor != null) query.set("min_profit_factor", String(params.min_profit_factor));
  if (params?.max_drawdown_pct != null) query.set("max_drawdown_pct", String(params.max_drawdown_pct));
  const qs = query.toString();
  const path = `/backtest/walk-forward/${encodeURIComponent(strategyId)}${qs ? `?${qs}` : ""}`;

  return useQuery({
    queryKey: ["backtest", "walk-forward", strategyId, qs],
    queryFn: () => apiFetch<WalkForwardResult>(path),
    enabled: !!strategyId,
    refetchInterval: 120_000,
    ...options,
  });
}

export function useStrategyTierRegistry(options?: Omit<UseQueryOptions<{ count: number; tiers: StrategyTierSnapshot[] }>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["backtest", "walk-forward", "tiers"],
    queryFn: () => apiFetch<{ count: number; tiers: StrategyTierSnapshot[] }>("/backtest/walk-forward/tiers"),
    staleTime: 60_000,
    refetchInterval: 120_000,
    ...options,
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
  return useQuery({
    queryKey: ["brain", "entities", params],
    queryFn: async () => {
      const raw = await apiFetch<any>(`/brain/entities${params}`);
      // API returns {count, entities} but consumers expect BrainEntity[]
      return (Array.isArray(raw) ? raw : raw?.entities ?? []) as BrainEntity[];
    },
    staleTime: 30_000,
  });
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

// ─── Brain Intelligence (Market DNA + Setup Memory + Context) ────────────────
export function useBrainIntelligence(symbol: string) {
  return useQuery({
    queryKey: ["brain", symbol, "intelligence"],
    queryFn: () => apiFetch<{
      symbol: string;
      dna: {
        trendiness: number;
        fakeout_risk: number;
        breakout_quality: number;
        spread_stability: number;
        news_sensitivity: number;
        momentum_persistence: number;
        mean_reversion: number;
        volatility_regime: string;
        bar_count: number;
        decision_count: number;
      } | null;
      setup_memory: {
        total_decisions: number;
        total_approved: number;
        total_with_outcome: number;
        overall_win_rate: number;
        overall_profit_factor: number;
        by_setup: Array<{
          setup_type: string;
          direction: string;
          similar_setups: number;
          win_rate: number;
          profit_factor: number;
          decay_detected: boolean;
          decay_rate: number;
          best_regime: string | null;
          worst_regime: string | null;
        }>;
        top_setups: Array<{ setup_type: string; win_rate: number; similar_setups: number }>;
        decaying_setups: Array<{ setup_type: string; decay_rate: number }>;
      } | null;
      context: {
        entity: any;
        memories: any[];
      } | null;
    }>(`/brain/${symbol}/intelligence`),
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled: !!symbol,
  });
}

// ─── SMC Engine State ────────────────────────────────────────────────────────
export function useSMCState(symbol: string) {
  return useQuery({
    queryKey: ["brain", symbol, "smc"],
    queryFn: () => apiFetch<{
      symbol: string;
      structure: {
        trend: string;
        bos: boolean;
        choch: boolean;
        bosDirection: string;
        structureScore: number;
        pattern: string;
        invalidation: number | null;
        swingHighs: Array<{ price: number; ts: string }>;
        swingLows: Array<{ price: number; ts: string }>;
      };
      orderBlocks: Array<{
        side: string; low: number; high: number; mid: number;
        strength: number; tested: boolean; broken: boolean; ts: string;
      }>;
      fairValueGaps: Array<{
        side: string; low: number; high: number; sizePct: number;
        filled: boolean; fillPct: number; ts: string;
      }>;
      liquidityPools: Array<{
        price: number; kind: string; touches: number; swept: boolean;
      }>;
      activeOBs: Array<{ side: string; low: number; high: number; strength: number }>;
      unfilledFVGs: Array<{ side: string; low: number; high: number }>;
      nearestLiquidityAbove: { price: number; kind: string; touches: number } | null;
      nearestLiquidityBelow: { price: number; kind: string; touches: number } | null;
      confluenceScore: number;
    }>(`/brain/${symbol}/smc`),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: !!symbol,
  });
}

// ─── Regime + Spectral State ─────────────────────────────────────────────────
export function useRegimeState(symbol: string) {
  return useQuery({
    queryKey: ["brain", symbol, "regime"],
    queryFn: () => apiFetch<{
      symbol: string;
      basic: {
        regime: string;
        trendStrength: number;
        compressionScore: number;
        expansionScore: number;
        volState: string;
        dirPersistence: number;
        confidence: number;
      };
      spectral: {
        dominantCycleLength: number | null;
        spectralPower: number;
        cycleStability: number;
        regimeLabel: string;
      };
      label: string;
      confidence: number;
    }>(`/brain/${symbol}/regime`),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: !!symbol,
  });
}

// ─── Order Flow State ────────────────────────────────────────────────────────
export function useOrderflowState(symbol: string) {
  return useQuery({
    queryKey: ["brain", symbol, "orderflow"],
    queryFn: () => apiFetch<{
      symbol: string;
      orderflow: {
        delta: number; cvd: number; cvdSlope: number;
        quoteImbalance: number; spreadBps: number;
        aggressionScore: number; orderflowBias: string;
        orderflowScore: number; buyVolumeRatio: number;
        largeDeltaBar: boolean; divergence: boolean;
      };
      liquidity: {
        strongestBidLevel: number | null; strongestAskLevel: number | null;
        liquidityAbove: number; liquidityBelow: number;
        thinZoneDetected: boolean; liquidityScore: number;
      };
      candle_packets: Array<{
        ts: string; open: number; high: number; low: number; close: number;
        volume: number; delta: number; cvdChange: number; imbalance: number;
        events: Array<{ eventType: string; intensity: number; description: string }>;
      }>;
    }>(`/brain/${symbol}/orderflow`),
    staleTime: 15_000,
    refetchInterval: 15_000,
    enabled: !!symbol,
  });
}

// ─── Full Brain State (all engines merged) ───────────────────────────────────
export function useBrainState(symbol: string) {
  return useQuery({
    queryKey: ["brain", symbol, "brain-state"],
    queryFn: () => apiFetch<{
      symbol: string;
      readinessScore: number;
      attentionScore: number;
      structureScore: number;
      regimeScore: number;
      orderflowScore: number;
      liquidityScore: number;
      volScore: number;
      stressPenalty: number;
      summary: string;
      smc: any;
      regime: any;
      orderflow: any;
      liquidity: any;
      volatility: any;
      microstructureEvents: Array<{
        ts: string; eventType: string; intensity: number; description: string;
      }>;
      dna: any;
      computedAt: string;
    }>(`/brain/${symbol}/brain-state`),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: !!symbol,
  });
}

// ─── Global Market Stress ───────────────────────────────────────────────────
export function useMarketStress(symbols: string[]) {
  return useQuery({
    queryKey: ["brain", "market-stress", symbols.join(",")],
    queryFn: () => apiFetch<{
      avgCorrelation: number;
      correlationSpikeCount: number;
      breadthWeakness: number;
      systemicStressScore: number;
      stressRegime: string;
      symbolCount: number;
      topCorrelations: any[];
    }>(`/brain/market-stress?symbols=${symbols.join(",")}`),
    staleTime: 60_000,
    enabled: symbols.length >= 2,
  });
}
