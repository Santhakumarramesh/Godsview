'use client'

import { useState, useMemo } from 'react'
import { Search, TrendingUp, TrendingDown, Percent } from 'lucide-react'

interface Match {
  id: string
  date: string
  symbol: string
  timeframe: string
  setup: string
  similarity: number
  outcome: 'win' | 'loss' | 'breakeven'
  winRate: number
  avgPnl: number
  trades: number
}

const mockMatches: Match[] = [
  {
    id: 'm1',
    date: '2024-03-15',
    symbol: 'EURUSD',
    timeframe: '15m',
    setup: 'Bollinger Squeeze + RSI Divergence',
    similarity: 94,
    outcome: 'win',
    winRate: 0.62,
    avgPnl: 45.2,
    trades: 18,
  },
  {
    id: 'm2',
    date: '2024-02-28',
    symbol: 'AUDUSD',
    timeframe: '15m',
    setup: 'Bollinger Squeeze + RSI Divergence',
    similarity: 91,
    outcome: 'win',
    winRate: 0.58,
    avgPnl: 38.5,
    trades: 22,
  },
  {
    id: 'm3',
    date: '2024-02-10',
    symbol: 'GBPUSD',
    timeframe: '15m',
    setup: 'Bollinger Squeeze + RSI Divergence',
    similarity: 87,
    outcome: 'loss',
    winRate: 0.44,
    avgPnl: -22.8,
    trades: 25,
  },
  {
    id: 'm4',
    date: '2024-01-20',
    symbol: 'NZDUSD',
    timeframe: '15m',
    setup: 'Bollinger Squeeze + RSI Divergence',
    similarity: 85,
    outcome: 'win',
    winRate: 0.59,
    avgPnl: 42.0,
    trades: 17,
  },
  {
    id: 'm5',
    date: '2023-12-15',
    symbol: 'USDCAD',
    timeframe: '15m',
    setup: 'Bollinger Squeeze + RSI Divergence',
    similarity: 82,
    outcome: 'win',
    winRate: 0.61,
    avgPnl: 48.5,
    trades: 20,
  },
]

export default function SimilaritySearchPage() {
  const [symbol, setSymbol] = useState('EURUSD')
  const [sortBy, setSortBy] = useState<'similarity' | 'recent' | 'outcome'>('similarity')
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'wins' | 'losses'>('all')

  const filteredMatches = useMemo(() => {
    let filtered = outcomeFilter === 'all' ? mockMatches : mockMatches.filter(m => {
      if (outcomeFilter === 'wins') return m.outcome !== 'loss'
      return m.outcome === 'loss'
    })

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'recent': return new Date(b.date).getTime() - new Date(a.date).getTime()
        case 'outcome': return (a.outcome === 'win' ? -1 : 1) - (b.outcome === 'win' ? -1 : 1)
        default: return b.similarity - a.similarity
      }
    })
  }, [sortBy, outcomeFilter])

  const winRate = (mockMatches.filter(m => m.outcome === 'win').length / mockMatches.length * 100).toFixed(1)
  const avgSimilarity = (mockMatches.reduce((s, m) => s + m.similarity, 0) / mockMatches.length).toFixed(0)
  const totalTrades = mockMatches.reduce((s, m) => s + m.trades, 0)

  const currentSetup = {
    symbol: 'EURUSD',
    timeframe: '15m',
    setup: 'Bollinger Squeeze + RSI Divergence',
    timestamp: '2024-04-20 14:32:00',
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Search className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">Setup Similarity Search</h1>
          </div>
          <p className="text-gray-400">Find similar historical setups and analyze their outcomes</p>
        </div>

        <div className="border border-emerald-700/50 bg-emerald-900/20 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-4">Current Setup</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <div className="text-gray-400 text-sm mb-1">Symbol</div>
              <div className="text-white font-semibold text-lg">{currentSetup.symbol}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-1">Timeframe</div>
              <div className="text-white font-semibold text-lg">{currentSetup.timeframe}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-1">Setup Pattern</div>
              <div className="text-white font-semibold text-sm">{currentSetup.setup}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-1">Timestamp</div>
              <div className="text-gray-300 font-mono text-xs">{currentSetup.timestamp}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Similar Setups Found</div>
            <div className="text-3xl font-bold text-emerald-400">{mockMatches.length}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Historical Win Rate</div>
            <div className="text-3xl font-bold text-blue-400">{winRate}%</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Average Similarity</div>
            <div className="text-3xl font-bold text-purple-400">{avgSimilarity}%</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Total Historical Trades</div>
            <div className="text-3xl font-bold text-yellow-400">{totalTrades}</div>
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-white">Historical Matches</h2>
            <div className="flex flex-wrap gap-2">
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value as any)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white hover:border-gray-600"
              >
                <option value="all">All Outcomes</option>
                <option value="wins">Winning Setups</option>
                <option value="losses">Losing Setups</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white hover:border-gray-600"
              >
                <option value="similarity">Sort by Similarity</option>
                <option value="recent">Sort by Recent</option>
                <option value="outcome">Sort by Outcome</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {filteredMatches.map((match) => (
              <div key={match.id} className="border border-gray-800 rounded-lg p-4 hover:border-gray-700 hover:bg-gray-800/30 transition-all">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div>
                        <h3 className="text-white font-semibold">{match.symbol}</h3>
                        <p className="text-gray-400 text-sm">{match.setup}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold flex-shrink-0 ${
                        match.outcome === 'win'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : match.outcome === 'loss'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-700/50 text-gray-400'
                      }`}>
                        {match.outcome === 'win' ? '✓ Win' : match.outcome === 'loss' ? '✗ Loss' : '= Breakeven'}
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs">{match.date} • {match.timeframe}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 md:gap-4 min-w-fit">
                    <div className="text-right">
                      <div className="text-gray-400 text-xs mb-1">Similarity</div>
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-16 h-2 bg-gray-800 rounded overflow-hidden">
                          <div
                            className={`h-full ${match.similarity >= 90 ? 'bg-emerald-500' : match.similarity >= 85 ? 'bg-blue-500' : 'bg-gray-600'}`}
                            style={{ width: `${match.similarity}%` }}
                          />
                        </div>
                        <span className="text-white font-semibold text-sm w-10">{match.similarity}%</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-gray-400 text-xs mb-1">Win Rate</div>
                      <div className="text-white font-semibold">{(match.winRate * 100).toFixed(0)}%</div>
                    </div>

                    <div className="text-right">
                      <div className="text-gray-400 text-xs mb-1">Avg P&L</div>
                      <div className={match.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        <div className="font-semibold">${match.avgPnl.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Outcome Distribution</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Winning Setups</span>
                  <span className="text-emerald-400 font-semibold">{mockMatches.filter(m => m.outcome === 'win').length}</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${(mockMatches.filter(m => m.outcome === 'win').length / mockMatches.length) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Losing Setups</span>
                  <span className="text-red-400 font-semibold">{mockMatches.filter(m => m.outcome === 'loss').length}</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${(mockMatches.filter(m => m.outcome === 'loss').length / mockMatches.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Performance Metrics</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-3 border-b border-gray-800">
                <span className="text-gray-400">Best Match</span>
                <span className="text-white font-semibold">{Math.max(...mockMatches.map(m => m.similarity))}%</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-gray-800">
                <span className="text-gray-400">Weakest Match</span>
                <span className="text-white font-semibold">{Math.min(...mockMatches.map(m => m.similarity))}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Avg Historical P&L</span>
                <span className="text-emerald-400 font-semibold">${(mockMatches.reduce((s, m) => s + m.avgPnl, 0) / mockMatches.length).toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
