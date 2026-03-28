import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import TradingViewChart from "@/components/TradingViewChart";
import SKOrderFlowPanel from "@/components/SKOrderFlowPanel";
import ExecutionPanel from "@/components/ExecutionPanel";
import PriceLatencyPanel from "@/components/PriceLatencyPanel";
import ReversalCloudPanel from "@/components/ReversalCloudPanel";
import BookmapPanel from "@/components/BookmapPanel";
import CVDPanel from "@/components/CVDPanel";
import VolumeProfilePanel from "@/components/VolumeProfilePanel";
import CandleIntelligencePanel from "@/components/CandleIntelligencePanel";
import ReplayEngine from "@/components/ReplayEngine";

const BASE = "/api";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  cardLow: "#131314",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

type AnalyzeResult = {
  instrument: string; alpaca_symbol: string; analyzed_at: string; regime: string; regime_label: string;
  indicator_hints?: string[];
  bars_analyzed: Record<string, number>; recall_features: Record<string, any>;
  setups_detected: number; setups_blocked: Array<{ setup_type: string; reason: string }>;
  high_conviction: Array<SetupResult>; setups: Array<SetupResult>;
};
type ClaudeVeto = {
  verdict: "APPROVED" | "VETOED" | "CAUTION";
  confidence: number;
  claude_score: number;
  reasoning: string;
  key_factors: string[];
  latency_ms: number;
};
type SetupResult = {
  setup_type: string; direction: string; structure_score: number; order_flow_score: number;
  recall_score: number; final_quality: number; final_quality_with_claude: number;
  quality_threshold: number; meets_threshold: boolean;
  entry_price: number; stop_loss: number; take_profit: number; tp_ticks: number; sl_ticks: number;
  bar_time: string; atr: number; claude?: ClaudeVeto;
};
type BacktestResult = {
  instrument: string; setup_type: string; days_analyzed: number; bars_scanned: number;
  history_range?: { start: string; end: string };
  indicator_hints?: string[];
  total_signals: number; closed_signals: number; wins: number; losses: number; win_rate: number;
  profit_factor: number; expectancy_ticks: number; expectancy_dollars: number;
  gross_pnl_dollars: number; avg_win_dollars: number; avg_loss_dollars: number;
  avg_final_quality: number;
  fake_entries?: number;
  fake_entry_rate?: number;
  fake_entry_loss_rate?: number;
  claude_reviewed_signals?: number;
  claude_win_rate?: number;
  high_conviction_signals: number; high_conviction_win_rate: number;
  equity_curve: Array<{ date: string; pnl: number; equity: number }>;
  by_regime: Array<{ regime: string; total: number; wins: number; win_rate: number }>;
  results: Array<{
    bar_time: string;
    entry_price: number;
    direction: string;
    structure_score: number;
    order_flow_score: number;
    recall_score: number;
    ml_probability: number;
    final_quality: number;
    final_quality_with_claude?: number;
    claude_verdict?: "APPROVED" | "VETOED" | "CAUTION";
    claude_score?: number;
    meets_threshold: boolean;
    regime: string;
    outcome: string;
    tp_ticks: number;
    sl_ticks: number;
    pnl_dollars: number;
    is_fake_entry?: boolean;
    fake_entry_reason?: string | null;
    adverse_move_pct?: number;
  }>;
  backtest_trace?: {
    bars: Array<{ time: number; ts: string; open: number; high: number; low: number; close: number; volume: number }>;
    order_blocks: Array<{ time: number; ts: string; side: "bullish" | "bearish"; low: number; high: number; mid: number; strength: number }>;
    positions: Array<{
      entry_time: string;
      exit_time: string | null;
      direction: "long" | "short";
      entry_price: number;
      stop_loss: number;
      take_profit: number;
      outcome: "win" | "loss" | "open";
      pnl_dollars: number;
      bars_to_outcome: number;
      is_fake_entry: boolean;
      fake_entry_reason: string | null;
      claude_verdict?: "APPROVED" | "VETOED" | "CAUTION";
      claude_score?: number;
      claude_confidence?: number;
      final_quality: number;
      final_quality_with_claude?: number;
      regime: string;
      ml_probability: number;
    }>;
    fake_entries: Array<{ entry_time: string; direction: "long" | "short"; entry_price: number; fake_entry_reason: string | null }>;
    claude_reviews: Array<{
      result_index: number;
      entry_time: string;
      direction: "long" | "short";
      verdict: "APPROVED" | "VETOED" | "CAUTION";
      confidence: number;
      claude_score: number;
      reasoning: string;
      key_factors: string[];
      latency_ms: number;
    }>;
    claude_reviewed_signals: number;
    claude_backtest_enabled: boolean;
  };
};
type AccuracyResult = {
  total_records: number; closed: number; wins: number; losses: number; win_rate: number; profit_factor: number;
  by_setup: Array<{ setup_type: string; total: number; wins: number; win_rate: number; avg_quality: number; expectancy_ticks: number }>;
  by_symbol: Array<{ symbol: string; total: number; wins: number; win_rate: number }>;
  by_regime: Array<{ regime: string; total: number; wins: number; win_rate: number; avg_quality: number }>;
  recent: Array<{ bar_time: string; setup_type: string; symbol: string; outcome: string; final_quality: string; regime?: string; direction?: string }>;
};
type RecallBuildResult = {
  status: string; symbols_processed: number; total_records_saved: number; years_back: number;
  indicator_hints?: string[];
  summary: Record<string, { bars_fetched?: number; signals_detected?: number; closed?: number; wins?: number; win_rate?: string; by_setup?: Array<{ setup: string; total: number; wins: number; win_rate: string }>; date_range?: { start: string; end: string }; timeframe?: string; error?: string }>;
};
type BatchSetupSummary = {
  setup_type: string;
  total_signals: number;
  closed_signals: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  gross_pnl_dollars: number;
  expectancy_dollars: number;
  fake_entries: number;
  fake_entry_rate: number;
  high_conviction_signals: number;
  high_conviction_win_rate: number;
  claude_reviewed: number;
  claude_approved_rate: number;
  rank_score: number;
};
type BatchSymbolSummary = {
  instrument: string;
  alpaca_symbol: string;
  status: "ok" | "insufficient_data";
  bars_scanned: number;
  setup_summaries: BatchSetupSummary[];
  best_setup: BatchSetupSummary | null;
};
type BatchBacktestResult = {
  symbols_requested: string[];
  setups_requested: string[];
  days_analyzed: number;
  history_range: { start: string; end: string };
  indicator_hints?: string[];
  claude_enabled: boolean;
  generated_at: string;
  runtime_ms: number;
  symbol_summaries: BatchSymbolSummary[];
  aggregate: {
    symbols_completed: number;
    symbols_failed: number;
    total_signals: number;
    closed_signals: number;
    wins: number;
    losses: number;
    win_rate: number;
    gross_pnl_dollars: number;
    fake_entries: number;
    fake_entry_rate: number;
    claude_reviewed_signals: number;
    high_conviction_signals: number;
  };
};

const INSTRUMENTS = [
  { value: "BTCUSDT", label: "BTC/USD · Live", live: true },
  { value: "ETHUSDT", label: "ETH/USD · Live", live: true },
  { value: "MES", label: "MES → SPY", live: false },
  { value: "MNQ", label: "MNQ → QQQ", live: false },
];

const ALPACA_SYMBOL_BY_INSTRUMENT: Record<string, string> = {
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
  MES: "SPY",
  MNQ: "QQQ",
};

const TV_SYMBOL_BY_INSTRUMENT: Record<string, string> = {
  BTCUSDT: "COINBASE:BTCUSD",
  ETHUSDT: "COINBASE:ETHUSD",
  MES: "CME_MINI:MES1!",
  MNQ: "CME_MINI:MNQ1!",
};

const DEFAULT_TV_STUDIES = [
  "Volume@tv-basicstudies",
  "RSI@tv-basicstudies",
];

const SETUPS = ["absorption_reversal", "sweep_reclaim", "continuation_pullback", "cvd_divergence", "breakout_failure"];

const REGIME_COLORS: Record<string, string> = {
  trending_bull: C.primary, trending_bear: C.tertiary, ranging: C.secondary, volatile: "#fbbf24", chop: C.outline,
};
const REGIME_ICONS: Record<string, string> = {
  trending_bull: "trending_up", trending_bear: "trending_down", ranging: "swap_horiz", volatile: "bolt", chop: "waves",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

function RegimeBadge({ regime }: { regime: string }) {
  const color = REGIME_COLORS[regime] ?? C.muted;
  const icon = REGIME_ICONS[regime] ?? "circle";
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded" style={{
      fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
      backgroundColor: `${color}14`, color, border: `1px solid ${color}30`,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>{icon}</span>
      {regime.replace(/_/g, " ")}
    </span>
  );
}

function QualityBar({ value, threshold }: { value: number; threshold?: number }) {
  const pct = Math.round(value * 100);
  const meets = threshold !== undefined ? value >= threshold : pct >= 65;
  const color = meets ? C.primary : pct >= 50 ? "#fbbf24" : C.tertiary;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full h-1 overflow-hidden relative" style={{ backgroundColor: "rgba(72,72,73,0.4)" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, transition: "width 0.3s" }} />
        {threshold !== undefined && (
          <div className="absolute top-0 h-full w-px" style={{ left: `${Math.round(threshold * 100)}%`, backgroundColor: "rgba(255,255,255,0.3)" }} />
        )}
      </div>
      <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color, minWidth: "30px", textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function SelectInput({ label, value, onChange, children }: { label: string; value: string | number; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded px-3 py-2 outline-none text-xs"
        style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "Space Grotesk" }}>
        {children}
      </select>
    </div>
  );
}

function ActionBtn({ onClick, pending, pendingLabel, label, color, icon }: { onClick: () => void; pending: boolean; pendingLabel: string; label: string; color: string; icon: string }) {
  return (
    <button onClick={onClick} disabled={pending}
      className="flex items-center justify-center gap-1.5 w-full rounded py-2 transition-all hover:brightness-110 disabled:opacity-50 font-bold"
      style={{ backgroundColor: `${color}14`, border: `1px solid ${color}30`, color, fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.12em", textTransform: "uppercase" }}>
      {pending ? (
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
      ) : (
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{icon}</span>
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}

function parseStudies(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSymbolList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function toTvSymbol(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (!normalized) return "COINBASE:BTCUSD";
  if (normalized.includes(":")) return normalized;
  if (TV_SYMBOL_BY_INSTRUMENT[normalized]) return TV_SYMBOL_BY_INSTRUMENT[normalized];
  if (normalized.endsWith("USDT")) return `BINANCE:${normalized}`;
  if (normalized.endsWith("USD")) return `COINBASE:${normalized}`;
  if (/^[A-Z]{1,5}$/.test(normalized)) return `NASDAQ:${normalized}`;
  return normalized;
}

type Tab = "live" | "backtest" | "matrix" | "accuracy" | "recall" | "heatmap" | "replay";

export default function AlpacaPage() {
  const [instrument, setInstrument] = useState("BTCUSDT");
  const [selectedSetup, setSelectedSetup] = useState("absorption_reversal");
  const [backtestDays, setBacktestDays] = useState(3);
  const [activeTab, setActiveTab] = useState<Tab>("live");
  const [recallYears, setRecallYears] = useState(1);
  const [showAllSetups, setShowAllSetups] = useState(false);
  const [executingSetup, setExecutingSetup] = useState<SetupResult | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<"1" | "5" | "15" | "60" | "D">("5");
  const [tvSymbolInput, setTvSymbolInput] = useState("COINBASE:BTCUSD");
  const [tvStudiesInput, setTvStudiesInput] = useState(DEFAULT_TV_STUDIES.join(", "));
  const [useChartSymbolForAnalysis, setUseChartSymbolForAnalysis] = useState(true);
  const [matrixSymbolsInput, setMatrixSymbolsInput] = useState("BTCUSDT,ETHUSDT,SOLUSDT,MES,MNQ");

  const fallbackTvSymbol = TV_SYMBOL_BY_INSTRUMENT[instrument] ?? "COINBASE:BTCUSD";
  const tvSymbol = tvSymbolInput.trim() || fallbackTvSymbol;
  const alpacaSymbol = ALPACA_SYMBOL_BY_INSTRUMENT[instrument] ?? "BTCUSD";
  const analysisInstrument = useChartSymbolForAnalysis ? tvSymbol : instrument;
  const tvStudies = useMemo(() => {
    const parsed = parseStudies(tvStudiesInput);
    return parsed.length > 0 ? parsed : DEFAULT_TV_STUDIES;
  }, [tvStudiesInput]);
  const matrixSymbols = useMemo(() => parseSymbolList(matrixSymbolsInput), [matrixSymbolsInput]);
  const matrixTvSymbols = useMemo(() => matrixSymbols.map((symbol) => toTvSymbol(symbol)).slice(0, 6), [matrixSymbols]);

  const { data: accuracy, refetch: refetchAccuracy } = useQuery<AccuracyResult>({
    queryKey: ["alpaca-accuracy"],
    queryFn: () => fetch(`${BASE}/alpaca/accuracy`).then((r) => r.json()),
  });

  const { data: microstructure } = useQuery({
    queryKey: ["microstructure", alpacaSymbol],
    queryFn: () => fetch(`${BASE}/market/microstructure?symbol=${alpacaSymbol}`).then((r) => r.json()),
    refetchInterval: 8000,
    staleTime: 7000,
  });

  const analyzeMutation = useMutation<AnalyzeResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument: analysisInstrument, setups: SETUPS, indicator_hints: tvStudies }),
      }).then((r) => r.json()),
  });
  const backtestMutation = useMutation<BacktestResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: analysisInstrument,
          setup_type: selectedSetup,
          days: backtestDays,
          indicator_hints: tvStudies,
          include_claude_history: true,
          claude_history_max: 40,
        }),
      }).then((r) => {
        refetchAccuracy();
        return r.json();
      }),
  });
  const recallBuildMutation = useMutation<RecallBuildResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/recall-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [analysisInstrument], timeframe: "15Min", years: recallYears, indicator_hints: tvStudies }),
      }).then((r) => {
        refetchAccuracy();
        return r.json();
      }),
  });
  const batchBacktestMutation = useMutation<BatchBacktestResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/backtest-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: matrixSymbols,
          setups: SETUPS,
          days: backtestDays,
          indicator_hints: tvStudies,
          include_claude_history: true,
          claude_sample_per_setup: 4,
        }),
      }).then((r) => r.json()),
  });

  const analyzeData = analyzeMutation.data;
  const btData = backtestMutation.data;
  const batchData = batchBacktestMutation.data;
  const recallData = recallBuildMutation.data;
  const displaySetups = analyzeData ? (showAllSetups ? analyzeData.setups : analyzeData.high_conviction) : [];
  const indicatorFeatures = (analyzeData?.recall_features as Record<string, any> | undefined)?.indicators as
    | {
        rsi_14?: number;
        macd_hist?: number;
        ema_spread_pct?: number;
        bb_width?: number;
        indicator_bias?: string;
      }
    | undefined;
  const indicatorHints = (
    analyzeData?.indicator_hints ??
    ((analyzeData?.recall_features as Record<string, any> | undefined)?.indicator_hints as string[] | undefined) ??
    []
  ) as string[];
  const traceOverlay = useMemo(() => {
    const trace = btData?.backtest_trace;
    const bars = trace?.bars ?? [];
    const viewBars = bars.slice(-600);
    const chartBars = viewBars.map((bar, idx) => ({
      ...bar,
      idx,
      label: new Date(bar.ts).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
    const indexByTs = new Map<string, number>();
    for (const bar of chartBars) indexByTs.set(bar.ts, bar.idx);

    const longEntries: Array<{ idx: number; price: number; label: string }> = [];
    const shortEntries: Array<{ idx: number; price: number; label: string }> = [];
    const fakeEntries: Array<{ idx: number; price: number; label: string }> = [];
    const bullishBlocks: Array<{ idx: number; price: number; strength: number }> = [];
    const bearishBlocks: Array<{ idx: number; price: number; strength: number }> = [];

    for (const position of trace?.positions ?? []) {
      const idx = indexByTs.get(position.entry_time);
      if (idx === undefined) continue;
      const point = { idx, price: position.entry_price, label: position.entry_time };
      if (position.direction === "long") longEntries.push(point);
      else shortEntries.push(point);
      if (position.is_fake_entry) fakeEntries.push(point);
    }

    for (const block of trace?.order_blocks ?? []) {
      const idx = indexByTs.get(block.ts);
      if (idx === undefined) continue;
      const point = { idx, price: block.mid, strength: block.strength };
      if (block.side === "bullish") bullishBlocks.push(point);
      else bearishBlocks.push(point);
    }

    return { chartBars, longEntries, shortEntries, fakeEntries, bullishBlocks, bearishBlocks };
  }, [btData]);

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "live",    label: "Live Analysis",      icon: "sensors" },
    { id: "backtest",label: "Backtest",            icon: "history" },
    { id: "matrix",  label: "Batch Matrix",        icon: "dataset" },
    { id: "heatmap", label: "Volume Profile",      icon: "area_chart" },
    { id: "replay",  label: "Replay · Phase 7",   icon: "play_circle" },
    { id: "accuracy",label: "Accuracy DB",         icon: "database" },
    { id: "recall",  label: "Recall Build",        icon: "psychology" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Intelligence Engine
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Live Intelligence</h1>
          <p style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>Regime detection · SK structure · CVD order flow · Walk-forward accuracy</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ backgroundColor: "rgba(156,255,147,0.06)", border: "1px solid rgba(156,255,147,0.15)" }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Crypto Data Live</span>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SelectInput label="Instrument" value={instrument} onChange={setInstrument}>
            {INSTRUMENTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </SelectInput>
          <SelectInput label="Setup Filter" value={selectedSetup} onChange={setSelectedSetup}>
            {SETUPS.map((s) => <option key={s} value={s}>{s === "cvd_divergence" ? "CVD Divergence ★" : s === "breakout_failure" ? "Breakout Failure ★" : s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>)}
          </SelectInput>
          <SelectInput label="Backtest Days" value={backtestDays} onChange={(v) => setBacktestDays(Number(v))}>
            {[1, 2, 3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
          </SelectInput>
          <SelectInput label="Recall History" value={recallYears} onChange={(v) => setRecallYears(Number(v))}>
            <option value={0.5}>6 months</option>
            <option value={1}>1 year</option>
            <option value={2}>2 years</option>
          </SelectInput>
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <ActionBtn onClick={() => { analyzeMutation.mutate(); setActiveTab("live"); }} pending={analyzeMutation.isPending} pendingLabel="Scanning..." label="Scan Now" color={C.secondary} icon="radar" />
              <ActionBtn onClick={() => { backtestMutation.mutate(); setActiveTab("backtest"); }} pending={backtestMutation.isPending} pendingLabel="Running..." label="Backtest" color="#a78bfa" icon="history" />
            </div>
            <div className="flex gap-1.5">
              <ActionBtn onClick={() => { batchBacktestMutation.mutate(); setActiveTab("matrix"); }} pending={batchBacktestMutation.isPending} pendingLabel="Building Matrix..." label="Batch Learn" color="#34d399" icon="dataset" />
              <ActionBtn onClick={() => { recallBuildMutation.mutate(); setActiveTab("recall"); }} pending={recallBuildMutation.isPending} pendingLabel="Building Recall..." label="Build Recall Memory" color="#fbbf24" icon="psychology" />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 w-fit rounded" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all"
            style={{
              fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
              backgroundColor: activeTab === tab.id ? "rgba(156,255,147,0.1)" : "transparent",
              color: activeTab === tab.id ? C.primary : C.outline,
              border: activeTab === tab.id ? "1px solid rgba(156,255,147,0.2)" : "1px solid transparent",
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── LIVE ANALYSIS ── */}
      {activeTab === "live" && (
        <div className="space-y-4">
          {/* ── Price Latency Comparison ─────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined" style={{ fontSize: "13px", color: C.secondary }}>speed</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Feed Latency · WS vs REST · Alpaca → Coinbase
              </span>
            </div>
            <PriceLatencyPanel symbol={alpacaSymbol} />
          </div>

          {/* TradingView Chart — live prices matching TradingView.com */}
          <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="px-4 py-2.5 space-y-2" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>candlestick_chart</span>
                  <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                    {tvSymbol} · TradingView
                  </span>
                  <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.outlineVar }}>
                    Any symbol via EXCHANGE:TICKER
                  </span>
                </div>
                <div className="flex gap-1">
                  {(["1","5","15","60","D"] as const).map((tf) => (
                    <button key={tf} onClick={() => setChartTimeframe(tf)}
                      style={{
                        fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, padding: "3px 8px", borderRadius: "3px",
                        backgroundColor: chartTimeframe === tf ? "rgba(156,255,147,0.12)" : "transparent",
                        color: chartTimeframe === tf ? C.primary : C.outline,
                        border: `1px solid ${chartTimeframe === tf ? "rgba(156,255,147,0.25)" : "transparent"}`,
                        cursor: "pointer", letterSpacing: "0.05em",
                      }}>
                      {tf === "60" ? "1H" : tf === "D" ? "1D" : `${tf}M`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <MicroLabel>Chart Symbol (EXCHANGE:TICKER)</MicroLabel>
                  <input
                    value={tvSymbolInput}
                    onChange={(e) => setTvSymbolInput(e.target.value.toUpperCase())}
                    placeholder="NASDAQ:AAPL or BINANCE:SOLUSDT"
                    className="mt-1.5 w-full rounded px-3 py-2 outline-none text-xs"
                    style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace" }}
                  />
                </div>
                <div>
                  <MicroLabel>Indicators (comma-separated)</MicroLabel>
                  <input
                    value={tvStudiesInput}
                    onChange={(e) => setTvStudiesInput(e.target.value)}
                    placeholder="Volume@tv-basicstudies, RSI@tv-basicstudies"
                    className="mt-1.5 w-full rounded px-3 py-2 outline-none text-xs"
                    style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace" }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setTvSymbolInput(fallbackTvSymbol)}
                  className="px-2 py-1 rounded"
                  style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase", color: C.secondary, border: "1px solid rgba(102,157,255,0.25)", backgroundColor: "rgba(102,157,255,0.08)" }}
                >
                  Sync Symbol To Instrument
                </button>
                <button
                  onClick={() => setTvStudiesInput(DEFAULT_TV_STUDIES.join(", "))}
                  className="px-2 py-1 rounded"
                  style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, border: `1px solid ${C.border}`, backgroundColor: "rgba(72,72,73,0.08)" }}
                >
                  Default Indicators
                </button>
                <button
                  onClick={() => setTvStudiesInput("Volume@tv-basicstudies, RSI@tv-basicstudies, MACD@tv-basicstudies, BB@tv-basicstudies")}
                  className="px-2 py-1 rounded"
                  style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase", color: C.primary, border: "1px solid rgba(156,255,147,0.25)", backgroundColor: "rgba(156,255,147,0.08)" }}
                >
                  Momentum Bundle
                </button>
                <button
                  onClick={() => setUseChartSymbolForAnalysis((prev) => !prev)}
                  className="px-2 py-1 rounded"
                  style={{
                    fontSize: "8px",
                    fontFamily: "Space Grotesk",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: useChartSymbolForAnalysis ? C.secondary : C.outline,
                    border: `1px solid ${useChartSymbolForAnalysis ? "rgba(102,157,255,0.25)" : "rgba(118,117,118,0.25)"}`,
                    backgroundColor: useChartSymbolForAnalysis ? "rgba(102,157,255,0.08)" : "rgba(72,72,73,0.08)",
                  }}
                >
                  {useChartSymbolForAnalysis ? "Model Uses Chart Symbol" : "Model Uses Instrument"}
                </button>
              </div>
              <p style={{ fontSize: "8px", color: C.secondary, fontFamily: "Space Grotesk" }}>
                Analysis target: {analysisInstrument}
              </p>
              <p style={{ fontSize: "8px", color: C.outlineVar, fontFamily: "Space Grotesk" }}>
                Premium-only TradingView indicators depend on your TradingView account/session and licensing.
              </p>
            </div>
            <TradingViewChart
              symbol={tvSymbol}
              timeframe={chartTimeframe}
              height={480}
              showToolbar={true}
              allowSymbolChange={true}
              studies={tvStudies}
            />
          </div>

          <div className="rounded p-4 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#34d399" }}>grid_view</span>
                <MicroLabel>All Charts Watchlist (TradingView)</MicroLabel>
              </div>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outlineVar }}>
                {matrixTvSymbols.length} charts · synced with Batch Matrix input
              </span>
            </div>
            <input
              value={matrixSymbolsInput}
              onChange={(e) => setMatrixSymbolsInput(e.target.value.toUpperCase())}
              placeholder="BTCUSDT, ETHUSDT, SOLUSDT, MES, MNQ, NASDAQ:AAPL"
              className="w-full rounded px-3 py-2 outline-none text-xs"
              style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace" }}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {matrixTvSymbols.map((symbol) => (
                <div key={symbol} className="rounded overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                  <div className="px-3 py-1.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.2)` }}>
                    <MicroLabel>{symbol}</MicroLabel>
                  </div>
                  <TradingViewChart
                    symbol={symbol}
                    timeframe={chartTimeframe}
                    height={260}
                    showToolbar={false}
                    allowSymbolChange={true}
                    studies={tvStudies}
                  />
                </div>
              ))}
            </div>
          </div>

          {analyzeMutation.isPending && (
            <div className="rounded p-10 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex flex-col items-center gap-3">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary, boxShadow: `0 0 10px ${C.primary}` }} />
                <MicroLabel>Fetching live bars · Detecting regime · Running setup scan</MicroLabel>
              </div>
            </div>
          )}

          {!analyzeMutation.isPending && !analyzeData && (
            <div className="rounded p-14 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <span className="material-symbols-outlined text-4xl mb-3 block" style={{ color: C.outlineVar }}>radar</span>
              <p className="font-headline font-bold text-sm" style={{ color: C.muted }}>Click "Scan Now" to run the full 6-layer pipeline</p>
              <p style={{ fontSize: "9px", color: C.outlineVar, marginTop: "6px", fontFamily: "Space Grotesk" }}>1m · 5m · 15m bars → regime detection → setup scan → quality scoring</p>
            </div>
          )}

          {analyzeData && !(analyzeData as any).error && (
            <>
              {/* Stat row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { label: "Market Regime", value: <RegimeBadge regime={analyzeData.regime} /> },
                  { label: "Bars Loaded", value: <span className="font-headline font-bold text-sm">{Object.values(analyzeData.bars_analyzed).join("/")} <span style={{ fontSize: "9px", color: C.muted }}>1m/5m/15m</span></span> },
                  { label: "High Conviction", value: <span className="font-headline font-bold text-sm" style={{ color: analyzeData.high_conviction.length > 0 ? C.primary : C.muted }}>{analyzeData.high_conviction.length} <span style={{ fontSize: "9px", color: C.muted }}>/ {analyzeData.setups_detected}</span></span> },
                  { label: "Blocked", value: <span className="font-headline font-bold text-sm" style={{ color: analyzeData.setups_blocked.length > 0 ? "#fbbf24" : C.muted }}>{analyzeData.setups_blocked.length}</span> },
                  { label: "Scanned At", value: <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{new Date(analyzeData.analyzed_at).toLocaleTimeString()}</span> },
                ].map((s, i) => (
                  <div key={i} className="rounded p-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                    <MicroLabel>{s.label}</MicroLabel>
                    <div className="mt-2">{s.value}</div>
                  </div>
                ))}
              </div>

              {indicatorFeatures && (
                <div className="rounded p-4 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center justify-between">
                    <MicroLabel>Indicator Inputs Applied To Recall Score</MicroLabel>
                    <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: indicatorFeatures.indicator_bias === "bull" ? C.primary : indicatorFeatures.indicator_bias === "bear" ? C.tertiary : C.muted }}>
                      Bias: {(indicatorFeatures.indicator_bias ?? "neutral").toUpperCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
                      <MicroLabel>RSI 14</MicroLabel>
                      <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#ffffff" }}>
                        {(indicatorFeatures.rsi_14 ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
                      <MicroLabel>MACD Hist</MicroLabel>
                      <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: (indicatorFeatures.macd_hist ?? 0) >= 0 ? C.primary : C.tertiary }}>
                        {(indicatorFeatures.macd_hist ?? 0).toFixed(5)}
                      </div>
                    </div>
                    <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
                      <MicroLabel>EMA Spread %</MicroLabel>
                      <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: (indicatorFeatures.ema_spread_pct ?? 0) >= 0 ? C.primary : C.tertiary }}>
                        {((indicatorFeatures.ema_spread_pct ?? 0) * 100).toFixed(3)}%
                      </div>
                    </div>
                    <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
                      <MicroLabel>BB Width</MicroLabel>
                      <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#ffffff" }}>
                        {(indicatorFeatures.bb_width ?? 0).toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {indicatorHints.length > 0 ? indicatorHints.map((hint) => (
                      <span key={hint} className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.secondary, border: "1px solid rgba(102,157,255,0.25)", backgroundColor: "rgba(102,157,255,0.08)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {hint}
                      </span>
                    )) : (
                      <span style={{ fontSize: "9px", color: C.outlineVar }}>No indicator hints sent.</span>
                    )}
                  </div>
                </div>
              )}

              {/* Blocked setups */}
              {analyzeData.setups_blocked.length > 0 && (
                <div className="rounded p-4 flex items-start gap-3" style={{ backgroundColor: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.2)" }}>
                  <span className="material-symbols-outlined text-base" style={{ color: "#fbbf24" }}>shield</span>
                  <div>
                    <div className="font-headline font-bold text-xs" style={{ color: "#fbbf24", letterSpacing: "0.1em" }}>No-Trade Filters Active</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {analyzeData.setups_blocked.map((b, i) => (
                        <span key={i} className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: "#fbbf24", backgroundColor: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
                          {b.setup_type.replace(/_/g, " ")} — {b.reason.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Toggle */}
              {analyzeData.setups_detected > 0 && (
                <div className="flex items-center justify-between">
                  <MicroLabel>{showAllSetups ? "All detected setups" : "High-conviction only"}</MicroLabel>
                  <button onClick={() => setShowAllSetups(!showAllSetups)} style={{ fontSize: "9px", color: C.secondary, fontFamily: "Space Grotesk", cursor: "pointer" }}>
                    {showAllSetups ? "Show high-conviction only ↑" : "Show all detections ↓"}
                  </button>
                </div>
              )}

              {/* Empty states */}
              {displaySetups.length === 0 && analyzeData.setups_detected === 0 && (
                <div className="rounded p-6 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "11px", color: C.muted }}>No setups detected. Market may be consolidating.</span>
                </div>
              )}
              {displaySetups.length === 0 && analyzeData.setups_detected > 0 && (
                <div className="rounded p-5 text-center" style={{ backgroundColor: C.card, border: "1px solid rgba(251,191,36,0.15)" }}>
                  <span style={{ fontSize: "11px", color: "#fbbf24", fontFamily: "Space Grotesk" }}>
                    {analyzeData.setups_detected} setup{analyzeData.setups_detected > 1 ? "s" : ""} detected but below quality threshold for this regime.
                  </span>
                  <button onClick={() => setShowAllSetups(true)} style={{ fontSize: "9px", color: C.muted, marginLeft: "8px", cursor: "pointer", textDecoration: "underline" }}>View anyway</button>
                </div>
              )}

              {/* Setup cards */}
              {displaySetups.map((setup, i) => (
                <div key={i} className="rounded p-5 space-y-4" style={{ backgroundColor: C.card, border: `1px solid ${setup.meets_threshold ? "rgba(156,255,147,0.2)" : "rgba(251,191,36,0.12)"}` }}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded font-headline font-bold text-xs" style={{ backgroundColor: setup.direction === "long" ? "rgba(156,255,147,0.12)" : "rgba(255,113,98,0.12)", color: setup.direction === "long" ? C.primary : C.tertiary }}>
                        {setup.direction.toUpperCase()}
                      </span>
                      <span className="font-headline font-bold text-sm">{setup.setup_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                      <RegimeBadge regime={analyzeData.regime} />
                    </div>
                    {setup.meets_threshold ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.primary, backgroundColor: "rgba(156,255,147,0.08)", border: "1px solid rgba(156,255,147,0.2)" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>check_circle</span> High Conviction
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#fbbf24", backgroundColor: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>warning</span> Below Threshold
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Structure Score", value: setup.structure_score },
                      { label: "Order Flow", value: setup.order_flow_score },
                      { label: "Recall Score", value: setup.recall_score },
                    ].map((sc) => (
                      <div key={sc.label} className="rounded p-3" style={{ backgroundColor: "#0e0e0f" }}>
                        <MicroLabel>{sc.label}</MicroLabel>
                        <div className="mt-2"><QualityBar value={sc.value} /></div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded p-3" style={{ backgroundColor: "#0e0e0f" }}>
                    <div className="flex justify-between mb-2">
                      <MicroLabel>Final Quality{setup.claude ? " (w/ Claude)" : ""}</MicroLabel>
                      <MicroLabel>Threshold: {Math.round(setup.quality_threshold * 100)}%</MicroLabel>
                    </div>
                    <QualityBar value={setup.final_quality_with_claude ?? setup.final_quality} threshold={setup.quality_threshold} />
                  </div>

                  {/* Claude Reasoning Veto Panel */}
                  {setup.claude && (
                    <div className="rounded p-4 space-y-2.5" style={{
                      backgroundColor: setup.claude.verdict === "APPROVED"
                        ? "rgba(156,255,147,0.04)"
                        : setup.claude.verdict === "VETOED"
                        ? "rgba(255,113,98,0.05)"
                        : "rgba(251,191,36,0.04)",
                      border: `1px solid ${setup.claude.verdict === "APPROVED" ? "rgba(156,255,147,0.15)" : setup.claude.verdict === "VETOED" ? "rgba(255,113,98,0.2)" : "rgba(251,191,36,0.15)"}`,
                    }}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined" style={{ fontSize: "13px", color: "#9cff93" }}>psychology</span>
                          <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", color: "#adaaab", textTransform: "uppercase" }}>Claude Reasoning Layer</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded font-bold" style={{
                            fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.12em", textTransform: "uppercase",
                            color: setup.claude.verdict === "APPROVED" ? "#9cff93" : setup.claude.verdict === "VETOED" ? "#ff7162" : "#fbbf24",
                            backgroundColor: setup.claude.verdict === "APPROVED" ? "rgba(156,255,147,0.12)" : setup.claude.verdict === "VETOED" ? "rgba(255,113,98,0.12)" : "rgba(251,191,36,0.12)",
                            border: `1px solid ${setup.claude.verdict === "APPROVED" ? "rgba(156,255,147,0.3)" : setup.claude.verdict === "VETOED" ? "rgba(255,113,98,0.3)" : "rgba(251,191,36,0.3)"}`,
                          }}>
                            {setup.claude.verdict === "APPROVED" ? "✓ APPROVED" : setup.claude.verdict === "VETOED" ? "✗ VETOED" : "⚠ CAUTION"}
                          </span>
                          <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono, monospace", color: "#adaaab" }}>
                            {Math.round(setup.claude.confidence * 100)}% conf · {setup.claude.latency_ms}ms
                          </span>
                        </div>
                      </div>

                      {setup.claude.reasoning && (
                        <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: "#d0cfd0", lineHeight: "1.5", margin: 0 }}>
                          {setup.claude.reasoning}
                        </p>
                      )}

                      {setup.claude.key_factors && setup.claude.key_factors.length > 0 && (
                        <ul className="space-y-1" style={{ margin: 0, paddingLeft: "12px" }}>
                          {setup.claude.key_factors.map((f, fi) => (
                            <li key={fi} style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: "#adaaab", listStyleType: "disc" }}>
                              {f}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div style={{ fontSize: "8px", fontFamily: "JetBrains Mono, monospace", color: "#adaaab" }}>
                        Claude Score: <span style={{ color: setup.claude.verdict === "APPROVED" ? "#9cff93" : setup.claude.verdict === "VETOED" ? "#ff7162" : "#fbbf24" }}>{Math.round(setup.claude.claude_score * 100)}%</span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Entry", value: `$${setup.entry_price > 1000 ? setup.entry_price.toFixed(2) : setup.entry_price.toFixed(4)}`, color: "#ffffff" },
                      { label: "Take Profit", value: `$${setup.take_profit > 1000 ? setup.take_profit.toFixed(2) : setup.take_profit.toFixed(4)} +${setup.tp_ticks}t`, color: C.primary },
                      { label: "Stop Loss", value: `$${setup.stop_loss > 1000 ? setup.stop_loss.toFixed(2) : setup.stop_loss.toFixed(4)} -${setup.sl_ticks}t`, color: C.tertiary },
                    ].map((f) => (
                      <div key={f.label} className="rounded p-3" style={{ backgroundColor: "#0e0e0f" }}>
                        <MicroLabel>{f.label}</MicroLabel>
                        <div className="mt-1 font-mono-num font-bold text-xs" style={{ color: f.color }}>{f.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Execute button */}
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => setExecutingSetup(executingSetup?.setup_type === setup.setup_type && executingSetup?.direction === setup.direction ? null : setup)}
                      className="flex items-center gap-2 px-4 py-2 rounded font-bold transition-all hover:brightness-110 active:scale-95"
                      style={{
                        backgroundColor: executingSetup?.setup_type === setup.setup_type && executingSetup?.direction === setup.direction
                          ? (setup.direction === "long" ? "rgba(156,255,147,0.2)" : "rgba(255,113,98,0.2)")
                          : (setup.direction === "long" ? "rgba(156,255,147,0.1)" : "rgba(255,113,98,0.1)"),
                        border: `1px solid ${setup.direction === "long" ? "rgba(156,255,147,0.3)" : "rgba(255,113,98,0.3)"}`,
                        color: setup.direction === "long" ? C.primary : C.tertiary,
                        fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase"
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>bolt</span>
                      {executingSetup?.setup_type === setup.setup_type && executingSetup?.direction === setup.direction ? "Close Execution Panel" : "Execute This Signal"}
                    </button>
                  </div>

                  {/* Inline execution panel for this setup */}
                  {executingSetup?.setup_type === setup.setup_type && executingSetup?.direction === setup.direction && (
                    <ExecutionPanel
                      symbol={analyzeData?.alpaca_symbol ?? alpacaSymbol}
                      direction={setup.direction as "long" | "short"}
                      entryPrice={setup.entry_price}
                      stopLossPrice={setup.stop_loss}
                      takeProfitPrice={setup.take_profit}
                      setupType={setup.setup_type}
                      atr={setup.atr}
                      onOrderPlaced={() => setExecutingSetup(null)}
                    />
                  )}
                </div>
              ))}

              {/* ── SK Structure + CVD Order Flow + Microstructure overlay ── */}
              {analyzeData.recall_features?.sk && analyzeData.recall_features?.cvd && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>stacked_bar_chart</span>
                    <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                      Recall Engine · SK Structure + Order Flow + Microstructure
                    </span>
                  </div>
                  <SKOrderFlowPanel
                    recall={analyzeData.recall_features as Parameters<typeof SKOrderFlowPanel>[0]["recall"]}
                    microstructure={(microstructure as Parameters<typeof SKOrderFlowPanel>[0]["microstructure"]) ?? null}
                    entryPrice={displaySetups[0]?.entry_price}
                  />
                </div>
              )}

              {/* ── Phase 5 · Reversal Cloud ─────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#a78bfa" }}>cloud</span>
                  <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                    Phase 5 · Reversal Cloud · SK Zone Probability
                  </span>
                </div>
                <ReversalCloudPanel
                  sk={analyzeData.recall_features?.sk as any}
                  cvd={analyzeData.recall_features?.cvd as any}
                />
              </div>

            </>
          )}

          {/* ── Phase 6 · Bookmap — always visible (live feed) ──────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>bar_chart</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Phase 6 · Live Bookmap · Per-Level Order Flow
              </span>
            </div>
            <BookmapPanel symbol={alpacaSymbol} />
          </div>

          {/* CVD Panel */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>show_chart</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Phase 8 · CVD · Cumulative Volume Delta · Regime Detection
              </span>
            </div>
            <CVDPanel symbol={alpacaSymbol} timeframe="5Min" bars={100} autoRefresh={30} />
          </div>
        </div>
      )}

      {/* ── BACKTEST ── */}
      {activeTab === "backtest" && (
        <div className="space-y-4">
          {backtestMutation.isPending && (
            <div className="rounded p-10 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <span className="w-2 h-2 rounded-full animate-pulse inline-block mb-3" style={{ backgroundColor: "#a78bfa" }} />
              <p style={{ fontSize: "10px", color: C.muted, fontFamily: "Space Grotesk" }}>Running walk-forward backtest...</p>
            </div>
          )}

          {!backtestMutation.isPending && !btData && (
            <div className="rounded p-14 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <span className="material-symbols-outlined text-4xl mb-3 block" style={{ color: C.outlineVar }}>history</span>
              <p style={{ fontSize: "11px", color: C.muted, fontFamily: "Space Grotesk" }}>Select an instrument + setup, then click "Backtest"</p>
            </div>
          )}

          {btData && !(btData as any).error && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Win Rate", value: `${(btData.win_rate * 100).toFixed(1)}%`, sub: `${btData.wins}W · ${btData.losses}L`, accent: btData.win_rate > 0.5 ? C.primary : C.tertiary },
                  { label: "Gross P&L", value: `$${btData.gross_pnl_dollars >= 0 ? "+" : ""}${btData.gross_pnl_dollars.toFixed(0)}`, sub: `${btData.closed_signals} closed`, accent: btData.gross_pnl_dollars >= 0 ? C.primary : C.tertiary },
                  { label: "Expectancy / Trade", value: `$${btData.expectancy_dollars >= 0 ? "+" : ""}${btData.expectancy_dollars.toFixed(2)}`, sub: `${btData.expectancy_ticks.toFixed(1)} ticks`, accent: btData.expectancy_dollars > 0 ? C.primary : C.tertiary },
                  { label: "High Conv. WR", value: `${(btData.high_conviction_win_rate * 100).toFixed(1)}%`, sub: `${btData.high_conviction_signals} signals`, accent: btData.high_conviction_win_rate > 0.6 ? C.primary : C.muted },
                  { label: "Profit Factor", value: btData.profit_factor.toFixed(2), sub: "Gross win ÷ loss", accent: btData.profit_factor > 1 ? C.primary : C.tertiary },
                  { label: "Avg Win", value: `$${btData.avg_win_dollars.toFixed(0)}`, sub: "Per winning trade", accent: C.primary },
                  { label: "Avg Loss", value: `-$${btData.avg_loss_dollars.toFixed(0)}`, sub: "Per losing trade", accent: C.tertiary },
                  { label: "Total Signals", value: String(btData.total_signals), sub: `${btData.days_analyzed}d · ${btData.bars_scanned} bars`, accent: "#ffffff" },
                  { label: "Fake Entry Rate", value: `${((btData.fake_entry_rate ?? 0) * 100).toFixed(1)}%`, sub: `${btData.fake_entries ?? 0} flagged`, accent: (btData.fake_entry_rate ?? 0) < 0.2 ? C.primary : "#fbbf24" },
                  { label: "Claude Reviewed", value: String(btData.claude_reviewed_signals ?? 0), sub: `WR ${((btData.claude_win_rate ?? 0) * 100).toFixed(1)}%`, accent: (btData.claude_win_rate ?? 0) > 0.55 ? C.primary : C.secondary },
                ].map((s, i) => (
                  <div key={i} className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                    <MicroLabel>{s.label}</MicroLabel>
                    <div className="mt-2 font-headline font-bold text-xl" style={{ color: s.accent ?? "#ffffff" }}>{s.value}</div>
                    {s.sub && <div style={{ fontSize: "9px", color: C.outlineVar, marginTop: "3px", fontFamily: "Space Grotesk" }}>{s.sub}</div>}
                  </div>
                ))}
              </div>

              {btData.history_range && (
                <div className="rounded p-3 flex flex-wrap items-center justify-between gap-2" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined" style={{ fontSize: "13px", color: C.secondary }}>schedule</span>
                    <MicroLabel>Historical Window</MicroLabel>
                  </div>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                    {new Date(btData.history_range.start).toLocaleDateString()} → {new Date(btData.history_range.end).toLocaleDateString()}
                  </span>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                    {btData.backtest_trace?.bars?.length ?? 0} bars · {btData.backtest_trace?.order_blocks?.length ?? 0} order blocks
                  </span>
                </div>
              )}

              {/* Equity Curve Sparkline */}
              {btData.equity_curve && btData.equity_curve.length > 1 && (
                <div className="rounded p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>show_chart</span>
                      <MicroLabel>Equity Curve · {btData.closed_signals} trades · Real P&L</MicroLabel>
                    </div>
                    <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: btData.gross_pnl_dollars >= 0 ? C.primary : C.tertiary, fontWeight: 700 }}>
                      {btData.gross_pnl_dollars >= 0 ? "+" : ""}${btData.gross_pnl_dollars.toFixed(0)}
                    </span>
                  </div>
                  <div style={{ height: "160px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={btData.equity_curve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="btEqGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={btData.gross_pnl_dollars >= 0 ? "#9cff93" : "#ff7162"} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={btData.gross_pnl_dollars >= 0 ? "#9cff93" : "#ff7162"} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 4" stroke="rgba(72,72,73,0.3)" vertical={false} />
                        <XAxis dataKey="date" stroke="#484849" fontSize={8} tickLine={false} axisLine={false} fontFamily="Space Grotesk" />
                        <YAxis stroke="#484849" fontSize={8} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} fontFamily="JetBrains Mono, monospace" />
                        <Tooltip contentStyle={{ backgroundColor: "#201f21", borderColor: "rgba(72,72,73,0.4)", borderRadius: "4px", fontSize: "10px" }} itemStyle={{ color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }} />
                        <Area type="monotone" dataKey="equity" stroke={btData.gross_pnl_dollars >= 0 ? "#9cff93" : "#ff7162"} strokeWidth={1.5} fillOpacity={1} fill="url(#btEqGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {traceOverlay.chartBars.length > 20 && (
                <div className="rounded p-5 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>insights</span>
                      <MicroLabel>Backtest Trace · Price + Order Blocks + Positions + Fake Entries</MicroLabel>
                    </div>
                    <div className="flex items-center gap-3" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                      <span>{traceOverlay.chartBars.length} plotted bars</span>
                      <span>{traceOverlay.fakeEntries.length} fake entries</span>
                      <span>{btData.backtest_trace?.claude_reviews?.length ?? 0} Claude reviews</span>
                    </div>
                  </div>
                  <div style={{ height: "300px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={traceOverlay.chartBars} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="rgba(72,72,73,0.3)" vertical={false} />
                        <XAxis
                          type="number"
                          dataKey="idx"
                          tickCount={8}
                          stroke="#484849"
                          fontSize={8}
                          tickLine={false}
                          axisLine={false}
                          fontFamily="Space Grotesk"
                          tickFormatter={(value) => traceOverlay.chartBars[Math.round(Number(value))]?.label?.slice(0, 12) ?? ""}
                        />
                        <YAxis
                          stroke="#484849"
                          fontSize={8}
                          tickLine={false}
                          axisLine={false}
                          fontFamily="JetBrains Mono, monospace"
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#201f21", borderColor: "rgba(72,72,73,0.4)", borderRadius: "4px", fontSize: "10px" }}
                          labelFormatter={(value) => traceOverlay.chartBars[Math.round(Number(value))]?.label ?? String(value)}
                          formatter={(value: number | string, name) => [typeof value === "number" ? value.toFixed(2) : value, name]}
                        />
                        <Line type="monotone" dataKey="close" stroke="#cfd3d8" strokeWidth={1.3} dot={false} name="Price" />
                        <Scatter data={traceOverlay.longEntries} fill={C.primary} name="Long Entry" />
                        <Scatter data={traceOverlay.shortEntries} fill={C.tertiary} name="Short Entry" />
                        <Scatter data={traceOverlay.fakeEntries} fill="#fbbf24" name="Fake Entry" />
                        <Scatter data={traceOverlay.bullishBlocks} fill="#34d399" name="Bullish Order Block" />
                        <Scatter data={traceOverlay.bearishBlocks} fill="#fb7185" name="Bearish Order Block" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-3" style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.outlineVar, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    <span style={{ color: C.primary }}>Long entries</span>
                    <span style={{ color: C.tertiary }}>Short entries</span>
                    <span style={{ color: "#fbbf24" }}>Fake entries</span>
                    <span style={{ color: "#34d399" }}>Bullish order blocks</span>
                    <span style={{ color: "#fb7185" }}>Bearish order blocks</span>
                  </div>
                </div>
              )}

              {/* Regime breakdown */}
              {btData.by_regime.length > 0 && (
                <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
                    <MicroLabel>Performance by Regime</MicroLabel>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                        {["Regime", "Signals", "Wins", "Win Rate"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {btData.by_regime.map((r) => (
                        <tr key={r.regime} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                          <td className="px-4 py-2.5"><RegimeBadge regime={r.regime} /></td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{r.total}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.primary }}>{r.wins}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: r.win_rate > 0.5 ? C.primary : C.tertiary, fontWeight: 700 }}>
                            {(r.win_rate * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Result rows */}
              <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
                  <MicroLabel>Detailed Results ({btData.results.length} signals)</MicroLabel>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                        {["Time", "Dir", "Entry", "ML Prob", "Quality", "Regime", "Fake", "Claude", "P&L $", "Outcome"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {btData.results.slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                          <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{new Date(r.bar_time).toLocaleDateString()}</td>
                          <td className="px-4 py-2"><span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: r.direction === "long" ? C.primary : C.tertiary }}>{r.direction.toUpperCase()}</span></td>
                          <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace" }}>{r.entry_price > 1000 ? r.entry_price.toFixed(2) : r.entry_price.toFixed(4)}</td>
                          <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: (r.ml_probability ?? 0) > 0.6 ? C.primary : C.muted }}>{r.ml_probability ? `${(r.ml_probability * 100).toFixed(0)}%` : "—"}</td>
                          <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: (r.final_quality_with_claude ?? r.final_quality) > 0.65 ? C.primary : C.muted }}>
                            {((r.final_quality_with_claude ?? r.final_quality) * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-2"><RegimeBadge regime={r.regime} /></td>
                          <td className="px-4 py-2">
                            {r.is_fake_entry ? (
                              <span className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", backgroundColor: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}>
                                Fake
                              </span>
                            ) : (
                              <span style={{ fontSize: "9px", color: C.outlineVar }}>—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {r.claude_verdict ? (
                              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: r.claude_verdict === "APPROVED" ? C.primary : r.claude_verdict === "VETOED" ? C.tertiary : "#fbbf24" }}>
                                {r.claude_verdict}
                              </span>
                            ) : (
                              <span style={{ fontSize: "9px", color: C.outlineVar }}>—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-bold" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: (r.pnl_dollars ?? 0) > 0 ? C.primary : (r.pnl_dollars ?? 0) < 0 ? C.tertiary : C.muted }}>
                            {r.pnl_dollars != null ? `${r.pnl_dollars >= 0 ? "+" : ""}$${r.pnl_dollars.toFixed(0)}` : "—"}
                          </td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", backgroundColor: r.outcome === "win" ? "rgba(156,255,147,0.1)" : r.outcome === "loss" ? "rgba(255,113,98,0.1)" : "rgba(72,72,73,0.2)", color: r.outcome === "win" ? C.primary : r.outcome === "loss" ? C.tertiary : C.muted }}>
                              {r.outcome}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── BATCH MATRIX ── */}
      {activeTab === "matrix" && (
        <div className="space-y-4">
          <div className="rounded p-4 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <MicroLabel>Batch Learning Scope</MicroLabel>
              <button
                onClick={() => batchBacktestMutation.mutate()}
                disabled={batchBacktestMutation.isPending || matrixSymbols.length === 0}
                className="px-3 py-1.5 rounded transition-all disabled:opacity-40"
                style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)", backgroundColor: "rgba(52,211,153,0.08)" }}
              >
                {batchBacktestMutation.isPending ? "Running..." : "Run Batch Matrix"}
              </button>
            </div>
            <input
              value={matrixSymbolsInput}
              onChange={(e) => setMatrixSymbolsInput(e.target.value.toUpperCase())}
              placeholder="BTCUSDT, ETHUSDT, SOLUSDT, MES, MNQ, NASDAQ:AAPL"
              className="w-full rounded px-3 py-2 outline-none text-xs"
              style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace" }}
            />
            <div className="flex flex-wrap gap-1.5">
              {matrixSymbols.map((symbol) => (
                <span key={symbol} className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.secondary, border: "1px solid rgba(102,157,255,0.25)", backgroundColor: "rgba(102,157,255,0.08)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {symbol}
                </span>
              ))}
              {matrixSymbols.length === 0 && (
                <span style={{ fontSize: "9px", color: C.outlineVar }}>Add at least one symbol.</span>
              )}
            </div>
          </div>

          {batchBacktestMutation.isPending && (
            <div className="rounded p-10 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <span className="w-2 h-2 rounded-full animate-pulse inline-block mb-3" style={{ backgroundColor: "#34d399" }} />
              <p style={{ fontSize: "10px", color: C.muted, fontFamily: "Space Grotesk" }}>
                Running full-history matrix across symbols and setups...
              </p>
            </div>
          )}

          {!batchBacktestMutation.isPending && !batchData && (
            <div className="rounded p-14 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <span className="material-symbols-outlined text-4xl mb-3 block" style={{ color: C.outlineVar }}>dataset</span>
              <p style={{ fontSize: "11px", color: C.muted, fontFamily: "Space Grotesk" }}>
                Run Batch Matrix to evaluate all setups across all selected symbols.
              </p>
            </div>
          )}

          {batchData && !(batchData as any).error && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Symbols", value: String(batchData.aggregate.symbols_completed), sub: `${batchData.aggregate.symbols_failed} insufficient`, accent: "#ffffff" },
                  { label: "Total Signals", value: String(batchData.aggregate.total_signals), sub: `${batchData.aggregate.closed_signals} closed`, accent: C.secondary },
                  { label: "Win Rate", value: `${(batchData.aggregate.win_rate * 100).toFixed(1)}%`, sub: `${batchData.aggregate.wins}W · ${batchData.aggregate.losses}L`, accent: batchData.aggregate.win_rate > 0.5 ? C.primary : C.tertiary },
                  { label: "Gross P&L", value: `$${batchData.aggregate.gross_pnl_dollars >= 0 ? "+" : ""}${batchData.aggregate.gross_pnl_dollars.toFixed(0)}`, sub: `${(batchData.aggregate.fake_entry_rate * 100).toFixed(1)}% fake entries`, accent: batchData.aggregate.gross_pnl_dollars >= 0 ? C.primary : C.tertiary },
                  { label: "High Conviction", value: String(batchData.aggregate.high_conviction_signals), sub: "signals", accent: C.primary },
                  { label: "Claude Reviewed", value: String(batchData.aggregate.claude_reviewed_signals), sub: "sampled across matrix", accent: "#34d399" },
                  { label: "Days", value: String(batchData.days_analyzed), sub: "historical lookback", accent: C.muted },
                  { label: "Runtime", value: `${Math.round(batchData.runtime_ms / 1000)}s`, sub: "batch execution time", accent: C.muted },
                ].map((item) => (
                  <div key={item.label} className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                    <MicroLabel>{item.label}</MicroLabel>
                    <div className="mt-2 font-headline font-bold text-xl" style={{ color: item.accent }}>{item.value}</div>
                    <div style={{ fontSize: "9px", color: C.outlineVar, marginTop: "3px", fontFamily: "Space Grotesk" }}>{item.sub}</div>
                  </div>
                ))}
              </div>

              <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
                  <MicroLabel>Best Setup By Symbol</MicroLabel>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                        {["Symbol", "Best Setup", "Rank", "Signals", "Win Rate", "Expectancy", "Fake Rate", "P&L $"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {batchData.symbol_summaries.map((summary) => {
                        const best = summary.best_setup;
                        return (
                          <tr key={summary.instrument} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                            <td className="px-4 py-2.5">
                              <div className="font-headline font-bold text-xs">{summary.instrument}</div>
                              <div style={{ fontSize: "8px", color: C.outlineVar, fontFamily: "JetBrains Mono, monospace" }}>{summary.alpaca_symbol}</div>
                            </td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", color: C.muted }}>
                              {best ? best.setup_type.replace(/_/g, " ") : "—"}
                            </td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
                              {best ? best.rank_score.toFixed(2) : "—"}
                            </td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{best ? best.total_signals : 0}</td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: best && best.win_rate > 0.5 ? C.primary : C.tertiary }}>
                              {best ? `${(best.win_rate * 100).toFixed(1)}%` : "—"}
                            </td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: best && best.expectancy_dollars > 0 ? C.primary : C.tertiary }}>
                              {best ? `${best.expectancy_dollars >= 0 ? "+" : ""}$${best.expectancy_dollars.toFixed(2)}` : "—"}
                            </td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: best && best.fake_entry_rate < 0.2 ? C.primary : "#fbbf24" }}>
                              {best ? `${(best.fake_entry_rate * 100).toFixed(1)}%` : "—"}
                            </td>
                            <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: best && best.gross_pnl_dollars >= 0 ? C.primary : C.tertiary }}>
                              {best ? `${best.gross_pnl_dollars >= 0 ? "+" : ""}$${best.gross_pnl_dollars.toFixed(0)}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── VOLUME PROFILE / HEATMAP ── */}
      {activeTab === "heatmap" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-headline font-bold text-lg">Volume Profile · Market Heatmap</h2>
              <p style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>POC · VAH · VAL · HVN/LVN zones · Per-candle microstructure intelligence</p>
            </div>
          </div>

          {/* Volume Profile */}
          <VolumeProfilePanel symbol={alpacaSymbol} timeframe="1Min" bars={200} height={400} />

          {/* Candle Intelligence */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#e879f9" }}>auto_graph</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Candle Microstructure Intelligence · {alpacaSymbol} 5m
              </span>
            </div>
            <CandleIntelligencePanel symbol={alpacaSymbol} timeframe="5Min" bars={80} />
          </div>

          {/* 15m candle intelligence */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#e879f9" }}>auto_graph</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Candle Microstructure Intelligence · {alpacaSymbol} 15m
              </span>
            </div>
            <CandleIntelligencePanel symbol={alpacaSymbol} timeframe="15Min" bars={60} />
          </div>
        </div>
      )}

      {/* ── REPLAY ENGINE ── */}
      {activeTab === "replay" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-headline font-bold text-lg">Replay Engine · Phase 7</h2>
              <p style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>Step through historical bars · Per-candle intelligence · Train your pattern recognition</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReplayEngine symbol={alpacaSymbol} timeframe="5Min"  barCount={100} />
            <ReplayEngine symbol={alpacaSymbol} timeframe="15Min" barCount={60}  />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>area_chart</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                1m Volume Profile · Replay Context
              </span>
            </div>
            <VolumeProfilePanel symbol={alpacaSymbol} timeframe="1Min" bars={200} height={280} />
          </div>
        </div>
      )}

      {/* ── ACCURACY DB ── */}
      {activeTab === "accuracy" && (
        <div className="space-y-4">
          {!accuracy ? (
            <div className="rounded p-10 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <MicroLabel>Loading accuracy database...</MicroLabel>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Total Records", value: String(accuracy.total_records) },
                  { label: "Closed", value: String(accuracy.closed) },
                  { label: "Win Rate", value: `${(accuracy.win_rate * 100).toFixed(1)}%`, accent: accuracy.win_rate > 0.5 ? C.primary : C.tertiary },
                  { label: "Profit Factor", value: accuracy.profit_factor.toFixed(2), accent: accuracy.profit_factor > 1 ? C.primary : C.tertiary },
                ].map((s, i) => (
                  <div key={i} className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                    <MicroLabel>{s.label}</MicroLabel>
                    <div className="mt-2 font-headline font-bold text-xl" style={{ color: s.accent ?? "#ffffff" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* By Setup */}
              <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
                  <span className="material-symbols-outlined text-sm" style={{ color: C.secondary }}>account_tree</span>
                  <MicroLabel>Accuracy by Setup Type</MicroLabel>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                        {["Setup", "Total", "Wins", "Win Rate", "Avg Quality", "Expectancy"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {accuracy.by_setup.map((s) => (
                        <tr key={s.setup_type} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                          <td className="px-4 py-2.5 font-headline font-bold text-xs">{s.setup_type.replace(/_/g, " ")}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{s.total}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.primary }}>{s.wins}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: s.win_rate > 0.5 ? C.primary : C.tertiary }}>{(s.win_rate * 100).toFixed(1)}%</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{(s.avg_quality * 100).toFixed(1)}%</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: (s.expectancy_ticks ?? 0) > 0 ? C.primary : C.tertiary }}>
                            {s.expectancy_ticks != null ? `${s.expectancy_ticks > 0 ? "+" : ""}${s.expectancy_ticks.toFixed(1)}t` : "—"}
                          </td>
                        </tr>
                      ))}
                      {accuracy.by_setup.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ fontSize: "11px", color: C.outlineVar }}>No accuracy data yet — run a backtest or build recall.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* By Regime */}
              {accuracy.by_regime && accuracy.by_regime.length > 0 && (
                <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
                    <span className="material-symbols-outlined text-sm" style={{ color: "#fbbf24" }}>bar_chart</span>
                    <MicroLabel>Accuracy by Market Regime</MicroLabel>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                        {["Regime", "Total", "Wins", "Win Rate", "Avg Quality"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {accuracy.by_regime.map((r) => (
                        <tr key={r.regime} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                          <td className="px-4 py-2.5"><RegimeBadge regime={r.regime} /></td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{r.total}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.primary }}>{r.wins}</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: r.win_rate > 0.5 ? C.primary : C.tertiary }}>{(r.win_rate * 100).toFixed(1)}%</td>
                          <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{(r.avg_quality * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent */}
              {accuracy.recent.length > 0 && (
                <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
                    <span className="material-symbols-outlined text-sm" style={{ color: C.muted }}>history</span>
                    <MicroLabel>Recent Accuracy Records</MicroLabel>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                          {["Date", "Setup", "Symbol", "Dir", "Regime", "Quality", "Outcome"].map((h) => (
                            <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accuracy.recent.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                            <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{new Date(r.bar_time).toLocaleDateString()}</td>
                            <td className="px-4 py-2" style={{ fontSize: "9px", color: C.muted }}>{r.setup_type.replace(/_/g, " ")}</td>
                            <td className="px-4 py-2 font-headline font-bold text-xs">{r.symbol}</td>
                            <td className="px-4 py-2">
                              {r.direction && <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: r.direction === "long" ? C.primary : C.tertiary }}>{r.direction.toUpperCase()}</span>}
                            </td>
                            <td className="px-4 py-2">{r.regime ? <RegimeBadge regime={r.regime} /> : <span style={{ fontSize: "9px", color: C.outlineVar }}>—</span>}</td>
                            <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: Number(r.final_quality) > 0.65 ? C.primary : C.muted }}>{(Number(r.final_quality) * 100).toFixed(0)}%</td>
                            <td className="px-4 py-2">
                              <span className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, textTransform: "uppercase", backgroundColor: r.outcome === "win" ? "rgba(156,255,147,0.1)" : r.outcome === "loss" ? "rgba(255,113,98,0.1)" : "rgba(72,72,73,0.2)", color: r.outcome === "win" ? C.primary : r.outcome === "loss" ? C.tertiary : C.muted }}>
                                {r.outcome}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── RECALL BUILD ── */}
      {activeTab === "recall" && (
        <div className="space-y-4">
          {recallBuildMutation.isPending && (
            <div className="rounded p-10 text-center" style={{ backgroundColor: C.card, border: "1px solid rgba(251,191,36,0.2)" }}>
              <div className="flex flex-col items-center gap-3">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#fbbf24", boxShadow: "0 0 10px rgba(251,191,36,0.5)" }} />
                <MicroLabel>Fetching 1+ year of crypto bars · Running detection · Saving to recall database</MicroLabel>
              </div>
            </div>
          )}

          {!recallBuildMutation.isPending && !recallData && (
            <div className="rounded p-14 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <span className="material-symbols-outlined text-4xl mb-3 block" style={{ color: C.outlineVar }}>psychology</span>
              <p className="font-headline font-bold text-sm" style={{ color: C.muted }}>Build AI Recall Memory</p>
              <p style={{ fontSize: "9px", color: C.outlineVar, marginTop: "6px", fontFamily: "Space Grotesk" }}>
                Fetches BTC/USD + ETH/USD history · Runs full strategy detection · Saves outcomes to accuracy DB
              </p>
              <p style={{ fontSize: "9px", color: "#fbbf24", marginTop: "8px", fontFamily: "Space Grotesk" }}>
                Warning: 1-year build may take 2-5 minutes
              </p>
            </div>
          )}

          {recallData && !(recallData as any).error && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: "Status", value: recallData.status.toUpperCase(), accent: recallData.status === "complete" ? C.primary : "#fbbf24" },
                  { label: "Symbols Processed", value: String(recallData.symbols_processed) },
                  { label: "Records Saved", value: String(recallData.total_records_saved), accent: C.primary },
                ].map((s, i) => (
                  <div key={i} className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                    <MicroLabel>{s.label}</MicroLabel>
                    <div className="mt-2 font-headline font-bold text-xl" style={{ color: s.accent ?? "#ffffff" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {Object.entries(recallData.summary).map(([sym, data]) => (
                <div key={sym} className="rounded p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="font-headline font-bold text-sm">{sym}</span>
                    {data.date_range && (
                      <span style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                        {data.date_range.start} → {data.date_range.end}
                      </span>
                    )}
                  </div>
                  {data.error ? (
                    <p style={{ fontSize: "11px", color: C.tertiary }}>{data.error}</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Bars Fetched", value: String(data.bars_fetched ?? 0) },
                        { label: "Signals", value: String(data.signals_detected ?? 0) },
                        { label: "Closed", value: String(data.closed ?? 0) },
                        { label: "Win Rate", value: data.win_rate ?? "—", accent: data.wins && data.closed && data.wins / data.closed > 0.5 ? C.primary : C.muted },
                      ].map((f) => (
                        <div key={f.label} className="rounded p-3" style={{ backgroundColor: "#0e0e0f" }}>
                          <MicroLabel>{f.label}</MicroLabel>
                          <div className="mt-1 font-headline font-bold text-lg" style={{ color: f.accent ?? "#ffffff" }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {data.by_setup && data.by_setup.length > 0 && (
                    <div className="mt-4">
                      <MicroLabel>By Setup</MicroLabel>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {data.by_setup.map((s) => (
                          <span key={s.setup} className="px-2 py-1 rounded" style={{ fontSize: "9px", fontFamily: "Space Grotesk", backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: C.muted }}>
                            {s.setup.replace(/_/g, " ")} · {s.total} signals · {s.win_rate} WR
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
