import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend, Bar, BarChart,
} from "recharts";

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0e0e0f", card: "#1a191b", cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)", primary: "#9cff93", secondary: "#669dff",
  tertiary: "#ff7162", muted: "#adaaab", outline: "#767576",
  outlineVar: "#484849", gold: "#fbbf24", purple: "#a78bfa",
};

// ── Reusable UI ────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.16em",
      textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, color, dim }: {
  label: string; value: string | number; sub?: string; color?: string; dim?: boolean;
}) {
  return (
    <div className="rounded p-4 flex flex-col gap-1"
      style={{ background: C.card, border: `1px solid ${C.border}`, opacity: dim ? 0.4 : 1 }}>
      <Label>{label}</Label>
      <div className="font-bold" style={{ fontSize: "22px", fontFamily: "JetBrains Mono, monospace",
        color: color ?? C.primary, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "10px", color: C.muted }}>{sub}</div>}
    </div>
  );
}

function Pill({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "5px 14px", borderRadius: "20px", fontSize: "11px", fontFamily: "Space Grotesk",
        fontWeight: active ? 600 : 400,
        background: active ? C.primary : C.cardHigh,
        color: active ? "#0e0e0f" : C.muted,
        border: `1px solid ${active ? C.primary : C.outlineVar}`,
        cursor: "pointer", transition: "all 0.15s",
      }}>
      {children}
    </button>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────
type MarketTrade = {
  bar_idx: number; timestamp: string; direction: "long" | "short";
  entry: number; stop: number; target: number; exit: number;
  outcome: "win" | "loss" | "open"; pnl_pct: number;
  risk_r: number; si_approved: boolean; si_win_prob: number; setup_type: string;
};
type BacktestSummary = {
  total_bars: number; signals_detected: number; trades_taken: number;
  si_filtered_out: number; wins: number; losses: number;
  win_rate: number; profit_factor: number; total_pnl_pct: number;
  max_drawdown_pct: number; sharpe_ratio: number;
  best_trade_pct: number; worst_trade_pct: number; avg_rrr: number;
};
type BacktestResult = {
  config: { symbol: string; timeframe: string; lookback_days: number };
  summary: BacktestSummary;
  equity_curve: Array<{ idx: number; ts: string; baseline: number; si: number }>;
  trades: MarketTrade[];
  by_setup: Record<string, { count: number; wins: number; win_rate: number }>;
  generated_at: string;
  has_real_data: boolean;
  cached?: boolean;
};
type TFOption = { value: string; label: string };

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "–";
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n, 1)}%`;
const fmtColor = (n: number, zero = 0) => n > zero ? C.primary : n < zero ? C.tertiary : C.muted;

const SYMBOLS = [
  "BTCUSD", "ETHUSD", "SOLUSD", "EURUSD", "GBPUSD",
  "AAPL", "TSLA", "NVDA", "SPY", "QQQ",
];
const LOOKBACK = [7, 14, 30, 60, 90, 180, 365];

// ── Custom Tooltip ─────────────────────────────────────────────────────────
function EquityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.cardHigh, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px" }}>
      <div style={{ fontSize: "9px", color: C.outline, marginBottom: 4 }}>BAR #{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ fontSize: "11px", color: p.color, fontFamily: "JetBrains Mono" }}>
          {p.name}: ${p.value?.toLocaleString()}
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function BacktesterPage() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [customSymbol, setCustomSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("1Hour");
  const [lookback, setLookback] = useState(30);
  const [useSI, setUseSI] = useState(true);
  const [initialEquity, setInitialEquity] = useState(10_000);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [activeTab, setActiveTab] = useState<"chart" | "trades" | "setups">("chart");

  // Load available timeframes
  const { data: tfData } = useQuery({
    queryKey: ["backtest-timeframes"],
    queryFn: () => fetch("/api/backtest/timeframes").then(r => r.ok ? r.json() : { timeframes: [] }),
    staleTime: Infinity,
  });
  const timeframes: TFOption[] = tfData?.timeframes ?? [
    { value: "5Min", label: "5 Min" }, { value: "15Min", label: "15 Min" },
    { value: "30Min", label: "30 Min" }, { value: "1Hour", label: "1 Hour" },
    { value: "2Hour", label: "2 Hour" }, { value: "4Hour", label: "4 Hour" },
    { value: "1Day", label: "Daily" },
  ];

  const runMutation = useMutation({
    mutationFn: async () => {
      const sym = customSymbol.trim().toUpperCase() || symbol;
      const resp = await fetch("/api/backtest/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: sym, timeframe, lookback_days: lookback,
          initial_equity: initialEquity, use_si_filter: useSI,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      return resp.json() as Promise<BacktestResult>;
    },
    onSuccess: (data) => setResult(data),
  });

  const effectiveSymbol = customSymbol.trim().toUpperCase() || symbol;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px", fontFamily: "Space Grotesk, sans-serif" }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: "32px", color: "#fff", letterSpacing: "0.04em", margin: 0 }}>
            BACKTESTER
          </h1>
          <div style={{ fontSize: "11px", color: C.muted, marginTop: 2 }}>
            SK Setup Detection · Super Intelligence Filter · Multi-Timeframe · Live Alpaca Bars
          </div>
        </div>
        {result && (
          <div style={{ fontSize: "10px", color: C.outline, textAlign: "right" }}>
            <div>{result.has_real_data ? "🟢 Live Data" : "🟡 Synthetic Data"}</div>
            <div style={{ marginTop: 2 }}>{result.cached ? "Cached" : "Fresh"} · {new Date(result.generated_at).toLocaleTimeString()}</div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="rounded-lg p-5 mb-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
          {/* Symbol */}
          <div className="flex flex-col gap-2">
            <Label>Symbol</Label>
            <div className="flex flex-wrap gap-1 mb-1">
              {SYMBOLS.map(s => (
                <Pill key={s} active={!customSymbol && symbol === s} onClick={() => { setSymbol(s); setCustomSymbol(""); }}>
                  {s}
                </Pill>
              ))}
            </div>
            <input
              value={customSymbol}
              onChange={e => setCustomSymbol(e.target.value.toUpperCase())}
              placeholder="Custom symbol…"
              style={{
                background: C.cardHigh, border: `1px solid ${C.outlineVar}`, borderRadius: 6,
                padding: "6px 10px", fontSize: "12px", color: "#fff", outline: "none",
                fontFamily: "JetBrains Mono, monospace", width: "100%",
              }}
            />
          </div>

          {/* Timeframe */}
          <div className="flex flex-col gap-2">
            <Label>Timeframe</Label>
            <div className="flex flex-wrap gap-1">
              {timeframes.map((tf: TFOption) => (
                <Pill key={tf.value} active={timeframe === tf.value} onClick={() => setTimeframe(tf.value)}>
                  {tf.label}
                </Pill>
              ))}
            </div>
          </div>

          {/* Lookback */}
          <div className="flex flex-col gap-2">
            <Label>Lookback Period</Label>
            <div className="flex flex-wrap gap-1">
              {LOOKBACK.map(d => (
                <Pill key={d} active={lookback === d} onClick={() => setLookback(d)}>
                  {d}d
                </Pill>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div className="flex flex-col gap-3">
            <div>
              <Label>Initial Equity ($)</Label>
              <input
                type="number" value={initialEquity}
                onChange={e => setInitialEquity(Number(e.target.value))}
                style={{
                  marginTop: 6, background: C.cardHigh, border: `1px solid ${C.outlineVar}`,
                  borderRadius: 6, padding: "6px 10px", fontSize: "12px", color: "#fff",
                  outline: "none", fontFamily: "JetBrains Mono", width: "100%",
                }}
              />
            </div>
            <div className="flex items-center gap-2" style={{ cursor: "pointer" }} onClick={() => setUseSI(v => !v)}>
              <div style={{
                width: 34, height: 18, borderRadius: 9,
                background: useSI ? C.primary : C.outlineVar,
                position: "relative", transition: "background 0.2s",
              }}>
                <div style={{
                  position: "absolute", top: 3, left: useSI ? 18 : 3,
                  width: 12, height: 12, borderRadius: "50%",
                  background: "#fff", transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: "11px", color: C.muted }}>Super Intelligence Filter</span>
            </div>
          </div>

          {/* Run Button */}
          <div className="flex items-end">
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              style={{
                background: runMutation.isPending ? C.outlineVar : C.primary,
                color: "#0e0e0f", fontWeight: 700, fontSize: "13px",
                fontFamily: "Space Grotesk", padding: "12px 28px", borderRadius: 8,
                border: "none", cursor: runMutation.isPending ? "not-allowed" : "pointer",
                letterSpacing: "0.05em", whiteSpace: "nowrap",
                transition: "background 0.15s",
              }}>
              {runMutation.isPending ? "RUNNING…" : "▶ RUN BACKTEST"}
            </button>
          </div>
        </div>

        {runMutation.isError && (
          <div style={{ marginTop: 12, color: C.tertiary, fontSize: "11px" }}>
            ⚠ {String(runMutation.error)}
          </div>
        )}
      </div>

      {/* Results */}
      {result ? (
        <>
          {/* Summary KPIs */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
            <StatCard label="Win Rate" value={`${fmt(result.summary.win_rate * 100, 1)}%`}
              sub={`${result.summary.wins}W / ${result.summary.losses}L`}
              color={result.summary.win_rate >= 0.5 ? C.primary : C.tertiary} />
            <StatCard label="Profit Factor" value={fmt(result.summary.profit_factor)}
              sub="gross win / loss" color={result.summary.profit_factor >= 1.5 ? C.primary : result.summary.profit_factor >= 1 ? C.gold : C.tertiary} />
            <StatCard label="Total P&L" value={fmtPct(result.summary.total_pnl_pct)}
              color={fmtColor(result.summary.total_pnl_pct)} sub="across all trades" />
            <StatCard label="Sharpe" value={fmt(result.summary.sharpe_ratio)}
              color={result.summary.sharpe_ratio >= 1 ? C.primary : result.summary.sharpe_ratio >= 0 ? C.gold : C.tertiary}
              sub="annualised" />
            <StatCard label="Max Drawdown" value={`${fmt(result.summary.max_drawdown_pct, 1)}%`}
              color={result.summary.max_drawdown_pct < 10 ? C.primary : result.summary.max_drawdown_pct < 20 ? C.gold : C.tertiary}
              sub="peak-to-trough" />
            <StatCard label="Avg RR" value={`${fmt(result.summary.avg_rrr, 1)}R`}
              color={result.summary.avg_rrr >= 2 ? C.primary : C.gold} sub="risk:reward" />
            <StatCard label="Signals" value={result.summary.signals_detected}
              sub={`${result.summary.si_filtered_out} filtered by SI`} color={C.secondary} />
            <StatCard label="Trades" value={result.summary.trades_taken}
              sub={`${result.summary.total_bars.toLocaleString()} bars scanned`} color={C.purple} />
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            {(["chart", "trades", "setups"] as const).map(tab => (
              <Pill key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Pill>
            ))}
          </div>

          {/* Chart Tab */}
          {activeTab === "chart" && (
            <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div style={{ fontFamily: "Bebas Neue", fontSize: "16px", color: "#fff", letterSpacing: "0.06em" }}>
                    EQUITY CURVE — {effectiveSymbol} {result.config.timeframe} {result.config.lookback_days}d
                  </div>
                  <div style={{ fontSize: "10px", color: C.outline, marginTop: 2 }}>
                    Baseline vs Super Intelligence filtered
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-1">
                    <div style={{ width: 10, height: 2, background: C.secondary }} />
                    <span style={{ fontSize: "10px", color: C.muted }}>Baseline</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div style={{ width: 10, height: 2, background: C.primary }} />
                    <span style={{ fontSize: "10px", color: C.muted }}>SI Filtered</span>
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={result.equity_curve} margin={{ top: 4, right: 16, bottom: 0, left: 48 }}>
                  <defs>
                    <linearGradient id="siGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.primary} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={C.primary} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.secondary} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={C.secondary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} strokeOpacity={0.4} />
                  <XAxis dataKey="idx" tick={{ fill: C.outline, fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: C.outline, fontSize: 9 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                  <Tooltip content={<EquityTooltip />} />
                  <Area type="monotone" dataKey="baseline" stroke={C.secondary} strokeWidth={1.5}
                    fill="url(#baseGrad)" dot={false} name="Baseline" />
                  <Area type="monotone" dataKey="si" stroke={C.primary} strokeWidth={2}
                    fill="url(#siGrad)" dot={false} name="SI Filtered" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Trades Tab */}
          {activeTab === "trades" && (
            <div className="rounded-lg overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontFamily: "Bebas Neue", fontSize: "15px", color: "#fff", letterSpacing: "0.06em" }}>
                  TRADE LOG — {result.trades.length} trades
                </span>
              </div>
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.outlineVar}` }}>
                      {["#", "Time", "Setup", "Dir", "Entry", "Stop", "Target", "Exit", "P&L", "RR", "SI%"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.outline, fontWeight: 400 }}>
                          <Label>{h}</Label>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} style={{
                        borderBottom: `1px solid ${C.outlineVar}22`,
                        background: i % 2 === 0 ? "transparent" : `${C.cardHigh}44`,
                      }}>
                        <td style={{ padding: "7px 10px", color: C.outline, fontFamily: "JetBrains Mono" }}>{t.bar_idx}</td>
                        <td style={{ padding: "7px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                          {t.timestamp ? new Date(t.timestamp).toLocaleDateString() : "–"}
                        </td>
                        <td style={{ padding: "7px 10px", color: C.purple }}>{t.setup_type.replace("_", " ")}</td>
                        <td style={{ padding: "7px 10px", color: t.direction === "long" ? C.primary : C.tertiary, fontWeight: 600 }}>
                          {t.direction.toUpperCase()}
                        </td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", color: "#fff" }}>{t.entry.toFixed(2)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", color: C.tertiary }}>{t.stop.toFixed(2)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", color: C.primary }}>{t.target.toFixed(2)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", color: C.muted }}>{t.exit.toFixed(2)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", fontWeight: 600,
                          color: t.outcome === "win" ? C.primary : t.outcome === "loss" ? C.tertiary : C.gold }}>
                          {fmtPct(t.pnl_pct)}
                        </td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", color: C.gold }}>{fmt(t.risk_r, 1)}R</td>
                        <td style={{ padding: "7px 10px", fontFamily: "JetBrains Mono", color: C.secondary }}>
                          {fmt(t.si_win_prob * 100, 0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Setups Tab */}
          {activeTab === "setups" && (
            <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: "Bebas Neue", fontSize: "15px", color: "#fff", letterSpacing: "0.06em", marginBottom: 16 }}>
                SETUP BREAKDOWN
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {Object.entries(result.by_setup).map(([setup, stats]) => (
                  <div key={setup} className="rounded p-4" style={{ background: C.cardHigh, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: "11px", color: C.purple, marginBottom: 8, textTransform: "capitalize" }}>
                      {setup.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono", fontSize: "20px", color: stats.win_rate >= 0.5 ? C.primary : C.tertiary }}>
                      {fmt(stats.win_rate * 100, 1)}%
                    </div>
                    <div style={{ fontSize: "10px", color: C.outline, marginTop: 4 }}>
                      {stats.wins}W / {stats.count - stats.wins}L of {stats.count} trades
                    </div>
                    <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: C.outlineVar }}>
                      <div style={{ width: `${stats.win_rate * 100}%`, height: "100%", borderRadius: 2,
                        background: stats.win_rate >= 0.5 ? C.primary : C.tertiary }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Setup breakdown bar chart */}
              {Object.keys(result.by_setup).length > 0 && (
                <div className="mt-6">
                  <Label>Win Rate by Setup</Label>
                  <ResponsiveContainer width="100%" height={220} className="mt-3">
                    <BarChart
                      data={Object.entries(result.by_setup).map(([k, v]) => ({
                        name: k.replace(/_/g, " "), win_rate: +(v.win_rate * 100).toFixed(1), trades: v.count,
                      }))}
                      margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} strokeOpacity={0.4} />
                      <XAxis dataKey="name" tick={{ fill: C.outline, fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: C.outline, fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: C.cardHigh, border: `1px solid ${C.border}`, borderRadius: 6 }}
                        labelStyle={{ color: "#fff" }} itemStyle={{ color: C.primary }} />
                      <Bar dataKey="win_rate" name="Win Rate %" fill={C.primary} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-lg"
          style={{ background: C.card, border: `1px solid ${C.border}`, height: 340, color: C.outline }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontFamily: "Bebas Neue", fontSize: 22, letterSpacing: "0.06em", color: C.muted }}>
            SELECT SYMBOL + TIMEFRAME AND RUN
          </div>
          <div style={{ fontSize: 11, marginTop: 8, color: C.outline }}>
            Live Alpaca bars · SK setup detection · Super Intelligence filter
          </div>
        </div>
      )}
    </div>
  );
}
