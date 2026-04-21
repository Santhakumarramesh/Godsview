'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, CheckCircle, XCircle, Zap } from 'lucide-react'
import { api } from "@/lib/api"

interface MissionControlState {
  mode: 'paper' | 'live'
  killswitchArmed: boolean
  serviceHealth: Record<string, boolean>
  equity: number
  positions: number
}

export default function MissionControlPage() {
  const [state, setState] = useState<MissionControlState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<'paper' | 'live'>('paper')
  const [confirmDialog, setConfirmDialog] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [healthRes, killswitchRes, portfolioRes] = await Promise.all([
        fetch('/health/services'),
        fetch('/api/portfolio/risk/killswitch'),
        fetch('/api/portfolio/snapshot'),
      ])

      if (!healthRes.ok || !killswitchRes.ok || !portfolioRes.ok) {
        throw new Error('Failed to fetch mission control state')
      }

      const [healthData, killswitchData, portfolioData] = await Promise.all([
        healthRes.json(),
        killswitchRes.json(),
        portfolioRes.json(),
      ])

      const services = healthData.services || {}
      const serviceHealth: Record<string, boolean> = {}
      Object.keys(services).forEach((key) => {
        serviceHealth[key] = services[key] === 'healthy'
      })

      setState({
        mode: 'paper',
        killswitchArmed: killswitchData.armed || false,
        serviceHealth,
        equity: portfolioData.equity || 0,
        positions: 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 30000)
    return () => clearInterval(interval)
  }, [fetchState])

  const handleModeChange = (mode: 'paper' | 'live') => {
    if (mode === 'live') {
      setConfirmDialog('switch_to_live')
    } else {
      setSelectedMode(mode)
      setState((prev) => (prev ? { ...prev, mode } : null))
    }
  }

  const handleConfirmLive = () => {
    setSelectedMode('live')
    setState((prev) => (prev ? { ...prev, mode: 'live' } : null))
    setConfirmDialog(null)
  }

  const handleKillswitch = () => {
    setConfirmDialog('killswitch')
  }

  const handleConfirmKillswitch = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/risk/killswitch', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to trigger killswitch')
      setState((prev) => (prev ? { ...prev, killswitchArmed: true } : null))
      setConfirmDialog(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger killswitch')
    }
  }, [])

  const healthyServices = state
    ? Object.values(state.serviceHealth).filter((v) => v).length
    : 0

  const totalServices = state ? Object.keys(state.serviceHealth).length : 0

  if (loading && !state) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading mission control...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-white">Mission Control</h1>
          <button
            onClick={fetchState}
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

        <div className={`mb-8 p-6 rounded-lg border-2 ${
          state?.killswitchArmed
            ? 'border-red-400 bg-red-400/10'
            : 'border-emerald-400 bg-emerald-400/10'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-lg font-bold ${state?.killswitchArmed ? 'text-red-400' : 'text-emerald-400'}`}>
                {state?.killswitchArmed ? 'KILLSWITCH ARMED' : 'KILLSWITCH READY'}
              </p>
              <p className="text-gray-400 text-sm mt-1">
                {state?.killswitchArmed
                  ? 'Emergency stop engaged - all trading suspended'
                  : 'Emergency stop standby - ready to execute'}
              </p>
            </div>
            {state?.killswitchArmed ? (
              <XCircle className="w-8 h-8 text-red-400" />
            ) : (
              <Zap className="w-8 h-8 text-emerald-400" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Global Mode</p>
            <p className="text-2xl font-bold text-white capitalize">{state?.mode}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Account Equity</p>
            <p className="text-2xl font-bold text-white">
              ${(state?.equity || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Services Healthy</p>
            <p className="text-2xl font-bold text-emerald-400">
              {healthyServices} / {totalServices}
            </p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">System Status</p>
            <p className={`text-2xl font-bold ${healthyServices === totalServices ? 'text-emerald-400' : 'text-yellow-400'}`}>
              {healthyServices === totalServices ? 'Optimal' : 'Degraded'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Global Mode</h2>

            <div className="space-y-3">
              {['paper', 'live'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode as 'paper' | 'live')}
                  className={`w-full p-4 rounded-lg border-2 font-semibold transition ${
                    selectedMode === mode
                      ? 'border-emerald-400 bg-emerald-400/10 text-emerald-400'
                      : 'border-[#1e1e2e] bg-[#1e1e2e] text-gray-400 hover:border-emerald-400/50'
                  }`}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Emergency Controls</h2>

            <div className="space-y-3">
              <button className="w-full px-4 py-3 rounded-lg border border-yellow-400/50 text-yellow-400 hover:bg-yellow-400/10 font-semibold transition">
                Flatten All Positions
              </button>
              <button className="w-full px-4 py-3 rounded-lg border border-orange-400/50 text-orange-400 hover:bg-orange-400/10 font-semibold transition">
                Pause All Trading
              </button>
              <button
                onClick={handleKillswitch}
                className={`w-full px-4 py-3 rounded-lg font-semibold transition ${
                  state?.killswitchArmed
                    ? 'bg-red-400/20 text-red-400 border border-red-400'
                    : 'bg-red-400 text-white hover:bg-red-500 border border-red-400'
                }`}
              >
                {state?.killswitchArmed ? 'ARMED' : 'Trigger Killswitch'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Service Toggles</h2>

            <div className="space-y-2">
              {state && Object.entries(state.serviceHealth).map(([service, healthy]) => (
                <div key={service} className="flex items-center justify-between p-3 rounded-lg bg-[#1e1e2e]">
                  <span className="text-gray-400 text-sm capitalize">{service.replace('_', ' ')}</span>
                  {healthy ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Deployment State</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: 'Core System', status: 'active', uptime: '99.8%' },
              { name: 'Market Data', status: 'active', uptime: '100%' },
              { name: 'Execution Engine', status: 'active', uptime: '99.9%' },
              { name: 'Risk Manager', status: 'active', uptime: '99.95%' },
              { name: 'Backtest Engine', status: 'idle', uptime: '100%' },
              { name: 'ML Pipeline', status: 'active', uptime: '98.5%' },
            ].map((component) => (
              <div key={component.name} className="p-4 rounded-lg bg-[#1e1e2e]">
                <p className="text-white font-semibold">{component.name}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${
                    component.status === 'active'
                      ? 'bg-emerald-400/20 text-emerald-400'
                      : 'bg-gray-400/20 text-gray-400'
                  }`}>
                    {component.status}
                  </span>
                  <span className="text-xs text-gray-400">{component.uptime} up</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirmDialog === 'switch_to_live' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Live Trading</h3>
            <p className="text-gray-400 mb-6">
              Switch to live trading mode? This will enable real capital execution.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-[#1e1e2e] text-white hover:bg-[#1e1e2e] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLive}
                className="flex-1 px-4 py-2 rounded-lg bg-emerald-400 text-[#0a0a0f] font-semibold hover:bg-emerald-500 transition"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog === 'killswitch' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="rounded-lg border border-red-400 bg-[#12121a] p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-red-400 mb-4">EMERGENCY STOP</h3>
            <p className="text-gray-400 mb-6">
              Trigger killswitch? All trading will be immediately suspended and all positions will be closed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-[#1e1e2e] text-white hover:bg-[#1e1e2e] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmKillswitch}
                className="flex-1 px-4 py-2 rounded-lg bg-red-400 text-white font-semibold hover:bg-red-500 transition"
              >
                Trigger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
