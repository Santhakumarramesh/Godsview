'use client'

import { useState, useEffect } from 'react'

interface Trade {
  id: string
  symbol: string
  direction: string
  entry_price: number
  exit_price: number
  pnl: number
  timestamp: string
  status: string
}

export default function TradeJournalPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [notes, setNotes] = useState<{ [key: string]: string }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '2024-01-01',
    end: '2024-12-31',
  })

  useEffect(() => {
    const fetchTrades = async () => {
      try {
        const res = await fetch('/api/trades?status=all&limit=50')
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        setTrades(data.trades || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading')
      } finally {
        setLoading(false)
      }
    }
    fetchTrades()
  }, [])

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const stats = {
    totalTrades: trades.length,
    winners: trades.filter(t => t.pnl > 0).length,
    losers: trades.filter(t => t.pnl < 0).length,
    winRate: trades.length > 0 ? (trades.filter(t => t.pnl > 0).length / trades.length) : 0,
    avgPnL: trades.length > 0 ? trades.reduce((a, t) => a + t.pnl, 0) / trades.length : 0,
    biggest: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
    worst: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0,
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Trade Journal</h1>
        <p className="text-gray-400 mb-6">Document and analyze your trading activity</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Total Trades</div>
            <div className="text-3xl font-bold text-emerald-400">{stats.totalTrades}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Win Rate</div>
            <div className="text-3xl font-bold text-emerald-400">{(stats.winRate * 100).toFixed(1)}%</div>
            <div className="text-gray-500 text-xs mt-1">{stats.winners}W / {stats.losers}L</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Avg P&L</div>
            <div className={`text-3xl font-bold ${stats.avgPnL > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.avgPnL > 0 ? '+' : ''}{stats.avgPnL.toFixed(2)}
            </div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Best / Worst</div>
            <div className="text-emerald-400 font-bold text-sm">+{stats.biggest.toFixed(2)}</div>
            <div className="text-red-400 font-bold text-sm">{stats.worst.toFixed(2)}</div>
          </div>
        </div>

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Trade Journal Entries</h2>
          {trades.length === 0 ? (
            <p className="text-gray-400">No trades found</p>
          ) : (
            <div className="space-y-4">
              {trades.slice(0, 20).map((trade) => (
                <div key={trade.id} className="border border-[#1e1e2e] bg-[#0a0a0f] rounded-lg p-4 hover:border-emerald-400/30 transition">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-white font-semibold text-lg">{trade.symbol}</div>
                        <div className="text-gray-500 text-xs">{new Date(trade.timestamp).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className={`text-lg font-bold ${trade.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-3 text-sm">
                    <div>
                      <div className="text-gray-400 text-xs mb-1">Entry</div>
                      <div className="text-white font-mono">${trade.entry_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs mb-1">Exit</div>
                      <div className="text-white font-mono">${trade.exit_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs mb-1">Direction</div>
                      <div className={`font-semibold ${trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trade.direction.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  <textarea
                    placeholder="Add notes about this trade..."
                    value={notes[trade.id] || ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [trade.id]: e.target.value }))}
                    className="w-full bg-[#12121a] border border-[#1e1e2e] rounded px-3 py-2 text-white text-sm resize-none h-16"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
