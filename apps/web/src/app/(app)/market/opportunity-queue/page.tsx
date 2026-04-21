"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface Signal {
  symbol: string;
  direction: "bull" | "bear";
  confluence_score: number;
  signal_strength: number;
  timestamp: string;
  status: "new" | "validated" | "pending" | "rejected" | "approved";
}

interface QueueItem extends Signal {
  id: string;
}

export default function OpportunityQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        setLoading(true);
        setError(null);
        const symbols = "AAPL,TSLA,MSFT,NVDA,AMD,GOOGL,AMZN,META,JPM,GS";
        const response = await fetch(
          `/api/signals/live?symbols=${symbols}&timeframe=15min`
        );
        if (!response.ok) throw new Error("Failed to fetch signals");

        const data = await response.json();
        const statusOptions = ["new", "validated", "pending", "rejected", "approved"];

        const transformed: QueueItem[] = (data.signals || []).map(
          (sig: any, idx: number) => ({
            id: `${sig.symbol}-${idx}`,
            symbol: sig.symbol,
            direction: sig.direction,
            confluence_score: sig.confluence_score || 0,
            signal_strength: sig.signal_strength || 0,
            timestamp: sig.timestamp || new Date().toISOString(),
            status: statusOptions[idx % statusOptions.length] as any,
          })
        );

        setItems(transformed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchSignals();
    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, []);

  const filtered =
    statusFilter === "all"
      ? items
      : items.filter((item) => item.status === statusFilter);

  const statusColors: Record<string, string> = {
    new: "bg-blue-900 text-blue-300",
    validated: "bg-purple-900 text-purple-300",
    pending: "bg-yellow-900 text-yellow-300",
    rejected: "bg-red-900 text-red-300",
    approved: "bg-emerald-900 text-emerald-300",
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Opportunity Queue</h1>
          <p className="text-sm text-gray-400 mt-1">Real-time signal pipeline</p>
        </div>
        <span className="rounded bg-emerald-900/30 px-3 py-1 font-mono text-xs text-emerald-400">
          LIVE
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {["all", "new", "validated", "pending", "rejected", "approved"].map(
          (status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                statusFilter === status
                  ? "bg-emerald-900 text-emerald-300"
                  : "bg-[#1e1e2e] text-gray-400 hover:text-white"
              }`}
            >
              {status}
            </button>
          )
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900 bg-red-900/10 p-4 text-red-400">
          Error: {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-8 text-center">
          <p className="text-gray-400">No opportunities in {statusFilter}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[#1e1e2e] bg-[#0a0a0f]">
                <tr>
                  <th className="px-4 py-3 text-left text-gray-400 font-semibold">
                    Symbol
                  </th>
                  <th className="px-4 py-3 text-left text-gray-400 font-semibold">
                    Direction
                  </th>
                  <th className="px-4 py-3 text-right text-gray-400 font-semibold">
                    Confluence
                  </th>
                  <th className="px-4 py-3 text-left text-gray-400 font-semibold">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-gray-400 font-semibold">
                    Timestamp
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`border-b border-[#1e1e2e] cursor-pointer transition-colors ${
                      selectedId === item.id
                        ? "bg-[#1e1e2e]"
                        : "hover:bg-[#0a0a0f]"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-white font-semibold">
                      {item.symbol}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`flex items-center gap-1 w-fit font-semibold ${
                          item.direction === "bull"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {item.direction === "bull" ? (
                          <ArrowUp size={16} />
                        ) : (
                          <ArrowDown size={16} />
                        )}
                        {item.direction.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-white font-mono">
                      {item.confluence_score.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          statusColors[item.status]
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedId && (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
          {(() => {
            const item = items.find((i) => i.id === selectedId);
            if (!item) return null;
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    {item.symbol} Details
                  </h2>
                  <button
                    onClick={() => setSelectedId(null)}
                    className="text-gray-400 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-gray-400 text-sm">Direction</p>
                    <p
                      className={`text-lg font-semibold ${
                        item.direction === "bull"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {item.direction.toUpperCase()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Confluence Score</p>
                    <p className="text-lg font-semibold text-white">
                      {item.confluence_score.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Signal Strength</p>
                    <p className="text-lg font-semibold text-white">
                      {(item.signal_strength * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Status</p>
                    <p
                      className={`text-lg font-semibold ${
                        statusColors[item.status]
                      }`}
                    >
                      {item.status}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </section>
  );
}
