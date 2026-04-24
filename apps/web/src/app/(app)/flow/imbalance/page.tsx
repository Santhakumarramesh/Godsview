'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, ArrowUp, ArrowDown, Zap } from 'lucide-react';
import { api } from '@/lib/api';

interface ImbalanceData {
  symbol: string;
  buy_imbalance: number;
  sell_imbalance: number;
  ratio: number;
  persistent: boolean;
  direction: string;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function ImbalancePage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<ImbalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImbalance = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/flow/${symbol}/imbalance`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const imbalanceData = await res.json();
      setData(imbalanceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchImbalance();
    const interval = setInterval(fetchImbalance, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [fetchImbalance]);

  const getDirectionColor = (direction: string) => {
    if (direction === 'bullish' || direction === 'buy') return 'text-emerald-400';
    if (direction === 'bearish' || direction === 'sell') return 'text-red-400';
    return 'text-gray-400';
  };

  const getDirectionIcon = (direction: string) => {
    if (direction === 'bullish' || direction === 'buy') return ArrowUp;
    if (direction === 'bearish' || direction === 'sell') return ArrowDown;
    return Zap;
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Imbalance Engine</h1>
          <p className="mt-2 text-gray-400">Real-time bid/ask imbalance monitoring</p>
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
        ) : !data ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No imbalance data available</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Direction */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Direction</p>
                  <p className={`text-4xl font-bold mt-2 ${getDirectionColor(data.direction)}`}>
                    {data.direction.toUpperCase()}
                  </p>
                </div>
                {(() => {
                  const Icon = getDirectionIcon(data.direction);
                  return <Icon size={48} className={getDirectionColor(data.direction)} />;
                })()}
              </div>
              {data.persistent && (
                <div className="mt-4 flex items-center gap-2 rounded bg-purple-500/20 px-3 py-2 text-purple-400">
                  <Zap size={16} />
                  <span className="text-sm font-semibold">Persistent imbalance</span>
                </div>
              )}
            </div>

            {/* Metrics Grid */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* Buy Imbalance */}
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400 text-sm">Buy Imbalance</p>
                <p className="text-2xl font-bold text-emerald-400 mt-2">
                  {(data.buy_imbalance * 100).toFixed(2)}%
                </p>
                <div className="mt-4 h-2 w-full rounded bg-gray-700">
                  <div
                    style={{
                      width: `${Math.min(data.buy_imbalance * 100, 100)}%`,
                      backgroundColor: 'rgb(34, 197, 94)',
                    }}
                    className="h-full rounded"
                  />
                </div>
              </div>

              {/* Sell Imbalance */}
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400 text-sm">Sell Imbalance</p>
                <p className="text-2xl font-bold text-red-400 mt-2">
                  {(data.sell_imbalance * 100).toFixed(2)}%
                </p>
                <div className="mt-4 h-2 w-full rounded bg-gray-700">
                  <div
                    style={{
                      width: `${Math.min(data.sell_imbalance * 100, 100)}%`,
                      backgroundColor: 'rgb(239, 68, 68)',
                    }}
                    className="h-full rounded"
                  />
                </div>
              </div>

              {/* Ratio */}
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400 text-sm">Buy/Sell Ratio</p>
                <p className="text-2xl font-bold text-blue-400 mt-2">{data.ratio.toFixed(3)}</p>
                <p className={`text-xs mt-2 ${data.ratio > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.ratio > 1 ? 'Bullish bias' : 'Bearish bias'}
                </p>
              </div>
            </div>

            {/* Status */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-sm">Status</p>
                  <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                    data.persistent
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {data.persistent ? 'Persistent' : 'Transient'}
                  </span>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Last Updated</p>
                  <p className="text-sm text-white mt-2">{new Date().toLocaleTimeString()}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
