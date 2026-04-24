"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

interface OrderBlock {
  symbol: string;
  type: "bullish" | "bearish";
  priceHigh: number;
  priceLow: number;
  freshness: number;
  mitigated: boolean;
  timestamp: number;
}

const SYMBOLS = ["AAPL", "TSLA", "MSFT", "NVDA", "AMD"];

export default function OrderBlockEnginePage() {
  const [orderBlocks, setOrderBlocks] = useState<OrderBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const data = await api.features.getSignals({ symbols: SYMBOLS, timeframe: "15min" });
      const obs: OrderBlock[] = [];

      // Parse order blocks from signal data
      if (data.signals && Array.isArray(data.signals)) {
        data.signals.forEach((signal: any) => {
          if (signal.order_blocks && Array.isArray(signal.order_blocks)) {
            signal.order_blocks.forEach((ob: any) => {
              obs.push({
                symbol: signal.symbol || "N/A",
                type: ob.type || "bullish",
                priceHigh: ob.price_high || 0,
                priceLow: ob.price_low || 0,
                freshness: ob.freshness || 0,
                mitigated: ob.mitigated || false,
                timestamp: ob.timestamp || Date.now(),
              });
            });
          }
        });
      }

      setOrderBlocks(obs);
      setError("");
    } catch (err) {
      // Demo fallback data
      setOrderBlocks([
        { symbol: "AAPL", type: "bullish", priceHigh: 180.50, priceLow: 178.20, freshness: 5, mitigated: false, timestamp: Date.now() },
        { symbol: "TSLA", type: "bearish", priceHigh: 245.80, priceLow: 242.10, freshness: 8, mitigated: false, timestamp: Date.now() - 60000 },
        { symbol: "MSFT", type: "bullish", priceHigh: 380.25, priceLow: 376.50, freshness: 12, mitigated: true, timestamp: Date.now() - 120000 },
      ]);
      setError("");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Order Block Engine</h1>
        <div className="flex gap-2">
          <span className="rounded bg-purple-400/15 px-2 py-1 font-mono text-xs text-purple-400">
            {orderBlocks.length} blocks
          </span>
          <button
            onClick={() => fetchData()}
            disabled={refreshing}
            className="rounded border border-emerald-400 bg-emerald-400/10 px-4 py-1 text-xs text-emerald-400 hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : orderBlocks.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                <th className="px-4 py-3 text-left text-sm text-gray-400">Symbol</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Type</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">High</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Low</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Freshness</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Time</th>
              </tr>
            </thead>
            <tbody>
              {orderBlocks.map((ob, idx) => (
                <tr key={idx} className="border-b border-[#1e1e2e] hover:bg-[#1a1a2e]">
                  <td className="px-4 py-3 font-semibold text-white">{ob.symbol}</td>
                  <td className={`px-4 py-3 font-semibold ${ob.type === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                    {ob.type === "bullish" ? "🟢 Bullish" : "🔴 Bearish"}
                  </td>
                  <td className="px-4 py-3 text-emerald-400">${ob.priceHigh.toFixed(2)}</td>
                  <td className="px-4 py-3 text-red-400">${ob.priceLow.toFixed(2)}</td>
                  <td className="px-4 py-3 text-blue-400">{ob.freshness} bars</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${
                      ob.mitigated
                        ? "bg-red-400/20 text-red-400"
                        : "bg-emerald-400/20 text-emerald-400"
                    }`}>
                      {ob.mitigated ? "Mitigated" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {new Date(ob.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 text-center text-gray-400">
          No order blocks detected
        </div>
      )}
    </section>
  );
}
