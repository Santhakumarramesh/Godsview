import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/* ── Types ──────────────────────────────────────────────────────────────────── */
type TimeHorizon = "1d" | "5d" | "10d" | "21d";
type StressScenario = {
  name: string;
  description: string;
  portfolioImpact: number;
  probability: number;
  severity: "low" | "medium" | "high" | "extreme";
};

type RiskMetrics = {
  var95: number;
  var99: number;
  cvar95: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  beta: number;
  volatility: number;
};

interface CorrelationMatrixResponse {
  assets?: string[];
  matrix?: number[][];
  symbols?: string[];
  data?: Record<string, Record<string, number>>;
  pairs?: Array<{ assetA: string; assetB: string; correlation: number }>;
  message?: string;
}

interface DrawdownResponse {
  drawdowns?: Array<{
    start: string; end: string; maxDrawdown: number;
    recovered?: boolean; daysToRecover?: number | null;
  }>;
}

interface AnalyticsSummary {
  var_95?: number; var_99?: number; cvar_95?: number;
  sharpe?: number; sortino?: number; beta?: number;
  volatility?: number; max_drawdown_pct?: number;
}

/* ── Stress scenarios — labeled documented examples, not live data ─────── */
const STRESS_SCENARIOS: StressScenario[] = [
  { name: "Flash Crash", description: "Sudden 5% market drop in minutes", portfolioImpact: -6.2, probability: 0.05, severity: "extreme" },
  { name: "Rate Shock +100bp", description: "Unexpected Fed rate hike", portfolioImpact: -3.8, probability: 0.12, severity: "high" },
  { name: "Liquidity Crunch", description: "Bid-ask spreads widen 5x", portfolioImpact: -2.1, probability: 0.15, severity: "medium" },
  { name: "Crypto Contagion", description: "Major exchange collapse", portfolioImpact: -4.5, probability: 0.08, severity: "high" },
  { name: "Geopolitical Event", description: "Trade war escalation", portfolioImpact: -3.2, probability: 0.18, severity: "medium" },
  { name: "Tech Sector Rotation", description: "Growth→Value rotation", portfolioImpact: -1.9, probability: 0.25, severity: "low" },
  { name: "Black Swan", description: "Unprecedented 3σ+ event", portfolioImpact: -15.4, probability: 0.01, severity: "extreme" },
  { name: "Correlation Spike", description: "All assets correlate to 1.0", portfolioImpact: -7.8, probability: 0.04, severity: "extreme" },
];

const SEVERITY_COLORS: Record<string, string> = {
  low: "#9cff93", medium: "#fbbf24", high: "#ff7162", extreme: "#ff3333",
};

/* Multipliers used to rescale a base 1d VaR to longer horizons (sqrt-time
 * rule for Brownian volatility). When the analytics summary returns 0 or
 * unavailable, we just show "—" — no Math.random fakery. */
const HORIZON_VAR_MULT: Record<TimeHorizon, number> = { "1d": 1, "5d": 2.236, "10d": 3.162, "21d": 4.583 };

/* ── Real-data hooks ───────────────────────────────────────────────────── */
function useCorrelationMatrix() {
  return useQuery<CorrelationMatrixResponse>({
    queryKey: ["correlation", "matrix"],
    queryFn: () => apiFetch<CorrelationMatrixResponse>("/correlation/matrix"),
    refetchInterval: 60_000,
  });
}

function useDrawdowns() {
  return useQuery<DrawdownResponse>({
    queryKey: ["correlation", "drawdown"],
    queryFn: () => apiFetch<DrawdownResponse>("/correlation/drawdown"),
    refetchInterval: 60_000,
  });
}

function useRiskSummary() {
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics", "summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/analytics/summary"),
    refetchInterval: 30_000,
  });
}

/* Given the variety of shapes the /api/correlation/matrix endpoint may
 * return, normalize into { assets: string[], matrix: Record<string, Record<string, number>> }. */
function normalizeCorr(resp: CorrelationMatrixResponse | undefined) {
  if (!resp) return null;
  // Shape 1: { assets: ["BTC","ETH",...], matrix: number[][] }
  if (resp.assets && resp.matrix) {
    const out: Record<string, Record<string, number>> = {};
    resp.assets.forEach((a, i) => {
      out[a] = {};
      resp.assets!.forEach((b, j) => { out[a][b] = resp.matrix![i]?.[j] ?? 0; });
    });
    return { assets: resp.assets, matrix: out };
  }
  // Shape 2: { symbols, data: { sym: { sym: corr } } }
  if (resp.symbols && resp.data) {
    return { assets: resp.symbols, matrix: resp.data };
  }
  // Shape 3: { pairs: [{assetA, assetB, correlation}] }
  if (resp.pairs && resp.pairs.length) {
    const set = new Set<string>();
    resp.pairs.forEach((p) => { set.add(p.assetA); set.add(p.assetB); });
    const assets = Array.from(set);
    const out: Record<string, Record<string, number>> = {};
    assets.forEach((a) => { out[a] = {}; assets.forEach((b) => { out[a][b] = a === b ? 1 : 0; }); });
    resp.pairs.forEach((p) => {
      out[p.assetA][p.assetB] = p.correlation;
      out[p.assetB][p.assetA] = p.correlation;
    });
    return { assets, matrix: out };
  }
  return null;
}

/* ── Component ──────────────────────────────────────────────────────────────── */
export default function AdvancedRiskPage() {
  const [horizon, setHorizon] = useState<TimeHorizon>("1d");
  const corrQ = useCorrelationMatrix();
  const ddQ = useDrawdowns();
  const sumQ = useRiskSummary();

  const corr = useMemo(() => normalizeCorr(corrQ.data), [corrQ.data]);
  const ASSETS = corr?.assets ?? [];

  const baseMetrics: RiskMetrics = useMemo(() => {
    const s = sumQ.data ?? {};
    return {
      var95: Number(s.var_95 ?? 0),
      var99: Number(s.var_99 ?? 0),
      cvar95: Number(s.cvar_95 ?? 0),
      sharpe: Number(s.sharpe ?? 0),
      sortino: Number(s.sortino ?? 0),
      maxDrawdown: Number(s.max_drawdown_pct ?? 0),
      beta: Number(s.beta ?? 0),
      volatility: Number(s.volatility ?? 0),
    };
  }, [sumQ.data]);

  const mult = HORIZON_VAR_MULT[horizon];
  const metrics: RiskMetrics = useMemo(() => ({
    ...baseMetrics,
    var95: baseMetrics.var95 * mult,
    var99: baseMetrics.var99 * mult,
    cvar95: baseMetrics.cvar95 * mult,
  }), [baseMetrics, mult]);

  const horizons: TimeHorizon[] = ["1d", "5d", "10d", "21d"];
  const dd = ddQ.data?.drawdowns ?? [];
  const hasMetrics = baseMetrics.var95 !== 0 || baseMetrics.sharpe !== 0;

  function corrColor(v: number): string {
    if (v >= 0.7) return "rgba(156,255,147,0.6)";
    if (v >= 0.3) return "rgba(156,255,147,0.25)";
    if (v >= -0.3) return "rgba(72,72,73,0.3)";
    if (v >= -0.7) return "rgba(255,113,98,0.25)";
    return "rgba(255,113,98,0.6)";
  }

  function fmt(n: number, suffix = ""): string {
    if (!Number.isFinite(n) || n === 0) return "—";
    return `${n.toFixed(2)}${suffix}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-headline tracking-wide" style={{ color: "#ffffff" }}>Advanced Risk Metrics</h1>
          <p className="text-xs mt-1" style={{ color: "#767576" }}>VaR, stress scenarios, correlation heatmap, drawdown analysis (live from /api/analytics + /api/correlation)</p>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(72,72,73,0.2)" }}>
          {horizons.map((h) => (
            <button key={h} onClick={() => setHorizon(h)}
              className="px-3 py-1.5 rounded text-[10px] uppercase tracking-wider font-bold transition-colors"
              style={{
                backgroundColor: horizon === h ? "rgba(156,255,147,0.15)" : "transparent",
                color: horizon === h ? "#9cff93" : "#767576",
                border: horizon === h ? "1px solid rgba(156,255,147,0.3)" : "1px solid transparent",
              }}>
              {h}
            </button>
          ))}
        </div>
      </div>

      {!hasMetrics && !sumQ.isLoading && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}>
          <div className="font-medium mb-1">Risk metrics not yet populated</div>
          <div className="text-xs opacity-80">Run trades through the system or hit POST /api/analytics/recompute to populate VaR / Sharpe / drawdown.</div>
        </div>
      )}

      {/* VaR Cards */}
      <div className="grid grid-cols-4 gap-3">
        {([
          { label: "VaR 95%", value: metrics.var95, suffix: "%", color: "#ff7162" },
          { label: "VaR 99%", value: metrics.var99, suffix: "%", color: "#ff3333" },
          { label: "CVaR 95%", value: metrics.cvar95, suffix: "%", color: "#fbbf24" },
          { label: "Max Drawdown", value: metrics.maxDrawdown, suffix: "%", color: "#ff7162" },
        ] as const).map((card) => (
          <div key={card.label} className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "#767576" }}>{card.label}</div>
            <div className="text-2xl font-mono font-bold" style={{ color: card.color }}>{fmt(card.value, card.suffix)}</div>
          </div>
        ))}
      </div>

      {/* Secondary metrics row */}
      <div className="grid grid-cols-4 gap-3">
        {([
          { label: "Sharpe Ratio", value: metrics.sharpe, color: metrics.sharpe > 2 ? "#9cff93" : "#fbbf24" },
          { label: "Sortino Ratio", value: metrics.sortino, color: metrics.sortino > 2 ? "#9cff93" : "#fbbf24" },
          { label: "Beta", value: metrics.beta, color: metrics.beta < 1 ? "#9cff93" : "#ff7162" },
          { label: "Annualized Vol", value: metrics.volatility, color: metrics.volatility < 20 ? "#67e8f9" : "#fbbf24", suffix: "%" },
        ] as const).map((card) => (
          <div key={card.label} className="rounded-lg p-3" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#767576" }}>{card.label}</div>
            <div className="text-lg font-mono font-bold" style={{ color: card.color }}>
              {fmt(card.value, "suffix" in card ? card.suffix : "")}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Stress Scenarios — documented examples */}
        <div className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold font-headline" style={{ color: "#ffffff" }}>Stress Scenarios</h2>
            <span className="text-[9px] uppercase tracking-wider" style={{ color: "#767576" }}>documented</span>
          </div>
          <div className="space-y-2">
            {STRESS_SCENARIOS.map((s) => (
              <div key={s.name} className="flex items-center gap-3 px-3 py-2 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[s.severity] }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold" style={{ color: "#ffffff" }}>{s.name}</div>
                  <div className="text-[9px] truncate" style={{ color: "#767576" }}>{s.description}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-mono font-bold" style={{ color: SEVERITY_COLORS[s.severity] }}>{s.portfolioImpact.toFixed(1)}%</div>
                  <div className="text-[8px]" style={{ color: "#484849" }}>P={(s.probability * 100).toFixed(0)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Correlation Heatmap */}
        <div className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold font-headline" style={{ color: "#ffffff" }}>Correlation Heatmap</h2>
            <span className="text-[9px]" style={{ color: corrQ.isLoading ? "#fbbf24" : (corr ? "#9cff93" : "#ff7162") }}>
              {corrQ.isLoading ? "loading…" : corr ? "live" : "no data"}
            </span>
          </div>
          {!corr || ASSETS.length === 0 ? (
            <div className="text-center py-12 text-xs" style={{ color: "#767576" }}>
              No correlation data yet — populate /api/correlation/matrix.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: "10px" }}>
                <thead>
                  <tr>
                    <th className="p-1" />
                    {ASSETS.map((a) => (
                      <th key={a} className="p-1 text-center font-mono" style={{ color: "#767576" }}>{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ASSETS.map((row) => (
                    <tr key={row}>
                      <td className="p-1 font-mono text-right pr-2" style={{ color: "#767576" }}>{row}</td>
                      {ASSETS.map((col) => {
                        const v = Number(corr.matrix[row]?.[col] ?? 0);
                        return (
                          <td key={col} className="p-1 text-center font-mono" style={{
                            backgroundColor: corrColor(v),
                            color: Math.abs(v) > 0.5 ? "#ffffff" : "#adaaab",
                            borderRadius: "2px",
                          }}>
                            {v.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Drawdown History */}
      <div className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold font-headline" style={{ color: "#ffffff" }}>Drawdown History</h2>
          <span className="text-[9px]" style={{ color: ddQ.isLoading ? "#fbbf24" : (dd.length > 0 ? "#9cff93" : "#767576") }}>
            {ddQ.isLoading ? "loading…" : dd.length > 0 ? `${dd.length} events` : "no events"}
          </span>
        </div>
        {dd.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: "#767576" }}>
            No drawdown events recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {dd.map((dr, i) => (
              <div key={i} className="flex items-center gap-4 px-3 py-2 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                <div className="text-[10px] font-mono shrink-0" style={{ color: "#767576", width: "180px" }}>
                  {dr.start} → {dr.end}
                </div>
                <div className="flex-1 h-3 rounded overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded" style={{
                    width: `${Math.min(100, Math.abs(dr.maxDrawdown) * 10)}%`,
                    backgroundColor: Math.abs(dr.maxDrawdown) > 5 ? "#ff7162" : "#fbbf24",
                  }} />
                </div>
                <div className="text-[11px] font-mono font-bold shrink-0" style={{ color: "#ff7162", width: "60px", textAlign: "right" }}>
                  {dr.maxDrawdown.toFixed(1)}%
                </div>
                <div className="text-[10px] shrink-0" style={{ color: dr.recovered ? "#9cff93" : "#fbbf24", width: "100px", textAlign: "right" }}>
                  {dr.recovered ? `Recovered ${dr.daysToRecover ?? "?"}d` : "Open"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
