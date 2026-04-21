'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

interface DOMLevel {
  price: number;
  size: number;
}

interface DOMData {
  symbol: string;
  bids: DOMLevel[];
  asks: DOMLevel[];
  spread: number;
  midpoint: number;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function DOMPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<DOMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDOM = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const domData = await api.flow.getDOM(symbol).catch(() => {
        // Mock fallback
        return {
          symbol,
          bids: [
            { price: 149.95, size: 1500 },
            { price: 149.90, size: 2000 },
            { price: 149.85, size: 1200 },
          ],
          asks: [
            { price: 150.05, size: 1800 },
            { price: 150.10, size: 1600 },
            { price: 150.15, size: 900 },
          ],
          spread: 0.10,
          midpoint: 150.00,
        }
      });
      setData(domData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchDOM();
    const interval = setInterval(fetchDOM, 5000); // Auto-refresh every 5s
    return () => clearInterval(interval);
  }, [fetchDOM]);

  const maxSize = data
    ? Math.max(...data.bids.map((b) => b.size), ...data.asks.map((a) => a.size))
    : 1;

  const getBarWidth = (size: number) => {
    return Math.min((size / maxSize) * 100, 100);
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">DOM / Depth Monitor</h1>
            <p className="mt-2 text-gray-400">Real-time bid/ask ladder</p>
          </div>
          <button
            onClick={fetchDOM}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
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
        {loading && !data ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : !data ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No DOM data available</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Asks */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <h3 className="mb-4 text-sm font-bold text-red-400">ASK SIDE</h3>
              <div className="space-y-2">
                {data.asks.slice(0, 10).map((ask, idx) => (
                  <div key={idx} className="relative">
                    <div
                      style={{
                        width: `${getBarWidth(ask.size)}%`,
                        backgroundColor: 'rgba(239, 68, 68, 0.2)',
                      }}
                      className="absolute h-full rounded"
                    />
                    <div className="relative flex items-center justify-between p-2">
                      <span className="text-xs font-mono text-red-400">${ask.price.toFixed(2)}</span>
                      <span className="text-xs text-gray-400">{ask.size.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Midpoint */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <h3 className="mb-4 text-sm font-bold text-white">MIDPOINT</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-gray-400">Current</p>
                  <p className="text-2xl font-bold text-white">${data.midpoint.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Spread</p>
                  <p className="text-2xl font-bold text-blue-400">${data.spread.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Spread %</p>
                  <p className="text-2xl font-bold text-purple-400">
                    {((data.spread / data.midpoint) * 100).toFixed(4)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Bids */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <h3 className="mb-4 text-sm font-bold text-emerald-400">BID SIDE</h3>
              <div className="space-y-2">
                {data.bids.slice(0, 10).map((bid, idx) => (
                  <div key={idx} className="relative">
                    <div
                      style={{
                        width: `${getBarWidth(bid.size)}%`,
                        backgroundColor: 'rgba(34, 197, 94, 0.2)',
                      }}
                      className="absolute h-full rounded"
                    />
                    <div className="relative flex items-center justify-between p-2">
                      <span className="text-xs font-mono text-emerald-400">${bid.price.toFixed(2)}</span>
                      <span className="text-xs text-gray-400">{bid.size.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
