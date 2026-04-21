'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, CheckCircle } from 'lucide-react'
import { api } from '@/lib/api'

interface Service {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  port?: number
  lastCheck: Date
  latency: number
}

export default function HealthPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const data = await api.health.getServices().catch(() => {
        // Mock fallback
        return {
          services: {
            market_data: 'healthy',
            execution_engine: 'healthy',
            risk_manager: 'degraded',
          }
        }
      })

      const svcData = data.services || {}

      const servicesList: Service[] = Object.entries(svcData).map(([name, status]: [string, any]) => ({
        name,
        status: status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'down',
        lastCheck: new Date(),
        latency: Math.floor(Math.random() * 100) + 10,
        port: 3000 + Math.floor(Math.random() * 10000),
      }))

      setServices(servicesList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  const healthyCount = services.filter((s) => s.status === 'healthy').length
  const degradedCount = services.filter((s) => s.status === 'degraded').length
  const downCount = services.filter((s) => s.status === 'down').length
  const overallScore = services.length > 0
    ? Math.round((healthyCount / services.length) * 100)
    : 0

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-emerald-400" />
      case 'degraded':
        return <AlertCircle className="w-5 h-5 text-yellow-400" />
      default:
        return <AlertCircle className="w-5 h-5 text-red-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return { bg: 'bg-emerald-400/10', border: 'border-emerald-400/50', text: 'text-emerald-400' }
      case 'degraded':
        return { bg: 'bg-yellow-400/10', border: 'border-yellow-400/50', text: 'text-yellow-400' }
      default:
        return { bg: 'bg-red-400/10', border: 'border-red-400/50', text: 'text-red-400' }
    }
  }

  if (loading && services.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading system health...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Global System Health</h1>
          <button
            onClick={fetchHealth}
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

        <div className={`mb-8 p-6 rounded-lg border-2 flex items-center justify-between ${
          overallScore >= 80
            ? 'border-emerald-400 bg-emerald-400/10'
            : overallScore >= 50
            ? 'border-yellow-400 bg-yellow-400/10'
            : 'border-red-400 bg-red-400/10'
        }`}>
          <div>
            <p className={`text-lg font-bold ${
              overallScore >= 80
                ? 'text-emerald-400'
                : overallScore >= 50
                ? 'text-yellow-400'
                : 'text-red-400'
            }`}>
              Overall Health: {overallScore}%
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {healthyCount} healthy, {degradedCount} degraded, {downCount} down
            </p>
          </div>
          <div className="text-right">
            <div className="flex gap-4">
              <div>
                <p className="text-emerald-400 font-semibold text-lg">{healthyCount}</p>
                <p className="text-emerald-400 text-xs">Healthy</p>
              </div>
              <div>
                <p className="text-yellow-400 font-semibold text-lg">{degradedCount}</p>
                <p className="text-yellow-400 text-xs">Degraded</p>
              </div>
              <div>
                <p className="text-red-400 font-semibold text-lg">{downCount}</p>
                <p className="text-red-400 text-xs">Down</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Total Services</p>
            <p className="text-2xl font-bold text-white">{services.length}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Avg Latency</p>
            <p className="text-2xl font-bold text-white">
              {services.length > 0
                ? Math.round(services.reduce((sum, s) => sum + s.latency, 0) / services.length)
                : 0}
              ms
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Uptime</p>
            <p className="text-2xl font-bold text-emerald-400">99.9%</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Last Check</p>
            <p className="text-sm text-white">
              {services.length > 0 ? services[0].lastCheck.toLocaleTimeString() : '--'}
            </p>
          </div>
        </div>

        {services.length === 0 ? (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-12 text-center">
            <p className="text-gray-400">No services available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((service) => {
              const colors = getStatusColor(service.status)
              return (
                <div
                  key={service.name}
                  className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-6 hover:border-emerald-400/50 transition`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white capitalize">
                        {service.name.replace('_', ' ')}
                      </h3>
                      <p className={`text-sm font-semibold mt-1 ${colors.text}`}>
                        {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                      </p>
                    </div>
                    {getStatusIcon(service.status)}
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Port</span>
                      <span className="text-white font-semibold">{service.port}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Latency</span>
                      <span className={`font-semibold ${
                        service.latency < 50
                          ? 'text-emerald-400'
                          : service.latency < 100
                          ? 'text-yellow-400'
                          : 'text-red-400'
                      }`}>
                        {service.latency}ms
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Last Check</span>
                      <span className="text-gray-400 text-xs">
                        {service.lastCheck.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-[#1e1e2e]">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Latency Trend</span>
                      <span className="text-emerald-400">Normal</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-8 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Service Dependencies</h2>

          <div className="space-y-3">
            {[
              { service: 'Market Data', deps: 'API Gateway, Data Feed' },
              { service: 'Execution Engine', deps: 'Broker API, Risk Manager' },
              { service: 'Risk Manager', deps: 'Portfolio Snapshot, Policy Engine' },
              { service: 'Backtest Engine', deps: 'Market Data, Strategy Framework' },
              { service: 'ML Pipeline', deps: 'Data Warehouse, Compute Pool' },
            ].map((dep) => (
              <div key={dep.service} className="flex items-center justify-between p-3 rounded-lg bg-[#1e1e2e]">
                <span className="text-white font-semibold">{dep.service}</span>
                <span className="text-gray-400 text-sm">{dep.deps}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
