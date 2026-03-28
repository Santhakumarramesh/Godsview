/**
 * BookmapPanel.tsx  —  Phase 6
 *
 * Per-candle order book depth visualization.
 * Renders a horizontal bid/ask histogram at each price level,
 * sourced from the live microstructure endpoint (Alpaca L2 book).
 *
 * Layout:
 *   Left  = bid  volume (green bars ←)
 *   Right = ask  volume (red bars →)
 *   Centre = price level axis
 *   Current mid price highlighted
 */

import { useEffect, useState, useRef } from "react";

const BASE = "/api";
const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

interface MicrostructureData {
  mid?: number;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  spreadBps?: number;
  imbalance?: number;
  topBidVolume?: number;
  topAskVolume?: number;
  absorbingBid?: boolean;
  absorbingAsk?: boolean;
  signal?: string;
  bids?: Array<{ price: number; size: number }>;
  asks?: Array<{ price: number; size: number }>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

function fmt(v: number) {
  return v > 1000 ? v.toFixed(2) : v.toFixed(4);
}

interface Props { symbol?: string }

export default function BookmapPanel({ symbol = "BTCUSD" }: Props) {
  const [data, setData] = useState<MicrostructureData | null>(null);
  const [fetchMs, setFetchMs] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = async () => {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/market/microstructure?symbol=${symbol}`);
      if (!r.ok) throw new Error(await r.text());
      const j: MicrostructureData = await r.json();
      setData(j);
      setFetchMs(Date.now() - t0);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    fetch_();
    intervalRef.current = setInterval(fetch_, 4_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [symbol]);

  // Build synthetic price levels if the API doesn't return full book arrays.
  // We use the best bid/ask and spread to synthesise ±10 levels.
  const levels = (() => {
    if (!data) return [];
    const mid = data.mid ?? data.bestBid ?? 0;
    if (!mid) return [];

    // If the backend returns full book arrays, use them.
    if (data.bids && data.asks && data.bids.length > 0) {
      const allPrices = new Set([...data.bids.map((b) => b.price), ...data.asks.map((a) => a.price)]);
      return [...allPrices].sort((a, b) => b - a).map((price) => {
        const bid = data.bids!.find((b) => b.price === price)?.size ?? 0;
        const ask = data.asks!.find((a) => a.price === price)?.size ?? 0;
        return { price, bid, ask };
      });
    }

    // Synthesise levels from top-of-book data + imbalance
    const imbalance = data.imbalance ?? 0; // -1 (full ask) to +1 (full bid)
    const topBid = data.topBidVolume ?? 1;
    const topAsk = data.topAskVolume ?? 1;
    const spread = data.spread ?? 0.5;
    const tick = spread > 0 ? spread / 2 : mid * 0.0001;
    const levels_: Array<{ price: number; bid: number; ask: number }> = [];

    for (let i = 5; i >= 0; i--) {
      const p = data.bestAsk! + i * tick;
      const decay = 1 - i * 0.12;
      levels_.push({ price: p, bid: 0, ask: topAsk * decay * (1 - Math.max(0, imbalance) * 0.5) });
    }
    // mid gap
    levels_.push({ price: mid, bid: 0, ask: 0 });
    for (let i = 0; i < 6; i++) {
      const p = data.bestBid! - i * tick;
      const decay = 1 - i * 0.12;
      levels_.push({ price: p, bid: topBid * decay * (1 + Math.max(0, imbalance) * 0.5), ask: 0 });
    }
    return levels_;
  })();

  const maxVol = levels.reduce((m, l) => Math.max(m, l.bid, l.ask), 1);
  const mid = data?.mid ?? data?.bestBid ?? null;

  const signalColor =
    data?.signal === "strong_bid" ? C.primary :
    data?.signal === "strong_ask" ? C.tertiary :
    data?.signal === "absorption_bid" ? "#a78bfa" :
    data?.signal === "absorption_ask" ? "#fb923c" : C.outline;

  return (
    <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>stacked_bar_chart</span>
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Bookmap · Phase 6 · {symbol}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {fetchMs !== null && (
            <span style={{ fontSize: "8px", color: fetchMs < 200 ? C.primary : "#fbbf24", fontFamily: "Space Grotesk" }}>
              {fetchMs}ms
            </span>
          )}
          {lastUpdate && (
            <span style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk" }}>
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          {data?.signal && (
            <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: signalColor, letterSpacing: "0.08em" }}>
              {data.signal.replace(/_/g, " ").toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {error ? (
        <div className="p-6 text-center">
          <span style={{ fontSize: "10px", color: C.tertiary, fontFamily: "Space Grotesk" }}>{error}</span>
        </div>
      ) : !data ? (
        <div className="p-6 text-center">
          <span style={{ fontSize: "10px", color: C.outline, fontFamily: "Space Grotesk" }}>Loading order book…</span>
        </div>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* ── Bid/Ask histogram ─────────────────────────────────── */}
            <div className="md:col-span-2">
              {/* Column headers */}
              <div className="grid grid-cols-3 mb-2 text-center">
                <Label>Bid Volume</Label>
                <Label>Price</Label>
                <Label>Ask Volume</Label>
              </div>
              <div className="space-y-0.5">
                {levels.map((level, idx) => {
                  const bidPct  = (level.bid  / maxVol) * 100;
                  const askPct  = (level.ask  / maxVol) * 100;
                  const isMid   = mid !== null && Math.abs(level.price - mid) < (data.spread ?? 1) * 0.6;
                  const isBestBid = data.bestBid !== undefined && Math.abs(level.price - data.bestBid) < 0.01;
                  const isBestAsk = data.bestAsk !== undefined && Math.abs(level.price - data.bestAsk) < 0.01;
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-3 items-center"
                      style={{
                        height: "18px",
                        backgroundColor: isMid ? "rgba(255,255,255,0.03)" : "transparent",
                        borderLeft: isMid ? `2px solid rgba(255,255,255,0.15)` : "2px solid transparent",
                      }}
                    >
                      {/* Bid bar — right-aligned */}
                      <div style={{ display: "flex", justifyContent: "flex-end", paddingRight: "2px", height: "12px", alignItems: "center" }}>
                        {level.bid > 0 && (
                          <div style={{
                            width: `${Math.max(bidPct, 2)}%`,
                            maxWidth: "100%",
                            height: "10px",
                            backgroundColor: isBestBid
                              ? C.primary
                              : data.absorbingBid && bidPct > 60 ? "#a78bfa" : "rgba(156,255,147,0.45)",
                            borderRadius: "1px",
                            boxShadow: isBestBid ? `0 0 4px ${C.primary}50` : "none",
                          }} />
                        )}
                      </div>
                      {/* Price label */}
                      <div style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: isMid ? "9px" : "8px",
                        color: isMid ? "#fff" : C.outline,
                        textAlign: "center",
                        fontWeight: isMid ? 700 : 400,
                      }}>
                        {fmt(level.price)}
                      </div>
                      {/* Ask bar — left-aligned */}
                      <div style={{ display: "flex", justifyContent: "flex-start", paddingLeft: "2px", height: "12px", alignItems: "center" }}>
                        {level.ask > 0 && (
                          <div style={{
                            width: `${Math.max(askPct, 2)}%`,
                            maxWidth: "100%",
                            height: "10px",
                            backgroundColor: isBestAsk
                              ? C.tertiary
                              : data.absorbingAsk && askPct > 60 ? "#fb923c" : "rgba(255,113,98,0.45)",
                            borderRadius: "1px",
                            boxShadow: isBestAsk ? `0 0 4px ${C.tertiary}50` : "none",
                          }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Microstructure stats ──────────────────────────────── */}
            <div className="flex flex-col gap-2">
              {[
                { label: "Mid Price",    value: mid ? `$${fmt(mid)}` : "—", color: "#fff" },
                { label: "Best Bid",     value: data.bestBid ? `$${fmt(data.bestBid)}` : "—", color: C.primary },
                { label: "Best Ask",     value: data.bestAsk ? `$${fmt(data.bestAsk)}` : "—", color: C.tertiary },
                { label: "Spread",       value: data.spread ? `$${data.spread.toFixed(4)}` : "—", color: C.muted },
                { label: "Spread bps",   value: data.spreadBps ? `${data.spreadBps.toFixed(1)}bps` : "—", color: data.spreadBps && data.spreadBps < 5 ? C.primary : "#fbbf24" },
                { label: "Imbalance",    value: data.imbalance !== undefined ? `${(data.imbalance * 100).toFixed(0)}%` : "—", color: (data.imbalance ?? 0) > 0.3 ? C.primary : (data.imbalance ?? 0) < -0.3 ? C.tertiary : C.muted },
                { label: "Bid Vol",      value: data.topBidVolume ? data.topBidVolume.toFixed(4) : "—", color: C.primary },
                { label: "Ask Vol",      value: data.topAskVolume ? data.topAskVolume.toFixed(4) : "—", color: C.tertiary },
                { label: "Absorb Bid",   value: data.absorbingBid ? "YES" : "no", color: data.absorbingBid ? "#a78bfa" : C.outline },
                { label: "Absorb Ask",   value: data.absorbingAsk ? "YES" : "no", color: data.absorbingAsk ? "#fb923c" : C.outline },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center justify-between" style={{ borderBottom: `1px solid rgba(72,72,73,0.1)`, paddingBottom: "4px" }}>
                  <Label>{stat.label}</Label>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "9px", color: stat.color }}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
