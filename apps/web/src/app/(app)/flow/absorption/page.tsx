'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Shield } from 'lucide-react';

interface AbsorptionLevel {
  price: number;
  absorbed_vol: number;
  attempts: number;
  defended: boolean;
  side: string;
}

interface AbsorptionData {
  symbol: string;
  levels: AbsorptionLevel[];
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function AbsorptionPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<AbsorptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAbsorption = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/flow/${symbol}/absorption`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const absData = await res.json();
      setData(absData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchAbsorption();
  }, [fetchAbsorption]);

  const defendedLevels = data ? data.levels.filter((l) => l.defended).length : 0;

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Absorption Detector</h1>
          <p className="mt-2 text-gray-400">Identify levels with significant order absorption</p>
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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : !data || data.levels.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No absorption data available</p>
          </div>
        ) : (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead style={{ backgroundColor: DARK_BG, borderBottomColor: DARK_BORDER }} className="border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Price Level</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-gray-300">Side</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-emerald-400">Absorbed Vol</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-blue-400">Attempts</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-purple-400">Defended</th>
                </tr>
              </thead>
              <tbody>
                {data.levels.sort((a, b) => (b.defended ? 1 : -1)).map((level, idx) => (
                  <tr
                    key={idx}
                    style={{
                      backgroundColor: idx % 2 === 0 ? DARK_CARD : '#0f0f14',
                    }}
                    className={`border-t border-[#1e1e2e] hover:bg-[#1a1a2e] ${level.defended ? 'ring-1 ring-purple-500/30' : ''}`}
                  >
                    <td className="px-6 py-4 text-white font-mono font-bold">${level.price.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          level.side === 'bid'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {level.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-emerald-400 font-mono">
                      {level.absorbed_vol.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center text-blue-400">{level.attempts}</td>
                    <td className="px-6 py-4 text-center">
                      {level.defended ? (
                        <Shield size={18} className="mx-auto text-purple-400" />
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Stats */}
        {!loading && data && (
          <div className="mt-8 grid grid-cols-3 gap-4">
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Total Levels</p>
              <p className="text-2xl font-bold text-white">{data.levels.length}</p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Defended Levels</p>
              <p className="text-2xl font-bold text-purple-400">{defendedLevels}</p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Total Absorbed</p>
              <p className="text-2xl font-bold text-emerald-400">
                {data.levels.reduce((sum, l) => sum + l.absorbed_vol, 0).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
