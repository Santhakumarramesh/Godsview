"use client";
import { useState } from "react";
import { Grid3x3, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

const symbols = ["AAPL", "NVDA", "MSFT", "TSLA", "BTC", "ES"];
const correlationMatrix = [[1.0, 0.72, 0.82, 0.61, 0.15, 0.48], [0.72, 1.0, 0.68, 0.55, 0.18, 0.45], [0.82, 0.68, 1.0, 0.58, 0.22, 0.51], [0.61, 0.55, 0.58, 1.0, 0.25, 0.42], [0.15, 0.18, 0.22, 0.25, 1.0, 0.08], [0.48, 0.45, 0.51, 0.42, 0.08, 1.0]];
const clusters = [
  { name: "Tech Mega Cap", symbols: ["AAPL", "NVDA", "MSFT"], avgCorrelation: 0.74, risk: "high" },
  { name: "Growth Stocks", symbols: ["AAPL", "NVDA", "MSFT", "TSLA"], avgCorrelation: 0.64, risk: "medium" },
  { name: "Crypto", symbols: ["BTC"], avgCorrelation: 0.18, risk: "low" },
  { name: "Equity Indices", symbols: ["ES"], avgCorrelation: 0.47, risk: "medium" },
];

export default function CorrelationPage() {
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);

  const getCorrelationColor = (value: number) => {
    if (value >= 0.7) return "bg-red-600 text-white";
    if (value >= 0.5) return "bg-orange-500 text-white";
    if (value >= 0.3) return "bg-yellow-500 text-white";
    return "bg-green-600 text-white";
  };

  const getHighCorrelationPairs = () => {
    const pairs: Array<{ pair: string; value: number }> = [];
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const corr = correlationMatrix[i][j];
        if (corr > 0.7) pairs.push({ pair: `${symbols[i]} ↔ ${symbols[j]}`, value: corr });
      }
    }
    return pairs.sort((a, b) => b.value - a.value);
  };

  const maxCorrelation = Math.max(...getHighCorrelationPairs().map((p) => p.value));

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Grid3x3 className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Correlation Risk</h1>
              <p className="text-slate-400 text-sm">Portfolio correlation analysis and cluster identification</p>
            </div>
          </div>
        </div>

        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-300 mb-2">High Correlation Alert</h3>
              <p className="text-red-100 text-sm">Current maximum correlation is {maxCorrelation.toFixed(2)} (AAPL-MSFT). Consider diversification to reduce portfolio risk from correlated assets.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Max Correlation</p><p className="text-3xl font-bold text-red-400">{maxCorrelation.toFixed(2)}</p><p className="text-xs text-slate-400 mt-1">AAPL ↔ MSFT</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">High Risk Pairs</p><p className="text-3xl font-bold text-red-400">{getHighCorrelationPairs().length}</p><p className="text-xs text-slate-400 mt-1">Corr &gt;= 0.7</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Clusters Detected</p><p className="text-3xl font-bold text-amber-400">{clusters.length}</p><p className="text-xs text-slate-400 mt-1">Asset groups</p></div>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Correlation Matrix (6x6)</h2>

          <div className="overflow-x-auto">
            <div className="inline-block">
              <div className="flex gap-1 mb-1">
                <div className="w-20" />
                {symbols.map((sym) => (
                  <div key={sym} className="w-20 text-center text-xs font-bold text-slate-300 py-2">{sym}</div>
                ))}
              </div>

              {symbols.map((rowSym, i) => (
                <div key={rowSym} className="flex gap-1">
                  <div className="w-20 text-xs font-bold text-slate-300 py-3 pr-2 text-right">{rowSym}</div>
                  {symbols.map((colSym, j) => {
                    const value = correlationMatrix[i][j];
                    const isSelected = selectedCell && selectedCell[0] === i && selectedCell[1] === j;
                    return (
                      <button key={`${i}-${j}`} onClick={() => setSelectedCell([i, j])} className={`w-20 h-12 rounded text-xs font-bold transition-all ${getCorrelationColor(value)} ${isSelected ? "ring-2 ring-amber-400" : "hover:opacity-80"}`}>
                        {value.toFixed(2)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6 mt-6 pt-6 border-t border-slate-700 flex-wrap">
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-red-600 rounded" /><span className="text-xs text-slate-400">High (0.7-1.0)</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-orange-500 rounded" /><span className="text-xs text-slate-400">Moderate (0.5-0.7)</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-yellow-500 rounded" /><span className="text-xs text-slate-400">Low (0.3-0.5)</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 bg-green-600 rounded" /><span className="text-xs text-slate-400">Very Low (&lt;0.3)</span></div>
          </div>
        </div>

        {getHighCorrelationPairs().length > 0 && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">High Correlation Pairs (Corr &gt;= 0.7)</h2>
            <div className="space-y-2">
              {getHighCorrelationPairs().map((pair, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-800/30 border border-slate-700 rounded hover:border-slate-600 transition-all">
                  <span className="text-sm font-semibold text-white">{pair.pair}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-slate-700 rounded-full h-2">
                      <div className="bg-gradient-to-r from-red-500 to-red-400 h-2 rounded-full" style={{ width: `${pair.value * 100}%` }} />
                    </div>
                    <span className="text-sm font-bold text-red-400 w-12 text-right">{pair.value.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Asset Clusters</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clusters.map((cluster) => {
              const riskColors = { high: "bg-red-500/20 text-red-300 border-red-500/30", medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", low: "bg-green-500/20 text-green-300 border-green-500/30" };
              return (
                <div key={cluster.name} className="bg-slate-800/30 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-white">{cluster.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-bold border ${riskColors[cluster.risk as keyof typeof riskColors]}`}>{cluster.risk.toUpperCase()} RISK</span>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {cluster.symbols.map((sym) => (
                      <span key={sym} className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs font-semibold">{sym}</span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Avg Correlation:</span>
                    <span className="text-white font-bold">{cluster.avgCorrelation.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedCell && correlationMatrix[selectedCell[0]][selectedCell[1]] !== undefined && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Correlation Details: {symbols[selectedCell[0]]} ↔ {symbols[selectedCell[1]]}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Correlation Value</p><p className="text-2xl font-bold text-white">{correlationMatrix[selectedCell[0]][selectedCell[1]].toFixed(4)}</p></div>
              <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Strength</p><p className="text-lg font-bold">{correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.7 ? "Strong" : correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.5 ? "Moderate" : correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.3 ? "Weak" : "Very Weak"}</p></div>
              <div className="bg-slate-800/50 border border-slate-600 rounded p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Risk Level</p><p className={`text-lg font-bold ${correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.7 ? "text-red-400" : correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.5 ? "text-amber-400" : "text-green-400"}`}>{correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.7 ? "High" : correlationMatrix[selectedCell[0]][selectedCell[1]] >= 0.5 ? "Medium" : "Low"}</p></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
