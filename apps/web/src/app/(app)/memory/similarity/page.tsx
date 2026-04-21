'use client'

import { useState, useEffect } from 'react'

interface Signal {
  id: string
  symbol: string
  direction: string
  confidence: number
  timestamp: string
}

interface Match {
  id: string
  symbol: string
  direction: string
  confidence: number
  timestamp: string
  similarity: number
}

export default function SimilaritySearchPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [currentSignal, setCurrentSignal] = useState<Signal | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchSimilarity = async (sym: string) => {
    if (!sym) return

    try {
      setLoading(true)
      setError(null)

      const [currentRes, historyRes] = await Promise.all([
        fetch(`/api/signals?symbol=${sym}&timeframe=15min`),
        fetch(`/api/signals/history?symbol=${sym}&limit=30`),
      ])

      if (!currentRes.ok || !historyRes.ok) throw new Error('Failed to fetch')

      const currentData = await currentRes.json()
      const historyData = await historyRes.json()

      const current = currentData
      const historical = historyData.signals || []

      if (current) {
        setCurrentSignal(current)

        const matchedSignals = historical
          .filter((h: Signal) => h.id !== current.id)
          .map((h: Signal) => {
            const directionMatch = h.direction === current.direction ? 1 : 0.3
            const confidenceDiff = Math.abs(h.confidence - current.confidence)
            const confidenceScore = 1 - confidenceDiff

            const similarity = (directionMatch * 0.4 + confidenceScore * 0.6) * 100

            return {
              ...h,
              similarity,
            }
          })
          .sort((a: Match, b: Match) => b.similarity - a.similarity)

        setMatches(matchedSignals.slice(0, 15))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error searching')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    searchSimilarity(symbol)
  }, [symbol])

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Setup Similarity Search</h1>
        <p className="text-gray-400 mb-6">Find similar historical setups</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="mb-8">
          <label className="text-gray-400 text-sm mb-2 block">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="bg-[#12121a] border border-[#1e1e2e] rounded px-4 py-2 text-white w-full max-w-xs"
            placeholder="Enter symbol"
          />
        </div>

        {currentSignal && (
          <div className="border border-emerald-400/30 bg-emerald-400/5 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Current Setup</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-gray-400 text-sm mb-1">Symbol</div>
                <div className="text-white font-semibold text-lg">{currentSignal.symbol}</div>
              </div>
              <div>
                <div className="text-gray-400 text-sm mb-1">Direction</div>
                <div className={`font-semibold text-lg ${currentSignal.direction === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentSignal.direction.toUpperCase()}
                </div>
              </div>
              <div>
                <div className="text-gray-400 text-sm mb-1">Confidence</div>
                <div className="text-emerald-400 font-semibold text-lg">
                  {(currentSignal.confidence * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-gray-400 text-sm mb-1">Timestamp</div>
                <div className="text-gray-300 text-sm font-mono">
                  {new Date(currentSignal.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Similar Setups ({matches.length})</h2>
          {matches.length === 0 ? (
            <p className="text-gray-400">
              {loading ? 'Searching...' : 'No similar setups found'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e2e] text-gray-400">
                    <th className="text-left py-2 px-4">Similarity</th>
                    <th className="text-left py-2 px-4">Symbol</th>
                    <th className="text-center py-2 px-4">Direction</th>
                    <th className="text-right py-2 px-4">Confidence</th>
                    <th className="text-left py-2 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.id} className="border-b border-[#1e1e2e] hover:bg-[#16161e]">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-[#0a0a0f] border border-[#1e1e2e] rounded overflow-hidden h-2">
                            <div className="bg-emerald-400 h-full" style={{ width: `${m.similarity}%` }} />
                          </div>
                          <span className="text-emerald-400 font-semibold">{m.similarity.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-white font-mono">{m.symbol}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${m.direction === 'buy' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'}`}>
                          {m.direction.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">
                        {(m.confidence * 100).toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{new Date(m.timestamp).toLocaleString()}</td>
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
