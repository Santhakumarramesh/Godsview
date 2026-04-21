/**
 * GodsView API Hooks
 * Typed React Query hooks for every API endpoint.
 * Matches the Express API server routes in artifacts/api-server/src/routes/
 */
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";

// ─── Base Fetch ──────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || "/api";

/**
 * Whether the current environment is production.
 * In production, demo data responses are flagged so the UI can warn users.
 */
const IS_PROD = import.meta.env.PROD;

/**
 * Global flag: set to true when any response returns X-Demo-Data header.
 * UI components can read this to display a warning banner.
 */
export let __hasDemoDataWarning = false;
export function clearDemoDataWarning() { __hasDemoDataWarning = false; }

/** Listeners notified when demo data is detected */
type DemoDataListener = (isDemoData: boolean) => void;
const _demoListeners: DemoDataListener[] = [];
export function onDemoDataDetected(fn: DemoDataListener) {
  _demoListeners.push(fn);
  return () => { const i = _demoListeners.indexOf(fn); if (i >= 0) _demoListeners.splice(i, 1); };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${res.statusText} — ${body}`);
  }

  // ── Demo data detection ───────────────────────────────────────────
  const isDemoData = res.headers.get("X-Demo-Data") === "true";
  if (isDemoData) {
    __hasDemoDataWarning = true;
    _demoListeners.forEach((fn) => fn(true));
    if (IS_PROD) {
      console.warn(`[GodsView] Demo data detected on ${path} — this endpoint is not returning live data`);
    }
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

// ─── Quant Lab Backtest Run & Quick ─────────────────────────────────────────
export function useBacktestRun() {
  return useMutation({
    mutationFn: (params: { lookback_days: number; initial_equity: number; mode?: string }) =>
      apiFetch<any>("/backtest/run", { method: "POST", body: JSON.stringify(params) }),
  });
}

export function useBacktestQuick() {
  return useQuery({
    queryKey: ["backtest", "quick"],
    queryFn: () => apiFetch<any>("/backtest/quick"),
    retry: false,
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

export function useOptimizeStrategy() {
  return useMutation({
    mutationFn: (params: {
      strategy_id: string;
      lookback_days?: number;
      min_train_samples?: number;
      min_test_samples?: number;
    }) =>
      apiFetch<any>(`/backtest/optimize/${encodeURIComponent(params.strategy_id)}`, {
        method: "POST",
        body: JSON.stringify({
          lookback_days: params.lookback_days,
          min_train_samples: params.min_train_samples,
          min_test_samples: params.min_test_samples,
        }),
      }),
  });
}

export interface ContinuousBacktestStatus {
  running: boolean;
  message: string;
  last_result_timestamp?: string;
  strategies_tested: number;
}

export interface StrategyLeaderboardEntry {
  strategy_name: string;
  setup_type: string;
  regime: string;
  tier?: StrategyTier;
  stars: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  total_tests: number;
  consistency_score: number;
  last_tested: string;
}

export function useContinuousBacktestStatus(options?: Omit<UseQueryOptions<ContinuousBacktestStatus>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["backtest", "continuous", "status"],
    queryFn: () => apiFetch<ContinuousBacktestStatus>("/backtest/continuous/status"),
    refetchInterval: 15_000,
    ...options,
  });
}

export function useStrategyLeaderboard(options?: Omit<UseQueryOptions<{ count: number; strategies: StrategyLeaderboardEntry[] }>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["backtest", "strategy", "leaderboard"],
    queryFn: () => apiFetch<{ count: number; strategies: StrategyLeaderboardEntry[] }>("/backtest/strategy-leaderboard"),
    refetchInterval: 30_000,
    ...options,
  });
}

export function useStartContinuousBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: boolean; message: string }>("/backtest/continuous/start", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backtest", "continuous"] });
      qc.invalidateQueries({ queryKey: ["backtest", "strategy", "leaderboard"] });
    },
  });
}

export function useStopContinuousBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: boolean; message: string }>("/backtest/continuous/stop", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backtest", "continuous"] });
    },
  });
}

export function useRunWalkForwardBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      strategy_id: string;
      lookback_days?: number;
      train_days?: number;
      test_days?: number;
      step_days?: number;
      min_train_samples?: number;
      min_test_samples?: number;
      min_win_rate?: number;
      min_profit_factor?: number;
      max_drawdown_pct?: number;
    }) =>
      apiFetch<WalkForwardResult>(`/backtest/walk-forward/${encodeURIComponent(params.strategy_id)}`, {
        method: "POST",
        body: JSON.stringify({
          lookback_days: params.lookback_days,
          train_days: params.train_days,
          test_days: params.test_days,
          step_days: params.step_days,
          min_train_samples: params.min_train_samples,
          min_test_samples: params.min_test_samples,
          min_win_rate: params.min_win_rate,
          min_profit_factor: params.min_profit_factor,
          max_drawdown_pct: params.max_drawdown_pct,
        }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["backtest", "walk-forward", variables.strategy_id] });
      qc.invalidateQueries({ queryKey: ["backtest", "walk-forward", "tiers"] });
    },
  });
}

export interface PaperValidationStatus {
  running: boolean;
  interval_ms: number;
  last_cycle_at: string | null;
  last_error: string | null;
  history_size: number;
  latest_status: "INSUFFICIENT" | "HEALTHY" | "WATCH" | "DRIFT" | "CRITICAL" | null;
  latest_sample_count: number;
}

export interface PaperValidationReport {
  generated_at: string;
  days: number;
  status: "INSUFFICIENT" | "HEALTHY" | "WATCH" | "DRIFT" | "CRITICAL";
  threshold: number;
  reconciliation: {
    pending_before: number;
    matched: number;
    still_pending: number;
    scanned_accuracy_rows: number;
  };
  approved: {
    sample_count: number;
    realized_win_rate: number;
    average_predicted_win_prob: number;
    calibration_bias: number;
    brier_score: number;
    precision: number;
    recall: number;
    realized_pnl_total: number;
  };
  optimization_actions: Array<{
    strategy_id: string;
    success: boolean;
    message: string;
    best_score?: number;
    next_tier?: string;
  }>;
}

export function usePaperValidationStatus(options?: Omit<UseQueryOptions<PaperValidationStatus>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["paper", "validation", "status"],
    queryFn: () => apiFetch<PaperValidationStatus>("/paper/validation/status"),
    refetchInterval: 15_000,
    ...options,
  });
}

export function usePaperValidationReport(options?: Omit<UseQueryOptions<PaperValidationReport>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["paper", "validation", "latest"],
    queryFn: () => apiFetch<PaperValidationReport>("/paper/validation/latest"),
    refetchInterval: 30_000,
    retry: false,
    ...options,
  });
}

export function useRunPaperValidation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { days?: number; threshold?: number; enable_auto_optimization?: boolean }) =>
      apiFetch<PaperValidationReport>("/paper/validation/run-once", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paper", "validation"] });
    },
  });
}

export type AutonomySupervisorServiceHealth = "HEALTHY" | "DEGRADED" | "STOPPED" | "DISABLED";

export interface AutonomySupervisorServiceSnapshot {
  name: string;
  expected: boolean;
  running: boolean;
  health: AutonomySupervisorServiceHealth;
  detail: string;
  restart_count: number;
  error_count: number;
  last_check_at: string | null;
  last_healthy_at: string | null;
  last_restart_at: string | null;
}

export interface AutonomySupervisorAction {
  at: string;
  service: string;
  action: "HEAL_START";
  success: boolean;
  detail: string;
}

export interface AutonomySupervisorSnapshot {
  running: boolean;
  tick_in_flight: boolean;
  interval_ms: number;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_duration_ms: number | null;
  last_error: string | null;
  consecutive_failures: number;
  total_ticks: number;
  total_heal_actions: number;
  policy: {
    auto_heal: boolean;
    interval_ms: number;
    services: Record<string, boolean>;
  };
  services: AutonomySupervisorServiceSnapshot[];
  recent_actions: AutonomySupervisorAction[];
}

export function useAutonomySupervisorStatus(options?: Omit<UseQueryOptions<AutonomySupervisorSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["brain", "autonomy", "supervisor", "status"],
    queryFn: () => apiFetch<AutonomySupervisorSnapshot>("/brain/autonomy/supervisor/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartAutonomySupervisor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        snapshot: AutonomySupervisorSnapshot;
      }>("/brain/autonomy/supervisor/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "supervisor"] });
    },
  });
}

export function useStopAutonomySupervisor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: AutonomySupervisorSnapshot;
      }>("/brain/autonomy/supervisor/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "supervisor"] });
    },
  });
}

export function useRunAutonomySupervisorTick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: AutonomySupervisorSnapshot;
      }>("/brain/autonomy/supervisor/tick", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "supervisor"] });
    },
  });
}

export interface StrategyGovernorAction {
  at: string;
  strategy_id: string;
  action: "WALK_FORWARD" | "OVERRIDE_TIER" | "SKIP";
  before_tier: string;
  proposed_tier: string;
  final_tier: string;
  reason: string;
}

export interface StrategyGovernorSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  last_validation_status: "INSUFFICIENT" | "HEALTHY" | "WATCH" | "DRIFT" | "CRITICAL" | null;
  last_validation_generated_at: string | null;
  last_supervisor_health_ratio: number;
  policy: {
    auto_enforce: boolean;
    interval_ms: number;
    max_strategies_per_cycle: number;
    min_group_samples: number;
    max_validation_staleness_ms: number;
  };
  evaluated_strategies: string[];
  recent_actions: StrategyGovernorAction[];
}

export function useStrategyGovernorStatus(options?: Omit<UseQueryOptions<StrategyGovernorSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["brain", "strategy", "governor", "status"],
    queryFn: () => apiFetch<StrategyGovernorSnapshot>("/brain/strategy/governor/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartStrategyGovernor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        snapshot: StrategyGovernorSnapshot;
      }>("/brain/strategy/governor/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "governor"] });
    },
  });
}

export function useStopStrategyGovernor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: StrategyGovernorSnapshot;
      }>("/brain/strategy/governor/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "governor"] });
    },
  });
}

export function useRunStrategyGovernorCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: StrategyGovernorSnapshot;
      }>("/brain/strategy/governor/run-once", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "governor"] });
    },
  });
}

export interface StrategyEvolutionAction {
  at: string;
  strategy_id: string;
  action: "START_CONTINUOUS" | "WALK_FORWARD" | "OPTIMIZE" | "SKIP";
  success: boolean;
  detail: string;
}

export interface StrategyEvolutionSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  policy: {
    auto_enforce: boolean;
    interval_ms: number;
    auto_start_continuous_backtest: boolean;
    max_strategies_per_cycle: number;
    max_optimizations_per_cycle: number;
    min_pass_rate: number;
    min_stability: number;
    optimization_cooldown_ms: number;
  };
  evaluated_strategies: string[];
  optimized_strategies: string[];
  last_candidates: Array<{
    strategy_id: string;
    score: number;
    source: string;
  }>;
  recent_actions: StrategyEvolutionAction[];
}

export function useStrategyEvolutionStatus(options?: Omit<UseQueryOptions<StrategyEvolutionSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["brain", "strategy", "evolution", "status"],
    queryFn: () => apiFetch<StrategyEvolutionSnapshot>("/brain/strategy/evolution/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartStrategyEvolutionScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        snapshot: StrategyEvolutionSnapshot;
      }>("/brain/strategy/evolution/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "evolution"] });
    },
  });
}

export function useStopStrategyEvolutionScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: StrategyEvolutionSnapshot;
      }>("/brain/strategy/evolution/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "evolution"] });
    },
  });
}

export function useRunStrategyEvolutionCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: StrategyEvolutionSnapshot;
      }>("/brain/strategy/evolution/run-once", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "evolution"] });
    },
  });
}

export function useResetStrategyEvolutionScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: StrategyEvolutionSnapshot;
      }>("/brain/strategy/evolution/reset", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "evolution"] });
    },
  });
}

export interface StrategyAllocationEntry {
  strategy_id: string;
  setup_type: string | null;
  regime: string | null;
  symbol: string | null;
  tier: "SEED" | "LEARNING" | "PROVEN" | "ELITE" | "DEGRADING" | "SUSPENDED";
  validation_status: "INSUFFICIENT" | "HEALTHY" | "WATCH" | "DRIFT" | "CRITICAL";
  sample_count: number;
  score: number;
  multiplier: number;
  risk_budget_pct: number;
  source: "TIER" | "VALIDATION" | "HYBRID" | "FALLBACK";
  notes: string[];
  updated_at: string;
}

export interface StrategyAllocatorSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  interval_ms: number;
  last_validation_status: "INSUFFICIENT" | "HEALTHY" | "WATCH" | "DRIFT" | "CRITICAL" | null;
  last_validation_generated_at: string | null;
  policy: {
    auto_enforce: boolean;
    interval_ms: number;
    max_validation_staleness_ms: number;
    min_validation_samples: number;
    base_risk_pct: number;
    min_multiplier: number;
    max_multiplier: number;
    suspend_multiplier: number;
  };
  allocation_count: number;
  top_allocations: StrategyAllocationEntry[];
  allocations: StrategyAllocationEntry[];
}

export interface StrategyAllocationMatch {
  matched: boolean;
  match_level: "EXACT" | "SETUP_REGIME" | "SETUP_ONLY" | "REGIME_ONLY" | "GLOBAL" | "NONE";
  strategy_id: string | null;
  multiplier: number;
  score: number;
  tier: "SEED" | "LEARNING" | "PROVEN" | "ELITE" | "DEGRADING" | "SUSPENDED" | null;
  risk_budget_pct: number;
  source: "TIER" | "VALIDATION" | "HYBRID" | "FALLBACK" | "DEFAULT";
}

export function useStrategyAllocatorStatus(options?: Omit<UseQueryOptions<StrategyAllocatorSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["brain", "strategy", "allocator", "status"],
    queryFn: () => apiFetch<StrategyAllocatorSnapshot>("/brain/strategy/allocator/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartStrategyAllocator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        snapshot: StrategyAllocatorSnapshot;
      }>("/brain/strategy/allocator/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "allocator"] });
    },
  });
}

export function useStopStrategyAllocator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: StrategyAllocatorSnapshot;
      }>("/brain/strategy/allocator/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "allocator"] });
    },
  });
}

export function useRunStrategyAllocatorCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: StrategyAllocatorSnapshot;
      }>("/brain/strategy/allocator/run-once", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "allocator"] });
    },
  });
}

export interface ProductionWatchdogAction {
  at: string;
  cycle_reason: string;
  action: "WARN_DEGRADED" | "ESCALATE_NOT_READY" | "PAUSE_AUTONOMY" | "ENGAGE_KILL_SWITCH" | "RECOVERED";
  success: boolean;
  detail: string;
}

export interface ExecutionSafetySupervisorAction {
  at: string;
  cycle_reason: string;
  action: "EVALUATE" | "ALERT_WARN_STREAK" | "ALERT_BLOCK_STREAK" | "ENGAGE_KILL_SWITCH" | "RECOVERED";
  success: boolean;
  detail: string;
}

export interface ExecutionSafetySupervisorSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  consecutive_warn: number;
  consecutive_blocked: number;
  last_summary: {
    autonomy_action: "ALLOW" | "WARN" | "BLOCK";
    market_action: "ALLOW" | "WARN" | "BLOCK" | null;
    portfolio_state: "NORMAL" | "ELEVATED" | "CRITICAL" | "HALT" | null;
    incident_level: "NORMAL" | "WATCH" | "HALT";
    incident_halt: boolean;
    blocked_reasons: string[];
    warning_reasons: string[];
  } | null;
  policy: {
    auto_enforce: boolean;
    interval_ms: number;
    heartbeat_symbol: string;
    include_market_guard: boolean;
    include_portfolio_risk: boolean;
    auto_heal_autonomy: boolean;
    warn_alert_threshold: number;
    block_alert_threshold: number;
    auto_kill_switch_on_block: boolean;
  };
  recent_actions: ExecutionSafetySupervisorAction[];
}

export function useExecutionSafetySupervisorStatus(
  options?: Omit<UseQueryOptions<ExecutionSafetySupervisorSnapshot>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["brain", "execution", "safety-supervisor", "status"],
    queryFn: () => apiFetch<ExecutionSafetySupervisorSnapshot>("/brain/execution/safety-supervisor/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartExecutionSafetySupervisor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean; heartbeat_symbol?: string }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        heartbeat_symbol: string;
        snapshot: ExecutionSafetySupervisorSnapshot;
      }>("/brain/execution/safety-supervisor/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "execution", "safety-supervisor"] });
      qc.invalidateQueries({ queryKey: ["execution", "autonomy-guard"] });
      qc.invalidateQueries({ queryKey: ["execution", "market-guard"] });
    },
  });
}

export function useStopExecutionSafetySupervisor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: ExecutionSafetySupervisorSnapshot;
      }>("/brain/execution/safety-supervisor/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "execution", "safety-supervisor"] });
    },
  });
}

export function useRunExecutionSafetySupervisorCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: ExecutionSafetySupervisorSnapshot;
      }>("/brain/execution/safety-supervisor/run-once", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "execution", "safety-supervisor"] });
      qc.invalidateQueries({ queryKey: ["execution", "autonomy-guard"] });
      qc.invalidateQueries({ queryKey: ["execution", "market-guard"] });
    },
  });
}

export function useResetExecutionSafetySupervisor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: ExecutionSafetySupervisorSnapshot;
      }>("/brain/execution/safety-supervisor/reset", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "execution", "safety-supervisor"] });
    },
  });
}

export interface ProductionWatchdogSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  consecutive_not_ready: number;
  consecutive_degraded: number;
  escalation_active: boolean;
  last_status: "READY" | "DEGRADED" | "NOT_READY" | null;
  last_report_at: string | null;
  last_report_summary: {
    failed_critical: number;
    failed_non_critical: number;
  };
  policy: {
    auto_enforce: boolean;
    interval_ms: number;
    include_preflight: boolean;
    not_ready_trip_count: number;
    degraded_warn_count: number;
    auto_pause_autonomy: boolean;
    auto_kill_switch: boolean;
  };
  recent_actions: ProductionWatchdogAction[];
}

export function useProductionWatchdogStatus(
  options?: Omit<UseQueryOptions<ProductionWatchdogSnapshot>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["brain", "production", "watchdog", "status"],
    queryFn: () => apiFetch<ProductionWatchdogSnapshot>("/brain/production/watchdog/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartProductionWatchdog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        snapshot: ProductionWatchdogSnapshot;
      }>("/brain/production/watchdog/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "production", "watchdog"] });
    },
  });
}

export function useStopProductionWatchdog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: ProductionWatchdogSnapshot;
      }>("/brain/production/watchdog/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "production", "watchdog"] });
    },
  });
}

export function useRunProductionWatchdogCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: ProductionWatchdogSnapshot;
      }>("/brain/production/watchdog/run-once", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "production", "watchdog"] });
    },
  });
}

export function useResetProductionWatchdog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: ProductionWatchdogSnapshot;
      }>("/brain/production/watchdog/reset", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "production", "watchdog"] });
    },
  });
}

export interface AutonomyDebugServiceState {
  name:
    | "autonomy_supervisor"
    | "strategy_governor"
    | "strategy_allocator"
    | "strategy_evolution"
    | "production_watchdog"
    | "execution_safety_supervisor";
  expected: boolean;
  running: boolean;
  last_error: string | null;
  last_cycle_at: string | null;
  detail: string;
}

export interface AutonomyDebugIssue {
  code: string;
  severity: "warn" | "critical";
  summary: string;
  detail: string;
  recommendation: string;
}

export interface AutonomyDebugSnapshot {
  generated_at: string;
  overall_status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  readiness_status: "READY" | "DEGRADED" | "NOT_READY";
  readiness_summary: {
    failed_critical: number;
    failed_non_critical: number;
  };
  kill_switch_active: boolean;
  supervisor_health: {
    expected_services: number;
    healthy_services: number;
    ratio: number;
  };
  services: AutonomyDebugServiceState[];
  issues: AutonomyDebugIssue[];
  recommendations: string[];
}

export interface AutonomyDebugFixAction {
  service:
    | "autonomy_supervisor"
    | "strategy_governor"
    | "strategy_allocator"
    | "strategy_evolution"
    | "production_watchdog"
    | "execution_safety_supervisor";
  attempted: boolean;
  success: boolean;
  detail: string;
}

export interface AutonomyDebugSchedulerAction {
  at: string;
  cycle_reason: string;
  action: "EVALUATE" | "AUTO_FIX" | "ALERT_CRITICAL_STREAK" | "ENGAGE_KILL_SWITCH" | "RECOVERED";
  success: boolean;
  detail: string;
}

export interface AutonomyDebugSchedulerSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  total_fix_actions: number;
  interval_ms: number;
  consecutive_critical: number;
  last_status: "HEALTHY" | "DEGRADED" | "CRITICAL" | null;
  last_issue_count: number;
  last_critical_issues: number;
  last_warn_issues: number;
  kill_switch_active: boolean;
  kill_switch_engaged_by_scheduler: boolean;
  policy: {
    auto_enforce: boolean;
    interval_ms: number;
    include_preflight: boolean;
    auto_fix_on_degraded: boolean;
    auto_fix_on_critical: boolean;
    critical_alert_threshold: number;
    auto_kill_switch_on_critical_streak: boolean;
    kill_switch_threshold: number;
  };
  recent_actions: AutonomyDebugSchedulerAction[];
}

export function useAutonomyDebugSnapshot(
  params?: { include_preflight?: boolean; refresh?: boolean },
  options?: Omit<UseQueryOptions<AutonomyDebugSnapshot>, "queryKey" | "queryFn">,
) {
  const query = new URLSearchParams();
  if (params?.include_preflight) query.set("include_preflight", "true");
  if (params?.refresh) query.set("refresh", "true");
  const qs = query.toString();
  return useQuery({
    queryKey: ["brain", "autonomy", "debug", qs],
    queryFn: () => apiFetch<AutonomyDebugSnapshot>(`/brain/autonomy/debug${qs ? `?${qs}` : ""}`),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useRunAutonomyDebugFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { include_preflight?: boolean; force_refresh?: boolean }) =>
      apiFetch<{
        ok: boolean;
        fixes: AutonomyDebugFixAction[];
        snapshot: AutonomyDebugSnapshot;
      }>("/brain/autonomy/debug/fix", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug"] });
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "supervisor"] });
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "governor"] });
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "allocator"] });
      qc.invalidateQueries({ queryKey: ["brain", "strategy", "evolution"] });
      qc.invalidateQueries({ queryKey: ["brain", "production", "watchdog"] });
    },
  });
}

export function useAutonomyDebugSchedulerStatus(
  options?: Omit<UseQueryOptions<AutonomyDebugSchedulerSnapshot>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["brain", "autonomy", "debug", "scheduler", "status"],
    queryFn: () => apiFetch<AutonomyDebugSchedulerSnapshot>("/brain/autonomy/debug/scheduler/status"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useStartAutonomyDebugScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { interval_ms?: number; run_immediate?: boolean }) =>
      apiFetch<{
        success: boolean;
        message: string;
        interval_ms: number;
        snapshot: AutonomyDebugSchedulerSnapshot;
      }>("/brain/autonomy/debug/scheduler/start", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug", "scheduler"] });
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug"] });
    },
  });
}

export function useStopAutonomyDebugScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        message: string;
        snapshot: AutonomyDebugSchedulerSnapshot;
      }>("/brain/autonomy/debug/scheduler/stop", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug", "scheduler"] });
    },
  });
}

export function useRunAutonomyDebugSchedulerCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: AutonomyDebugSchedulerSnapshot;
      }>("/brain/autonomy/debug/scheduler/run-once", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug", "scheduler"] });
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug"] });
    },
  });
}

export function useResetAutonomyDebugScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        snapshot: AutonomyDebugSchedulerSnapshot;
      }>("/brain/autonomy/debug/scheduler/reset", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug", "scheduler"] });
      qc.invalidateQueries({ queryKey: ["brain", "autonomy", "debug"] });
    },
  });
}

export function useStrategyAllocationLookup(
  input: { setup_type?: string; regime?: string; symbol?: string },
  options?: Omit<UseQueryOptions<StrategyAllocationMatch>, "queryKey" | "queryFn">,
) {
  const params = new URLSearchParams();
  if (input.setup_type) params.set("setup_type", input.setup_type);
  if (input.regime) params.set("regime", input.regime);
  if (input.symbol) params.set("symbol", input.symbol);
  const query = params.toString();
  return useQuery({
    queryKey: ["brain", "strategy", "allocator", "lookup", query],
    queryFn: () => apiFetch<StrategyAllocationMatch>(`/brain/strategy/allocator/lookup${query ? `?${query}` : ""}`),
    enabled: Boolean(input.setup_type || input.regime || input.symbol),
    refetchInterval: 15_000,
    ...options,
  });
}

export interface ExecutionIncidentEvent {
  at: string;
  symbol: string;
  type: "EXECUTION_OK" | "ORDER_REJECTED" | "ORDER_ERROR" | "EXECUTION_BLOCKED" | "SLIPPAGE_SPIKE" | "GUARD_RESET" | "GUARD_HALT";
  severity: "info" | "warn" | "critical";
  detail: string;
  mode?: string;
  reason?: string;
  slippage_bps?: number;
}

export interface ExecutionIncidentSnapshot {
  level: "NORMAL" | "WATCH" | "HALT";
  halt_active: boolean;
  running_window_ms: number;
  consecutive_failures: number;
  window_failures: number;
  window_rejections: number;
  window_slippage_spikes: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  policy: {
    window_ms: number;
    max_failures_window: number;
    max_rejections_window: number;
    max_consecutive_failures: number;
    max_slippage_bps: number;
    max_slippage_spikes_window: number;
    auto_halt: boolean;
  };
  recent_events: ExecutionIncidentEvent[];
}

export function useExecutionIncidentGuard(options?: Omit<UseQueryOptions<ExecutionIncidentSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["execution", "incident-guard"],
    queryFn: () => apiFetch<ExecutionIncidentSnapshot>("/execution/incident-guard"),
    refetchInterval: 10_000,
    ...options,
  });
}

export interface ExecutionMarketGuardEvent {
  at: string;
  symbol: string;
  asset_class: "equity" | "crypto" | "futures";
  type: "EVAL_ALLOW" | "EVAL_WARN" | "EVAL_BLOCK" | "GUARD_HALT" | "GUARD_RESET";
  severity: "info" | "warn" | "critical";
  detail: string;
  reasons: string[];
  metrics?: {
    spread_bps?: number | null;
    top_book_notional_usd?: number | null;
    bar_age_ms?: number | null;
    rv_1m_pct?: number | null;
  };
}

export interface ExecutionMarketGuardSnapshot {
  level: "NORMAL" | "WATCH" | "HALT";
  halt_active: boolean;
  running_window_ms: number;
  consecutive_critical: number;
  window_critical: number;
  window_warn: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  policy: {
    window_ms: number;
    max_critical_window: number;
    max_warning_window: number;
    max_consecutive_critical: number;
    auto_halt: boolean;
    sync_kill_switch_on_halt: boolean;
    fetch_orderbook_on_demand: boolean;
    require_orderbook_for_crypto: boolean;
    require_orderbook_for_other_assets: boolean;
    max_orderbook_age_ms: number;
    max_bar_age_ms: number;
    max_spread_bps: number;
    hard_max_spread_bps: number;
    min_top_book_notional_usd: number;
    max_atr_pct_1m: number;
    max_realized_vol_pct_1m: number;
    bar_lookback: number;
  };
  last_evaluation: {
    at: string | null;
    symbol: string | null;
    asset_class: "equity" | "crypto" | "futures" | null;
    action: "ALLOW" | "WARN" | "BLOCK";
    allowed: boolean;
    reasons: string[];
    metrics: {
      orderbook_available: boolean;
      orderbook_age_ms: number | null;
      spread_bps: number | null;
      top_book_notional_usd: number | null;
      bar_age_ms: number | null;
      atr_pct_1m: number | null;
      rv_1m_pct: number | null;
    } | null;
  };
  recent_events: ExecutionMarketGuardEvent[];
}

export function useExecutionMarketGuard(options?: Omit<UseQueryOptions<ExecutionMarketGuardSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["execution", "market-guard"],
    queryFn: () => apiFetch<ExecutionMarketGuardSnapshot>("/execution/market-guard"),
    refetchInterval: 10_000,
    ...options,
  });
}

export interface ExecutionAutonomyGuardEvent {
  at: string;
  symbol: string;
  type: "EVAL_ALLOW" | "EVAL_WARN" | "EVAL_BLOCK" | "GUARD_HALT" | "GUARD_RESET" | "AUTO_HEAL_ATTEMPT" | "AUTO_HEAL_RECOVERED";
  severity: "info" | "warn" | "critical";
  detail: string;
  reasons: string[];
}

export interface ExecutionAutonomyGuardSnapshot {
  level: "NORMAL" | "WATCH" | "HALT";
  halt_active: boolean;
  running_window_ms: number;
  consecutive_blocks: number;
  window_blocks: number;
  window_warn: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  policy: {
    window_ms: number;
    max_blocks_window: number;
    max_warn_window: number;
    max_consecutive_blocks: number;
    auto_halt: boolean;
    sync_kill_switch_on_halt: boolean;
    require_autonomy_supervisor_running: boolean;
    require_scheduler_running: boolean;
    require_watchdog_running: boolean;
    block_on_scheduler_critical: boolean;
    block_on_scheduler_degraded: boolean;
    scheduler_critical_streak_threshold: number;
    warn_on_scheduler_degraded: boolean;
    block_on_watchdog_not_ready: boolean;
    block_on_watchdog_degraded: boolean;
    warn_on_watchdog_degraded: boolean;
    block_on_watchdog_escalation: boolean;
    auto_run_scheduler_cycle_on_block: boolean;
  };
  last_evaluation: {
    at: string | null;
    symbol: string | null;
    action: "ALLOW" | "WARN" | "BLOCK";
    allowed: boolean;
    reasons: string[];
    status: {
      supervisor_running: boolean;
      scheduler_running: boolean;
      scheduler_cycle_in_flight: boolean;
      scheduler_last_status: "HEALTHY" | "DEGRADED" | "CRITICAL" | null;
      scheduler_consecutive_critical: number;
      watchdog_running: boolean;
      watchdog_last_status: "READY" | "DEGRADED" | "NOT_READY" | null;
      watchdog_escalation_active: boolean;
    } | null;
  };
  recent_events: ExecutionAutonomyGuardEvent[];
}

export function useExecutionAutonomyGuard(options?: Omit<UseQueryOptions<ExecutionAutonomyGuardSnapshot>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["execution", "autonomy-guard"],
    queryFn: () => apiFetch<ExecutionAutonomyGuardSnapshot>("/execution/autonomy-guard"),
    refetchInterval: 10_000,
    ...options,
  });
}

export function useResetExecutionAutonomyGuard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { reason?: string; clear_kill_switch?: boolean }) =>
      apiFetch<ExecutionAutonomyGuardSnapshot>("/execution/autonomy-guard/reset", {
        method: "POST",
        body: JSON.stringify(params ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["execution", "autonomy-guard"] });
      qc.invalidateQueries({ queryKey: ["execution", "incident-guard"] });
      qc.invalidateQueries({ queryKey: ["execution", "market-guard"] });
    },
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

export interface LiveMicrostructureOrderbookLevel {
  price: number;
  size: number;
  cumulative_size: number;
  notional_usd: number;
}

export interface LiveMicrostructureOrderbook {
  symbol: string;
  timestamp: string;
  received_at: number;
  source: "rest" | "ws";
  depth: number;
  best_bid: number | null;
  best_ask: number | null;
  mid_price: number | null;
  spread: number | null;
  spread_bps: number | null;
  bid_levels: LiveMicrostructureOrderbookLevel[];
  ask_levels: LiveMicrostructureOrderbookLevel[];
  total_bid_size: number;
  total_ask_size: number;
  total_bid_notional: number;
  total_ask_notional: number;
}

export interface LiveMicrostructureImbalance {
  top_levels: number;
  touch_imbalance: number;
  depth_imbalance: number;
  weighted_imbalance: number;
  top_bid_volume: number;
  top_ask_volume: number;
  score: number;
  bias: "buy" | "sell" | "neutral";
}

export interface LiveMicrostructureAbsorption {
  state: "bid_absorption" | "ask_absorption" | "none";
  score: number;
  confidence: number;
  persistence: number;
  mid_drift_bps: number;
  spread_bps: number;
  reason: string;
}

export interface LiveMicrostructureHeatmapZone {
  price_start: number;
  price_end: number;
  side: "bid" | "ask";
  strength: number;
  intensity: number;
  distance_bps: number;
  type: "absorption" | "aggression" | "vacuum" | "rotation";
}

export interface LiveMicrostructureHeatmap {
  generated_at: string;
  bucket_pct: number;
  top_n: number;
  zone_score: number;
  zones: LiveMicrostructureHeatmapZone[];
}

export interface LiveMicrostructureTapePrint {
  price: number;
  size: number;
  notional_usd: number;
  timestamp: string;
  side: "buy" | "sell";
  aggressor: boolean;
}

export interface LiveMicrostructureTape {
  generated_at: string;
  window_sec: number;
  print_count: number;
  buy_volume: number;
  sell_volume: number;
  buy_notional: number;
  sell_notional: number;
  delta_volume: number;
  delta_notional: number;
  normalized_delta: number;
  burst_score: number;
  score: number;
  bias: "buy" | "sell" | "neutral";
  prints: LiveMicrostructureTapePrint[];
}

export interface LiveMicrostructureScore {
  score: number;
  confidence: number;
  quality: "high" | "medium" | "low";
  direction: "long" | "short" | "flat";
  verdict:
    | "high_conviction_long"
    | "high_conviction_short"
    | "tradable_long"
    | "tradable_short"
    | "neutral"
    | "avoid";
  reasons: string[];
  components: {
    imbalance: number;
    absorption: number;
    liquidity: number;
    tape: number;
    spread_quality: number;
  };
}

export interface LiveMicrostructureEvent {
  id: string;
  symbol: string;
  type: "imbalance_shift" | "bid_absorption" | "ask_absorption" | "liquidity_vacuum" | "aggressive_tape" | "score_spike";
  direction: "long" | "short" | "neutral";
  strength: number;
  detail: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface LiveMicrostructureSnapshot {
  symbol: string;
  generated_at: string;
  orderbook: LiveMicrostructureOrderbook;
  imbalance: LiveMicrostructureImbalance;
  absorption: LiveMicrostructureAbsorption;
  heatmap: LiveMicrostructureHeatmap;
  tape: LiveMicrostructureTape;
  score: LiveMicrostructureScore;
}

export interface LiveMicrostructureCurrentResponse {
  symbol: string;
  generated_at: string;
  snapshot: LiveMicrostructureSnapshot;
  emitted_events: LiveMicrostructureEvent[];
  status: {
    symbols: number;
    snapshot_count: number;
    event_count: number;
    symbol?: string;
  };
}

export interface LiveMicrostructureReplayResponse {
  symbol: string;
  replay_window: {
    start: string;
    end: string;
    duration_ms: number;
  };
  replay: {
    symbol: string;
    start: string;
    end: string;
    durationMs: number;
    stats: {
      rawFrames: number;
      rawTicks: number;
      emittedFrames: number;
      emittedTicks: number;
      frameCompressionRatio: number;
      tickCompressionRatio: number;
      downsampleMs: number | null;
    };
    frames: Array<{
      symbol: string;
      timestamp: string;
      receivedAt: number;
      source: "rest" | "ws";
      bestBid: number | null;
      bestAsk: number | null;
      spread: number | null;
      bids: Array<{ price: number; size: number }>;
      asks: Array<{ price: number; size: number }>;
    }>;
    ticks: Array<{
      symbol: string;
      price: number;
      size: number;
      timestamp: string;
      receivedAt: number;
      source: "ws_trade" | "poll_trade";
    }>;
  };
  microstructure_events: LiveMicrostructureEvent[];
  snapshots: LiveMicrostructureSnapshot[];
  status: {
    symbols: number;
    snapshot_count: number;
    event_count: number;
    symbol?: string;
  };
}

function toSearchParams(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    query.set(key, String(value));
  }
  const raw = query.toString();
  return raw ? `?${raw}` : "";
}

export function useLiveMicrostructureCurrent(
  symbol: string,
  options?: {
    depth?: number;
    top_levels?: number;
    window_sec?: number;
    force_fresh?: boolean;
    max_age_ms?: number;
  },
  queryOptions?: Omit<UseQueryOptions<LiveMicrostructureCurrentResponse, Error>, "queryKey" | "queryFn">,
) {
  const params = toSearchParams(options ?? {});
  return useQuery({
    queryKey: ["microstructure", "current", symbol, params],
    queryFn: () => apiFetch<LiveMicrostructureCurrentResponse>(`/microstructure/${encodeURIComponent(symbol)}/current${params}`),
    enabled: !!symbol,
    refetchInterval: 5_000,
    staleTime: 2_500,
    ...queryOptions,
  });
}

export function useLiveMicrostructureOrderbook(
  symbol: string,
  options?: { depth?: number; top_levels?: number; force_fresh?: boolean; max_age_ms?: number },
) {
  const params = toSearchParams(options ?? {});
  return useQuery({
    queryKey: ["microstructure", "orderbook", symbol, params],
    queryFn: () => apiFetch<{
      symbol: string;
      generated_at: string;
      orderbook: LiveMicrostructureOrderbook;
      imbalance: LiveMicrostructureImbalance;
      absorption: LiveMicrostructureAbsorption;
    }>(`/microstructure/${encodeURIComponent(symbol)}/orderbook${params}`),
    enabled: !!symbol,
    refetchInterval: 5_000,
  });
}

export function useLiveMicrostructureHeatmap(
  symbol: string,
  options?: { depth?: number; bucket_pct?: number; top_n?: number; force_fresh?: boolean; max_age_ms?: number },
) {
  const params = toSearchParams(options ?? {});
  return useQuery({
    queryKey: ["microstructure", "heatmap", symbol, params],
    queryFn: () => apiFetch<{
      symbol: string;
      generated_at: string;
      heatmap: LiveMicrostructureHeatmap;
      orderbook_mid_price: number | null;
    }>(`/microstructure/${encodeURIComponent(symbol)}/heatmap${params}`),
    enabled: !!symbol,
    refetchInterval: 6_000,
  });
}

export function useLiveMicrostructureTape(
  symbol: string,
  options?: { depth?: number; window_sec?: number; force_fresh?: boolean; max_age_ms?: number },
) {
  const params = toSearchParams(options ?? {});
  return useQuery({
    queryKey: ["microstructure", "tape", symbol, params],
    queryFn: () => apiFetch<{ symbol: string; generated_at: string; tape: LiveMicrostructureTape }>(`/microstructure/${encodeURIComponent(symbol)}/tape${params}`),
    enabled: !!symbol,
    refetchInterval: 5_000,
  });
}

export function useLiveMicrostructureEvents(symbol: string, limit = 150) {
  return useQuery({
    queryKey: ["microstructure", "events", symbol, limit],
    queryFn: () => apiFetch<{
      symbol: string;
      count: number;
      events: LiveMicrostructureEvent[];
      status: { symbols: number; snapshot_count: number; event_count: number; symbol?: string };
    }>(`/microstructure/${encodeURIComponent(symbol)}/events?limit=${limit}`),
    enabled: !!symbol,
    refetchInterval: 7_500,
  });
}

export function useLiveMicrostructureScore(
  symbol: string,
  options?: { depth?: number; top_levels?: number; window_sec?: number; force_fresh?: boolean; max_age_ms?: number },
) {
  const params = toSearchParams(options ?? {});
  return useQuery({
    queryKey: ["microstructure", "score", symbol, params],
    queryFn: () => apiFetch<{
      symbol: string;
      generated_at: string;
      score: LiveMicrostructureScore;
      imbalance: LiveMicrostructureImbalance;
      absorption: LiveMicrostructureAbsorption;
      tape_summary: { score: number; bias: "buy" | "sell" | "neutral"; normalized_delta: number };
      heatmap_summary: { zone_score: number; zones: number };
    }>(`/microstructure/${encodeURIComponent(symbol)}/score${params}`),
    enabled: !!symbol,
    refetchInterval: 5_000,
  });
}

export function useMicrostructureReplay() {
  return useMutation({
    mutationFn: (params: {
      symbol: string;
      start?: string | number;
      end?: string | number;
      downsample_ms?: number;
      max_frames?: number;
      max_ticks?: number;
      include_ticks?: boolean;
      snapshot_limit?: number;
    }) => apiFetch<LiveMicrostructureReplayResponse>(`/microstructure/${encodeURIComponent(params.symbol)}/replay`, {
      method: "POST",
      body: JSON.stringify({
        start: params.start,
        end: params.end,
        downsample_ms: params.downsample_ms,
        max_frames: params.max_frames,
        max_ticks: params.max_ticks,
        include_ticks: params.include_ticks,
        snapshot_limit: params.snapshot_limit,
      }),
    }),
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

// ─── Brain Nodes (Live Intelligence Core) ───────────────────────────────────
export type BrainNodeStatus = "READY" | "WATCH" | "BLOCKED" | "STALE" | "SCANNING";

export interface BrainNode {
  symbol: string;
  name: string | null;
  sector: string | null;
  regime: string | null;
  status: BrainNodeStatus;
  confidence_score: number;
  opportunity_score: number;
  urgency_score: number;
  attention_score: number;
  capital_priority_score: number;
  node_health: "live" | "degraded" | "stale";
  last_signal_at: string | null;
  last_updated_at: string;
  risk_flags: string[];
  latest_signal: {
    setup_type: string;
    direction: string;
    approved: boolean;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    kelly_fraction: number;
    confluence_score: number;
    rejection_reason: string | null;
    gate_action: string | null;
    gate_block_reasons: string | null;
  } | null;
}

export interface BrainNodeCluster {
  key: string;
  label: string;
  count: number;
  avg_opportunity: number;
  avg_confidence: number;
  symbols: string[];
}

export interface BrainNodeRelation {
  id: number;
  source_symbol: string;
  target_symbol: string;
  relation_type: string;
  strength: number;
  context_json: string | null;
  created_at: string;
}

export interface BrainNodeDrilldown {
  node: BrainNode;
  memories: Array<{
    id: number;
    memory_type: string;
    title: string;
    content: string;
    confidence: number;
    outcome_score: number | null;
    tags: string | null;
    created_at: string;
  }>;
  relationships: BrainNodeRelation[];
  recent_events: Array<{
    id: number;
    event_type: string;
    decision_state: string | null;
    reason: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  recent_decisions: Array<{
    id: number;
    setup_type: string;
    direction: string;
    regime: string;
    approved: boolean;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    kelly_fraction: number;
    confluence_score: number;
    gate_action: string | null;
    gate_block_reasons: string | null;
    rejection_reason: string | null;
    created_at: string;
  }>;
  layer_scores: {
    structure: number;
    microstructure: number;
    recall: number;
    intelligence: number;
    risk: number;
  };
}

export function useBrainNodes(limit = 120) {
  return useQuery({
    queryKey: ["brain", "nodes", limit],
    queryFn: () => apiFetch<{ count: number; nodes: BrainNode[]; generated_at: string }>(`/brain/nodes?limit=${limit}`),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export function useBrainNode(symbol: string) {
  return useQuery({
    queryKey: ["brain", "node", symbol],
    queryFn: () => apiFetch<{ node: BrainNode }>(`/brain/nodes/${encodeURIComponent(symbol)}`),
    enabled: !!symbol,
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export function useBrainNodeDrilldown(symbol: string) {
  return useQuery({
    queryKey: ["brain", "node", symbol, "drilldown"],
    queryFn: () => apiFetch<BrainNodeDrilldown>(`/brain/nodes/${encodeURIComponent(symbol)}/drilldown`),
    enabled: !!symbol,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
}

export function useBrainNodeClusters(limit = 120) {
  return useQuery({
    queryKey: ["brain", "clusters", limit],
    queryFn: () => apiFetch<{ by_sector: BrainNodeCluster[]; by_regime: BrainNodeCluster[]; by_status: BrainNodeCluster[]; generated_at: string }>(`/brain/clusters?limit=${limit}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useBrainNodeRelationships(symbol?: string, limit = 250) {
  const query = new URLSearchParams();
  if (symbol) query.set("symbol", symbol);
  if (limit) query.set("limit", String(limit));
  const qs = query.toString();

  return useQuery({
    queryKey: ["brain", "relationships", symbol ?? "all", limit],
    queryFn: () => apiFetch<{ count: number; relationships: BrainNodeRelation[]; generated_at: string }>(`/brain/relationships${qs ? `?${qs}` : ""}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

// ─── Portfolio Allocator (Capital Routing) ──────────────────────────────────
export interface PortfolioAllocatorPolicy {
  account_equity: number;
  max_total_risk_pct: number;
  max_positions: number;
  max_new_allocations: number;
  max_symbol_exposure_pct: number;
  min_expected_value: number;
  min_risk_pct_per_trade: number;
  max_risk_pct_per_trade: number;
}

export interface PortfolioOpportunity {
  decision_id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  direction: string;
  strategy_id: string;
  approved: boolean;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  suggested_qty: number;
  win_probability: number;
  final_quality: number;
  edge_score: number;
  kelly_fraction: number;
  confluence_score: number;
  expected_value: number;
  rr_ratio: number;
  recency_score: number;
  base_score: number;
  adjusted_score: number;
  strategy_multiplier: number;
  recommended_risk_pct: number;
  created_at: string;
}

export interface PortfolioExposureSnapshot {
  open_positions: number;
  long_positions: number;
  short_positions: number;
  gross_notional_usd: number;
  net_notional_usd: number;
  open_risk_usd: number;
  open_risk_pct: number;
  by_symbol: Array<{ symbol: string; notional_usd: number; pct_of_equity: number }>;
}

export interface PortfolioAllocationEntry {
  decision_id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  direction: string;
  strategy_id: string;
  score: number;
  expected_value: number;
  risk_pct: number;
  risk_usd: number;
  notional_usd: number;
  quantity: number;
  rationale: string[];
}

export interface PortfolioAllocatorSnapshot {
  generated_at: string;
  cycle_reason: string;
  policy: PortfolioAllocatorPolicy;
  exposure: PortfolioExposureSnapshot;
  opportunities: PortfolioOpportunity[];
  allocations: PortfolioAllocationEntry[];
  blocked: Array<{ decision_id: number; symbol: string; reason: string }>;
  available_risk_pct: number;
  available_risk_usd: number;
}

export function usePortfolioAllocatorStatus() {
  return useQuery({
    queryKey: ["portfolio", "allocator", "status"],
    queryFn: () => apiFetch<PortfolioAllocatorSnapshot>("/portfolio/allocator/status"),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export function usePortfolioOpportunities() {
  return useQuery({
    queryKey: ["portfolio", "opportunities"],
    queryFn: () => apiFetch<{ count: number; opportunities: PortfolioOpportunity[]; generated_at: string }>("/portfolio/opportunities"),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export function usePortfolioExposures() {
  return useQuery({
    queryKey: ["portfolio", "exposures"],
    queryFn: () => apiFetch<{ exposure: PortfolioExposureSnapshot; available_risk_pct: number; available_risk_usd: number; generated_at: string }>("/portfolio/exposures"),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export function usePortfolioAllocations() {
  return useQuery({
    queryKey: ["portfolio", "allocations"],
    queryFn: () => apiFetch<{ count: number; allocations: PortfolioAllocationEntry[]; blocked: Array<{ decision_id: number; symbol: string; reason: string }>; generated_at: string }>("/portfolio/allocations"),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export function useRunPortfolioAllocator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) =>
      apiFetch<{ ok: boolean; snapshot: PortfolioAllocatorSnapshot }>("/portfolio/allocate", {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function useRebalancePortfolioAllocator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) =>
      apiFetch<{ ok: boolean; snapshot: PortfolioAllocatorSnapshot }>("/portfolio/rebalance", {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

// ─── Decision Replay (Audit Timeline) ───────────────────────────────────────
export interface DecisionReplay {
  trade: {
    id: number;
    symbol: string;
    setup_type: string;
    direction: string;
    entry_price: number;
    exit_price: number;
    stop_loss: number;
    take_profit: number;
    quantity: number;
    pnl: number;
    pnl_pct: number;
    outcome: string;
    created_at: string | null;
    exit_time: string | null;
    regime: string | null;
  };
  signal: {
    id: number;
    status: string;
    final_quality: number;
    structure_score: number;
    order_flow_score: number;
    recall_score: number;
    ml_probability: number;
    claude_score: number;
    created_at: string | null;
  } | null;
  decision: {
    id: number;
    approved: boolean;
    setup_type: string;
    direction: string;
    regime: string;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    confluence_score: number;
    kelly_fraction: number;
    gate_action: string | null;
    gate_block_reasons: string | null;
    rejection_reason: string | null;
    created_at: string | null;
  } | null;
  timeline: Array<{
    stage: string;
    at: string;
    latency_ms_from_prev: number | null;
    source: string;
    details: Record<string, unknown>;
  }>;
}

export function useDecisionReplay(tradeId: number | null) {
  return useQuery({
    queryKey: ["decision-replay", tradeId],
    queryFn: () => apiFetch<DecisionReplay>(`/decision-replay/${tradeId}`),
    enabled: !!tradeId,
    staleTime: 30_000,
  });
}

export function useDecisionReplayTimeline(tradeId: number | null) {
  return useQuery({
    queryKey: ["decision-replay", tradeId, "timeline"],
    queryFn: () => apiFetch<{ trade_id: number; symbol: string; timeline: DecisionReplay["timeline"]; count: number }>(`/decision-replay/${tradeId}/timeline`),
    enabled: !!tradeId,
    staleTime: 30_000,
  });
}

export function useDecisionReplayBlockReasons(hours = 24, limit = 500) {
  return useQuery({
    queryKey: ["decision-replay", "block-reasons", hours, limit],
    queryFn: () => apiFetch<{
      hours: number;
      count: number;
      block_reasons: Array<{
        event_type: string;
        reason: string;
        count: number;
        latest_at: string;
        symbols: string[];
      }>;
      generated_at: string;
    }>(`/decision-replay/block-reasons?hours=${hours}&limit=${limit}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useDecisionReplayLatency(hours = 24, limit = 2000) {
  return useQuery({
    queryKey: ["decision-replay", "latency", hours, limit],
    queryFn: () => apiFetch<{
      hours: number;
      pairs: number;
      latency_ms: {
        min: number;
        p50: number;
        p95: number;
        p99: number;
        max: number;
        avg: number;
      };
      by_bucket: {
        under_1s: number;
        s1_to_3: number;
        s3_to_10: number;
        over_10s: number;
      };
      generated_at: string;
    }>(`/decision-replay/latency?hours=${hours}&limit=${limit}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

// ─── Phase 47: Context Fusion types & hooks ───────────────────────────────────

export interface ContextFusionComponents {
  macroBiasScore: number;
  macroBiasDirection: string;
  macroBiasConviction: string;
  macroBiasAligned: boolean;
  sentimentScore: number;
  sentimentCrowding: string;
  sentimentAligned: boolean;
  eventRiskScore: number;
  eventLockout: boolean;
  highImpactEvents: number;
  regimeScore: number;
  regimeLabel: string;
}

export interface ContextFusionResult {
  fusionScore: number;
  level: "FAVORABLE" | "NEUTRAL" | "CAUTIOUS" | "HOSTILE";
  sizeMultiplier: number;
  blocked: boolean;
  blockReason: string | null;
  components: ContextFusionComponents;
  reasons: string[];
  evaluatedAt: string;
}

export interface ContextFusionSnapshot {
  enabled: boolean;
  blockThreshold: number;
  reduceThreshold: number;
  boostThreshold: number;
  cacheTtlMs: number;
  cacheSize: number;
  totalEvaluations: number;
  blockedCount: number;
  reducedCount: number;
  boostedCount: number;
  lastEvaluation: ContextFusionResult | null;
  lastEvaluatedAt: string | null;
}

export function useContextFusionSnapshot() {
  return useQuery({
    queryKey: ["context-fusion", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: ContextFusionSnapshot }>("/context/fusion/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useContextFusionEvaluate(symbol: string, direction: "long" | "short" = "long", regime?: string) {
  return useQuery({
    queryKey: ["context-fusion", "evaluate", symbol, direction, regime],
    queryFn: () => apiFetch<{ ok: boolean; result: ContextFusionResult }>(
      `/context/fusion/evaluate?symbol=${symbol}&direction=${direction}${regime ? `&regime=${regime}` : ""}`
    ),
    enabled: !!symbol,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useResetContextFusion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/context/fusion/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["context-fusion"] }); },
  });
}

// ─── Phase 48: Adaptive Learning types & hooks ────────────────────────────────

export interface StrategyPerformanceRecord {
  strategyId: string;
  version: number;
  regime: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  lastTradeAt: string;
  updatedAt: string;
}

export interface ChampionChallengerResult {
  championId: string;
  challengerId: string;
  regime: string;
  verdict: "CHAMPION_WINS" | "CHALLENGER_WINS" | "INCONCLUSIVE";
  confidence: number;
  reasons: string[];
  evaluatedAt: string;
}

export interface RetrainTrigger {
  strategyId: string;
  triggerType: string;
  severity: string;
  currentValue: number;
  threshold: number;
  message: string;
  triggeredAt: string;
}

export interface PostTradeAttribution {
  tradeId: string;
  strategyId: string;
  symbol: string;
  direction: string;
  outcome: string;
  pnl: number;
  factors: { name: string; impact: string; weight: number; description: string }[];
  summary: string;
  attributedAt: string;
}

export interface AdaptiveLearningSnapshot {
  enabled: boolean;
  strategies: Record<string, StrategyPerformanceRecord[]>;
  recentTriggers: RetrainTrigger[];
  recentAttributions: PostTradeAttribution[];
  challengerResults: ChampionChallengerResult[];
  retirementCandidates: string[];
  totalTradesAttributed: number;
  totalRetrainTriggersRaised: number;
  lastEvaluatedAt: string | null;
}

export function useAdaptiveLearningSnapshot() {
  return useQuery({
    queryKey: ["adaptive-learning", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: AdaptiveLearningSnapshot }>("/learning/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useCompareStrategies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { champion_id: string; challenger_id: string; regime?: string }) =>
      apiFetch<{ ok: boolean; result: ChampionChallengerResult }>("/learning/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["adaptive-learning"] }); },
  });
}

export function useResetAdaptiveLearning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/learning/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["adaptive-learning"] }); },
  });
}


// ─── Execution Intelligence Types (Phase 49) ──────────────────────────────────

export interface SlippageEstimate {
  symbol: string;
  direction: "long" | "short";
  estimatedBps: number;
  spreadBps: number;
  volumeImpactBps: number;
  volatilityBps: number;
  confidence: number;
  recommendation: "MARKET" | "LIMIT" | "LIMIT_AGGRESSIVE";
  estimatedAt: string;
}

export interface ExitTarget {
  level: number;
  targetPrice: number;
  sizePct: number;
  label: string;
  rMultiple: number;
}

export interface StopPlan {
  initialStop: number;
  trailingEnabled: boolean;
  trailingType: "ATR" | "PERCENTAGE" | "STRUCTURE" | "FIXED";
  atrMultiplier: number;
  currentStop: number;
  migrationHistory: { fromPrice: number; toPrice: number; reason: string; migratedAt: string }[];
}

export interface ExecutionPlan {
  symbol: string;
  direction: "long" | "short";
  orderType: "MARKET" | "LIMIT" | "LIMIT_AGGRESSIVE";
  entryPrice: number;
  limitOffset: number;
  slippageEstimate: SlippageEstimate;
  exitLadder: ExitTarget[];
  stopPlan: StopPlan;
  totalRiskPct: number;
  expectedRR: number;
  planCreatedAt: string;
}

export interface ExecutionQualityReport {
  tradeId: string;
  symbol: string;
  direction: string;
  expectedEntry: number;
  actualEntry: number;
  entrySlippageBps: number;
  expectedExit: number;
  actualExit: number;
  exitSlippageBps: number;
  totalSlippageCost: number;
  fillTimeMs: number;
  orderType: string;
  qualityScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  reportedAt: string;
}

export interface ExecutionIntelligenceSnapshot {
  enabled: boolean;
  totalPlansCreated: number;
  totalQualityReports: number;
  avgSlippageBps: number;
  avgQualityScore: number;
  recentPlans: ExecutionPlan[];
  recentReports: ExecutionQualityReport[];
  stopMigrations: number;
  lastPlanAt: string | null;
}

export function useExecutionIntelligenceSnapshot() {
  return useQuery({
    queryKey: ["execution-intelligence", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: ExecutionIntelligenceSnapshot }>("/execution-intelligence/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useCreateExecutionPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbol: string; direction?: string; currentPrice: number; atr: number; spread?: number; volume24h?: number; stopDistance?: number }) =>
      apiFetch<{ ok: boolean; plan: ExecutionPlan }>("/execution-intelligence/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["execution-intelligence"] }); },
  });
}

export function useResetExecutionIntelligence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/execution-intelligence/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["execution-intelligence"] }); },
  });
}


// ─── Strategy Registry Types (Phase 50) ────────────────────────────────────────

export type StrategyState = "draft" | "parsed" | "backtested" | "stress_tested"
  | "paper_approved" | "live_assisted_approved" | "autonomous_approved" | "retired";

export interface StrategyVersion {
  version: number;
  parameters: Record<string, unknown>;
  changelog: string;
  createdAt: string;
}

export interface StrategyPerformanceMetrics {
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
  netPnl: number;
  lastUpdated: string;
}

export interface StrategyEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  state: StrategyState;
  tags: string[];
  currentVersion: number;
  versions: StrategyVersion[];
  parameters: Record<string, unknown>;
  performance: StrategyPerformanceMetrics | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  retiredAt: string | null;
}

export interface StrategyRegistrySnapshot {
  totalStrategies: number;
  byState: Record<StrategyState, number>;
  recentPromotions: { id: string; name: string; from: StrategyState; to: StrategyState; at: string }[];
  recentRetirements: { id: string; name: string; at: string }[];
  topPerformers: { id: string; name: string; sharpe: number }[];
}

export function useStrategyRegistrySnapshot() {
  return useQuery({
    queryKey: ["strategy-registry", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: StrategyRegistrySnapshot }>("/strategy-registry/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useStrategyRegistryList(filter?: { state?: StrategyState; tag?: string }) {
  const params = new URLSearchParams();
  if (filter?.state) params.set("state", filter.state);
  if (filter?.tag) params.set("tag", filter.tag);
  const qs = params.toString();
  return useQuery({
    queryKey: ["strategy-registry", "list", qs],
    queryFn: () => apiFetch<{ ok: boolean; strategies: StrategyEntry[] }>(`/strategy-registry/list${qs ? `?${qs}` : ""}`),
    staleTime: 10_000,
  });
}

export function useRegisterStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; description?: string; author?: string; tags?: string[]; parameters?: Record<string, unknown> }) =>
      apiFetch<{ ok: boolean; strategy: StrategyEntry }>("/strategy-registry/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-registry"] }); },
  });
}

export function usePromoteStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; targetState: StrategyState; reason?: string }) =>
      apiFetch<{ ok: boolean; strategy: StrategyEntry }>(`/strategy-registry/${params.id}/promote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetState: params.targetState, reason: params.reason }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-registry"] }); },
  });
}

export function useResetStrategyRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/strategy-registry/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-registry"] }); },
  });
}


// ─── GodsView Lab Types (Phase 51) ─────────────────────────────────────────────

export interface ParsedStrategy {
  name: string;
  symbols: string[];
  entryRules: { action: string; conditions: { indicator: string; period?: number; operator: string; value: number | string; valuePeriod?: number }[]; logic: string }[];
  exitRules: { action: string; conditions: { indicator: string; period?: number; operator: string; value: number | string; valuePeriod?: number }[]; logic: string }[];
  stopRule: { type: string; value: number } | null;
  riskPct: number;
  timeframe: string;
  confidence: number;
  rawPrompt: string;
  parsedAt: string;
}

export interface CompiledRule {
  id: string;
  action: string;
  expression: string;
  conditions: { field: string; op: string; target: string }[];
  compiledAt: string;
}

export interface LabSnapshot {
  totalPromptsParsed: number;
  totalStrategiesCompiled: number;
  totalStrategiesRegistered: number;
  recentParsed: ParsedStrategy[];
  recentCompiled: CompiledRule[];
}

export function useLabSnapshot() {
  return useQuery({
    queryKey: ["lab", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: LabSnapshot }>("/lab/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useLabCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { prompt: string; author?: string }) =>
      apiFetch<{ ok: boolean; parsed: ParsedStrategy; compiled: CompiledRule[]; registered: StrategyEntry }>("/lab/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lab"] }); qc.invalidateQueries({ queryKey: ["strategy-registry"] }); },
  });
}

export function useResetLab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/lab/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lab"] }); },
  });
}


// ─── Walk-Forward + Stress Testing Types (Phase 52) ────────────────────────────
// NOTE: WalkForwardResult is already declared above (merged via interface extension).

export interface WalkForwardWindow {
  windowId: number;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  degradation: number;
  passed: boolean;
}

export interface StressTestResult {
  scenario: string;
  description: string;
  stressedSharpe: number;
  stressedMaxDD: number;
  survivalRate: number;
  passed: boolean;
}

export interface StressTestSuite {
  strategyId: string;
  scenarios: StressTestResult[];
  overallPassed: number;
  overallFailed: number;
  verdict: "PASS" | "FAIL" | "MARGINAL";
}

export interface ValidationGateResult {
  strategyId: string;
  walkForward: WalkForwardResult;
  stressTest: StressTestSuite;
  overallVerdict: "APPROVED" | "REJECTED" | "NEEDS_REVIEW";
  reasons: string[];
  validatedAt: string;
}

export interface WalkForwardStressSnapshot {
  totalWalkForwards: number;
  totalStressTests: number;
  totalValidations: number;
  passRate: number;
  recentValidations: ValidationGateResult[];
}

export function useValidationSnapshot() {
  return useQuery({
    queryKey: ["validation", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: WalkForwardStressSnapshot }>("/validation/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useRunValidationGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { strategyId: string; baseSharpe?: number; baseWinRate?: number; baseMaxDD?: number }) =>
      apiFetch<{ ok: boolean; result: ValidationGateResult }>("/validation/gate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["validation"] }); },
  });
}

export function useResetValidation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/validation/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["validation"] }); },
  });
}


// ─── TradingView Overlay Types (Phase 53) ──────────────────────────────────────

export interface StructureLevel {
  id: string;
  type: "support" | "resistance";
  price: number;
  strength: number;
  touches: number;
  broken: boolean;
}

export interface OrderBlock {
  id: string;
  type: "supply" | "demand";
  high: number;
  low: number;
  mitigated: boolean;
}

export interface PositionOverlay {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentStop: number;
  targets: { price: number; label: string; hit: boolean }[];
  unrealizedPnl: number;
}

export interface SignalMarker {
  id: string;
  symbol: string;
  type: "buy" | "sell" | "alert" | "info";
  price: number;
  timestamp: string;
  label: string;
  confidence: number;
}

export interface ChartOverlay {
  symbol: string;
  timeframe: string;
  structures: StructureLevel[];
  orderBlocks: OrderBlock[];
  positions: PositionOverlay[];
  signals: SignalMarker[];
  generatedAt: string;
}

export interface OverlaySnapshot {
  totalOverlaysGenerated: number;
  activeSymbols: string[];
  structureLevels: number;
  orderBlocks: number;
  activePositions: number;
  recentSignals: number;
}

export function useOverlaySnapshot() {
  return useQuery({
    queryKey: ["overlay", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: OverlaySnapshot }>("/overlay/snapshot"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useChartOverlay(symbol: string) {
  return useQuery({
    queryKey: ["overlay", symbol],
    queryFn: () => apiFetch<{ ok: boolean; overlay: ChartOverlay }>(`/overlay/${symbol}`),
    staleTime: 5_000,
    enabled: !!symbol,
  });
}

export function useGenerateOverlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbol: string; currentPrice: number; timeframe?: string; position?: any; signals?: any[] }) =>
      apiFetch<{ ok: boolean; overlay: ChartOverlay }>("/overlay/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["overlay"] }); },
  });
}


// ─── Live Intelligence Monitor Types (Phase 54) ────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL" | "EMERGENCY";
export type IntelMarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "CRISIS";

export interface IntelligenceAlert {
  id: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  message: string;
  symbol?: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface RegimeState {
  current: IntelMarketRegime;
  confidence: number;
  duration: number;
  previousRegime: IntelMarketRegime | null;
  changedAt: string;
}

export interface EngineHealthStatus {
  engine: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  lastHeartbeat: string;
  latencyMs: number;
  errorRate: number;
}

export interface IntelligenceFeed {
  timestamp: string;
  regime: RegimeState;
  newsLockout: { active: boolean; reason: string | null; until: string | null };
  activeAlerts: IntelligenceAlert[];
  engineHealth: EngineHealthStatus[];
  tradingAllowed: boolean;
  overallRisk: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
}

export interface LiveMonitorSnapshot {
  totalAlerts: number;
  activeAlerts: number;
  newsLockouts: number;
  regimeChanges: number;
  currentRegime: IntelMarketRegime;
  tradingAllowed: boolean;
  overallRisk: string;
  engineStatuses: EngineHealthStatus[];
}

export function useIntelligenceFeed() {
  return useQuery({
    queryKey: ["intelligence", "feed"],
    queryFn: () => apiFetch<{ ok: boolean; feed: IntelligenceFeed }>("/intelligence/feed"),
    staleTime: 3_000,
    refetchInterval: 5_000,
  });
}

export function useLiveMonitorSnapshot() {
  return useQuery({
    queryKey: ["intelligence", "snapshot"],
    queryFn: () => apiFetch<{ ok: boolean; snapshot: LiveMonitorSnapshot }>("/intelligence/snapshot"),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useTriggerNewsLockout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { title: string; impact?: string; lockoutMinutes?: number }) =>
      apiFetch<{ ok: boolean }>("/intelligence/lockout", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["intelligence"] }); },
  });
}

export function useResetLiveMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/intelligence/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["intelligence"] }); },
  });
}


/* ── Phase 57: Trade Journal + Replay ── */

export interface JournalEntry {
  id: string;
  tradeId: string;
  symbol: string;
  direction: "long" | "short";
  strategyId: string;
  strategyName: string;
  entryPrice: number;
  entryTime: string;
  entryReason: string;
  positionSize: number;
  riskPct: number;
  exitPrice?: number;
  exitTime?: string;
  exitReason?: string;
  pnl?: number;
  pnlPct?: number;
  holdDurationMs?: number;
  status: "open" | "closed";
  tags: string[];
  notes: string;
}

export interface ReplayResult {
  entryId: string;
  steps: { timestamp: string; action: string; price: number; detail: string }[];
  summary: string;
  lessonsLearned: string[];
}

export interface JournalAnalytics {
  totalTrades: number;
  winRate: number;
  avgPnlPct: number;
  profitFactor: number;
  bestStrategy: string;
  worstStrategy: string;
}

export interface TradeJournalSnapshot {
  totalEntries: number;
  openTrades: number;
  closedTrades: number;
  winRate: number;
  totalPnl: number;
  replaysGenerated: number;
}

export function useTradeJournalSnapshot() {
  return useQuery({
    queryKey: ["tradeJournal", "snapshot"],
    queryFn: () => apiFetch<TradeJournalSnapshot>("/trade-journal/snapshot"),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useJournalEntries(filters?: { symbol?: string; status?: string }) {
  return useQuery({
    queryKey: ["tradeJournal", "entries", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.symbol) params.set("symbol", filters.symbol);
      if (filters?.status) params.set("status", filters.status);
      const qs = params.toString();
      return apiFetch<JournalEntry[]>(`/trade-journal/entries${qs ? `?${qs}` : ""}`);
    },
    staleTime: 5_000,
  });
}

export function useJournalAnalytics() {
  return useQuery({
    queryKey: ["tradeJournal", "analytics"],
    queryFn: () => apiFetch<JournalAnalytics>("/trade-journal/analytics"),
    staleTime: 10_000,
  });
}

export function useReplayTrade() {
  return useMutation({
    mutationFn: (tradeId: string) =>
      apiFetch<ReplayResult>("/trade-journal/replay", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId }),
      }),
  });
}

export function useResetTradeJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/trade-journal/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tradeJournal"] }); },
  });
}


/* ── Phase 58: System Orchestrator ── */

export type EngineState = "stopped" | "starting" | "running" | "degraded" | "error" | "stopping";

export interface EngineRegistration {
  id: string;
  name: string;
  version: string;
  state: EngineState;
  startedAt?: string;
  lastHeartbeat?: string;
  errorCount: number;
  lastError?: string;
  dependencies: string[];
}

export interface SystemHealthSummary {
  overall: "healthy" | "degraded" | "critical" | "offline";
  enginesTotal: number;
  enginesRunning: number;
  enginesDegraded: number;
  enginesError: number;
  enginesStopped: number;
  uptimeMs: number;
  lastHealthCheck: string;
}

export interface OrchestratorSnapshot {
  health: SystemHealthSummary;
  engines: EngineRegistration[];
  recentEvents: { id: string; timestamp: string; type: string; engineId: string; detail: string }[];
  commandsExecuted: number;
}

export function useOrchestratorSnapshot() {
  return useQuery({
    queryKey: ["orchestrator", "snapshot"],
    queryFn: () => apiFetch<OrchestratorSnapshot>("/orchestrator/snapshot"),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ["orchestrator", "health"],
    queryFn: () => apiFetch<SystemHealthSummary>("/orchestrator/health"),
    staleTime: 3_000,
    refetchInterval: 5_000,
  });
}

export function useRegisterEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; name: string; version?: string }) =>
      apiFetch<EngineRegistration>("/orchestrator/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orchestrator"] }); },
  });
}

export function useSetEngineState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { engineId: string; state: EngineState; error?: string }) =>
      apiFetch<EngineRegistration>("/orchestrator/state", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orchestrator"] }); },
  });
}

export function useResetOrchestrator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/orchestrator/reset", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orchestrator"] }); },
  });
}


/* ── Phase 59: API Gateway + Auth ── */

export interface ApiKeyInfo {
  key: string;
  name: string;
  role: "admin" | "trader" | "viewer" | "bot";
  permissions: string[];
  enabled: boolean;
  rateLimit: number;
  requestCount: number;
}

export interface GatewaySnapshot {
  totalKeys: number;
  activeKeys: number;
  totalRequests: number;
  blockedRequests: number;
  auditLogSize: number;
  avgLatencyMs: number;
}

export function useGatewaySnapshot() {
  return useQuery({
    queryKey: ["gateway", "snapshot"],
    queryFn: () => apiFetch<GatewaySnapshot>("/gateway/snapshot"),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["gateway", "keys"],
    queryFn: () => apiFetch<ApiKeyInfo[]>("/gateway/keys"),
    staleTime: 10_000,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; role: string; rateLimit?: number }) =>
      apiFetch<ApiKeyInfo>("/gateway/keys", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gateway"] }); },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ ok: boolean }>("/gateway/keys/revoke", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gateway"] }); },
  });
}

// ─── Market Structure HTF Types (Phase 63) ────────────────────────────────────

export type Timeframe = "15min" | "1H" | "4H" | "1D" | "1W";
export type StructureBias = "bullish" | "bearish" | "ranging";

export interface SwingPoint { index: number; price: number; timestamp: string; type: "high" | "low"; }
export interface OrderBlockHTF {
  id: string; type: "bullish" | "bearish"; timeframe: Timeframe;
  high: number; low: number; score: number; status: "fresh" | "tested" | "mitigated";
  createdAt: string;
}
export interface ABCDPattern {
  id: string; type: "bullish" | "bearish"; timeframe: Timeframe;
  pointA: SwingPoint; pointB: SwingPoint; pointC: SwingPoint; pointD: SwingPoint;
  fibAccuracy: number; score: number; status: "forming" | "complete" | "triggered" | "invalidated";
}
export interface MultiTimeframeStructure {
  symbol: string; analyzedAt: string;
  htfBias: StructureBias;
  tradeProbability: { long: number; short: number; neutral: number; };
  keyLevels: { price: number; type: string; timeframe: Timeframe; strength: number; }[];
  nearestOrderBlocks: { bullish: OrderBlockHTF | null; bearish: OrderBlockHTF | null; };
  nearestABCD: ABCDPattern | null;
  timeframes: Record<string, {
    bias: StructureBias;
    orderBlocks: OrderBlockHTF[];
    abcdPatterns: ABCDPattern[];
  }>;
}

export function useMultiTimeframeStructure(symbol: string) {
  return useQuery<MultiTimeframeStructure>({
    queryKey: ["mtf-structure", symbol],
    queryFn: () => apiFetch(`/api/market-structure/${symbol}/analyze`),
    enabled: !!symbol,
    refetchInterval: 60_000,
  });
}

// ─── Daily Review Types (Phase 63) ────────────────────────────────────────────

export interface DailyFinding {
  type: string; description: string; importance: "high" | "medium" | "low";
  price: number; timeframe: string; timestamp: string;
}

export interface DailyReview {
  id: string; date: string; symbol: string;
  htfBias: StructureBias; tradeProbability: { long: number; short: number; neutral: number; };
  chanceOfTrade: number; signalsGenerated: number; tradesExecuted: number;
  tradesWon: number; tradesLost: number; pnlPct: number;
  findings: DailyFinding[]; structureSummary: string; createdAt: string;
  keyLevels: { price: number; type: string; timeframe: string; }[];
  orderBlocksActive: number; abcdPatternsActive: number;
}

export function useDailyReview(symbol: string, date: string) {
  return useQuery<DailyReview>({
    queryKey: ["daily-review", symbol, date],
    queryFn: () => apiFetch(`/api/daily-review/${symbol}/${date}`),
    enabled: !!symbol && !!date,
  });
}

export function useDailyReviews(symbol: string) {
  return useQuery<DailyReview[]>({
    queryKey: ["daily-reviews", symbol],
    queryFn: () => apiFetch(`/api/daily-review/${symbol}`),
    enabled: !!symbol,
  });
}

export function useGenerateDailyReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { symbol: string; date: string }) =>
      apiFetch<DailyReview>("/api/daily-review/generate", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["daily-review"] }); },
  });
}

// ─── Side-by-Side Backtest Types (Phase 63) ────────────────────────────────────

export interface SideBySideSnapshot {
  id: string;
  config: { symbols: string[]; historicalDays: number; strategies: string[]; };
  backtest: { status: string; tradesTotal: number; winRate: number; pnlPct: number; sharpeRatio: number; maxDrawdown: number; progress: number; };
  live: { status: string; tradesTotal: number; winRate: number; pnlPct: number; unrealizedPnl: number; openPositions: number; };
  comparison: { winRateDelta: number; pnlDelta: number; signalOverlap: number; divergenceScore: number; };
  status: string; startedAt: string; updatedAt: string;
}

export function useSideBySideSnapshot() {
  return useQuery<SideBySideSnapshot | null>({
    queryKey: ["side-by-side"],
    queryFn: () => apiFetch("/api/side-by-side/snapshot"),
    refetchInterval: 5_000,
  });
}

export function useStartSideBySide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { symbols: string[]; historicalDays: number; strategies: string[]; }) =>
      apiFetch<SideBySideSnapshot>("/api/side-by-side/start", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["side-by-side"] }); },
  });
}

export function useStopSideBySide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/side-by-side/stop", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["side-by-side"] }); },
  });
}

// ─── TradingView MCP ────────────────────────────────────────────────────────

// Types
export interface MCPSignalScore {
  structureScore: number; orderflowScore: number; contextScore: number;
  memoryScore: number; sentimentScore: number; dataQualityScore: number;
  confirmationScore: number; confidenceScore: number;
  grade: string; overallScore: number;
  explanation: string; warnings: string[]; boosters: string[];
}

export interface MCPDecisionSummary {
  signalId: string; symbol: string; action: string; direction: string;
  confidence: number; grade: string; overallScore: number;
  entryPrice: number | null; stopLoss: number | null; takeProfit: number | null;
  positionSize: number | null; thesis: string; rejectionReasons: string[];
  processingMs: number; timestamp: string;
  scoreBreakdown?: Record<string, number>;
  warnings?: string[];
  boosters?: string[];
}

export interface MCPStats {
  ok: boolean;
  ingestion: { totalReceived: number; totalAccepted: number; totalRejected: number; avgProcessingMs: number; bySource: Record<string, number>; bySignalType: Record<string, number>; bySymbol: Record<string, number> };
  approvalRate: number;
  recentDecisions: MCPDecisionSummary[];
}

export interface MCPBacktestRunResult {
  runId: string;
  totalSignals: number; approvedSignals: number; rejectedSignals: number;
  approvalRate: number; avgConfirmationScore: number; avgOverallScore: number;
  mcpMetrics: Record<string, number>;
  baselineMetrics: Record<string, number> | null;
  comparison: MCPComparison | null;
}

export interface MCPComparison {
  baselineTotalTrades: number; baselineWinRate: number; baselineSharpe: number; baselineProfitFactor: number; baselineTotalPnl: number;
  mcpTotalTrades: number; mcpWinRate: number; mcpSharpe: number; mcpProfitFactor: number; mcpTotalPnl: number;
  winRateImprovement: number; sharpeImprovement: number; profitFactorImprovement: number; pnlImprovement: number;
  tradesFiltered: number; tradesFilteredPct: number; mcpAddedValue: boolean; summary: string;
}

export interface MCPBacktestHistory {
  runId: string; symbol: string; timeframe: string; status: string;
  totalSignals: number; approvedSignals: number;
  mcpSharpe: number; baselineSharpe: number | null;
  startedAt: string; completedAt: string | null;
}

// Hooks

export function useMCPStats() {
  return useQuery({ queryKey: ["mcp", "stats"], queryFn: () => apiFetch<MCPStats>("/tradingview/stats"), refetchInterval: 5_000 });
}

export function useMCPDecisions(limit = 50) {
  return useQuery({ queryKey: ["mcp", "decisions", limit], queryFn: () => apiFetch<{ ok: boolean; count: number; decisions: MCPDecisionSummary[] }>(`/tradingview/decisions?limit=${limit}`) });
}

export function useMCPDecision(signalId: string) {
  return useQuery({ queryKey: ["mcp", "decision", signalId], queryFn: () => apiFetch<{ ok: boolean; decision: any }>(`/tradingview/decision/${signalId}`), enabled: !!signalId });
}

export function useMCPHealth() {
  return useQuery({ queryKey: ["mcp", "health"], queryFn: () => apiFetch<any>("/tradingview/health"), refetchInterval: 10_000 });
}

export function useRunMCPBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { symbol: string; timeframe: string; startDate: string; endDate: string; signalType?: string; initialCapital?: number; runBaseline?: boolean }) =>
      apiFetch<MCPBacktestRunResult>("/mcp-backtest/run", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mcp-backtest"] }); },
  });
}

export function useMCPBacktestHistory() {
  return useQuery({ queryKey: ["mcp-backtest", "history"], queryFn: () => apiFetch<{ ok: boolean; runs: MCPBacktestHistory[] }>("/mcp-backtest/history") });
}

export function useMCPBacktestComparison(runId: string) {
  return useQuery({ queryKey: ["mcp-backtest", "compare", runId], queryFn: () => apiFetch<any>(`/mcp-backtest/compare/${runId}`), enabled: !!runId });
}

export function useMCPBacktestSignalLog(runId: string, limit = 100, offset = 0) {
  return useQuery({ queryKey: ["mcp-backtest", "signal-log", runId, limit, offset], queryFn: () => apiFetch<any>(`/mcp-backtest/signal-log/${runId}?limit=${limit}&offset=${offset}`), enabled: !!runId });
}

// ─── Phase 115: Ops, Security & Failure Testing ─────────────────────────────

export function useSecurityAudit() {
  return useQuery({ queryKey: ["security", "audit"], queryFn: () => apiFetch<any>("/ops-security/security/audit") });
}

export function useSecurityScore() {
  return useQuery({ queryKey: ["security", "score"], queryFn: () => apiFetch<any>("/ops-security/security/score"), refetchInterval: 30_000 });
}

export function useSecurityHistory() {
  return useQuery({ queryKey: ["security", "history"], queryFn: () => apiFetch<any>("/ops-security/security/history") });
}

export function useRunChaosTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { scenario: string }) => apiFetch<any>("/ops-security/chaos/run", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["chaos"] }); },
  });
}

export function useChaosResults() {
  return useQuery({ queryKey: ["chaos", "results"], queryFn: () => apiFetch<any>("/ops-security/chaos/results") });
}

export function useResiliencyMatrix() {
  return useQuery({ queryKey: ["chaos", "resiliency"], queryFn: () => apiFetch<any>("/ops-security/chaos/resiliency") });
}

export function useRecoveryMetrics() {
  return useQuery({ queryKey: ["chaos", "recovery"], queryFn: () => apiFetch<any>("/ops-security/chaos/recovery") });
}

export function useOpsSnapshot() {
  return useQuery({ queryKey: ["ops", "snapshot"], queryFn: () => apiFetch<any>("/ops-security/ops/snapshot"), refetchInterval: 5_000 });
}

export function useIncidentLog(limit = 50) {
  return useQuery({ queryKey: ["ops", "incidents", limit], queryFn: () => apiFetch<any>(`/ops-security/ops/incidents?limit=${limit}`) });
}

export function useLogIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { severity: string; title: string; description: string; component: string }) => apiFetch<any>("/ops-security/ops/incidents", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops"] }); },
  });
}

export function useResolveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<any>(`/ops-security/ops/incidents/${id}/resolve`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops"] }); },
  });
}

export function useGetRunbook(component: string) {
  return useQuery({ queryKey: ["ops", "runbook", component], queryFn: () => apiFetch<any>(`/ops-security/ops/runbook/${component}`), enabled: !!component });
}

export function useDeployGate() {
  return useQuery({ queryKey: ["deploy", "gate"], queryFn: () => apiFetch<any>("/ops-security/deploy/gate") });
}

export function useDeployHistory() {
  return useQuery({ queryKey: ["deploy", "history"], queryFn: () => apiFetch<any>("/ops-security/deploy/history") });
}

export function useRecordDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { version: string; commitHash: string; deployer: string; notes: string }) => apiFetch<any>("/ops-security/deploy/record", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deploy"] }); },
  });
}

// ─── Phase 116: Paper Trading Validation Program ────────────────────────────

export function usePaperProgramStatus() {
  return useQuery({ queryKey: ["paper-program", "status"], queryFn: () => apiFetch<any>("/paper-program/status"), refetchInterval: 5_000 });
}

export function useStartPaperProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { strategies: string[]; symbols: string[]; capitalAllocation: number }) => apiFetch<any>("/paper-program/start", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["paper-program"] }); },
  });
}

export function useAdvancePaperDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/paper-program/advance", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["paper-program"] }); },
  });
}

export function usePausePaperProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/paper-program/pause", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["paper-program"] }); },
  });
}

export function useResumePaperProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/paper-program/resume", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["paper-program"] }); },
  });
}

export function usePaperPhaseReport(phase: number) {
  return useQuery({ queryKey: ["paper-program", "phase", phase], queryFn: () => apiFetch<any>(`/paper-program/phase/${phase}`), enabled: phase >= 1 && phase <= 4 });
}

export function usePaperSignalLog(limit = 50) {
  return useQuery({ queryKey: ["paper-program", "signals", limit], queryFn: () => apiFetch<any>(`/paper-program/signals?limit=${limit}`) });
}

export function usePaperExecutionLog(limit = 50) {
  return useQuery({ queryKey: ["paper-program", "executions", limit], queryFn: () => apiFetch<any>(`/paper-program/executions?limit=${limit}`) });
}

export function usePaperRiskCompliance() {
  return useQuery({ queryKey: ["paper-program", "risk-compliance"], queryFn: () => apiFetch<any>("/paper-program/risk-compliance") });
}

export function usePaperStrategyComparison() {
  return useQuery({ queryKey: ["paper-program", "strategy-comparison"], queryFn: () => apiFetch<any>("/paper-program/strategy-comparison") });
}

export function usePaperCertification() {
  return useQuery({ queryKey: ["paper-program", "certification"], queryFn: () => apiFetch<any>("/paper-program/certification") });
}

export function useGenerateCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/paper-program/certify", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["paper-program"] }); },
  });
}

// ─── Phase 117: Capital Gating & Controlled Launch ──────────────────────────

export function useStrategyTiers() {
  return useQuery({ queryKey: ["capital", "tiers"], queryFn: () => apiFetch<any>("/capital-gating/tiers"), refetchInterval: 10_000 });
}

export function useStrategyTier(strategyId: string) {
  return useQuery({ queryKey: ["capital", "tier", strategyId], queryFn: () => apiFetch<any>(`/capital-gating/tiers/${strategyId}`), enabled: !!strategyId });
}

export function useRequestPromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (strategyId: string) => apiFetch<any>(`/capital-gating/tiers/${strategyId}/promote`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["capital"] }); },
  });
}

export function useDemoteStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { strategyId: string; reason: string }) => apiFetch<any>(`/capital-gating/tiers/${params.strategyId}/demote`, { method: "POST", body: JSON.stringify({ reason: params.reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["capital"] }); },
  });
}

export function usePromotionHistory(strategyId: string) {
  return useQuery({ queryKey: ["capital", "history", strategyId], queryFn: () => apiFetch<any>(`/capital-gating/tiers/${strategyId}/history`), enabled: !!strategyId });
}

export function useCapitalAllocation() {
  return useQuery({ queryKey: ["capital", "allocation"], queryFn: () => apiFetch<any>("/capital-gating/allocation"), refetchInterval: 10_000 });
}

export function useLaunchPlan() {
  return useQuery({ queryKey: ["launch", "plan"], queryFn: () => apiFetch<any>("/capital-gating/launch/plan") });
}

export function useCreateLaunchPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { strategies: string[]; startDate: string; rampSchedule: number[] }) => apiFetch<any>("/capital-gating/launch/plan", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["launch"] }); },
  });
}

export function useLaunchStatus() {
  return useQuery({ queryKey: ["launch", "status"], queryFn: () => apiFetch<any>("/capital-gating/launch/status"), refetchInterval: 5_000 });
}

export function useAdvanceLaunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<any>("/capital-gating/launch/advance", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["launch"] }); },
  });
}

export function usePauseLaunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => apiFetch<any>("/capital-gating/launch/pause", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["launch"] }); },
  });
}

export function useAbortLaunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => apiFetch<any>("/capital-gating/launch/abort", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["launch"] }); },
  });
}

export function useLaunchMetrics() {
  return useQuery({ queryKey: ["launch", "metrics"], queryFn: () => apiFetch<any>("/capital-gating/launch/metrics"), refetchInterval: 3_000 });
}

export function useRampSchedule() {
  return useQuery({ queryKey: ["launch", "ramp"], queryFn: () => apiFetch<any>("/capital-gating/launch/ramp") });
}

export function usePreLaunchChecklist() {
  return useQuery({ queryKey: ["protection", "checklist"], queryFn: () => apiFetch<any>("/capital-gating/protection/checklist") });
}

export function useCapitalAtRisk() {
  return useQuery({ queryKey: ["protection", "capital-at-risk"], queryFn: () => apiFetch<any>("/capital-gating/protection/capital-at-risk"), refetchInterval: 5_000 });
}

export function useDrawdownBudget() {
  return useQuery({ queryKey: ["protection", "drawdown-budget"], queryFn: () => apiFetch<any>("/capital-gating/protection/drawdown-budget"), refetchInterval: 5_000 });
}

export function useSetMaxDrawdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) => apiFetch<any>("/capital-gating/protection/max-drawdown", { method: "POST", body: JSON.stringify({ amount }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["protection"] }); },
  });
}

export function useEmergencyHalt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => apiFetch<any>("/capital-gating/protection/emergency-halt", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["protection", "launch", "capital"] }); },
  });
}
