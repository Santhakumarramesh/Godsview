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

export default function WalkForwardPage() {
  const [results, setResults] = useState<BacktestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch('/api/backtest/results?limit=20')
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        setResults(data.results || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading results')
      } finally {
        setLoading(false)
      }
    }
    fetchResults()
  }, [])

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const parseDate = (dateStr: string) => new Date(dateStr).getTime()

  const analyzeWalkForward = (results: BacktestResult[]) => {
    const sorted = [...results].sort((a, b) => parseDate(a.start) - parseDate(b.start))
    const windows = []
    const windowSize = Math.max(1, Math.floor(sorted.length / 3))

    for (let i = 0; i < sorted.length - windowSize; i++) {
      const trainData = sorted.slice(0, i + windowSize)
      const testData = sorted.slice(i + windowSize, i + windowSize + Math.max(1, Math.floor(windowSize / 2)))

      if (testData.length > 0) {
        const trainPF = trainData.reduce((acc, r) => acc + r.pf, 0) / trainData.length
        const testPF = testData.reduce((acc, r) => acc + r.pf, 0) / testData.length
        const stability = testPF > 0 ? trainPF / testPF : 0

        windows.push({
          window: windows.length + 1,
          trainSize: trainData.length,
          testSize: testData.length,
          trainPF,
          testPF,
          stability,
          isUnstable: stability < 0.5 || stability > 2,
        })
      }
    }
    return windows
  }

  const windows = analyzeWalkForward(results)

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Walk-Forward Validation</h1>
        <p className="text-gray-400 mb-6">Analyze in-sample vs out-of-sample performance</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        {results.length === 0 ? (
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6 text-center text-gray-400">
            No backtest results available
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
                <div className="text-gray-400 text-sm mb-2">Total Results</div>
                <div className="text-2xl font-bold text-emerald-400">{results.length}</div>
              </div>
              <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
                <div className="text-gray-400 text-sm mb-2">Validation Windows</div>
                <div className="text-2xl font-bold text-emerald-400">{windows.length}</div>
              </div>
              <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
                <div className="text-gray-400 text-sm mb-2">Unstable Strategies</div>
                <div className="text-2xl font-bold text-red-400">{windows.filter(w => w.isUnstable).length}</div>
              </div>
            </div>

            <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6 mb-8">
              <h2 className="text-xl font-bold text-white mb-4">Validation Windows</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e1e2e] text-gray-400">
                      <th className="text-left py-2 px-4">Window</th>
                      <th className="text-right py-2 px-4">Train Samples</th>
                      <th className="text-right py-2 px-4">Test Samples</th>
                      <th className="text-right py-2 px-4">Train PF</th>
                      <th className="text-right py-2 px-4">Test PF</th>
                      <th className="text-right py-2 px-4">Stability</th>
                      <th className="text-center py-2 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windows.map((w) => (
                      <tr key={w.window} className="border-b border-[#1e1e2e] hover:bg-[#16161e]">
                        <td className="py-3 px-4 text-white font-mono">W{w.window}</td>
                        <td className="py-3 px-4 text-right text-gray-300">{w.trainSize}</td>
                        <td className="py-3 px-4 text-right text-gray-300">{w.testSize}</td>
                        <td className={`py-3 px-4 text-right font-mono ${w.trainPF > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {w.trainPF.toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-right font-mono ${w.testPF > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {w.testPF.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-gray-300">{w.stability.toFixed(2)}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${w.isUnstable ? 'bg-red-400/20 text-red-400' : 'bg-emerald-400/20 text-emerald-400'}`}>
                            {w.isUnstable ? 'UNSTABLE' : 'STABLE'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
              <h2 className="text-xl font-bold text-white mb-4">Detailed Results</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#1e1e2e] text-gray-400">
                      <th className="text-left py-2 px-3">ID</th>
                      <th className="text-left py-2 px-3">Symbol</th>
                      <th className="text-left py-2 px-3">Strategy</th>
                      <th className="text-right py-2 px-3">PF</th>
                      <th className="text-right py-2 px-3">Sharpe</th>
                      <th className="text-right py-2 px-3">Win%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.slice(0, 10).map((r) => (
                      <tr key={r.run_id} className="border-b border-[#1e1e2e] hover:bg-[#16161e]">
                        <td className="py-2 px-3 text-gray-400 font-mono text-xs">{r.run_id.slice(0, 8)}</td>
                        <td className="py-2 px-3 text-white">{r.symbol}</td>
                        <td className="py-2 px-3 text-gray-300">{r.strategy}</td>
                        <td className={`py-2 px-3 text-right font-mono ${r.pf > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {r.pf.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-gray-300">{r.sharpe.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-mono text-gray-300">{(r.win_rate * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
