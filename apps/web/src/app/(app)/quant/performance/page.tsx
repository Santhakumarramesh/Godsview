'use client'

import { useState, useEffect } from 'react'

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

export default function PerformanceAnalyticsPage() {
  const [results, setResults] = useState<BacktestResult[]>([])
  const [filteredResults, setFilteredResults] = useState<BacktestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [strategyFilter, setStrategyFilter] = useState('all')
  const [strategies, setStrategies] = useState<string[]>([])

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch('/api/backtest/results?limit=50')
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        const results = data.results || []
        setResults(results)
        setFilteredResults(results)
        const uniqueStrategies = [...new Set(results.map((r: BacktestResult) => r.strategy))]
        setStrategies(uniqueStrategies)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading')
      } finally {
        setLoading(false)
      }
    }
    fetchResults()
  }, [])

  useEffect(() => {
    if (strategyFilter === 'all') {
      setFilteredResults(results)
    } else {
      setFilteredResults(results.filter(r => r.strategy === strategyFilter))
    }
  }, [strategyFilter, results])

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const stats = {
    avgPF: filteredResults.reduce((a, r) => a + r.pf, 0) / (filteredResults.length || 1),
    avgSharpe: filteredResults.reduce((a, r) => a + r.sharpe, 0) / (filteredResults.length || 1),
    avgWinRate: filteredResults.reduce((a, r) => a + r.win_rate, 0) / (filteredResults.length || 1),
    totalTrades: filteredResults.reduce((a, r) => a + r.trades, 0),
    avgMaxDD: filteredResults.reduce((a, r) => a + r.max_dd, 0) / (filteredResults.length || 1),
  }

  const sorted = [...filteredResults].sort((a, b) => b.sharpe - a.sharpe)

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Performance Analytics</h1>
        <p className="text-gray-400 mb-6">Aggregate statistics across all backtests</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="mb-6">
          <label className="text-gray-400 text-sm mb-2 block">Filter by Strategy</label>
          <select
            value={strategyFilter}
            onChange={(e) => setStrategyFilter(e.target.value)}
            className="bg-[#12121a] border border-[#1e1e2e] rounded px-4 py-2 text-white"
          >
            <option value="all">All Strategies</option>
            {strategies.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Avg Profit Factor</div>
            <div className={`text-2xl font-bold ${stats.avgPF > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.avgPF.toFixed(2)}
            </div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Avg Sharpe</div>
            <div className="text-2xl font-bold text-emerald-400">{stats.avgSharpe.toFixed(2)}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Avg Win Rate</div>
            <div className="text-2xl font-bold text-emerald-400">{(stats.avgWinRate * 100).toFixed(1)}%</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Total Trades</div>
            <div className="text-2xl font-bold text-emerald-400">{stats.totalTrades}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Avg Max DD</div>
            <div className="text-2xl font-bold text-red-400">{(stats.avgMaxDD * 100).toFixed(1)}%</div>
          </div>
        </div>

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Results Sorted by Sharpe Ratio</h2>
          {filteredResults.length === 0 ? (
            <p className="text-gray-400">No results matching filter</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e2e] text-gray-400">
                    <th className="text-left py-2 px-4">Symbol</th>
                    <th className="text-left py-2 px-4">Strategy</th>
                    <th className="text-right py-2 px-4">PF</th>
                    <th className="text-right py-2 px-4">Sharpe</th>
                    <th className="text-right py-2 px-4">Win%</th>
                    <th className="text-right py-2 px-4">Trades</th>
                    <th className="text-right py-2 px-4">Max DD</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.run_id} className="border-b border-[#1e1e2e] hover:bg-[#16161e]">
                      <td className="py-3 px-4 text-white font-mono">{r.symbol}</td>
                      <td className="py-3 px-4 text-gray-300">{r.strategy}</td>
                      <td className={`py-3 px-4 text-right font-mono ${r.pf > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.pf.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400">{r.sharpe.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">{(r.win_rate * 100).toFixed(1)}%</td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">{r.trades}</td>
                      <td className="py-3 px-4 text-right font-mono text-red-400">{(r.max_dd * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
