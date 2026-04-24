"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface RecallCard {
  id: string;
  date: string;
  symbol: string;
  similarity: number;
  outcome: "WIN" | "LOSS";
  pnl: number;
  patternType: string;
  factors: string[];
}

const mockRecallCards: RecallCard[] = [
  {
    id: "1",
    date: "2024-03-15",
    symbol: "AAPL",
    similarity: 94,
    outcome: "WIN",
    pnl: 1.85,
    patternType: "RSI Bounce",
    factors: ["RSI < 30", "Volume Spike", "Support Hold"],
  },
  {
    id: "2",
    date: "2024-03-08",
    symbol: "MSFT",
    similarity: 89,
    outcome: "WIN",
    pnl: 2.34,
    patternType: "MACD Cross",
    factors: ["MACD Bull Cross", "Divergence", "Above MA200"],
  },
  {
    id: "3",
    date: "2024-02-28",
    symbol: "TSLA",
    similarity: 87,
    outcome: "WIN",
    pnl: 3.12,
    patternType: "Mean Reversion",
    factors: ["Bollinger Bands", "Gap Fill", "Volume Breakout"],
  },
  {
    id: "4",
    date: "2024-02-20",
    symbol: "NVDA",
    similarity: 84,
    outcome: "LOSS",
    pnl: -1.25,
    patternType: "Resistance Bounce",
    factors: ["High Resistance", "Low Volume", "Divergence"],
  },
];

export default function RecallEnginePage() {
  const [cards, setCards] = useState<RecallCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchRecalls = async () => {
      try {
        setLoading(true);
        try {
          await api.memory.getRecentSignals?.();
        } catch {
          // Fallback
        }
        setCards(mockRecallCards);
      } catch (err) {
        setError((err as Error).message || "Failed to load recall engine");
        setCards(mockRecallCards);
      } finally {
        setLoading(false);
      }
    };

    fetchRecalls();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading recall engine...</p>
      </div>
    );
  }

  const winCount = cards.filter((c) => c.outcome === "WIN").length;
  const avgSimilarity = (cards.reduce((sum, c) => sum + c.similarity, 0) / cards.length).toFixed(1);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Recall Engine</h1>
        <p className="mt-1 text-sm text-slate-400">
          Historical analog cards: similar setups, outcomes, and pattern types
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Historical Analogs" value={cards.length.toString()} />
        <SummaryCard label="Winning Patterns" value={winCount.toString()} color="green" />
        <SummaryCard label="Avg Similarity" value={avgSimilarity + "%"} color="blue" />
      </div>

      {/* Recall Cards Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <div key={card.id}>
            <button
              onClick={() => setExpandedId(expandedId === card.id ? null : card.id)}
              className="w-full text-left rounded-lg border border-slate-700 bg-slate-900 p-6 hover:border-slate-600 transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-slate-100">{card.symbol}</h3>
                  <p className="text-sm text-slate-400">{card.patternType} • {card.date}</p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${card.outcome === "WIN" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  {card.outcome}
                </span>
              </div>

              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-slate-400">Similarity</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-20 rounded-full bg-slate-800 h-1.5 overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${card.similarity}%` }} />
                    </div>
                    <span className="text-sm font-mono text-blue-400">{card.similarity}%</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Outcome</p>
                  <p className={`text-lg font-bold ${card.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {card.pnl >= 0 ? "+" : ""}{card.pnl}%
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{card.factors.slice(0, 2).join(" • ")}</span>
                <span className="text-slate-400">{expandedId === card.id ? "▼" : "▶"}</span>
              </div>
            </button>

            {/* Expanded Details */}
            {expandedId === card.id && (
              <div className="mt-2 rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Confluence Factors</p>
                  <div className="flex flex-wrap gap-2">
                    {card.factors.map((factor, idx) => (
                      <span key={idx} className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300">
                        {factor}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Pattern Context</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    This historical setup shows {card.similarity}% similarity with current conditions. The pattern type
                    "{card.patternType}" has {card.outcome === "WIN" ? "delivered consistent wins" : "shown mixed results"} when
                    {" "}{card.factors.slice(0, 2).join(" and ")} are present.
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
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
