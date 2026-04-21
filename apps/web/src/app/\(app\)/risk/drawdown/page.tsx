'use client'

import { api } from "@/lib/api";

import { useState, useMemo } from 'react'
import { TrendingDown, AlertTriangle, Lock, Shield } from 'lucide-react'

interface DrawdownLevel {
  period: 'daily' | 'weekly' | 'monthly'
  current: number
  threshold: number
  status: 'safe' | 'warning' | 'critical'
}

interface AutoDerisk {
  id: string
  trigger: string
  action: string
  enabled: boolean
  triggered: boolean
}

const mockDrawdownLevels: DrawdownLevel[] = [
  { period: 'daily', current: -2.1, threshold: -5, status: 'safe' },
  { period: 'weekly', current: -4.8, threshold: -8, status: 'safe' },
  { period: 'monthly', current: -7.2, threshold: -15, status: 'safe' },
]

const autoDerisks: AutoDerisk[] = [
  { id: 'd1', trigger: 'At -2% daily', action: 'Reduce position sizes 50%', enabled: true, triggered: true },
  { id: 'd2', trigger: 'At -5% weekly', action: 'Flatten all positions', enabled: true, triggered: false },
  { id: 'd3', trigger: 'At -10% monthly', action: 'Enter defensive mode', enabled: true, triggered: false },
]

const drawdownHistory = [
  { date: '04-20', value: -2.1 },
  { date: '04-19', value: -1.8 },
  { date: '04-18', value: -3.2 },
  { date: '04-17', value: -2.9 },
  { date: '04-16', value: -1.5 },
  { date: '04-15', value: -4.8 },
  { date: '04-14', value: -4.2 },
  { date: '04-13', value: -3.6 },
  { date: '04-12', value: -2.1 },
  { date: '04-11', value: -1.2 },
]

export default function DrawdownPage() {
  const [expandedRule, setExpandedRule] = useState<string | null>(null)
  const currentDrawdown = -2.1
  const maxDrawdown = Math.min(...drawdownHistory.map(d => d.value))
  const recoveryNeeded = (Math.abs(currentDrawdown) / (100 + Math.abs(currentDrawdown))) * 100

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'critical': return 'text-red-400 bg-red-900/20 border-red-700/50'
      case 'warning': return 'text-amber-400 bg-amber-900/20 border-amber-700/50'
      default: return 'text-green-400 bg-green-900/20 border-green-700/50'
    }
  }

  const getBarColor = (status: string) => {
    switch (status) {
      case 'critical': return 'from-red-500 to-red-400'
      case 'warning': return 'from-amber-500 to-amber-400'
      default: return 'from-green-500 to-green-400'
    }
  }

  const activeRestrictions = useMemo(() => {
    return ['Position size capped at 1.5%', 'Stop loss mandatory on all trades', 'New entries restricted']
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TrendingDown className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">Drawdown Protection</h1>
          </div>
          <p className="text-gray-400">Real-time risk management and automated de-risking rules</p>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-8 mb-8">
          <h2 className="text-lg font-bold text-white mb-6">Current Drawdown Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col items-center justify-center">
              <div className="relative w-40 h-40 rounded-full border-8 border-gray-800 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-gradient-to-b from-gray-800 to-gray-900" />
                <div className="relative text-center z-10">
                  <p className="text-5xl font-bold text-red-400">{currentDrawdown.toFixed(1)}%</p>
                  <p className="text-gray-400 text-xs mt-2">Current DD</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-center space-y-4">
              <div>
                <div className="text-gray-400 text-sm mb-2">Daily Limit</div>
                <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 to-green-400 h-full"
                    style={{ width: `${Math.abs(mockDrawdownLevels[0].current / mockDrawdownLevels[0].threshold) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{mockDrawdownLevels[0].current.toFixed(1)}%</span>
                  <span>{mockDrawdownLevels[0].threshold.toFixed(1)}%</span>
                </div>
              </div>

              <div>
                <div className="text-gray-400 text-sm mb-2">Weekly Limit</div>
                <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 to-green-400 h-full"
                    style={{ width: `${Math.abs(mockDrawdownLevels[1].current / mockDrawdownLevels[1].threshold) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{mockDrawdownLevels[1].current.toFixed(1)}%</span>
                  <span>{mockDrawdownLevels[1].threshold.toFixed(1)}%</span>
                </div>
              </div>

              <div>
                <div className="text-gray-400 text-sm mb-2">Monthly Limit</div>
                <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 to-green-400 h-full"
                    style={{ width: `${Math.abs(mockDrawdownLevels[2].current / mockDrawdownLevels[2].threshold) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{mockDrawdownLevels[2].current.toFixed(1)}%</span>
                  <span>{mockDrawdownLevels[2].threshold.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 content-start">
              <div className="border border-gray-800 rounded p-4">
                <div className="text-gray-400 text-xs mb-1">Max DD</div>
                <div className="text-2xl font-bold text-red-400">{maxDrawdown.toFixed(1)}%</div>
              </div>
              <div className="border border-gray-800 rounded p-4">
                <div className="text-gray-400 text-xs mb-1">Recovery Needed</div>
                <div className="text-2xl font-bold text-blue-400">{recoveryNeeded.toFixed(1)}%</div>
              </div>
              <div className="border border-gray-800 rounded p-4">
                <div className="text-gray-400 text-xs mb-1">Days in DD</div>
                <div className="text-2xl font-bold text-amber-400">10</div>
              </div>
              <div className="border border-gray-800 rounded p-4">
                <div className="text-gray-400 text-xs mb-1">Heat Level</div>
                <div className="text-2xl font-bold text-orange-400">Medium</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {mockDrawdownLevels.map(level => (
            <div key={level.period} className={`border rounded-lg p-6 ${getStatusColor(level.status)}`}>
              <h3 className="text-sm font-semibold uppercase mb-4 text-gray-300">
                {level.period} Drawdown
              </h3>

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-3xl font-bold text-white">{level.current.toFixed(1)}%</p>
                  <p className="text-xs text-gray-400">Limit: {level.threshold.toFixed(1)}%</p>
                </div>
              </div>

              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className={`bg-gradient-to-r ${getBarColor(level.status)} h-2 rounded-full`}
                  style={{ width: `${Math.abs(level.current / level.threshold) * 100}%` }}
                />
              </div>

              <p className={`text-xs font-semibold mt-3 ${
                level.status === 'critical' ? 'text-red-300' : level.status === 'warning' ? 'text-amber-300' : 'text-green-300'
              }`}>
                {level.status === 'critical' ? 'CRITICAL' : level.status === 'warning' ? 'WARNING' : 'SAFE'}
              </p>
            </div>
          ))}
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-6">Drawdown History (10 Days)</h2>

          <div className="flex items-end justify-between h-40 gap-1 px-4 mb-4">
            {drawdownHistory.map((point, idx) => {
              const absValue = Math.abs(point.value)
              const normalized = absValue / 5
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                  <div
                    className="w-full bg-gradient-to-t from-red-500 to-red-400 rounded-t opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ height: `${Math.min(normalized * 100, 100)}%` }}
                    title={`${point.date}: ${point.value.toFixed(1)}%`}
                  />
                </div>
              )
            })}
          </div>

          <div className="flex justify-between px-4 text-xs text-gray-400">
            {drawdownHistory.map(point => (
              <span key={point.date}>{point.date}</span>
            ))}
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-4">Auto-Derisking Rules</h2>
          <div className="space-y-3">
            {autoDerisks.map(rule => (
              <div key={rule.id} className="border border-gray-800 rounded-lg p-4 hover:border-gray-700 cursor-pointer transition-all"
                onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Shield className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <h3 className="font-semibold text-white">{rule.trigger}</h3>
                      {rule.triggered && (
                        <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-semibold">TRIGGERED</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm">{rule.action}</p>
                  </div>

                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <div className={`w-3 h-3 rounded-full ${rule.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                    <span className="text-xs text-gray-400">{rule.enabled ? 'ACTIVE' : 'INACTIVE'}</span>
                  </div>
                </div>

                {expandedRule === rule.id && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <button className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 rounded text-sm font-semibold hover:bg-emerald-500/30 transition-all">
                      Edit Rule
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {activeRestrictions.length > 0 && (
          <div className="border border-amber-700/50 bg-amber-900/20 rounded-lg p-6 mb-8">
            <div className="flex items-start gap-4 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-amber-300 mb-1">Active Trading Restrictions</h3>
                <p className="text-amber-200 text-sm">Current drawdown has triggered position sizing restrictions</p>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {activeRestrictions.map((restriction, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-amber-900/30 border border-amber-700/30 rounded">
                  <Lock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-sm text-amber-100">{restriction}</span>
                </div>
              ))}
            </div>

            <button className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 rounded font-semibold text-sm transition-all">
              Override Restrictions (Requires Auth)
            </button>
          </div>
        )}

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Risk Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-gray-800 rounded p-4">
              <p className="text-gray-400 text-xs font-semibold mb-2">Stability Score</p>
              <p className="text-3xl font-bold text-blue-400">7.2/10</p>
              <p className="text-gray-500 text-xs mt-2">Moderate volatility</p>
            </div>
            <div className="border border-gray-800 rounded p-4">
              <p className="text-gray-400 text-xs font-semibold mb-2">Volatility (30d)</p>
              <p className="text-3xl font-bold text-orange-400">12.3%</p>
              <p className="text-gray-500 text-xs mt-2">Above baseline</p>
            </div>
            <div className="border border-gray-800 rounded p-4">
              <p className="text-gray-400 text-xs font-semibold mb-2">Risk Capacity</p>
              <p className="text-3xl font-bold text-green-400">6.8%</p>
              <p className="text-gray-500 text-xs mt-2">Before restrictions activate</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
