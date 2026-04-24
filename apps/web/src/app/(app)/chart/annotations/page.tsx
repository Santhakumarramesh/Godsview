"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Annotation {
  id: string;
  price: number;
  text: string;
  color: string;
  timestamp: number;
}

export default function ChartAnnotationStudioPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AAPL");
  const [bars, setBars] = useState<Bar[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [annotationPrice, setAnnotationPrice] = useState<number>(0);
  const [annotationText, setAnnotationText] = useState<string>("");
  const [annotationColor, setAnnotationColor] = useState<string>("emerald");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Fetch symbols
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const data = await api.market.getSymbols();
        setSymbols(data.symbols || []);
        if (data.symbols && data.symbols.length > 0) {
          setSelectedSymbol(data.symbols[0]);
        }
      } catch (err) {
        setSymbols(["AAPL", "TSLA", "MSFT", "NVDA", "AMD"]);
      }
    };
    fetchSymbols();
  }, []);

  // Fetch bars
  const fetchData = useCallback(async (symbol: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.market.getBars(symbol, { timeframe: "1h", limit: 100 });
      setBars(data.bars || []);
      if (data.bars && data.bars.length > 0) {
        setAnnotationPrice(data.bars[data.bars.length - 1].c);
      }
    } catch (err) {
      // Demo fallback data
      const demoBar = (t: number) => ({ t, o: 175 + Math.random() * 5, h: 180 + Math.random() * 5, l: 170 + Math.random() * 5, c: 175 + Math.random() * 5, v: 1000000 + Math.random() * 5000000 });
      const demoBars = Array.from({ length: 100 }, (_, i) => demoBar(Date.now() - (100 - i) * 3600000));
      setBars(demoBars);
      setAnnotationPrice(demoBars[demoBars.length - 1].c);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchData(selectedSymbol);
    const interval = setInterval(() => {
      fetchData(selectedSymbol);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol, fetchData]);

  // Add annotation
  const addAnnotation = () => {
    if (!annotationPrice || !annotationText.trim()) {
      alert("Please fill in price and text");
      return;
    }

    const newAnnotation: Annotation = {
      id: Date.now().toString(),
      price: annotationPrice,
      text: annotationText,
      color: annotationColor,
      timestamp: Date.now(),
    };

    setAnnotations([...annotations, newAnnotation]);
    setAnnotationText("");
  };

  // Remove annotation
  const removeAnnotation = (id: string) => {
    setAnnotations(annotations.filter((a) => a.id !== id));
  };

  // Draw chart with annotations
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

    const minPrice = Math.min(...bars.map((b) => b.l));
    const maxPrice = Math.max(...bars.map((b) => b.h));
    const priceRange = maxPrice - minPrice || 1;

    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;
    const candleWidth = Math.max(2, chartWidth / bars.length - 1);

    // Draw candles
    bars.forEach((bar, idx) => {
      const x = padding + (idx * chartWidth) / bars.length;
      const highY = padding + ((maxPrice - bar.h) / priceRange) * chartHeight;
      const lowY = padding + ((maxPrice - bar.l) / priceRange) * chartHeight;
      const openY = padding + ((maxPrice - bar.o) / priceRange) * chartHeight;
      const closeY = padding + ((maxPrice - bar.c) / priceRange) * chartHeight;

      ctx.strokeStyle = bar.c >= bar.o ? "#10b981" : "#ef4444";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.abs(closeY - openY) || 1;
      ctx.fillStyle = bar.c >= bar.o ? "#10b981" : "#ef4444";
      ctx.fillRect(x, bodyTop, candleWidth, bodyHeight);
    });

    // Draw annotations
    annotations.forEach((ann) => {
      const y = padding + ((maxPrice - ann.price) / priceRange) * chartHeight;

      const colorMap: { [key: string]: string } = {
        emerald: "#10b981",
        red: "#ef4444",
        blue: "#3b82f6",
        yellow: "#eab308",
        purple: "#a855f7",
      };

      ctx.fillStyle = colorMap[ann.color] || "#10b981";
      ctx.beginPath();
      ctx.arc(padding, y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "12px sans-serif";
      ctx.fillText(ann.text.substring(0, 20), padding + 15, y + 4);
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
  }, [bars, annotations]);

  const colorOptions = [
    { value: "emerald", label: "Green", bg: "bg-emerald-400" },
    { value: "red", label: "Red", bg: "bg-red-400" },
    { value: "blue", label: "Blue", bg: "bg-blue-400" },
    { value: "yellow", label: "Yellow", bg: "bg-yellow-400" },
    { value: "purple", label: "Purple", bg: "bg-purple-400" },
  ];

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Chart Annotation Studio</h1>
        <span className="rounded bg-purple-400/15 px-2 py-1 font-mono text-xs text-purple-400">
          {annotations.length} notes
        </span>
      </header>

      {/* Symbol Selector */}
      <div className="flex gap-4 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-400 mb-1">Symbol</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => fetchData(selectedSymbol)}
          className="mt-6 rounded border border-emerald-400 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-400 hover:bg-emerald-400/20 h-fit"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Chart */}
          <div className="lg:col-span-3">
            <canvas
              ref={canvasRef}
              width={800}
              height={400}
              className="w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f]"
            />
          </div>

          {/* Annotation Panel */}
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 space-y-4 h-fit">
            <h3 className="text-lg font-semibold text-white">Add Annotation</h3>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Price Level</label>
              <input
                type="number"
                value={annotationPrice}
                onChange={(e) => setAnnotationPrice(parseFloat(e.target.value))}
                className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
                step="0.01"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Note Text</label>
              <textarea
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm h-20 resize-none"
                placeholder="Add your note..."
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Color</label>
              <div className="flex gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setAnnotationColor(color.value)}
                    className={`w-8 h-8 rounded-full ${color.bg} ${
                      annotationColor === color.value ? "ring-2 ring-white" : "opacity-60"
                    }`}
                    title={color.label}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={addAnnotation}
              className="w-full rounded border border-purple-400 bg-purple-400/10 px-4 py-2 text-sm font-semibold text-purple-400 hover:bg-purple-400/20"
            >
              Add Note
            </button>

            {/* Annotations List */}
            <div className="border-t border-[#1e1e2e] pt-4">
              <p className="text-xs text-gray-400 mb-3">Annotations ({annotations.length})</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {annotations.map((ann) => {
                  const colorBg: { [key: string]: string } = {
                    emerald: "bg-emerald-400/10 border-emerald-400/30",
                    red: "bg-red-400/10 border-red-400/30",
                    blue: "bg-blue-400/10 border-blue-400/30",
                    yellow: "bg-yellow-400/10 border-yellow-400/30",
                    purple: "bg-purple-400/10 border-purple-400/30",
                  };
                  return (
                    <div
                      key={ann.id}
                      className={`rounded p-2 border text-xs ${colorBg[ann.color] || "bg-emerald-400/10 border-emerald-400/30"}`}
                    >
                      <p className="font-semibold text-white truncate">${ann.price.toFixed(2)}</p>
                      <p className="text-gray-400 text-xs truncate">{ann.text}</p>
                      <button
                        onClick={() => removeAnnotation(ann.id)}
                        className="text-red-400 text-xs mt-1 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
