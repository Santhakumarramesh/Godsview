"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Activity, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface RegimeData {
  symbol: string;
  currentRegime: "trending_up" | "trending_down" | "ranging" | "volatile";
  duration: string;
  confidence: number;
  previousRegime: "trending_up" | "trending_down" | "ranging" | "volatile";
  price: number;
  change: number;
}

const mockRegimes: RegimeData[] = [
  { symbol: "AAPL", currentRegime: "trending_up", duration: "12 hours", confidence: 87, previousRegime: "ranging", price: 182.45, change: 2.34 },
  { symbol: "NVDA", currentRegime: "trending_up", duration: "5 days", confidence: 92, previousRegime: "trending_up", price: 895.50, change: 5.67 },
  { symbol: "MSFT", currentRegime: "ranging", duration: "3 days", confidence: 74, previousRegime: "trending_down", price: 418.20, change: -1.23 },
  { symbol: "TSLA", currentRegime: "volatile", duration: "4 hours", confidence: 65, previousRegime: "trending_up", price: 242.18, change: -3.45 },
  { symbol: "GOOGL", currentRegime: "trending_down", duration: "2 days", confidence: 81, previousRegime: "ranging", price: 175.82, change: -4.56 },
  { symbol: "AMZN", currentRegime: "ranging", duration: "6 hours", confidence: 58, previousRegime: "volatile", price: 198.30, change: 0.56 },
];

const overallRegime = "trending_up";

export default function RegimesPage() {
  const [sortBy, setSortBy] = useState<"symbol" | "confidence" | "duration">("confidence");

  const getRegimeColor = (regime: string) => {
    const colors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
      trending_up: { bg: "bg-green-500/20 border-green-500/30", text: "text-green-300", icon: <TrendingUp className="w-5 h-5" /> },
      trending_down: { bg: "bg-red-500/20 border-red-500/30", text: "text-red-300", icon: <TrendingDown className="w-5 h-5" /> },
      ranging: { bg: "bg-yellow-500/20 border-yellow-500/30", text: "text-yellow-300", icon: <Activity className="w-5 h-5" /> },
      volatile: { bg: "bg-orange-500/20 border-orange-500/30", text: "text-orange-300", icon: <AlertCircle className="w-5 h-5" /> },
    };
    return colors[regime] || colors.ranging;
  };

  const formatRegimeName = (regime: string) => {
    return regime.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  };

  const sortedRegimes = [...mockRegimes].sort((a, b) => {
    if (sortBy === "confidence") return b.confidence - a.confidence;
    if (sortBy === "duration") {
      const durationMs = (regime: RegimeData) => {
        const parts = regime.duration.split(" ");
        const num = parseInt(parts[0]);
        const multipliers: Record<string, number> = { hours: 3600000, hour: 3600000, days: 86400000, day: 86400000 };
        return num * (multipliers[parts[1]] || 0);
      };
      return durationMs(b) - durationMs(a);
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const overallColor = getRegimeColor(overallRegime);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Regime Detection</h1>
              <p className="text-slate-400 text-sm">Market regime classification per symbol</p>
            </div>
          </div>
        </div>

        <div className={`border rounded-lg p-6 ${overallColor.bg}`}>
          <div className="flex items-center gap-3">
            {overallColor.icon}
            <div>
              <p className="text-sm font-semibold text-slate-400 uppercase">Overall Market Regime</p>
              <p className={`text-2xl font-bold ${overallColor.text}`}>{formatRegimeName(overallRegime)}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-slate-300">Sort By:</label>
          <div className="flex gap-2">
            {(["symbol", "confidence", "duration"] as const).map((opt) => (
              <button key={opt} onClick={() => setSortBy(opt)} className={`px-4 py-2 rounded text-sm font-semibold transition-all ${sortBy === opt ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-slate-800 text-slate-300 border border-slate-600 hover:border-slate-500"}`}>
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700 bg-slate-800/30">
                <tr className="text-slate-400 text-xs uppercase font-semibold">
                  <th className="text-left py-4 px-6">Symbol</th>
                  <th className="text-left py-4 px-6">Current Regime</th>
                  <th className="text-left py-4 px-6">Duration</th>
                  <th className="text-center py-4 px-6">Confidence</th>
                  <th className="text-left py-4 px-6">Previous Regime</th>
                  <th className="text-right py-4 px-6">Price</th>
                  <th className="text-right py-4 px-6">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedRegimes.map((regime, idx) => {
                  const current = getRegimeColor(regime.currentRegime);
                  const previous = getRegimeColor(regime.previousRegime);
                  return (
                    <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-6"><span className="font-bold text-white">{regime.symbol}</span></td>
                      <td className="py-4 px-6">
                        <div className={`flex items-center gap-2 w-fit px-3 py-1 rounded border ${current.bg}`}>
                          {current.icon}
                          <span className={`text-xs font-semibold ${current.text}`}>{formatRegimeName(regime.currentRegime)}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-slate-300">{regime.duration}</td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <div className="w-32 bg-slate-700 rounded-full h-2">
                            <div className="bg-gradient-to-r from-amber-500 to-amber-400 h-2 rounded-full" style={{ width: `${regime.confidence}%` }} />
                          </div>
                          <span className="text-white font-semibold">{regime.confidence}%</span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className={`w-fit px-2 py-1 rounded text-xs font-semibold border ${previous.bg} ${previous.text}`}>
                          {formatRegimeName(regime.previousRegime)}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right text-white font-semibold">${regime.price.toFixed(2)}</td>
                      <td className={`py-4 px-6 text-right font-semibold ${regime.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {regime.change >= 0 ? "+" : ""}{regime.change}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["trending_up", "trending_down", "ranging", "volatile"] as const).map((regime) => {
            const color = getRegimeColor(regime);
            return (
              <div key={regime} className={`flex items-center gap-3 p-4 rounded border ${color.bg}`}>
                {color.icon}
                <div>
                  <p className={`text-sm font-semibold ${color.text}`}>{formatRegimeName(regime)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
