/**
 * TradingViewChart.tsx
 *
 * Embeds TradingView's Advanced Chart widget via direct iframe URL.
 * — Full-screen toggle (Fullscreen API)
 * — One-click refresh (reloads the iframe to jump to present candles)
 * — Live price / latency overlay from our Alpaca SSE stream
 *
 * Data source: Coinbase (BTCUSD, ETHUSD) — IDENTICAL to TradingView.com prices.
 * Free for personal/non-commercial use per TradingView's embed policy.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

type Timeframe = "1" | "5" | "15" | "60" | "D";

interface Props {
  symbol?:      string;
  timeframe?:   Timeframe;
  height?:      number;
  showToolbar?: boolean;
  studies?:     string[];
  showLatency?: boolean;
}

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD:  "COINBASE:BTCUSD",
  ETHUSD:  "COINBASE:ETHUSD",
  BTCUSDT: "COINBASE:BTCUSD",
  ETHUSDT: "COINBASE:ETHUSD",
  BINANCE_BTCUSDT: "BINANCE:BTCUSDT",
};

const TF_MAP: Record<string, string> = {
  "1": "1", "5": "5", "15": "15", "60": "60", "D": "D",
  "1Min": "1", "5Min": "5", "15Min": "15", "1Hour": "60", "1Day": "D",
};

const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162", outline: "#767576", muted: "#adaaab",
};

// ─────────────────────────────────────────────────────────────────────────────
export default function TradingViewChart({
  symbol      = "BTCUSD",
  timeframe   = "5",
  height      = 480,
  showToolbar = true,
  showLatency = true,
}: Props) {
  const tvSymbol = SYMBOL_MAP[symbol] ?? `COINBASE:${symbol}`;
  const tvTf     = TF_MAP[timeframe] ?? timeframe;

  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeKey,   setIframeKey]   = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Live Alpaca SSE price + latency tracking
  const [livePrice,  setLivePrice]  = useState<number | null>(null);
  const [latencyMs,  setLatencyMs]  = useState<number | null>(null);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [feedAge,    setFeedAge]    = useState<number>(0);   // seconds since last tick
  const esRef = useRef<EventSource | null>(null);

  // ── SSE subscription ──────────────────────────────────────────────────────
  const alpacaSymbol = symbol.replace("USDT", "USD").replace("USDC", "USD");
  useEffect(() => {
    if (!showLatency) return;
    const es = new EventSource(`/api/alpaca/stream?symbol=${alpacaSymbol}`);
    esRef.current = es;
    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data);
        if (d.type === "tick" && typeof d.price === "number") {
          const now = Date.now();
          const tickTs = new Date(d.timestamp).getTime();
          setLivePrice(d.price);
          setLatencyMs(now - tickTs);
          setLastTickAt(now);
        }
      } catch { /* ignore malformed frames */ }
    };
    return () => { es.close(); esRef.current = null; };
  }, [alpacaSymbol, showLatency]);

  // ── Feed-age counter (ticks up every second since last tick) ─────────────
  useEffect(() => {
    if (!showLatency) return;
    const id = setInterval(() => {
      setFeedAge(lastTickAt ? Math.round((Date.now() - lastTickAt) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [lastTickAt, showLatency]);

  // ── Fullscreen handling ───────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleRefresh = useCallback(() => setIframeKey((k) => k + 1), []);

  // ── Build TradingView URL ────────────────────────────────────────────────
  const iframeSrc = useMemo(() => {
    const base = "https://www.tradingview.com/widgetembed/";
    const p = [
      `symbol=${encodeURIComponent(tvSymbol)}`,
      `interval=${tvTf}`,
      `theme=dark`,
      `style=1`,
      `locale=en`,
      `toolbar_bg=%231a191b`,
      `enable_publishing=0`,
      `hide_top_toolbar=${showToolbar ? "0" : "1"}`,
      `hide_legend=0`,
      `save_image=0`,
      `hide_side_toolbar=0`,
      `allow_symbol_change=0`,
      `withdateranges=1`,
      `calendar=0`,
      `studies=Volume%40tv-basicstudies`,
      `studies=RSI%40tv-basicstudies`,
      `backgroundColor=rgba%2814%2C14%2C15%2C1%29`,
      `details=1`,          // show detailed price info
      `hotlist=0`,
      `news=0`,
    ];
    return `${base}?${p.join("&")}`;
  }, [tvSymbol, tvTf, showToolbar]);

  // Latency quality colour
  const latencyColor =
    latencyMs === null ? C.outline :
    latencyMs < 300    ? C.primary :
    latencyMs < 1000   ? "#fbbf24" : C.tertiary;

  const feedAgeColor =
    feedAge < 5  ? C.primary :
    feedAge < 30 ? "#fbbf24" : C.tertiary;

  const effectiveHeight = isFullscreen ? "100vh" : `${height}px`;

  return (
    <div
      ref={containerRef}
      style={{
        height: effectiveHeight,
        backgroundColor: "#1a191b",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Control overlay bar ────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {/* Live price + latency pill */}
        {showLatency && livePrice !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "rgba(14,14,15,0.88)",
              border: `1px solid ${C.border}`,
              borderRadius: "4px",
              padding: "3px 8px",
              backdropFilter: "blur(4px)",
            }}
          >
            {/* Feed age dot */}
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: feedAgeColor,
                boxShadow: feedAge < 5 ? `0 0 5px ${feedAgeColor}` : "none",
                flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "9px", color: "#fff", letterSpacing: "0.03em" }}>
              ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span style={{ fontFamily: "Space Grotesk", fontSize: "8px", color: latencyColor, letterSpacing: "0.05em" }}>
              {latencyMs !== null ? `${latencyMs}ms` : "–"}
            </span>
            <span style={{ fontFamily: "Space Grotesk", fontSize: "7px", color: C.outline }}>
              {feedAge}s ago
            </span>
          </div>
        )}

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          title="Refresh chart (jump to present candles)"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "26px",
            height: "26px",
            borderRadius: "4px",
            backgroundColor: "rgba(14,14,15,0.88)",
            border: `1px solid ${C.border}`,
            cursor: "pointer",
            backdropFilter: "blur(4px)",
            color: C.muted,
            transition: "color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = C.secondary; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(102,157,255,0.4)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = C.muted; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>refresh</span>
        </button>

        {/* Fullscreen button */}
        <button
          onClick={handleFullscreen}
          title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen chart"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "26px",
            height: "26px",
            borderRadius: "4px",
            backgroundColor: "rgba(14,14,15,0.88)",
            border: `1px solid ${isFullscreen ? "rgba(156,255,147,0.35)" : C.border}`,
            cursor: "pointer",
            backdropFilter: "blur(4px)",
            color: isFullscreen ? C.primary : C.muted,
            transition: "color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = C.primary; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(156,255,147,0.4)"; }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = isFullscreen ? C.primary : C.muted;
            (e.currentTarget as HTMLButtonElement).style.borderColor = isFullscreen ? "rgba(156,255,147,0.35)" : C.border;
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
            {isFullscreen ? "fullscreen_exit" : "fullscreen"}
          </span>
        </button>
      </div>

      {/* ── TradingView iframe ─────────────────────────────────────────── */}
      <iframe
        key={iframeKey}
        src={iframeSrc}
        title={`TradingView chart — ${tvSymbol}`}
        width="100%"
        height="100%"
        frameBorder="0"
        allow="fullscreen"
        style={{ display: "block", border: "none", flex: 1 }}
      />
    </div>
  );
}

/** Utility: convert "5Min" → "5" for the TradingView timeframe prop */
export function toTVInterval(tf: string): Timeframe {
  return (TF_MAP[tf] ?? tf) as Timeframe;
}
