import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import LiveCandleChart from "@/components/LiveCandleChart";

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
  bars_analyzed: Record<string, number>; recall_features: Record<string, any>;
  setups_detected: number; setups_blocked: Array<{ setup_type: string; reason: string }>;
  high_conviction: Array<SetupResult>; setups: Array<SetupResult>;
};
type SetupResult = {
  setup_type: string; direction: string; structure_score: number; order_flow_score: number;
  recall_score: number; final_quality: number; quality_threshold: number; meets_threshold: boolean;
  entry_price: number; stop_loss: number; take_profit: number; tp_ticks: number; sl_ticks: number;
  bar_time: string; atr: number;
};
type BacktestResult = {
  instrument: string; setup_type: string; days_analyzed: number; bars_scanned: number;
  total_signals: number; closed_signals: number; wins: number; losses: number; win_rate: number;
  profit_factor: number; expectancy_ticks: number; expectancy_dollars: number;
  gross_pnl_dollars: number; avg_win_dollars: number; avg_loss_dollars: number;
  avg_final_quality: number; high_conviction_signals: number; high_conviction_win_rate: number;
  equity_curve: Array<{ date: string; pnl: number; equity: number }>;
  by_regime: Array<{ regime: string; total: number; wins: number; win_rate: number }>;
  results: Array<{ bar_time: string; entry_price: number; direction: string; structure_score: number; order_flow_score: number; recall_score: number; ml_probability: number; final_quality: number; meets_threshold: boolean; regime: string; outcome: string; tp_ticks: number; sl_ticks: number; pnl_dollars: number }>;
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
  summary: Record<string, { bars_fetched?: number; signals_detected?: number; closed?: number; wins?: number; win_rate?: string; by_setup?: Array<{ setup: string; total: number; wins: number; win_rate: string }>; date_range?: { start: string; end: string }; timeframe?: string; error?: string }>;
};

const INSTRUMENTS = [
  { value: "BTCUSDT", label: "BTC/USD · Live", live: true },
  { value: "ETHUSDT", label: "ETH/USD · Live", live: true },
  { value: "MES", label: "MES → SPY", live: false },
  { value: "MNQ", label: "MNQ → QQQ", live: false },
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

type Tab = "live" | "backtest" | "accuracy" | "recall";

export default function AlpacaPage() {
  const [instrument, setInstrument] = useState("BTCUSDT");
  const [selectedSetup, setSelectedSetup] = useState("absorption_reversal");
  const [backtestDays, setBacktestDays] = useState(3);
  const [activeTab, setActiveTab] = useState<Tab>("live");
  const [recallYears, setRecallYears] = useState(1);
  const [showAllSetups, setShowAllSetups] = useState(false);

  const { data: accuracy, refetch: refetchAccuracy } = useQuery<AccuracyResult>({
    queryKey: ["alpaca-accuracy"],
    queryFn: () => fetch(`${BASE}/alpaca/accuracy`).then((r) => r.json()),
  });

  const analyzeMutation = useMutation<AnalyzeResult>({
    mutationFn: () => fetch(`${BASE}/alpaca/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instrument, setups: SETUPS }) }).then((r) => r.json()),
  });
  const backtestMutation = useMutation<BacktestResult>({
    mutationFn: () => fetch(`${BASE}/alpaca/backtest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instrument, setup_type: selectedSetup, days: backtestDays }) }).then((r) => { refetchAccuracy(); return r.json(); }),
  });
  const recallBuildMutation = useMutation<RecallBuildResult>({
    mutationFn: () => fetch(`${BASE}/alpaca/recall-build`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: ["BTCUSD", "ETHUSD"], timeframe: "15Min", years: recallYears }) }).then((r) => { refetchAccuracy(); return r.json(); }),
  });

  const analyzeData = analyzeMutation.data;
  const btData = backtestMutation.data;
  const recallData = recallBuildMutation.data;
  const displaySetups = analyzeData ? (showAllSetups ? analyzeData.setups : analyzeData.high_conviction) : [];

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "live", label: "Live Analysis", icon: "sensors" },
    { id: "backtest", label: "Backtest", icon: "history" },
    { id: "accuracy", label: "Accuracy DB", icon: "database" },
    { id: "recall", label: "Recall Build", icon: "psychology" },
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
            <ActionBtn onClick={() => { recallBuildMutation.mutate(); setActiveTab("recall"); }} pending={recallBuildMutation.isPending} pendingLabel="Building Recall..." label="Build Recall Memory" color="#fbbf24" icon="psychology" />
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
          {/* Live Candlestick Chart — always visible */}
          <LiveCandleChart defaultSymbol={instrument === "ETHUSDT" ? "ETHUSD" : "BTCUSD"} defaultTimeframe="5Min" />

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
                      <MicroLabel>Final Quality</MicroLabel>
                      <MicroLabel>Threshold: {Math.round(setup.quality_threshold * 100)}%</MicroLabel>
                    </div>
                    <QualityBar value={setup.final_quality} threshold={setup.quality_threshold} />
                  </div>

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
                </div>
              ))}

              {/* SK Structure Panel */}
              {analyzeData.recall_features?.sk && (
                <div className="rounded p-5" style={{ backgroundColor: C.card, border: "1px solid rgba(102,157,255,0.2)" }}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.secondary }} />
                    <span className="font-headline font-bold text-xs" style={{ color: C.secondary }}>SK Structure Intelligence</span>
                    <MicroLabel>Price-action location filter</MicroLabel>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "HTF Bias", value: (analyzeData.recall_features.sk.bias ?? "—").toUpperCase(), color: analyzeData.recall_features.sk.bias === "bull" ? C.primary : analyzeData.recall_features.sk.bias === "bear" ? C.tertiary : C.muted },
                      { label: "Sequence Stage", value: (analyzeData.recall_features.sk.sequence_stage ?? "—").replace(/_/g, " "), color: analyzeData.recall_features.sk.sequence_stage === "completion" ? C.primary : "#ffffff" },
                      { label: "Zone Distance", value: analyzeData.recall_features.sk.zone_distance_pct != null ? `${(analyzeData.recall_features.sk.zone_distance_pct * 100).toFixed(1)}%` : "—", color: (analyzeData.recall_features.sk.zone_distance_pct ?? 1) < 0.15 ? C.primary : C.muted },
                      { label: "In SK Zone", value: analyzeData.recall_features.sk.in_zone ? "YES" : "NO", color: analyzeData.recall_features.sk.in_zone ? C.primary : C.muted },
                      { label: "R:R Quality", value: analyzeData.recall_features.sk.rr_quality != null ? analyzeData.recall_features.sk.rr_quality.toFixed(2) : "—", color: (analyzeData.recall_features.sk.rr_quality ?? 0) >= 0.5 ? C.primary : C.muted },
                    ].map((f) => (
                      <div key={f.label} className="rounded p-3" style={{ backgroundColor: "#0e0e0f" }}>
                        <MicroLabel>{f.label}</MicroLabel>
                        <div className="mt-1 font-headline font-bold text-sm" style={{ color: f.color ?? "#ffffff" }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                  {analyzeData.recall_features.sk.correction_complete && (
                    <div className="mt-3 px-3 py-2 rounded" style={{ backgroundColor: "rgba(156,255,147,0.06)", border: "1px solid rgba(156,255,147,0.15)" }}>
                      <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.primary, fontWeight: 700, letterSpacing: "0.1em" }}>
                        ✓ CORRECTION COMPLETE — SK entry zone active
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* CVD Order Flow Panel */}
              {analyzeData.recall_features?.cvd && (
                <div className="rounded p-5" style={{ backgroundColor: C.card, border: "1px solid rgba(255,113,98,0.15)" }}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.tertiary }} />
                    <span className="font-headline font-bold text-xs" style={{ color: C.tertiary }}>CVD Order Flow Analysis</span>
                    <MicroLabel>Buy/sell pressure detection</MicroLabel>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "Buy Volume %", value: analyzeData.recall_features.cvd.buy_volume_ratio != null ? `${(analyzeData.recall_features.cvd.buy_volume_ratio * 100).toFixed(1)}%` : "—", color: (analyzeData.recall_features.cvd.buy_volume_ratio ?? 0.5) > 0.55 ? C.primary : (analyzeData.recall_features.cvd.buy_volume_ratio ?? 0.5) < 0.45 ? C.tertiary : C.muted },
                      { label: "CVD Slope", value: analyzeData.recall_features.cvd.cvd_slope != null ? (analyzeData.recall_features.cvd.cvd_slope > 0 ? "+" : "") + analyzeData.recall_features.cvd.cvd_slope.toFixed(4) : "—", color: (analyzeData.recall_features.cvd.cvd_slope ?? 0) > 0 ? C.primary : C.tertiary },
                      { label: "CVD Value", value: analyzeData.recall_features.cvd.cvd_value != null ? analyzeData.recall_features.cvd.cvd_value.toFixed(0) : "—" },
                      { label: "Price-Delta Div", value: analyzeData.recall_features.cvd.cvd_divergence ? "YES" : "NO", color: analyzeData.recall_features.cvd.cvd_divergence ? C.primary : C.muted },
                      { label: "Delta Spike", value: analyzeData.recall_features.cvd.large_delta_bar ? "DETECTED" : "NONE", color: analyzeData.recall_features.cvd.large_delta_bar ? "#fbbf24" : C.muted },
                    ].map((f) => (
                      <div key={f.label} className="rounded p-3" style={{ backgroundColor: "#0e0e0f" }}>
                        <MicroLabel>{f.label}</MicroLabel>
                        <div className="mt-1 font-headline font-bold text-sm" style={{ color: f.color ?? "#ffffff" }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
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
                ].map((s, i) => (
                  <div key={i} className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                    <MicroLabel>{s.label}</MicroLabel>
                    <div className="mt-2 font-headline font-bold text-xl" style={{ color: s.accent ?? "#ffffff" }}>{s.value}</div>
                    {s.sub && <div style={{ fontSize: "9px", color: C.outlineVar, marginTop: "3px", fontFamily: "Space Grotesk" }}>{s.sub}</div>}
                  </div>
                ))}
              </div>

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
                        {["Time", "Dir", "Entry", "ML Prob", "Quality", "Regime", "P&L $", "Outcome"].map((h) => (
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
                          <td className="px-4 py-2" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: r.final_quality > 0.65 ? C.primary : C.muted }}>{(r.final_quality * 100).toFixed(0)}%</td>
                          <td className="px-4 py-2"><RegimeBadge regime={r.regime} /></td>
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
