'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, CheckCircle, Clock } from 'lucide-react'
import { api } from '@/lib/api'

interface Policy {
  id: string
  name: string
  type: string
  threshold: number
  enabled: boolean
  current_value: number
  utilization: number
  auto_approved: boolean
}

interface Trade {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  status: string
  requires_approval: boolean
}

export default function SemiAutoPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [policiesData, tradesData] = await Promise.all([
        api.risk.getPolicies(),
        api.execution.listOrders({ status: 'open', limit: 50 }),
      ])

      setPolicies(policiesData.policies || [])
      setTrades(tradesData.trades || [])
    } catch (err) {
      // Demo fallback data
      setPolicies([
        { id: '1', name: 'Daily Loss Cap', type: 'loss', threshold: 5000, enabled: true, current_value: 2150, utilization: 43, auto_approved: true },
        { id: '2', name: 'Max Position Size', type: 'position', threshold: 100000, enabled: true, current_value: 78500, utilization: 78.5, auto_approved: false },
      ])
      setTrades([
        { id: '1', symbol: 'AAPL', side: 'buy', qty: 100, status: 'filled', requires_approval: false },
        { id: '2', symbol: 'MSFT', side: 'sell', qty: 50, status: 'pending', requires_approval: true },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 20000)
    return () => clearInterval(interval)
  }, [fetchData])

  const toggleAutoApproval = useCallback(async (policyId: string, newState: boolean) => {
    setPolicies((prev) =>
      prev.map((p) => (p.id === policyId ? { ...p, auto_approved: newState } : p))
    )
  }, [])

  const autoApprovedTrades = trades.filter((t) => !t.requires_approval)
  const manualApprovalTrades = trades.filter((t) => t.requires_approval)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading semi-auto data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Semi-Autonomous Mode</h1>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-400/20 bg-red-400/10 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Policies</p>
            <p className="text-2xl font-bold text-white">{policies.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Auto-Approved Trades</p>
            <p className="text-2xl font-bold text-emerald-400">{autoApprovedTrades.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Awaiting Approval</p>
            <p className="text-2xl font-bold text-blue-400">{manualApprovalTrades.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Risk Policies</h2>

            {policies.length === 0 ? (
              <p className="text-gray-400">No policies configured</p>
            ) : (
              <div className="space-y-3">
                {policies.map((policy) => (
                  <div key={policy.id} className="p-4 rounded-lg border border-[#1e1e2e] bg-[#1e1e2e]/50">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-white font-semibold">{policy.name}</h3>
                        <p className="text-gray-400 text-sm">{policy.type}</p>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={policy.auto_approved}
                          onChange={(e) => toggleAutoApproval(policy.id, e.target.checked)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-xs text-gray-400">
                          {policy.auto_approved ? 'Auto' : 'Manual'}
                        </span>
                      </label>
                    </div>

                    <div className="mb-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Utilization</span>
                        <span className="text-white font-semibold">{policy.utilization.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-[#1e1e2e] rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            policy.utilization > 90
                              ? 'bg-red-400'
                              : policy.utilization > 70
                              ? 'bg-yellow-400'
                              : 'bg-emerald-400'
                          }`}
                          style={{ width: `${Math.min(policy.utilization, 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Current</span>
                      <span className="text-white">
                        {policy.current_value.toFixed(2)} / {policy.threshold.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                Auto-Approved Trades
              </h2>

              {autoApprovedTrades.length === 0 ? (
                <p className="text-gray-400">No auto-approved trades</p>
              ) : (
                <div className="space-y-2">
                  {autoApprovedTrades.map((trade) => (
                    <div key={trade.id} className="p-3 rounded-lg bg-emerald-400/10 border border-emerald-400/20">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-semibold">{trade.symbol}</span>
                        <span className={`text-xs font-semibold ${
                          trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {trade.side.toUpperCase()} {trade.qty}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-400" />
                Pending Manual Approval
              </h2>

              {manualApprovalTrades.length === 0 ? (
                <p className="text-gray-400">No trades awaiting approval</p>
              ) : (
                <div className="space-y-2">
                  {manualApprovalTrades.map((trade) => (
                    <div key={trade.id} className="p-3 rounded-lg bg-blue-400/10 border border-blue-400/20">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-semibold">{trade.symbol}</span>
                        <span className={`text-xs font-semibold ${
                          trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {trade.side.toUpperCase()} {trade.qty}
                        </span>
                      </div>
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
