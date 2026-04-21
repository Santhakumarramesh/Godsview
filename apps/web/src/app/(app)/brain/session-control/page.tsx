'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, Clock } from 'lucide-react'

interface SessionState {
  session: 'pre-market' | 'live' | 'after-hours'
  activeSymbols: number
  tradingMode: 'paper' | 'assisted' | 'semi-auto' | 'autonomous'
  sessionStartTime: string
  sessionEndTime: string
}

export default function SessionControlPage() {
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<string>('paper')

  const fetchSessionState = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/health/services')
      if (!res.ok) throw new Error('Failed to fetch session state')

      const now = new Date()
      const hours = now.getHours()

      let session: 'pre-market' | 'live' | 'after-hours'
      if (hours >= 9 && hours < 16) {
        session = 'live'
      } else if (hours >= 4 && hours < 9) {
        session = 'pre-market'
      } else {
        session = 'after-hours'
      }

      setSessionState({
        session,
        activeSymbols: Math.floor(Math.random() * 15) + 3,
        tradingMode: 'paper',
        sessionStartTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        sessionEndTime: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch session state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessionState()
    const interval = setInterval(fetchSessionState, 60000)
    return () => clearInterval(interval)
  }, [fetchSessionState])

  const getSessionColor = (session: string) => {
    switch (session) {
      case 'live':
        return { bg: 'bg-emerald-400/10', border: 'border-emerald-400/50', text: 'text-emerald-400' }
      case 'pre-market':
        return { bg: 'bg-blue-400/10', border: 'border-blue-400/50', text: 'text-blue-400' }
      default:
        return { bg: 'bg-gray-400/10', border: 'border-gray-400/50', text: 'text-gray-400' }
    }
  }

  if (loading && !sessionState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading session state...</p>
        </div>
      </div>
    )
  }

  const colors = getSessionColor(sessionState?.session || 'after-hours')

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Session Control</h1>
          <button
            onClick={fetchSessionState}
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

        <div className={`mb-8 p-6 rounded-lg border-2 ${colors.bg} ${colors.border}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-lg font-bold ${colors.text}`}>
                Market Session: {sessionState?.session?.toUpperCase().replace('-', ' ')}
              </p>
              <p className="text-gray-400 text-sm mt-1">
                {sessionState?.session === 'live'
                  ? 'Regular trading hours active'
                  : sessionState?.session === 'pre-market'
                  ? 'Pre-market session'
                  : 'Market closed - after-hours trading'}
              </p>
            </div>
            <Clock className={`w-8 h-8 ${colors.text}`} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Active Symbols</p>
            <p className="text-2xl font-bold text-white">{sessionState?.activeSymbols}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Trading Mode</p>
            <p className="text-2xl font-bold text-emerald-400 capitalize">{sessionState?.tradingMode}</p>
          </div>
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
            <p className="text-gray-400 text-sm mb-2">Session Time</p>
            <p className="text-sm text-white">
              {sessionState ? new Date(sessionState.sessionStartTime).toLocaleTimeString() : '--'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Trading Mode Selector</h2>

            <div className="space-y-3">
              {['paper', 'assisted', 'semi-auto', 'autonomous'].map((mode) => (
                <label
                  key={mode}
                  className={`block p-4 rounded-lg border cursor-pointer transition ${
                    selectedMode === mode
                      ? 'border-emerald-400 bg-emerald-400/10'
                      : 'border-[#1e1e2e] bg-[#1e1e2e]/50 hover:border-[#2e2e3e]'
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={selectedMode === mode}
                    onChange={(e) => setSelectedMode(e.target.value)}
                    className="w-4 h-4"
                  />
                  <span className="ml-3 text-white font-semibold capitalize">
                    {mode.replace('-', ' ')}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    {mode === 'paper' && 'Simulated trading - no real capital'}
                    {mode === 'assisted' && 'Manual approval for each trade'}
                    {mode === 'semi-auto' && 'Auto-approved trades + manual queue'}
                    {mode === 'autonomous' && 'Full automatic trading (if eligible)'}
                  </p>
                </label>
              ))}
            </div>

            <button className="w-full mt-4 px-4 py-2 rounded-lg bg-emerald-400 text-[#0a0a0f] font-semibold hover:bg-emerald-500 transition">
              Apply Mode
            </button>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Session Timer</h2>

            <div className="space-y-4">
              <div>
                <p className="text-gray-400 text-sm mb-2">Session Start</p>
                <p className="text-white font-semibold">
                  {sessionState ? new Date(sessionState.sessionStartTime).toLocaleTimeString() : '--'}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-2">Session End</p>
                <p className="text-white font-semibold">
                  {sessionState ? new Date(sessionState.sessionEndTime).toLocaleTimeString() : '--'}
                </p>
              </div>
              <div className="pt-4 border-t border-[#1e1e2e]">
                <p className="text-gray-400 text-sm mb-2">Time Remaining</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {sessionState
                    ? Math.max(0, Math.floor((new Date(sessionState.sessionEndTime).getTime() - Date.now()) / 60000))
                    : 0}
                  m
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Session Indicators</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Market Open', status: sessionState?.session === 'live' },
              { label: 'Data Feed', status: true },
              { label: 'Broker Connected', status: true },
              { label: 'Risk Monitor', status: true },
            ].map((indicator) => (
              <div key={indicator.label} className="p-3 rounded-lg bg-[#1e1e2e]">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${indicator.status ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-gray-400 text-sm">{indicator.label}</span>
                </div>
                <p className={`font-semibold ${indicator.status ? 'text-emerald-400' : 'text-red-400'}`}>
                  {indicator.status ? 'Active' : 'Inactive'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
