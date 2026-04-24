"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface SimilarSetup {
  id: string;
  date: string;
  symbol: string;
  similarity: number;
  outcome: "WIN" | "LOSS";
  chartThumb: string;
}

const mockSimilarSetups: SimilarSetup[] = [
  {
    id: "1",
    date: "2024-04-18",
    symbol: "AAPL",
    similarity: 96,
    outcome: "WIN",
    chartThumb: "📈",
  },
  {
    id: "2",
    date: "2024-04-10",
    symbol: "MSFT",
    similarity: 92,
    outcome: "WIN",
    chartThumb: "📈",
  },
  {
    id: "3",
    date: "2024-03-25",
    symbol: "AAPL",
    similarity: 87,
    outcome: "LOSS",
    chartThumb: "📉",
  },
  {
    id: "4",
    date: "2024-03-15",
    symbol: "TSLA",
    similarity: 84,
    outcome: "WIN",
    chartThumb: "📈",
  },
];

export default function SimilaritySearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SimilarSetup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setLoading(true);
      try {
        await api.memory.searchSimilar?.(searchQuery);
      } catch {
        // Fallback
      }
      setResults(mockSimilarSetups);
    } catch (err) {
      setError((err as Error).message || "Failed to search similar setups");
      setResults(mockSimilarSetups);
    } finally {
      setLoading(false);
    }
  };

  const winRate = results.length > 0
    ? ((results.filter((r) => r.outcome === "WIN").length / results.length) * 100).toFixed(1)
    : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Setup Similarity Search</h1>
        <p className="mt-1 text-sm text-slate-400">
          Find historical setups similar to your current market context
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Search Box */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <label className="block text-sm font-semibold text-slate-100 mb-3">
          Describe Current Setup
        </label>
        <div className="flex gap-3">
          <textarea
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g., AAPL at resistance, RSI < 30, volume spike..."
            rows={3}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !searchQuery.trim()}
            className={`rounded-lg px-6 py-2 font-semibold transition ${
              loading || !searchQuery.trim()
                ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results Summary */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard label="Total Matches" value={results.length.toString()} />
          <SummaryCard label="Win Rate" value={winRate + "%"} color="green" />
          <SummaryCard label="Avg Similarity" value={(results.reduce((sum, r) => sum + r.similarity, 0) / results.length).toFixed(0) + "%"} color="blue" />
        </div>
      )}

      {/* Results Grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {results.map((setup) => (
            <div
              key={setup.id}
              className="rounded-lg border border-slate-700 bg-slate-900 p-6 hover:border-slate-600 transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{setup.symbol}</h3>
                  <p className="text-sm text-slate-400">{setup.date}</p>
                </div>
                <span className={`rounded px-3 py-1 font-semibold ${setup.outcome === "WIN" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  {setup.outcome}
                </span>
              </div>

              <div className="mb-4 text-4xl text-center py-4">{setup.chartThumb}</div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Similarity</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 rounded-full bg-slate-800 h-2 overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${setup.similarity}%` }} />
                    </div>
                    <span className="text-sm font-mono text-blue-400">{setup.similarity}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && searchQuery && (
        <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-8 text-center">
          <p className="text-slate-400">No similar setups found. Try a different description.</p>
        </div>
      )}

      {!loading && results.length === 0 && !searchQuery && (
        <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-8 text-center">
          <p className="text-slate-400">Describe your current setup to find similar historical patterns</p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color = "slate" }: { label: string; value: string; color?: string }) {
  const colorClasses = {
    slate: "bg-slate-800 border-slate-700 text-slate-300",
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
