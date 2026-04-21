'use client'

import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react'

interface WalkForwardPeriod {
  period: number
  trainStart: string
  trainEnd: string
  testStart: string
  testEnd: string
  trainWinRate: number
  testWinRate: number
  trainSharpe: number
  testSharpe: number
  trainMaxDD: number
  testMaxDD: number
  stability: number
  passed: boolean
}

const mockData: WalkForwardPeriod[] = [
  {
    period: 1,
    trainStart: '2023-01',
    trainEnd: '2023-06',
    testStart: '2023-07',
    testEnd: '2023-09',
    trainWinRate: 0.58,
    testWinRate: 0.55,
    trainSharpe: 1.2,
    testSharpe: 0.98,
    trainMaxDD: -0.12,
    testMaxDD: -0.15,
    stability: 0.92,
    passed: true,
  },
  {
    period: 2,
    trainStart: '2023-02',
    trainEnd: '2023-07',
    testStart: '2023-08',
    testEnd: '2023-10',
    trainWinRate: 0.61,
    testWinRate: 0.42,
    trainSharpe: 1.4,
    testSharpe: 0.55,
    trainMaxDD: -0.10,
    testMaxDD: -0.28,
    stability: 0.58,
    passed: false,
  },
  {
    period: 3,
    trainStart: '2023-03',
    trainEnd: '2023-08',
    testStart: '2023-09',
    testEnd: '2023-11',
    trainWinRate: 0.59,
    testWinRate: 0.56,
    trainSharpe: 1.3,
    testSharpe: 1.05,
    trainMaxDD: -0.11,
    testMaxDD: -0.13,
    stability: 0.95,
    passed: true,
  },
  {
    period: 4,
    trainStart: '2023-04',
    trainEnd: '2023-09',
    testStart: '2023-10',
    testEnd: '2023-12',
    trainWinRate: 0.60,
    testWinRate: 0.54,
    trainSharpe: 1.25,
    testSharpe: 0.92,
    trainMaxDD: -0.13,
    testMaxDD: -0.18,
    stability: 0.88,
    passed: true,
  },
  {
    period: 5,
    trainStart: '2023-05',
    trainEnd: '2023-10',
    testStart: '2023-11',
    testEnd: '2024-01',
    trainWinRate: 0.57,
    testWinRate: 0.52,
    trainSharpe: 1.15,
    testSharpe: 0.85,
    trainMaxDD: -0.14,
    testMaxDD: -0.22,
    stability: 0.82,
    passed: true,
  },
]

export default function WalkForwardPage() {
  const [sortBy, setSortBy] = useState<'period' | 'stability' | 'sharpe'>('period')
  const [filterPassed, setFilterPassed] = useState<'all' | 'passed' | 'failed'>('all')

  const filteredData = useMemo(() => {
    let filtered = filterPassed === 'all' ? mockData : mockData.filter(d => d.passed === (filterPassed === 'passed'))
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'stability': return b.stability - a.stability
        case 'sharpe': return b.testSharpe - a.testSharpe
        default: return a.period - b.period
      }
    })
  }, [sortBy, filterPassed])

  const passedCount = mockData.filter(p => p.passed).length
  const avgStability = (mockData.reduce((s, p) => s + p.stability, 0) / mockData.length * 100).toFixed(1)
  const avgTestSharpe = (mockData.reduce((s, p) => s + p.testSharpe, 0) / mockData.length).toFixed(2)

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-8 h-8 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">Walk-Forward Validation</h1>
          </div>
          <p className="text-gray-400">Analyze in-sample vs out-of-sample performance across rolling windows</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Validation Periods</div>
            <div className="text-3xl font-bold text-emerald-400">{mockData.length}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Passed</div>
            <div className="text-3xl font-bold text-emerald-400">{passedCount}/{mockData.length}</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Avg Stability</div>
            <div className="text-3xl font-bold text-blue-400">{avgStability}%</div>
          </div>
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Avg Test Sharpe</div>
            <div className="text-3xl font-bold text-purple-400">{avgTestSharpe}</div>
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-white">Validation Results</h2>
            <div className="flex flex-wrap gap-2">
              <select
                value={filterPassed}
                onChange={(e) => setFilterPassed(e.target.value as any)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white hover:border-gray-600"
              >
                <option value="all">All Results</option>
                <option value="passed">Passed Only</option>
                <option value="failed">Failed Only</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white hover:border-gray-600"
              >
                <option value="period">Sort by Period</option>
                <option value="stability">Sort by Stability</option>
                <option value="sharpe">Sort by Test Sharpe</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Period</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Train Window</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Test Window</th>
                  <th className="text-right py-3 px-4 text-gray-400 font-medium">Train Win%</th>
                  <th className="text-right py-3 px-4 text-gray-400 font-medium">Test Win%</th>
                  <th className="text-right py-3 px-4 text-gray-400 font-medium">Stability</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row) => (
                  <tr key={row.period} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-3 px-4 text-white font-mono font-semibold">W{row.period}</td>
                    <td className="py-3 px-4 text-gray-300 text-xs">
                      {row.trainStart} → {row.trainEnd}
                    </td>
                    <td className="py-3 px-4 text-gray-300 text-xs">
                      {row.testStart} → {row.testEnd}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      <span className="text-emerald-400">{(row.trainWinRate * 100).toFixed(0)}%</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      <span className={row.testWinRate > row.trainWinRate * 0.9 ? 'text-emerald-400' : 'text-amber-400'}>
                        {(row.testWinRate * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-800 rounded overflow-hidden">
                          <div
                            className={`h-full ${row.stability >= 0.9 ? 'bg-emerald-500' : row.stability >= 0.8 ? 'bg-blue-500' : 'bg-amber-500'}`}
                            style={{ width: `${Math.min(row.stability * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-300 font-mono text-xs w-12">{(row.stability * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.passed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-semibold">
                          <CheckCircle className="w-3 h-3" /> PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs font-semibold">
                          <AlertTriangle className="w-3 h-3" /> FAIL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Sharpe Ratio Comparison</h3>
            <div className="space-y-3">
              {filteredData.slice(0, 5).map((row) => (
                <div key={row.period} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-300">Period {row.period}</span>
                    <span className="text-gray-400 text-xs">Train: {row.trainSharpe.toFixed(2)} | Test: {row.testSharpe.toFixed(2)}</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500/70"
                        style={{ width: `${Math.min((row.trainSharpe / 2) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-purple-500/70"
                        style={{ width: `${Math.min((row.testSharpe / 2) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Max Drawdown Comparison</h3>
            <div className="space-y-3">
              {filteredData.slice(0, 5).map((row) => (
                <div key={row.period} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-300">Period {row.period}</span>
                    <span className="text-gray-400 text-xs">Train: {(row.trainMaxDD * 100).toFixed(1)}% | Test: {(row.testMaxDD * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-orange-500/70"
                        style={{ width: `${Math.abs(row.trainMaxDD) * 100}%` }}
                      />
                    </div>
                    <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-red-500/70"
                        style={{ width: `${Math.abs(row.testMaxDD) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border border-gray-800 bg-gray-900 rounded-lg p-6">
          <h3 className="text-lg font-bold text-white mb-4">Configuration Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-gray-400 text-xs mb-1">Walk-Forward Type</div>
              <div className="text-white font-semibold">Anchored</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Train Period</div>
              <div className="text-white font-semibold">6 months</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Test Period</div>
              <div className="text-white font-semibold">3 months</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Stability Threshold</div>
              <div className="text-white font-semibold">0.80-1.20</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
