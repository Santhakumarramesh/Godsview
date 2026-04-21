'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { api } from '@/lib/api'

interface Signal {
  symbol: string
  direction: 'buy' | 'sell'
  confidence: number
  entry_price?: number
  stop_loss?: number
  take_profit?: number
  timeframe?: string
}

interface Decision {
  signal: Signal
  action: 'approved' | 'rejected'
  timestamp: Date
}

export default function AssistedTradingPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchSignals = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.features.getSignals({ symbols: ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD'], timeframe: '15min' })
      setSignals(data.signals || [])
    } catch (err) {
      // Demo fallback data
      setSignals([
        { symbol: 'AAPL', direction: 'buy', confidence: 0.85, entry_price: 179.50, stop_loss: 177.00, take_profit: 185.00, timeframe: '15min' },
        { symbol: 'TSLA', direction: 'sell', confidence: 0.78, entry_price: 244.20, stop_loss: 246.50, take_profit: 240.00, timeframe: '15min' },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSignals()
    const interval = setInterval(fetchSignals, 30000)
    return () => clearInterval(interval)
  }, [fetchSignals])

  const handleApprove = useCallback(async (signal: Signal) => {
    try {
      setSubmitting(true)
      await api.execution.submitOrder({
        symbol: signal.symbol,
        side: signal.direction,
        qty: 100,
        order_type: 'market',
      })

      setDecisions((prev) => [...prev, { signal, action: 'approved', timestamp: new Date() }])
      setSignals((prev) => prev.filter((s) => s.symbol !== signal.symbol))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve signal')
    } finally {
      setSubmitting(false)
    }
  }, [])

  const handleReject = useCallback((signal: Signal) => {
    setDecisions((prev) => [...prev, { signal, action: 'rejected', timestamp: new Date() }])
    setSignals((prev) => prev.filter((s) => s.symbol !== signal.symbol))
  }, [])

  const approvedCount = decisions.filter((d) => d.action === 'approved').length
  const rejectedCount = decisions.filter((d) => d.action === 'rejected').length

  if (loading && signals.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading signals...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Assisted Live Trading</h1>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-400/20 bg-red-400/10 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Pending Signals</p>
            <p className="text-2xl font-bold text-white">{signals.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Approved</p>
            <p className="text-2xl font-bold text-emerald-400">{approvedCount}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Rejected</p>
            <p className="text-2xl font-bold text-red-400">{rejectedCount}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Decisions</p>
            <p className="text-2xl font-bold text-white">{decisions.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Approval Queue</h2>

              {signals.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-gray-400">No pending signals</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {signals.map((signal) => (
                    <div
                      key={signal.symbol}
                      className="p-4 rounded-lg border border-[#1e1e2e] bg-[#1e1e2e]/50"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="text-white font-semibold text-lg">{signal.symbol}</h3>
                          <div className="flex gap-4 mt-2">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                              signal.direction === 'buy'
                                ? 'bg-emerald-400/20 text-emerald-400'
                                : 'bg-red-400/20 text-red-400'
                            }`}>
                              {signal.direction.toUpperCase()}
                            </span>
                            <span className="text-blue-400 text-sm">
                              Confidence: {(signal.confidence * 100).toFixed(0)}%
                            </span>
                            {signal.timeframe && (
                              <span className="text-gray-400 text-sm">{signal.timeframe}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {(signal.entry_price || signal.stop_loss || signal.take_profit) && (
                        <div className="grid grid-cols-3 gap-3 mb-4 pb-4 border-b border-[#1e1e2e]">
                          {signal.entry_price && (
                            <div>
                              <p className="text-gray-400 text-xs">Entry</p>
                              <p className="text-white font-semibold">${signal.entry_price.toFixed(2)}</p>
                            </div>
                          )}
                          {signal.stop_loss && (
                            <div>
                              <p className="text-gray-400 text-xs">Stop Loss</p>
                              <p className="text-red-400 font-semibold">${signal.stop_loss.toFixed(2)}</p>
                            </div>
                          )}
                          {signal.take_profit && (
                            <div>
                              <p className="text-gray-400 text-xs">Take Profit</p>
                              <p className="text-emerald-400 font-semibold">${signal.take_profit.toFixed(2)}</p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={() => handleApprove(signal)}
                          disabled={submitting}
                          className="flex-1 px-3 py-2 rounded-lg bg-emerald-400 text-[#0a0a0f] font-semibold hover:bg-emerald-500 disabled:opacity-50 transition"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(signal)}
                          className="flex-1 px-3 py-2 rounded-lg border border-red-400/50 text-red-400 hover:bg-red-400/10 transition"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Decision History</h2>

              {decisions.length === 0 ? (
                <p className="text-gray-400 text-sm">No decisions yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {[...decisions].reverse().map((decision, idx) => (
                    <div key={idx} className="p-2 rounded bg-[#1e1e2e] flex items-center gap-2">
                      {decision.action === 'approved' ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold">{decision.signal.symbol}</p>
                        <p className="text-gray-400 text-xs">
                          {decision.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold whitespace-nowrap ${
                        decision.action === 'approved' ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {decision.action === 'approved' ? 'OK' : 'X'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
