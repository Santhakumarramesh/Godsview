/**
 * TradingViewChart.tsx
 *
 * Embeds TradingView's Advanced Chart widget via direct iframe URL.
 * — Full-screen toggle (Fullscreen API)
 * — One-click refresh (reloads the iframe to jump to present candles)
 * — Live price / latency overlay from our Alpaca SSE stream
 * This approach requires no JavaScript library download and renders immediately.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { isCryptoSymbol, toAlpacaSymbol as toUnifiedAlpacaSymbol } from "@/lib/market/symbols";

type Timeframe = "1" | "5" | "15" | "60" | "D";

interface Props {
  symbol?: string;
  timeframe?: Timeframe;
  height?: number;
  showToolbar?: boolean;
  showLatency?: boolean;
  allowSymbolChange?: boolean;
  studies?: string[];
}

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: "COINBASE:BTCUSD",
  ETHUSD: "COINBASE:ETHUSD",
  BTCUSDT: "COINBASE:BTCUSD",
  ETHUSDT: "COINBASE:ETHUSD",
  BINANCE_BTCUSDT: "BINANCE:BTCUSDT",
  BINANCE_ETHUSDT: "BINANCE:ETHUSDT",
  MES: "CME_MINI:MES1!",
  MNQ: "CME_MINI:MNQ1!",
};

const TF_MAP: Record<string, string> = {
  "1": "1",
  "5": "5",
  "15": "15",
  "60": "60",
  "D": "D",
  "1Min": "1",
  "5Min": "5",
  "15Min": "15",
  "1Hour": "60",
  "1Day": "D",
};

const C = {
  card: "#1a191b",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  outline: "#767576",
  muted: "#adaaab",
};

// ─────────────────────────────────────────────────────────────────────────────
export default function TradingViewChart({
  symbol = "BTCUSD",
  timeframe = "5",
  height = 480,
  showToolbar = true,
  showLatency = true,
  allowSymbolChange = true,
  studies = ["Volume@tv-basicstudies", "RSI@tv-basicstudies"],
}: Props) {
  const normalizedInput = symbol.trim().toUpperCase();
  const tvSymbol =
    SYMBOL_MAP[normalizedInput] ??
    (normalizedInput.includes(":") ? normalizedInput : normalizedInput);
  const tvTf = TF_MAP[timeframe] ?? timeframe;

  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Live Alpaca SSE price + latency tracking
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [feedAge, setFeedAge] = useState<number>(0);
  const esRef = useRef<EventSource | null>(null);

  // ── SSE subscription ──────────────────────────────────────────────────────
  const alpacaSymbol = toUnifiedAlpacaSymbol(normalizedInput);
  const streamEnabled = isCryptoSymbol(alpacaSymbol);

  useEffect(() => {
    if (!showLatency || !streamEnabled) return;
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
      } catch {
        // ignore malformed frames
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [alpacaSymbol, showLatency, streamEnabled]);

  // ── Feed-age counter (ticks up every second since last tick) ─────────────
  useEffect(() => {
    if (!showLatency || !streamEnabled) return;
    const id = setInterval(() => {
      setFeedAge(lastTickAt ? Math.round((Date.now() - lastTickAt) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [lastTickAt, showLatency, streamEnabled]);

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
    const params = new URLSearchParams();
    const normalizedStudies = studies.map((s) => s.trim()).filter(Boolean);

    params.set("symbol", tvSymbol);
    params.set("interval", tvTf);
    params.set("theme", "dark");
    params.set("style", "1");
    params.set("locale", "en");
    params.set("toolbar_bg", "#1a191b");
    params.set("enable_publishing", "0");
    params.set("hide_top_toolbar", showToolbar ? "0" : "1");
    params.set("hide_legend", "0");
    params.set("save_image", "0");
    params.set("hide_side_toolbar", "0");
    params.set("allow_symbol_change", allowSymbolChange ? "1" : "0");
    params.set("withdateranges", "1");
    params.set("calendar", "0");
    params.set("backgroundColor", "rgba(14,14,15,1)");
    params.set("details", "1");
    params.set("hotlist", "0");
    params.set("news", "0");
    params.set("studies", JSON.stringify(normalizedStudies));

    return `${base}?${params.toString()}`;
  }, [tvSymbol, tvTf, showToolbar, allowSymbolChange, studies]);

  const latencyColor =
    latencyMs === null ? C.outline :
    latencyMs < 300 ? C.primary :
    latencyMs < 1000 ? "#fbbf24" : C.tertiary;

  const feedAgeColor =
    feedAge < 5 ? C.primary :
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
        {showLatency && streamEnabled && livePrice !== null && (
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
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = C.secondary;
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(102,157,255,0.4)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = C.muted;
            (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
          }}
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
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = C.primary;
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(156,255,147,0.4)";
          }}
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
        title={`TradingView chart - ${tvSymbol}`}
        width="100%"
        height="100%"
        frameBorder="0"
        allow="fullscreen"
        style={{ display: "block", border: "none", flex: 1 }}
      />
    </div>
  );
}

/** Utility: convert "5Min" -> "5" for the TradingView timeframe prop */
export function toTVInterval(tf: string): Timeframe {
  return (TF_MAP[tf] ?? tf) as Timeframe;
}
