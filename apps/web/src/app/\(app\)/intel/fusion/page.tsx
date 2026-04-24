'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, Zap } from 'lucide-react';

interface ConfluenceSignal {
  symbol: string;
  confluenceScore: number;
  structurePercent: number;
  flowPercent: number;
  sentimentPercent: number;
  regimePercent: number;
}

const mockConfluence: ConfluenceSignal[] = [
  {
    symbol: 'ES',
    confluenceScore: 0.92,
    structurePercent: 28,
    flowPercent: 25,
    sentimentPercent: 22,
    regimePercent: 25,
  },
  {
    symbol: 'NQ',
    confluenceScore: 0.87,
    structurePercent: 30,
    flowPercent: 23,
    sentimentPercent: 20,
    regimePercent: 27,
  },
  {
    symbol: 'GC',
    confluenceScore: 0.76,
    structurePercent: 26,
    flowPercent: 28,
    sentimentPercent: 18,
    regimePercent: 28,
  },
  {
    symbol: 'CL',
    confluenceScore: 0.84,
    structurePercent: 32,
    flowPercent: 24,
    sentimentPercent: 16,
    regimePercent: 28,
  },
  {
    symbol: 'ZB',
    confluenceScore: 0.71,
    structurePercent: 25,
    flowPercent: 26,
    sentimentPercent: 24,
    regimePercent: 25,
  },
];

export default function FusionPage() {
  const [signals, setSignals] = useState<ConfluenceSignal[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.features.getConfluence();
        setSignals(res);
      } catch {
        setSignals(mockConfluence);
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
            <div key={i} className="animate-pulse h-48 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 0.85) return 'text-green-400';
    if (score >= 0.75) return 'text-yellow-400';
    return 'text-orange-400';
  };

  if (!signals || signals.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-500 mb-4" />
          <p className="text-gray-400">No confluence data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Signal Fusion</h1>
        <p className="text-gray-400">Multi-signal confluence analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {signals.map((signal) => (
          <div
            key={signal.symbol}
            className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-2xl font-bold text-white">{signal.symbol}</h3>
              <div className="flex items-center gap-2">
                <Zap className={`w-5 h-5 ${getScoreColor(signal.confluenceScore)}`} />
              </div>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 text-sm">Confluence Score</span>
                <span className={`text-xl font-bold ${getScoreColor(signal.confluenceScore)}`}>
                  {(signal.confluenceScore * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    signal.confluenceScore >= 0.85
                      ? 'bg-green-500'
                      : signal.confluenceScore >= 0.75
                        ? 'bg-yellow-500'
                        : 'bg-orange-500'
                  }`}
                  style={{ width: `${signal.confluenceScore * 100}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Structure</span>
                <span className="text-white font-medium">{signal.structurePercent}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${signal.structurePercent}%` }} />
              </div>

              <div className="flex justify-between items-center text-sm mt-3">
                <span className="text-gray-400">Flow</span>
                <span className="text-white font-medium">{signal.flowPercent}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500" style={{ width: `${signal.flowPercent}%` }} />
              </div>

              <div className="flex justify-between items-center text-sm mt-3">
                <span className="text-gray-400">Sentiment</span>
                <span className="text-white font-medium">{signal.sentimentPercent}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500" style={{ width: `${signal.sentimentPercent}%` }} />
              </div>

              <div className="flex justify-between items-center text-sm mt-3">
                <span className="text-gray-400">Regime</span>
                <span className="text-white font-medium">{signal.regimePercent}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-pink-500" style={{ width: `${signal.regimePercent}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
