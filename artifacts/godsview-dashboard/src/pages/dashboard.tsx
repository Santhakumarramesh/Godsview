import { useGetSystemStatus, useGetPerformance, useGetSignals } from "@workspace/api-client-react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { format } from "date-fns";
import { Link } from "wouter";
import { useEffect, useRef } from "react";

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
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-2 font-headline font-bold text-xl" style={{ color: accent ?? "#ffffff" }}>{value}</div>
      {sub && <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: systemStatus, isLoading: sysLoading, refetch: refetchStatus } = useGetSystemStatus();
  const { data: performance, isLoading: perfLoading, refetch: refetchPerf } = useGetPerformance({ days: 1 });
  const { data: signals, isLoading: sigLoading } = useGetSignals({ limit: 5 });

  // Auto-refresh every 30 seconds
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => { refetchStatus(); refetchPerf(); }, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refetchStatus, refetchPerf]);

  if (sysLoading || perfLoading || sigLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary, boxShadow: `0 0 8px ${C.primary}` }} />
          <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em" }}>LOADING PIPELINE</span>
        </div>
      </div>
    );
  }

  const layers = systemStatus?.layers ?? [];
  const sigs = signals?.signals ?? [];

  // Combined P&L: realized (closed trades in DB) + unrealized (live Alpaca positions)
  const realizedPnl = performance?.total_pnl ?? 0;
  const unrealizedPnl = (systemStatus as Record<string, number> | undefined)?.unrealized_pnl ?? 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const livePositions = (systemStatus as Record<string, number> | undefined)?.live_positions ?? 0;
  const closedTrades = performance?.total_trades ?? 0;

  const pnlSub = (() => {
    const parts = [];
    if (closedTrades > 0) parts.push(`${closedTrades} closed`);
    if (livePositions > 0) parts.push(`${livePositions} open`);
    return parts.length > 0 ? parts.join(" · ") : "No trades yet";
  })();

  const winRate = performance?.win_rate ?? 0;
  const expectancy = performance?.expectancy ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Mission Control
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Pipeline Overview</h1>
        </div>
        <div className="flex items-center gap-3">
          {systemStatus?.news_lockout_active && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold" style={{ backgroundColor: "rgba(255,113,98,0.1)", border: `1px solid rgba(255,113,98,0.3)`, color: C.tertiary }}>
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>warning</span>
              News Lockout
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ backgroundColor: "rgba(156,255,147,0.06)", border: `1px solid rgba(156,255,147,0.15)` }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
            <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.primary, fontWeight: 700, letterSpacing: "0.05em" }}>
              {systemStatus?.active_instrument || "Crypto"} · {systemStatus?.active_session || "Live"}
            </span>
          </div>
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Today's P&L — realized + unrealized */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Today&apos;s P&amp;L</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: totalPnl >= 0 ? C.primary : C.tertiary }}>
            {formatCurrency(totalPnl)}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk" }}>{pnlSub}</span>
            {livePositions > 0 && unrealizedPnl !== 0 && (
              <span className="px-1.5 py-0.5 rounded" style={{ fontSize: "7px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", backgroundColor: "rgba(102,157,255,0.1)", border: "1px solid rgba(102,157,255,0.2)", color: "#669dff" }}>
                {unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(unrealizedPnl)} LIVE
              </span>
            )}
          </div>
        </div>

        {/* Win Rate */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Win Rate (24h)</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: closedTrades === 0 ? C.muted : winRate > 0.6 ? C.primary : C.muted }}>
            {closedTrades === 0 ? "—" : formatPercent(winRate)}
          </div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
            {closedTrades === 0 ? "Close trades to track" : "Target › 60%"}
          </div>
        </div>

        {/* Expectancy */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Expectancy</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: closedTrades === 0 ? C.muted : expectancy > 0 ? C.primary : C.tertiary }}>
            {closedTrades === 0 ? "—" : formatCurrency(expectancy)}
          </div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
            {closedTrades === 0 ? "Per trade average" : "Per trade average"}
          </div>
        </div>

        {/* Signals Today */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Signals Today</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: (systemStatus?.signals_today ?? 0) > 0 ? C.secondary : "#ffffff" }}>
            {systemStatus?.signals_today ?? 0}
          </div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
            {systemStatus?.trades_today || 0} executed · {livePositions} positions live
          </div>
        </div>
      </div>

      {/* 6-Layer Pipeline */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>account_tree</span>
          <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" }}>
            6-Layer Reasoning Engine
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {layers.map((layer, i) => {
            const isActive = layer.status === "active";
            const isWarn = layer.status === "warning";
            const color = isActive ? C.primary : isWarn ? "#fbbf24" : C.tertiary;
            return (
              <div key={layer.name} className="rounded p-3 flex flex-col gap-2" style={{ backgroundColor: C.card, border: `1px solid ${isActive ? "rgba(156,255,147,0.12)" : "rgba(72,72,73,0.25)"}` }}>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em" }}>L{i + 1}</span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: isActive ? `0 0 6px ${color}` : "none" }} />
                </div>
                <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 600, color: "#ffffff", lineHeight: "1.3" }}>{layer.name}</div>
                <div style={{ fontSize: "8px", color: C.muted, lineHeight: "1.4" }} className="line-clamp-2">{layer.message}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Signals */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>sensors</span>
            <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Live Signal Feed
            </span>
          </div>
          <Link href="/signals">
            <span style={{ fontSize: "9px", color: C.secondary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", cursor: "pointer" }}>
              VIEW ALL →
            </span>
          </Link>
        </div>

        <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: `1px solid rgba(72,72,73,0.3)` }}>
                {["Time", "Instrument", "Setup", "Quality", "Entry", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sigs.map((sig) => {
                const q = sig.final_quality;
                const qColor = q > 75 ? C.primary : q > 50 ? "#fbbf24" : C.tertiary;
                return (
                  <tr key={sig.id} className="hover:brightness-105 transition-all" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
                    <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                      {format(new Date(sig.created_at), "HH:mm:ss")}
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "11px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#ffffff" }}>
                      {sig.instrument}
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "10px", color: C.muted }}>
                      {sig.setup_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(72,72,73,0.4)" }}>
                          <div style={{ width: `${q}%`, height: "100%", backgroundColor: qColor, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: qColor }}>{formatNumber(q, 1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>
                      {sig.entry_price ? `$${Number(sig.entry_price).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded" style={{
                        fontSize: "8px",
                        fontFamily: "Space Grotesk",
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        backgroundColor: sig.status === "active" ? "rgba(156,255,147,0.1)" : "rgba(72,72,73,0.2)",
                        color: sig.status === "active" ? C.primary : C.muted,
                        border: `1px solid ${sig.status === "active" ? "rgba(156,255,147,0.2)" : "rgba(72,72,73,0.3)"}`,
                      }}>
                        {sig.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sigs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center" style={{ color: C.outlineVar, fontSize: "11px" }}>
                    No signals recorded yet. Run a live scan to populate the feed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Status */}
      <div className="pt-6 border-t flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
        <div className="flex items-center gap-6">
          <div>
            <MicroLabel>Global Engine Status</MicroLabel>
            <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.primary, marginTop: "2px" }}>
              {systemStatus?.overall?.toUpperCase() ?? "NOMINAL"}
            </div>
          </div>
          <div>
            <MicroLabel>Data Source</MicroLabel>
            <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#ffffff", marginTop: "2px" }}>
              Alpaca Crypto
            </div>
          </div>
        </div>
        <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
          GODSVIEW v0.2.0-BETA
        </div>
      </div>
    </div>
  );
}
