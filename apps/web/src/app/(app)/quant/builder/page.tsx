'use client'

import { useState, useEffect, useCallback } from 'react'

interface Symbol {
  symbol: string
}

interface RunResult {
  run_id: string
  symbol: string
  strategy: string
  pf: number
  sharpe: number
  win_rate: number
}

export default function StrategyBuilderPage() {
  const [symbols, setSymbols] = useState<string[]>([])
  const [timeframes, setTimeframes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    symbol: '',
    timeframe: '',
    strategy: 'momentum',
    entry_condition: '',
    exit_condition: '',
    max_loss_pct: 2.0,
    position_size: 1.0,
    start_date: '2023-01-01',
    end_date: '2024-01-01',
  })

  useEffect(() => {
    fetchOptions()
  }, [])

  const fetchOptions = useCallback(async () => {
    try {
      setLoading(true)
      const [symsRes, tfRes] = await Promise.all([
        fetch('/api/market/symbols'),
        fetch('/api/backtest/timeframes'),
      ])

      if (!symsRes.ok || !tfRes.ok) throw new Error('Failed to fetch options')

      const symsData = await symsRes.json()
      const tfData = await tfRes.json()

      setSymbols(symsData.symbols?.map((s: Symbol | string) => 
        typeof s === 'string' ? s : s.symbol
      ) || [])
      setTimeframes(tfData.timeframes || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load options')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.symbol || !formData.timeframe) {
      setError('Symbol and timeframe required')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: formData.symbol,
          strategy: formData.strategy,
          start_date: formData.start_date,
          end_date: formData.end_date,
          timeframe: formData.timeframe,
        }),
      })

      if (!res.ok) throw new Error('Backtest failed')
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Strategy Builder</h1>
        <p className="text-gray-400 mb-8">Configure and backtest your trading strategy</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <form onSubmit={handleSubmit} className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Symbol</label>
                <select
                  value={formData.symbol}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                  className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                >
                  <option value="">Select symbol</option>
                  {symbols.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Timeframe</label>
                <select
                  value={formData.timeframe}
                  onChange={(e) => setFormData({ ...formData, timeframe: e.target.value })}
                  className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                >
                  <option value="">Select timeframe</option>
                  {timeframes.map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Strategy Type</label>
                <select
                  value={formData.strategy}
                  onChange={(e) => setFormData({ ...formData, strategy: e.target.value })}
                  className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                >
                  <option value="momentum">Momentum</option>
                  <option value="mean_reversion">Mean Reversion</option>
                  <option value="ob_retest">OB Retest</option>
                  <option value="trend_following">Trend Following</option>
                  <option value="liquidity_sweep">Liquidity Sweep</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Entry Condition</label>
                <textarea
                  value={formData.entry_condition}
                  onChange={(e) => setFormData({ ...formData, entry_condition: e.target.value })}
                  className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white text-sm h-20"
                  placeholder="e.g., price > MA(20) and volume > avg_vol"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Exit Condition</label>
                <textarea
                  value={formData.exit_condition}
                  onChange={(e) => setFormData({ ...formData, exit_condition: e.target.value })}
                  className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white text-sm h-20"
                  placeholder="e.g., price < MA(20) or time > 4h"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">Max Loss %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.max_loss_pct}
                    onChange={(e) => setFormData({ ...formData, max_loss_pct: parseFloat(e.target.value) })}
                    className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">Position Size</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.position_size}
                    onChange={(e) => setFormData({ ...formData, position_size: parseFloat(e.target.value) })}
                    className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">Start Date</label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">End Date</label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-emerald-400 text-black font-semibold py-2 rounded-lg hover:bg-emerald-500 transition disabled:opacity-50"
              >
                {submitting ? 'Running Backtest...' : 'Run Backtest'}
              </button>
            </div>
          </form>

          <div>
            {result ? (
              <div className="border border-emerald-400/30 bg-emerald-400/5 rounded-lg p-6">
                <h3 className="text-xl font-bold text-white mb-4">Results</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Run ID:</span>
                    <span className="text-white font-mono text-sm">{result.run_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Profit Factor:</span>
                    <span className={`font-semibold ${result.pf > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {result.pf.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Sharpe Ratio:</span>
                    <span className="text-emerald-400 font-semibold">{result.sharpe.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Win Rate:</span>
                    <span className="text-emerald-400 font-semibold">{(result.win_rate * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6 text-center text-gray-400">
                Configure and run a backtest to see results
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
