'use client'

import { useState, useEffect } from 'react'
import { api } from "@/lib/api";

interface BacktestResult {
  run_id: string
  symbol: string
  strategy: string
  pf: number
  sharpe: number
  win_rate: number
  trades: number
  max_dd: number
  start: string
  end: string
}

interface MLModel {
  id: string
  symbol: string
  type: string
  accuracy: number
  status: string
  created: string
}

interface PipelineItem {
  id: string
  type: 'backtest' | 'model'
  name: string
  symbol: string
  pf?: number
  win_rate?: number
  accuracy?: number
  stage: 'Research' | 'Paper' | 'Assisted' | 'Autonomous'
  metrics: { met: string; passed: boolean }[]
}

export default function PromotionsPipelininePage() {
  const [pipeline, setPipeline] = useState<PipelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [resultsRes, modelsRes] = await Promise.all([
          fetch('/api/backtest/results?limit=50'),
          fetch('/api/ml/models'),
        ])

        if (!resultsRes.ok || !modelsRes.ok) throw new Error('Failed to fetch')

        const resultsData = await resultsRes.json()
        const modelsData = await modelsRes.json()

        const items: PipelineItem[] = []

        resultsData.results?.forEach((r: BacktestResult) => {
          const pfCheck = r.pf > 1.5
          const wrCheck = r.win_rate > 0.55

          let stage: 'Research' | 'Paper' | 'Assisted' | 'Autonomous' = 'Research'
          if (pfCheck && wrCheck) stage = 'Paper'
          if (pfCheck && wrCheck && r.sharpe > 1.0) stage = 'Assisted'
          if (pfCheck && wrCheck && r.sharpe > 1.5) stage = 'Autonomous'

          items.push({
            id: r.run_id,
            type: 'backtest',
            name: `${r.symbol} - ${r.strategy}`,
            symbol: r.symbol,
            pf: r.pf,
            win_rate: r.win_rate,
            stage,
            metrics: [
              { met: 'PF > 1.5', passed: pfCheck },
              { met: 'Win Rate > 55%', passed: wrCheck },
              { met: 'Sharpe > 1.0', passed: r.sharpe > 1.0 },
              { met: 'Sharpe > 1.5', passed: r.sharpe > 1.5 },
            ],
          })
        })

        modelsData.models?.forEach((m: MLModel) => {
          const accCheck = m.accuracy > 0.75
          const stage = accCheck ? 'Paper' : 'Research'

          items.push({
            id: m.id,
            type: 'model',
            name: `${m.symbol} - ${m.type}`,
            symbol: m.symbol,
            accuracy: m.accuracy,
            stage: stage as any,
            metrics: [
              { met: 'Accuracy > 75%', passed: accCheck },
              { met: 'Status Active', passed: m.status === 'active' },
            ],
          })
        })

        setPipeline(items)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  const stages: ('Research' | 'Paper' | 'Assisted' | 'Autonomous')[] = ['Research', 'Paper', 'Assisted', 'Autonomous']
  const stagesByName = stages.reduce(
    (acc, stage) => {
      acc[stage] = pipeline.filter(p => p.stage === stage)
      return acc
    },
    {} as Record<string, PipelineItem[]>
  )

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Promotion Pipeline</h1>
        <p className="text-gray-400 mb-8">Track strategy and model progression to live trading</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {stages.map((stage) => (
            <div key={stage} className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-3 font-semibold">{stage}</div>
              <div className="text-2xl font-bold text-emerald-400">{stagesByName[stage]?.length || 0}</div>
              <div className="text-gray-500 text-xs mt-2">
                {stage === 'Autonomous' && 'Live Trading'}
                {stage === 'Assisted' && 'Semi-Automated'}
                {stage === 'Paper' && 'Paper Trading'}
                {stage === 'Research' && 'Development'}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          {stages.map((stage) => (
            <div key={stage} className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
              <h2 className="text-xl font-bold text-white mb-4">{stage}</h2>
              {stagesByName[stage]?.length === 0 ? (
                <p className="text-gray-400">No items in this stage</p>
              ) : (
                <div className="space-y-3">
                  {stagesByName[stage]?.slice(0, 5).map((item) => (
                    <div key={item.id} className="border border-[#1e1e2e] bg-[#0a0a0f] rounded-lg p-4 hover:border-emerald-400/30 transition">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="text-white font-semibold">{item.name}</h3>
                          <span className="text-xs text-gray-500">{item.type === 'backtest' ? 'Backtest' : 'Model'}</span>
                        </div>
                        {item.type === 'backtest' && item.pf && (
                          <div className={`text-sm font-bold ${item.pf > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {item.pf.toFixed(2)}
                          </div>
                        )}
                        {item.type === 'model' && item.accuracy && (
                          <div className="text-sm font-bold text-emerald-400">{(item.accuracy * 100).toFixed(0)}%</div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {item.metrics.map((m, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`w-2 h-2 rounded-full ${m.passed ? 'bg-emerald-400' : 'bg-gray-600'}`}></span>
                            <span className={m.passed ? 'text-emerald-400' : 'text-gray-400'}>{m.met}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
