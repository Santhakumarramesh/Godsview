'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, TrendingUp, Shield } from 'lucide-react'

interface PerformanceMetrics {
  profitFactor: number
  winRate: number
  maxDrawdown: number
  totalTrades: number
  avgWin: number
  avgLoss: number
}

interface AutoTrade {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  entry_price: number
  current_price: number
  pnl: number
}

export default function AutonomousPage() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)
  const [autoTrades, setAutoTrades] = useState<AutoTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [metricsRes, tradesRes] = await Promise.all([
        fetch('/api/trades/pnl'),
        fetch('/api/trades?status=open&limit=50'),
      ])

      if (!metricsRes.ok || !tradesRes.ok) {
        throw new Error('Failed to fetch data')
      }

      const metricsData = await metricsRes.json()
      const tradesData = await tradesRes.json()

      setMetrics({
        profitFactor: metricsData.profit_factor || 1.0,
        winRate: metricsData.win_rate || 0,
        maxDrawdown: metricsData.max_drawdown || 0,
        totalTrades: metricsData.total_trades || 0,
        avgWin: metricsData.avg_win || 0,
        avgLoss: metricsData.avg_loss || 0,
      })

      setAutoTrades(tradesData.trades || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  const isEligible =
    metrics &&
    metrics.profitFactor > 1.5 &&
    metrics.winRate > 0.55 &&
    metrics.maxDrawdown < 0.1

  const autonomyTier = isEligible ? 'FULL' : 'RESTRICTED'

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(val)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading autonomy data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Autonomous Candidate Mode</h1>
          <button
            onClick={fetchData}
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

        <div className="mb-8 p-6 rounded-lg border-2 flex items-center justify-between" style={{
          borderColor: isEligible ? '#10b981' : '#f59e0b',
          backgroundColor: isEligible ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
        }}>
          <div className="flex items-center gap-4">
            <Shield className={`w-8 h-8 ${isEligible ? 'text-emerald-400' : 'text-yellow-400'}`} />
            <div>
              <p className={`text-lg font-bold ${isEligible ? 'text-emerald-400' : 'text-yellow-400'}`}>
                Autonomy Tier: {autonomyTier}
              </p>
              <p className="text-gray-400 text-sm">
                {isEligible
                  ? 'Eligible for autonomous trading - all performance gates passed'
                  : 'Restricted - performance gates not met'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Active Auto-Trades</p>
            <p className="text-2xl font-bold text-white">{autoTrades.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Trades</p>
            <p className="text-2xl font-bold text-white">{metrics?.totalTrades || 0}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Avg Win / Loss</p>
            <p className="text-2xl font-bold">
              <span className="text-emerald-400">{formatCurrency(metrics?.avgWin || 0)}</span>
              <span className="text-gray-400 mx-1">/</span>
              <span className="text-red-400">{formatCurrency(Math.abs(metrics?.avgLoss || 0))}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-6">Performance Gates</h2>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Profit Factor</span>
                  <span className={`font-semibold ${(metrics?.profitFactor || 0) > 1.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {metrics?.profitFactor.toFixed(2)} {(metrics?.profitFactor || 0) > 1.5 ? '✓' : '✗'}
                  </span>
                </div>
                <div className="w-full bg-[#1e1e2e] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${(metrics?.profitFactor || 0) > 1.5 ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(((metrics?.profitFactor || 0) / 2.5) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Required: {'>'} 1.5x</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Win Rate</span>
                  <span className={`font-semibold ${(metrics?.winRate || 0) > 0.55 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {((metrics?.winRate || 0) * 100).toFixed(0)}% {(metrics?.winRate || 0) > 0.55 ? '✓' : '✗'}
                  </span>
                </div>
                <div className="w-full bg-[#1e1e2e] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${(metrics?.winRate || 0) > 0.55 ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min((metrics?.winRate || 0) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Required: {'>'} 55%</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Max Drawdown</span>
                  <span className={`font-semibold ${(metrics?.maxDrawdown || 0) < 0.1 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {((metrics?.maxDrawdown || 0) * 100).toFixed(1)}% {(metrics?.maxDrawdown || 0) < 0.1 ? '✓' : '✗'}
                  </span>
                </div>
                <div className="w-full bg-[#1e1e2e] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${(metrics?.maxDrawdown || 0) < 0.1 ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min((metrics?.maxDrawdown || 0) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Required: {'<'} 10%</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Active Auto-Trades</h2>

            {autoTrades.length === 0 ? (
              <p className="text-gray-400">No active auto-trades</p>
            ) : (
              <div className="space-y-2">
                {autoTrades.slice(0, 6).map((trade) => (
                  <div key={trade.id} className="p-3 rounded-lg bg-[#1e1e2e]">
                    <div className="flex items-center justify-between">
                      <span className="text-white font-semibold">{trade.symbol}</span>
                      <span className={`text-sm font-semibold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(trade.pnl)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>{trade.side.toUpperCase()} {trade.qty}</span>
                      <span>Entry: {trade.entry_price.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="text-center">
          <a
            href="/execution/killswitch"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-red-400/50 text-red-400 hover:bg-red-400/10 transition"
          >
            View Kill Switch
          </a>
        </div>
      </div>
    </div>
  )
}
