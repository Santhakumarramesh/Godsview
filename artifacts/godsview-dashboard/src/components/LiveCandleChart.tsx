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

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "1m", value: "1Min" },
  { label: "5m", value: "5Min" },
  { label: "15m", value: "15Min" },
  { label: "1H", value: "1Hour" },
  { label: "1D", value: "1Day" },
];

const SYMBOLS = ["BTCUSD", "ETHUSD"];

type Props = { defaultSymbol?: string; defaultTimeframe?: Timeframe };

export default function LiveCandleChart({ defaultSymbol = "BTCUSD", defaultTimeframe = "5Min" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [symbol, setSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe);
  const [last, setLast] = useState<Candle | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const fetchAndUpdate = useCallback(async () => {
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
        bars.map((b) => ({ time: b.time as Time, value: b.volume, color: b.close >= b.open ? "rgba(156,255,147,0.25)" : "rgba(255,113,98,0.25)" }))
      );

      setLast(bars[bars.length - 1]);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setLoading(false);
    } catch { /* silent */ }
  }, [symbol, timeframe]);

  // Build chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      layout: { background: { color: C.card }, textColor: C.muted, fontFamily: "JetBrains Mono, monospace", fontSize: 10 },
      grid: { vertLines: { color: "rgba(72,72,73,0.12)" }, horzLines: { color: "rgba(72,72,73,0.12)" } },
      crosshair: {
        vertLine: { color: "rgba(156,255,147,0.35)", labelBackgroundColor: "#1a191b" },
        horzLine: { color: "rgba(156,255,147,0.35)", labelBackgroundColor: "#1a191b" },
      },
      rightPriceScale: { borderColor: "rgba(72,72,73,0.25)", textColor: C.muted },
      timeScale: { borderColor: "rgba(72,72,73,0.25)", timeVisible: true, secondsVisible: false },
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
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null; volRef.current = null; };
  }, []);

  // Refetch when symbol/timeframe changes
  useEffect(() => {
    setLoading(true);
    fetchAndUpdate();
    const id = setInterval(fetchAndUpdate, 5000);
    return () => clearInterval(id);
  }, [fetchAndUpdate]);

  const isUp = last ? last.close >= last.open : true;
  const chgPct = last && last.open ? ((last.close - last.open) / last.open) * 100 : 0;

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "rgba(72,72,73,0.2)" }}>
        <div className="flex items-center gap-3">
          {/* Symbol pills */}
          <div className="flex gap-1">
            {SYMBOLS.map((s) => (
              <button key={s} onClick={() => setSymbol(s)} style={{ padding: "2px 10px", fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, borderRadius: "4px", border: `1px solid ${symbol === s ? C.primary : "rgba(72,72,73,0.3)"}`, backgroundColor: symbol === s ? "rgba(156,255,147,0.08)" : "transparent", color: symbol === s ? C.primary : C.muted, cursor: "pointer" }}>
                {s === "BTCUSD" ? "BTC" : "ETH"}
              </button>
            ))}
          </div>

          {!loading && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.primary, letterSpacing: "0.15em" }}>LIVE</span>
            </span>
          )}

          {last && (
            <span className="flex items-center gap-3">
              <span style={{ fontSize: "12px", fontFamily: "JetBrains Mono", color: "#fff", fontWeight: 700 }}>
                ${last.close > 1000 ? last.close.toLocaleString("en-US", { maximumFractionDigits: 0 }) : last.close.toFixed(2)}
              </span>
              <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: isUp ? C.primary : C.tertiary, fontWeight: 700 }}>
                {isUp ? "▲" : "▼"} {Math.abs(chgPct).toFixed(2)}%
              </span>
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: C.outlineVar }}>
                O:{last.open.toFixed(0)} <span style={{ color: C.primary }}>H:{last.high.toFixed(0)}</span> <span style={{ color: C.tertiary }}>L:{last.low.toFixed(0)}</span> C:{last.close.toFixed(0)}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Timeframe pills */}
          <div className="flex gap-1">
            {TIMEFRAMES.map((tf) => (
              <button key={tf.value} onClick={() => setTimeframe(tf.value)} style={{ padding: "2px 7px", fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.08em", borderRadius: "3px", border: `1px solid ${timeframe === tf.value ? C.secondary : "rgba(72,72,73,0.2)"}`, backgroundColor: timeframe === tf.value ? "rgba(102,157,255,0.08)" : "transparent", color: timeframe === tf.value ? C.secondary : C.outlineVar, cursor: "pointer" }}>
                {tf.label}
              </button>
            ))}
          </div>
          {updatedAt && <span style={{ fontSize: "7px", fontFamily: "JetBrains Mono", color: C.outlineVar }}>{updatedAt}</span>}
        </div>
      </div>

      {/* Chart container */}
      <div style={{ position: "relative", height: "340px" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: C.card, zIndex: 10 }}>
            <div className="flex flex-col items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: C.primary, fontSize: "20px", animation: "spin 1s linear infinite" }}>autorenew</span>
              <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted, letterSpacing: "0.1em" }}>LOADING CANDLES</span>
            </div>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
