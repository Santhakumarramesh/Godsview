import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// ─── Types ───────────────────────────────────────────────────────────────────
interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  timestamp: number;
}

interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
  side: "bid" | "ask";
}

interface TapeEntry {
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: number;
  aggressor: boolean;
}
interface AISynthesis {
  verdict: string;
  confidence: number;
  signals: { label: string; value: string; sentiment: "bullish" | "bearish" | "neutral" }[];
  narrative: string;
  predictionAccuracy: number;
}

interface HeatmapZone {
  priceStart: number;
  priceEnd: number;
  intensity: number;
  type: "absorption" | "aggression" | "vacuum" | "rotation";
}

// ─── Mock Data ───────────────────────────────────────────────────────────────
const CANDLE: CandleData = {
  open: 894.20, high: 896.85, low: 892.10, close: 895.60,
  volume: 2_847_320, delta: 142_800, timestamp: Date.now(),
};

const BOOK_ASKS: OrderBookLevel[] = [
  { price: 896.40, size: 1240, total: 1240, side: "ask" },
  { price: 896.20, size: 890, total: 2130, side: "ask" },
  { price: 896.00, size: 2100, total: 4230, side: "ask" },
  { price: 895.80, size: 560, total: 4790, side: "ask" },
  { price: 895.70, size: 3400, total: 8190, side: "ask" },
  { price: 895.65, size: 780, total: 8970, side: "ask" },
];
const BOOK_BIDS: OrderBookLevel[] = [
  { price: 895.55, size: 920, total: 920, side: "bid" },
  { price: 895.40, size: 1800, total: 2720, side: "bid" },
  { price: 895.20, size: 4200, total: 6920, side: "bid" },
  { price: 895.00, size: 2600, total: 9520, side: "bid" },
  { price: 894.80, size: 1100, total: 10620, side: "bid" },
  { price: 894.60, size: 3800, total: 14420, side: "bid" },
];

function generateTape(): TapeEntry[] {
  const entries: TapeEntry[] = [];
  const basePrice = 895.60;
  for (let i = 0; i < 40; i++) {
    const side = Math.random() > 0.48 ? "buy" : "sell";
    entries.push({
      price: +(basePrice + (Math.random() - 0.5) * 2).toFixed(2),
      size: Math.floor(Math.random() * 500) + 10,
      side,
      timestamp: Date.now() - i * 250,
      aggressor: Math.random() > 0.6,
    });
  }
  return entries;
}

const HEATMAP_ZONES: HeatmapZone[] = [
  { priceStart: 896.40, priceEnd: 896.85, intensity: 0.3, type: "vacuum" },
  { priceStart: 895.80, priceEnd: 896.40, intensity: 0.7, type: "aggression" },
  { priceStart: 895.20, priceEnd: 895.80, intensity: 0.9, type: "absorption" },
  { priceStart: 894.60, priceEnd: 895.20, intensity: 0.5, type: "rotation" },
  { priceStart: 892.10, priceEnd: 894.60, intensity: 0.4, type: "vacuum" },
];
const SYNTHESIS: AISynthesis = {
  verdict: "Bullish Sweep Reclaim",
  confidence: 0.84,
  signals: [
    { label: "Structure", value: "HTF bullish — 3 SK zones supporting", sentiment: "bullish" },
    { label: "Order Flow", value: "Absorption at 894.20 — delta divergence ↑", sentiment: "bullish" },
    { label: "CVD", value: "Cumulative delta rising against price dip", sentiment: "bullish" },
    { label: "Spread", value: "Tightening — institutional accumulation", sentiment: "neutral" },
    { label: "Tape", value: "Large prints on bid side at lows", sentiment: "bullish" },
    { label: "Risk", value: "R:R at 2.4:1 — acceptable for regime", sentiment: "neutral" },
  ],
  narrative: "Strong absorption detected at the 894.20 SK zone with cumulative delta divergence. Price swept the prior session low and immediately reclaimed — classic sweep-reclaim pattern with 81% historical win rate (n=47). Institutional footprint visible on the tape: large bid prints at the lows followed by aggressive buying. The microstructure confirms hidden demand. The ML model assigns 68% probability, but the pattern match and order flow alignment elevate the composite score above the 75% threshold.",
  predictionAccuracy: 76,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sentimentColor = { bullish: "#9cff93", bearish: "#ff7162", neutral: "#8c909f" };
const zoneTypeColor = { absorption: "#00dfc1", aggression: "#ff7162", vacuum: "#8c909f44", rotation: "#669dff" };

function formatPrice(p: number): string { return p.toFixed(2); }
function formatVol(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toString();
}function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function XRayHeader() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="material-symbols-outlined" style={{ color: "#00dfc1", fontSize: 28 }}>radiology</span>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#e6e1e5", margin: 0, letterSpacing: "-0.02em" }}>
            CANDLE X-RAY
          </h1>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
            MICROSTRUCTURE ANALYSIS ENGINE
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#e6e1e5" }}>NVDA</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: "3px 8px", background: "rgba(0,223,193,0.12)", color: "#00dfc1", borderRadius: 3, letterSpacing: "0.06em" }}>
            1M INTERVAL
          </span>
        </div>
        <div style={{ width: 1, height: 32, background: "rgba(72,72,73,0.2)" }} />
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          padding: "4px 12px",
          background: "rgba(156,255,147,0.08)",
          border: "1px solid rgba(156,255,147,0.2)",
          borderRadius: 4, color: "#9cff93", letterSpacing: "0.06em",
        }}>
          {SYNTHESIS.verdict.toUpperCase()}
        </div>
      </div>
    </div>
  );
}
function OHLCVPanel({ candle }: { candle: CandleData }) {
  const isBullish = candle.close >= candle.open;
  const bodyColor = isBullish ? "#9cff93" : "#ff7162";
  const metrics = [
    { label: "OPEN", value: formatPrice(candle.open) },
    { label: "HIGH", value: formatPrice(candle.high), color: "#9cff93" },
    { label: "LOW", value: formatPrice(candle.low), color: "#ff7162" },
    { label: "CLOSE", value: formatPrice(candle.close), color: bodyColor },
    { label: "VOLUME", value: formatVol(candle.volume) },
    { label: "DELTA", value: (candle.delta > 0 ? "+" : "") + formatVol(candle.delta), color: candle.delta > 0 ? "#9cff93" : "#ff7162" },
  ];

  return (
    <div style={{ background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", borderRadius: 6, padding: "16px 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        {metrics.map((m) => (
          <div key={m.label}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 4 }}>
              {m.label}
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700,
              color: m.color || "#e6e1e5",
              fontVariantNumeric: "tabular-nums",
            }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function HeatmapPanel({ zones, candle }: { zones: HeatmapZone[]; candle: CandleData }) {
  const priceRange = candle.high - candle.low;
  const toY = (price: number) => ((candle.high - price) / priceRange) * 100;

  return (
    <div style={{
      background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
      borderRadius: 6, padding: "16px 20px", position: "relative",
      minHeight: 300,
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
        Microstructure Heatmap
      </div>

      <div style={{ position: "relative", height: 260, overflow: "hidden", borderRadius: 4 }}>
        {/* Background gradient */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,113,98,0.05), rgba(0,0,0,0), rgba(156,255,147,0.05))" }} />

        {/* Zones */}
        {zones.map((zone, i) => {
          const top = toY(zone.priceEnd);
          const height = toY(zone.priceStart) - top;
          return (
            <div key={i} style={{
              position: "absolute",
              top: `${top}%`, left: 0, right: 40,
              height: `${height}%`,
              background: zoneTypeColor[zone.type],
              opacity: zone.intensity * 0.3,
              borderRadius: 2,
            }} />
          );
        })}
        {/* Current price line */}
        <div style={{
          position: "absolute",
          top: `${toY(candle.close)}%`, left: 0, right: 0,
          height: 1,
          background: "#e6e1e5",
          opacity: 0.6,
        }}>
          <div style={{
            position: "absolute", right: 0, top: -9,
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: "#e6e1e5", background: "#131314",
            padding: "1px 6px", borderRadius: 2,
          }}>
            {formatPrice(candle.close)}
          </div>
        </div>

        {/* OHLC candle body */}
        {(() => {
          const openY = toY(candle.open);
          const closeY = toY(candle.close);
          const bodyTop = Math.min(openY, closeY);
          const bodyH = Math.abs(openY - closeY);
          const isBull = candle.close >= candle.open;
          return (
            <>
              {/* Wick */}
              <div style={{
                position: "absolute",
                left: "calc(50% - 20px)", width: 1,
                top: `${toY(candle.high)}%`,
                height: `${toY(candle.low) - toY(candle.high)}%`,
                background: isBull ? "#9cff93" : "#ff7162",
                opacity: 0.5,
              }} />
              {/* Body */}
              <div style={{
                position: "absolute",
                left: "calc(50% - 28px)", width: 16,
                top: `${bodyTop}%`, height: `${Math.max(bodyH, 0.5)}%`,
                background: isBull ? "#9cff93" : "#ff7162",
                opacity: 0.7, borderRadius: 1,
              }} />
            </>
          );
        })()}
        {/* Zone labels */}
        {zones.map((zone, i) => {
          const midY = (toY(zone.priceEnd) + toY(zone.priceStart)) / 2;
          return (
            <div key={`label-${i}`} style={{
              position: "absolute",
              top: `${midY}%`, right: 4, transform: "translateY(-50%)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
              color: zoneTypeColor[zone.type], letterSpacing: "0.06em",
              textTransform: "uppercase", opacity: 0.9,
            }}>
              {zone.type}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderBookPanel({ asks, bids }: { asks: OrderBookLevel[]; bids: OrderBookLevel[] }) {
  const maxTotal = Math.max(asks[asks.length - 1]?.total || 0, bids[bids.length - 1]?.total || 0);
  const spread = asks[asks.length - 1] ? (asks[asks.length - 1].price - bids[0].price) : 0;

  return (
    <div style={{ background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", borderRadius: 6, padding: "16px 20px" }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
        Order Book Depth
      </div>

      {/* Asks (reversed to show highest at top) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {[...asks].reverse().map((level, i) => (
          <div key={`ask-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", padding: "3px 0" }}>
            <div style={{
              position: "absolute", right: 0, top: 0, bottom: 0,
              width: `${(level.total / maxTotal) * 100}%`,
              background: "rgba(255,113,98,0.08)",
              borderRadius: 2,
            }} />            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#ff7162", width: 65, textAlign: "right", zIndex: 1, fontVariantNumeric: "tabular-nums" }}>
              {formatPrice(level.price)}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", width: 55, textAlign: "right", zIndex: 1, fontVariantNumeric: "tabular-nums" }}>
              {formatVol(level.size)}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#666", width: 55, textAlign: "right", zIndex: 1, fontVariantNumeric: "tabular-nums" }}>
              {formatVol(level.total)}
            </span>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div style={{
        padding: "8px 0", margin: "6px 0",
        borderTop: "1px solid rgba(72,72,73,0.12)",
        borderBottom: "1px solid rgba(72,72,73,0.12)",
        display: "flex", justifyContent: "center",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#ffd166",
        letterSpacing: "0.06em",
      }}>
        SPREAD {formatPrice(spread)}
      </div>

      {/* Bids */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {bids.map((level, i) => (
          <div key={`bid-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", padding: "3px 0" }}>
            <div style={{
              position: "absolute", right: 0, top: 0, bottom: 0,
              width: `${(level.total / maxTotal) * 100}%`,
              background: "rgba(156,255,147,0.08)",
              borderRadius: 2,
            }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9cff93", width: 65, textAlign: "right", zIndex: 1, fontVariantNumeric: "tabular-nums" }}>
              {formatPrice(level.price)}
            </span>            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", width: 55, textAlign: "right", zIndex: 1, fontVariantNumeric: "tabular-nums" }}>
              {formatVol(level.size)}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#666", width: 55, textAlign: "right", zIndex: 1, fontVariantNumeric: "tabular-nums" }}>
              {formatVol(level.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TapePanel({ entries }: { entries: TapeEntry[] }) {
  return (
    <div style={{
      background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
      borderRadius: 6, padding: "16px 20px", maxHeight: 320, overflow: "hidden",
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
        Live Tape
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, overflow: "hidden" }}>
        {entries.slice(0, 20).map((entry, i) => (
          <div key={i} style={{
            display: "flex", gap: 8, padding: "3px 0",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            opacity: 1 - i * 0.03,
          }}>
            <span style={{ color: "#666", width: 60, fontSize: 10 }}>{formatTime(entry.timestamp)}</span>
            <span style={{
              color: entry.side === "buy" ? "#9cff93" : "#ff7162",
              width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums",
            }}>
              {formatPrice(entry.price)}
            </span>            <span style={{
              color: entry.aggressor ? (entry.side === "buy" ? "#9cff93" : "#ff7162") : "#8c909f",
              width: 45, textAlign: "right",
              fontWeight: entry.aggressor ? 700 : 400,
              fontVariantNumeric: "tabular-nums",
            }}>
              {entry.size}
            </span>
            {entry.aggressor && (
              <span style={{
                fontSize: 9, padding: "1px 5px",
                background: entry.side === "buy" ? "rgba(156,255,147,0.12)" : "rgba(255,113,98,0.12)",
                color: entry.side === "buy" ? "#9cff93" : "#ff7162",
                borderRadius: 2, letterSpacing: "0.04em",
              }}>
                AGG
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SynthesisPanel({ synthesis }: { synthesis: AISynthesis }) {
  return (
    <div style={{
      background: "#1a191b",
      border: "1px solid rgba(72,72,73,0.15)",
      borderLeft: "4px solid #00dfc1",
      borderRadius: 6, padding: "20px 24px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 6, textTransform: "uppercase" }}>
            AI Synthesis
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: "#e6e1e5" }}>
            {synthesis.verdict}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em" }}>CONFIDENCE</div>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700,
            color: synthesis.confidence > 0.8 ? "#9cff93" : synthesis.confidence > 0.6 ? "#ffd166" : "#ff7162",
          }}>
            {(synthesis.confidence * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      {/* Signal breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {synthesis.signals.map((sig) => (
          <div key={sig.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: sentimentColor[sig.sentiment],
            }} />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: "#8c909f", width: 72, textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}>
              {sig.label}
            </span>
            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: sentimentColor[sig.sentiment] }}>
              {sig.value}
            </span>
          </div>
        ))}
      </div>

      {/* Narrative */}
      <div style={{
        fontFamily: "Inter, sans-serif", fontSize: 13, color: "#b4b0b8",
        lineHeight: 1.7, paddingTop: 14,
        borderTop: "1px solid rgba(72,72,73,0.12)",
      }}>
        {synthesis.narrative}
      </div>

      {/* Prediction accuracy */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(72,72,73,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pattern Prediction Accuracy
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
            color: synthesis.predictionAccuracy > 70 ? "#9cff93" : "#ffd166",
          }}>
            {synthesis.predictionAccuracy}%
          </span>
        </div>
        <div style={{ height: 4, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            width: `${synthesis.predictionAccuracy}%`, height: "100%",
            background: `linear-gradient(90deg, #00dfc1, #9cff93)`,
            borderRadius: 2,
          }} />
        </div>
      </div>
    </div>
  );
}
// ─── Main Page ───────────────────────────────────────────────────────────────
export default function CandleXRayPage() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState("5Min");
  const [tape] = useState<TapeEntry[]>(generateTape);
  const [tab, setTab] = useState<"analysis" | "book" | "tape">("analysis");

  // Fetch real candle intelligence
  const { data: xrayData } = useQuery({
    queryKey: ["candle-intelligence", symbol, timeframe],
    queryFn: () => fetch(`/api/market/candle-intelligence?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&bars=1`).then(r => r.ok ? r.json() : null),
    refetchInterval: 30_000,
    retry: 1,
  });

  // Use real last bar if available, else mock
  const latestBar = xrayData?.bars?.[xrayData.bars.length - 1] ?? null;
  const candle: CandleData = latestBar ? {
    open: latestBar.open,
    high: latestBar.high,
    low: latestBar.low,
    close: latestBar.close,
    volume: latestBar.volume,
    delta: latestBar.delta ?? 0,
    timestamp: (latestBar.time ?? 0) * 1000,
  } : CANDLE;

  return (
    <div style={{ minHeight: "100vh", background: "#131314", color: "#e6e1e5" }}>
      <XRayHeader />

      {/* OHLCV Strip */}
      <div style={{ padding: "16px 24px 0" }}>
        <OHLCVPanel candle={candle} />
      </div>

      {/* Tab toggle for mobile-friendly */}
      <div style={{ padding: "16px 24px 0", display: "flex", gap: 4 }}>
        {(["analysis", "book", "tape"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? "rgba(0,223,193,0.10)" : "transparent",
              border: `1px solid ${tab === t ? "rgba(0,223,193,0.3)" : "rgba(72,72,73,0.15)"}`,
              borderRadius: 4,
              padding: "8px 18px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: tab === t ? "#00dfc1" : "#8c909f",
              cursor: "pointer",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === "analysis" ? "Analysis" : t === "book" ? "Order Book" : "Live Tape"}
          </button>
        ))}
      </div>
      <div style={{ padding: 24 }}>
        {tab === "analysis" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <HeatmapPanel zones={HEATMAP_ZONES} candle={CANDLE} />
            <SynthesisPanel synthesis={SYNTHESIS} />
          </div>
        )}

        {tab === "book" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <OrderBookPanel asks={BOOK_ASKS} bids={BOOK_BIDS} />
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Book imbalance stats */}
              <div style={{
                background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
                borderRadius: 6, padding: "16px 20px",
              }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
                  Book Analysis
                </div>
                {[
                  { label: "Bid Total", value: formatVol(BOOK_BIDS.reduce((s, b) => s + b.size, 0)), color: "#9cff93" },
                  { label: "Ask Total", value: formatVol(BOOK_ASKS.reduce((s, a) => s + a.size, 0)), color: "#ff7162" },
                  { label: "Imbalance", value: ((BOOK_BIDS.reduce((s, b) => s + b.size, 0) / (BOOK_BIDS.reduce((s, b) => s + b.size, 0) + BOOK_ASKS.reduce((s, a) => s + a.size, 0))) * 100).toFixed(1) + "%", color: "#669dff" },
                  { label: "Largest Bid", value: formatVol(Math.max(...BOOK_BIDS.map(b => b.size))) + " @ " + formatPrice(BOOK_BIDS.reduce((max, b) => b.size > max.size ? b : max).price), color: "#9cff93" },
                  { label: "Largest Ask", value: formatVol(Math.max(...BOOK_ASKS.map(a => a.size))) + " @ " + formatPrice(BOOK_ASKS.reduce((max, a) => a.size > max.size ? a : max).price), color: "#ff7162" },
                ].map((stat) => (
                  <div key={stat.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(72,72,73,0.08)" }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f" }}>{stat.label}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: stat.color, fontWeight: 600 }}>{stat.value}</span>
                  </div>
                ))}
              </div>
              <SynthesisPanel synthesis={SYNTHESIS} />
            </div>
          </div>
        )}
        {tab === "tape" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <TapePanel entries={tape} />
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Tape statistics */}
              <div style={{
                background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
                borderRadius: 6, padding: "16px 20px",
              }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
                  Tape Statistics
                </div>
                {(() => {
                  const buys = tape.filter(t => t.side === "buy");
                  const sells = tape.filter(t => t.side === "sell");
                  const buyVol = buys.reduce((s, t) => s + t.size, 0);
                  const sellVol = sells.reduce((s, t) => s + t.size, 0);
                  const aggBuys = buys.filter(t => t.aggressor).length;
                  const aggSells = sells.filter(t => t.aggressor).length;
                  return [
                    { label: "Buy Volume", value: formatVol(buyVol), color: "#9cff93" },
                    { label: "Sell Volume", value: formatVol(sellVol), color: "#ff7162" },
                    { label: "Buy/Sell Ratio", value: (buyVol / Math.max(sellVol, 1)).toFixed(2), color: buyVol > sellVol ? "#9cff93" : "#ff7162" },
                    { label: "Aggressive Buys", value: aggBuys.toString(), color: "#9cff93" },
                    { label: "Aggressive Sells", value: aggSells.toString(), color: "#ff7162" },
                    { label: "Total Prints", value: tape.length.toString(), color: "#e6e1e5" },
                  ].map((stat) => (
                    <div key={stat.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(72,72,73,0.08)" }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f" }}>{stat.label}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: stat.color, fontWeight: 600 }}>{stat.value}</span>
                    </div>
                  ));
                })()}
              </div>
              <SynthesisPanel synthesis={SYNTHESIS} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}