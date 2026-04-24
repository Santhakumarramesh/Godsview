'use client'

import { useState, useMemo } from 'react'
import { Brain, TrendingUp, Award, Zap } from 'lucide-react'

interface LearnedPattern {
  id: string
  title: string
  description: string
  frequency: number
  impact: 'critical' | 'high' | 'medium' | 'low'
  beforeWinRate: number
  afterWinRate: number
  improvementTrades: number
}

interface ImprovementMetric {
  date: string
  winRate: number
  sharpe: number
  maxDD: number
}

const mockPatterns: LearnedPattern[] = [
  {
    id: 'p1',
    title: 'Improve Entry Filters',
    description: 'Add price action confirmation to reduce false breakouts and whipsaws',
    frequency: 12,
    impact: 'critical',
    beforeWinRate: 0.42,
    afterWinRate: 0.58,
    improvementTrades: 87,
  },
  {
    id: 'p2',
    title: 'Risk Management Review',
    description: 'Dynamic position sizing based on volatility reduces large losses',
    frequency: 9,
    impact: 'high',
    beforeWinRate: 0.48,
    afterWinRate: 0.55,
    improvementTrades: 124,
  },
  {
    id: 'p3',
    title: 'Drawdown Control',
    description: 'Trailing stop implementation prevents catastrophic drawdowns in trending markets',
    frequency: 7,
    impact: 'high',
    beforeWinRate: 0.51,
    afterWinRate: 0.56,
    improvementTrades: 156,
  },
  {
    id: 'p4',
    title: 'Consistency Improvement',
    description: 'Confluence filters eliminate counter-trend entries and increase reliability',
    frequency: 5,
    impact: 'medium',
    beforeWinRate: 0.50,
    afterWinRate: 0.53,
    improvementTrades: 89,
  },
]

const improvementHistory: ImprovementMetric[] = [
  { date: '2024-01', winRate: 0.48, sharpe: 0.8, maxDD: -0.25 },
  { date: '2024-02', winRate: 0.51, sharpe: 0.95, maxDD: -0.22 },
  { date: '2024-03', winRate: 0.54, sharpe: 1.1, maxDD: -0.18 },
  { date: '2024-04', winRate: 0.57, sharpe: 1.35, maxDD: -0.14 },
]

export default function LearningLoopPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterImpact, setFilterImpact] = useState<'all' | 'critical' | 'high' | 'medium'>('all')

  const filteredPatterns = useMemo(() => {
    let filtered = filterImpact === 'all'
      ? mockPatterns
      : mockPatterns.filter(p => {
        if (filterImpact === 'critical') return p.impact === 'critical'
        if (filterImpact === 'high') return p.impact === 'high' || p.impact === 'critical'
        return p.impact === 'medium' || p.impact === 'high' || p.impact === 'critical'
      })
    return filtered.sort((a, b) => b.frequency - a.frequency)
  }, [filterImpact])

  const totalLessons = mockPatterns.length
  const avgWinRateImprovement = (mockPatterns.reduce((s, p) => s + (p.afterWinRate - p.beforeWinRate), 0) / mockPatterns.length * 100).toFixed(1)
  const totalImprovedTrades = mockPatterns.reduce((s, p) => s + p.improvementTrades, 0)
  const latestWinRate = improvementHistory[improvementHistory.length - 1].winRate

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">Learning Loop Dashboard</h1>
          </div>
          <p className="text-gray-400">Track improvements from learned patterns and market insights</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Learned Patterns</div>
            <div className="text-3xl font-bold text-emerald-400">{totalLessons}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Avg Win Rate Gain</div>
            <div className="text-3xl font-bold text-blue-400">+{avgWinRateImprovement}%</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Improved Trades</div>
            <div className="text-3xl font-bold text-purple-400">{totalImprovedTrades}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Current Win Rate</div>
            <div className="text-3xl font-bold text-yellow-400">{(latestWinRate * 100).toFixed(0)}%</div>
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-6">Performance Improvement Timeline</h2>
          <div className="space-y-4">
            {['Win Rate', 'Sharpe Ratio', 'Max Drawdown'].map((metric, idx) => (
              <div key={metric}>
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-400">{metric}</span>
                  <span className="text-xs text-gray-500">Jan → Apr 2024</span>
                </div>
                <div className="flex gap-2 h-8">
                  {improvementHistory.map((point, pidx) => {
                    let value: number
                    if (metric === 'Win Rate') value = point.winRate
                    else if (metric === 'Sharpe Ratio') value = point.sharpe
                    else value = Math.abs(point.maxDD)

                    const maxValue = Math.max(...improvementHistory.map(p =>
                      metric === 'Win Rate' ? p.winRate : metric === 'Sharpe Ratio' ? p.sharpe : Math.abs(p.maxDD)
                    ))

                    return (
                      <div key={pidx} className="flex-1 rounded overflow-hidden bg-gray-800 relative group">
                        <div
                          className={`h-full transition-all ${
                            metric === 'Max Drawdown'
                              ? 'bg-gradient-to-t from-red-500 to-red-400'
                              : 'bg-gradient-to-t from-emerald-500 to-emerald-400'
                          }`}
                          style={{ height: `${(value / maxValue) * 100}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-white bg-black/70 rounded">
                          {metric === 'Max Drawdown' ? (value * 100).toFixed(1) + '%' : value.toFixed(2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold text-white">Learned Patterns</h2>
            <select
              value={filterImpact}
              onChange={(e) => setFilterImpact(e.target.value as any)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white hover:border-gray-600 w-full md:w-auto"
            >
              <option value="all">All Patterns</option>
              <option value="critical">Critical Only</option>
              <option value="high">High Impact+</option>
              <option value="medium">Medium Impact+</option>
            </select>
          </div>

          <div className="space-y-3">
            {filteredPatterns.map(pattern => {
              const improvement = (pattern.afterWinRate - pattern.beforeWinRate) * 100
              const impactColors = {
                critical: 'bg-red-900/20 border-red-700/50',
                high: 'bg-orange-900/20 border-orange-700/50',
                medium: 'bg-blue-900/20 border-blue-700/50',
                low: 'bg-gray-800/20 border-gray-700/50',
              }
              const impactBadgeColors = {
                critical: 'bg-red-500/20 text-red-400',
                high: 'bg-orange-500/20 text-orange-400',
                medium: 'bg-blue-500/20 text-blue-400',
                low: 'bg-gray-500/20 text-gray-400',
              }

              return (
                <div
                  key={pattern.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-all hover:border-opacity-100 ${impactColors[pattern.impact]} border-opacity-50`}
                  onClick={() => setExpandedId(expandedId === pattern.id ? null : pattern.id)}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <Award className="w-5 h-5 text-amber-400 flex-shrink-0" />
                        <h3 className="text-white font-semibold truncate">{pattern.title}</h3>
                        <span className={`px-2 py-1 rounded text-xs font-semibold flex-shrink-0 ${impactBadgeColors[pattern.impact]}`}>
                          {pattern.impact.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm">{pattern.description}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 text-xs">Frequency</div>
                      <div className="text-white font-semibold">{pattern.frequency}x</div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 text-xs">Before WR</div>
                      <div className="text-white font-semibold">{(pattern.beforeWinRate * 100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 text-xs">After WR</div>
                      <div className="text-emerald-400 font-semibold">{(pattern.afterWinRate * 100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 text-xs">Improvement</div>
                      <div className="text-blue-400 font-semibold">+{improvement.toFixed(1)}%</div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Win Rate Improvement</span>
                      <span className="text-white font-semibold">{improvement.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-400"
                        style={{ width: `${Math.min(improvement * 10, 100)}%` }}
                      />
                    </div>
                  </div>

                  {expandedId === pattern.id && (
                    <div className="border-t border-gray-700/50 pt-3 mt-3 space-y-3">
                      <div>
                        <div className="text-sm text-gray-400 mb-2">Trades Improved: {pattern.improvementTrades}</div>
                        <div className="text-xs text-gray-500">
                          This pattern was identified in {pattern.improvementTrades} trades, improving overall performance by {improvement.toFixed(1)} percentage points
                        </div>
                      </div>
                      <button className="w-full px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/50 rounded text-sm font-semibold transition-all">
                        Apply to Active Strategies
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Key Insights</h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <Zap className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-semibold">Entry Accuracy</p>
                  <p className="text-gray-400 text-xs">Price action filters reduced false entries by 38%</p>
                </div>
              </div>
              <div className="flex gap-3">
                <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-semibold">Sharpe Improvement</p>
                  <p className="text-gray-400 text-xs">Risk-adjusted returns improved from 0.8 to 1.35</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Learning Velocity</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Last 7 days</span>
                <span className="text-white font-semibold">+2 patterns</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">This month</span>
                <span className="text-white font-semibold">+8 patterns</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">90 day trend</span>
                <span className="text-emerald-400 font-semibold">+18% learning rate</span>
              </div>
            </div>
          </div>

          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Next Actions</h3>
            <div className="space-y-2">
              <button className="w-full px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/50 rounded text-sm font-semibold transition-all">
                Review Critical Patterns
              </button>
              <button className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded text-sm font-semibold transition-all">
                Export Findings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
