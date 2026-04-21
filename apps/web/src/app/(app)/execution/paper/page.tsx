'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, Trash2 } from 'lucide-react'

interface Trade {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  entry_price: number
  current_price: number
  pnl: number
  status: string
  opened_at: string
}

export default function PaperTradingPage() {
  const [positions, setPositions] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    symbol: '',
    side: 'buy' as 'buy' | 'sell',
    qty: '',
    type: 'market' as 'market' | 'limit',
    limit_price: '',
  })

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/trades?status=open&limit=50')
      if (!res.ok) throw new Error('Failed to fetch positions')
      const data = await res.json()
      setPositions(data.trades || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPositions()
    const interval = setInterval(fetchPositions, 10000)
    return () => clearInterval(interval)
  }, [fetchPositions])

  const handleSubmitOrder = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.symbol || !formData.qty) {
      setError('Symbol and quantity required')
      return
    }

    try {
      setSubmitting(true)
      const payload: any = {
        symbol: formData.symbol.toUpperCase(),
        side: formData.side,
        qty: parseInt(formData.qty),
        order_type: formData.type,
        paper_mode: true,
      }

      if (formData.type === 'limit' && formData.limit_price) {
        payload.limit_price = parseFloat(formData.limit_price)
      }

      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error('Failed to submit order')
      setFormData({ symbol: '', side: 'buy', qty: '', type: 'market', limit_price: '' })
      await fetchPositions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit order')
    } finally {
      setSubmitting(false)
    }
  }, [formData, fetchPositions])

  const handleClosePosition = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/trades/${id}?reason=manual`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to close position')
      await fetchPositions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close position')
    }
  }, [fetchPositions])

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0)
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(val)

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Paper Trading Arena</h1>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-400/20 bg-red-400/10 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-1">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Submit Paper Order</h2>

              <form onSubmit={handleSubmitOrder} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Symbol</label>
                  <input
                    type="text"
                    value={formData.symbol}
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                    placeholder="AAPL"
                    className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Side</label>
                    <select
                      value={formData.side}
                      onChange={(e) => setFormData({ ...formData, side: e.target.value as 'buy' | 'sell' })}
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
                      value={formData.qty}
                      onChange={(e) => setFormData({ ...formData, qty: e.target.value })}
                      placeholder="100"
                      className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Order Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'market' | 'limit' })}
                    className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white focus:outline-none focus:border-emerald-400"
                  >
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>

                {formData.type === 'limit' && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Limit Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.limit_price}
                      onChange={(e) => setFormData({ ...formData, limit_price: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-4 py-2 rounded-lg bg-emerald-400 text-[#0a0a0f] font-semibold hover:bg-emerald-500 disabled:opacity-50 transition"
                >
                  {submitting ? 'Submitting...' : 'Submit Order'}
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-2">Open Positions</p>
                  <p className="text-2xl font-bold text-white">{positions.length}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-2">Total Paper P&L</p>
                  <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(totalPnl)}
                  </p>
                </div>
              </div>
            </div>

            {positions.length === 0 ? (
              <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-12 text-center">
                <p className="text-gray-400">No open paper positions</p>
              </div>
            ) : (
              <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e1e2e] bg-[#1e1e2e]/50">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">Symbol</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">Side</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-400">Qty</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-400">Entry</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-400">Current</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-400">P&L</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-400">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <tr key={pos.id} className="border-b border-[#1e1e2e] hover:bg-[#1e1e2e]/50">
                        <td className="px-4 py-3 text-white font-medium">{pos.symbol}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            pos.side === 'buy' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'
                          }`}>
                            {pos.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-white">{pos.qty}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{formatCurrency(pos.entry_price)}</td>
                        <td className="px-4 py-3 text-right text-white">{formatCurrency(pos.current_price)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${
                          pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {formatCurrency(pos.pnl)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleClosePosition(pos.id)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-400/20 text-red-400 hover:bg-red-400/30 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
