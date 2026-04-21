"use client";

import { useState } from "react";
import { Search, TrendingUp, Clock, BarChart2, AlertCircle } from "lucide-react";

interface SimilarSetup {
  id: string;
  timestamp: string;
  symbol: string;
  outcome: "WIN" | "LOSS";
  pnl: number;
  pnlPct: number;
  similarity: number;
  confluenceFactors: string[];
  details: string;
}

const mockResults: SimilarSetup[] = [
  {
    id: "SETUP-001",
    timestamp: "2024-03-15 10:32:00",
    symbol: "AAPL",
    outcome: "WIN",
    pnl: 540,
    pnlPct: 2.14,
    similarity: 94,
    confluenceFactors: ["RSI 25-30", "Volume Spike +45%", "Above 200MA", "VIX < 20"],
    details: "Previous similar RSI bounce from oversold territory with strong volume confirmation",
  },
  {
    id: "SETUP-002",
    timestamp: "2024-03-08 14:15:00",
    symbol: "MSFT",
    outcome: "WIN",
    pnl: 380,
    pnlPct: 1.87,
    similarity: 89,
    confluenceFactors: ["MACD Crossover", "Support Level", "Volume Breakout", "Divergence"],
    details: "MACD bullish cross with hidden divergence on hourly chart",
  },
  {
    id: "SETUP-003",
    timestamp: "2024-02-28 09:45:00",
    symbol: "TSLA",
    outcome: "WIN",
    pnl: 625,
    pnlPct: 2.58,
    similarity: 87,
    confluenceFactors: ["Bollinger Mean Reversion", "Stochastic", "Volume", "Gap Fill"],
    details: "Strong gap fill with Bollinger Band mean reversion at support",
  },
  {
    id: "SETUP-004",
    timestamp: "2024-02-20 11:22:00",
    symbol: "NVDA",
    outcome: "LOSS",
    pnl: -420,
    pnlPct: -0.92,
    similarity: 84,
    confluenceFactors: ["RSI Overbought", "Resistance", "Low Volume", "Divergence"],
    details: "RSI mean reversion attempt failed at key resistance with poor volume",
  },
  {
    id: "SETUP-005",
    timestamp: "2024-02-12 13:58:00",
    symbol: "GOOG",
    outcome: "WIN",
    pnl: 310,
    pnlPct: 1.43,
    similarity: 81,
    confluenceFactors: ["Volume Breakout", "MA Stack", "Momentum", "News Catalyst"],
    details: "Breakout above 50/200MA with earnings-driven volume surge",
  },
];

export default function RecallEnginePage() {
  const [searchSymbol, setSearchSymbol] = useState("AAPL");
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedSetup, setExpandedSetup] = useState<string | null>(null);

  const handleSearch = () => {
    setHasSearched(true);
  };

  const winCount = mockResults.filter((r) => r.outcome === "WIN").length;
  const lossCount = mockResults.filter((r) => r.outcome === "LOSS").length;
  const winRate = ((winCount / mockResults.length) * 100).toFixed(1);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <BarChart2 className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Recall Engine</h1>
              <p className="text-slate-400 text-sm">Find historical setups similar to current market conditions</p>
            </div>
          </div>
        </div>

        {/* Search Panel */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Symbol</label>
              <input
                type="text"
                value={searchSymbol}
                onChange={(e) => setSearchSymbol(e.target.value.toUpperCase())}
                placeholder="e.g., AAPL, MSFT, SPY"
                className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:border-blue-400"
              />
              <p className="text-slate-500 text-xs mt-1">Find setups similar to the current {searchSymbol} setup</p>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSearch}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded flex items-center gap-2 transition-all"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
            </div>
          </div>
        </div>

        {hasSearched && (
          <>
            {/* Win/Loss Distribution */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-2">Total Similar Setups</p>
                <p className="text-3xl font-bold text-white">{mockResults.length}</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-2">Win Rate</p>
                <p className="text-3xl font-bold text-green-400">{winRate}%</p>
                <p className="text-slate-500 text-xs mt-1">{winCount}W / {lossCount}L</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-2">Avg Profit</p>
                <p className="text-3xl font-bold text-blue-400">$355</p>
                <p className="text-slate-500 text-xs mt-1">Per similar trade</p>
              </div>
            </div>

            {/* Results List */}
            <div className="space-y-3">
              {mockResults.map((setup) => (
                <div
                  key={setup.id}
                  className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-all cursor-pointer"
                  onClick={() => setExpandedSetup(expandedSetup === setup.id ? null : setup.id)}
                >
                  {/* Summary Row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex-shrink-0">
                        <span className="text-2xl font-bold text-white w-12">{setup.symbol}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-white">{setup.timestamp}</p>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              setup.outcome === "WIN"
                                ? "bg-green-500/20 text-green-300"
                                : "bg-red-500/20 text-red-300"
                            }`}
                          >
                            {setup.outcome}
                          </span>
                        </div>
                        <p className="text-slate-400 text-sm">{setup.details}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className={`text-2xl font-bold ${
                          setup.pnl >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        ${setup.pnl >= 0 ? "+" : ""}{setup.pnl}
                      </div>
                      <div
                        className={`text-sm font-semibold ${
                          setup.pnlPct >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {setup.pnlPct >= 0 ? "+" : ""}{setup.pnlPct}%
                      </div>
                      <div className="text-slate-400 text-xs mt-1">
                        <div className="flex items-center justify-end gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {setup.similarity}% Similar
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedSetup === setup.id && (
                    <div className="border-t border-slate-700 pt-4 mt-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-slate-400 text-xs font-medium uppercase mb-2">Confluence Factors</p>
                          <div className="flex flex-wrap gap-2">
                            {setup.confluenceFactors.map((factor, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-xs font-medium"
                              >
                                {factor}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-slate-400 text-xs font-medium uppercase mb-2">Setup ID</p>
                          <p className="font-mono text-white text-sm">{setup.id}</p>
                        </div>
                      </div>
                      <div className="mt-4 p-3 bg-slate-800/30 border border-slate-700 rounded text-sm text-slate-300">
                        <p>
                          <span className="font-semibold text-white">Context:</span> This historical setup shares
                          {setup.similarity}% similarity with current market conditions. The key confluence factors
                          were {setup.confluenceFactors.slice(0, 2).join(", ")}. Previous outcome provides
                          {setup.outcome === "WIN" ? " positive" : " cautionary"} guidance for trade management.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {!hasSearched && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-12 text-center">
            <Search className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Enter a symbol to find similar historical setups and their outcomes</p>
          </div>
        )}
      </div>
    </div>
  );
}
