/**
 * PriceLatencyPanel.tsx
 *
 * Compares our Alpaca WebSocket SSE feed vs REST ticker to measure end-to-end
 * data latency. Gives the user visibility into how "live" our price data is
 * vs what they'd see on TradingView.com directly.
 *
 * Layout:
 *  [WSS Live Price] [REST Snapshot] [WS Latency] [Feed Age] [Health]
 */

import { useEffect, useRef, useState } from "react";

const BASE = "/api";
const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

function Mono({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", fontWeight: 700, color: color ?? "#fff" }}>
      {children}
    </span>
  );
}

interface Props { symbol?: string }

export default function PriceLatencyPanel({ symbol = "BTCUSD" }: Props) {
  // ── SSE (WebSocket-backed) live price ─────────────────────────────────────
  const [wsPrice,    setWsPrice]    = useState<number | null>(null);
  const [wsTs,       setWsTs]       = useState<number | null>(null);   // tick epoch ms
  const [wsLatency,  setWsLatency]  = useState<number | null>(null);   // ms lag at reception
  const [wsFeedAge,  setWsFeedAge]  = useState<number>(0);             // s since last tick
  const [wsTickRate, setWsTickRate] = useState<number>(0);             // ticks / min
  const tickCountRef = useRef(0);
  const tickCountWindowRef = useRef<number[]>([]);

  // ── REST snapshot ─────────────────────────────────────────────────────────
  const [restPrice,   setRestPrice]   = useState<number | null>(null);
  const [restFetchMs, setRestFetchMs] = useState<number | null>(null); // round-trip ms
  const [priceDelta,  setPriceDelta]  = useState<number | null>(null);

  // ── Connect SSE ───────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`${BASE}/alpaca/stream?symbol=${symbol}`);
    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data);
        if (d.type === "tick" && typeof d.price === "number") {
          const now = Date.now();
          const ts  = new Date(d.timestamp).getTime();
          setWsPrice(d.price);
          setWsTs(now);
          setWsLatency(now - ts);
          tickCountRef.current++;
          tickCountWindowRef.current.push(now);
          // keep only last-60s ticks
          const cutoff = now - 60_000;
          tickCountWindowRef.current = tickCountWindowRef.current.filter((t) => t > cutoff);
          setWsTickRate(tickCountWindowRef.current.length);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [symbol]);

  // ── Feed-age counter ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setWsFeedAge(wsTs ? Math.round((Date.now() - wsTs) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [wsTs]);

  // ── REST poller (every 5s) ────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${BASE}/alpaca/ticker?symbols=${symbol}`);
        const j = await r.json();
        const t1 = Date.now();
        const ticker = j.tickers?.[0];
        if (ticker && typeof ticker.price === "number") {
          setRestPrice(ticker.price);
          setRestFetchMs(t1 - t0);
        }
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [symbol]);

  // ── Price delta (WSS vs REST) ─────────────────────────────────────────────
  useEffect(() => {
    if (wsPrice !== null && restPrice !== null) {
      setPriceDelta(Math.abs(wsPrice - restPrice));
    }
  }, [wsPrice, restPrice]);

  // ── Colour helpers ────────────────────────────────────────────────────────
  const latencyColor  = wsLatency === null ? C.outline : wsLatency < 300 ? C.primary : wsLatency < 1200 ? "#fbbf24" : C.tertiary;
  const feedAgeColor  = wsFeedAge < 5 ? C.primary : wsFeedAge < 20 ? "#fbbf24" : C.tertiary;
  const restRtColor   = restFetchMs === null ? C.outline : restFetchMs < 200 ? C.primary : restFetchMs < 600 ? "#fbbf24" : C.tertiary;
  const deltaColor    = priceDelta === null ? C.outline : priceDelta < 1 ? C.primary : priceDelta < 20 ? "#fbbf24" : C.tertiary;

  // Feed health
  const healthy = wsLatency !== null && wsLatency < 1200 && wsFeedAge < 15;
  const healthLabel = wsPrice === null ? "connecting" : healthy ? "optimal" : wsFeedAge > 60 ? "stale" : "degraded";
  const healthColor = wsPrice === null ? C.outline : healthy ? C.primary : wsFeedAge > 60 ? C.tertiary : "#fbbf24";

  const cells = [
    {
      label: "WS Live Price",
      value: wsPrice !== null ? `$${wsPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
      color: "#fff",
      sub: `${wsTickRate} ticks/min`,
      icon: "wifi",
      iconColor: wsPrice !== null ? C.primary : C.outline,
    },
    {
      label: "REST Snapshot",
      value: restPrice !== null ? `$${restPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
      color: "#fff",
      sub: restFetchMs !== null ? `${restFetchMs}ms round-trip` : "polling…",
      icon: "http",
      iconColor: restRtColor,
    },
    {
      label: "WS Latency",
      value: wsLatency !== null ? `${wsLatency}ms` : "—",
      color: latencyColor,
      sub: wsLatency !== null ? (wsLatency < 300 ? "real-time" : wsLatency < 1200 ? "acceptable" : "high") : "awaiting tick",
      icon: "speed",
      iconColor: latencyColor,
    },
    {
      label: "Feed Age",
      value: wsTs !== null ? `${wsFeedAge}s` : "—",
      color: feedAgeColor,
      sub: wsTs !== null ? new Date(wsTs).toLocaleTimeString() : "no ticks yet",
      icon: "schedule",
      iconColor: feedAgeColor,
    },
    {
      label: "WS vs REST Δ",
      value: priceDelta !== null ? `$${priceDelta.toFixed(2)}` : "—",
      color: deltaColor,
      sub: priceDelta !== null ? (priceDelta < 1 ? "in sync" : `${(priceDelta / (restPrice ?? 1) * 100).toFixed(3)}%`) : "—",
      icon: "compare_arrows",
      iconColor: deltaColor,
    },
    {
      label: "Feed Health",
      value: healthLabel,
      color: healthColor,
      sub: wsPrice !== null ? `Alpaca WSS · Coinbase` : "Connecting to stream…",
      icon: healthy ? "check_circle" : wsPrice === null ? "radio_button_unchecked" : "warning",
      iconColor: healthColor,
    },
  ];

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="rounded p-3 flex flex-col gap-1"
          style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined" style={{ fontSize: "12px", color: cell.iconColor }}>{cell.icon}</span>
            <Label>{cell.label}</Label>
          </div>
          <Mono color={cell.color}>{cell.value}</Mono>
          <span style={{ fontSize: "8px", color: C.muted, fontFamily: "Space Grotesk" }}>{cell.sub}</span>
        </div>
      ))}
    </div>
  );
}
