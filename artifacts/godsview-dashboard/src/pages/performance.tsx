import { useGetPerformance } from "@workspace/api-client-react";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const C = {
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

const DAYS_OPTIONS = [7, 30, 90];

type ModelDiagnosticsPayload = {
  validation: { auc: number; accuracy: number } | null;
  drift: { status: "stable" | "watch" | "drift"; winRateDelta: number; qualityDelta: number } | null;
};
type OosPayload = {
  deltas: { winRateDelta: number; expectancyDeltaR: number; avgFinalQualityDelta: number };
};

export default function Performance() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGetPerformance({ days });
  const { data: modelDiagnostics } = useQuery<ModelDiagnosticsPayload>({
    queryKey: ["system-model-diagnostics"],
    queryFn: () => fetch("/api/system/model/diagnostics").then((r: any) => r.json()),
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const { data: oosProof } = useQuery<OosPayload>({
    queryKey: ["proof-oos-vs-is"],
    queryFn: () => fetch("/api/system/proof/oos-vs-is?lookback_days=90&oos_days=14&min_signals=20").then((r: any) => r.json()),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
      </div>
    );
  }

  const stats = [
    { label: "Total P&L", value: formatCurrency(data.total_pnl), accent: data.total_pnl >= 0 ? C.primary : C.tertiary },
    { label: "Win Rate", value: formatPercent(data.win_rate), accent: data.win_rate > 50 ? C.primary : C.muted },
    { label: "Profit Factor", value: data.profit_factor.toFixed(2), accent: data.profit_factor > 1 ? C.primary : C.tertiary },
    { label: "Total Trades", value: String(data.total_trades), accent: "#ffffff" },
    { label: "Avg Win", value: formatCurrency(data.avg_win), accent: C.primary },
    { label: "Max Drawdown", value: formatCurrency(data.max_drawdown), accent: C.tertiary },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Performance
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Performance Analytics</h1>
        </div>
        <div className="flex gap-1 rounded p-1" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="rounded px-3 py-1.5 transition-all"
              style={{
                fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                backgroundColor: days === d ? "rgba(156,255,147,0.12)" : "transparent",
                color: days === d ? C.primary : C.outline,
                border: days === d ? `1px solid rgba(156,255,147,0.2)` : "1px solid transparent",
              }}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map((s, i) => (
          <div key={i} className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <MicroLabel>{s.label}</MicroLabel>
            <div className="mt-2 font-headline font-bold text-lg" style={{ color: s.accent }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>monitoring</span>
          <MicroLabel>Model Stability</MicroLabel>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Purged CV AUC</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
              {modelDiagnostics?.validation ? modelDiagnostics.validation.auc.toFixed(3) : "n/a"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Drift Status</MicroLabel>
            <div style={{
              marginTop: "4px",
              fontSize: "11px",
              fontFamily: "JetBrains Mono, monospace",
              color: modelDiagnostics?.drift?.status === "drift" ? C.tertiary : modelDiagnostics?.drift?.status === "watch" ? "#fbbf24" : C.primary,
            }}>
              {(modelDiagnostics?.drift?.status ?? "n/a").toUpperCase()}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>OOS Win Δ</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: (oosProof?.deltas.winRateDelta ?? 0) >= 0 ? C.primary : C.tertiary }}>
              {oosProof ? `${(oosProof.deltas.winRateDelta * 100).toFixed(2)}%` : "n/a"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>OOS Exp ΔR</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: (oosProof?.deltas.expectancyDeltaR ?? 0) >= 0 ? C.primary : C.tertiary }}>
              {oosProof ? `${oosProof.deltas.expectancyDeltaR >= 0 ? "+" : ""}${oosProof.deltas.expectancyDeltaR.toFixed(2)}` : "n/a"}
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Equity Curve */}
        <div className="lg:col-span-2 rounded p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>show_chart</span>
            <MicroLabel>Equity Curve</MicroLabel>
          </div>
          <div style={{ height: "240px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.equity_curve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#9cff93" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#9cff93" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(72,72,73,0.3)" vertical={false} />
                <XAxis dataKey="date" stroke={C.outlineVar} fontSize={9} tickLine={false} axisLine={false} fontFamily="Space Grotesk" />
                <YAxis stroke={C.outlineVar} fontSize={9} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} fontFamily="JetBrains Mono, monospace" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#201f21", borderColor: "rgba(72,72,73,0.4)", borderRadius: "4px", fontSize: "10px" }}
                  itemStyle={{ color: C.primary, fontFamily: "JetBrains Mono, monospace" }}
                />
                <Area type="monotone" dataKey="equity" stroke="#9cff93" strokeWidth={1.5} fillOpacity={1} fill="url(#eqGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Edge by Setup */}
        <div className="rounded p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>bar_chart</span>
            <MicroLabel>Edge by Setup</MicroLabel>
          </div>
          <div style={{ height: "240px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_setup} layout="vertical" margin={{ top: 0, right: 4, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(72,72,73,0.3)" horizontal={false} vertical={true} />
                <XAxis type="number" stroke={C.outlineVar} fontSize={9} tickLine={false} axisLine={false} fontFamily="JetBrains Mono, monospace" />
                <YAxis dataKey="setup_type" type="category" stroke={C.outlineVar} fontSize={8} tickLine={false} axisLine={false} width={70} fontFamily="Space Grotesk" />
                <Tooltip contentStyle={{ backgroundColor: "#201f21", borderColor: "rgba(72,72,73,0.4)", borderRadius: "4px", fontSize: "10px" }} cursor={{ fill: "rgba(156,255,147,0.04)" }} />
                <Bar dataKey="expectancy" fill="#9cff93" radius={[0, 2, 2, 0]} barSize={14} fillOpacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Session + Regime Tables */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Session */}
        <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
            <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>schedule</span>
            <MicroLabel>Session Performance</MicroLabel>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                {["Session", "Win Rate", "P&L"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.by_session ?? []).map((s: any) => (
                <tr key={s.session} className="hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                  <td className="px-4 py-2.5 font-headline font-bold text-xs">{s.session}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{formatPercent(s.win_rate)}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: s.total_pnl >= 0 ? C.primary : C.tertiary }}>
                    {formatCurrency(s.total_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Regime */}
        <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
            <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>trending_up</span>
            <MicroLabel>Regime Performance</MicroLabel>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                {["Regime", "Win Rate", "P&L"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.by_regime ?? []).map((r: any) => (
                <tr key={r.regime} className="hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                  <td className="px-4 py-2.5 font-headline font-bold text-xs capitalize">{r.regime.replace("_", " ")}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{formatPercent(r.win_rate)}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: r.total_pnl >= 0 ? C.primary : C.tertiary }}>
                    {formatCurrency(r.total_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Status */}
      <div className="pt-5 border-t flex justify-between items-center" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
        <div className="flex items-center gap-2">
          <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outlineVar, letterSpacing: "0.2em", textTransform: "uppercase" }}>Data Pipeline Healthy</span>
        </div>
        <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>System V: 4.2.1-GODSVIEW</span>
      </div>
    </div>
  );
}
