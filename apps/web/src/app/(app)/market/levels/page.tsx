"use client";

import { useState, useEffect } from "react";
import { Activity, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface Level {
  id: string;
  symbol: string;
  price: number;
  type: "support" | "resistance";
  strength: number;
  touches: number;
  lastTested: string;
}

interface Levels {
  [symbol: string]: Level[];
}

const mockLevels: Levels = {
  AAPL: [
    { id: "1", symbol: "AAPL", price: 180.50, type: "support", strength: 92, touches: 5, lastTested: "2 hours ago" },
    { id: "2", symbol: "AAPL", price: 185.25, type: "resistance", strength: 88, touches: 4, lastTested: "45 min ago" },
    { id: "3", symbol: "AAPL", price: 190.00, type: "resistance", strength: 75, touches: 3, lastTested: "1 day ago" },
  ],
  MSFT: [
    { id: "4", symbol: "MSFT", price: 415.00, type: "support", strength: 85, touches: 4, lastTested: "30 min ago" },
    { id: "5", symbol: "MSFT", price: 425.50, type: "resistance", strength: 91, touches: 6, lastTested: "1 hour ago" },
  ],
  TSLA: [
    { id: "6", symbol: "TSLA", price: 240.00, type: "support", strength: 79, touches: 3, lastTested: "3 hours ago" },
    { id: "7", symbol: "TSLA", price: 255.75, type: "resistance", strength: 93, touches: 5, lastTested: "15 min ago" },
  ],
};

export default function MarketLevelsPage() {
  const [levels, setLevels] = useState<Levels>(mockLevels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  useEffect(() => {
    const fetchLevels = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.features.getLevels?.();
        if (result) {
          setLevels(result);
        }
      } catch (err) {
        console.error("Error fetching levels:", err);
        setError("Failed to fetch levels");
      } finally {
        setLoading(false);
      }
    };

    fetchLevels();
  }, []);

  const symbols = Object.keys(levels);
  const displaySymbol = selectedSymbol || symbols[0];
  const displayLevels = levels[displaySymbol] || [];

  const strengthColor = (strength: number) => {
    if (strength >= 90) return "bg-green-500/20 text-green-300";
    if (strength >= 75) return "bg-blue-500/20 text-blue-300";
    return "bg-amber-500/20 text-amber-300";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-cyan-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Support & Resistance Levels</h1>
              <p className="text-slate-400 text-sm">Technical price levels identified across tracked symbols</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading levels...</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 pb-4 border-b border-slate-700">
              {symbols.map((sym) => (
                <button
                  key={sym}
                  onClick={() => setSelectedSymbol(sym)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    displaySymbol === sym
                      ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/50"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">{displaySymbol} Levels</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-700">
                    <tr className="text-slate-400 text-xs uppercase font-semibold">
                      <th className="text-left py-3 px-4">Type</th>
                      <th className="text-right py-3 px-4">Price</th>
                      <th className="text-center py-3 px-4">Strength</th>
                      <th className="text-center py-3 px-4">Touches</th>
                      <th className="text-left py-3 px-4">Last Tested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayLevels.map((level) => (
                      <tr key={level.id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
                              level.type === "support"
                                ? "bg-green-500/20 text-green-300"
                                : "bg-red-500/20 text-red-300"
                            }`}
                          >
                            {level.type === "support" ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : (
                              <TrendingDown className="w-3 h-3" />
                            )}
                            {level.type.charAt(0).toUpperCase() + level.type.slice(1)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-white">${level.price.toFixed(2)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-slate-700 rounded h-2">
                              <div
                                className="bg-gradient-to-r from-cyan-400 to-blue-500 h-2 rounded"
                                style={{ width: `${level.strength}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold px-2 py-1 rounded ${strengthColor(level.strength)}`}>
                              {level.strength}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-white">{level.touches}</td>
                        <td className="py-3 px-4 text-slate-400">{level.lastTested}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {displayLevels.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <p>No levels identified for {displaySymbol}</p>
                </div>
              )}
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Price Ladder</h2>
              <div className="space-y-2">
                {displayLevels.sort((a, b) => b.price - a.price).map((level) => (
                  <div key={level.id} className="flex items-center gap-3">
                    <div className="w-20 text-right font-semibold text-white">${level.price.toFixed(2)}</div>
                    <div className="flex-1 relative h-8 bg-slate-800 rounded border border-slate-700">
                      <div
                        className={`absolute h-full rounded flex items-center px-2 text-xs font-semibold ${
                          level.type === "support"
                            ? "bg-green-500/30 text-green-300"
                            : "bg-red-500/30 text-red-300"
                        }`}
                        style={{ width: `${Math.max(5, level.strength)}%` }}
                      >
                        {level.type === "support" ? "S" : "R"}
                      </div>
                    </div>
                    <div className="w-16 text-right text-slate-400 text-sm">{level.strength}% strength</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
