'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';

interface HeatmapLevel {
  price: number;
  bid_vol: number;
  ask_vol: number;
  net: number;
}

interface HeatmapData {
  symbol: string;
  interval: string;
  levels: HeatmapLevel[];
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function HeatmapPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHeatmap = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/flow/${symbol}/heatmap?interval=1min`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const heatmapData = await res.json();
      setData(heatmapData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchHeatmap();
  }, [fetchHeatmap]);

  const getHeatmapColor = (bidVol: number, askVol: number, maxVol: number) => {
    const ratio = Math.max(bidVol, askVol) / maxVol;
    if (bidVol > askVol) {
      const intensity = Math.floor(ratio * 255);
      return `rgba(34, 197, 94, ${0.2 + ratio * 0.6})`; // Green for bids
    } else {
      const intensity = Math.floor(ratio * 255);
      return `rgba(239, 68, 68, ${0.2 + ratio * 0.6})`; // Red for asks
    }
  };

  const maxVol = data ? Math.max(...data.levels.map((l) => Math.max(l.bid_vol, l.ask_vol))) : 1;

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Heatmap Liquidity View</h1>
          <p className="mt-2 text-gray-400">Price level liquidity and market structure</p>
        </div>

        {/* Symbol Selector */}
        <div className="mb-6">
          <select
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
            }}
            style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
            className="rounded border px-4 py-2 text-white"
          >
            {DEFAULT_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : !data || data.levels.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No heatmap data available</p>
          </div>
        ) : (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ backgroundColor: DARK_BG, borderBottomColor: DARK_BORDER }} className="border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Price</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-emerald-400">Bid Volume</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-red-400">Ask Volume</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-blue-400">Net</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">Heatmap</th>
                  </tr>
                </thead>
                <tbody>
                  {data.levels.map((level, idx) => (
                    <tr
                      key={idx}
                      style={{ backgroundColor: idx % 2 === 0 ? DARK_CARD : '#0f0f14' }}
                      className="border-t border-[#1e1e2e] hover:bg-[#1a1a2e]"
                    >
                      <td className="px-4 py-3 text-white font-mono font-bold">${level.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center text-emerald-400">{level.bid_vol.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-red-400">{level.ask_vol.toLocaleString()}</td>
                      <td className={`px-4 py-3 text-center font-semibold ${level.net > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {level.net > 0 ? '+' : ''}{level.net.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <div
                            style={{
                              backgroundColor: getHeatmapColor(level.bid_vol, level.ask_vol, maxVol),
                              width: '30px',
                              height: '20px',
                            }}
                            className="rounded"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Legend */}
        {!loading && data && (
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Max Level Volume</p>
              <p className="text-2xl font-bold text-white">{maxVol.toLocaleString()}</p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Total Bid Volume</p>
              <p className="text-2xl font-bold text-emerald-400">
                {data.levels.reduce((sum, l) => sum + l.bid_vol, 0).toLocaleString()}
              </p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Total Ask Volume</p>
              <p className="text-2xl font-bold text-red-400">
                {data.levels.reduce((sum, l) => sum + l.ask_vol, 0).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
