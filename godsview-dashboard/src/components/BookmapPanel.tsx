/**
 * BookmapPanel.tsx  —  Phase 6 (upgraded to live WebSocket SSE)
 *
 * Real-time bid/ask depth histogram powered by Alpaca's WS order book stream.
 * Updates arrive directly from the WebSocket via SSE — ~150ms latency.
 *
 * Layout:
 *   Left  = bid volume (green bars ←)
 *   Right = ask volume (red bars →)
 *   Centre = price level axis
 *   Current mid price highlighted in white
 */

import { useMemo } from "react";
import { useOrderbook } from "@/hooks/useOrderbook";

const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: "8px", fontFamily: "Space Grotesk",
      letterSpacing: "0.18em", textTransform: "uppercase", color: C.outline,
    }}>
      {children}
    </span>
  );
}

function fmt(v: number) {
  return v > 1000 ? v.toFixed(2) : v.toFixed(4);
}

function statusColor(status: string) {
  if (status === "ws")         return C.primary;
  if (status === "live")       return "#fbbf24";
  if (status === "error")      return C.tertiary;
  return C.outline;
}

function statusLabel(status: string) {
  if (status === "ws")         return "WS LIVE";
  if (status === "live")       return "REST";
  if (status === "connecting") return "CONNECTING";
  return "ERROR";
}

interface Props { symbol?: string; depth?: number }

export default function BookmapPanel({ symbol = "BTCUSD", depth = 25 }: Props) {
  const { data, status } = useOrderbook(symbol, depth);

  // Merge bid+ask levels into a sorted price ladder
  const { levels, maxVol, imbalance } = useMemo(() => {
    if (!data) return { levels: [], maxVol: 1, imbalance: 0 };

    const priceMap = new Map<number, { bid: number; ask: number }>();

    for (const b of data.bids) {
      const k = Math.round(b.price * 100) / 100;
      priceMap.set(k, { bid: b.size, ask: priceMap.get(k)?.ask ?? 0 });
    }
    for (const a of data.asks) {
      const k = Math.round(a.price * 100) / 100;
      priceMap.set(k, { bid: priceMap.get(k)?.bid ?? 0, ask: a.size });
    }

    const sorted = [...priceMap.entries()]
      .sort(([a], [b]) => b - a)
      .map(([price, { bid, ask }]) => ({ price, bid, ask }));

    const mv = sorted.reduce((m, l) => Math.max(m, l.bid, l.ask), 1);

    // Imbalance: (total bid vol - total ask vol) / (total bid vol + total ask vol)
    const totalBid = data.bids.reduce((s, b) => s + b.size, 0);
    const totalAsk = data.asks.reduce((s, a) => s + a.size, 0);
    const imb = totalBid + totalAsk > 0 ? (totalBid - totalAsk) / (totalBid + totalAsk) : 0;

    return { levels: sorted, maxVol: mv, imbalance: imb };
  }, [data]);

  const mid = data?.bestBid && data?.bestAsk
    ? (data.bestBid.price + data.bestAsk.price) / 2
    : null;

  const spread    = data?.spread ?? null;
  const spreadBps = mid && spread ? (spread / mid) * 10_000 : null;

  // Absorption detection: top level > 3× average of next 4 levels
  const bidAbsorbing = (() => {
    const bidLevels = data?.bids ?? [];
    if (bidLevels.length < 5) return false;
    const top  = bidLevels[0].size;
    const avg4 = bidLevels.slice(1, 5).reduce((s, b) => s + b.size, 0) / 4;
    return top > avg4 * 3;
  })();
  const askAbsorbing = (() => {
    const askLevels = data?.asks ?? [];
    if (askLevels.length < 5) return false;
    const top  = askLevels[0].size;
    const avg4 = askLevels.slice(1, 5).reduce((s, a) => s + a.size, 0) / 4;
    return top > avg4 * 3;
  })();

  const signal = bidAbsorbing ? "BID ABSORPTION" : askAbsorbing ? "ASK ABSORPTION" : "NEUTRAL";
  const signalColor = bidAbsorbing ? "#a78bfa" : askAbsorbing ? "#fb923c" : C.outline;

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
          {/* Live source badge */}
          <span style={{
            fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700,
            color: statusColor(status), letterSpacing: "0.1em",
          }}>
            {statusLabel(status)}
          </span>
          {/* Signal */}
          <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: signalColor, letterSpacing: "0.08em" }}>
            {signal}
          </span>
        </div>
      </div>

      {status === "error" && (
        <div className="p-6 text-center">
          <span style={{ fontSize: "10px", color: C.tertiary, fontFamily: "Space Grotesk" }}>Order book stream error — reconnecting…</span>
        </div>
      )}

      {!data && status !== "error" && (
        <div className="p-6 text-center">
          <span style={{ fontSize: "10px", color: C.outline, fontFamily: "Space Grotesk" }}>Connecting to live order book…</span>
        </div>
      )}

      {data && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* ── Bid/Ask histogram ─────────────────────────────────── */}
            <div className="md:col-span-2">
              <div className="grid grid-cols-3 mb-2 text-center">
                <Label>Bid Volume</Label>
                <Label>Price</Label>
                <Label>Ask Volume</Label>
              </div>
              <div className="space-y-0.5" style={{ maxHeight: "400px", overflowY: "auto" }}>
                {levels.map((level, idx) => {
                  const bidPct    = (level.bid / maxVol) * 100;
                  const askPct    = (level.ask / maxVol) * 100;
                  const isMid     = mid !== null && Math.abs(level.price - mid) < (spread ?? 100) * 0.6;
                  const isBestBid = data.bestBid !== null && Math.abs(level.price - data.bestBid!.price) < 0.01;
                  const isBestAsk = data.bestAsk !== null && Math.abs(level.price - data.bestAsk!.price) < 0.01;
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-3 items-center"
                      style={{
                        height: "18px",
                        backgroundColor: isMid ? "rgba(255,255,255,0.03)" : "transparent",
                        borderLeft: isMid ? "2px solid rgba(255,255,255,0.15)" : "2px solid transparent",
                      }}
                    >
                      {/* Bid bar — right-aligned */}
                      <div style={{ display: "flex", justifyContent: "flex-end", paddingRight: "2px", height: "12px", alignItems: "center" }}>
                        {level.bid > 0 && (
                          <div style={{
                            width: `${Math.max(bidPct, 1.5)}%`,
                            maxWidth: "100%",
                            height: "10px",
                            backgroundColor: isBestBid
                              ? C.primary
                              : bidAbsorbing && bidPct > 60 ? "#a78bfa" : "rgba(156,255,147,0.45)",
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
                            width: `${Math.max(askPct, 1.5)}%`,
                            maxWidth: "100%",
                            height: "10px",
                            backgroundColor: isBestAsk
                              ? C.tertiary
                              : askAbsorbing && askPct > 60 ? "#fb923c" : "rgba(255,113,98,0.45)",
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

            {/* ── Stats sidebar ──────────────────────────────── */}
            <div className="flex flex-col gap-2">
              {[
                {
                  label: "Mid Price",
                  value: mid ? `$${fmt(mid)}` : "—",
                  color: "#fff",
                },
                {
                  label: "Best Bid",
                  value: data.bestBid ? `$${fmt(data.bestBid.price)}` : "—",
                  color: C.primary,
                },
                {
                  label: "Best Ask",
                  value: data.bestAsk ? `$${fmt(data.bestAsk.price)}` : "—",
                  color: C.tertiary,
                },
                {
                  label: "Spread",
                  value: spread !== null ? `$${spread.toFixed(4)}` : "—",
                  color: C.muted,
                },
                {
                  label: "Spread bps",
                  value: spreadBps !== null ? `${spreadBps.toFixed(1)}bps` : "—",
                  color: spreadBps !== null && spreadBps < 5 ? C.primary : "#fbbf24",
                },
                {
                  label: "Imbalance",
                  value: `${(imbalance * 100).toFixed(0)}%`,
                  color: imbalance > 0.15 ? C.primary : imbalance < -0.15 ? C.tertiary : C.muted,
                },
                {
                  label: "Bid Vol",
                  value: data.bids.slice(0, 1).map((b) => b.size.toFixed(4)).join("") || "—",
                  color: C.primary,
                },
                {
                  label: "Ask Vol",
                  value: data.asks.slice(0, 1).map((a) => a.size.toFixed(4)).join("") || "—",
                  color: C.tertiary,
                },
                {
                  label: "Absorb Bid",
                  value: bidAbsorbing ? "YES" : "no",
                  color: bidAbsorbing ? "#a78bfa" : C.outline,
                },
                {
                  label: "Absorb Ask",
                  value: askAbsorbing ? "YES" : "no",
                  color: askAbsorbing ? "#fb923c" : C.outline,
                },
                {
                  label: "Total Bids",
                  value: `${data.totalBids} levels`,
                  color: C.muted,
                },
                {
                  label: "Total Asks",
                  value: `${data.totalAsks} levels`,
                  color: C.muted,
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between"
                  style={{ borderBottom: "1px solid rgba(72,72,73,0.1)", paddingBottom: "4px" }}
                >
                  <Label>{stat.label}</Label>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "9px", color: stat.color }}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
