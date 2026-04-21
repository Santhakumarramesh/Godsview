'use client'

import { useState, useEffect } from 'react'

interface Signal {
  id: string
  symbol: string
  direction: string
  confidence: number
  timestamp: string
}

interface Trade {
  id: string
  symbol: string
  entry_price: number
  exit_price: number
  pnl: number
  timestamp: string
}

interface CaseEntry {
  id: string
  symbol: string
  signal_direction: string
  outcome: 'win' | 'loss'
  confidence: number
  pnl: number
  timestamp: string
}

export default function CaseLibraryPage() {
  const [cases, setCases] = useState<CaseEntry[]>([])
  const [filteredCases, setFilteredCases] = useState<CaseEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'win' | 'loss'>('all')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [signalsRes, tradesRes] = await Promise.all([
          fetch('/api/signals/history?limit=50'),
          fetch('/api/trades?status=all&limit=50'),
        ])

        if (!signalsRes.ok || !tradesRes.ok) throw new Error('Failed to fetch')

        const signalsData = await signalsRes.json()
        const tradesData = await tradesRes.json()

        const signals = signalsData.signals || []
        const trades = tradesData.trades || []

        const caseEntries: CaseEntry[] = signals.map((sig: Signal, idx: number) => {
          const trade = trades[idx]
          return {
            id: `case-${idx}`,
            symbol: sig.symbol,
            signal_direction: sig.direction,
            outcome: (trade?.pnl || 0) > 0 ? 'win' : 'loss',
            confidence: sig.confidence,
            pnl: trade?.pnl || 0,
            timestamp: sig.timestamp,
          }
        })

        setCases(caseEntries)
        setFilteredCases(caseEntries)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  useEffect(() => {
    if (outcomeFilter === 'all') {
      setFilteredCases(cases)
    } else {
      setFilteredCases(cases.filter(c => c.outcome === outcomeFilter))
    }
  }, [outcomeFilter, cases])

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const stats = {
    total: cases.length,
    wins: cases.filter(c => c.outcome === 'win').length,
    losses: cases.filter(c => c.outcome === 'loss').length,
    winRate: cases.length > 0 ? (cases.filter(c => c.outcome === 'win').length / cases.length) : 0,
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Case Library</h1>
        <p className="text-gray-400 mb-6">Historical trading cases and outcomes</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Total Cases</div>
            <div className="text-3xl font-bold text-emerald-400">{stats.total}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Wins</div>
            <div className="text-3xl font-bold text-emerald-400">{stats.wins}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Losses</div>
            <div className="text-3xl font-bold text-red-400">{stats.losses}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Win Rate</div>
            <div className="text-3xl font-bold text-emerald-400">{(stats.winRate * 100).toFixed(1)}%</div>
          </div>
        </div>

        <div className="mb-6">
          <label className="text-gray-400 text-sm mb-2 block">Filter by Outcome</label>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as any)}
            className="bg-[#12121a] border border-[#1e1e2e] rounded px-4 py-2 text-white"
          >
            <option value="all">All Cases</option>
            <option value="win">Winning Trades</option>
            <option value="loss">Losing Trades</option>
          </select>
        </div>

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Cases</h2>
          {filteredCases.length === 0 ? (
            <p className="text-gray-400">No cases found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e2e] text-gray-400">
                    <th className="text-left py-2 px-4">Symbol</th>
                    <th className="text-center py-2 px-4">Direction</th>
                    <th className="text-right py-2 px-4">Confidence</th>
                    <th className="text-right py-2 px-4">P&L</th>
                    <th className="text-center py-2 px-4">Outcome</th>
                    <th className="text-left py-2 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.slice(0, 20).map((c) => (
                    <tr key={c.id} className="border-b border-[#1e1e2e] hover:bg-[#16161e]">
                      <td className="py-3 px-4 text-white font-mono font-semibold">{c.symbol}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${c.signal_direction === 'buy' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'}`}>
                          {c.signal_direction}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-300">
                        {(c.confidence * 100).toFixed(1)}%
                      </td>
                      <td className={`py-3 px-4 text-right font-mono font-semibold ${c.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.pnl > 0 ? '+' : ''}{c.pnl.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${c.outcome === 'win' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'}`}>
                          {c.outcome.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{new Date(c.timestamp).toLocaleString()}</td>
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
