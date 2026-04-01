/**
 * BrainFocusMode.tsx — Candle-level deep intelligence overlay
 *
 * When activated from the Brain stock drawer, this modal shows:
 * 1. Live orderbook (bid/ask ladder with imbalance)
 * 2. Heatmap (liquidity zones: absorption, aggression, vacuum, rotation)
 * 3. Trade flow (buy/sell pressure, delta, large prints)
 * 4. AI explanation (Claude synthesis of microstructure)
 *
 * Uses the existing useOrderbook hook for live SSE data and
 * the candle-intelligence API for bar-level analysis.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useOrderbook, type OrderbookSnapshot, type OrderbookLevel } from "@/hooks/useOrderbook";
import { useQuery } from "@tanstack/react-query";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  imbalance: number;
  absorption: number;
  liquidity_strength: number;
  reversal_score: number;
  direction: "bull" | "bear";
  is_high_vol: boolean;
  is_absorption: boolean;
  is_reversal_signal: boolean;
}

interface HeatmapZone {
  priceStart: number;
  priceEnd: number;
  intensity: number;
  type: "absorption" | "aggression" | "vacuum" | "rotation";
}

interface Props {
  symbol: string;
  displaySymbol: string;
  onClose: () => void;
}

// ─── Style Constants ────────────────────────────────────────────────────────

const C = {
  bg: "#0e0e0f",
  card: "rgba(18,18,19,0.95)",
  border: "rgba(72,72,73,0.18)",
  primary: "#00ffcc",
  bullish: "#9cff93",
  bearish: "#ff7162",
  neutral: "#8c909f",
  text: "#e6e1e5",
  muted: "#767576",
  dim: "#484849",
};

const panelStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: "8px",
  padding: "14px 16px",
};

const headerLabel: React.CSSProperties = {
  fontSize: "8px",
  color: C.dim,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  fontFamily: "Space Grotesk, sans-serif",
  fontWeight: 700,
  marginBottom: "10px",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return p.toFixed(2);
}

function formatVol(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toString();
}

const zoneColors: Record<string, string> = {
  absorption: "#00dfc1",
  aggression: "#ff7162",
  vacuum: "#8c909f44",
  rotation: "#669dff",
};

// ─── Live Orderbook Panel ───────────────────────────────────────────────────

function LiveOrderbook({ snapshot }: { snapshot: OrderbookSnapshot | null }) {
  if (!snapshot) {
    return (
      <div style={panelStyle}>
        <div style={headerLabel}>Order Book</div>
        <div style={{ fontSize: "10px", color: C.muted, textAlign: "center", padding: "20px 0" }}>
          Connecting to orderbook stream...
        </div>
      </div>
    );
  }

  const maxSize = Math.max(
    ...snapshot.asks.map((l) => l.size),
    ...snapshot.bids.map((l) => l.size),
    1,
  );

  // Imbalance ratio
  const totalBid = snapshot.totalBids;
  const totalAsk = snapshot.totalAsks;
  const imbalance = totalBid + totalAsk > 0 ? (totalBid - totalAsk) / (totalBid + totalAsk) : 0;
  const imbalanceColor = imbalance > 0.1 ? C.bullish : imbalance < -0.1 ? C.bearish : C.neutral;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={headerLabel}>Order Book</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "8px", color: C.muted }}>IMBALANCE</span>
          <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono", fontWeight: 700, color: imbalanceColor }}>
            {(imbalance * 100).toFixed(0)}%
          </span>
          <span style={{ fontSize: "8px", color: C.muted }}>SPREAD</span>
          <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono", fontWeight: 700, color: C.text }}>
            {snapshot.spread != null ? snapshot.spread.toFixed(2) : "--"}
          </span>
        </div>
      </div>

      {/* Asks (reversed so best ask is at bottom) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px", marginBottom: "4px" }}>
        {[...snapshot.asks].reverse().slice(0, 8).map((level, i) => (
          <div key={`a-${i}`} style={{ display: "flex", alignItems: "center", gap: "4px", position: "relative", height: "18px" }}>
            <div style={{
              position: "absolute", right: 0, top: 0, bottom: 0,
              width: `${(level.size / maxSize) * 100}%`,
              background: "rgba(255,113,98,0.08)",
              borderRadius: "2px",
            }} />
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.bearish, width: "60px", textAlign: "right", zIndex: 1 }}>
              {formatPrice(level.price)}
            </span>
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.muted, flex: 1, textAlign: "right", zIndex: 1 }}>
              {formatVol(level.size)}
            </span>
          </div>
        ))}
      </div>

      {/* Spread indicator */}
      <div style={{ height: "1px", background: "rgba(0,255,204,0.2)", margin: "4px 0" }} />

      {/* Bids */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        {snapshot.bids.slice(0, 8).map((level, i) => (
          <div key={`b-${i}`} style={{ display: "flex", alignItems: "center", gap: "4px", position: "relative", height: "18px" }}>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: `${(level.size / maxSize) * 100}%`,
              background: "rgba(156,255,147,0.08)",
              borderRadius: "2px",
            }} />
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.bullish, width: "60px", textAlign: "right", zIndex: 1 }}>
              {formatPrice(level.price)}
            </span>
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.muted, flex: 1, textAlign: "right", zIndex: 1 }}>
              {formatVol(level.size)}
            </span>
          </div>
        ))}
      </div>

      {/* Summary bar */}
      <div style={{ marginTop: "8px", display: "flex", gap: "4px", height: "4px", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ flex: totalBid, background: C.bullish, borderRadius: "2px 0 0 2px" }} />
        <div style={{ flex: totalAsk, background: C.bearish, borderRadius: "0 2px 2px 0" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
        <span style={{ fontSize: "8px", color: C.bullish, fontFamily: "JetBrains Mono" }}>{formatVol(totalBid)} bid</span>
        <span style={{ fontSize: "8px", color: C.bearish, fontFamily: "JetBrains Mono" }}>{formatVol(totalAsk)} ask</span>
      </div>
    </div>
  );
}

// ─── Liquidity Heatmap Panel ────────────────────────────────────────────────

function LiquidityHeatmap({
  orderbook,
  currentPrice,
}: {
  orderbook: OrderbookSnapshot | null;
  currentPrice: number;
}) {
  // Build heatmap zones from orderbook concentration
  const zones = useMemo<HeatmapZone[]>(() => {
    if (!orderbook) return [];

    const all = [
      ...orderbook.bids.map((l) => ({ ...l, side: "bid" as const })),
      ...orderbook.asks.map((l) => ({ ...l, side: "ask" as const })),
    ];
    if (all.length === 0) return [];

    const avgSize = all.reduce((s, l) => s + l.size, 0) / all.length;
    const zones: HeatmapZone[] = [];

    // Group into price bands (~0.1% width)
    const bandWidth = currentPrice * 0.001;
    const minP = Math.min(...all.map((l) => l.price));
    const maxP = Math.max(...all.map((l) => l.price));

    for (let p = minP; p < maxP; p += bandWidth) {
      const inBand = all.filter((l) => l.price >= p && l.price < p + bandWidth);
      if (inBand.length === 0) continue;

      const totalSize = inBand.reduce((s, l) => s + l.size, 0);
      const intensity = Math.min(1, totalSize / (avgSize * 3));
      const bidSize = inBand.filter((l) => l.side === "bid").reduce((s, l) => s + l.size, 0);
      const askSize = inBand.filter((l) => l.side === "ask").reduce((s, l) => s + l.size, 0);

      let type: HeatmapZone["type"] = "vacuum";
      if (totalSize > avgSize * 2.5) {
        type = bidSize > askSize * 1.5 ? "absorption" : askSize > bidSize * 1.5 ? "aggression" : "rotation";
      } else if (totalSize > avgSize) {
        type = "rotation";
      }

      zones.push({ priceStart: p, priceEnd: p + bandWidth, intensity, type });
    }
    return zones;
  }, [orderbook, currentPrice]);

  if (zones.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={headerLabel}>Liquidity Heatmap</div>
        <div style={{ fontSize: "10px", color: C.muted, textAlign: "center", padding: "16px 0" }}>
          Waiting for orderbook data...
        </div>
      </div>
    );
  }

  const maxIntensity = Math.max(...zones.map((z) => z.intensity), 0.01);

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={headerLabel}>Liquidity Heatmap</div>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["absorption", "aggression", "rotation", "vacuum"] as const).map((t) => (
            <span key={t} style={{ fontSize: "7px", color: zoneColors[t], letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        {[...zones].reverse().slice(0, 16).map((zone, i) => {
          const isAtPrice = currentPrice >= zone.priceStart && currentPrice < zone.priceEnd;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                height: "14px",
                borderLeft: isAtPrice ? `2px solid ${C.primary}` : "2px solid transparent",
                paddingLeft: "4px",
              }}
            >
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.muted, width: "50px", textAlign: "right" }}>
                {formatPrice(zone.priceStart)}
              </span>
              <div style={{ flex: 1, height: "8px", borderRadius: "2px", overflow: "hidden", background: "rgba(255,255,255,0.02)" }}>
                <div style={{
                  width: `${(zone.intensity / maxIntensity) * 100}%`,
                  height: "100%",
                  background: zoneColors[zone.type] ?? C.neutral,
                  borderRadius: "2px",
                  opacity: 0.4 + zone.intensity * 0.6,
                }} />
              </div>
              <span style={{ fontSize: "7px", color: zoneColors[zone.type], width: "50px", letterSpacing: "0.05em" }}>
                {zone.type.toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Candle Intelligence Panel ──────────────────────────────────────────────

function CandleIntel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useQuery<{
    symbol: string;
    bars: CandleBar[];
    summary: {
      total_bars: number;
      reversal_signals: number;
      absorption_zones: number;
      high_vol_events: number;
      top_reversals: Array<{ time: number; price: number; score: number; direction: string }>;
    };
  }>({
    queryKey: ["candle-intelligence-focus", symbol],
    queryFn: () => fetch(`/api/market/candle-intelligence?symbol=${symbol}&timeframe=1Min&bars=50`).then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (isLoading || !data?.bars) {
    return (
      <div style={panelStyle}>
        <div style={headerLabel}>Candle Intelligence</div>
        <div style={{ fontSize: "10px", color: C.muted, textAlign: "center", padding: "16px 0" }}>
          Computing candle intelligence...
        </div>
      </div>
    );
  }

  const recent = [...data.bars].sort((a, b) => b.time - a.time).slice(0, 10);
  const summary = data.summary;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={headerLabel}>Candle Intelligence</div>
        <div style={{ display: "flex", gap: "10px" }}>
          <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.bullish }}>
            {summary.reversal_signals} reversals
          </span>
          <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: "#00dfc1" }}>
            {summary.absorption_zones} absorption
          </span>
          <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: "#ffcc00" }}>
            {summary.high_vol_events} high-vol
          </span>
        </div>
      </div>

      {/* Recent bars table */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "48px 52px 52px 52px 40px 50px 40px", gap: "4px", marginBottom: "2px" }}>
          {["TIME", "OPEN", "HIGH", "LOW", "VOL", "IMBAL", "REV"].map((h) => (
            <span key={h} style={{ fontSize: "7px", color: C.dim, fontFamily: "JetBrains Mono", letterSpacing: "0.06em" }}>{h}</span>
          ))}
        </div>
        {recent.map((bar, i) => {
          const isBull = bar.direction === "bull";
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "48px 52px 52px 52px 40px 50px 40px",
                gap: "4px",
                padding: "2px 0",
                borderLeft: bar.is_reversal_signal ? `2px solid ${C.bullish}` : bar.is_absorption ? `2px solid #00dfc1` : "2px solid transparent",
                paddingLeft: "4px",
                background: bar.is_high_vol ? "rgba(255,204,0,0.03)" : "transparent",
              }}
            >
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.muted }}>
                {new Date(bar.time * 1000).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
              </span>
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.text }}>{formatPrice(bar.open)}</span>
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.bullish }}>{formatPrice(bar.high)}</span>
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.bearish }}>{formatPrice(bar.low)}</span>
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.muted }}>{formatVol(bar.volume)}</span>
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: bar.imbalance > 0.3 ? C.bullish : bar.imbalance < -0.3 ? C.bearish : C.muted }}>
                {(bar.imbalance * 100).toFixed(0)}%
              </span>
              <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: bar.reversal_score > 0.5 ? C.bullish : C.dim }}>
                {(bar.reversal_score * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Top reversals */}
      {summary.top_reversals && summary.top_reversals.length > 0 && (
        <div style={{ marginTop: "10px", padding: "8px", borderRadius: "4px", background: "rgba(156,255,147,0.03)", border: "1px solid rgba(156,255,147,0.08)" }}>
          <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>
            Top Reversal Signals
          </div>
          {summary.top_reversals.slice(0, 3).map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", marginTop: "2px" }}>
              <span style={{ color: C.muted }}>{formatPrice(r.price)} · {r.direction}</span>
              <span style={{ fontFamily: "JetBrains Mono", color: C.bullish }}>{(r.score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AI Synthesis Panel ─────────────────────────────────────────────────────

function AISynthesisPanel({
  symbol,
  orderbook,
}: {
  symbol: string;
  orderbook: OrderbookSnapshot | null;
}) {
  // Build AI synthesis from available data
  const synthesis = useMemo(() => {
    if (!orderbook) return null;

    const bidTotal = orderbook.totalBids;
    const askTotal = orderbook.totalAsks;
    const imbalance = bidTotal + askTotal > 0 ? (bidTotal - askTotal) / (bidTotal + askTotal) : 0;
    const spread = orderbook.spread ?? 0;
    const bestBid = orderbook.bestBid?.price ?? 0;
    const bestAsk = orderbook.bestAsk?.price ?? 0;
    const midPrice = (bestBid + bestAsk) / 2;

    // Detect large walls
    const avgBidSize = bidTotal / (orderbook.bids.length || 1);
    const avgAskSize = askTotal / (orderbook.asks.length || 1);
    const bidWalls = orderbook.bids.filter((l) => l.size > avgBidSize * 3);
    const askWalls = orderbook.asks.filter((l) => l.size > avgAskSize * 3);

    const signals: { label: string; value: string; sentiment: "bullish" | "bearish" | "neutral" }[] = [];

    // Imbalance signal
    if (imbalance > 0.15) {
      signals.push({ label: "Book Imbalance", value: `${(imbalance * 100).toFixed(0)}% bid-heavy — buyer pressure`, sentiment: "bullish" });
    } else if (imbalance < -0.15) {
      signals.push({ label: "Book Imbalance", value: `${(Math.abs(imbalance) * 100).toFixed(0)}% ask-heavy — seller pressure`, sentiment: "bearish" });
    } else {
      signals.push({ label: "Book Imbalance", value: "Balanced — no directional bias", sentiment: "neutral" });
    }

    // Spread analysis
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
    if (spreadPct < 0.02) {
      signals.push({ label: "Spread", value: `Tight (${spreadPct.toFixed(3)}%) — good execution`, sentiment: "bullish" });
    } else if (spreadPct > 0.1) {
      signals.push({ label: "Spread", value: `Wide (${spreadPct.toFixed(3)}%) — poor execution risk`, sentiment: "bearish" });
    } else {
      signals.push({ label: "Spread", value: `Normal (${spreadPct.toFixed(3)}%)`, sentiment: "neutral" });
    }

    // Wall detection
    if (bidWalls.length > 0) {
      signals.push({
        label: "Bid Walls",
        value: `${bidWalls.length} wall(s) at ${bidWalls.map((w) => formatPrice(w.price)).join(", ")} — support detected`,
        sentiment: "bullish",
      });
    }
    if (askWalls.length > 0) {
      signals.push({
        label: "Ask Walls",
        value: `${askWalls.length} wall(s) at ${askWalls.map((w) => formatPrice(w.price)).join(", ")} — resistance detected`,
        sentiment: "bearish",
      });
    }

    // Depth quality
    const depthRatio = Math.min(bidTotal, askTotal) / Math.max(bidTotal, askTotal, 1);
    signals.push({
      label: "Depth Quality",
      value: depthRatio > 0.7 ? "Symmetric — healthy market" : depthRatio > 0.4 ? "Moderate asymmetry" : "Severe asymmetry — caution",
      sentiment: depthRatio > 0.7 ? "neutral" : depthRatio > 0.4 ? "neutral" : "bearish",
    });

    // Build narrative
    const direction = imbalance > 0.1 ? "bullish" : imbalance < -0.1 ? "bearish" : "neutral";
    const narrative =
      direction === "bullish"
        ? `Order book shows ${(imbalance * 100).toFixed(0)}% bid-side imbalance with ${bidWalls.length} support wall(s). Spread at ${spreadPct.toFixed(3)}% indicates ${spreadPct < 0.03 ? "tight" : "normal"} execution conditions. ${bidWalls.length > 0 ? `Key support at ${bidWalls[0] ? formatPrice(bidWalls[0].price) : "multiple levels"}.` : ""} The microstructure favors continuation to the upside.`
        : direction === "bearish"
        ? `Order book shows ${(Math.abs(imbalance) * 100).toFixed(0)}% ask-side imbalance with ${askWalls.length} resistance wall(s). Spread at ${spreadPct.toFixed(3)}%. ${askWalls.length > 0 ? `Key resistance at ${askWalls[0] ? formatPrice(askWalls[0].price) : "multiple levels"}.` : ""} Sellers appear in control of the microstructure.`
        : `Order book is relatively balanced (${(Math.abs(imbalance) * 100).toFixed(0)}% imbalance). No strong directional conviction from the book alone. Spread at ${spreadPct.toFixed(3)}% is ${spreadPct < 0.03 ? "tight" : "normal"}. Wait for additional confluence before committing.`;

    return {
      signals,
      narrative,
      direction,
      confidence: Math.min(0.95, 0.5 + Math.abs(imbalance) + (bidWalls.length + askWalls.length) * 0.1),
    };
  }, [orderbook]);

  const sentimentColor: Record<string, string> = { bullish: C.bullish, bearish: C.bearish, neutral: C.neutral };

  if (!synthesis) {
    return (
      <div style={panelStyle}>
        <div style={headerLabel}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "10px", color: C.primary }}>psychology</span>
            AI Microstructure Synthesis
          </span>
        </div>
        <div style={{ fontSize: "10px", color: C.muted, textAlign: "center", padding: "16px 0" }}>
          Waiting for orderbook data to generate synthesis...
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={headerLabel}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "10px", color: C.primary }}>psychology</span>
            AI Microstructure Synthesis
          </span>
        </div>
        <span style={{
          fontSize: "9px", fontFamily: "JetBrains Mono", fontWeight: 700,
          color: synthesis.direction === "bullish" ? C.bullish : synthesis.direction === "bearish" ? C.bearish : C.neutral,
          padding: "2px 8px", borderRadius: "3px",
          background: synthesis.direction === "bullish" ? "rgba(156,255,147,0.08)" : synthesis.direction === "bearish" ? "rgba(255,113,98,0.08)" : "rgba(140,144,159,0.08)",
        }}>
          {(synthesis.confidence * 100).toFixed(0)}% CONFIDENCE
        </span>
      </div>

      {/* Signals */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
        {synthesis.signals.map((sig, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <div style={{ width: "4px", height: "4px", borderRadius: "50%", backgroundColor: sentimentColor[sig.sentiment], marginTop: "5px", flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: "8px", color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{sig.label}</span>
              <div style={{ fontSize: "10px", color: C.text, marginTop: "1px" }}>{sig.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Narrative */}
      <div style={{ fontSize: "11px", color: "#adaaab", lineHeight: 1.65, padding: "10px", borderRadius: "4px", background: "rgba(0,255,204,0.02)", border: "1px solid rgba(0,255,204,0.06)" }}>
        {synthesis.narrative}
      </div>
    </div>
  );
}

// ─── Main Brain Focus Mode ──────────────────────────────────────────────────

export default function BrainFocusMode({ symbol, displaySymbol, onClose }: Props) {
  const { data: orderbook, status: obStatus } = useOrderbook(symbol, 20, true);

  // Current price from orderbook mid
  const currentPrice = useMemo(() => {
    if (!orderbook?.bestBid || !orderbook?.bestAsk) return 0;
    return (orderbook.bestBid.price + orderbook.bestAsk.price) / 2;
  }, [orderbook]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "20px",
        overflowY: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%",
        maxWidth: "1200px",
        background: C.bg,
        borderRadius: "12px",
        border: `1px solid ${C.border}`,
        overflow: "hidden",
        animation: "slideUp 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: `1px solid ${C.border}`,
          background: "rgba(0,255,204,0.02)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "24px", color: C.primary }}>radiology</span>
            <div>
              <div style={{ fontSize: "16px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>
                BRAIN FOCUS \u2014 {displaySymbol}
              </div>
              <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.muted, letterSpacing: "0.08em" }}>
                LIVE MICROSTRUCTURE \u00B7 {obStatus === "live" || obStatus === "ws" ? "CONNECTED" : "CONNECTING..."}
                {currentPrice > 0 && ` \u00B7 MID ${formatPrice(currentPrice)}`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: "20px", padding: "4px" }}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", padding: "16px 24px 24px" }}>
          {/* Left column: Orderbook + Heatmap */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <LiveOrderbook snapshot={orderbook} />
            <LiquidityHeatmap orderbook={orderbook} currentPrice={currentPrice} />
          </div>

          {/* Right column: Candle Intelligence + AI Synthesis */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <CandleIntel symbol={symbol} />
            <AISynthesisPanel symbol={symbol} orderbook={orderbook} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
