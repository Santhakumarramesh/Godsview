'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, TrendingUp, ZapOff } from 'lucide-react'
import { api } from "@/lib/api"

interface Strategy {
  name: string
  type: string
  activeSymbols: number
  recentReturn: number
  status: 'active' | 'paused' | 'warming'
  symbolsList: string[]
}

export default function StrategyRadarPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('all')

  const fetchStrategies = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/signals/live?symbols=AAPL,TSLA,MSFT,NVDA,AMD&timeframe=15min')
      if (!res.ok) throw new Error('Failed to fetch strategies')

      const data = await res.json()

      const mockStrategies: Strategy[] = [
        {
          name: 'Momentum Breakout',
          type: 'momentum',
          activeSymbols: 3,
          recentReturn: 2.45,
          status: 'active',
          symbolsList: ['AAPL', 'MSFT', 'NVDA'],
        },
        {
          name: 'Mean Reversion',
          type: 'mean-reversion',
          activeSymbols: 2,
          recentReturn: -0.8,
          status: 'active',
          symbolsList: ['TSLA', 'AMD'],
        },
        {
          name: 'Trend Following',
          type: 'trend',
          activeSymbols: 4,
          recentReturn: 1.23,
          status: 'active',
          symbolsList: ['AAPL', 'MSFT', 'TSLA', 'NVDA'],
        },
        {
          name: 'Volatility Reversion',
          type: 'volatility',
          activeSymbols: 0,
          recentReturn: 0,
          status: 'paused',
          symbolsList: [],
        },
        {
          name: 'Correlation Pairs',
          type: 'pairs',
          activeSymbols: 1,
          recentReturn: 0.56,
          status: 'warming',
          symbolsList: ['AAPL'],
        },
      ]

      setStrategies(mockStrategies)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch strategies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStrategies()
    const interval = setInterval(fetchStrategies, 30000)
    return () => clearInterval(interval)
  }, [fetchStrategies])

  const filteredStrategies =
    filterType === 'all' ? strategies : strategies.filter((s) => s.type === filterType)

  const activeCount = strategies.filter((s) => s.status === 'active').length
  const totalActiveSymbols = strategies.reduce((sum, s) => sum + s.activeSymbols, 0)
  const avgReturn = strategies.length > 0
    ? strategies.reduce((sum, s) => sum + s.recentReturn, 0) / strategies.length
    : 0

  if (loading && strategies.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading strategies...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Strategy Radar</h1>
          <button
            onClick={fetchStrategies}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#1e1e2e] bg-[#12121a] hover:bg-[#1e1e2e] text-white transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-400/20 bg-red-400/10 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Strategies</p>
            <p className="text-2xl font-bold text-white">{strategies.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Active</p>
            <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Active Symbols</p>
            <p className="text-2xl font-bold text-white">{totalActiveSymbols}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Avg Return</p>
            <p className={`text-2xl font-bold ${avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {avgReturn.toFixed(2)}%
            </p>
          </div>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          {['all', 'momentum', 'mean-reversion', 'trend', 'volatility', 'pairs'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap font-semibold transition ${
                filterType === type
                  ? 'bg-emerald-400 text-[#0a0a0f]'
                  : 'bg-[#12121a] border border-[#1e1e2e] text-gray-400 hover:border-emerald-400/50'
              }`}
            >
              {type === 'all' ? 'All' : type.replace('-', ' ').toUpperCase()}
            </button>
          ))}
        </div>

        {filteredStrategies.length === 0 ? (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-12 text-center">
            <p className="text-gray-400">No strategies match this filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredStrategies.map((strategy) => (
              <div
                key={strategy.name}
                className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6 hover:border-emerald-400/50 transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{strategy.name}</h3>
                    <p className="text-gray-400 text-sm capitalize">{strategy.type.replace('-', ' ')}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      strategy.status === 'active'
                        ? 'bg-emerald-400/20 text-emerald-400'
                        : strategy.status === 'paused'
                        ? 'bg-red-400/20 text-red-400'
                        : 'bg-yellow-400/20 text-yellow-400'
                    }`}
                  >
                    {strategy.status === 'active' ? '● Active' : strategy.status === 'paused' ? '◯ Paused' : '◐ Warming'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Active Symbols</p>
                    <p className="text-2xl font-bold text-white">{strategy.activeSymbols}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Recent Return</p>
                    <p className={`text-2xl font-bold ${strategy.recentReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {strategy.recentReturn.toFixed(2)}%
                    </p>
                  </div>
                </div>

                {strategy.symbolsList.length > 0 && (
                  <div className="mb-4">
                    <p className="text-gray-400 text-xs mb-2">Symbols</p>
                    <div className="flex flex-wrap gap-2">
                      {strategy.symbolsList.map((symbol) => (
                        <span
                          key={symbol}
                          className="px-2 py-1 rounded-lg bg-[#1e1e2e] text-gray-300 text-xs font-semibold"
                        >
                          {symbol}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  {strategy.status === 'active' && (
                    <>
                      <button className="flex-1 px-3 py-2 rounded-lg bg-emerald-400/20 text-emerald-400 hover:bg-emerald-400/30 text-sm font-semibold transition">
                        View Details
                      </button>
                      <button className="flex-1 px-3 py-2 rounded-lg border border-red-400/50 text-red-400 hover:bg-red-400/10 text-sm font-semibold transition">
                        Pause
                      </button>
                    </>
                  )}
                  {strategy.status === 'paused' && (
                    <button className="w-full px-3 py-2 rounded-lg bg-emerald-400/20 text-emerald-400 hover:bg-emerald-400/30 text-sm font-semibold transition">
                      Resume
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
