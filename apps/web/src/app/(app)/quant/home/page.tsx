'use client'

import { useState, useEffect, useCallback } from 'react'

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

interface MLModel {
  id: string
  symbol: string
  type: string
  accuracy: number
  status: string
  created: string
}

export default function QuantHomePage() {
  const [results, setResults] = useState<BacktestResult[]>([])
  const [models, setModels] = useState<MLModel[]>([])
  const [timeframes, setTimeframes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [resultsRes, modelsRes, timeframesRes] = await Promise.all([
        fetch('/api/backtest/results?limit=10'),
        fetch('/api/ml/models'),
        fetch('/api/backtest/timeframes'),
      ])

      if (!resultsRes.ok || !modelsRes.ok || !timeframesRes.ok) {
        throw new Error('Failed to fetch data')
      }

      const resultsData = await resultsRes.json()
      const modelsData = await modelsRes.json()
      const timeframesData = await timeframesRes.json()

      setResults(resultsData.results || [])
      setModels(modelsData.models || [])
      setTimeframes(timeframesData.timeframes || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-emerald-400 animate-pulse">Loading Lab...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] p-6">
        <div className="bg-red-900 border border-red-700 rounded-lg p-4 text-red-400">
          Error: {error}
        </div>
      </div>
    )
  }

  const activeModels = models.filter((m) => m.status === 'active').length
  const totalExperiments = results.length

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Quant Lab</h1>
          <p className="text-gray-400">Central research hub for strategy development</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Active Models</div>
            <div className="text-3xl font-bold text-emerald-400">{activeModels}</div>
            <div className="text-gray-500 text-xs mt-2">{models.length} total</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Recent Experiments</div>
            <div className="text-3xl font-bold text-emerald-400">{totalExperiments}</div>
            <div className="text-gray-500 text-xs mt-2">Last 10 backtests</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Supported Timeframes</div>
            <div className="text-3xl font-bold text-emerald-400">{timeframes.length}</div>
            <div className="text-gray-500 text-xs mt-2">Data available</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <button className="border border-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-lg p-4 text-emerald-400 font-semibold transition">
            + New Backtest
          </button>
          <button className="border border-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-lg p-4 text-emerald-400 font-semibold transition">
            + Train Model
          </button>
        </div>

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Recent Experiments</h2>
          {results.length === 0 ? (
            <p className="text-gray-400">No experiments yet</p>
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
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 5).map((r) => (
                    <tr key={r.run_id} className="border-b border-[#1e1e2e] hover:bg-[#16161e]">
                      <td className="py-3 px-4 text-white font-mono">{r.symbol}</td>
                      <td className="py-3 px-4 text-gray-300">{r.strategy}</td>
                      <td className={`py-3 px-4 text-right font-mono ${r.pf > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.pf.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">
                        {r.sharpe.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">
                        {(r.win_rate * 100).toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">{r.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Model Registry</h2>
          {models.length === 0 ? (
            <p className="text-gray-400">No models available</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {models.slice(0, 6).map((m) => (
                <div key={m.id} className="border border-[#1e1e2e] bg-[#0a0a0f] rounded-lg p-4 hover:border-emerald-400/30 transition">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="text-white font-semibold">{m.symbol}</h3>
                      <p className="text-gray-400 text-sm">{m.type}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${m.status === 'active' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {m.status}
                    </span>
                  </div>
                  <div className="text-gray-400 text-xs">
                    Accuracy: <span className="text-emerald-400">{(m.accuracy * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
