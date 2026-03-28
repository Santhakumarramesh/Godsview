/**
 * VolumeProfilePanel.tsx
 *
 * Real market profile / volume profile visualization.
 * Shows where volume has been traded across price levels in the session.
 *
 * Key concepts:
 *  POC  — Point of Control: price with highest volume (magnet / key S/R)
 *  VAH  — Value Area High: upper boundary of 70% volume area
 *  VAL  — Value Area Low: lower boundary of 70% volume area
 *  HVN  — High Volume Node: cluster (above 1.5× average) — support / resistance
 *  LVN  — Low Volume Node: gap (below 0.5× average) — fast-move area
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const BASE = "/api";
const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

interface VPLevel {
  price:    number;
  volume:   number;
  pct:      number;   // % of max volume (0-100)
  type:     "poc" | "vah" | "val" | "hvn" | "lvn" | "normal";
}

interface VPData {
  symbol:       string;
  timeframe:    string;
  levels:       VPLevel[];
  poc:          { price: number; volume: number };
  vah:          number;
  val:          number;
  total_volume: number;
  bars:         number;
  current_price?: number;
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

interface Props {
  symbol?:    string;
  timeframe?: string;
  bars?:      number;
  height?:    number;
}

export default function VolumeProfilePanel({ symbol = "BTCUSD", timeframe = "1Min", bars = 200, height = 360 }: Props) {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<VPData>({
    queryKey: ["volume-profile", symbol, timeframe, bars],
    queryFn: () => fetch(`${BASE}/market/volume-profile?symbol=${symbol}&timeframe=${timeframe}&bars=${bars}`).then((r) => r.json()),
    refetchInterval: 30_000,   // refresh every 30s — data doesn't change rapidly
    staleTime: 25_000,
  });

  if (isLoading) {
    return (
      <div className="rounded p-8 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, height }}>
        <span className="w-2 h-2 rounded-full animate-pulse inline-block mb-3" style={{ backgroundColor: C.secondary }} />
        <p style={{ fontSize: "10px", color: C.muted, fontFamily: "Space Grotesk" }}>Computing volume profile…</p>
      </div>
    );
  }
  if (error || !data || (data as any).error) {
    return (
      <div className="rounded p-6 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <span style={{ fontSize: "10px", color: C.tertiary, fontFamily: "Space Grotesk" }}>
          {(data as any)?.error ?? "Failed to load volume profile"}
        </span>
      </div>
    );
  }

  const levels = data.levels ?? [];
  const maxVol = levels.reduce((m, l) => Math.max(m, l.volume), 1);
  const avgVol = data.total_volume / (levels.length || 1);
  const currentPrice = data.current_price;

  // Find the level closest to current price
  const closestIdx = currentPrice
    ? levels.reduce((best, l, i) => Math.abs(l.price - currentPrice) < Math.abs(levels[best].price - currentPrice) ? i : best, 0)
    : -1;

  return (
    <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#f97316" }}>area_chart</span>
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Volume Profile · {data.bars} bars · {timeframe}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk" }}>
              {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <span style={{ fontSize: "8px", color: C.muted, fontFamily: "Space Grotesk" }}>
            Vol {(data.total_volume / 1000).toFixed(1)}K
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* ── Price level histogram ─────────────────────────────────── */}
          <div className="md:col-span-3" style={{ height: `${height}px`, overflowY: "auto", overflowX: "hidden" }}>
            <div className="space-y-px">
              {levels.map((level, idx) => {
                const barPct = (level.volume / maxVol) * 100;
                const isPOC  = level.type === "poc";
                const isVAH  = Math.abs(level.price - data.vah) < 1;
                const isVAL  = Math.abs(level.price - data.val) < 1;
                const isHVN  = level.type === "hvn";
                const isLVN  = level.type === "lvn";
                const isCurrent = idx === closestIdx;

                const barColor = isPOC
                  ? "#f97316"
                  : isVAH || isVAL
                  ? C.secondary
                  : isHVN
                  ? "rgba(156,255,147,0.55)"
                  : isLVN
                  ? "rgba(255,113,98,0.25)"
                  : "rgba(102,157,255,0.3)";

                return (
                  <div
                    key={level.price}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      height: "14px",
                      position: "relative",
                      backgroundColor: isCurrent ? "rgba(255,255,255,0.04)" : "transparent",
                      borderLeft: isCurrent ? `2px solid rgba(255,255,255,0.4)` : "2px solid transparent",
                    }}
                  >
                    {/* Price label */}
                    <span style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: "8px",
                      color: isPOC ? "#f97316" : isCurrent ? "#fff" : C.outline,
                      minWidth: "70px",
                      textAlign: "right",
                      fontWeight: isPOC || isCurrent ? 700 : 400,
                    }}>
                      {level.price > 100 ? level.price.toFixed(1) : level.price.toFixed(4)}
                    </span>

                    {/* Volume bar */}
                    <div style={{ flex: 1, height: "8px", position: "relative" }}>
                      <div style={{
                        width: `${Math.max(barPct, 0.5)}%`,
                        height: "100%",
                        backgroundColor: barColor,
                        borderRadius: "1px",
                        boxShadow: isPOC ? `0 0 6px #f97316` : "none",
                        transition: "width 0.3s",
                      }} />
                    </div>

                    {/* Markers */}
                    {isPOC && <span style={{ fontSize: "6px", color: "#f97316", fontFamily: "Space Grotesk", fontWeight: 700, minWidth: "28px" }}>POC</span>}
                    {isVAH && !isPOC && <span style={{ fontSize: "6px", color: C.secondary, fontFamily: "Space Grotesk", fontWeight: 700, minWidth: "28px" }}>VAH</span>}
                    {isVAL && !isPOC && <span style={{ fontSize: "6px", color: C.secondary, fontFamily: "Space Grotesk", fontWeight: 700, minWidth: "28px" }}>VAL</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Key level stats ──────────────────────────────────────── */}
          <div className="flex flex-col gap-2 justify-start">
            {[
              { label: "POC Price", value: data.poc?.price > 100 ? `$${data.poc.price.toFixed(1)}` : `$${data.poc?.price?.toFixed(4)}`, color: "#f97316", icon: "grade" },
              { label: "Value Area H", value: data.vah > 100 ? `$${data.vah.toFixed(1)}` : `$${data.vah?.toFixed(4)}`, color: C.secondary, icon: "arrow_upward" },
              { label: "Value Area L", value: data.val > 100 ? `$${data.val.toFixed(1)}` : `$${data.val?.toFixed(4)}`, color: C.secondary, icon: "arrow_downward" },
              { label: "VA Range", value: data.vah && data.val ? `$${(data.vah - data.val).toFixed(1)}` : "—", color: C.muted, icon: "height" },
              { label: "Total Volume", value: `${(data.total_volume / 1000).toFixed(1)}K`, color: C.muted, icon: "bar_chart" },
              { label: "Levels", value: `${levels.length}`, color: C.outline, icon: "stacked_line_chart" },
            ].map((stat) => (
              <div key={stat.label} className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <div className="flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined" style={{ fontSize: "11px", color: stat.color }}>{stat.icon}</span>
                  <Label>{stat.label}</Label>
                </div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", fontWeight: 700, color: stat.color }}>
                  {stat.value}
                </div>
              </div>
            ))}

            {/* Legend */}
            <div className="rounded p-2.5 space-y-1.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
              <Label>Legend</Label>
              {[
                { color: "#f97316", label: "POC — highest volume" },
                { color: C.secondary, label: "VAH/VAL — value area" },
                { color: "rgba(156,255,147,0.55)", label: "HVN — support/resistance" },
                { color: "rgba(255,113,98,0.35)", label: "LVN — fast-move zone" },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div style={{ width: "8px", height: "8px", borderRadius: "1px", backgroundColor: l.color, flexShrink: 0 }} />
                  <span style={{ fontSize: "7px", color: C.muted, fontFamily: "Space Grotesk" }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
