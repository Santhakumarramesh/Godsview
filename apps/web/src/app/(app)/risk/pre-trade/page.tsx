'use client'

import React, { useState, useCallback } from 'react'
import { AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react'

interface RiskCheck {
  rule: string
  passed: boolean
  reason: string
}

interface RiskCheckResult {
  passed: boolean
  checks: RiskCheck[]
  blocked_reasons: string[]
}

export default function PreTradePage() {
  const [orderId, setOrderId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [result, setResult] = useState<RiskCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useTestOrder, setUseTestOrder] = useState(false)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setLoading(true)
      setError(null)
      setResult(null)

      let checkOrderId = orderId
      if (useTestOrder && symbol && qty) {
        checkOrderId = `TEST-${Date.now()}`
      }

      if (!checkOrderId) {
        throw new Error('Enter order ID or create a test order')
      }

      const res = await fetch(`/api/portfolio/risk/check/${checkOrderId}`)
      if (!res.ok) throw new Error('Failed to check order')
      const data: RiskCheckResult = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check order')
    } finally {
      setLoading(false)
    }
  }, [orderId, useTestOrder, symbol, qty])

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Pre-Trade Risk Gate</h1>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-400/20 bg-red-400/10 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Order Entry</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Check Order ID</label>
                <input
                  type="text"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  placeholder="ORDER-12345"
                  className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400"
                  disabled={useTestOrder}
                />
              </div>

              <div className="border-t border-[#1e1e2e] pt-4 mt-4">
                <label className="flex items-center gap-2 text-sm text-gray-400 mb-4">
                  <input
                    type="checkbox"
                    checked={useTestOrder}
                    onChange={(e) => setUseTestOrder(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Create Test Order
                </label>

                {useTestOrder && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Symbol</label>
                      <input
                        type="text"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        placeholder="AAPL"
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Side</label>
                      <select
                        value={side}
                        onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white focus:outline-none focus:border-emerald-400"
                      >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Quantity</label>
                      <input
                        type="number"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        placeholder="100"
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg bg-emerald-400 text-[#0a0a0f] font-semibold hover:bg-emerald-500 disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                Check Order
              </button>
            </form>
          </div>

          <div className="lg:col-span-2">
            {result && (
              <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
                <div className="mb-6 p-4 rounded-lg border-2 flex items-center gap-3" style={{
                  borderColor: result.passed ? '#10b981' : '#ef4444',
                  backgroundColor: result.passed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                }}>
                  {result.passed ? (
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-400" />
                  )}
                  <div>
                    <p className={`font-bold ${result.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                      {result.passed ? 'ORDER PASSED ALL CHECKS' : 'ORDER BLOCKED'}
                    </p>
                    {result.blocked_reasons.length > 0 && (
                      <p className="text-sm text-red-400">Reason: {result.blocked_reasons.join(', ')}</p>
                    )}
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-[#1e1e2e]">
                    <p className="text-gray-400 text-sm">Total Checks</p>
                    <p className="text-2xl font-bold text-white">{result.checks.length}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-[#1e1e2e]">
                    <p className="text-gray-400 text-sm">Passed</p>
                    <p className="text-2xl font-bold text-emerald-400">
                      {result.checks.filter((c) => c.passed).length}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-[#1e1e2e]">
                    <p className="text-gray-400 text-sm">Failed</p>
                    <p className="text-2xl font-bold text-red-400">
                      {result.checks.filter((c) => !c.passed).length}
                    </p>
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-white mb-3">Risk Checks</h3>
                <div className="space-y-2">
                  {result.checks.map((check, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-[#1e1e2e] bg-[#1e1e2e]/50 flex items-start gap-3"
                    >
                      {check.passed ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className={`font-semibold ${check.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                          {check.rule}
                        </p>
                        <p className="text-sm text-gray-400">{check.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!result && !error && (
              <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6 text-center">
                <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-400">Enter an order ID to check pre-trade risk</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
