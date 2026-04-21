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

interface Trade {
  id: string
  symbol: string
  pnl: number
  timestamp: string
}

interface Lesson {
  id: string
  title: string
  description: string
  frequency: number
  impact: 'high' | 'medium' | 'low'
}

export default function LearningLoopPage() {
  const [backtests, setBacktests] = useState<BacktestResult[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [backtestRes, tradesRes] = await Promise.all([
          fetch('/api/backtest/results?limit=30'),
          fetch('/api/trades?status=all&limit=30'),
        ])

        if (!backtestRes.ok || !tradesRes.ok) throw new Error('Failed to fetch')

        const backtestData = await backtestRes.json()
        const tradesData = await tradesRes.json()

        const backtest = backtestData.results || []
        const trade = tradesData.trades || []

        setBacktests(backtest)
        setTrades(trade)

        deriveLessons(backtest, trade)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const deriveLessons = (backtests: BacktestResult[], trades: Trade[]) => {
    const derivedLessons: Lesson[] = []

    const lowWinRateTests = backtests.filter(b => b.win_rate < 0.4).length
    if (lowWinRateTests > 0) {
      derivedLessons.push({
        id: '1',
        title: 'Improve Entry Filters',
        description: `${lowWinRateTests} strategies with low win rates detected. Strengthen entry conditions with price action confirmation.`,
        frequency: lowWinRateTests,
        impact: 'high',
      })
    }

    const losingTrades = trades.filter(t => t.pnl < 0).length
    if (losingTrades > trades.length / 2) {
      derivedLessons.push({
        id: '2',
        title: 'Risk Management Review',
        description: 'More than 50% of trades are losses. Review position sizing and stop-loss placement.',
        frequency: losingTrades,
        impact: 'high',
      })
    }

    const highDDTests = backtests.filter(b => b.max_dd > 0.3).length
    if (highDDTests > 0) {
      derivedLessons.push({
        id: '3',
        title: 'Drawdown Control',
        description: `${highDDTests} strategies exceed 30% drawdown. Consider using trailing stops or correlation filters.`,
        frequency: highDDTests,
        impact: 'medium',
      })
    }

    const volatileWinRate = backtests.filter(b => Math.abs(b.win_rate - 0.5) < 0.05).length
    if (volatileWinRate > 0) {
      derivedLessons.push({
        id: '4',
        title: 'Consistency Improvement',
        description: 'Win rates clustering around 50% suggest random entry signals. Add confluence filters.',
        frequency: volatileWinRate,
        impact: 'medium',
      })
    }

    const lowSharpe = backtests.filter(b => b.sharpe < 0.5).length
    if (lowSharpe > 0) {
      derivedLessons.push({
        id: '5',
        title: 'Risk-Adjusted Returns',
        description: 'Focus on Sharpe ratio improvement. Optimize leverage and volatility management.',
        frequency: lowSharpe,
        impact: 'medium',
      })
    }

    setLessons(derivedLessons.sort((a, b) => b.frequency - a.frequency))
  }

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const backtestAccuracy = backtests.length > 0 ? backtests.filter(b => b.pf > 1).length / backtests.length : 0
  const tradeAccuracy = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0
  const alignmentScore = Math.abs(backtestAccuracy - tradeAccuracy) * 100

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Learning Loop Dashboard</h1>
        <p className="text-gray-400 mb-6">Compare backtests vs live trades and identify improvement opportunities</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Backtest Accuracy</div>
            <div className="text-3xl font-bold text-emerald-400">{(backtestAccuracy * 100).toFixed(1)}%</div>
            <div className="text-gray-500 text-xs mt-2">{backtests.filter(b => b.pf > 1).length} of {backtests.length}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Live Trade Accuracy</div>
            <div className="text-3xl font-bold text-emerald-400">{(tradeAccuracy * 100).toFixed(1)}%</div>
            <div className="text-gray-500 text-xs mt-2">{trades.filter(t => t.pnl > 0).length} of {trades.length}</div>
          </div>
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-2">Model-Reality Gap</div>
            <div className={`text-3xl font-bold ${alignmentScore < 15 ? 'text-emerald-400' : alignmentScore < 30 ? 'text-yellow-400' : 'text-red-400'}`}>
              {alignmentScore.toFixed(1)}%
            </div>
            <div className="text-gray-500 text-xs mt-2">
              {alignmentScore < 15 && 'Well-aligned'}
              {alignmentScore >= 15 && alignmentScore < 30 && 'Moderate drift'}
              {alignmentScore >= 30 && 'Significant drift'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Backtest Predictions</h2>
            {backtests.length === 0 ? (
              <p className="text-gray-400">No backtests</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Profit Factor</span>
                  <span className="text-emerald-400 font-bold">{(backtests.reduce((a, b) => a + b.pf, 0) / backtests.length).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Win Rate</span>
                  <span className="text-emerald-400 font-bold">{((backtests.reduce((a, b) => a + b.win_rate, 0) / backtests.length) * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Sharpe</span>
                  <span className="text-emerald-400 font-bold">{(backtests.reduce((a, b) => a + b.sharpe, 0) / backtests.length).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Live Trade Results</h2>
            {trades.length === 0 ? (
              <p className="text-gray-400">No trades</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total P&L</span>
                  <span className={`font-bold ${trades.reduce((a, t) => a + t.pnl, 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trades.reduce((a, t) => a + t.pnl, 0) > 0 ? '+' : ''}{trades.reduce((a, t) => a + t.pnl, 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Win Rate</span>
                  <span className="text-emerald-400 font-bold">{(tradeAccuracy * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg P&L</span>
                  <span className={`font-bold ${trades.reduce((a, t) => a + t.pnl, 0) / trades.length > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(trades.reduce((a, t) => a + t.pnl, 0) / trades.length).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Top Lessons Learned</h2>
          {lessons.length === 0 ? (
            <p className="text-gray-400">No lessons identified yet</p>
          ) : (
            <div className="space-y-3">
              {lessons.slice(0, 5).map((lesson) => (
                <div key={lesson.id} className="border border-[#1e1e2e] bg-[#0a0a0f] rounded-lg p-4 hover:border-emerald-400/30 transition">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-white font-semibold">{lesson.title}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${lesson.impact === 'high' ? 'bg-red-400/20 text-red-400' : lesson.impact === 'medium' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-blue-400/20 text-blue-400'}`}>
                      {lesson.impact.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm mb-2">{lesson.description}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-24 bg-[#12121a] border border-[#1e1e2e] rounded overflow-hidden h-1.5">
                      <div className="bg-red-400 h-full" style={{ width: `${Math.min(100, lesson.frequency * 15)}%` }} />
                    </div>
                    <span>{lesson.frequency} occurrences</span>
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
