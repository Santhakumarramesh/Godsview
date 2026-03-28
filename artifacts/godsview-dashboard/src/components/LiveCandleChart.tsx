import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CandlestickSeries, HistogramSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Timeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

const C = {
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  card: "#1a191b",
  border: "rgba(72,72,73,0.25)",
  muted: "#adaaab",
  outlineVar: "#484849",
};

const TF_SECONDS: Record<Timeframe, number> = {
  "1Min": 60,
  "5Min": 300,
  "15Min": 900,
  "1Hour": 3600,
  "1Day": 86400,
};

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "1m", value: "1Min" },
  { label: "5m", value: "5Min" },
  { label: "15m", value: "15Min" },
  { label: "1H", value: "1Hour" },
  { label: "1D", value: "1Day" },
];

const SYMBOLS = ["BTCUSD", "ETHUSD"];

/** Format seconds remaining as m:ss or h:mm:ss */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Props = {
  defaultSymbol?: string;
  defaultTimeframe?: Timeframe;
  onPriceUpdate?: (price: number, symbol: string) => void;
  height?: number;
};

export default function LiveCandleChart({
  defaultSymbol = "BTCUSD",
  defaultTimeframe = "5Min",
  onPriceUpdate,
  height = 360,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const lastPriceRef = useRef<number | null>(null);
  const onPriceUpdateRef = useRef(onPriceUpdate);
  useEffect(() => { onPriceUpdateRef.current = onPriceUpdate; }, [onPriceUpdate]);

  const [symbol, setSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe);

  // Sync symbol when parent changes active instrument
  useEffect(() => {
    if (defaultSymbol && defaultSymbol !== symbol) setSymbol(defaultSymbol);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSymbol]);

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [tickCount, setTickCount] = useState(0);

  // ── Candle countdown timer — updates every second ─────────────────────────
  const [countdown, setCountdown] = useState<string | null>(null);
  const liveCandleRef = useRef<Candle | null>(null);
  const timeframeRef = useRef<Timeframe>(timeframe);

  // Keep refs in sync
  useEffect(() => { liveCandleRef.current = liveCandle; }, [liveCandle]);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);

  useEffect(() => {
    const tick = () => {
      const tf = timeframeRef.current;
      const tfSec = TF_SECONDS[tf] ?? 300;
      // Always compute from CURRENT wall-clock bucket — independent of last bar
      const nowSec = Math.floor(Date.now() / 1000);
      const currentBucketStart = Math.floor(nowSec / tfSec) * tfSec;
      const bucketEnd = currentBucketStart + tfSec;
      const remaining = bucketEnd - nowSec;
      setCountdown(remaining > 0 ? formatCountdown(remaining) : "0:00");
    };
    tick(); // immediate — sets countdown right away
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []); // single interval, reads timeframe from ref

  // ── Build chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      layout: { background: { color: C.card }, textColor: C.muted, fontFamily: "JetBrains Mono, monospace", fontSize: 10 },
      grid: { vertLines: { color: "rgba(72,72,73,0.1)" }, horzLines: { color: "rgba(72,72,73,0.1)" } },
      crosshair: {
        vertLine: { color: "rgba(156,255,147,0.35)", labelBackgroundColor: "#1a191b" },
        horzLine: { color: "rgba(156,255,147,0.35)", labelBackgroundColor: "#1a191b" },
      },
      rightPriceScale: { borderColor: "rgba(72,72,73,0.2)", textColor: C.muted },
      timeScale: { borderColor: "rgba(72,72,73,0.2)", timeVisible: true, secondsVisible: false },
      handleScroll: true,
      handleScale: true,
      width: el.clientWidth,
      height: el.clientHeight,
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: C.primary,
      downColor: C.tertiary,
      borderUpColor: C.primary,
      borderDownColor: C.tertiary,
      wickUpColor: C.primary,
      wickDownColor: C.tertiary,
    });

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  // ── Load historical bars via REST ─────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!candleRef.current) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/alpaca/candles?symbol=${symbol}&timeframe=${timeframe}&limit=200`);
      if (!res.ok) return;
      const data = await res.json() as { bars: Candle[] };
      const bars: Candle[] = data.bars ?? [];
      if (!bars.length || !candleRef.current) return;

      candleRef.current.setData(
        bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close }))
      );
      volRef.current?.setData(
        bars.map((b) => ({ time: b.time as Time, value: b.volume, color: b.close >= b.open ? "rgba(156,255,147,0.22)" : "rgba(255,113,98,0.22)" }))
      );

      const last = bars[bars.length - 1];
      setLiveCandle(last);
      lastPriceRef.current = last.close;
      setLoading(false);
    } catch { /* silent */ }
  }, [symbol, timeframe]);

  // ── Connect SSE stream for real-time ticks ────────────────────────────────
  const connectStream = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    setStreamStatus("connecting");
    const es = new EventSource(`/api/alpaca/stream?symbol=${symbol}&timeframe=${timeframe}`);
    esRef.current = es;

    es.onopen = () => setStreamStatus("live");

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== "tick") return;
        const c = msg.candle as Candle;
        const price = msg.price as number;

        if (candleRef.current) {
          candleRef.current.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
        }

        setLivePrice(price);
        setLiveCandle(c);
        lastPriceRef.current = price;
        setTickCount((n) => n + 1);
        onPriceUpdateRef.current?.(price, symbol);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setStreamStatus("error");
      es.close();
      esRef.current = null;
      setTimeout(connectStream, 3000);
    };
  }, [symbol, timeframe]);

  // ── Supplement SSE: poll /ticker every 3s for true current price ──────────
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/alpaca/ticker?symbols=${symbol}`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { tickers?: Array<{ symbol: string; price: number }> };
        const row = (data.tickers ?? []).find((r) => r.symbol === symbol);
        if (!row || cancelled) return;
        const price = row.price;

        if (liveCandleRef.current && candleRef.current) {
          const c = liveCandleRef.current;
          const updated: Candle = {
            ...c,
            close: price,
            high: Math.max(c.high, price),
            low: Math.min(c.low, price),
          };
          if (price !== lastPriceRef.current) {
            candleRef.current.update({ time: updated.time as Time, open: updated.open, high: updated.high, low: updated.low, close: updated.close });
            setLivePrice(price);
            setLiveCandle(updated);
            lastPriceRef.current = price;
            onPriceUpdateRef.current?.(price, symbol);
          }
        } else if (price !== lastPriceRef.current) {
          setLivePrice(price);
          lastPriceRef.current = price;
          onPriceUpdateRef.current?.(price, symbol);
        }
      } catch { /* silent */ }
    };

    const interval = setInterval(poll, 3000);
    poll();
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // ── Load history + start stream when symbol/timeframe changes ────────────
  useEffect(() => {
    loadHistory().then(() => connectStream());
    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [loadHistory, connectStream]);

  const price = livePrice ?? liveCandle?.close ?? null;
  const isUp = liveCandle ? liveCandle.close >= liveCandle.open : true;
  const chgPct = liveCandle && liveCandle.open ? ((liveCandle.close - liveCandle.open) / liveCandle.open) * 100 : 0;

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "rgba(72,72,73,0.18)" }}>
        <div className="flex items-center gap-3">
          {/* Symbol pills */}
          <div className="flex gap-1">
            {SYMBOLS.map((s) => (
              <button key={s} onClick={() => setSymbol(s)} style={{ padding: "2px 10px", fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, borderRadius: "4px", border: `1px solid ${symbol === s ? C.primary : "rgba(72,72,73,0.3)"}`, backgroundColor: symbol === s ? "rgba(156,255,147,0.08)" : "transparent", color: symbol === s ? C.primary : C.muted, cursor: "pointer" }}>
                {s === "BTCUSD" ? "BTC" : "ETH"}
              </button>
            ))}
          </div>

          {/* Stream status */}
          {streamStatus === "live" ? (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.primary, letterSpacing: "0.15em" }}>LIVE</span>
              <span style={{ fontSize: "7px", fontFamily: "JetBrains Mono", color: C.outlineVar }}>{tickCount} ticks</span>
            </span>
          ) : streamStatus === "connecting" ? (
            <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: "#fbbf24", letterSpacing: "0.1em" }}>CONNECTING…</span>
          ) : (
            <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.tertiary, letterSpacing: "0.1em" }}>RECONNECTING…</span>
          )}

          {/* OHLC display */}
          {liveCandle && (
            <span className="flex items-center gap-3">
              <span style={{ fontSize: "13px", fontFamily: "JetBrains Mono", color: "#fff", fontWeight: 700 }}>
                ${price && price > 1000 ? price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : price?.toFixed(2)}
              </span>
              <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: isUp ? C.primary : C.tertiary, fontWeight: 700 }}>
                {isUp ? "▲" : "▼"} {Math.abs(chgPct).toFixed(2)}%
              </span>
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.outlineVar }}>
                O:{liveCandle.open.toFixed(0)}&nbsp;
                <span style={{ color: C.primary }}>H:{liveCandle.high.toFixed(0)}</span>&nbsp;
                <span style={{ color: C.tertiary }}>L:{liveCandle.low.toFixed(0)}</span>&nbsp;
                C:{liveCandle.close.toFixed(0)}
              </span>
            </span>
          )}
        </div>

        {/* Timeframe pills */}
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button key={tf.value} onClick={() => setTimeframe(tf.value)} style={{ padding: "2px 7px", fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.08em", borderRadius: "3px", border: `1px solid ${timeframe === tf.value ? C.secondary : "rgba(72,72,73,0.2)"}`, backgroundColor: timeframe === tf.value ? "rgba(102,157,255,0.08)" : "transparent", color: timeframe === tf.value ? C.secondary : C.outlineVar, cursor: "pointer" }}>
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart canvas area */}
      <div style={{ position: "relative", height: `${height}px` }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: C.card, zIndex: 10 }}>
            <div className="flex flex-col items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: C.primary, fontSize: "22px", animation: "spin 1s linear infinite" }}>autorenew</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted, letterSpacing: "0.12em" }}>LOADING CANDLES</span>
            </div>
          </div>
        )}

        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {/* ── Candle countdown badge — TradingView-style ────────────────────
            Positioned just above the time axis, right before the price scale.
            Shows time remaining until the current candle closes. ────────── */}
        {countdown !== null && (
          <div
            style={{
              position: "absolute",
              // Right-align so it sits just left of the price scale (~65px wide)
              right: "68px",
              // Sit just above the time axis (~24px tall) — so 28px from bottom
              bottom: "28px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              backgroundColor: "rgba(14,14,15,0.85)",
              border: `1px solid ${isUp ? "rgba(156,255,147,0.25)" : "rgba(255,113,98,0.25)"}`,
              borderRadius: "3px",
              padding: "2px 6px 2px 5px",
              pointerEvents: "none",
              zIndex: 5,
              backdropFilter: "blur(4px)",
            }}
          >
            {/* Small clock icon */}
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.7 }}>
              <circle cx="6" cy="6" r="5" stroke={isUp ? C.primary : C.tertiary} strokeWidth="1.5" />
              <path d="M6 3.5V6.5L8 8" stroke={isUp ? C.primary : C.tertiary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* Countdown text */}
            <span
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "10px",
                fontWeight: 600,
                color: isUp ? C.primary : C.tertiary,
                letterSpacing: "0.04em",
                lineHeight: 1,
              }}
            >
              {countdown}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
