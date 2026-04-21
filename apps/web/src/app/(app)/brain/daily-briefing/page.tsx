'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, TrendingUp, TrendingDown, Clock } from 'lucide-react'

interface BriefingData {
  signals: Array<{ symbol: string; direction: string; confidence: number }>
  portfolio: { equity: number; cash: number }
  performance: { daily_pnl: number; win_rate: number }
}

export default function DailyBriefingPage() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatedTime, setGeneratedTime] = useState<Date | null>(null)

  const generateBriefing = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [signalsRes, portfolioRes, perfRes] = await Promise.all([
        fetch('/api/signals/live?symbols=AAPL,TSLA,MSFT,NVDA,AMD&timeframe=15min'),
        fetch('/api/portfolio/snapshot'),
        fetch('/api/trades/pnl'),
      ])

      if (!signalsRes.ok || !portfolioRes.ok || !perfRes.ok) {
        throw new Error('Failed to fetch briefing data')
      }

      const [signalsData, portfolioData, perfData] = await Promise.all([
        signalsRes.json(),
        portfolioRes.json(),
        perfRes.json(),
      ])

      setBriefing({
        signals: signalsData.signals || [],
        portfolio: portfolioData,
        performance: perfData,
      })
      setGeneratedTime(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    generateBriefing()
  }, [generateBriefing])

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(val)

  if (loading && !briefing) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Generating daily briefing...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Daily Briefing</h1>
          <button
            onClick={generateBriefing}
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

        {generatedTime && (
          <div className="mb-6 flex items-center gap-2 text-gray-400 text-sm">
            <Clock className="w-4 h-4" />
            Generated at {generatedTime.toLocaleTimeString()}
          </div>
        )}

        <div className="space-y-6">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Account Overview</h2>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-gray-400 text-sm mb-2">Total Equity</p>
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(briefing?.portfolio.equity || 0)}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-2">Cash Available</p>
                <p className="text-2xl font-bold text-blue-400">
                  {formatCurrency(briefing?.portfolio.cash || 0)}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-2">Daily P&L</p>
                <p className={`text-2xl font-bold ${(briefing?.performance.daily_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatCurrency(briefing?.performance.daily_pnl || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Performance Summary</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-[#1e1e2e]">
                <p className="text-gray-400 text-sm mb-1">Win Rate</p>
                <p className="text-lg font-semibold text-emerald-400">
                  {((briefing?.performance.win_rate || 0) * 100).toFixed(0)}%
                </p>
              </div>
              <div className="p-4 rounded-lg bg-[#1e1e2e]">
                <p className="text-gray-400 text-sm mb-1">Risk Status</p>
                <p className="text-lg font-semibold text-emerald-400">Normal</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Top Opportunities</h2>

            {(briefing?.signals || []).length === 0 ? (
              <p className="text-gray-400">No signals generated</p>
            ) : (
              <div className="space-y-3">
                {(briefing?.signals || []).slice(0, 5).map((signal, idx) => (
                  <div key={idx} className="p-4 rounded-lg border border-[#1e1e2e] bg-[#1e1e2e]/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {signal.direction === 'buy' ? (
                          <TrendingUp className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <TrendingDown className="w-5 h-5 text-red-400" />
                        )}
                        <div>
                          <p className="text-white font-semibold">{signal.symbol}</p>
                          <p className="text-gray-400 text-sm">
                            {signal.direction === 'buy' ? 'Buy Signal' : 'Sell Signal'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-semibold">
                          {(signal.confidence * 100).toFixed(0)}%
                        </p>
                        <p className="text-gray-400 text-xs">Confidence</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Action Items</h2>

            <ul className="space-y-2">
              <li className="flex items-center gap-3 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Review {(briefing?.signals || []).length} active signals
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                Check portfolio allocation vs targets
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                Monitor risk policies for threshold breaches
              </li>
              {(briefing?.portfolio.cash || 0) > (briefing?.portfolio.equity || 1) * 0.2 && (
                <li className="flex items-center gap-3 text-gray-300">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  High idle capital - consider deploying
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
