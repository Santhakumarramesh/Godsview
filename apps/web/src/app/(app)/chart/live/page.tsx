"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Quote {
  symbol: string;
  price: number;
  change: number;
  volume: number;
}

const TIMEFRAMES = ["1min", "5min", "15min", "1h", "4h", "1d"];

export default function TradingViewLiveChartPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AAPL");
  const [timeframe, setTimeframe] = useState<string>("15min");
  const [bars, setBars] = useState<Bar[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Fetch symbols list
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await fetch("/api/market/symbols");
        if (!res.ok) throw new Error("Failed to fetch symbols");
        const data = await res.json();
        setSymbols(data.symbols || []);
        if (data.symbols && data.symbols.length > 0) {
          setSelectedSymbol(data.symbols[0]);
        }
      } catch (err) {
        setError("Error loading symbols");
        console.error(err);
      }
    };
    fetchSymbols();
  }, []);

  // Fetch bars and quote data
  const fetchData = useCallback(async (symbol: string, tf: string) => {
    setLoading(true);
    setError("");
    try {
      const [barsRes, quoteRes] = await Promise.all([
        fetch(`/api/market/bars/${symbol}?timeframe=${tf}&limit=200`),
        fetch(`/api/market/quote/${symbol}`),
      ]);

      if (!barsRes.ok || !quoteRes.ok) throw new Error("API fetch failed");

      const barsData = await barsRes.json();
      const quoteData = await quoteRes.json();

      setBars(barsData.bars || []);
      setQuote(quoteData);
    } catch (err) {
      setError("Failed to fetch data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchData(selectedSymbol, timeframe);
    const interval = setInterval(() => {
      fetchData(selectedSymbol, timeframe);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol, timeframe, fetchData]);

  // Draw candlestick chart on canvas
  useEffect(() => {
    if (!canvasRef.current || bars.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 50;

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, width, height);

    if (bars.length === 0) return;

    const minPrice = Math.min(...bars.map((b) => b.l));
    const maxPrice = Math.max(...bars.map((b) => b.h));
    const priceRange = maxPrice - minPrice || 1;

    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;
    const candleWidth = Math.max(2, chartWidth / bars.length - 1);

    bars.forEach((bar, idx) => {
      const x = padding + (idx * chartWidth) / bars.length;
      const highY = padding + ((maxPrice - bar.h) / priceRange) * chartHeight;
      const lowY = padding + ((maxPrice - bar.l) / priceRange) * chartHeight;
      const openY = padding + ((maxPrice - bar.o) / priceRange) * chartHeight;
      const closeY = padding + ((maxPrice - bar.c) / priceRange) * chartHeight;

      // Wick
      ctx.strokeStyle = bar.c >= bar.o ? "#10b981" : "#ef4444";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.abs(closeY - openY) || 1;
      ctx.fillStyle = bar.c >= bar.o ? "#10b981" : "#ef4444";
      ctx.fillRect(x, bodyTop, candleWidth, bodyHeight);
    });

    // Y-axis labels
    ctx.fillStyle = "#9ca3af";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      const price = minPrice + (priceRange * i) / 5;
      const y = padding + ((maxPrice - price) / priceRange) * chartHeight;
      ctx.fillText(price.toFixed(2), padding - 10, y + 4);
    }
  }, [bars]);

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">TradingView Live Chart</h1>
        <span className="rounded bg-emerald-400/15 px-2 py-1 font-mono text-xs text-emerald-400">
          live
        </span>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Symbol</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Timeframe</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => fetchData(selectedSymbol, timeframe)}
          className="mt-6 rounded border border-emerald-400 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-400 hover:bg-emerald-400/20"
        >
          Refresh
        </button>
      </div>

      {/* Quote Info */}
      {quote && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Symbol</p>
            <p className="text-xl font-semibold text-white">{quote.symbol}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Price</p>
            <p className="text-xl font-semibold text-white">${quote.price.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Change</p>
            <p className={`text-xl font-semibold ${quote.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {quote.change >= 0 ? "+" : ""}{quote.change.toFixed(2)}%
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Volume</p>
            <p className="text-xl font-semibold text-white">{(quote.volume / 1000000).toFixed(1)}M</p>
          </div>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : bars.length > 0 ? (
        <canvas
          ref={canvasRef}
          width={1000}
          height={400}
          className="w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f]"
        />
      ) : (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 text-center text-gray-400">
          No data available
        </div>
      )}
    </section>
  );
}
