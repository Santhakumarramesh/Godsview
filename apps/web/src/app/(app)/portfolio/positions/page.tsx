'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'

interface Position {
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

interface DetailPanel {
  position: Position
  weight: number
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<DetailPanel | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/trades?status=open&limit=50')
      if (!res.ok) throw new Error('Failed to fetch positions')
      const data = await res.json()
      setPositions(data.trades || [])
      setLastRefresh(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPositions()
    const interval = setInterval(fetchPositions, 15000)
    return () => clearInterval(interval)
  }, [fetchPositions])

  const totalPositions = positions.length
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.pnl, 0)
  const largestWinner = positions.reduce((max, p) => (p.pnl > max.pnl ? p : max), positions[0] || null)
  const largestLoser = positions.reduce((min, p) => (p.pnl < min.pnl ? p : min), positions[0] || null)

  const totalValue = positions.reduce((sum, p) => sum + (p.current_price * p.qty), 0)

  const handleRowClick = (position: Position) => {
    const weight = totalValue > 0 ? ((position.current_price * position.qty) / totalValue) * 100 : 0
    setSelectedDetail({ position, weight })
  }

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(val)

  const getTimeInTrade = (openedAt: string) => {
    const hours = Math.floor((Date.now() - new Date(openedAt).getTime()) / (1000 * 60 * 60))
    return hours > 0 ? `${hours}h` : '<1h'
  }

  if (loading && positions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading positions...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Position Monitor</h1>
          <button
            onClick={fetchPositions}
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
            <p className="text-gray-400 text-sm mb-2">Total Positions</p>
            <p className="text-2xl font-bold text-white">{totalPositions}</p>
          </div>
          <div className={`rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4`}>
            <p className="text-gray-400 text-sm mb-2">Total Unrealized P&L</p>
            <p className={`text-2xl font-bold ${totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(totalUnrealizedPnl)}
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Largest Winner</p>
            <p className="text-lg font-bold text-emerald-400">
              {largestWinner ? `${largestWinner.symbol} +${formatCurrency(largestWinner.pnl)}` : 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Largest Loser</p>
            <p className="text-lg font-bold text-red-400">
              {largestLoser ? `${largestLoser.symbol} ${formatCurrency(largestLoser.pnl)}` : 'N/A'}
            </p>
          </div>
        </div>

        {positions.length === 0 ? (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-12 text-center">
            <p className="text-gray-400">No open positions</p>
          </div>
        ) : (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Symbol</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Side</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Qty</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Entry</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Current</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">P&L</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Weight %</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const weight = totalValue > 0 ? ((pos.current_price * pos.qty) / totalValue) * 100 : 0
                  const pnlPercent = ((pos.current_price - pos.entry_price) / pos.entry_price) * 100
                  return (
                    <tr
                      key={pos.id}
                      onClick={() => handleRowClick(pos)}
                      className="border-b border-[#1e1e2e] hover:bg-[#1e1e2e] cursor-pointer transition"
                    >
                      <td className="px-6 py-4 text-white font-medium">{pos.symbol}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          pos.side === 'buy' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'
                        }`}>
                          {pos.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-white">{pos.qty}</td>
                      <td className="px-6 py-4 text-right text-gray-400">{formatCurrency(pos.entry_price)}</td>
                      <td className="px-6 py-4 text-right text-white">{formatCurrency(pos.current_price)}</td>
                      <td className={`px-6 py-4 text-right font-semibold ${
                        pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {formatCurrency(pos.pnl)} ({pnlPercent.toFixed(2)}%)
                      </td>
                      <td className="px-6 py-4 text-right text-gray-400">{weight.toFixed(1)}%</td>
                      <td className="px-6 py-4 text-right text-gray-400">{getTimeInTrade(pos.opened_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {selectedDetail && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6 max-w-md w-full">
              <h3 className="text-xl font-bold text-white mb-4">{selectedDetail.position.symbol} Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Side:</span>
                  <span className="text-white font-semibold">{selectedDetail.position.side.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Quantity:</span>
                  <span className="text-white font-semibold">{selectedDetail.position.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Entry Price:</span>
                  <span className="text-white font-semibold">
                    {formatCurrency(selectedDetail.position.entry_price)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Current Price:</span>
                  <span className="text-white font-semibold">
                    {formatCurrency(selectedDetail.position.current_price)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Unrealized P&L:</span>
                  <span className={`font-semibold ${selectedDetail.position.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(selectedDetail.position.pnl)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Portfolio Weight:</span>
                  <span className="text-white font-semibold">{selectedDetail.weight.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Opened:</span>
                  <span className="text-gray-400 text-sm">
                    {new Date(selectedDetail.position.opened_at).toLocaleString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="w-full mt-6 px-4 py-2 rounded-lg border border-[#1e1e2e] bg-[#1e1e2e] hover:bg-[#2e2e3e] text-white transition"
              >
                Close
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-600 mt-4">
          Last refresh: {lastRefresh.toLocaleTimeString()}
        </p>
      </div>
    </div>
  )
}
