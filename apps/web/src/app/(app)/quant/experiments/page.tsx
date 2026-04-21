"use client";
import { useState } from "react";
import { Beaker, Play, CheckCircle, XCircle, ChevronDown, ChevronUp, Plus } from "lucide-react";

interface Experiment {
  id: string;
  name: string;
  strategy: string;
  parameters: Record<string, string>;
  status: "running" | "completed" | "failed";
  bestResult: number;
  results: { metric: string; value: number }[];
  startedAt: string;
  completedAt?: string;
}

const mockExperiments: Experiment[] = [
  { id: "1", name: "RSI Optimization v1", strategy: "RSI Mean Reversion", parameters: { rsiPeriod: "14", overbought: "70", oversold: "30", riskPercent: "2" }, status: "completed", bestResult: 2.34, results: [{ metric: "Win Rate", value: 62.5 }, { metric: "Profit Factor", value: 2.34 }, { metric: "Sharpe Ratio", value: 1.87 }, { metric: "Max Drawdown", value: -8.3 }], startedAt: "2024-04-15 09:00", completedAt: "2024-04-15 14:30" },
  { id: "2", name: "Volume Breakout Grid", strategy: "Volume Breakout", parameters: { volumeMultiplier: "2.5", lookbackPeriod: "20", stopLoss: "2", takeProfit: "5" }, status: "completed", bestResult: 1.98, results: [{ metric: "Win Rate", value: 58.3 }, { metric: "Profit Factor", value: 1.98 }, { metric: "Sharpe Ratio", value: 1.45 }, { metric: "Max Drawdown", value: -12.1 }], startedAt: "2024-04-14 10:00", completedAt: "2024-04-14 18:45" },
  { id: "3", name: "MACD Cross Tuning", strategy: "MACD Cross", parameters: { fastEMA: "12", slowEMA: "26", signalLine: "9", timeframe: "15min" }, status: "running", bestResult: 1.67, results: [{ metric: "Win Rate", value: 55.2 }, { metric: "Profit Factor", value: 1.67 }, { metric: "Sharpe Ratio", value: 1.12 }, { metric: "Max Drawdown", value: -15.8 }], startedAt: "2024-04-20 08:30" },
  { id: "4", name: "Bollinger Bands Sweep", strategy: "Bollinger Bands", parameters: { period: "20", stdDev: "2", riskReward: "1.5", position: "1" }, status: "failed", bestResult: 0.45, results: [{ metric: "Win Rate", value: 42.1 }, { metric: "Profit Factor", value: 0.45 }, { metric: "Sharpe Ratio", value: -0.25 }, { metric: "Max Drawdown", value: -28.5 }], startedAt: "2024-04-19 11:00", completedAt: "2024-04-19 15:20" },
  { id: "5", name: "Ichimoku Signals v2", strategy: "Ichimoku Signals", parameters: { tenkan: "9", kijun: "26", senkou: "52", chikou: "26" }, status: "completed", bestResult: 2.12, results: [{ metric: "Win Rate", value: 60.8 }, { metric: "Profit Factor", value: 2.12 }, { metric: "Sharpe Ratio", value: 1.56 }, { metric: "Max Drawdown", value: -10.2 }], startedAt: "2024-04-18 07:00", completedAt: "2024-04-18 22:15" },
];

export default function ExperimentsPage() {
  const [experiments] = useState<Experiment[]>(mockExperiments);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "status" | "performance">("date");

  const getStatusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="w-5 h-5 text-green-400" />;
    if (status === "running") return <Play className="w-5 h-5 text-blue-400 animate-pulse" />;
    return <XCircle className="w-5 h-5 text-red-400" />;
  };

  const getStatusColor = (status: string) => {
    if (status === "completed") return "bg-green-500/20 text-green-300 border-green-500/30";
    if (status === "running") return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    return "bg-red-500/20 text-red-300 border-red-500/30";
  };

  const sortedExperiments = [...experiments].sort((a, b) => {
    if (sortBy === "status") return { running: 0, completed: 1, failed: 2 }[a.status as any] - { running: 0, completed: 1, failed: 2 }[b.status as any];
    if (sortBy === "performance") return b.bestResult - a.bestResult;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Beaker className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Experiment Tracker</h1>
              <p className="text-slate-400 text-sm">Strategy parameter optimization and backtesting</p>
            </div>
          </div>
          <button className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded flex items-center gap-2 transition-all">
            <Plus className="w-4 h-4" />
            New Experiment
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Total</p><p className="text-2xl font-bold text-white">{experiments.length}</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Completed</p><p className="text-2xl font-bold text-green-400">{experiments.filter(e => e.status === "completed").length}</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Running</p><p className="text-2xl font-bold text-blue-400">{experiments.filter(e => e.status === "running").length}</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Best PF</p><p className="text-2xl font-bold text-amber-400">{Math.max(...experiments.map(e => e.bestResult)).toFixed(2)}</p></div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-slate-300">Sort By:</label>
          <div className="flex gap-2">
            {(["date", "status", "performance"] as const).map((opt) => (
              <button key={opt} onClick={() => setSortBy(opt)} className={`px-4 py-2 rounded text-sm font-semibold transition-all ${sortBy === opt ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-slate-800 text-slate-300 border border-slate-600 hover:border-slate-500"}`}>
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {sortedExperiments.map((exp) => (
            <div key={exp.id} className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden hover:border-slate-600 transition-all">
              <button onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-slate-800/30 transition-colors">
                <div>{getStatusIcon(exp.status)}</div>
                <div className="flex-1 text-left">
                  <h3 className="text-lg font-semibold text-white">{exp.name}</h3>
                  <p className="text-sm text-slate-400">{exp.strategy}</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-slate-400 mb-1">{exp.startedAt}</div>
                  <span className={`px-3 py-1 rounded text-xs font-semibold border ${getStatusColor(exp.status)}`}>{exp.status.toUpperCase()}</span>
                </div>
                <div className="text-right ml-6">
                  <p className="text-xs text-slate-400 uppercase mb-1">Best PF</p>
                  <p className="text-xl font-bold text-amber-400">{exp.bestResult.toFixed(2)}</p>
                </div>
                <div className="ml-4">{expandedId === exp.id ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}</div>
              </button>

              {expandedId === exp.id && (
                <div className="border-t border-slate-700 bg-slate-800/20 p-6 space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 uppercase mb-3">Parameters</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Object.entries(exp.parameters).map(([key, value]) => (
                        <div key={key} className="bg-slate-800/50 border border-slate-600 rounded p-3">
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-1">{key}</p>
                          <p className="text-sm font-bold text-white">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 uppercase mb-3">Result Metrics</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {exp.results.map((result, idx) => (
                        <div key={idx} className="bg-slate-800/50 border border-slate-600 rounded p-3">
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-2">{result.metric}</p>
                          <p className={`text-lg font-bold ${result.value > 0 ? "text-green-400" : "text-red-400"}`}>{result.value > 0 ? "+" : ""}{result.value.toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm pt-4 border-t border-slate-700">
                    <div><span className="text-slate-400">Started:</span><span className="ml-2 text-white font-semibold">{exp.startedAt}</span></div>
                    {exp.completedAt && <div><span className="text-slate-400">Completed:</span><span className="ml-2 text-white font-semibold">{exp.completedAt}</span></div>}
                  </div>

                  <div className="flex gap-2 pt-4 border-t border-slate-700">
                    <button className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded text-sm font-semibold transition-all">View Details</button>
                    <button className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded text-sm font-semibold transition-all">Fork Experiment</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
