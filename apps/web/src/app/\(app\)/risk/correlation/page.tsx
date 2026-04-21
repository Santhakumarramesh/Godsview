'use client'

import { api } from "@/lib/api";

import { useState, useMemo } from 'react'
import { Grid3x3, AlertTriangle, TrendingDown } from 'lucide-react'

interface Cluster {
  name: string
  symbols: string[]
  avgCorrelation: number
  risk: 'high' | 'medium' | 'low'
}

const symbols = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'BTC', 'GLD', 'SPY', 'TLT']

const correlationMatrix = [
  [1.0, 0.72, 0.82, 0.61, 0.15, 0.08, 0.85, -0.12],
  [0.72, 1.0, 0.68, 0.55, 0.18, 0.05, 0.71, -0.08],
  [0.82, 0.68, 1.0, 0.58, 0.22, 0.06, 0.79, -0.10],
  [0.61, 0.55, 0.58, 1.0, 0.25, 0.12, 0.64, -0.05],
  [0.15, 0.18, 0.22, 0.25, 1.0, 0.32, 0.28, -0.35],
  [0.08, 0.05, 0.06, 0.12, 0.32, 1.0, 0.15, 0.42],
  [0.85, 0.71, 0.79, 0.64, 0.28, 0.15, 1.0, -0.15],
  [-0.12, -0.08, -0.10, -0.05, -0.35, 0.42, -0.15, 1.0],
]

const clusters: Cluster[] = [
  { name: 'Mega Cap Tech', symbols: ['AAPL', 'NVDA', 'MSFT'], avgCorrelation: 0.74, risk: 'high' },
  { name: 'Growth Stocks', symbols: ['AAPL', 'NVDA', 'MSFT', 'TSLA'], avgCorrelation: 0.64, risk: 'high' },
  { name: 'Equities (Broad)', symbols: ['SPY', 'AAPL', 'NVDA', 'MSFT'], avgCorrelation: 0.78, risk: 'high' },
  { name: 'Crypto', symbols: ['BTC'], avgCorrelation: 0.25, risk: 'low' },
  { name: 'Safe Haven', symbols: ['GLD', 'TLT'], avgCorrelation: 0.42, risk: 'medium' },
]

export default function CorrelationPage() {
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null)
  const [viewMode, setViewMode] = useState<'matrix' | 'heatmap'>('matrix')

  const getCorrelationColor = (value: number) => {
    if (value >= 0.7) return 'bg-red-600'
    if (value >= 0.5) return 'bg-orange-500'
    if (value >= 0.3) return 'bg-yellow-500'
    if (value >= 0) return 'bg-green-600'
    return 'bg-blue-600'
  }

  const getHighCorrelationPairs = () => {
    const pairs: Array<{ pair: string; value: number }> = []
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const corr = correlationMatrix[i][j]
        if (corr > 0.7) {
          pairs.push({ pair: `${symbols[i]} ↔ ${symbols[j]}`, value: corr })
        }
      }
    }
    return pairs.sort((a, b) => b.value - a.value)
  }

  const maxCorrelation = useMemo(
    () => Math.max(...getHighCorrelationPairs().map(p => p.value)),
    []
  )

  const riskExposure = useMemo(() => {
    const exposures = clusters.map(c => ({
      name: c.name,
      risk: c.risk,
      symbols: c.symbols,
      exposure: c.avgCorrelation,
    }))
    return exposures.sort((a, b) => b.exposure - a.exposure)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Grid3x3 className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">Correlation Risk</h1>
          </div>
          <p className="text-gray-400">Portfolio correlation analysis and risk cluster identification</p>
        </div>

        {maxCorrelation > 0.7 && (
          <div className="border border-red-700/50 bg-red-900/20 rounded-lg p-4 mb-8 flex gap-4">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-red-300 font-semibold mb-1">High Correlation Alert</h3>
              <p className="text-red-200 text-sm">
                Maximum correlation is {maxCorrelation.toFixed(2)} between {getHighCorrelationPairs()[0]?.pair}. Consider diversification to reduce concentration risk.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Max Correlation</div>
            <div className="text-3xl font-bold text-red-400">{maxCorrelation.toFixed(2)}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">High Risk Pairs</div>
            <div className="text-3xl font-bold text-red-400">{getHighCorrelationPairs().length}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Risk Clusters</div>
            <div className="text-3xl font-bold text-amber-400">{clusters.length}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Assets Analyzed</div>
            <div className="text-3xl font-bold text-blue-400">{symbols.length}</div>
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Correlation Matrix ({symbols.length}x{symbols.length})</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('matrix')}
                className={`px-3 py-1.5 rounded text-sm font-semibold transition-all ${
                  viewMode === 'matrix'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                    : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                }`}
              >
                Matrix
              </button>
              <button
                onClick={() => setViewMode('heatmap')}
                className={`px-3 py-1.5 rounded text-sm font-semibold transition-all ${
                  viewMode === 'heatmap'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                    : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                }`}
              >
                Heatmap
              </button>
            </div>
          </div>

          {viewMode === 'matrix' ? (
            <div className="overflow-x-auto">
              <div className="inline-block">
                <div className="flex gap-1 mb-1">
                  <div className="w-20" />
                  {symbols.map(sym => (
                    <div key={sym} className="w-16 text-center text-xs font-bold text-gray-300 py-2">
                      {sym}
                    </div>
                  ))}
                </div>
                {symbols.map((rowSym, i) => (
                  <div key={rowSym} className="flex gap-1">
                    <div className="w-20 text-xs font-bold text-gray-300 py-3 pr-2 text-right">
                      {rowSym}
                    </div>
                    {symbols.map((colSym, j) => {
                      const value = correlationMatrix[i][j]
                      const isSelected = selectedCell && selectedCell[0] === i && selectedCell[1] === j

                      return (
                        <button
                          key={`${i}-${j}`}
                          onClick={() => setSelectedCell(isSelected ? null : [i, j])}
                          className={`w-16 h-12 rounded text-xs font-bold transition-all ${getCorrelationColor(
                            value
                          )} text-white hover:opacity-80 ${isSelected ? 'ring-2 ring-emerald-400' : ''}`}
                        >
                          {value.toFixed(2)}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-gray-400 mb-4">Correlation intensity visualization</div>
              <div className="grid gap-0.5">
                {symbols.map((rowSym, i) => (
                  <div key={rowSym} className="flex gap-0.5">
                    <div className="w-16 text-xs text-gray-400 py-1 px-2 font-semibold">
                      {rowSym}
                    </div>
                    <div className="flex gap-0.5 flex-1">
                      {symbols.map((colSym, j) => {
                        const value = correlationMatrix[i][j]
                        let bgColor = 'bg-blue-900'
                        if (value >= 0.7) bgColor = 'bg-red-700'
                        else if (value >= 0.5) bgColor = 'bg-orange-600'
                        else if (value >= 0.3) bgColor = 'bg-yellow-600'
                        else if (value >= 0) bgColor = 'bg-green-700'

                        return (
                          <div
                            key={`${i}-${j}`}
                            className={`flex-1 h-8 rounded ${bgColor} opacity-70 hover:opacity-100 transition-opacity cursor-pointer`}
                            title={`${rowSym} ↔ ${colSym}: ${value.toFixed(2)}`}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-8 mt-6 pt-6 border-t border-gray-800 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-red-600 rounded" />
              <span className="text-xs text-gray-400">High (0.7-1.0)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-orange-500 rounded" />
              <span className="text-xs text-gray-400">Moderate (0.5-0.7)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-yellow-500 rounded" />
              <span className="text-xs text-gray-400">Low (0.3-0.5)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-green-600 rounded" />
              <span className="text-xs text-gray-400">Very Low (0-0.3)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-600 rounded" />
              <span className="text-xs text-gray-400">Negative (&lt;0)</span>
            </div>
          </div>
        </div>

        {getHighCorrelationPairs().length > 0 && (
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">High Correlation Pairs (≥0.7)</h2>
            <div className="space-y-2">
              {getHighCorrelationPairs().map((pair, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-800/30 border border-gray-800 rounded hover:border-gray-700">
                  <span className="text-sm font-semibold text-white">{pair.pair}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-red-500 to-red-400 h-2 rounded-full"
                        style={{ width: `${pair.value * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-red-400 w-10">{pair.value.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Risk Clusters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clusters.map(cluster => {
              const riskColors = {
                high: 'bg-red-900/30 border-red-700/50',
                medium: 'bg-amber-900/30 border-amber-700/50',
                low: 'bg-green-900/30 border-green-700/50',
              }
              const riskTextColors = {
                high: 'text-red-300',
                medium: 'text-amber-300',
                low: 'text-green-300',
              }

              return (
                <div key={cluster.name} className={`border rounded-lg p-4 ${riskColors[cluster.risk]}`}>
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-white">{cluster.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${riskTextColors[cluster.risk]}`}>
                      {cluster.risk.toUpperCase()} RISK
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {cluster.symbols.map(sym => (
                      <span key={sym} className="px-2 py-1 bg-gray-800/50 text-gray-300 rounded text-xs font-semibold">
                        {sym}
                      </span>
                    ))}
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-400">Avg Correlation</span>
                    <span className="text-white font-bold">{cluster.avgCorrelation.toFixed(2)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {selectedCell && correlationMatrix[selectedCell[0]][selectedCell[1]] !== undefined && (
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mt-8">
            <h3 className="text-lg font-bold text-white mb-4">
              Correlation Details: {symbols[selectedCell[0]]} ↔ {symbols[selectedCell[1]]}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border border-gray-800 rounded p-4">
                <p className="text-gray-400 text-xs mb-2">Correlation Value</p>
                <p className="text-2xl font-bold text-white">{correlationMatrix[selectedCell[0]][selectedCell[1]].toFixed(4)}</p>
              </div>
              <div className="border border-gray-800 rounded p-4">
                <p className="text-gray-400 text-xs mb-2">Strength</p>
                <p className="text-white font-bold">
                  {Math.abs(correlationMatrix[selectedCell[0]][selectedCell[1]]) >= 0.7
                    ? 'Strong'
                    : Math.abs(correlationMatrix[selectedCell[0]][selectedCell[1]]) >= 0.5
                    ? 'Moderate'
                    : 'Weak'}
                </p>
              </div>
              <div className="border border-gray-800 rounded p-4">
                <p className="text-gray-400 text-xs mb-2">Risk Level</p>
                <p className={`font-bold ${
                  Math.abs(correlationMatrix[selectedCell[0]][selectedCell[1]]) >= 0.7
                    ? 'text-red-400'
                    : Math.abs(correlationMatrix[selectedCell[0]][selectedCell[1]]) >= 0.5
                    ? 'text-amber-400'
                    : 'text-green-400'
                }`}>
                  {Math.abs(correlationMatrix[selectedCell[0]][selectedCell[1]]) >= 0.7 ? 'High' : Math.abs(correlationMatrix[selectedCell[0]][selectedCell[1]]) >= 0.5 ? 'Medium' : 'Low'}
                </p>
              </div>
              <div className="border border-gray-800 rounded p-4">
                <p className="text-gray-400 text-xs mb-2">Type</p>
                <p className="text-white font-bold">{correlationMatrix[selectedCell[0]][selectedCell[1]] < 0 ? 'Negative' : 'Positive'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
