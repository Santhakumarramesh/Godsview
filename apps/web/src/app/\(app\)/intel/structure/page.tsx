'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { TrendingUp, TrendingDown, AlertCircle, Target } from 'lucide-react';

interface StructureData {
  symbol: string;
  trend: 'up' | 'down' | 'range';
  bosEvents: number;
  chochEvents: number;
  activeOrderBlocks: number;
  mtfAlignment: number;
}

const mockStructure: StructureData[] = [
  {
    symbol: 'ES',
    trend: 'up',
    bosEvents: 3,
    chochEvents: 1,
    activeOrderBlocks: 2,
    mtfAlignment: 0.94,
  },
  {
    symbol: 'NQ',
    trend: 'up',
    bosEvents: 4,
    chochEvents: 0,
    activeOrderBlocks: 3,
    mtfAlignment: 0.89,
  },
  {
    symbol: 'GC',
    trend: 'down',
    bosEvents: 2,
    chochEvents: 2,
    activeOrderBlocks: 1,
    mtfAlignment: 0.76,
  },
  {
    symbol: 'CL',
    trend: 'up',
    bosEvents: 3,
    chochEvents: 1,
    activeOrderBlocks: 2,
    mtfAlignment: 0.84,
  },
  {
    symbol: 'ZB',
    trend: 'range',
    bosEvents: 1,
    chochEvents: 0,
    activeOrderBlocks: 2,
    mtfAlignment: 0.71,
  },
];

export default function StructurePage() {
  const [structure, setStructure] = useState<StructureData[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.features.getStructure();
        setStructure(res);
      } catch {
        setStructure(mockStructure);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse h-56 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'up':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'down':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      case 'range':
        return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="w-4 h-4" />;
      case 'down':
        return <TrendingDown className="w-4 h-4" />;
      case 'range':
        return <Target className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getMtfColor = (alignment: number) => {
    if (alignment >= 0.85) return 'text-green-400';
    if (alignment >= 0.75) return 'text-yellow-400';
    return 'text-orange-400';
  };

  if (!structure || structure.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-500 mb-4" />
          <p className="text-gray-400">No structure data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Market Structure</h1>
        <p className="text-gray-400">Supply/demand zones and multi-timeframe alignment</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {structure.map((data) => (
          <div
            key={data.symbol}
            className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-2xl font-bold text-white">{data.symbol}</h3>
              <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getTrendColor(data.trend)}`}>
                {getTrendIcon(data.trend)}
                <span className="capitalize">{data.trend}</span>
              </span>
            </div>

            <div className="space-y-4">
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-sm mb-1">Break of Structure (BOS)</div>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-bold text-white">{data.bosEvents}</span>
                  <span className="text-xs text-gray-500">events</span>
                </div>
              </div>

              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-sm mb-1">Change of Character (CHOCH)</div>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-bold text-white">{data.chochEvents}</span>
                  <span className="text-xs text-gray-500">events</span>
                </div>
              </div>

              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-sm mb-1">Active Order Blocks</div>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-bold text-white">{data.activeOrderBlocks}</span>
                  <span className="text-xs text-gray-500">zones</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-sm">MTF Alignment</span>
                  <span className={`text-sm font-bold ${getMtfColor(data.mtfAlignment)}`}>
                    {(data.mtfAlignment * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      data.mtfAlignment >= 0.85
                        ? 'bg-green-500'
                        : data.mtfAlignment >= 0.75
                          ? 'bg-yellow-500'
                          : 'bg-orange-500'
                    }`}
                    style={{ width: `${data.mtfAlignment * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
