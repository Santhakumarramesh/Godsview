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
  return useQuery({
    queryKey: ["alpaca", "positions"],
    queryFn: async () => {
      const raw = await apiFetch<any>("/alpaca/positions");
      return (Array.isArray(raw) ? raw : raw?.positions ?? []) as AlpacaPosition[];
    },
    refetchInterval: 10_000,
  });
}
export function useAlpacaPositionsLive() {
  return useQuery({
    queryKey: ["alpaca", "positions", "live"],
    queryFn: async () => {
      const raw = await apiFetch<any>("/alpaca/positions/live");
      return (Array.isArray(raw) ? raw : raw?.positions ?? []) as AlpacaPosition[];
    },
    refetchInterval: 5_000,
  });
}

export function useAlpacaOrders() {
  return useQuery({
    queryKey: ["alpaca", "orders"],
    queryFn: async () => {
      const raw = await apiFetch<any>("/alpaca/orders");
      return (Array.isArray(raw) ? raw : raw?.orders ?? []) as AlpacaOrder[];
    },
    staleTime: 10_000,
  });
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
  // Backend reads `symbol` (singular) not `symbols` — join into comma-separated
  const params = symbols?.length ? `?symbol=${symbols.join(",")}` : "";
  return useQuery({
    queryKey: ["brain", "entities", params],
    queryFn: async () => {
      const raw = await apiFetch<any>(`/brain/entities${params}`);
      // Backend returns { count, entities } — unwrap to array
      const entities = Array.isArray(raw) ? raw : raw?.entities;
      return (Array.isArray(entities) ? entities : []) as BrainEntity[];
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
  return useQuery({
    queryKey: ["signals"],
    queryFn: async () => {
      const raw = await apiFetch<any>("/signals");
      return (Array.isArray(raw) ? raw : raw?.signals ?? []) as any[];
    },
    refetchInterval: 15_000,
  });
}

// ─── Trades (from generated client) ──────────────────────────────────────────
export function useTrades() {
  return useQuery({
    queryKey: ["trades"],
    queryFn: async () => {
      const raw = await apiFetch<any>("/trades");
      return (Array.isArray(raw) ? raw : raw?.trades ?? []) as any[];
    },
    staleTime: 30_000,
  });
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

// ═══════════════════════════════════════════════════════════════════════════
// AGENT-BRAIN CYCLE HOOKS
// These power the multi-agent intelligence pipeline in the UI
// ═══════════════════════════════════════════════════════════════════════════

/** Agent report as returned from the brain cycle API */
export interface AgentReportDTO {
  agentId: string;
  layer?: string;
  status: "idle" | "running" | "done" | "error" | "stale";
  confidence: number;
  score: number;
  verdict: string;
  data?: Record<string, unknown>;
  flags: Array<{ level: "info" | "warning" | "critical"; code: string; message: string }>;
  subReports?: AgentReportDTO[];
  latencyMs: number;
}

/** Brain decision as returned from the brain cycle API */
export interface BrainDecisionDTO {
  symbol: string;
  action: "STRONG_LONG" | "STRONG_SHORT" | "WATCH_LONG" | "WATCH_SHORT" | "IDLE" | "BLOCKED";
  confidence: number;
  readinessScore: number;
  attentionScore: number;
  reasoning: string;
  riskGate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  blockReason?: string;
  agentReports: AgentReportDTO[];
  cycleLatencyMs: number;
}

/** Full brain cycle response */
export interface BrainCycleResponse {
  ok: boolean;
  cycleId: number;
  symbolCount: number;
  decisions: BrainDecisionDTO[];
  latencyMs: number;
  timestamp: number;
}

/** Brain cycle SSE event */
export interface BrainSSEEvent {
  type: string;
  cycleId: number;
  symbol?: string;
  agentId?: string;
  payload: any;
  timestamp: number;
}

/** Trigger a brain cycle for multiple symbols */
export function useBrainCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbols: string[] }) =>
      apiFetch<BrainCycleResponse>("/brain/cycle", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain"] });
    },
  });
}

/** Trigger a brain cycle for a single symbol */
export function useBrainCycleSingle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (symbol: string) =>
      apiFetch<{ ok: boolean; cycleId: number; decision: BrainDecisionDTO; timestamp: number }>(
        "/brain/cycle/single",
        { method: "POST", body: JSON.stringify({ symbol }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain"] });
    },
  });
}

/** Get the latest brain cycle state (for initial load) */
export function useLatestBrainCycle() {
  return useQuery({
    queryKey: ["brain", "cycle", "latest"],
    queryFn: () => apiFetch<{
      hasCycle: boolean;
      cycleId: number;
      running: boolean;
      startedAt: number;
      finishedAt: number | null;
      decisions: BrainDecisionDTO[];
      agents: AgentReportDTO[];
      events: BrainSSEEvent[];
    }>("/brain/cycle/latest"),
    staleTime: 10_000,
  });
}

// ─── Backtest (L7) ───────────────────────────────────────────────────────────

export interface RulebookEntry {
  rule: string;
  evidence: number;
  impact: number;
  reliability: number;
}

export interface BacktestResult {
  ok: boolean;
  symbol: string;
  runAt: string;
  latencyMs: number;
  backtest: {
    winRate: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdownR: number;
    totalTrades: number;
    confirmationCount: number;
    rulebook: RulebookEntry[];
    bestRegime: string;
    worstRegime: string;
    mtfAlignedWR: number;
    mtfDivergentWR: number;
  };
  chart: {
    snapshotsGenerated: number;
    topConfirmationId: string;
    topConfirmationScore: number;
    allSnapshotIds: string[];
  };
  topSnapshotSvg: string | null;
}

export interface BacktestListItem {
  symbol: string;
  runAt: string;
  latencyMs: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  snapshotsGenerated: number;
}

/** Run a full L7+L8 backtest + chart pipeline for a symbol */
export function useRunBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ symbol, lookbackBars = 2000 }: { symbol: string; lookbackBars?: number }) =>
      apiFetch<BacktestResult>("/brain/backtest", {
        method: "POST",
        body: JSON.stringify({ symbol, lookbackBars }),
      }),
    onSuccess: (_data, { symbol }) => {
      qc.invalidateQueries({ queryKey: ["brain", "backtest", symbol] });
      qc.invalidateQueries({ queryKey: ["brain", "backtest", "list"] });
    },
  });
}

/** Get cached backtest for a symbol */
export function useBacktestResult(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["brain", "backtest", symbol],
    queryFn: () => apiFetch<BacktestResult & { backtestOutput: BacktestResult["backtest"] }>(`/brain/backtest/${symbol}`),
    enabled: enabled && !!symbol,
    staleTime: 300_000,
    retry: false,
  });
}

/** List all cached backtest results */
export function useBacktestList() {
  return useQuery({
    queryKey: ["brain", "backtest", "list"],
    queryFn: () => apiFetch<{ ok: boolean; count: number; results: BacktestListItem[] }>("/brain/backtest"),
    staleTime: 60_000,
  });
}

// ─── Chart Snapshots (L8) ────────────────────────────────────────────────────

export interface ChartSnapshotMeta {
  confirmationId: string;
  score?: number;
  generatedAt?: string;
}

/** Get SVG chart snapshot for a confirmation */
export function useChartSnapshot(symbol: string, confirmationId: string, enabled = true) {
  return useQuery({
    queryKey: ["brain", "chart", symbol, confirmationId],
    queryFn: () => apiFetch<{ ok: boolean; symbol: string; confirmationId: string; meta: Record<string, unknown>; svg: string }>(
      `/brain/chart/${symbol}/${confirmationId}`
    ),
    enabled: enabled && !!symbol && !!confirmationId,
    staleTime: 600_000,
  });
}

/** List snapshots for a symbol */
export function useChartSnapshots(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["brain", "chart", symbol],
    queryFn: () => apiFetch<{ ok: boolean; symbol: string; count: number; snapshots: ChartSnapshotMeta[] }>(
      `/brain/chart/${symbol}`
    ),
    enabled: enabled && !!symbol,
    staleTime: 60_000,
  });
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export interface SchedulerStatus {
  ok: boolean;
  running: boolean;
  cycleCount: number;
  errorCount: number;
  lastCycleAt: number;
  symbols: string[];
  uptime: number;
}

export function useSchedulerStatus() {
  return useQuery({
    queryKey: ["brain", "scheduler", "status"],
    queryFn: () => apiFetch<SchedulerStatus>("/brain/scheduler/status"),
    refetchInterval: 10_000,
  });
}

export function useStartScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbols: string[]; cycleIntervalMs?: number; backtestIntervalMs?: number }) =>
      apiFetch<{ ok: boolean; message: string; symbols: string[] }>("/brain/scheduler/start", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "scheduler"] });
    },
  });
}

export function useStopScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; message: string }>("/brain/scheduler/stop", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "scheduler"] });
    },
  });
}

// ─── Phase 6: Autonomous Brain + Job Queue + Strategy Evolution ─────────────

export interface BrainJobItem {
  id: string;
  type: string;
  priority: number;
  status: string;
  symbol?: string;
  reason: string;
  createdBy: string;
  createdAt: number;
  attempts: number;
}

export interface StrategyItem {
  strategyId: string;
  symbol: string;
  name: string;
  tier: string;
  version: number;
  winRate: number;
  sharpeRatio: number;
  calmarRatio: number;
  totalTrades: number;
  minConfirmationScore: number;
  requireMTFAlignment: boolean;
  blacklistedRegimes: string[];
  stopATRMultiplier: number;
  takeProfitATRMultiplier: number;
  maxKellyFraction: number;
  lastEvolvedAt: string;
  changeCount: number;
}

export interface StrategyRanking {
  rank: number;
  symbol: string;
  strategyId: string;
  tier: string;
  compositeScore: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  version: number;
}

export interface SuperIntelStatus {
  symbol: string;
  version: number;
  outcomes: number;
  accuracy: number;
  brier: number;
  weights: Record<string, number>;
  regimeCalibration: Record<string, number>;
  lastRetrainedAt: string;
}

export interface AutonomousBrainStatus {
  ok: boolean;
  running: boolean;
  brain: {
    mode: string;
    cycleCount: number;
    scanCount: number;
    backtestCount: number;
    evolutionCount: number;
    retrainCount: number;
    totalJobsCreated: number;
    totalJobsCompleted: number;
    consecutiveLosses: number;
    consecutiveWins: number;
    recentWinRate: number;
    symbols: string[];
    opportunityRank: string[];
    attentionMap: Record<string, number>;
    errors: number;
    startedAt: number;
    version: string;
  };
  queue: { queued: number; running: number; done: number; failed: number; byType: Record<string, number> };
  strategies: Array<{ strategyId: string; symbol: string; tier: string; version: number; winRate: number; sharpe: number; trades: number }>;
  superIntel: SuperIntelStatus[];
  uptime: number;
}

export function useAutonomousBrainStatus() {
  return useQuery({
    queryKey: ["brain", "autonomous", "status"],
    queryFn: () => apiFetch<AutonomousBrainStatus>("/brain/autonomous/status"),
    refetchInterval: 8_000,
  });
}

export function useStartAutonomousBrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbols: string[]; cycleIntervalMs?: number }) =>
      apiFetch<{ ok: boolean; message: string }>("/brain/autonomous/start", {
        method: "POST", body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain", "autonomous"] }); },
  });
}

export function useStopAutonomousBrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/brain/autonomous/stop", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain", "autonomous"] }); },
  });
}

export function useSetBrainMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: "AGGRESSIVE" | "NORMAL" | "DEFENSIVE" | "PAUSED") =>
      apiFetch<{ ok: boolean; mode: string }>("/brain/autonomous/mode", {
        method: "POST", body: JSON.stringify({ mode }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain", "autonomous"] }); },
  });
}

export function useRecordOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (o: { symbol: string; direction: "long" | "short"; won: boolean; achievedR: number; regime?: string; predictedWinProb?: number }) =>
      apiFetch<{ ok: boolean }>("/brain/autonomous/outcome", { method: "POST", body: JSON.stringify(o) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain", "superintel"] }); },
  });
}

export function useJobQueue() {
  return useQuery({
    queryKey: ["brain", "jobs"],
    queryFn: () => apiFetch<{
      ok: boolean;
      stats: { queued: number; running: number; done: number; failed: number; byPriority: Record<string, number>; byType: Record<string, number> };
      queue: BrainJobItem[];
      recentCompleted: Array<{ id: string; type: string; status: string; symbol?: string; latencyMs: number | null }>;
    }>("/brain/jobs"),
    refetchInterval: 5_000,
  });
}

export function useEnqueueJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { type: string; symbol: string; priority?: number; reason?: string }) =>
      apiFetch<{ ok: boolean; jobId: string; type: string; status: string }>("/brain/jobs/enqueue", {
        method: "POST", body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain", "jobs"] }); },
  });
}

export function useStrategies(symbol?: string) {
  return useQuery({
    queryKey: ["brain", "strategies", symbol ?? "all"],
    queryFn: () => apiFetch<{ ok: boolean; count: number; strategies: StrategyItem[] }>(
      `/brain/strategies${symbol ? `?symbol=${symbol}` : ""}`
    ),
    staleTime: 30_000,
  });
}

export function useStrategyRankings(symbols?: string[]) {
  return useQuery({
    queryKey: ["brain", "strategies", "rank", symbols?.join(",") ?? "all"],
    queryFn: () => apiFetch<{ ok: boolean; count: number; rankings: StrategyRanking[] }>(
      `/brain/strategies/rank${symbols ? `?symbols=${symbols.join(",")}` : ""}`
    ),
    staleTime: 30_000,
  });
}

export function useSuperIntelStatus(symbol?: string) {
  return useQuery({
    queryKey: ["brain", "superintel", symbol ?? "all"],
    queryFn: () => apiFetch<{ ok: boolean; models: SuperIntelStatus[] }>(
      `/brain/superintel/status${symbol ? `?symbol=${symbol}` : ""}`
    ),
    staleTime: 20_000,
  });
}

export function useRetrainSuperIntel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (symbol?: string) =>
      apiFetch<{ ok: boolean; version?: number; accuracy?: number; brier?: number; symbolCount?: number }>(
        "/brain/superintel/retrain", { method: "POST", body: JSON.stringify({ symbol }) }
      ),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain", "superintel"] }); },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: PERSISTENCE + LIVE EXECUTION HOOKS
// ═══════════════════════════════════════════════════════════════════════════

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrainPositionSnapshot {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  unrealizedPnlUsd: number;
  unrealizedPnlR: number;
  openedAt: number;
  ageMinutes: number;
  status: "IN_RANGE" | "NEAR_TP" | "NEAR_SL" | "TP_HIT" | "SL_HIT";
}

export interface BrainPnLSummary {
  openPositions: BrainPositionSnapshot[];
  todayPnlR: number;
  weekPnlR: number;
  allTimePnlR: number;
  todayWins: number;
  todayLosses: number;
  runningWinRate: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  lastTradeAt?: string;
  portfolioStats: Array<{ symbol: string; totalTrades: number; winRate: number; totalPnlR: number }>;
}

export interface BridgeStatus {
  enabled: boolean;
  totalSignals: number;
  totalApproved: number;
  totalExecuted: number;
  totalBlocked: number;
  approvalRate: number;
  executionRate: number;
  openPositions: any[];
  recentRejections: Array<{ ts: number; symbol: string; reason: string }>;
  config: { minScore: number; minWinProb: number; maxPositions: number; riskPerTradePct: number; accountEquity: number };
}

export interface TradeOutcomeItem {
  id: number;
  symbol: string;
  direction: string;
  regime?: string;
  outcome?: string;
  pnl_r?: string;
  pnl_usd?: string;
  si_win_probability?: string;
  confirmation_score?: string;
  entry_time?: string;
  exit_time?: string;
  created_at: string;
}

export interface OutcomeStats {
  totalTrades: number; wins: number; losses: number; winRate: number;
  avgPnlR: number; avgMfeR: number; avgMaeR: number;
}

export interface JobHistoryItem {
  id: number; job_id: string; job_type: string; symbol?: string;
  priority: number; status: string; latency_ms?: number; error?: string; created_at: string;
}

// ── Execution Bridge ──────────────────────────────────────────────────────

export function useExecutionBridgeStatus() {
  return useQuery({
    queryKey: ["brain", "execution", "status"],
    queryFn: () => apiFetch<BridgeStatus & { ok: boolean }>("/brain/execution/status"),
    refetchInterval: 10_000,
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { symbol: string; exitPrice: number; reason?: string }) =>
      apiFetch<{ ok: boolean }>("/brain/execution/close", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "execution"] });
      qc.invalidateQueries({ queryKey: ["brain", "pnl"] });
    },
  });
}

// ── P&L Tracker ───────────────────────────────────────────────────────────

export function useBrainPnL() {
  return useQuery({
    queryKey: ["brain", "pnl", "summary"],
    queryFn: () => apiFetch<BrainPnLSummary & { ok: boolean }>("/brain/pnl/summary"),
    refetchInterval: 10_000,
  });
}

export function useStartPnLTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; running: boolean }>("/brain/pnl/tracker/start", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "pnl"] }),
  });
}

export function useStopPnLTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; running: boolean }>("/brain/pnl/tracker/stop", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "pnl"] }),
  });
}

// ── Job History ───────────────────────────────────────────────────────────

export function useJobHistory(limit = 100, jobType?: string) {
  return useQuery({
    queryKey: ["brain", "history", "jobs", limit, jobType],
    queryFn: () => apiFetch<{ ok: boolean; count: number; jobs: JobHistoryItem[] }>(
      `/brain/history/jobs?limit=${limit}${jobType ? `&type=${jobType}` : ""}`
    ),
    staleTime: 30_000,
  });
}

export function useJobLatencyStats() {
  return useQuery({
    queryKey: ["brain", "history", "jobs", "latency"],
    queryFn: () => apiFetch<{ ok: boolean; stats: Array<{
      jobType: string; count: number; avgLatencyMs: number;
      p50LatencyMs: number; p95LatencyMs: number; successCount: number; failCount: number;
    }> }>("/brain/history/jobs/latency"),
    staleTime: 60_000,
  });
}

// ── Trade Outcomes ────────────────────────────────────────────────────────

export function useTradeOutcomes(symbol: string, limit = 100) {
  return useQuery({
    queryKey: ["brain", "history", "outcomes", symbol, limit],
    queryFn: () => apiFetch<{ ok: boolean; count: number; outcomes: TradeOutcomeItem[] }>(
      `/brain/history/outcomes?symbol=${symbol}&limit=${limit}`
    ),
    staleTime: 30_000,
    enabled: !!symbol,
  });
}

export function useOutcomeStats(symbol: string) {
  return useQuery({
    queryKey: ["brain", "history", "outcomes", "stats", symbol],
    queryFn: () => apiFetch<OutcomeStats & { ok: boolean; symbol: string }>(
      `/brain/history/outcomes/stats?symbol=${symbol}`
    ),
    staleTime: 60_000,
    enabled: !!symbol,
  });
}

export function usePortfolioStats() {
  return useQuery({
    queryKey: ["brain", "history", "portfolio"],
    queryFn: () => apiFetch<{ ok: boolean; count: number; stats: Array<{
      symbol: string; totalTrades: number; wins: number; winRate: number; totalPnlR: number; avgSiWinProb: number;
    }> }>("/brain/history/portfolio"),
    staleTime: 60_000,
  });
}

// ── Chart History ─────────────────────────────────────────────────────────

export function useChartHistory(symbol: string, limit = 50) {
  return useQuery({
    queryKey: ["brain", "history", "charts", symbol, limit],
    queryFn: () => apiFetch<{ ok: boolean; count: number; snapshots: Array<{
      id: number; confirmation_id: string; symbol: string; direction?: string;
      regime?: string; confirmation_score?: string; bar_count?: number; created_at: string;
    }> }>(`/brain/history/charts?symbol=${symbol}&limit=${limit}`),
    staleTime: 60_000,
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

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: STREAM + CORRELATION + ALERTS + WATCHDOG + PERFORMANCE HOOKS
// ═══════════════════════════════════════════════════════════════════════════

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrainAlertItem {
  id: string;
  code: string;
  level: "INFO" | "WARNING" | "CRITICAL";
  symbol?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  deliveredVia: string[];
  createdAt: number;
  readAt?: number;
}

export interface WatchdogReport {
  overallHealth: "HEALTHY" | "DEGRADED" | "FAILED" | "RESTARTING";
  timestamp: number;
  subsystems: Array<{
    name: string;
    health: string;
    lastCheckAt: number;
    lastHealthyAt: number;
    restartCount: number;
    details: string;
  }>;
  stuckJobs: string[];
  memoryUsageMb: number;
  uptimeSeconds: number;
  healingActions: string[];
}

export interface CorrelationSummary {
  running: boolean;
  trackedSymbols: number;
  symbolList: string[];
  lastUpdated?: string;
  contagionScore: number;
  diversificationScore: number;
  hasContagionAlert: boolean;
  contagionAlert?: {
    severity: string;
    symbols: string[];
    avgCorrelation: number;
    message: string;
  };
  pairCount: number;
  topCorrelations: Array<{ symbolA: string; symbolB: string; correlation: number }>;
  portfolioBetas: Array<{ symbol: string; betaToSpy: number; direction: string }>;
}

export interface EquityPoint {
  timestamp: number;
  cumulativeR: number;
  drawdownFromPeak: number;
  tradeNumber: number;
}

export interface BrainPerformanceReport {
  symbol: string;
  totalTrades: number;
  winRate: number;
  avgPnlR: number;
  totalPnlR: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownR: number;
  profitFactor: number;
  expectancy: number;
  currentStreak: number;
  equityCurve: EquityPoint[];
  byRegime: Array<{ regime: string; trades: number; winRate: number; totalPnlR: number }>;
  byDirection: Array<{ direction: string; trades: number; winRate: number; avgPnlR: number }>;
  byDay: Array<{ date: string; trades: number; wins: number; pnlR: number; winRate: number }>;
  computedAt: string;
}

// ── Stream Bridge ─────────────────────────────────────────────────────────

export function useStreamBridgeStatus() {
  return useQuery({
    queryKey: ["brain", "stream", "status"],
    queryFn: () => apiFetch<{ ok: boolean; running: boolean; totalTicks: number; stockWsConnected: boolean; stockSubscribed: string[]; lastTickAt?: string }>("/brain/stream/status"),
    refetchInterval: 15_000,
  });
}

export function useStartStreamBridge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/brain/stream/start", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "stream"] }),
  });
}

// ── Correlation ───────────────────────────────────────────────────────────

export function useCorrelationSummary() {
  return useQuery({
    queryKey: ["brain", "correlation", "summary"],
    queryFn: () => apiFetch<CorrelationSummary & { ok: boolean }>("/brain/correlation/summary"),
    refetchInterval: 60_000,
  });
}

// ── Alerts ────────────────────────────────────────────────────────────────

export function useBrainAlerts(limit = 50, level?: string) {
  return useQuery({
    queryKey: ["brain", "alerts", limit, level],
    queryFn: () => apiFetch<{ ok: boolean; count: number; alerts: BrainAlertItem[]; stats: any }>(
      `/brain/alerts?limit=${limit}${level ? `&level=${level}` : ""}`
    ),
    refetchInterval: 10_000,
  });
}

export function useMarkAlertsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { alertIds?: string[]; all?: boolean }) =>
      apiFetch<{ ok: boolean }>("/brain/alerts/read", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "alerts"] }),
  });
}

// ── Watchdog ──────────────────────────────────────────────────────────────

export function useWatchdogReport() {
  return useQuery({
    queryKey: ["brain", "watchdog", "report"],
    queryFn: () => apiFetch<{ ok: boolean; report: WatchdogReport }>("/brain/watchdog/report"),
    refetchInterval: 30_000,
  });
}

export function useStartWatchdog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; running: boolean }>("/brain/watchdog/start", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "watchdog"] }),
  });
}

// ── Performance Dashboard ─────────────────────────────────────────────────

export function useBrainPerformance(symbol: string) {
  return useQuery({
    queryKey: ["brain", "performance", symbol],
    queryFn: () => apiFetch<BrainPerformanceReport & { ok: boolean }>(`/brain/performance/${symbol}`),
    staleTime: 60_000,
    enabled: !!symbol,
  });
}

export function usePortfolioEquityCurve() {
  return useQuery({
    queryKey: ["brain", "performance", "portfolio"],
    queryFn: () => apiFetch<{
      ok: boolean;
      equityCurve: EquityPoint[];
      totalPnlR: number;
      winRate: number;
      sharpe: number;
      maxDrawdownR: number;
      bySymbol: Array<{ symbol: string; totalTrades: number; winRate: number; totalPnlR: number; sharpe: number }>;
    }>("/brain/performance/portfolio/summary"),
    staleTime: 60_000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: CIRCUIT BREAKER + LIVING RULEBOOK + BRAIN STATUS SSE
// ═══════════════════════════════════════════════════════════════════════════

// ── Types ─────────────────────────────────────────────────────────────────

export type CircuitState = "OPEN" | "HALF_OPEN" | "TRIPPED";

export interface CircuitSnapshot {
  state: CircuitState;
  dailyPnlR: number;
  dailyTrades: number;
  dailyWins: number;
  dailyLosses: number;
  dailyWinRate: number;
  maxDailyLossR: number;
  maxDailyTrades: number;
  tripEvents: Array<{
    reason: string;
    triggeredAt: number;
    dailyPnlR: number;
    dailyTrades: number;
    dailyWinRate: number;
    details: string;
  }>;
  lastResetAt: number;
  lastCheckAt: number;
}

export interface RegimeRule {
  regime: string;
  trades: number;
  winRate: number;
  avgPnlR: number;
  edge: "STRONG" | "MODERATE" | "WEAK" | "AVOID";
}

export interface SymbolDirectionRule {
  symbol: string;
  direction: "LONG" | "SHORT";
  trades: number;
  winRate: number;
  avgPnlR: number;
  bestRegime: string;
  worstRegime: string;
  edge: "STRONG" | "MODERATE" | "WEAK" | "AVOID";
}

export interface Rulebook {
  version: number;
  generatedAt: number;
  totalOutcomesAnalyzed: number;
  byRegime: RegimeRule[];
  bySymbolDirection: SymbolDirectionRule[];
  byStrategy: Array<{ symbol: string; strategyId: string; tier: string; winRate: number; sharpe: number; notes: string[] }>;
  scoreThreshold: { minScoreForEdge: number; minScoreForElite: number; sampleSize: number };
  eliteInsights: string[];
  avoidanceList: string[];
  lastFullRebuildAt: number;
}

export interface BrainStatusSnapshot {
  brain: {
    brain: { mode: string; running: boolean; cycleCount: number; scanCount: number; backtestCount: number;
              totalJobsCreated: number; totalJobsCompleted: number; consecutiveLosses: number; consecutiveWins: number;
              recentWinRate: number; symbols: string[]; startedAt: number; errors: number };
    running: boolean;
    uptime: number;
  };
  circuit: CircuitSnapshot;
  alerts: { total: number; unread: number; critical: number; warning: number };
  ts: number;
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export function useCircuitBreakerStatus() {
  return useQuery({
    queryKey: ["brain", "circuit", "status"],
    queryFn: () => apiFetch<CircuitSnapshot & { ok: boolean }>("/brain/circuit/status"),
    refetchInterval: 10_000,
  });
}

export function useTripCircuitBreaker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<{ ok: boolean }>("/brain/circuit/trip", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "circuit"] }),
  });
}

export function useResetCircuitBreaker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/brain/circuit/reset", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "circuit"] }),
  });
}

export function useBrainRulebook() {
  return useQuery({
    queryKey: ["brain", "rulebook"],
    queryFn: () => apiFetch<{ ok: boolean; rulebook: Rulebook }>("/brain/rulebook"),
    staleTime: 4 * 60_000,
  });
}

export function useRebuildRulebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; rulebook: Rulebook }>("/brain/rulebook/rebuild", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "rulebook"] }),
  });
}

export function useBrainStatusSnapshot() {
  return useQuery({
    queryKey: ["brain", "status", "snapshot"],
    queryFn: () => apiFetch<BrainStatusSnapshot & { ok: boolean }>("/brain/status/snapshot"),
    refetchInterval: 5_000,
  });
}
// ─────────────────────────────────────────────────────────────────────────────
// Phase 11 — Strategy Param Editor + Position Sizing Dashboard
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrategyParamOverride {
  strategyId: string;
  minScore?: number;
  minWinProb?: number;
  maxKellyFraction?: number;
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;
  enabled?: boolean;
  blacklistedRegimes?: string[];
  updatedAt?: string;
  note?: string;
}

export interface StrategyParamSnapshot {
  overrides: StrategyParamOverride[];
  count: number;
  persistedAt: string | null;
}

export interface PositionSizingDetail {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  strategyId: string;
  orderId?: string;
  openedAt: string;
  ageMinutes: number;
  slDistance: number;
  tpDistance: number;
  riskDollars: number;
  effectiveRiskPct: number;
  riskRewardRatio: number;
  livePrice: number;
  unrealizedPnl: number;
  unrealizedR: number;
  winProbAtEntry: number | null;
}

export interface PositionSizingSnapshot {
  positions: PositionSizingDetail[];
  count: number;
  maxPositions: number;
  slotsRemaining: number;
  totalRiskDollars: number;
  totalPortfolioRiskPct: number;
  maxRiskPerTradePct: number;
  realizedPnlToday: number;
  unrealizedPnlTotal: number;
  netPnlToday: number;
  configuredEquity: number;
  effectiveEquity: number;
  equityUtilizationPct: number;
  reconciler: {
    last_poll_at: string | null;
    fills_today: number;
    realized_pnl_today: number;
    unmatched_fills: number;
    is_running: boolean;
  };
  timestamp: string;
}

export interface AccountEquitySnapshot {
  equity: number;
  buyingPower: number | null;
  portfolioValue: number | null;
  source: string;
  maxRiskPerTradePct: number;
  maxRiskDollars: number;
  timestamp: string;
}

// ── Strategy Param Hooks ──────────────────────────────────────────────────────

export function useStrategyParams() {
  return useQuery({
    queryKey: ["brain", "strategy", "params"],
    queryFn: () => apiFetch<StrategyParamSnapshot>("/brain/strategy/params"),
    staleTime: 30_000,
  });
}

export function useStrategyParamOverride(strategyId: string) {
  return useQuery({
    queryKey: ["brain", "strategy", "params", strategyId],
    queryFn: () => apiFetch<{ strategyId: string; override: StrategyParamOverride | null }>(`/brain/strategy/params/${strategyId}`),
    enabled: !!strategyId,
    staleTime: 30_000,
  });
}

export function useSetStrategyParam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ strategyId, patch }: { strategyId: string; patch: Partial<StrategyParamOverride> }) =>
      apiFetch<{ strategyId: string; override: StrategyParamOverride; saved: boolean }>(
        `/brain/strategy/params/${strategyId}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "strategy", "params"] }),
  });
}

export function useResetStrategyParam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (strategyId: string) =>
      apiFetch<{ strategyId: string; reset: boolean }>(`/brain/strategy/params/${strategyId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "strategy", "params"] }),
  });
}

export function useResetAllStrategyParams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ reset: boolean; message: string }>("/brain/strategy/params", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "strategy", "params"] }),
  });
}

// ── Position Sizing Hooks ─────────────────────────────────────────────────────

export function usePositionSizing() {
  return useQuery({
    queryKey: ["brain", "positions", "sizing"],
    queryFn: () => apiFetch<PositionSizingSnapshot>("/brain/positions/sizing"),
    refetchInterval: 5_000,
  });
}

export function useAccountEquity() {
  return useQuery({
    queryKey: ["brain", "account", "equity"],
    queryFn: () => apiFetch<AccountEquitySnapshot>("/brain/account/equity"),
    refetchInterval: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 12 — Brain Health Telemetry + Account Stream + MTF Confluence
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LayerTelemetry {
  layer: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxLatencyMs: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastErrorMsg: string | null;
  recentLatencies: number[];
}

export interface PipelineTelemetry {
  layers: LayerTelemetry[];
  totalCycles: number;
  successfulCycles: number;
  cycleSuccessRate: number;
  avgCycleLatencyMs: number;
  p95CycleLatencyMs: number;
  throughputPerMin: number;
  healthScore: number;
  healthTier: "EXCELLENT" | "GOOD" | "DEGRADED" | "CRITICAL";
  alertFlags: string[];
  uptimeMs: number;
  startedAt: string;
  snapshot_at: string;
}

export interface AccountStreamStatus {
  connected: boolean;
  authenticated: boolean;
  connectedAt: string | null;
  uptimeSeconds: number;
  totalFills: number;
  totalOrders: number;
  disconnectCount: number;
  wsUrl: string;
  mode: "paper" | "live";
}

export interface MTFTimeframeAnalysis {
  tf: string;
  bars: number;
  trend: "bullish" | "bearish" | "neutral";
  momentum: number;
  volumeConfirmed: boolean;
  ema9AboveEma21: boolean;
  score: number;
}

export interface MTFConfluenceResult {
  symbol: string;
  direction: "long" | "short";
  alignmentScore: number;
  timeframes: MTFTimeframeAnalysis[];
  agreementCount: number;
  strongTFs: string[];
  conflictTFs: string[];
  compressed: boolean;
  timestamp: number;
  cached: boolean;
}

// ── Brain Health Hooks ────────────────────────────────────────────────────────

export function useBrainHealthTelemetry() {
  return useQuery({
    queryKey: ["brain", "health", "telemetry"],
    queryFn: () => apiFetch<{ ok: boolean; telemetry: PipelineTelemetry }>("/brain/health/telemetry"),
    refetchInterval: 5_000,
  });
}

export function useResetTelemetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/brain/health/reset", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "health"] }),
  });
}

export function useAccountStreamStatus() {
  return useQuery({
    queryKey: ["brain", "health", "account-stream"],
    queryFn: () => apiFetch<{ ok: boolean; stream: AccountStreamStatus }>("/brain/health/account-stream"),
    refetchInterval: 10_000,
  });
}

export function useMTFConfluence(symbol: string, direction: "long" | "short") {
  return useQuery({
    queryKey: ["brain", "health", "mtf", symbol, direction],
    queryFn: () => apiFetch<{ ok: boolean; confluence: MTFConfluenceResult }>(`/brain/health/mtf/${symbol}?direction=${direction}`),
    enabled: !!symbol,
    staleTime: 60_000,
  });
}
