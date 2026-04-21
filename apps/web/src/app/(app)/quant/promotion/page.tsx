'use client'

import { api } from "@/lib/api";

import { useState, useMemo } from 'react'
import { Zap, TrendingUp, Shield, Rocket, CheckCircle, Clock } from 'lucide-react'

interface Strategy {
  id: string
  name: string
  stage: 'draft' | 'backtested' | 'paper' | 'assisted' | 'autonomous'
  winRate: number
  sharpe: number
  maxDD: number
  trades: number
  rtScore: number
  lastUpdated: string
}

const mockStrategies: Strategy[] = [
  {
    id: 's1',
    name: 'Momentum Breakout',
    stage: 'draft',
    winRate: 0.52,
    sharpe: 0.8,
    maxDD: -0.18,
    trades: 45,
    rtScore: 3.2,
    lastUpdated: '2024-04-19',
  },
  {
    id: 's2',
    name: 'Mean Reversion',
    stage: 'draft',
    winRate: 0.48,
    sharpe: 0.5,
    maxDD: -0.25,
    trades: 62,
    rtScore: 2.1,
    lastUpdated: '2024-04-18',
  },
  {
    id: 's3',
    name: 'RSI Oversold',
    stage: 'backtested',
    winRate: 0.58,
    sharpe: 1.2,
    maxDD: -0.12,
    trades: 128,
    rtScore: 8.5,
    lastUpdated: '2024-04-17',
  },
  {
    id: 's4',
    name: 'MACD Cross',
    stage: 'backtested',
    winRate: 0.55,
    sharpe: 1.1,
    maxDD: -0.14,
    trades: 95,
    rtScore: 7.8,
    lastUpdated: '2024-04-16',
  },
  {
    id: 's5',
    name: 'Bollinger Squeeze',
    stage: 'paper',
    winRate: 0.56,
    sharpe: 1.3,
    maxDD: -0.11,
    trades: 156,
    rtScore: 9.2,
    lastUpdated: '2024-04-20',
  },
  {
    id: 's6',
    name: 'Volume Profile',
    stage: 'paper',
    winRate: 0.54,
    sharpe: 1.0,
    maxDD: -0.16,
    trades: 103,
    rtScore: 7.5,
    lastUpdated: '2024-04-19',
  },
  {
    id: 's7',
    name: 'Ichimoku Cloud',
    stage: 'assisted',
    winRate: 0.61,
    sharpe: 1.5,
    maxDD: -0.09,
    trades: 187,
    rtScore: 9.8,
    lastUpdated: '2024-04-20',
  },
  {
    id: 's8',
    name: 'Smart Money Flow',
    stage: 'autonomous',
    winRate: 0.63,
    sharpe: 1.7,
    maxDD: -0.08,
    trades: 224,
    rtScore: 10.0,
    lastUpdated: '2024-04-20',
  },
]

const stageConfig = {
  draft: { label: 'Draft', icon: Clock, color: 'text-gray-400', bg: 'bg-gray-800/40', border: 'border-gray-700' },
  backtested: { label: 'Backtested', icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-900/20', border: 'border-blue-700' },
  paper: { label: 'Paper', icon: Shield, color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-700' },
  assisted: { label: 'Assisted', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-700' },
  autonomous: { label: 'Autonomous', icon: Rocket, color: 'text-purple-400', bg: 'bg-purple-900/20', border: 'border-purple-700' },
}

export default function PromotionPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'ready' | 'progress'>('all')

  const groupedByStage = useMemo(() => {
    const stages: Record<string, Strategy[]> = {
      draft: [],
      backtested: [],
      paper: [],
      assisted: [],
      autonomous: [],
    }
    mockStrategies.forEach(s => {
      stages[s.stage].push(s)
    })
    return stages
  }, [])

  const readyForPromotion = mockStrategies.filter(s => s.rtScore >= 8.0 && (s.stage === 'backtested' || s.stage === 'paper')).length

  const StrategyCard = ({ strategy }: { strategy: Strategy }) => {
    const config = stageConfig[strategy.stage]
    const Icon = config.icon
    const isReady = strategy.rtScore >= 8.0
    const nextStage = {
      draft: 'backtested',
      backtested: 'paper',
      paper: 'assisted',
      assisted: 'autonomous',
      autonomous: 'autonomous',
    }[strategy.stage]

    return (
      <div
        key={strategy.id}
        className={`border rounded-lg p-4 cursor-pointer transition-all hover:border-opacity-100 ${config.bg} ${config.border} border-opacity-50`}
        onClick={() => setExpandedId(expandedId === strategy.id ? null : strategy.id)}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3 flex-1">
            <Icon className={`w-5 h-5 ${config.color} mt-0.5 flex-shrink-0`} />
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold truncate">{strategy.name}</h3>
              <p className="text-gray-400 text-xs mt-1">Updated {strategy.lastUpdated}</p>
            </div>
          </div>
          {isReady && (
            <span className="flex-shrink-0 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs font-semibold ml-2">Ready</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-400 text-xs">Win Rate</div>
            <div className="text-white font-semibold">{(strategy.winRate * 100).toFixed(0)}%</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-400 text-xs">Sharpe</div>
            <div className="text-white font-semibold">{strategy.sharpe.toFixed(2)}</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-400 text-xs">Max DD</div>
            <div className="text-white font-semibold">{(strategy.maxDD * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-400 text-xs">Trades</div>
            <div className="text-white font-semibold">{strategy.trades}</div>
          </div>
        </div>

        <div className="mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-400 text-xs">Readiness Score</span>
            <span className="text-white font-semibold text-sm">{strategy.rtScore.toFixed(1)}/10</span>
          </div>
          <div className="w-full h-2 bg-gray-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${strategy.rtScore >= 8 ? 'bg-emerald-500' : strategy.rtScore >= 6 ? 'bg-blue-500' : 'bg-orange-500'}`}
              style={{ width: `${Math.min((strategy.rtScore / 10) * 100, 100)}%` }}
            />
          </div>
        </div>

        {expandedId === strategy.id && (
          <div className="border-t border-gray-700/50 pt-3 mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="text-sm">
                <div className="text-gray-400 mb-1">Current Stage</div>
                <div className="text-emerald-400 font-semibold">{config.label}</div>
              </div>
              <div className="text-sm">
                <div className="text-gray-400 mb-1">Next Stage</div>
                <div className="text-blue-400 font-semibold">{stageConfig[nextStage as keyof typeof stageConfig].label}</div>
              </div>
            </div>
            <div className="flex gap-2">
              {strategy.stage !== 'autonomous' && (
                <button className="flex-1 px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/50 rounded text-sm font-semibold transition-all">
                  Promote
                </button>
              )}
              {strategy.stage !== 'draft' && (
                <button className="flex-1 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 rounded text-sm font-semibold transition-all">
                  Demote
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">Promotion Pipeline</h1>
          </div>
          <p className="text-gray-400">Advance strategies from draft through autonomous trading</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Total Strategies</div>
            <div className="text-3xl font-bold text-emerald-400">{mockStrategies.length}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Ready for Promotion</div>
            <div className="text-3xl font-bold text-blue-400">{readyForPromotion}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Autonomous Strategies</div>
            <div className="text-3xl font-bold text-purple-400">{groupedByStage.autonomous.length}</div>
          </div>
        </div>

        <div className="space-y-6">
          {Object.entries(groupedByStage).map(([stageKey, strategies]) => {
            const config = stageConfig[stageKey as keyof typeof stageConfig]
            const Icon = config.icon

            return (
              <div key={stageKey}>
                <div className="flex items-center gap-3 mb-4">
                  <Icon className={`w-6 h-6 ${config.color}`} />
                  <h2 className="text-xl font-bold text-white">{config.label}</h2>
                  <span className={`ml-auto px-3 py-1 rounded-full text-sm font-semibold ${config.bg} ${config.color} border ${config.border}`}>
                    {strategies.length}
                  </span>
                </div>

                {strategies.length === 0 ? (
                  <div className={`border rounded-lg p-8 text-center ${config.bg} ${config.border} border-opacity-50`}>
                    <p className="text-gray-400">No strategies in this stage</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {strategies.map(strategy => (
                      <StrategyCard key={strategy.id} strategy={strategy} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
