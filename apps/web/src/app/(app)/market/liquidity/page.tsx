"use client";
import { useState } from "react";
import { Droplet, Clock, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

interface LiquidityData {
  symbol: string;
  spread: number;
  depth: number;
  participation: number;
  tradabilityScore: number;
  session: string;
}

const mockLiquidity: LiquidityData[] = [
  { symbol: "AAPL", spread: 0.02, depth: 2.5, participation: 78, tradabilityScore: 95, session: "Regular" },
  { symbol: "NVDA", spread: 0.03, depth: 2.1, participation: 82, tradabilityScore: 92, session: "Regular" },
  { symbol: "MSFT", spread: 0.01, depth: 3.2, participation: 85, tradabilityScore: 98, session: "Regular" },
  { symbol: "TSLA", spread: 0.05, depth: 1.8, participation: 72, tradabilityScore: 84, session: "Regular" },
  { symbol: "BTC", spread: 2.5, depth: 1.2, participation: 68, tradabilityScore: 76, session: "Regular" },
  { symbol: "ETH", spread: 1.5, depth: 0.9, participation: 65, tradabilityScore: 72, session: "Regular" },
];

const heatmapData = [
  { session: "Pre-Market", times: [15, 28, 42, 55, 68] },
  { session: "Regular", times: [92, 95, 98, 97, 94] },
  { session: "After-Hours", times: [45, 38, 52, 48, 35] },
];

const timeSlots = ["09:30-10:30", "10:30-12:00", "12:00-15:00", "15:00-16:00", "AH"];

export default function LiquidityPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const getTradabilityColor = (score: number) => {
    if (score >= 90) return "bg-green-500/20 text-green-300 border-green-500/30";
    if (score >= 80) return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    if (score >= 70) return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    return "bg-red-500/20 text-red-300 border-red-500/30";
  };

  const getHeatmapColor = (value: number) => {
    if (value >= 85) return "bg-green-600";
    if (value >= 70) return "bg-green-500";
    if (value >= 55) return "bg-yellow-500";
    if (value >= 40) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Droplet className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Liquidity Environment</h1>
              <p className="text-slate-400 text-sm">Market depth, spreads, and tradability analysis</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-blue-300" />
              <span className="text-sm font-semibold text-blue-300">CURRENT SESSION</span>
            </div>
            <p className="text-2xl font-bold text-white">Regular Hours</p>
            <p className="text-xs text-blue-200 mt-2">09:30 AM - 04:00 PM</p>
          </div>
          <div className="bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/30 rounded-lg p-6">
            <p className="text-sm font-semibold text-green-300 mb-2">AVG SPREAD</p>
            <p className="text-2xl font-bold text-white">0.028%</p>
            <p className="text-xs text-green-200 mt-2">Tight liquidity conditions</p>
          </div>
          <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/20 border border-amber-500/30 rounded-lg p-6">
            <p className="text-sm font-semibold text-amber-300 mb-2">AVG PARTICIPATION</p>
            <p className="text-2xl font-bold text-white">75%</p>
            <p className="text-xs text-amber-200 mt-2">Healthy market participation</p>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Session Liquidity Heatmap
          </h2>

          <div className="overflow-x-auto">
            <div className="inline-block">
              <div className="flex gap-1 mb-1">
                <div className="w-28" />
                {timeSlots.map((slot) => (
                  <div key={slot} className="w-20 text-center text-xs font-bold text-slate-300 py-2">{slot}</div>
                ))}
              </div>

              {heatmapData.map((row, idx) => (
                <div key={idx} className="flex gap-1 mb-2">
                  <div className="w-28 text-xs font-bold text-slate-300 py-3 pr-2 text-right">{row.session}</div>
                  {row.times.map((value, timeIdx) => (
                    <div key={timeIdx} className={`w-20 h-12 rounded text-xs font-bold transition-all hover:opacity-80 text-white flex items-center justify-center ${getHeatmapColor(value)}`}>
                      {value}%
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6 mt-6 pt-6 border-t border-slate-700 flex-wrap">
            <span className="text-xs font-semibold text-slate-400">Liquidity:</span>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-red-500 rounded" /><span className="text-xs text-slate-400">Low</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-orange-500 rounded" /><span className="text-xs text-slate-400">Moderate</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-yellow-500 rounded" /><span className="text-xs text-slate-400">Good</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-green-500 rounded" /><span className="text-xs text-slate-400">High</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-green-600 rounded" /><span className="text-xs text-slate-400">Excellent</span></div>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700 bg-slate-800/30">
                <tr className="text-slate-400 text-xs uppercase font-semibold">
                  <th className="text-left py-4 px-6">Symbol</th>
                  <th className="text-center py-4 px-6">Bid-Ask Spread</th>
                  <th className="text-center py-4 px-6">Depth ($M)</th>
                  <th className="text-center py-4 px-6">Participation</th>
                  <th className="text-center py-4 px-6">Tradability Score</th>
                  <th className="text-center py-4 px-6">Action</th>
                </tr>
              </thead>
              <tbody>
                {mockLiquidity.map((liq, idx) => (
                  <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-6 font-bold text-white">{liq.symbol}</td>
                    <td className="py-4 px-6 text-center text-slate-300">{liq.spread.toFixed(3)}%</td>
                    <td className="py-4 px-6 text-center text-slate-300">${liq.depth.toFixed(1)}</td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-24 bg-slate-700 rounded-full h-2">
                          <div className="bg-gradient-to-r from-blue-500 to-blue-400 h-2 rounded-full" style={{ width: `${liq.participation}%` }} />
                        </div>
                        <span className="text-slate-300 font-semibold">{liq.participation}%</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex justify-center">
                        <span className={`px-3 py-1 rounded text-xs font-bold border ${getTradabilityColor(liq.tradabilityScore)}`}>
                          {liq.tradabilityScore}/100
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <button onClick={() => setSelectedSymbol(selectedSymbol === liq.symbol ? null : liq.symbol)} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-all">
                        {selectedSymbol === liq.symbol ? "Close" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selectedSymbol && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Detailed Liquidity Analysis: {selectedSymbol}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {mockLiquidity.filter((l) => l.symbol === selectedSymbol).map((liq) => (
                <div key={liq.symbol} className="space-y-4">
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Bid-Ask Spread</p>
                    <p className="text-2xl font-bold text-blue-400">{liq.spread.toFixed(3)}%</p>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Order Book Depth</p>
                    <p className="text-2xl font-bold text-cyan-400">${liq.depth.toFixed(1)}M</p>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Participation Rate</p>
                    <p className="text-2xl font-bold text-green-400">{liq.participation}%</p>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Tradability Score</p>
                    <p className="text-2xl font-bold text-amber-400">{liq.tradabilityScore}/100</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
