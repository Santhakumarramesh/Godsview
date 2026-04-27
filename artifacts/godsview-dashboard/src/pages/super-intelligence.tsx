import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePaperValidationReport, usePaperValidationStatus, useRunPaperValidation } from "@/lib/api";
import { safeFixed, safeNum } from "@/lib/safe";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart,
  Cell, Legend,
} from "recharts";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
  gold: "#fbbf24",
  purple: "#a78bfa",
};

function MicroLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk",
      letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline,
      ...style,
    }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-2 font-bold text-xl" style={{
        fontFamily: "JetBrains Mono, monospace", color: color ?? C.primary,
      }}>{value}</div>
      {sub && <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

type BacktestMetrics = {
  total_signals: number; trades_taken: number; wins: number; losses: number;
  win_rate: number; profit_factor: number; total_pnl_pct: number;
  avg_win_pct: number; avg_loss_pct: number; max_drawdown_pct: number;
  sharpe_ratio: number; avg_kelly_pct: number; avg_edge_score: number;
  best_trade_pct: number; worst_trade_pct: number; avg_hold_quality: number;
};

type BacktestResult = {
  baseline: BacktestMetrics;
  super_intelligence: BacktestMetrics;
  improvement: {
    win_rate_delta: number; profit_factor_delta: number;
    sharpe_delta: number; max_dd_improvement: number;
    signals_filtered_pct: number;
  };
  by_regime: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }>;
  by_setup: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }>;
  equity_curve_baseline: Array<{ idx: number; equity: number }>;
  equity_curve_si: Array<{ idx: number; equity: number }>;
  significance: {
    z_score: number; p_value: number; is_significant: boolean;
    confidence_level: string;
  };
  generated_at: string;
};

type SIDecisionEvent = {
  symbol: string; setup_type: string; direction: "long" | "short";
  approved: boolean; win_probability: number; edge_score: number;
  enhanced_quality: number; kelly_pct: number; regime: string;
  rejection_reason?: string; timestamp: string;
};

type SIStatus = {
  status: "active" | "partial" | "inactive";
  ensemble: {
    ensemble_accuracy: number; gbm_accuracy: number;
    lr_accuracy: number; samples: number; trained_at: string;
  } | null;
  message: string;
  current_regime?: string;
};

type AutonomousStatus = {
  enabled: boolean;
  scans_completed: number;
  strategies_rated: number;
  last_scan_time: string;
  current_regime?: string;
};

type StrategyLeaderboardItem = {
  rank: number;
  strategy: string;
  win_rate: number;
  profit_factor: number;
  sharpe: number;
  trades: number;
  stars: number;
};

type SystemMetrics = {
  win_rate: number;
  profit_factor: number;
  governance_metrics?: Record<string, any>;
};

// ── SSE Hook ───────────────────────────────────────────────────────────────

function useSSEStream(url: string, maxEvents = 50) {
  const [events, setEvents] = useState<SIDecisionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener("si_decision", (e) => {
      try {
        const data = JSON.parse(e.data) as SIDecisionEvent;
        setEvents(prev => [data, ...prev].slice(0, maxEvents));
      } catch { /* ignore parse errors */ }
    });

    return () => { es.close(); esRef.current = null; };
  }, [url, maxEvents]);

  return { events, connected };
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SuperIntelligencePage() {
  const [backtestDays, setBacktestDays] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "equity" | "regimes" | "setups" | "feed" | "leaderboard">("overview");
  const [autonomousMode, setAutonomousMode] = useState(false);

  // Real-time SSE feed
  const { events: siEvents, connected: sseConnected } = useSSEStream("/api/super-intelligence/stream");

  // SI Status
  const { data: siStatus } = useQuery<SIStatus>({
    queryKey: ["si-status"],
    queryFn: () => fetch("/api/super-intelligence/status").then(r => r.json()),
    refetchInterval: 30_000,
  });

  // Production stats
  const { data: prodStats } = useQuery<{
    daily_trades: number; max_daily_trades: number;
    min_win_prob: number; min_edge: number;
  }>({
    queryKey: ["prod-stats"],
    queryFn: () => fetch("/api/super-intelligence/production-stats").then(r => r.json()),
    refetchInterval: 30_000,
  });

  // Autonomous mode status
  const { data: autonomousStatus } = useQuery<AutonomousStatus>({
    queryKey: ["autonomous-status"],
    queryFn: () => fetch("/api/super-intelligence/autonomous/status").then(r => r.json()),
    refetchInterval: 10_000,
    enabled: autonomousMode,
  });

  // Strategy leaderboard
  const { data: leaderboard } = useQuery<StrategyLeaderboardItem[]>({
    queryKey: ["strategy-leaderboard"],
    queryFn: () => fetch("/api/super-intelligence/strategy-leaderboard").then(r => r.json()),
    refetchInterval: 60_000,
  });

  // System metrics (for market readiness)
  const { data: systemMetrics } = useQuery<SystemMetrics>({
    queryKey: ["system-metrics"],
    queryFn: () => fetch("/api/system").then(r => r.json()),
    refetchInterval: 30_000,
  });

  // Paper validation loop: predicted vs realized in paper mode
  const { data: paperValidationStatus } = usePaperValidationStatus();
  const { data: paperValidationReport } = usePaperValidationReport({
    enabled: Boolean(paperValidationStatus?.running || (paperValidationStatus?.history_size ?? 0) > 0),
  });
  const runPaperValidationMutation = useRunPaperValidation();

  const runBacktest = useCallback(async () => {
    setIsRunning(true);
    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookback_days: backtestDays, initial_equity: 10000, mode: "comparison" }),
      });
      const data = await res.json();
      setBacktestResult(data);
    } catch (err) {
      console.error("Backtest failed:", err);
    } finally {
      setIsRunning(false);
    }
  }, [backtestDays]);

  const toggleAutonomousMode = useCallback(async () => {
    try {
      const endpoint = autonomousMode ? "/api/super-intelligence/autonomous/stop" : "/api/super-intelligence/autonomous/start";
      await fetch(endpoint, { method: "POST" });
      setAutonomousMode(!autonomousMode);
    } catch (err) {
      console.error("Failed to toggle autonomous mode:", err);
    }
  }, [autonomousMode]);

  const runPaperValidationNow = useCallback(() => {
    runPaperValidationMutation.mutate({ enable_auto_optimization: true });
  }, [runPaperValidationMutation]);

  // Auto-run backtest on mount
  useEffect(() => { runBacktest(); }, []);

  const ens = siStatus?.ensemble;
  const bt = backtestResult;
  const bl = bt?.baseline;
  const si = bt?.super_intelligence;
  const imp = bt?.improvement;

  // Merge equity curves for overlay chart (memoized to avoid recompute on every render)
  const equityOverlay = useMemo(() => bt ? bt.equity_curve_baseline.map((b, i) => ({
    idx: b.idx,
    baseline: b.equity,
    si: bt.equity_curve_si[i]?.equity ?? b.equity,
  })) : [], [bt]);

  // Regime comparison data for bar chart
  const regimeData = useMemo(() => bt ? Object.entries(bt.by_regime).map(([regime, data]) => ({
    regime: regime.replace(/_/g, " "),
    baseline_wr: +(data.baseline.win_rate * 100).toFixed(1),
    si_wr: +(data.si.win_rate * 100).toFixed(1),
    baseline_pf: +safeFixed(data?.baseline?.profit_factor, 2),
    si_pf: +safeFixed(data?.si?.profit_factor, 2),
    baseline_trades: data.baseline.trades_taken,
    si_trades: data.si.trades_taken,
  })) : [], [bt]);

  // Setup comparison data
  const setupData = useMemo(() => bt ? Object.entries(bt.by_setup).map(([setup, data]) => ({
    setup: setup.replace(/_/g, " "),
    baseline_wr: +(data.baseline.win_rate * 100).toFixed(1),
    si_wr: +(data.si.win_rate * 100).toFixed(1),
    baseline_pf: +safeFixed(data?.baseline?.profit_factor, 2),
    si_pf: +safeFixed(data?.si?.profit_factor, 2),
    baseline_trades: data.baseline.trades_taken,
    si_trades: data.si.trades_taken,
  })) : [], [bt]);

  return (
    <div className="space-y-4 p-4" style={{ color: C.muted, fontFamily: "Space Grotesk" }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#fff", fontFamily: "Space Grotesk" }}>
            Super Intelligence
          </h1>
          <p style={{ fontSize: "11px", color: C.outline }}>
            Ensemble ML + Kelly Criterion + Regime-Adaptive + Production Gate
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{
              backgroundColor: sseConnected ? C.primary : C.tertiary,
            }} />
            <span style={{ fontSize: "10px", color: C.outline }}>
              {sseConnected ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <div className="px-2 py-1 rounded" style={{
            fontSize: "10px",
            backgroundColor: siStatus?.status === "active" ? "rgba(156,255,147,0.1)" :
              siStatus?.status === "partial" ? "rgba(251,191,36,0.1)" : "rgba(255,113,98,0.1)",
            color: siStatus?.status === "active" ? C.primary :
              siStatus?.status === "partial" ? C.gold : C.tertiary,
            border: `1px solid ${siStatus?.status === "active" ? "rgba(156,255,147,0.2)" :
              siStatus?.status === "partial" ? "rgba(251,191,36,0.2)" : "rgba(255,113,98,0.2)"}`,
          }}>
            {siStatus?.status?.toUpperCase() ?? "LOADING"}
          </div>
        </div>
      </div>

      {/* ── A. Autonomous Mode Controls ── */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <MicroLabel>Autonomous Mode</MicroLabel>
          <button onClick={toggleAutonomousMode}
            className="px-3 py-1.5 rounded text-xs transition-colors"
            style={{
              backgroundColor: autonomousMode ? "rgba(156,255,147,0.15)" : "rgba(255,113,98,0.15)",
              color: autonomousMode ? C.primary : C.tertiary,
              border: `1px solid ${autonomousMode ? "rgba(156,255,147,0.3)" : "rgba(255,113,98,0.3)"}`,
              fontFamily: "Space Grotesk", fontWeight: 600,
            }}>
            {autonomousMode ? "Stop" : "Start"}
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Status
            </div>
            <div style={{
              fontSize: "14px", fontWeight: 600, color: autonomousMode ? C.primary : C.tertiary,
              fontFamily: "JetBrains Mono, monospace",
            }}>
              {autonomousMode ? "ACTIVE" : "INACTIVE"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Scans Completed
            </div>
            <div style={{
              fontSize: "14px", fontWeight: 600, color: C.secondary,
              fontFamily: "JetBrains Mono, monospace",
            }}>
              {autonomousStatus?.scans_completed ?? 0}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Strategies Rated
            </div>
            <div style={{
              fontSize: "14px", fontWeight: 600, color: C.secondary,
              fontFamily: "JetBrains Mono, monospace",
            }}>
              {autonomousStatus?.strategies_rated ?? 0}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Last Scan
            </div>
            <div style={{
              fontSize: "12px", color: C.muted,
              fontFamily: "JetBrains Mono, monospace",
            }}>
              {autonomousStatus?.last_scan_time ? new Date(autonomousStatus.last_scan_time).toLocaleTimeString() : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ── B. Paper Validation Loop ── */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <MicroLabel>Paper Validation Loop</MicroLabel>
          <div className="flex items-center gap-2">
            <div className="px-2 py-1 rounded" style={{
              fontSize: "9px",
              fontFamily: "JetBrains Mono, monospace",
              backgroundColor: paperValidationReport?.status === "HEALTHY" ? "rgba(156,255,147,0.12)" :
                paperValidationReport?.status === "WATCH" ? "rgba(251,191,36,0.12)" :
                paperValidationReport?.status === "DRIFT" || paperValidationReport?.status === "CRITICAL" ? "rgba(255,113,98,0.12)" : "rgba(118,117,118,0.15)",
              color: paperValidationReport?.status === "HEALTHY" ? C.primary :
                paperValidationReport?.status === "WATCH" ? C.gold :
                paperValidationReport?.status === "DRIFT" || paperValidationReport?.status === "CRITICAL" ? C.tertiary : C.outline,
              border: `1px solid ${paperValidationReport?.status === "HEALTHY" ? "rgba(156,255,147,0.2)" :
                paperValidationReport?.status === "WATCH" ? "rgba(251,191,36,0.2)" :
                paperValidationReport?.status === "DRIFT" || paperValidationReport?.status === "CRITICAL" ? "rgba(255,113,98,0.2)" : "rgba(118,117,118,0.2)"}`,
            }}>
              {paperValidationReport?.status ?? "WAITING"}
            </div>
            <button onClick={runPaperValidationNow}
              disabled={runPaperValidationMutation.isPending}
              className="px-3 py-1.5 rounded text-xs transition-colors"
              style={{
                backgroundColor: runPaperValidationMutation.isPending ? C.outlineVar : "rgba(102,157,255,0.15)",
                color: runPaperValidationMutation.isPending ? C.outline : C.secondary,
                border: `1px solid ${runPaperValidationMutation.isPending ? "rgba(72,72,73,0.35)" : "rgba(102,157,255,0.35)"}`,
                fontFamily: "Space Grotesk", fontWeight: 600,
              }}>
              {runPaperValidationMutation.isPending ? "Running..." : "Run Now"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Loop
            </div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: paperValidationStatus?.running ? C.primary : C.tertiary, fontFamily: "JetBrains Mono, monospace" }}>
              {paperValidationStatus?.running ? "ACTIVE" : "STOPPED"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Resolved Samples
            </div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: C.secondary, fontFamily: "JetBrains Mono, monospace" }}>
              {paperValidationReport?.approved.sample_count ?? paperValidationStatus?.latest_sample_count ?? 0}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Calibration Bias
            </div>
            <div style={{
              fontSize: "14px", fontWeight: 600,
              color: Math.abs(paperValidationReport?.approved.calibration_bias ?? 0) <= 0.05 ? C.primary : C.gold,
              fontFamily: "JetBrains Mono, monospace",
            }}>
              {paperValidationReport ? `${paperValidationReport.approved.calibration_bias >= 0 ? "+" : ""}${safeFixed(paperValidationReport?.approved?.calibration_bias, 3)}` : "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "8px" }}>
              Brier / Precision
            </div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
              {paperValidationReport ? `${safeFixed(paperValidationReport?.approved?.brier_score, 3)} / ${(paperValidationReport.approved.precision * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between" style={{ fontSize: "10px", color: C.outline }}>
          <span>
            Last cycle: {paperValidationStatus?.last_cycle_at ? new Date(paperValidationStatus.last_cycle_at).toLocaleTimeString() : "—"}
            {" · "}
            Interval: {paperValidationStatus?.interval_ms ? `${Math.round(paperValidationStatus.interval_ms / 1000)}s` : "—"}
          </span>
          <span style={{ color: C.gold }}>
            Auto-optimizations: {paperValidationReport?.optimization_actions?.length ?? 0}
          </span>
        </div>
      </div>

      {/* ── C. Market Readiness Indicator ── */}
      {systemMetrics && (
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center">
              <MicroLabel style={{ marginBottom: "12px" }}>Market Readiness</MicroLabel>
              <div className="flex items-center justify-center" style={{ width: "80px", height: "80px" }}>
                <div style={{
                  width: "100%", height: "100%", borderRadius: "50%",
                  backgroundColor: (systemMetrics.win_rate > 0.55 && systemMetrics.profit_factor > 1.2) ? C.primary :
                    (systemMetrics.win_rate > 0.45 && systemMetrics.profit_factor > 0.9) ? C.gold : C.tertiary,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: 0.3,
                }} />
                <div style={{
                  position: "absolute", fontSize: "12px", fontWeight: 600,
                  color: (systemMetrics.win_rate > 0.55 && systemMetrics.profit_factor > 1.2) ? C.primary :
                    (systemMetrics.win_rate > 0.45 && systemMetrics.profit_factor > 0.9) ? C.gold : C.tertiary,
                  fontFamily: "Space Grotesk", letterSpacing: "0.05em",
                  textAlign: "center",
                }}>
                  {(systemMetrics.win_rate > 0.55 && systemMetrics.profit_factor > 1.2) ? "MARKET\nREADY" :
                    (systemMetrics.win_rate > 0.45 && systemMetrics.profit_factor > 0.9) ? "CAUTION" : "STAND\nDOWN"}
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex justify-between" style={{ fontSize: "11px" }}>
                <span style={{ color: C.outline }}>Win Rate</span>
                <span style={{ color: C.secondary, fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                  {(systemMetrics.win_rate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between" style={{ fontSize: "11px" }}>
                <span style={{ color: C.outline }}>Profit Factor</span>
                <span style={{ color: C.secondary, fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                  {systemMetrics.profit_factor.toFixed ? .toFixed(2) : "—"}
                </span>
              </div>
              <div className="flex justify-between" style={{ fontSize: "11px" }}>
                <span style={{ color: C.outline }}>Current Regime</span>
                <span style={{ color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                  {autonomousStatus?.current_regime?.replace(/_/g, " ") ?? siStatus?.current_regime?.replace(/_/g, " ") ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Top Metrics Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="Ensemble Accuracy"
          value={ens ? `${(ens.ensemble_accuracy * 100).toFixed(1)}%` : "—"}
          sub={ens ? `GBM ${(ens.gbm_accuracy * 100).toFixed(0)}% + LR ${(ens.lr_accuracy * 100).toFixed(0)}%` : "Training..."}
          color={ens && ens.ensemble_accuracy >= 0.65 ? C.primary : ens && ens.ensemble_accuracy >= 0.55 ? C.gold : C.tertiary} />
        <StatCard label="SI Win Rate"
          value={si ? `${(si.win_rate * 100).toFixed(1)}%` : "—"}
          sub={imp ? `${imp.win_rate_delta >= 0 ? "+" : ""}${(imp.win_rate_delta * 100).toFixed(1)}% vs baseline` : ""}
          color={imp && imp.win_rate_delta > 0 ? C.primary : C.tertiary} />
        <StatCard label="Profit Factor"
          value={si ? si.profit_factor.toFixed ? .toFixed(2) : "—" : "—"}
          sub={bl ? `Baseline: ${bl.profit_factor.toFixed ? .toFixed(2) : "—"}` : ""}
          color={si && si.profit_factor >= 1.5 ? C.primary : si && si.profit_factor >= 1.0 ? C.gold : C.tertiary} />
        <StatCard label="Sharpe Ratio"
          value={si ? si.sharpe_ratio.toFixed ? .toFixed(2) : "—" : "—"}
          sub={imp ? `${imp.sharpe_delta >= 0 ? "+" : ""}${imp.sharpe_delta.toFixed ? .toFixed(2) : "—"} vs baseline` : ""}
          color={si && si.sharpe_ratio >= 1.5 ? C.primary : si && si.sharpe_ratio >= 0.5 ? C.gold : C.tertiary} />
        <StatCard label="Max Drawdown"
          value={si ? `${si.safeFixed(max_drawdown_pct, 1)}%` : "—"}
          sub={imp ? `${imp.max_dd_improvement >= 0 ? "" : "+"}${(-imp.max_dd_improvement).toFixed(1)}% vs baseline` : ""}
          color={si && si.max_drawdown_pct < 5 ? C.primary : si && si.max_drawdown_pct < 10 ? C.gold : C.tertiary} />
        <StatCard label="Signals Filtered"
          value={imp ? `${imp.safeFixed(signals_filtered_pct, 0)}%` : "—"}
          sub={si && bl ? `${si.trades_taken} of ${bl.trades_taken} trades` : ""}
          color={C.secondary} />
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 p-1 rounded" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {(["overview", "equity", "regimes", "setups", "leaderboard", "feed"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-3 py-1.5 rounded text-xs transition-colors"
            style={{
              backgroundColor: activeTab === tab ? "rgba(156,255,147,0.1)" : "transparent",
              color: activeTab === tab ? C.primary : C.outline,
              border: activeTab === tab ? `1px solid rgba(156,255,147,0.2)` : "1px solid transparent",
              fontFamily: "Space Grotesk", textTransform: "uppercase", letterSpacing: "0.1em",
            }}>
            {tab === "feed" ? `Feed (${siEvents.length})` : tab}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setBacktestDays(d)}
              className="px-2 py-1 rounded text-xs"
              style={{
                backgroundColor: backtestDays === d ? "rgba(102,157,255,0.15)" : "transparent",
                color: backtestDays === d ? C.secondary : C.outline,
                fontFamily: "JetBrains Mono, monospace",
              }}>
              {d}d
            </button>
          ))}
          <button onClick={runBacktest} disabled={isRunning}
            className="px-3 py-1 rounded text-xs"
            style={{
              backgroundColor: isRunning ? C.outlineVar : "rgba(156,255,147,0.15)",
              color: isRunning ? C.outline : C.primary,
              fontFamily: "Space Grotesk",
            }}>
            {isRunning ? "Running..." : "Run Backtest"}
          </button>
        </div>
      </div>

      {/* ── Tab Content ── */}

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Baseline vs SI Comparison Table */}
          <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <MicroLabel>Baseline vs Super Intelligence</MicroLabel>
            <div className="mt-3 space-y-2">
              {bl && si && ([
                ["Win Rate", `${(bl.win_rate * 100).toFixed(1)}%`, `${(si.win_rate * 100).toFixed(1)}%`, si.win_rate > bl.win_rate],
                ["Profit Factor", bl.profit_factor.toFixed ? .toFixed(2) : "—", si.profit_factor.toFixed ? .toFixed(2) : "—", si.profit_factor > bl.profit_factor],
                ["Sharpe Ratio", bl.sharpe_ratio.toFixed ? .toFixed(2) : "—", si.sharpe_ratio.toFixed ? .toFixed(2) : "—", si.sharpe_ratio > bl.sharpe_ratio],
                ["Max Drawdown", `${bl.safeFixed(max_drawdown_pct, 1)}%`, `${si.safeFixed(max_drawdown_pct, 1)}%`, si.max_drawdown_pct < bl.max_drawdown_pct],
                ["Avg Win", `${bl.avg_win_pct.toFixed ? .toFixed(2) : "—"}%`, `${si.avg_win_pct.toFixed ? .toFixed(2) : "—"}%`, si.avg_win_pct > bl.avg_win_pct],
                ["Avg Loss", `${bl.avg_loss_pct.toFixed ? .toFixed(2) : "—"}%`, `${si.avg_loss_pct.toFixed ? .toFixed(2) : "—"}%`, si.avg_loss_pct < bl.avg_loss_pct],
                ["Total PnL", `${bl.safeFixed(total_pnl_pct, 1)}%`, `${si.safeFixed(total_pnl_pct, 1)}%`, si.total_pnl_pct > bl.total_pnl_pct],
                ["Trades", String(bl.trades_taken), String(si.trades_taken), true],
                ["Avg Edge", bl.safeFixed(avg_edge_score, 3), si.safeFixed(avg_edge_score, 3), si.avg_edge_score > bl.avg_edge_score],
              ] as [string, string, string, boolean][]).map(([label, baseVal, siVal, better]) => (
                <div key={label} className="flex items-center justify-between py-1"
                  style={{ borderBottom: `1px solid ${C.outlineVar}`, fontSize: "11px" }}>
                  <span style={{ color: C.outline, fontFamily: "Space Grotesk" }}>{label}</span>
                  <div className="flex gap-4">
                    <span style={{ color: C.muted, fontFamily: "JetBrains Mono, monospace", width: "70px", textAlign: "right" }}>{baseVal}</span>
                    <span style={{
                      color: better ? C.primary : C.tertiary,
                      fontFamily: "JetBrains Mono, monospace", fontWeight: 600, width: "70px", textAlign: "right",
                    }}>{siVal}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Statistical Significance + Production Gate */}
          <div className="space-y-4">
            <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <MicroLabel>Statistical Significance</MicroLabel>
              {bt?.significance && (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between" style={{ fontSize: "11px" }}>
                    <span style={{ color: C.outline }}>Z-Score</span>
                    <span style={{ color: C.secondary, fontFamily: "JetBrains Mono, monospace" }}>
                      {bt.significance.safeFixed(z_score, 3)}
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: "11px" }}>
                    <span style={{ color: C.outline }}>P-Value</span>
                    <span style={{ color: C.secondary, fontFamily: "JetBrains Mono, monospace" }}>
                      {bt.significance.safeFixed(p_value, 4)}
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: "11px" }}>
                    <span style={{ color: C.outline }}>Confidence</span>
                    <span style={{
                      color: bt.significance.is_significant ? C.primary : C.gold,
                      fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                    }}>
                      {bt.significance.confidence_level}
                    </span>
                  </div>
                  <div className="mt-2 px-3 py-2 rounded" style={{
                    fontSize: "10px",
                    backgroundColor: bt.significance.is_significant ? "rgba(156,255,147,0.08)" : "rgba(251,191,36,0.08)",
                    color: bt.significance.is_significant ? C.primary : C.gold,
                    border: `1px solid ${bt.significance.is_significant ? "rgba(156,255,147,0.15)" : "rgba(251,191,36,0.15)"}`,
                  }}>
                    {bt.significance.is_significant
                      ? "SI improvement is statistically significant (p < 0.05)"
                      : "More data needed for statistical significance"}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <MicroLabel>Production Gate Config</MicroLabel>
              <div className="mt-3 space-y-2" style={{ fontSize: "11px" }}>
                <div className="flex justify-between">
                  <span style={{ color: C.outline }}>Daily Trades</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                    {prodStats?.daily_trades ?? 0}/{prodStats?.max_daily_trades ?? 15}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.outline }}>Min Win Prob</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                    {((prodStats?.min_win_prob ?? 0.57) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.outline }}>Min Edge</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                    {prodStats?.min_edge ?? 0.08}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.outline }}>Ensemble Samples</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                    {ens?.samples?.toLocaleString() ?? "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EQUITY CURVE TAB */}
      {activeTab === "equity" && equityOverlay.length > 0 && (
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <MicroLabel>Equity Curve — Baseline vs Super Intelligence ($10,000 start)</MicroLabel>
            <div className="flex gap-3" style={{ fontSize: "10px" }}>
              <span style={{ color: C.muted }}>● Baseline</span>
              <span style={{ color: C.primary }}>● Super Intelligence</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={equityOverlay} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="gradBaseline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.muted} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={C.muted} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradSI" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.primary} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
              <XAxis dataKey="idx" tick={{ fontSize: 9, fill: C.outline }} stroke={C.outlineVar} />
              <YAxis tick={{ fontSize: 9, fill: C.outline }} stroke={C.outlineVar}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip contentStyle={{ backgroundColor: C.cardHigh, border: `1px solid ${C.border}`,
                fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}
                formatter={(v: number) => [`$${v.toFixed ? .toFixed(2) : "—"}`, ""]}
                labelFormatter={(l) => `Trade #${l}`} />
              <Area type="monotone" dataKey="baseline" stroke={C.muted} fill="url(#gradBaseline)"
                strokeWidth={1.5} dot={false} name="Baseline" />
              <Area type="monotone" dataKey="si" stroke={C.primary} fill="url(#gradSI)"
                strokeWidth={2} dot={false} name="Super Intelligence" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* REGIMES TAB */}
      {activeTab === "regimes" && regimeData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <MicroLabel>Win Rate by Regime — Baseline vs SI</MicroLabel>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={regimeData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                <XAxis dataKey="regime" tick={{ fontSize: 8, fill: C.outline }} stroke={C.outlineVar} />
                <YAxis tick={{ fontSize: 9, fill: C.outline }} stroke={C.outlineVar}
                  tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={{ backgroundColor: C.cardHigh, border: `1px solid ${C.border}`,
                  fontSize: "11px" }} />
                <Bar dataKey="baseline_wr" name="Baseline" fill={C.muted} radius={[2, 2, 0, 0]} />
                <Bar dataKey="si_wr" name="SI" fill={C.primary} radius={[2, 2, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <MicroLabel>Profit Factor by Regime — Baseline vs SI</MicroLabel>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={regimeData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                <XAxis dataKey="regime" tick={{ fontSize: 8, fill: C.outline }} stroke={C.outlineVar} />
                <YAxis tick={{ fontSize: 9, fill: C.outline }} stroke={C.outlineVar} />
                <Tooltip contentStyle={{ backgroundColor: C.cardHigh, border: `1px solid ${C.border}`,
                  fontSize: "11px" }} />
                <Bar dataKey="baseline_pf" name="Baseline PF" fill={C.muted} radius={[2, 2, 0, 0]} />
                <Bar dataKey="si_pf" name="SI PF" fill={C.secondary} radius={[2, 2, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* SETUPS TAB */}
      {activeTab === "setups" && setupData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <MicroLabel>Win Rate by Setup Type — Baseline vs SI</MicroLabel>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={setupData} layout="vertical" margin={{ top: 10, right: 10, bottom: 5, left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                <XAxis type="number" tick={{ fontSize: 9, fill: C.outline }} stroke={C.outlineVar}
                  tickFormatter={(v: number) => `${v}%`} />
                <YAxis dataKey="setup" type="category" tick={{ fontSize: 8, fill: C.outline }} stroke={C.outlineVar} />
                <Tooltip contentStyle={{ backgroundColor: C.cardHigh, border: `1px solid ${C.border}`,
                  fontSize: "11px" }} />
                <Bar dataKey="baseline_wr" name="Baseline" fill={C.muted} radius={[0, 2, 2, 0]} />
                <Bar dataKey="si_wr" name="SI" fill={C.primary} radius={[0, 2, 2, 0]} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <MicroLabel>Trade Count by Setup — Baseline vs SI</MicroLabel>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={setupData} layout="vertical" margin={{ top: 10, right: 10, bottom: 5, left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                <XAxis type="number" tick={{ fontSize: 9, fill: C.outline }} stroke={C.outlineVar} />
                <YAxis dataKey="setup" type="category" tick={{ fontSize: 8, fill: C.outline }} stroke={C.outlineVar} />
                <Tooltip contentStyle={{ backgroundColor: C.cardHigh, border: `1px solid ${C.border}`,
                  fontSize: "11px" }} />
                <Bar dataKey="baseline_trades" name="Baseline" fill={C.muted} radius={[0, 2, 2, 0]} />
                <Bar dataKey="si_trades" name="SI" fill={C.gold} radius={[0, 2, 2, 0]} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* LEADERBOARD TAB */}
      {activeTab === "leaderboard" && leaderboard && leaderboard.length > 0 && (
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <MicroLabel>Strategy Leaderboard</MicroLabel>
            <span style={{ fontSize: "10px", color: C.outline }}>
              Top {leaderboard.length} strategies by performance
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.outlineVar}` }}>
                  <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: 600 }}>Rank</th>
                  <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: 600 }}>Strategy</th>
                  <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: 600 }}>Win Rate</th>
                  <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: 600 }}>Profit Factor</th>
                  <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: 600 }}>Sharpe</th>
                  <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: 600 }}>Trades</th>
                  <th style={{ padding: "8px", textAlign: "center", color: C.outline, fontWeight: 600 }}>Rating</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((item) => (
                  <tr key={item.rank} style={{ borderBottom: `1px solid ${C.outlineVar}` }}>
                    <td style={{ padding: "8px", color: C.secondary }}>{item.rank}</td>
                    <td style={{ padding: "8px", color: C.muted }}>{item.strategy}</td>
                    <td style={{
                      padding: "8px", textAlign: "right",
                      color: item.win_rate > 0.6 ? C.primary : item.win_rate > 0.5 ? C.gold : C.tertiary,
                    }}>
                      {(item.win_rate * 100).toFixed(1)}%
                    </td>
                    <td style={{
                      padding: "8px", textAlign: "right",
                      color: item.profit_factor > 1.2 ? C.primary : item.profit_factor > 0.9 ? C.gold : C.tertiary,
                    }}>
                      {item.profit_factor.toFixed ? .toFixed(2) : "—"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", color: C.secondary }}>
                      {item.sharpe.toFixed ? .toFixed(2) : "—"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", color: C.muted }}>
                      {item.trades}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", color: C.gold }}>
                      {Array(item.stars).fill("★").join("")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LIVE FEED TAB */}
      {activeTab === "feed" && (
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <MicroLabel>Real-Time SI Decision Feed</MicroLabel>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{
                backgroundColor: sseConnected ? C.primary : C.tertiary,
              }} />
              <span style={{ fontSize: "9px", color: C.outline }}>
                {sseConnected ? `Connected · ${siEvents.length} events` : "Disconnected"}
              </span>
            </div>
          </div>
          {siEvents.length === 0 ? (
            <div className="py-8 text-center" style={{ fontSize: "12px", color: C.outline }}>
              Waiting for SI decisions... Run the live analyzer to see events here.
            </div>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {siEvents.map((evt, i) => (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded"
                  style={{ backgroundColor: i % 2 === 0 ? "rgba(0,0,0,0.2)" : "transparent", fontSize: "11px" }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{
                    backgroundColor: evt.approved ? C.primary : C.tertiary,
                  }} />
                  <span style={{ color: "#fff", fontFamily: "JetBrains Mono, monospace", width: "60px" }}>
                    {evt.symbol?.slice(0, 8) ?? "—"}
                  </span>
                  <span style={{ color: evt.direction === "long" ? C.primary : C.tertiary, width: "40px",
                    fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase" }}>
                    {evt.direction}
                  </span>
                  <span style={{ color: C.outline, width: "100px" }}>
                    {evt.setup_type?.replace(/_/g, " ") ?? "—"}
                  </span>
                  <span style={{ color: C.secondary, fontFamily: "JetBrains Mono, monospace", width: "55px" }}>
                    {(evt.win_probability * 100).toFixed(1)}%
                  </span>
                  <span style={{ color: evt.edge_score > 0 ? C.primary : C.tertiary,
                    fontFamily: "JetBrains Mono, monospace", width: "55px" }}>
                    E:{evt.safeFixed(edge_score, 3)}
                  </span>
                  <span style={{ color: C.gold, fontFamily: "JetBrains Mono, monospace", width: "50px" }}>
                    K:{evt.safeFixed(kelly_pct, 1)}%
                  </span>
                  <span style={{ color: C.outline, width: "70px" }}>
                    {evt.regime?.replace(/_/g, " ") ?? "—"}
                  </span>
                  <span className="flex-1 text-right" style={{
                    color: evt.approved ? C.primary : C.tertiary,
                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                  }}>
                    {evt.approved ? "APPROVED" : "REJECTED"}
                  </span>
                  <span style={{ color: C.outlineVar, fontSize: "9px", width: "55px", textAlign: "right" }}>
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer: Generated At ── */}
      {bt?.generated_at && (
        <div style={{ fontSize: "9px", color: C.outlineVar, textAlign: "right" }}>
          Backtest generated {new Date(bt.generated_at).toLocaleString()} · {backtestDays}d lookback
        </div>
      )}
    </div>
  );
}
