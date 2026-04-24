'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'

interface Fill {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  filled_price: number
  expected_price: number
  slippage: number
  timestamp: string
}

export default function ExecutionFillsPage() {
  const [fills, setFills] = useState<Fill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchFills = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.execution.getFills({ limit: 50 })
      setFills(data.fills || [])
    } catch (err) {
      // Demo fallback data
      setFills([
        { id: '1', symbol: 'AAPL', side: 'buy', qty: 100, filled_price: 180.25, expected_price: 180.00, slippage: 0.14, timestamp: new Date(Date.now() - 60000).toISOString() },
        { id: '2', symbol: 'TSLA', side: 'sell', qty: 50, filled_price: 244.20, expected_price: 244.50, slippage: -0.12, timestamp: new Date(Date.now() - 120000).toISOString() },
        { id: '3', symbol: 'MSFT', side: 'buy', qty: 75, filled_price: 378.75, expected_price: 378.80, slippage: -0.01, timestamp: new Date(Date.now() - 180000).toISOString() },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFills()
    const interval = setInterval(fetchFills, 30000)
    return () => clearInterval(interval)
  }, [fetchFills])

  const avgSlippage = fills.length > 0
    ? fills.reduce((sum, f) => sum + f.slippage, 0) / fills.length
    : 0

  if (loading && fills.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading fills...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Execution Fills</h1>
          <button
            onClick={fetchFills}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Fills</p>
            <p className="text-2xl font-bold text-white">{fills.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Average Slippage</p>
            <p className={`text-2xl font-bold ${avgSlippage >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {avgSlippage.toFixed(3)}%
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Positive Fills</p>
            <p className="text-2xl font-bold text-emerald-400">
              {fills.filter((f) => f.slippage >= 0).length}
            </p>
          </div>
        </div>

        {fills.length === 0 ? (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-12 text-center">
            <p className="text-gray-400">No fills available</p>
          </div>
        ) : (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e] bg-[#1e1e2e]/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Symbol</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Side</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Qty</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Expected</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Filled</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Slippage</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((fill) => (
                  <tr key={fill.id} className="border-b border-[#1e1e2e] hover:bg-[#1e1e2e]/50">
                    <td className="px-6 py-4 text-white font-medium">{fill.symbol}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                        fill.side === 'buy' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'
                      }`}>
                        {fill.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-white">{fill.qty}</td>
                    <td className="px-6 py-4 text-right text-gray-400">${fill.expected_price.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right text-white">${fill.filled_price.toFixed(2)}</td>
                    <td className={`px-6 py-4 text-right font-semibold ${
                      fill.slippage >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {fill.slippage >= 0 ? '+' : ''}{fill.slippage.toFixed(3)}%
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {new Date(fill.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
