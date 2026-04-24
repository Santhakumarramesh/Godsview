'use client'

import { useState, useEffect } from 'react'
import { api } from "@/lib/api";

interface BacktestResult {
  run_id: string
  symbol: string
  strategy: string
  pf: number
  sharpe: number
  win_rate: number
  trades: number
  max_dd: number
  start: string
  end: string
}

interface RegimeCell {
  strategy: string
  regime: string
  pf: number
  win_rate: number
  count: number
}

export default function RegimeMatrixPage() {
  const [results, setResults] = useState<BacktestResult[]>([])
  const [matrix, setMatrix] = useState<RegimeCell[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const data = await api.backtest.getResults({ limit: 50 });
        const results = data.results || []
        setResults(results)
        buildMatrix(results)
      } catch (err) {
        // Fallback to mock data
        const mockResults: BacktestResult[] = [
          { run_id: '1', symbol: 'AAPL', strategy: 'momentum', pf: 2.34, sharpe: 1.87, win_rate: 0.625, trades: 50, max_dd: -0.083, start: '2024-01-01', end: '2024-12-31' },
        ];
        setResults(mockResults);
        buildMatrix(mockResults);
        setError(err instanceof Error ? err.message : 'Using mock data');
      } finally {
        setLoading(false)
      }
    }
    fetchResults()
  }, [])

  const getRegime = (maxDD: number): string => {
    if (maxDD < 0.1) return 'Trending'
    if (maxDD < 0.2) return 'Choppy'
    if (maxDD < 0.35) return 'Volatile'
    return 'Event'
  }

  const buildMatrix = (data: BacktestResult[]) => {
    const grouped: { [key: string]: BacktestResult[] } = {}

    data.forEach((r) => {
      const key = `${r.strategy}|${getRegime(r.max_dd)}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(r)
    })

    const cells = Object.entries(grouped).map(([key, items]) => {
      const [strategy, regime] = key.split('|')
      return {
        strategy,
        regime,
        pf: items.reduce((a, r) => a + r.pf, 0) / items.length,
        win_rate: items.reduce((a, r) => a + r.win_rate, 0) / items.length,
        count: items.length,
      }
    })

    setMatrix(cells)
  }

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const strategies = [...new Set(matrix.map(m => m.strategy))]
  const regimes = ['Trending', 'Choppy', 'Volatile', 'Event']

  const getColor = (pf: number): string => {
    if (pf > 1.5) return 'bg-emerald-900/40 border-emerald-600'
    if (pf > 1.0) return 'bg-emerald-900/20 border-emerald-500'
    if (pf > 0.8) return 'bg-yellow-900/20 border-yellow-600'
    return 'bg-red-900/20 border-red-600'
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Regime Performance Matrix</h1>
        <p className="text-gray-400 mb-6">Strategy performance across market regimes</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Strategy</th>
                {regimes.map((r) => (
                  <th key={r} className="text-center py-3 px-4 text-gray-400 font-semibold">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => (
                <tr key={strategy} className="border-t border-[#1e1e2e]">
                  <td className="py-3 px-4 text-white font-semibold">{strategy}</td>
                  {regimes.map((regime) => {
                    const cell = matrix.find(m => m.strategy === strategy && m.regime === regime)
                    return (
                      <td key={`${strategy}-${regime}`} className="py-3 px-4 text-center">
                        {cell ? (
                          <div className={`rounded-lg border p-3 ${getColor(cell.pf)}`}>
                            <div className={`font-bold text-sm ${cell.pf > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {cell.pf.toFixed(2)}
                            </div>
                            <div className="text-gray-400 text-xs mt-1">
                              {(cell.win_rate * 100).toFixed(0)}% | n={cell.count}
                            </div>
                          </div>
                        ) : (
                          <div className="text-gray-600 text-xs py-3">-</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <div className="border border-emerald-600 bg-emerald-900/40 rounded-lg p-4">
            <div className="text-emerald-400 font-semibold text-sm">Excellent</div>
            <div className="text-gray-400 text-xs mt-1">PF {'>'} 1.5</div>
          </div>
          <div className="border border-emerald-500 bg-emerald-900/20 rounded-lg p-4">
            <div className="text-emerald-400 font-semibold text-sm">Good</div>
            <div className="text-gray-400 text-xs mt-1">PF {'>'} 1.0</div>
          </div>
          <div className="border border-yellow-600 bg-yellow-900/20 rounded-lg p-4">
            <div className="text-yellow-400 font-semibold text-sm">Neutral</div>
            <div className="text-gray-400 text-xs mt-1">PF {'>'} 0.8</div>
          </div>
          <div className="border border-red-600 bg-red-900/20 rounded-lg p-4">
            <div className="text-red-400 font-semibold text-sm">Poor</div>
            <div className="text-gray-400 text-xs mt-1">PF {'<'} 0.8</div>
          </div>
        </div>
      </div>
    </div>
  )
}
