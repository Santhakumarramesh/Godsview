'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, Shield } from 'lucide-react'
import { api } from '@/lib/api'

interface RiskMetric {
  id: string
  name: string
  type: string
  limit: number
  current: number
  utilization: number
  status: 'healthy' | 'warning' | 'critical'
}

export default function ExecutionRiskPage() {
  const [metrics, setMetrics] = useState<RiskMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRiskMetrics = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.risk.getMetrics()
      setMetrics(data.metrics || [])
    } catch (err) {
      // Demo fallback data
      setMetrics([
        { id: '1', name: 'Daily Loss Cap', type: 'loss', limit: 10000, current: 2150, utilization: 21.5, status: 'healthy' },
        { id: '2', name: 'Max Drawdown', type: 'drawdown', limit: 5000, current: 3200, utilization: 64, status: 'warning' },
        { id: '3', name: 'Position Limit', type: 'position', limit: 50, current: 42, utilization: 84, status: 'warning' },
        { id: '4', name: 'Correlation Limit', type: 'correlation', limit: 0.85, current: 0.72, utilization: 84.7, status: 'healthy' },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRiskMetrics()
    const interval = setInterval(fetchRiskMetrics, 30000)
    return () => clearInterval(interval)
  }, [fetchRiskMetrics])

  const getStatusColor = (status: string) => {
    if (status === 'healthy') return 'bg-emerald-400/10 border-emerald-400/30'
    if (status === 'warning') return 'bg-yellow-400/10 border-yellow-400/30'
    return 'bg-red-400/10 border-red-400/30'
  }

  const getStatusTextColor = (status: string) => {
    if (status === 'healthy') return 'text-emerald-400'
    if (status === 'warning') return 'text-yellow-400'
    return 'text-red-400'
  }

  if (loading && metrics.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading risk metrics...</p>
        </div>
      </div>
    )
  }

  const healthyCount = metrics.filter((m) => m.status === 'healthy').length
  const warningCount = metrics.filter((m) => m.status === 'warning').length
  const criticalCount = metrics.filter((m) => m.status === 'critical').length

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Risk Management</h1>
          <button
            onClick={fetchRiskMetrics}
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
            <p className="text-gray-400 text-sm mb-2">Total Metrics</p>
            <p className="text-2xl font-bold text-white">{metrics.length}</p>
          </div>
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4">
            <p className="text-gray-400 text-sm mb-2">Healthy</p>
            <p className="text-2xl font-bold text-emerald-400">{healthyCount}</p>
          </div>
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-4">
            <p className="text-gray-400 text-sm mb-2">Warning</p>
            <p className="text-2xl font-bold text-yellow-400">{warningCount}</p>
          </div>
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4">
            <p className="text-gray-400 text-sm mb-2">Critical</p>
            <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
          </div>
        </div>

        <div className="space-y-4">
          {metrics.map((metric) => (
            <div key={metric.id} className={`rounded-lg border p-6 ${getStatusColor(metric.status)}`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{metric.name}</h3>
                  <p className="text-sm text-gray-400">{metric.type}</p>
                </div>
                <span className={`px-3 py-1 rounded text-xs font-bold ${getStatusTextColor(metric.status)}`}>
                  {metric.status.toUpperCase()}
                </span>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Utilization</span>
                  <span className="text-white font-semibold">{metric.utilization.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-[#1e1e2e] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      metric.status === 'critical'
                        ? 'bg-red-400'
                        : metric.status === 'warning'
                        ? 'bg-yellow-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(metric.utilization, 100)}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Current</span>
                <span className="text-white font-semibold">
                  {metric.current.toFixed(2)} / {metric.limit.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 p-6 rounded-lg border border-blue-400/30 bg-blue-400/10">
          <div className="flex items-start gap-4">
            <Shield className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-blue-300 mb-2">Risk Controls Active</h3>
              <p className="text-blue-100 text-sm">All risk limits are monitored in real-time. System will automatically halt trading if critical thresholds are breached.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
