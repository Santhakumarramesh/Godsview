"use client";

import { useEffect, useState, useCallback } from "react";

interface StructureEvent {
  symbol: string;
  type: "BOS" | "CHOCH";
  direction: "bullish" | "bearish";
  priceLevel: number;
  timeframe: string;
  timestamp: number;
}

const SYMBOLS = ["AAPL", "TSLA", "MSFT", "NVDA", "AMD"];

export default function BOSCHOCHEnginePage() {
  const [events, setEvents] = useState<StructureEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch(
        `/api/signals/live?symbols=${SYMBOLS.join(",")}&timeframe=15min`
      );
      if (!res.ok) throw new Error("Failed to fetch signals");

      const data = await res.json();
      const structureEvents: StructureEvent[] = [];

      // Parse BOS/CHOCH events from signal data
      if (data.signals && Array.isArray(data.signals)) {
        data.signals.forEach((signal: any) => {
          if (signal.structure && Array.isArray(signal.structure)) {
            signal.structure.forEach((evt: any) => {
              structureEvents.push({
                symbol: signal.symbol || "N/A",
                type: evt.type === "choch" ? "CHOCH" : "BOS",
                direction: evt.direction || "bullish",
                priceLevel: evt.price_level || 0,
                timeframe: evt.timeframe || "15min",
                timestamp: evt.timestamp || Date.now(),
              });
            });
          }
        });
      }

      setEvents(structureEvents);
      setError("");
    } catch (err) {
      setError("Failed to fetch BOS/CHOCH data");
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const stats = {
    totalBOS: events.filter((e) => e.type === "BOS").length,
    totalCHOCH: events.filter((e) => e.type === "CHOCH").length,
    bullishPct:
      events.length > 0
        ? Math.round((events.filter((e) => e.direction === "bullish").length / events.length) * 100)
        : 0,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">BOS / CHOCH Engine</h1>
        <div className="flex gap-2">
          <span className="rounded bg-blue-400/15 px-2 py-1 font-mono text-xs text-blue-400">
            {events.length} events
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

      {/* Summary Stats */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Total BOS</p>
            <p className="text-2xl font-semibold text-blue-400">{stats.totalBOS}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Total CHOCH</p>
            <p className="text-2xl font-semibold text-purple-400">{stats.totalCHOCH}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Bullish %</p>
            <p className="text-2xl font-semibold text-emerald-400">{stats.bullishPct}%</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Bearish %</p>
            <p className="text-2xl font-semibold text-red-400">{100 - stats.bullishPct}%</p>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : events.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                <th className="px-4 py-3 text-left text-sm text-gray-400">Symbol</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Type</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Direction</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Price Level</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Timeframe</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt, idx) => (
                <tr key={idx} className="border-b border-[#1e1e2e] hover:bg-[#1a1a2e]">
                  <td className="px-4 py-3 font-semibold text-white">{evt.symbol}</td>
                  <td className={`px-4 py-3 font-semibold ${evt.type === "BOS" ? "text-blue-400" : "text-purple-400"}`}>
                    {evt.type}
                  </td>
                  <td className={`px-4 py-3 font-semibold ${evt.direction === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                    {evt.direction === "bullish" ? "🟢 Bullish" : "🔴 Bearish"}
                  </td>
                  <td className="px-4 py-3 text-white">${evt.priceLevel.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-400">{evt.timeframe}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 text-center text-gray-400">
          No BOS/CHOCH events detected
        </div>
      )}
    </section>
  );
}
