"use client";

import { useEffect, useState, useCallback } from "react";

interface LiquiditySweep {
  symbol: string;
  direction: "long" | "short";
  price: number;
  trappedSide: "bullish" | "bearish";
  outcome: "reversal" | "continuation";
  timestamp: number;
}

const SYMBOLS = ["AAPL", "TSLA", "MSFT", "NVDA", "AMD"];

export default function LiquiditySweepMapperPage() {
  const [sweeps, setSweeps] = useState<LiquiditySweep[]>([]);
  const [filterDirection, setFilterDirection] = useState<"all" | "long" | "short">("all");
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
      const allSweeps: LiquiditySweep[] = [];

      // Parse liquidity sweep data from signals
      if (data.signals && Array.isArray(data.signals)) {
        data.signals.forEach((signal: any) => {
          if (signal.sweeps && Array.isArray(signal.sweeps)) {
            signal.sweeps.forEach((sweep: any) => {
              allSweeps.push({
                symbol: signal.symbol || "N/A",
                direction: sweep.direction || "long",
                price: sweep.price || 0,
                trappedSide: sweep.trapped_side || "bullish",
                outcome: sweep.outcome || "reversal",
                timestamp: sweep.timestamp || Date.now(),
              });
            });
          }
        });
      }

      setSweeps(allSweeps);
      setError("");
    } catch (err) {
      setError("Failed to fetch sweep data");
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

  const filteredSweeps =
    filterDirection === "all"
      ? sweeps
      : sweeps.filter((s) => s.direction === filterDirection);

  const stats = {
    total: sweeps.length,
    longSweeps: sweeps.filter((s) => s.direction === "long").length,
    shortSweeps: sweeps.filter((s) => s.direction === "short").length,
    reversals: sweeps.filter((s) => s.outcome === "reversal").length,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Liquidity Sweep Mapper</h1>
        <div className="flex gap-2">
          <span className="rounded bg-cyan-400/15 px-2 py-1 font-mono text-xs text-cyan-400">
            {filteredSweeps.length} sweeps
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
            <p className="text-xs text-gray-400">Total Sweeps</p>
            <p className="text-2xl font-semibold text-cyan-400">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Long Sweeps</p>
            <p className="text-2xl font-semibold text-emerald-400">{stats.longSweeps}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Short Sweeps</p>
            <p className="text-2xl font-semibold text-red-400">{stats.shortSweeps}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-xs text-gray-400">Reversals</p>
            <p className="text-2xl font-semibold text-blue-400">{stats.reversals}</p>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <div className="flex gap-2 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
        <button
          onClick={() => setFilterDirection("all")}
          className={`px-4 py-2 text-sm rounded border ${
            filterDirection === "all"
              ? "border-emerald-400 bg-emerald-400/20 text-emerald-400"
              : "border-[#1e1e2e] text-gray-400 hover:text-white"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilterDirection("long")}
          className={`px-4 py-2 text-sm rounded border ${
            filterDirection === "long"
              ? "border-emerald-400 bg-emerald-400/20 text-emerald-400"
              : "border-[#1e1e2e] text-gray-400 hover:text-white"
          }`}
        >
          Long Sweeps
        </button>
        <button
          onClick={() => setFilterDirection("short")}
          className={`px-4 py-2 text-sm rounded border ${
            filterDirection === "short"
              ? "border-red-400 bg-red-400/20 text-red-400"
              : "border-[#1e1e2e] text-gray-400 hover:text-white"
          }`}
        >
          Short Sweeps
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
      ) : filteredSweeps.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                <th className="px-4 py-3 text-left text-sm text-gray-400">Symbol</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Direction</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Price</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Trapped Side</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Likely Outcome</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredSweeps.map((sweep, idx) => (
                <tr key={idx} className="border-b border-[#1e1e2e] hover:bg-[#1a1a2e]">
                  <td className="px-4 py-3 font-semibold text-white">{sweep.symbol}</td>
                  <td className={`px-4 py-3 font-semibold ${sweep.direction === "long" ? "text-emerald-400" : "text-red-400"}`}>
                    {sweep.direction === "long" ? "📈 Long" : "📉 Short"}
                  </td>
                  <td className="px-4 py-3 text-white">${sweep.price.toFixed(2)}</td>
                  <td className={`px-4 py-3 text-sm font-semibold ${
                    sweep.trappedSide === "bullish" ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {sweep.trappedSide === "bullish" ? "Bullish" : "Bearish"}
                  </td>
                  <td className={`px-4 py-3 text-sm rounded px-2 py-1 ${
                    sweep.outcome === "reversal"
                      ? "bg-blue-400/20 text-blue-400"
                      : "bg-purple-400/20 text-purple-400"
                  }`}>
                    {sweep.outcome === "reversal" ? "Reversal" : "Continuation"}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {new Date(sweep.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 text-center text-gray-400">
          No sweeps detected
        </div>
      )}
    </section>
  );
}
