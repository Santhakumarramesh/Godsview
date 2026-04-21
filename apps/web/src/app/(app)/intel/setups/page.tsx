'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface Setup {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entryZone: { low: number; high: number };
  stop: number;
  targets: number[];
  confluenceScore: number;
  status: 'new' | 'validated' | 'pending' | 'rejected';
}

const mockSetups: Setup[] = [
  {
    id: 'setup-1',
    symbol: 'ES',
    direction: 'long',
    entryZone: { low: 5480, high: 5495 },
    stop: 5450,
    targets: [5530, 5560, 5590],
    confluenceScore: 0.92,
    status: 'validated',
  },
  {
    id: 'setup-2',
    symbol: 'NQ',
    direction: 'long',
    entryZone: { low: 17620, high: 17645 },
    stop: 17580,
    targets: [17720, 17790, 17860],
    confluenceScore: 0.87,
    status: 'new',
  },
  {
    id: 'setup-3',
    symbol: 'GC',
    direction: 'short',
    entryZone: { low: 2455, high: 2460 },
    stop: 2475,
    targets: [2430, 2410, 2390],
    confluenceScore: 0.76,
    status: 'pending',
  },
  {
    id: 'setup-4',
    symbol: 'CL',
    direction: 'long',
    entryZone: { low: 83.40, high: 83.60 },
    stop: 83.00,
    targets: [84.20, 84.80, 85.40],
    confluenceScore: 0.84,
    status: 'validated',
  },
  {
    id: 'setup-5',
    symbol: 'ZB',
    direction: 'short',
    entryZone: { low: 156.20, high: 156.35 },
    stop: 157.00,
    targets: [155.50, 155.00, 154.50],
    confluenceScore: 0.65,
    status: 'rejected',
  },
];

export default function SetupsPage() {
  const [setups, setSetups] = useState<Setup[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.scanner.getOpportunities();
        setSetups(res);
      } catch {
        setSetups(mockSetups);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse h-56 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'validated':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'new':
        return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      case 'rejected':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  const getDirectionIcon = (direction: string) => {
    return direction === 'long' ? (
      <TrendingUp className="w-4 h-4" />
    ) : (
      <TrendingDown className="w-4 h-4" />
    );
  };

  const getConfluenceColor = (score: number) => {
    if (score >= 0.85) return 'text-green-400';
    if (score >= 0.75) return 'text-yellow-400';
    return 'text-orange-400';
  };

  if (!setups || setups.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-500 mb-4" />
          <p className="text-gray-400">No setups available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Active Setups</h1>
        <p className="text-gray-400">Scanned trading opportunities with confluence scores</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {setups.map((setup) => (
          <div
            key={setup.id}
            className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-white">{setup.symbol}</span>
                <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${setup.direction === 'long' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                  {getDirectionIcon(setup.direction)}
                  <span className="capitalize">{setup.direction}</span>
                </span>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(setup.status)}`}>
                {setup.status}
              </span>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <p className="text-gray-400 text-xs mb-1">Entry Zone</p>
                <p className="text-white font-semibold">
                  {setup.entryZone.low.toFixed(2)} - {setup.entryZone.high.toFixed(2)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-gray-400 text-xs mb-1">Stop Loss</p>
                  <p className="text-red-400 font-semibold">{setup.stop.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Confluence</p>
                  <p className={`text-lg font-bold ${getConfluenceColor(setup.confluenceScore)}`}>
                    {(setup.confluenceScore * 100).toFixed(0)}%
                  </p>
                </div>
              </div>

              <div>
                <p className="text-gray-400 text-xs mb-2">Targets</p>
                <div className="flex gap-2">
                  {setup.targets.map((target, idx) => (
                    <span
                      key={idx}
                      className="bg-green-500/20 text-green-300 px-2 py-1 rounded text-xs font-semibold"
                    >
                      T{idx + 1}: {target.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-800 pt-3">
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${setup.confluenceScore >= 0.85 ? 'bg-green-500' : setup.confluenceScore >= 0.75 ? 'bg-yellow-500' : 'bg-orange-500'}`}
                  style={{ width: `${setup.confluenceScore * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
