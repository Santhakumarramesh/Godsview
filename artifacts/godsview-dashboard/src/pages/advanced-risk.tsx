import { useState, useMemo, useEffect } from "react";

/* ── Types ──────────────────────────────────────────────────────────────────── */
type TimeHorizon = "1d" | "5d" | "10d" | "21d";
type StressScenario = {
  name: string;
  description: string;
  portfolioImpact: number;
  probability: number;
  severity: "low" | "medium" | "high" | "extreme";
};

type AssetCorrelation = { assetA: string; assetB: string; correlation: number };

type DrawdownPeriod = {
  start: string;
  end: string;
  maxDrawdown: number;
  recovered: boolean;
  daysToRecover: number | null;
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

/* ── Mock Data ──────────────────────────────────────────────────────────────── */
const RISK_BY_HORIZON: Record<TimeHorizon, RiskMetrics> = {
  "1d": { var95: -1.82, var99: -2.94, cvar95: -2.51, sharpe: 2.14, sortino: 3.02, maxDrawdown: -8.4, beta: 0.72, volatility: 14.2 },
  "5d": { var95: -3.91, var99: -5.88, cvar95: -4.95, sharpe: 1.98, sortino: 2.76, maxDrawdown: -8.4, beta: 0.72, volatility: 14.2 },
  "10d": { var95: -5.52, var99: -8.31, cvar95: -6.98, sharpe: 1.98, sortino: 2.76, maxDrawdown: -8.4, beta: 0.72, volatility: 14.2 },
  "21d": { var95: -8.01, var99: -12.05, cvar95: -10.12, sharpe: 1.98, sortino: 2.76, maxDrawdown: -8.4, beta: 0.72, volatility: 14.2 },
};

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

const ASSETS = ["BTC", "ETH", "SPY", "QQQ", "AAPL", "TSLA", "EUR/USD", "GLD"];

function generateCorrelations(): AssetCorrelation[] {
  const corrs: AssetCorrelation[] = [];
  for (let i = 0; i < ASSETS.length; i++) {
    for (let j = i + 1; j < ASSETS.length; j++) {
      const base = (ASSETS[i].includes("BTC") && ASSETS[j].includes("ETH")) ? 0.82 :
        (ASSETS[i].includes("SPY") && ASSETS[j].includes("QQQ")) ? 0.92 :
        (ASSETS[i].includes("GLD")) ? -0.15 + Math.random() * 0.3 :
        -0.3 + Math.random() * 0.9;
      corrs.push({ assetA: ASSETS[i], assetB: ASSETS[j], correlation: Math.round(base * 100) / 100 });
    }
  }
  return corrs;
}

const DRAWDOWNS: DrawdownPeriod[] = [
  { start: "2024-03-12", end: "2024-03-18", maxDrawdown: -8.4, recovered: true, daysToRecover: 12 },
  { start: "2024-05-01", end: "2024-05-04", maxDrawdown: -4.2, recovered: true, daysToRecover: 5 },
  { start: "2024-07-19", end: "2024-07-25", maxDrawdown: -6.1, recovered: true, daysToRecover: 9 },
  { start: "2024-09-15", end: "2024-09-22", maxDrawdown: -3.8, recovered: true, daysToRecover: 4 },
  { start: "2024-11-08", end: "2024-11-15", maxDrawdown: -5.5, recovered: true, daysToRecover: 7 },
  { start: "2025-01-20", end: "2025-01-28", maxDrawdown: -2.9, recovered: true, daysToRecover: 3 },
];

const SEVERITY_COLORS: Record<string, string> = {
  low: "#9cff93", medium: "#fbbf24", high: "#ff7162", extreme: "#ff3333",
};

/* ── Component ──────────────────────────────────────────────────────────────── */
export default function AdvancedRiskPage() {
  const [horizon, setHorizon] = useState<TimeHorizon>("1d");
  const [correlations] = useState(() => generateCorrelations());
  const metrics = RISK_BY_HORIZON[horizon];
  const [liveVar, setLiveVar] = useState(metrics.var95);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveVar((prev) => +(prev + (Math.random() - 0.5) * 0.15).toFixed(2));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const horizons: TimeHorizon[] = ["1d", "5d", "10d", "21d"];

  /* Build correlation matrix for heatmap */
  const corrMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of ASSETS) {
      matrix[a] = {};
      for (const b of ASSETS) {
        if (a === b) { matrix[a][b] = 1; continue; }
        const c = correlations.find((x) => (x.assetA === a && x.assetB === b) || (x.assetA === b && x.assetB === a));
        matrix[a][b] = c?.correlation ?? 0;
      }
    }
    return matrix;
  }, [correlations]);

  function corrColor(v: number): string {
    if (v >= 0.7) return "rgba(156,255,147,0.6)";
    if (v >= 0.3) return "rgba(156,255,147,0.25)";
    if (v >= -0.3) return "rgba(72,72,73,0.3)";
    if (v >= -0.7) return "rgba(255,113,98,0.25)";
    return "rgba(255,113,98,0.6)";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-headline tracking-wide" style={{ color: "#ffffff" }}>Advanced Risk Metrics</h1>
          <p className="text-xs mt-1" style={{ color: "#767576" }}>VaR, stress scenarios, correlation heatmap, drawdown analysis</p>
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

      {/* VaR Cards */}
      <div className="grid grid-cols-4 gap-3">
        {([
          { label: "VaR 95%", value: liveVar, suffix: "%", color: "#ff7162" },
          { label: "VaR 99%", value: metrics.var99, suffix: "%", color: "#ff3333" },
          { label: "CVaR 95%", value: metrics.cvar95, suffix: "%", color: "#fbbf24" },
          { label: "Max Drawdown", value: metrics.maxDrawdown, suffix: "%", color: "#ff7162" },
        ] as const).map((card) => (
          <div key={card.label} className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "#767576" }}>{card.label}</div>
            <div className="text-2xl font-mono font-bold" style={{ color: card.color }}>{card.value.toFixed(2)}{card.suffix}</div>
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
            <div className="text-lg font-mono font-bold" style={{ color: card.color }}>{card.value.toFixed(2)}{"suffix" in card ? card.suffix : ""}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Stress Scenarios */}
        <div className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
          <h2 className="text-sm font-bold font-headline mb-3" style={{ color: "#ffffff" }}>Stress Scenarios</h2>
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
          <h2 className="text-sm font-bold font-headline mb-3" style={{ color: "#ffffff" }}>Correlation Heatmap</h2>
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
                      const v = corrMatrix[row][col];
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
        </div>
      </div>

      {/* Drawdown History */}
      <div className="rounded-lg p-4" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
        <h2 className="text-sm font-bold font-headline mb-3" style={{ color: "#ffffff" }}>Drawdown History</h2>
        <div className="space-y-2">
          {DRAWDOWNS.map((dd, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-2 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
              <div className="text-[10px] font-mono shrink-0" style={{ color: "#767576", width: "160px" }}>
                {dd.start} → {dd.end}
              </div>
              <div className="flex-1 h-3 rounded overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
                <div className="h-full rounded" style={{
                  width: `${Math.abs(dd.maxDrawdown) * 10}%`,
                  backgroundColor: Math.abs(dd.maxDrawdown) > 5 ? "#ff7162" : "#fbbf24",
                }} />
              </div>
              <div className="text-[11px] font-mono font-bold shrink-0" style={{ color: "#ff7162", width: "50px", textAlign: "right" }}>
                {dd.maxDrawdown.toFixed(1)}%
              </div>
              <div className="text-[10px] shrink-0" style={{ color: dd.recovered ? "#9cff93" : "#fbbf24", width: "80px", textAlign: "right" }}>
                {dd.recovered ? `Recovered ${dd.daysToRecover}d` : "Open"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
