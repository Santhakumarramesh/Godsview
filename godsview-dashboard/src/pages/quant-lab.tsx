import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

type BacktestResult = {
  baseline: { win_rate: number; profit_factor: number; sharpe_ratio: number; total_trades: number; net_pnl: number; max_drawdown: number; equity_curve: number[] };
  super_intelligence: { win_rate: number; profit_factor: number; sharpe_ratio: number; total_trades: number; net_pnl: number; max_drawdown: number; equity_curve: number[] };
  improvement: { win_rate_delta: number; pf_delta: number; sharpe_delta: number; signals_filtered_pct: number };
  significance: { is_significant: boolean; confidence_level: number; p_value: number };
  meta: { lookback_days: number; initial_equity: number; computed_at: string };
};

const KPI_STYLE: React.CSSProperties = {
  padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b",
  border: "1px solid rgba(72,72,73,0.15)", textAlign: "center",
};
const LABEL_STYLE: React.CSSProperties = {
  fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk",
  letterSpacing: "0.15em", marginBottom: "6px",
};
const VALUE_STYLE: React.CSSProperties = {
  fontSize: "18px", fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
};

function color(val: number, good: number, bad?: number): string {
  if (val >= good) return "#9cff93";
  if (bad !== undefined && val <= bad) return "#ff7162";
  return "#f0e442";
}

function pct(val: number): string { return `${(val * 100).toFixed(1)}%`; }

function MiniEquityCurve({ data, color: c, height = 48 }: { data: number[]; color: string; height?: number }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 280;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / range) * (height - 4)}`).join(" ");
  return (
    <svg width={w} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function QuantLabPage() {
  const [lookback, setLookback] = useState(30);
  const [equity, setEquity] = useState(10000);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookback_days: lookback, initial_equity: equity, mode: "comparison" }),
      });
      if (!res.ok) throw new Error("Backtest failed");
      return res.json() as Promise<BacktestResult>;
    },
  });

  // Quick load on mount
  const { data: quickData } = useQuery({
    queryKey: ["backtest-quick"],
    queryFn: async () => {
      const res = await fetch("/backtest/quick");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const bt = runMutation.data;

  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "18px", fontWeight: 700, letterSpacing: "0.15em", color: "#9cff93", marginBottom: "4px" }}>
            QUANT LAB
          </h1>
          <p style={{ fontSize: "11px", color: "#767576" }}>Backtest replay engine — Baseline vs Super Intelligence comparison</p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.1em", display: "block", marginBottom: "4px" }}>LOOKBACK</label>
          <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: "6px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.3)", color: "#fff", fontSize: "12px" }}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.1em", display: "block", marginBottom: "4px" }}>EQUITY</label>
          <input type="number" value={equity} onChange={(e) => setEquity(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: "6px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.3)", color: "#fff", fontSize: "12px", fontFamily: "JetBrains Mono, monospace", width: "120px" }} />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            style={{
              padding: "8px 24px", borderRadius: "6px",
              backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.3)",
              color: "#9cff93", fontSize: "11px", fontFamily: "Space Grotesk",
              fontWeight: 700, letterSpacing: "0.12em", cursor: runMutation.isPending ? "wait" : "pointer",
              opacity: runMutation.isPending ? 0.6 : 1,
            }}>
            {runMutation.isPending ? "RUNNING..." : "RUN BACKTEST"}
          </button>
        </div>
      </div>

      {runMutation.isError && (
        <p style={{ color: "#ff7162", fontSize: "12px", marginBottom: "16px" }}>
          Error: {(runMutation.error as Error).message}
        </p>
      )}

      {/* Quick stats (pre-loaded) */}
      {!bt && quickData && (
        <div style={{ padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", marginBottom: "24px" }}>
          <div style={{ fontSize: "10px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.1em", marginBottom: "12px" }}>LAST CACHED RESULT</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            <div style={KPI_STYLE}><div style={LABEL_STYLE}>SI WIN RATE</div><div style={{ ...VALUE_STYLE, color: color(quickData.si_win_rate, 0.55) }}>{pct(quickData.si_win_rate)}</div></div>
            <div style={KPI_STYLE}><div style={LABEL_STYLE}>DELTA</div><div style={{ ...VALUE_STYLE, color: quickData.win_rate_delta > 0 ? "#9cff93" : "#ff7162" }}>{quickData.win_rate_delta > 0 ? "+" : ""}{pct(quickData.win_rate_delta)}</div></div>
            <div style={KPI_STYLE}><div style={LABEL_STYLE}>SI SHARPE</div><div style={{ ...VALUE_STYLE, color: color(quickData.si_sharpe, 1) }}>{quickData.si_sharpe?.toFixed(2) ?? "—"}</div></div>
            <div style={KPI_STYLE}><div style={LABEL_STYLE}>SIGNIFICANT</div><div style={{ ...VALUE_STYLE, color: quickData.is_significant ? "#9cff93" : "#f0e442" }}>{quickData.is_significant ? "YES" : "NO"}</div></div>
          </div>
        </div>
      )}

      {/* Full backtest results */}
      {bt && (
        <div>
          {/* Significance badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px",
            borderRadius: "8px", marginBottom: "24px",
            backgroundColor: bt.significance.is_significant ? "rgba(156,255,147,0.05)" : "rgba(240,228,66,0.05)",
            border: `1px solid ${bt.significance.is_significant ? "rgba(156,255,147,0.25)" : "rgba(240,228,66,0.25)"}`,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "20px", color: bt.significance.is_significant ? "#9cff93" : "#f0e442" }}>
              {bt.significance.is_significant ? "verified" : "pending"}
            </span>
            <div>
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: 700, color: bt.significance.is_significant ? "#9cff93" : "#f0e442", letterSpacing: "0.1em" }}>
                {bt.significance.is_significant ? "STATISTICALLY SIGNIFICANT" : "NOT SIGNIFICANT"}
              </span>
              <span style={{ fontSize: "10px", color: "#767576", marginLeft: "12px" }}>
                Confidence: {pct(bt.significance.confidence_level)} | p-value: {bt.significance.p_value.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Comparison table */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
            {(["baseline", "super_intelligence"] as const).map((key) => {
              const d = bt[key];
              const label = key === "baseline" ? "BASELINE" : "SUPER INTELLIGENCE";
              const accent = key === "baseline" ? "#767576" : "#9cff93";
              return (
                <div key={key} style={{ padding: "20px", borderRadius: "8px", backgroundColor: "#1a191b", border: `1px solid ${accent}22` }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: "16px" }}>
                    {label}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                    <div><div style={LABEL_STYLE}>WIN RATE</div><div style={{ ...VALUE_STYLE, fontSize: "16px", color: color(d.win_rate, 0.55) }}>{pct(d.win_rate)}</div></div>
                    <div><div style={LABEL_STYLE}>PROFIT FACTOR</div><div style={{ ...VALUE_STYLE, fontSize: "16px", color: color(d.profit_factor, 1.5) }}>{d.profit_factor.toFixed(2)}</div></div>
                    <div><div style={LABEL_STYLE}>SHARPE</div><div style={{ ...VALUE_STYLE, fontSize: "16px", color: color(d.sharpe_ratio, 1) }}>{d.sharpe_ratio.toFixed(2)}</div></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                    <div><div style={LABEL_STYLE}>NET PnL</div><div style={{ ...VALUE_STYLE, fontSize: "14px", color: d.net_pnl >= 0 ? "#9cff93" : "#ff7162" }}>${d.net_pnl.toFixed(2)}</div></div>
                    <div><div style={LABEL_STYLE}>MAX DD</div><div style={{ ...VALUE_STYLE, fontSize: "14px", color: "#ff7162" }}>{pct(d.max_drawdown)}</div></div>
                    <div><div style={LABEL_STYLE}>TRADES</div><div style={{ ...VALUE_STYLE, fontSize: "14px", color: "#56b4e9" }}>{d.total_trades}</div></div>
                  </div>
                  {d.equity_curve && <MiniEquityCurve data={d.equity_curve} color={accent} />}
                </div>
              );
            })}
          </div>

          {/* Improvement deltas */}
          <h3 style={{ fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", color: "#adaaab", marginBottom: "12px" }}>
            SI IMPROVEMENT OVER BASELINE
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
            {[
              { label: "WIN RATE Δ", val: bt.improvement.win_rate_delta, fmt: (v: number) => `${v > 0 ? "+" : ""}${pct(v)}` },
              { label: "PF Δ", val: bt.improvement.pf_delta, fmt: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}` },
              { label: "SHARPE Δ", val: bt.improvement.sharpe_delta, fmt: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}` },
              { label: "FILTERED", val: bt.improvement.signals_filtered_pct, fmt: (v: number) => pct(v) },
            ].map((d) => (
              <div key={d.label} style={KPI_STYLE}>
                <div style={LABEL_STYLE}>{d.label}</div>
                <div style={{ ...VALUE_STYLE, fontSize: "16px", color: d.val > 0 ? "#9cff93" : d.val < 0 ? "#ff7162" : "#767576" }}>
                  {d.fmt(d.val)}
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: "10px", color: "#484849" }}>
            {bt.meta.lookback_days}d lookback | ${bt.meta.initial_equity.toLocaleString()} initial equity | Computed {new Date(bt.meta.computed_at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
