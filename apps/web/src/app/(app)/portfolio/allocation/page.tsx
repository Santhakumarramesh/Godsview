"use client";
import { useState } from "react";
import { PieChart, TrendingUp, AlertCircle } from "lucide-react";

interface Strategy {
  name: string;
  targetAllocation: number;
  actualAllocation: number;
  capital: number;
  maxDrawdown: number;
  status: "aligned" | "overweight" | "underweight";
}

const mockStrategies: Strategy[] = [
  { name: "Mean Reversion", targetAllocation: 25, actualAllocation: 28, capital: 280000, maxDrawdown: -8.5, status: "overweight" },
  { name: "Trend Following", targetAllocation: 30, actualAllocation: 29, capital: 290000, maxDrawdown: -12.3, status: "aligned" },
  { name: "Volatility Arbitrage", targetAllocation: 20, actualAllocation: 18, capital: 180000, maxDrawdown: -5.2, status: "underweight" },
  { name: "Flow-Based Trading", targetAllocation: 15, actualAllocation: 16, capital: 160000, maxDrawdown: -6.8, status: "aligned" },
  { name: "Breakout Strategy", targetAllocation: 10, actualAllocation: 9, capital: 90000, maxDrawdown: -15.1, status: "underweight" },
];

const totalCapital = mockStrategies.reduce((sum, s) => sum + s.capital, 0);

export default function AllocationPage() {
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  const getStatusColor = (status: string) => {
    if (status === "aligned") return "bg-green-500/20 text-green-300 border-green-500/30";
    if (status === "overweight") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    return "bg-blue-500/20 text-blue-300 border-blue-500/30";
  };

  const getDifferenceColor = (diff: number) => {
    if (Math.abs(diff) < 1) return "text-slate-300";
    if (diff > 0) return "text-amber-400";
    return "text-blue-400";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <PieChart className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Allocation Engine</h1>
              <p className="text-slate-400 text-sm">Portfolio allocation and rebalancing</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Total Capital</p><p className="text-3xl font-bold text-white">${(totalCapital / 1000000).toFixed(1)}M</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Active Strategies</p><p className="text-3xl font-bold text-green-400">{mockStrategies.length}</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Avg Max Drawdown</p><p className="text-3xl font-bold text-red-400">{(mockStrategies.reduce((sum, s) => sum + s.maxDrawdown, 0) / mockStrategies.length).toFixed(1)}%</p></div>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Capital Distribution</h2>
          <div className="flex h-16 rounded-lg overflow-hidden border border-slate-600 mb-4">
            {mockStrategies.map((strategy) => (
              <button key={strategy.name} onClick={() => setSelectedStrategy(selectedStrategy === strategy.name ? null : strategy.name)} className="flex-1 hover:opacity-80 transition-opacity relative group cursor-pointer" style={{ backgroundColor: strategy.status === "aligned" ? "#10b98122" : strategy.status === "overweight" ? "#f5991622" : "#0ea5e922" }}>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
                  <span className="text-white text-xs font-semibold">{strategy.name}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-400">Each segment represents capital allocation (Width = % of Total)</div>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Target vs Actual Allocation
          </h2>

          <div className="space-y-6">
            {mockStrategies.map((strategy) => {
              const diff = strategy.actualAllocation - strategy.targetAllocation;
              return (
                <div key={strategy.name} className={`p-4 rounded-lg border transition-all cursor-pointer ${selectedStrategy === strategy.name ? "bg-slate-800/50 border-amber-500/30" : "bg-slate-800/20 border-slate-700 hover:border-slate-600"}`} onClick={() => setSelectedStrategy(selectedStrategy === strategy.name ? null : strategy.name)}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white mb-1">{strategy.name}</h3>
                      <div className="flex gap-4 text-sm">
                        <span className="text-slate-400">Target: <span className="text-white font-semibold">{strategy.targetAllocation}%</span></span>
                        <span className="text-slate-400">Actual: <span className="text-white font-semibold">{strategy.actualAllocation}%</span></span>
                        <span className={`font-semibold ${getDifferenceColor(diff)}`}>{diff > 0 ? "+" : ""}{diff}%</span>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded text-xs font-bold border ${getStatusColor(strategy.status)}`}>{strategy.status.toUpperCase()}</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-12">Target:</span>
                      <div className="flex-1 bg-slate-700 rounded h-2">
                        <div className="bg-gradient-to-r from-blue-500 to-blue-400 h-2 rounded" style={{ width: `${strategy.targetAllocation}%` }} />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-12">Actual:</span>
                      <div className="flex-1 bg-slate-700 rounded h-2">
                        <div className={`h-2 rounded ${strategy.status === "aligned" ? "bg-gradient-to-r from-green-500 to-green-400" : strategy.status === "overweight" ? "bg-gradient-to-r from-amber-500 to-amber-400" : "bg-gradient-to-r from-cyan-500 to-cyan-400"}`} style={{ width: `${strategy.actualAllocation}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedStrategy && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">{mockStrategies.find((s) => s.name === selectedStrategy)?.name} Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {mockStrategies.filter((s) => s.name === selectedStrategy).map((strategy) => (
                <div key={strategy.name} className="space-y-4">
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Capital Allocated</p><p className="text-2xl font-bold text-green-400">${(strategy.capital / 1000).toFixed(0)}K</p><p className="text-xs text-slate-400 mt-2">{((strategy.capital / totalCapital) * 100).toFixed(1)}% of total</p></div>
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Allocation Diff</p><p className={`text-2xl font-bold ${getDifferenceColor(strategy.actualAllocation - strategy.targetAllocation)}`}>{strategy.actualAllocation - strategy.targetAllocation > 0 ? "+" : ""}{(strategy.actualAllocation - strategy.targetAllocation).toFixed(1)}%</p></div>
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Max Drawdown</p><p className="text-2xl font-bold text-red-400">{strategy.maxDrawdown.toFixed(1)}%</p></div>
                  <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Status</p><p className={`text-sm font-bold ${getStatusColor(strategy.status).split(" ")[1]}`}>{strategy.status.toUpperCase()}</p></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-amber-300 mb-2">Rebalance Suggestion</h3>
              <p className="text-amber-100 text-sm mb-4">Portfolio is slightly overweight on Mean Reversion (+3%) and underweight on Breakout Strategy (-1%). Consider rebalancing to align with target allocations.</p>
              <div className="flex gap-3">
                <button className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded font-semibold transition-all">Rebalance Now</button>
                <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 rounded font-semibold transition-all">Dismiss</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
