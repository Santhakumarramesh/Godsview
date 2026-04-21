'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';

interface PressureData {
  symbol: string;
  buy_pressure: number;
  sell_pressure: number;
  net: number;
  dominance: string;
  exhaustion: boolean;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function PressurePage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<PressureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPressure = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/flow/${symbol}/pressure`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const pressureData = await res.json();
      setData(pressureData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchPressure();
  }, [fetchPressure]);

  const getAbsoluteNet = data ? Math.abs(data.net) : 0;
  const netPercent = data ? (getAbsoluteNet / (data.buy_pressure + data.sell_pressure)) * 100 : 0;

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Execution Pressure Map</h1>
          <p className="mt-2 text-gray-400">Buy vs sell execution pressure analysis</p>
        </div>

        {/* Symbol Selector */}
        <div className="mb-6">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
            className="rounded border px-4 py-2 text-white"
          >
            {DEFAULT_SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500 bg-red-500/10 p-4 text-red-400">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
          </div>
        ) : !data ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No pressure data available</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Dominance Alert */}
            {data.exhaustion && (
              <div className="flex items-center gap-3 rounded-lg border border-yellow-500 bg-yellow-500/10 p-4 text-yellow-400">
                <AlertTriangle size={20} />
                <span className="font-semibold">Pressure exhaustion detected</span>
              </div>
            )}

            {/* Pressure Gauge */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-6">
              <p className="mb-6 text-sm font-semibold text-gray-300 uppercase">Execution Pressure</p>

              {/* Bar Gauge */}
              <div className="space-y-4">
                {/* Buy Side */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-emerald-400">Buy Pressure</span>
                    <span className="text-sm font-bold text-white">{(data.buy_pressure * 100).toFixed(2)}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-gray-700">
                    <div
                      style={{
                        width: `${Math.min(data.buy_pressure * 100, 100)}%`,
                        backgroundColor: 'rgb(34, 197, 94)',
                      }}
                      className="h-full rounded-full transition-all"
                    />
                  </div>
                </div>

                {/* Sell Side */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-red-400">Sell Pressure</span>
                    <span className="text-sm font-bold text-white">{(data.sell_pressure * 100).toFixed(2)}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-gray-700">
                    <div
                      style={{
                        width: `${Math.min(data.sell_pressure * 100, 100)}%`,
                        backgroundColor: 'rgb(239, 68, 68)',
                      }}
                      className="h-full rounded-full transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Net Indicator */}
              <div className="mt-6 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
                <p className="text-xs text-gray-400 uppercase">Net Pressure</p>
                <p className={`mt-2 text-3xl font-bold ${data.net > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.net > 0 ? '+' : ''}{(data.net * 100).toFixed(2)}%
                </p>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Dominance */}
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400 text-sm">Market Dominance</p>
                <p className={`text-2xl font-bold mt-2 ${
                  data.dominance === 'buy'
                    ? 'text-emerald-400'
                    : data.dominance === 'sell'
                      ? 'text-red-400'
                      : 'text-gray-400'
                }`}>
                  {data.dominance.toUpperCase()}
                </p>
              </div>

              {/* Exhaustion Status */}
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400 text-sm">Status</p>
                <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                  data.exhaustion
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {data.exhaustion ? 'Exhaustion Alert' : 'Active Pressure'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
