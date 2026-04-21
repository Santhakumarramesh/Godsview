"use client";

import { useEffect, useState, useCallback } from "react";

interface ZoneData {
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  premiumHigh: number;
  premiumLow: number;
  discountHigh: number;
  discountLow: number;
  currentPrice: number;
  position: "premium" | "discount" | "equilibrium";
}

export default function PremiumDiscountMapPage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AAPL");
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Fetch symbols
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

  // Fetch and compute zone data
  const fetchData = useCallback(async (symbol: string) => {
    setLoading(true);
    setError("");
    try {
      const [barsRes, quoteRes] = await Promise.all([
        fetch(`/api/market/bars/${symbol}?timeframe=1d&limit=50`),
        fetch(`/api/market/quote/${symbol}`),
      ]);

      if (!barsRes.ok || !quoteRes.ok) throw new Error("API fetch failed");

      const barsData = await barsRes.json();
      const quoteData = await quoteRes.json();
      const bars = barsData.bars || [];

      if (bars.length === 0) throw new Error("No bars data");

      const highs = bars.map((b: any) => b.h);
      const lows = bars.map((b: any) => b.l);
      const swingHigh = Math.max(...highs);
      const swingLow = Math.min(...lows);
      const equilibrium = (swingHigh + swingLow) / 2;
      const currentPrice = quoteData.price || bars[bars.length - 1].c;

      // 50% retracement
      const midpoint = (swingHigh + swingLow) / 2;
      const premiumHigh = swingHigh;
      const premiumLow = midpoint;
      const discountHigh = midpoint;
      const discountLow = swingLow;

      let position: "premium" | "discount" | "equilibrium" = "equilibrium";
      if (currentPrice > premiumLow) position = "premium";
      else if (currentPrice < discountHigh) position = "discount";

      setZoneData({
        swingHigh,
        swingLow,
        equilibrium,
        premiumHigh,
        premiumLow,
        discountHigh,
        discountLow,
        currentPrice,
        position,
      });
    } catch (err) {
      setError("Failed to compute zone data");
      console.error(err);
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

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Premium / Discount Map</h1>
        <span className="rounded bg-yellow-400/15 px-2 py-1 font-mono text-xs text-yellow-400">
          zones
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

      {/* Content */}
      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : zoneData ? (
        <div className="space-y-6">
          {/* Zone Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
              <p className="text-xs text-gray-400 mb-2">Swing High</p>
              <p className="text-2xl font-semibold text-emerald-400">${zoneData.swingHigh.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
              <p className="text-xs text-gray-400 mb-2">Equilibrium (50%)</p>
              <p className="text-2xl font-semibold text-yellow-400">${zoneData.equilibrium.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
              <p className="text-xs text-gray-400 mb-2">Swing Low</p>
              <p className="text-2xl font-semibold text-red-400">${zoneData.swingLow.toFixed(2)}</p>
            </div>
          </div>

          {/* Current Position */}
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400 mb-2">Current Price</p>
            <p className="text-3xl font-semibold text-white mb-3">${zoneData.currentPrice.toFixed(2)}</p>
            <div className="px-2 py-1 rounded text-sm font-semibold inline-block" style={{
              backgroundColor: zoneData.position === "premium" ? "rgba(16, 185, 129, 0.2)" : zoneData.position === "discount" ? "rgba(239, 68, 68, 0.2)" : "rgba(234, 179, 8, 0.2)",
              color: zoneData.position === "premium" ? "#10b981" : zoneData.position === "discount" ? "#ef4444" : "#eab308",
            }}>
              {zoneData.position === "premium" ? "📈 In Premium Zone" : zoneData.position === "discount" ? "📉 In Discount Zone" : "➡️ At Equilibrium"}
            </div>
          </div>

          {/* Visual Zone Map */}
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <p className="text-sm text-gray-400 mb-4">Zone Visualization</p>
            <div className="space-y-2">
              {/* Premium Zone */}
              <div className="rounded p-3 bg-emerald-400/20 border border-emerald-400/30">
                <p className="text-xs text-emerald-400 font-semibold mb-1">PREMIUM ZONE</p>
                <p className="text-sm text-white">${zoneData.premiumLow.toFixed(2)} - ${zoneData.premiumHigh.toFixed(2)}</p>
              </div>

              {/* Current Price Indicator */}
              <div className={`rounded p-3 border-2 ${
                zoneData.position === "premium"
                  ? "bg-emerald-400/30 border-emerald-400"
                  : zoneData.position === "discount"
                  ? "bg-red-400/30 border-red-400"
                  : "bg-yellow-400/30 border-yellow-400"
              }`}>
                <p className="text-sm font-semibold text-white">
                  Current: ${zoneData.currentPrice.toFixed(2)}
                </p>
              </div>

              {/* Discount Zone */}
              <div className="rounded p-3 bg-red-400/20 border border-red-400/30">
                <p className="text-xs text-red-400 font-semibold mb-1">DISCOUNT ZONE</p>
                <p className="text-sm text-white">${zoneData.discountLow.toFixed(2)} - ${zoneData.discountHigh.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Zone Details Table */}
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-4 py-3 text-left text-sm text-gray-400">Zone</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-400">High</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-400">Low</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-400">Range</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#1e1e2e] hover:bg-[#1a1a2e]">
                  <td className="px-4 py-3 font-semibold text-emerald-400">Premium</td>
                  <td className="px-4 py-3 text-white">${zoneData.premiumHigh.toFixed(2)}</td>
                  <td className="px-4 py-3 text-white">${zoneData.premiumLow.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-400">${(zoneData.premiumHigh - zoneData.premiumLow).toFixed(2)}</td>
                </tr>
                <tr className="border-b border-[#1e1e2e] hover:bg-[#1a1a2e]">
                  <td className="px-4 py-3 font-semibold text-yellow-400">Equilibrium</td>
                  <td className="px-4 py-3 text-white">${zoneData.equilibrium.toFixed(2)}</td>
                  <td className="px-4 py-3 text-white">${zoneData.equilibrium.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-400">-</td>
                </tr>
                <tr className="hover:bg-[#1a1a2e]">
                  <td className="px-4 py-3 font-semibold text-red-400">Discount</td>
                  <td className="px-4 py-3 text-white">${zoneData.discountHigh.toFixed(2)}</td>
                  <td className="px-4 py-3 text-white">${zoneData.discountLow.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-400">${(zoneData.discountHigh - zoneData.discountLow).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
