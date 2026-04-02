/**
 * CandleIntelligencePanel.tsx
 *
 * Per-candle microstructure intelligence overlay.
 * Shows every bar annotated with:
 *   imbalance        — bull/bear body strength (-1 to +1)
 *   absorption       — wicks absorbing pressure (0=trend, 1=absorbed)
 *   liquidity_strength — relative volume vs session average
 *   reversal_score   — combined probability this candle marks a turn
 *
 * Highlights the top reversal signals, absorption zones, and high-vol events.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const BASE = "/api";
const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

interface CandleBar {
  time: number; open: number; high: number; low: number; close: number; volume: number;
  imbalance: number; absorption: number; liquidity_strength: number; reversal_score: number;
  wick_top: number; wick_bot: number; body_ratio: number; direction: "bull" | "bear";
  is_doji: boolean; is_high_vol: boolean; is_absorption: boolean; is_reversal_signal: boolean;
}

interface IntelData {
  symbol: string; timeframe: string; bars: CandleBar[];
  summary: {
    total_bars: number; avg_volume: number; avg_range: number;
    reversal_signals: number; absorption_zones: number; high_vol_events: number;
    top_reversals: Array<{ time: number; price: number; score: number; direction: string }>;
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ width: "60px", height: "4px", borderRadius: "2px", backgroundColor: "rgba(72,72,73,0.3)", overflow: "hidden" }}>
      <div style={{ width: `${Math.round(value * 100)}%`, height: "100%", backgroundColor: color, transition: "width 0.3s" }} />
    </div>
  );
}

interface Props {
  symbol?:    string;
  timeframe?: string;
  bars?:      number;
}

export default function CandleIntelligencePanel({ symbol = "BTCUSD", timeframe = "5Min", bars = 80 }: Props) {
  const { data, isLoading } = useQuery<IntelData>({
    queryKey: ["candle-intelligence", symbol, timeframe, bars],
    queryFn: () => fetch(`${BASE}/market/candle-intelligence?symbol=${symbol}&timeframe=${timeframe}&bars=${bars}`).then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  // Last 30 bars for display (most recent first)
  const displayBars = useMemo(() => {
    if (!data?.bars) return [];
    return [...data.bars].sort((a, b) => b.time - a.time).slice(0, 30);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="rounded p-6 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <span className="w-2 h-2 rounded-full animate-pulse inline-block mb-2" style={{ backgroundColor: C.primary }} />
        <p style={{ fontSize: "10px", color: C.muted, fontFamily: "Space Grotesk" }}>Computing candle intelligence…</p>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#e879f9" }}>auto_graph</span>
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Candle Intelligence · {data.timeframe} · {s.total_bars} bars
          </span>
        </div>
        <div className="flex gap-2">
          {[
            { label: "Reversals", value: s.reversal_signals, color: "#e879f9" },
            { label: "Absorption", value: s.absorption_zones, color: "#fb923c" },
            { label: "High Vol", value: s.high_vol_events, color: "#fbbf24" },
          ].map((stat) => (
            <span key={stat.label} className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: stat.color, backgroundColor: `${stat.color}10`, border: `1px solid ${stat.color}25` }}>
              {stat.value} {stat.label}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ── Top reversal signals ───────────────────────────────────── */}
        <div>
          <div className="mb-3"><Label>Top Reversal Signals</Label></div>
          <div className="space-y-2">
            {s.top_reversals.map((r, i) => (
              <div key={i} className="rounded p-2.5 flex items-center gap-3" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${r.direction === "bull" ? "rgba(156,255,147,0.15)" : "rgba(255,113,98,0.15)"}` }}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px", color: r.direction === "bull" ? C.primary : C.tertiary }}>
                  {r.direction === "bull" ? "arrow_upward" : "arrow_downward"}
                </span>
                <div className="flex-1">
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#fff" }}>
                    ${r.price > 100 ? r.price.toFixed(2) : r.price.toFixed(6)}
                  </div>
                  <div style={{ fontSize: "8px", color: C.muted, fontFamily: "Space Grotesk" }}>
                    {new Date(r.time * 1000).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#e879f9", fontWeight: 700 }}>
                  {Math.round(r.score * 100)}%
                </div>
              </div>
            ))}
            {s.top_reversals.length === 0 && (
              <div style={{ fontSize: "10px", color: C.outline, fontFamily: "Space Grotesk", textAlign: "center", padding: "12px" }}>
                No strong reversal signals in this session
              </div>
            )}
          </div>
        </div>

        {/* ── Per-bar intelligence table ─────────────────────────────── */}
        <div className="md:col-span-2">
          <div className="mb-2">
            <div className="grid grid-cols-7 gap-1 pb-1.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.2)` }}>
              {["Time", "Price", "Imbalance", "Absorb", "Liq Str", "Rev Score", "Flags"].map((h) => (
                <span key={h} style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
              ))}
            </div>
          </div>
          <div style={{ maxHeight: "280px", overflowY: "auto" }}>
            {displayBars.map((bar) => {
              const isRev = bar.is_reversal_signal;
              const isAbs = bar.is_absorption;
              const isHV  = bar.is_high_vol;
              const rowBg = isRev ? "rgba(232,121,249,0.04)" : isAbs ? "rgba(251,146,60,0.03)" : "transparent";
              const imbalColor = bar.imbalance > 0.2 ? C.primary : bar.imbalance < -0.2 ? C.tertiary : C.outline;

              return (
                <div
                  key={bar.time}
                  className="grid grid-cols-7 gap-1 py-1 items-center"
                  style={{ backgroundColor: rowBg, borderBottom: "1px solid rgba(72,72,73,0.06)" }}
                >
                  {/* Time */}
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "8px", color: C.outline }}>
                    {new Date(bar.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>

                  {/* Price */}
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "8px", color: bar.direction === "bull" ? C.primary : C.tertiary }}>
                    {bar.close > 100 ? bar.close.toFixed(1) : bar.close.toFixed(5)}
                  </span>

                  {/* Imbalance */}
                  <div className="flex items-center gap-1">
                    <ScoreBar value={Math.abs(bar.imbalance)} color={imbalColor} />
                  </div>

                  {/* Absorption */}
                  <div className="flex items-center gap-1">
                    <ScoreBar value={bar.absorption} color={isAbs ? "#fb923c" : "rgba(102,157,255,0.4)"} />
                  </div>

                  {/* Liquidity Strength */}
                  <div className="flex items-center gap-1">
                    <ScoreBar value={Math.min(bar.liquidity_strength / 3, 1)} color={isHV ? "#fbbf24" : C.secondary} />
                  </div>

                  {/* Reversal Score */}
                  <div className="flex items-center gap-1">
                    <ScoreBar value={bar.reversal_score} color={isRev ? "#e879f9" : C.outline} />
                  </div>

                  {/* Flags */}
                  <div className="flex gap-0.5 flex-wrap">
                    {bar.is_doji && <span style={{ fontSize: "7px", color: "#a78bfa", fontFamily: "Space Grotesk", fontWeight: 700 }}>D</span>}
                    {bar.is_high_vol && <span style={{ fontSize: "7px", color: "#fbbf24", fontFamily: "Space Grotesk", fontWeight: 700 }}>V</span>}
                    {bar.is_absorption && <span style={{ fontSize: "7px", color: "#fb923c", fontFamily: "Space Grotesk", fontWeight: 700 }}>A</span>}
                    {bar.is_reversal_signal && <span style={{ fontSize: "7px", color: "#e879f9", fontFamily: "Space Grotesk", fontWeight: 700 }}>R</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Flag legend */}
          <div className="flex gap-3 mt-2">
            {[
              { flag: "D", color: "#a78bfa", label: "Doji" },
              { flag: "V", color: "#fbbf24", label: "High Vol" },
              { flag: "A", color: "#fb923c", label: "Absorption" },
              { flag: "R", color: "#e879f9", label: "Reversal Signal" },
            ].map((f) => (
              <div key={f.flag} className="flex items-center gap-1">
                <span style={{ fontSize: "7px", color: f.color, fontFamily: "Space Grotesk", fontWeight: 700 }}>{f.flag}</span>
                <span style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk" }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
