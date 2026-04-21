'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';

interface FootprintBar {
  t: string;
  delta: number;
  buy_vol: number;
  sell_vol: number;
  imbalance: number;
}

interface FootprintData {
  symbol: string;
  bars: FootprintBar[];
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function FootprintPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState('5min');
  const [data, setData] = useState<FootprintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFootprint = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/flow/${symbol}/footprint?timeframe=${timeframe}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const footprintData = await res.json();
      setData(footprintData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    fetchFootprint();
  }, [fetchFootprint]);

  const getColors = (delta: number) => {
    return delta > 0 ? 'text-emerald-400' : 'text-red-400';
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Footprint / Delta View</h1>
          <p className="mt-2 text-gray-400">Volume delta and bar imbalance analysis</p>
        </div>

        {/* Controls */}
        <div className="mb-6 grid gap-4 grid-cols-2">
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
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
            className="rounded border px-4 py-2 text-white"
          >
            <option value="1min">1 min</option>
            <option value="5min">5 min</option>
            <option value="15min">15 min</option>
            <option value="1hour">1 hour</option>
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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : !data || data.bars.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No footprint data available</p>
          </div>
        ) : (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: DARK_BG, borderBottomColor: DARK_BORDER }} className="border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300">Time</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-400">Buy Vol</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-red-400">Sell Vol</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-blue-400">Delta</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-purple-400">Imbalance</th>
                </tr>
              </thead>
              <tbody>
                {data.bars.slice(-20).map((bar, idx) => (
                  <tr
                    key={idx}
                    style={{ backgroundColor: idx % 2 === 0 ? DARK_CARD : '#0f0f14' }}
                    className="border-t border-[#1e1e2e] hover:bg-[#1a1a2e]"
                  >
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(bar.t).toLocaleTimeString()}</td>
                    <td className="px-4 py-3 text-center text-emerald-400">{bar.buy_vol.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-red-400">{bar.sell_vol.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-center font-semibold ${getColors(bar.delta)}`}>
                      {bar.delta > 0 ? '+' : ''}{bar.delta.toLocaleString()}
                    </td>
                    <td className={`px-4 py-3 text-center ${bar.imbalance > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(bar.imbalance * 100).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
