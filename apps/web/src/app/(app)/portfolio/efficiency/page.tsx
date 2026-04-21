'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, TrendingUp } from 'lucide-react'

interface PortfolioSnapshot {
  equity: number
  cash: number
}

interface Allocation {
  name: string
  target_pct: number
  actual_pct: number
  value: number
}

interface AllocationResponse {
  allocations: Allocation[]
  by_strategy: Record<string, number>
}

export default function EfficiencyPage() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [byStrategy, setByStrategy] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [snapshotRes, allocRes] = await Promise.all([
        fetch('/api/portfolio/snapshot'),
        fetch('/api/portfolio/allocations'),
      ])

      if (!snapshotRes.ok || !allocRes.ok) {
        throw new Error('Failed to fetch portfolio data')
      }

      const snapshotData = await snapshotRes.json()
      const allocData: AllocationResponse = await allocRes.json()

      setSnapshot(snapshotData)
      setAllocations(allocData.allocations || [])
      setByStrategy(allocData.by_strategy || {})
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

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(val)

  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading efficiency data...</p>
        </div>
      </div>
    )
  }

  const totalEquity = snapshot?.equity || 0
  const totalCash = snapshot?.cash || 0
  const deployedCapital = allocations.reduce((sum, a) => sum + a.value, 0)
  const idleCapital = totalCash
  const deployedPct = totalEquity > 0 ? (deployedCapital / totalEquity) * 100 : 0
  const idlePct = totalEquity > 0 ? (idleCapital / totalEquity) * 100 : 0
  const efficiencyScore = Math.round(deployedPct)

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Capital Efficiency</h1>
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Equity</p>
            <p className="text-2xl font-bold text-white">{formatCurrency(totalEquity)}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Deployed Capital</p>
            <p className="text-2xl font-bold text-emerald-400">
              {formatCurrency(deployedCapital)}
              <span className="text-sm text-gray-400 ml-2">({deployedPct.toFixed(1)}%)</span>
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Idle Capital</p>
            <p className="text-2xl font-bold text-blue-400">
              {formatCurrency(idleCapital)}
              <span className="text-sm text-gray-400 ml-2">({idlePct.toFixed(1)}%)</span>
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Efficiency Score</p>
            <p className="text-2xl font-bold text-white">{efficiencyScore}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Allocation by Strategy</h2>
            <div className="space-y-4">
              {Object.entries(byStrategy).length === 0 ? (
                <p className="text-gray-400">No strategy allocations</p>
              ) : (
                Object.entries(byStrategy).map(([strategy, value]: [string, unknown]) => {
                  const pct = totalEquity > 0 ? ((value as number) / totalEquity) * 100 : 0
                  return (
                    <div key={strategy}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-gray-300">{strategy}</span>
                        <span className="text-white font-semibold">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-[#1e1e2e] rounded-full h-2">
                        <div
                          className="bg-emerald-400 h-2 rounded-full"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Allocation vs Target</h2>
            <div className="space-y-4">
              {allocations.length === 0 ? (
                <p className="text-gray-400">No allocations</p>
              ) : (
                allocations.slice(0, 8).map((alloc) => (
                  <div key={alloc.name}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-300">{alloc.name}</span>
                      <span className="text-white font-semibold">
                        {alloc.actual_pct.toFixed(1)}% / {alloc.target_pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-[#1e1e2e] rounded-full h-2">
                        <div
                          className="bg-emerald-400 h-2 rounded-full"
                          style={{ width: `${Math.min(alloc.actual_pct, 100)}%` }}
                        />
                      </div>
                      <div className="flex-1 bg-[#1e1e2e] rounded-full h-2 opacity-50">
                        <div
                          className="bg-gray-400 h-2 rounded-full"
                          style={{ width: `${Math.min(alloc.target_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Suggestions for Underused Capital
          </h2>
          <div className="space-y-3">
            {idleCapital > totalEquity * 0.1 && (
              <p className="text-blue-400">
                You have {formatCurrency(idleCapital)} in idle cash. Consider deploying 20% in underweight strategies.
              </p>
            )}
            {allocations.some((a) => a.actual_pct < a.target_pct * 0.8) && (
              <p className="text-blue-400">
                Several allocations are below target. Rebalance to match target weights for consistent strategy exposure.
              </p>
            )}
            {deployedPct < 70 && (
              <p className="text-blue-400">
                Portfolio deployment is low. Increasing capital allocation can improve returns on idle cash.
              </p>
            )}
            {!idleCapital && !allocations.some((a) => a.actual_pct < a.target_pct * 0.8) && deployedPct >= 70 && (
              <p className="text-emerald-400">Portfolio is well-deployed with good capital efficiency.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
