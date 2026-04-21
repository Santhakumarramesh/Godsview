'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Star } from 'lucide-react';
import { api } from '@/lib/api';

interface ConfluenceZone {
  price: number;
  signals: number;
  strength: number;
  type: string;
}

interface ConfluenceData {
  symbol: string;
  zones: ConfluenceZone[];
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ'];

export default function ConfluencePage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<ConfluenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterHigh, setFilterHigh] = useState(true);

  const fetchConfluence = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/flow/${symbol}/confluence`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const confluenceData = await res.json();
      setData(confluenceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchConfluence();
  }, [fetchConfluence]);

  const filteredZones = data
    ? filterHigh
      ? data.zones.filter((z) => z.strength >= 0.7)
      : data.zones
    : [];

  const getStrengthColor = (strength: number) => {
    if (strength >= 0.8) return 'bg-emerald-500/20 text-emerald-400';
    if (strength >= 0.6) return 'bg-blue-500/20 text-blue-400';
    return 'bg-gray-500/20 text-gray-400';
  };

  const getTypeColor = (type: string) => {
    if (type === 'support') return 'text-emerald-400';
    if (type === 'resistance') return 'text-red-400';
    return 'text-blue-400';
  };

  const getTypeIcon = (type: string) => {
    if (type === 'support') return '⬆';
    if (type === 'resistance') return '⬇';
    return '◆';
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Flow + Structure Confluence</h1>
          <p className="mt-2 text-gray-400">High-confluence trade setups combining flow & structure</p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex items-center gap-4">
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
          <label className="flex items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              checked={filterHigh}
              onChange={(e) => setFilterHigh(e.target.checked)}
              className="h-4 w-4"
            />
            <span>High confluence only</span>
          </label>
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
        ) : filteredZones.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">
              {filterHigh ? 'No high-confluence zones found' : 'No confluence zones available'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredZones.map((zone, idx) => (
              <div
                key={idx}
                style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
                className="rounded-lg border p-4 hover:bg-[#1a1a2e] transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className={`text-2xl ${getTypeColor(zone.type)}`}>
                      {getTypeIcon(zone.type)}
                    </div>

                    {/* Zone Info */}
                    <div>
                      <p className="text-white font-mono font-bold text-lg">${zone.price.toFixed(2)}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          zone.type === 'support'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {zone.type.toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500">{zone.signals} signals</span>
                      </div>
                    </div>
                  </div>

                  {/* Strength Indicator */}
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            size={16}
                            className={i < Math.round(zone.strength * 5) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}
                          />
                        ))}
                      </div>
                      <p className={`mt-2 rounded-full px-3 py-1 text-xs font-semibold text-center ${getStrengthColor(zone.strength)}`}>
                        {(zone.strength * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary Stats */}
        {!loading && data && (
          <div className="mt-8 grid gap-4 grid-cols-2 md:grid-cols-4">
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400 text-sm">Total Zones</p>
              <p className="text-2xl font-bold text-white mt-1">{data.zones.length}</p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400 text-sm">High Confluence</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">
                {data.zones.filter((z) => z.strength >= 0.7).length}
              </p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400 text-sm">Support Levels</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">
                {data.zones.filter((z) => z.type === 'support').length}
              </p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400 text-sm">Resistance Levels</p>
              <p className="text-2xl font-bold text-red-400 mt-1">
                {data.zones.filter((z) => z.type === 'resistance').length}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
