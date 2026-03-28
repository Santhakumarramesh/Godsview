import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Brain, Shield, TrendingUp, BarChart3, Database, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

const BASE = "/api";

type AnalyzeResult = {
  instrument: string;
  alpaca_symbol: string;
  analyzed_at: string;
  regime: string;
  regime_label: string;
  bars_analyzed: Record<string, number>;
  recall_features: Record<string, number>;
  setups_detected: number;
  setups_blocked: Array<{ setup_type: string; reason: string }>;
  high_conviction: Array<SetupResult>;
  setups: Array<SetupResult>;
};

type SetupResult = {
  setup_type: string;
  direction: string;
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  quality_threshold: number;
  meets_threshold: boolean;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  tp_ticks: number;
  sl_ticks: number;
  bar_time: string;
  atr: number;
};

type BacktestResult = {
  instrument: string;
  setup_type: string;
  days_analyzed: number;
  bars_scanned: number;
  total_signals: number;
  closed_signals: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  expectancy_ticks: number;
  avg_final_quality: number;
  high_conviction_signals: number;
  high_conviction_win_rate: number;
  by_regime: Array<{ regime: string; total: number; wins: number; win_rate: number }>;
  results: Array<{
    bar_time: string;
    entry_price: number;
    direction: string;
    structure_score: number;
    order_flow_score: number;
    recall_score: number;
    final_quality: number;
    meets_threshold: boolean;
    regime: string;
    outcome: string;
    tp_ticks: number;
    sl_ticks: number;
  }>;
};

type AccuracyResult = {
  total_records: number;
  closed: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  by_setup: Array<{ setup_type: string; total: number; wins: number; win_rate: number; avg_quality: number }>;
  by_symbol: Array<{ symbol: string; total: number; wins: number; win_rate: number }>;
  recent: Array<{ bar_time: string; setup_type: string; symbol: string; outcome: string; final_quality: string }>;
};

type RecallBuildResult = {
  status: string;
  symbols_processed: number;
  total_records_saved: number;
  years_back: number;
  summary: Record<string, {
    bars_fetched?: number;
    signals_detected?: number;
    closed?: number;
    wins?: number;
    win_rate?: string;
    by_setup?: Array<{ setup: string; total: number; wins: number; win_rate: string }>;
    date_range?: { start: string; end: string };
    timeframe?: string;
    error?: string;
  }>;
};

function pct(n: number) { return (n * 100).toFixed(1) + "%"; }
function fmt(n: number, d = 3) { return n.toFixed(d); }
function price(n: number) { return n > 1000 ? n.toFixed(2) : n.toFixed(4); }

const INSTRUMENTS = [
  { value: "BTCUSDT", label: "BTC/USD · Live", live: true },
  { value: "ETHUSDT", label: "ETH/USD · Live", live: true },
  { value: "MES", label: "MES → SPY (Trading Key)", live: false },
  { value: "MNQ", label: "MNQ → QQQ (Trading Key)", live: false },
];

const SETUPS = ["absorption_reversal", "sweep_reclaim", "continuation_pullback"];

const REGIME_COLORS: Record<string, string> = {
  trending_bull: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  trending_bear: "text-red-400 bg-red-400/10 border-red-400/30",
  ranging: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  volatile: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  chop: "text-slate-400 bg-slate-400/10 border-slate-400/30",
};

const REGIME_ICONS: Record<string, string> = {
  trending_bull: "↑",
  trending_bear: "↓",
  ranging: "↔",
  volatile: "⚡",
  chop: "~",
};

function RegimeBadge({ regime }: { regime: string }) {
  const color = REGIME_COLORS[regime] ?? "text-slate-400 bg-slate-400/10 border-slate-400/30";
  const icon = REGIME_ICONS[regime] ?? "?";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${color}`}>
      {icon} {regime.replace(/_/g, " ")}
    </span>
  );
}

function QualityBar({ value, threshold }: { value: number; threshold?: number }) {
  const pctVal = Math.round(value * 100);
  const meetsThreshold = threshold !== undefined ? value >= threshold : pctVal >= 65;
  const color = meetsThreshold ? "bg-emerald-500" : pctVal >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden relative">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pctVal}%` }} />
        {threshold !== undefined && (
          <div
            className="absolute top-0 h-full w-0.5 bg-white/40"
            style={{ left: `${Math.round(threshold * 100)}%` }}
          />
        )}
      </div>
      <span className="text-xs font-mono w-10 text-right">{pctVal}%</span>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "win") return <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">WIN</span>;
  if (outcome === "loss") return <span className="text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded">LOSS</span>;
  return <span className="text-xs font-semibold text-slate-400 bg-slate-400/10 px-2 py-0.5 rounded">OPEN</span>;
}

export default function AlpacaPage() {
  const [instrument, setInstrument] = useState("BTCUSDT");
  const [selectedSetup, setSelectedSetup] = useState("absorption_reversal");
  const [backtestDays, setBacktestDays] = useState(3);
  const [activeTab, setActiveTab] = useState<"live" | "backtest" | "accuracy" | "recall">("live");
  const [recallYears, setRecallYears] = useState(1);
  const [showAllSetups, setShowAllSetups] = useState(false);

  const { data: accuracy, refetch: refetchAccuracy } = useQuery<AccuracyResult>({
    queryKey: ["alpaca-accuracy"],
    queryFn: () => fetch(`${BASE}/alpaca/accuracy`).then((r) => r.json()),
  });

  const analyzeMutation = useMutation<AnalyzeResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument, setups: SETUPS }),
      }).then((r) => r.json()),
  });

  const backtestMutation = useMutation<BacktestResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument, setup_type: selectedSetup, days: backtestDays }),
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
        body: JSON.stringify({
          symbols: ["BTCUSD", "ETHUSD"],
          timeframe: "15Min",
          years: recallYears,
        }),
      }).then((r) => {
        refetchAccuracy();
        return r.json();
      }),
  });

  const analyzeData = analyzeMutation.data;
  const btData = backtestMutation.data;
  const recallData = recallBuildMutation.data;

  const displaySetups = analyzeData
    ? (showAllSetups ? analyzeData.setups : analyzeData.high_conviction)
    : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live Market Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Regime detection · No-trade filters · Walk-forward accuracy recall
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Crypto Data Live
          </div>
          <span className="text-xs text-amber-400/80">Stocks: Trading API key needed</span>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Instrument</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Setup Filter</label>
          <select
            value={selectedSetup}
            onChange={(e) => setSelectedSetup(e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {SETUPS.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Backtest Days</label>
          <select
            value={backtestDays}
            onChange={(e) => setBacktestDays(Number(e.target.value))}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {[1, 2, 3, 5, 7, 10, 14].map((d) => (
              <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Recall History</label>
          <select
            value={recallYears}
            onChange={(e) => setRecallYears(Number(e.target.value))}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            <option value={0.5}>6 months</option>
            <option value={1}>1 year</option>
            <option value={2}>2 years</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <button
              onClick={() => { analyzeMutation.mutate(); setActiveTab("live"); }}
              disabled={analyzeMutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              {analyzeMutation.isPending ? "Scanning..." : "Scan Now"}
            </button>
            <button
              onClick={() => { backtestMutation.mutate(); setActiveTab("backtest"); }}
              disabled={backtestMutation.isPending}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              {backtestMutation.isPending ? "Running..." : "Backtest"}
            </button>
          </div>
          <button
            onClick={() => { recallBuildMutation.mutate(); setActiveTab("recall"); }}
            disabled={recallBuildMutation.isPending}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Brain className="w-3.5 h-3.5" />
            {recallBuildMutation.isPending ? "Building Recall..." : "Build Recall"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {(["live", "backtest", "accuracy", "recall"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "live" ? "Live Analysis" : tab === "backtest" ? "Backtest" : tab === "accuracy" ? "Accuracy DB" : "Recall Build"}
          </button>
        ))}
      </div>

      {/* ── LIVE ANALYSIS TAB ─────────────────────────────── */}
      {activeTab === "live" && (
        <div className="space-y-4">
          {analyzeMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Fetching live bars · Detecting regime · Running setup scan...</p>
            </div>
          )}

          {!analyzeMutation.isPending && !analyzeData && (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Click "Scan Now" to run the full pipeline on live bars</p>
              <p className="text-xs mt-1 opacity-60">Fetches 1m · 5m · 15m → regime detection → setup scan → quality scoring</p>
            </div>
          )}

          {analyzeData && !(analyzeData as any).error && (
            <>
              {/* Regime + stats bar */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Market Regime</div>
                  <RegimeBadge regime={analyzeData.regime} />
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Bars Loaded</div>
                  <div className="text-lg font-bold mt-1">
                    {Object.values(analyzeData.bars_analyzed).join("/")}
                    <span className="text-xs text-muted-foreground ml-1">1m/5m/15m</span>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">High Conviction</div>
                  <div className={`text-lg font-bold mt-1 ${analyzeData.high_conviction.length > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {analyzeData.high_conviction.length}
                    <span className="text-xs text-muted-foreground ml-1">/ {analyzeData.setups_detected} detected</span>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Blocked Setups</div>
                  <div className={`text-lg font-bold mt-1 ${analyzeData.setups_blocked.length > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                    {analyzeData.setups_blocked.length}
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Scanned</div>
                  <div className="text-sm font-mono mt-1">{new Date(analyzeData.analyzed_at).toLocaleTimeString()}</div>
                </div>
              </div>

              {/* Blocked setups notice */}
              {analyzeData.setups_blocked.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                  <Shield className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-amber-400">No-Trade Filters Active</div>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {analyzeData.setups_blocked.map((b, i) => (
                        <span key={i} className="text-xs text-amber-300/80 bg-amber-400/10 px-2 py-0.5 rounded">
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
                  <div className="text-sm font-medium text-foreground">
                    {showAllSetups ? "All detected setups" : "High-conviction only"}
                  </div>
                  <button
                    onClick={() => setShowAllSetups(!showAllSetups)}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    {showAllSetups ? "Show high-conviction only" : "Show all detections"}
                  </button>
                </div>
              )}

              {/* No setups */}
              {displaySetups.length === 0 && analyzeData.setups_detected === 0 && (
                <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
                  No setups detected in current bars. Market may be consolidating.
                </div>
              )}
              {displaySetups.length === 0 && analyzeData.setups_detected > 0 && (
                <div className="bg-card border border-border rounded-xl p-6 text-center">
                  <div className="text-amber-400 font-medium text-sm">{analyzeData.setups_detected} setup{analyzeData.setups_detected > 1 ? "s" : ""} detected but below quality threshold for this regime</div>
                  <button onClick={() => setShowAllSetups(true)} className="text-xs text-muted-foreground underline mt-1">
                    View anyway
                  </button>
                </div>
              )}

              {/* Setup cards */}
              {displaySetups.map((setup, i) => (
                <div key={i} className={`bg-card border rounded-xl p-5 space-y-4 ${setup.meets_threshold ? "border-emerald-500/30" : "border-amber-500/20"}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${setup.direction === "long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                        {setup.direction.toUpperCase()}
                      </span>
                      <span className="text-sm font-semibold text-foreground">{setup.setup_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                      <RegimeBadge regime={analyzeData.regime} />
                    </div>
                    <div className="flex items-center gap-2">
                      {setup.meets_threshold ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/30">
                          <CheckCircle2 className="w-3 h-3" /> High Conviction
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/30">
                          <AlertTriangle className="w-3 h-3" /> Below Threshold
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-background/40 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1.5">Structure Score</div>
                      <QualityBar value={setup.structure_score} />
                    </div>
                    <div className="bg-background/40 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1.5">Order Flow</div>
                      <QualityBar value={setup.order_flow_score} />
                    </div>
                    <div className="bg-background/40 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1.5">Recall Score</div>
                      <QualityBar value={setup.recall_score} />
                    </div>
                  </div>

                  <div className="bg-background/40 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="text-xs text-muted-foreground">Final Quality</div>
                      <div className="text-xs text-muted-foreground">Threshold: {Math.round(setup.quality_threshold * 100)}%</div>
                    </div>
                    <QualityBar value={setup.final_quality} threshold={setup.quality_threshold} />
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Entry</div>
                      <div className="font-mono font-bold">${price(setup.entry_price)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-emerald-400">Take Profit</div>
                      <div className="font-mono text-emerald-400 font-bold">${price(setup.take_profit)} <span className="text-xs opacity-70">+{setup.tp_ticks}t</span></div>
                    </div>
                    <div>
                      <div className="text-xs text-red-400">Stop Loss</div>
                      <div className="font-mono text-red-400 font-bold">${price(setup.stop_loss)} <span className="text-xs opacity-70">-{setup.sl_ticks}t</span></div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Recall Features */}
              <details className="bg-card border border-border rounded-xl">
                <summary className="p-4 text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                  Raw Recall Features ({Object.keys(analyzeData.recall_features).length} features)
                </summary>
                <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(analyzeData.recall_features).map(([k, v]) => (
                    typeof v === "number" && (
                      <div key={k} className="bg-background/40 rounded px-3 py-2">
                        <div className="text-xs text-muted-foreground">{k}</div>
                        <div className="font-mono text-xs text-foreground">{typeof v === "number" ? v.toFixed(4) : String(v)}</div>
                      </div>
                    )
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      )}

      {/* ── BACKTEST TAB ──────────────────────────────────── */}
      {activeTab === "backtest" && (
        <div className="space-y-4">
          {backtestMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Running walk-forward scan with no-trade filters...</p>
            </div>
          )}

          {!btData && !backtestMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Click "Backtest" to run walk-forward analysis</p>
            </div>
          )}

          {btData && !(btData as any).error && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Win Rate", value: pct(btData.win_rate), color: btData.win_rate >= 0.55 ? "text-emerald-400" : "text-red-400" },
                  { label: "Profit Factor", value: btData.profit_factor >= 999 ? "∞" : fmt(btData.profit_factor, 2), color: btData.profit_factor >= 1.5 ? "text-emerald-400" : "text-red-400" },
                  { label: "Expectancy", value: `${btData.expectancy_ticks.toFixed(1)}t`, color: btData.expectancy_ticks > 0 ? "text-emerald-400" : "text-red-400" },
                  { label: "High Conviction WR", value: pct(btData.high_conviction_win_rate), color: btData.high_conviction_win_rate >= 0.6 ? "text-emerald-400" : "text-amber-400" },
                ].map((m) => (
                  <div key={m.label} className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className={`text-2xl font-bold mt-1 ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Bars Scanned</div>
                  <div className="text-lg font-bold mt-1">{btData.bars_scanned.toLocaleString()}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Signals Found</div>
                  <div className="text-lg font-bold mt-1">{btData.total_signals}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">W / L</div>
                  <div className="text-lg font-bold mt-1 text-emerald-400">{btData.wins} <span className="text-muted-foreground">/</span> <span className="text-red-400">{btData.losses}</span></div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Avg Quality</div>
                  <div className="text-lg font-bold mt-1">{pct(btData.avg_final_quality)}</div>
                </div>
              </div>

              {/* By Regime */}
              {btData.by_regime.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="text-sm font-semibold mb-3">Performance by Regime</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {btData.by_regime.map((r) => (
                      <div key={r.regime} className="bg-background/40 rounded-lg p-3 flex items-center justify-between">
                        <RegimeBadge regime={r.regime} />
                        <div className="text-right">
                          <div className={`text-sm font-bold ${r.win_rate >= 0.55 ? "text-emerald-400" : "text-red-400"}`}>{pct(r.win_rate)}</div>
                          <div className="text-xs text-muted-foreground">{r.total} trades</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Results table */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border text-sm font-semibold">Walk-Forward Results</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="px-4 py-2 text-left">Time</th>
                        <th className="px-4 py-2 text-left">Dir</th>
                        <th className="px-4 py-2 text-left">Regime</th>
                        <th className="px-4 py-2 text-right">Quality</th>
                        <th className="px-4 py-2 text-right">TP/SL</th>
                        <th className="px-4 py-2 text-center">HC</th>
                        <th className="px-4 py-2 text-center">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {btData.results.slice(0, 30).map((r, i) => (
                        <tr key={i} className="border-b border-border/40 hover:bg-white/[0.02]">
                          <td className="px-4 py-2 font-mono text-muted-foreground">{new Date(r.bar_time).toLocaleDateString()}</td>
                          <td className={`px-4 py-2 font-semibold ${r.direction === "long" ? "text-emerald-400" : "text-red-400"}`}>
                            {r.direction === "long" ? "▲" : "▼"} {r.direction}
                          </td>
                          <td className="px-4 py-2"><RegimeBadge regime={r.regime} /></td>
                          <td className="px-4 py-2 text-right font-mono">{pct(r.final_quality)}</td>
                          <td className="px-4 py-2 text-right font-mono text-emerald-400/80">{r.tp_ticks}t / <span className="text-red-400/80">{r.sl_ticks}t</span></td>
                          <td className="px-4 py-2 text-center">{r.meets_threshold ? "✓" : ""}</td>
                          <td className="px-4 py-2 text-center"><OutcomeBadge outcome={r.outcome} /></td>
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

      {/* ── ACCURACY DB TAB ───────────────────────────────── */}
      {activeTab === "accuracy" && (
        <div className="space-y-4">
          {!accuracy && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Loading accuracy database...</p>
            </div>
          )}

          {accuracy && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total Records", value: accuracy.total_records.toLocaleString(), color: "" },
                  { label: "Win Rate", value: accuracy.closed > 0 ? pct(accuracy.win_rate) : "—", color: accuracy.win_rate >= 0.55 ? "text-emerald-400" : "text-red-400" },
                  { label: "Profit Factor", value: accuracy.profit_factor >= 999 ? "∞" : fmt(accuracy.profit_factor, 2), color: accuracy.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400" },
                  { label: "Closed Trades", value: accuracy.closed.toLocaleString(), color: "" },
                ].map((m) => (
                  <div key={m.label} className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className={`text-2xl font-bold mt-1 ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {accuracy.total_records === 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 text-center">
                  <Brain className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <div className="text-amber-400 font-semibold">No recall data yet</div>
                  <p className="text-sm text-muted-foreground mt-1">Click "Build Recall" to run the strategy engine over years of historical BTC/ETH data and populate this database.</p>
                </div>
              )}

              {accuracy.by_setup.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="text-sm font-semibold mb-3">By Setup Type</div>
                  <div className="space-y-3">
                    {accuracy.by_setup.map((s) => (
                      <div key={s.setup_type} className="flex items-center gap-3">
                        <div className="w-36 text-xs text-muted-foreground truncate">{s.setup_type.replace(/_/g, " ")}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
                              <div className={`h-full ${s.win_rate >= 0.55 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${s.win_rate * 100}%` }} />
                            </div>
                            <span className="text-xs font-mono w-12 text-right">{pct(s.win_rate)}</span>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground w-20 text-right">{s.wins}W / {s.total - s.wins}L</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {accuracy.by_symbol.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="text-sm font-semibold mb-3">By Symbol</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {accuracy.by_symbol.map((s) => (
                      <div key={s.symbol} className="bg-background/40 rounded-lg p-3">
                        <div className="text-sm font-bold">{s.symbol}</div>
                        <div className={`text-xl font-bold ${s.win_rate >= 0.55 ? "text-emerald-400" : "text-red-400"}`}>{pct(s.win_rate)}</div>
                        <div className="text-xs text-muted-foreground">{s.total} trades</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {accuracy.recent.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border text-sm font-semibold">Recent Records</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="px-4 py-2 text-left">Date</th>
                          <th className="px-4 py-2 text-left">Symbol</th>
                          <th className="px-4 py-2 text-left">Setup</th>
                          <th className="px-4 py-2 text-right">Quality</th>
                          <th className="px-4 py-2 text-center">Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accuracy.recent.slice(0, 30).map((r, i) => (
                          <tr key={i} className="border-b border-border/40 hover:bg-white/[0.02]">
                            <td className="px-4 py-2 font-mono text-muted-foreground">{new Date(r.bar_time).toLocaleDateString()}</td>
                            <td className="px-4 py-2 font-semibold">{r.symbol}</td>
                            <td className="px-4 py-2 text-muted-foreground">{r.setup_type.replace(/_/g, " ")}</td>
                            <td className="px-4 py-2 text-right font-mono">{(Number(r.final_quality) * 100).toFixed(1)}%</td>
                            <td className="px-4 py-2 text-center"><OutcomeBadge outcome={r.outcome} /></td>
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

      {/* ── RECALL BUILD TAB ──────────────────────────────── */}
      {activeTab === "recall" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Brain className="w-10 h-10 text-amber-400 flex-shrink-0 mt-1" />
              <div>
                <div className="text-lg font-bold">Historical Recall Builder</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Fetches years of BTC/USD and ETH/USD 15-min bars from Alpaca (free, no key required) and runs the full walk-forward strategy engine over every window. Results are saved to the accuracy database and improve future signal scoring.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="bg-white/5 px-2 py-1 rounded">15-min bars · 24/7 crypto</span>
                  <span className="bg-white/5 px-2 py-1 rounded">Regime detection on every window</span>
                  <span className="bg-white/5 px-2 py-1 rounded">No-trade filters applied</span>
                  <span className="bg-white/5 px-2 py-1 rounded">Walk-forward outcomes (20-bar forward)</span>
                  <span className="bg-white/5 px-2 py-1 rounded">All 3 setup types</span>
                </div>
              </div>
            </div>
          </div>

          {recallBuildMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <div className="text-amber-400 font-semibold mb-1">Building Recall Database</div>
              <p className="text-sm text-muted-foreground">Fetching historical bars · Running strategy engine · Saving results...</p>
              <p className="text-xs text-muted-foreground mt-2">This may take 30–120 seconds depending on date range</p>
            </div>
          )}

          {!recallData && !recallBuildMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Choose your date range above and click "Build Recall"</p>
              <p className="text-xs mt-1 opacity-60">1 year ≈ 35,000 bars · 2 years ≈ 70,000 bars</p>
            </div>
          )}

          {recallData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                  <div className="text-xs text-emerald-400/70">Records Saved</div>
                  <div className="text-3xl font-bold text-emerald-400 mt-1">{recallData.total_records_saved.toLocaleString()}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Symbols</div>
                  <div className="text-3xl font-bold mt-1">{recallData.symbols_processed}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">History</div>
                  <div className="text-3xl font-bold mt-1">{recallData.years_back}yr</div>
                </div>
              </div>

              {Object.entries(recallData.summary).map(([sym, s]) => (
                <div key={sym} className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="font-bold text-lg">{sym}</span>
                    {"error" in s ? (
                      <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded">{s.error}</span>
                    ) : (
                      <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">Complete</span>
                    )}
                  </div>

                  {"bars_fetched" in s && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <div><div className="text-xs text-muted-foreground">Bars Fetched</div><div className="font-bold">{s.bars_fetched?.toLocaleString()}</div></div>
                      <div><div className="text-xs text-muted-foreground">Signals</div><div className="font-bold">{s.signals_detected}</div></div>
                      <div><div className="text-xs text-muted-foreground">Win Rate</div><div className={`font-bold ${Number(s.win_rate) >= 0.55 ? "text-emerald-400" : "text-red-400"}`}>{s.win_rate ? `${(Number(s.win_rate) * 100).toFixed(1)}%` : "—"}</div></div>
                      <div><div className="text-xs text-muted-foreground">Timeframe</div><div className="font-bold">{s.timeframe}</div></div>
                    </div>
                  )}

                  {s.by_setup && s.by_setup.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">By Setup</div>
                      {s.by_setup.map((bs) => (
                        <div key={bs.setup} className="flex items-center gap-3">
                          <div className="w-40 text-xs text-muted-foreground">{bs.setup.replace(/_/g, " ")}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
                                <div className={`h-full ${Number(bs.win_rate) >= 0.55 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Number(bs.win_rate) * 100}%` }} />
                              </div>
                              <span className="text-xs font-mono w-12 text-right">{(Number(bs.win_rate) * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground w-20 text-right">{bs.wins}W / {bs.total - bs.wins}L</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
