import { useState, useEffect } from "react";

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0e0e0f", card: "#1a191b", cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)", primary: "#9cff93", secondary: "#669dff",
  tertiary: "#ff7162", muted: "#adaaab", outline: "#767576",
  gold: "#fbbf24", purple: "#a78bfa",
  green: "#22c55e", red: "#ef4444", cyan: "#06b6d4",
};

const API = "/api/backtest/crypto";

type BacktestResult = {
  symbol: string; timeframe: string; candles: number; trades: number;
  metrics: {
    total_trades: number; wins: number; losses: number; win_rate: number;
    profit_factor: number; total_return_pct: number; avg_pnl_pct: number;
    avg_r_multiple: number; max_drawdown_pct: number; sharpe_ratio: number;
    best_trade_pct: number; worst_trade_pct: number; avg_holding_candles: number;
    long_trades: number; long_wins: number; long_win_rate: number; long_total_pnl: number;
    short_trades: number; short_wins: number; short_win_rate: number; short_total_pnl: number;
    final_equity: number;
  };
  approved: boolean | string;
};

type MasterSummary = {
  ok: boolean; generated_at: string; initial_capital: number;
  fees_pct: number; slippage_pct: number; order_flow_method: string;
  results: BacktestResult[];
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9px", fontFamily: "Space Grotesk, sans-serif", letterSpacing: "0.16em",
      textTransform: "uppercase", color: C.outline }}>{children}</span>
  );
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 4 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 22, fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
        color: color ?? C.primary, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted }}>{sub}</div>}
    </div>
  );
}

function grade(pf: number, wr: number, dd: number, trades: number): { label: string; color: string } {
  if (pf > 2 && wr > 60 && dd < 15 && trades >= 10) return { label: "A+", color: C.green };
  if (pf > 1.5 && wr > 50 && dd < 20) return { label: "A", color: C.primary };
  if (pf > 1.0 && wr > 40 && dd < 25) return { label: "B", color: C.gold };
  if (pf > 0.7) return { label: "C", color: "#f97316" };
  return { label: "D", color: C.red };
}

const PLOTS = ["price_chart", "order_flow", "equity_curve", "trade_distribution", "summary"] as const;
const PLOT_LABELS: Record<string, string> = {
  price_chart: "Price + Order Blocks", order_flow: "Order Flow Proxy",
  equity_curve: "Equity Curve", trade_distribution: "Trade Distribution",
  summary: "Summary Dashboard",
};

export default function CryptoBacktests() {
  const [data, setData] = useState<MasterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BacktestResult | null>(null);
  const [activePlot, setActivePlot] = useState<string>("summary");
  const [report, setReport] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "detail">("grid");

  useEffect(() => {
    fetch(`${API}/summary`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const loadReport = (sym: string, tf: string) => {
    fetch(`${API}/${sym}/${tf}/report`)
      .then(r => r.json())
      .then(d => setReport(d.report ?? "No report available"))
      .catch(() => setReport("Failed to load report"));
  };

  const selectResult = (r: BacktestResult) => {
    setSelected(r);
    setViewMode("detail");
    setActivePlot("summary");
    loadReport(r.symbol, r.timeframe);
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", color: C.muted, fontFamily: "Space Grotesk, sans-serif" }}>
      Loading crypto backtest results...
    </div>
  );
  if (error) return (
    <div style={{ padding: 32, color: C.tertiary, fontFamily: "Space Grotesk, sans-serif" }}>
      Error: {error}
    </div>
  );
  if (!data || !data.results) return (
    <div style={{ padding: 32, color: C.muted }}>No backtest data available.</div>
  );

  const sorted = [...data.results].sort((a, b) => b.metrics.total_return_pct - a.metrics.total_return_pct);
  const best = sorted[0];
  const totalTrades = data.results.reduce((s, r) => s + r.metrics.total_trades, 0);
  const avgWR = data.results.reduce((s, r) => s + r.metrics.win_rate, 0) / data.results.length;
  const avgPF = data.results.reduce((s, r) => s + r.metrics.profit_factor, 0) / data.results.length;
  const profitable = data.results.filter(r => r.metrics.total_return_pct > 0).length;

  return (
    <div style={{ padding: "24px 28px", fontFamily: "Space Grotesk, sans-serif", color: "#e2e0e1",
      minHeight: "100vh", background: C.bg }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>
            Crypto Backtest Results
          </h1>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            Generated {new Date(data.generated_at).toLocaleString()} · Capital: $
            {data.initial_capital.toLocaleString()} · Fees: {(data.fees_pct * 100).toFixed(2)}% · Slippage: {(data.slippage_pct * 100).toFixed(2)}%
            · Flow: {data.order_flow_method}
          </div>
        </div>
        {viewMode === "detail" && (
          <button onClick={() => setViewMode("grid")}
            style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.cardHigh, color: C.primary, cursor: "pointer", fontSize: 12 }}>
            ← Back to Grid
          </button>
        )}
      </div>

      {/* Global Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Backtests" value={data.results.length} sub="3 symbols × 4 timeframes" />
        <StatCard label="Total Trades" value={totalTrades} sub="across all combos" />
        <StatCard label="Avg Win Rate" value={`${avgWR.toFixed(1)}%`}
          color={avgWR > 50 ? C.green : C.tertiary} />
        <StatCard label="Avg Profit Factor" value={avgPF.toFixed(2)}
          color={avgPF > 1.0 ? C.green : C.tertiary} />
        <StatCard label="Profitable" value={`${profitable}/${data.results.length}`}
          color={profitable > 6 ? C.green : C.gold} />
        <StatCard label="Best Performer" value={`${best.symbol} ${best.timeframe}`}
          sub={`+${best.metrics.total_return_pct.toFixed(1)}%`} color={C.gold} />
      </div>

      {viewMode === "grid" ? (
        /* ── Grid View ────────────────────────────────── */
        <>
          {["BTCUSD", "ETHUSD", "SOLUSD"].map(sym => {
            const symResults = sorted.filter(r => r.symbol === sym);
            return (
              <div key={sym} style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: C.secondary, marginBottom: 12 }}>
                  {sym === "BTCUSD" ? "₿ Bitcoin" : sym === "ETHUSD" ? "Ξ Ethereum" : "◎ Solana"} — {sym}
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                  {["5m", "15m", "1h", "4h"].map(tf => {
                    const r = data.results.find(x => x.symbol === sym && x.timeframe === tf);
                    if (!r) return null;
                    const g = grade(r.metrics.profit_factor, r.metrics.win_rate, r.metrics.max_drawdown_pct, r.metrics.total_trades);
                    const isProfit = r.metrics.total_return_pct > 0;
                    return (
                      <div key={tf} onClick={() => selectResult(r)}
                        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                          padding: 16, cursor: "pointer", transition: "border-color 0.2s",
                          borderLeft: `3px solid ${g.color}` }}
                        onMouseOver={e => (e.currentTarget.style.borderColor = C.primary)}
                        onMouseOut={e => (e.currentTarget.style.borderColor = C.border)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{tf}</span>
                          <span style={{ fontSize: 18, fontWeight: 700, color: g.color,
                            fontFamily: "JetBrains Mono, monospace" }}>{g.label}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                          <div><Label>Return</Label><div style={{ color: isProfit ? C.green : C.red, fontWeight: 600, fontSize: 14 }}>
                            {isProfit ? "+" : ""}{r.metrics.total_return_pct.toFixed(2)}%</div></div>
                          <div><Label>Win Rate</Label><div style={{ fontWeight: 600, fontSize: 14 }}>
                            {r.metrics.win_rate.toFixed(1)}%</div></div>
                          <div><Label>Profit Factor</Label><div style={{ fontWeight: 600 }}>
                            {r.metrics.profit_factor.toFixed(2)}</div></div>
                          <div><Label>Max DD</Label><div style={{ color: r.metrics.max_drawdown_pct > 15 ? C.red : C.muted, fontWeight: 600 }}>
                            {r.metrics.max_drawdown_pct.toFixed(2)}%</div></div>
                          <div><Label>Trades</Label><div>{r.metrics.total_trades}</div></div>
                          <div><Label>Sharpe</Label><div style={{ color: r.metrics.sharpe_ratio > 0 ? C.green : C.red }}>
                            {r.metrics.sharpe_ratio.toFixed(2)}</div></div>
                        </div>
                        <div style={{ marginTop: 10, fontSize: 10, color: C.muted,
                          display: "flex", justifyContent: "space-between" }}>
                          <span>L: {r.metrics.long_wins}/{r.metrics.long_trades} ({r.metrics.long_total_pnl > 0 ? "+" : ""}{r.metrics.long_total_pnl.toFixed(1)}%)</span>
                          <span>S: {r.metrics.short_wins}/{r.metrics.short_trades} ({r.metrics.short_total_pnl > 0 ? "+" : ""}{r.metrics.short_total_pnl.toFixed(1)}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Ranking Table */}
          <div style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Performance Ranking</h2>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.outline, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {["Rank", "Symbol", "TF", "Return", "Win Rate", "PF", "Sharpe", "Max DD", "Trades", "Grade"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const g = grade(r.metrics.profit_factor, r.metrics.win_rate, r.metrics.max_drawdown_pct, r.metrics.total_trades);
                    return (
                      <tr key={`${r.symbol}-${r.timeframe}`}
                        onClick={() => selectResult(r)}
                        style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}
                        onMouseOver={e => (e.currentTarget.style.background = C.cardHigh)}
                        onMouseOut={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding: "10px 12px", color: C.muted }}>#{i + 1}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>{r.symbol}</td>
                        <td style={{ padding: "10px 12px" }}>{r.timeframe}</td>
                        <td style={{ padding: "10px 12px", color: r.metrics.total_return_pct > 0 ? C.green : C.red, fontWeight: 600 }}>
                          {r.metrics.total_return_pct > 0 ? "+" : ""}{r.metrics.total_return_pct.toFixed(2)}%</td>
                        <td style={{ padding: "10px 12px" }}>{r.metrics.win_rate.toFixed(1)}%</td>
                        <td style={{ padding: "10px 12px" }}>{r.metrics.profit_factor.toFixed(2)}</td>
                        <td style={{ padding: "10px 12px", color: r.metrics.sharpe_ratio > 0 ? C.green : C.red }}>
                          {r.metrics.sharpe_ratio.toFixed(2)}</td>
                        <td style={{ padding: "10px 12px" }}>{r.metrics.max_drawdown_pct.toFixed(2)}%</td>
                        <td style={{ padding: "10px 12px" }}>{r.metrics.total_trades}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10,
                            fontWeight: 700, background: `${g.color}22`, color: g.color }}>{g.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : selected ? (
        /* ── Detail View ────────────────────────────────── */
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {selected.symbol} — {selected.timeframe}
            </h2>
            {(() => {
              const g = grade(selected.metrics.profit_factor, selected.metrics.win_rate,
                selected.metrics.max_drawdown_pct, selected.metrics.total_trades);
              return <span style={{ padding: "4px 14px", borderRadius: 14, fontSize: 13,
                fontWeight: 700, background: `${g.color}22`, color: g.color }}>Grade {g.label}</span>;
            })()}
          </div>

          {/* Detail Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
            <StatCard label="Return" value={`${selected.metrics.total_return_pct > 0 ? "+" : ""}${selected.metrics.total_return_pct.toFixed(2)}%`}
              color={selected.metrics.total_return_pct > 0 ? C.green : C.red} />
            <StatCard label="Final Equity" value={`$${selected.metrics.final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
            <StatCard label="Profit Factor" value={selected.metrics.profit_factor.toFixed(2)}
              color={selected.metrics.profit_factor > 1 ? C.green : C.red} />
            <StatCard label="Win Rate" value={`${selected.metrics.win_rate.toFixed(1)}%`}
              color={selected.metrics.win_rate > 50 ? C.green : C.gold} />
            <StatCard label="Sharpe Ratio" value={selected.metrics.sharpe_ratio.toFixed(2)}
              color={selected.metrics.sharpe_ratio > 1 ? C.green : C.red} />
            <StatCard label="Max Drawdown" value={`${selected.metrics.max_drawdown_pct.toFixed(2)}%`}
              color={selected.metrics.max_drawdown_pct > 15 ? C.red : C.gold} />
            <StatCard label="Avg R" value={selected.metrics.avg_r_multiple.toFixed(2)}
              color={selected.metrics.avg_r_multiple > 0 ? C.green : C.red} />
            <StatCard label="Trades" value={selected.metrics.total_trades}
              sub={`W:${selected.metrics.wins} L:${selected.metrics.losses}`} />
          </div>

          {/* Long/Short Breakdown */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
              <Label>Long Performance</Label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, fontSize: 12 }}>
                <div>Trades: <b>{selected.metrics.long_trades}</b></div>
                <div>Win Rate: <b>{selected.metrics.long_win_rate.toFixed(1)}%</b></div>
                <div>Wins: <b>{selected.metrics.long_wins}</b></div>
                <div style={{ color: selected.metrics.long_total_pnl > 0 ? C.green : C.red }}>
                  PnL: <b>{selected.metrics.long_total_pnl > 0 ? "+" : ""}{selected.metrics.long_total_pnl.toFixed(2)}%</b></div>
              </div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
              <Label>Short Performance</Label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, fontSize: 12 }}>
                <div>Trades: <b>{selected.metrics.short_trades}</b></div>
                <div>Win Rate: <b>{selected.metrics.short_win_rate.toFixed(1)}%</b></div>
                <div>Wins: <b>{selected.metrics.short_wins}</b></div>
                <div style={{ color: selected.metrics.short_total_pnl > 0 ? C.green : C.red }}>
                  PnL: <b>{selected.metrics.short_total_pnl > 0 ? "+" : ""}{selected.metrics.short_total_pnl.toFixed(2)}%</b></div>
              </div>
            </div>
          </div>

          {/* Plot Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {PLOTS.map(p => (
              <button key={p} onClick={() => setActivePlot(p)}
                style={{ padding: "6px 16px", borderRadius: 20, fontSize: 11,
                  fontWeight: activePlot === p ? 600 : 400,
                  background: activePlot === p ? C.primary : C.cardHigh,
                  color: activePlot === p ? "#0e0e0f" : C.muted,
                  border: `1px solid ${activePlot === p ? C.primary : C.border}`,
                  cursor: "pointer" }}>
                {PLOT_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Plot Image */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: 12, marginBottom: 20, textAlign: "center" }}>
            <img
              src={`${API}/${selected.symbol}/${selected.timeframe}/plot/${activePlot}`}
              alt={`${selected.symbol} ${selected.timeframe} ${activePlot}`}
              style={{ maxWidth: "100%", borderRadius: 6, background: "#111" }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).parentElement!.innerHTML +=
                  '<div style="padding:40px;color:#adaaab">Plot not available</div>';
              }}
            />
          </div>

          {/* Report */}
          {report && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
              <Label>Backtest Report</Label>
              <pre style={{ marginTop: 10, fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                color: C.muted, whiteSpace: "pre-wrap", lineHeight: 1.6, maxHeight: 500, overflow: "auto" }}>
                {report}
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
