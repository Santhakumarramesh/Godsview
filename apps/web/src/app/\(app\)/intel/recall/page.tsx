'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface HistoricalMatch {
  id: string;
  matchDate: string;
  symbol: string;
  similarityPercent: number;
  outcome: 'win' | 'loss';
  pnl: number;
}

const mockMatches: HistoricalMatch[] = [
  {
    id: 'match-1',
    matchDate: '2024-04-10',
    symbol: 'ES',
    similarityPercent: 0.94,
    outcome: 'win',
    pnl: 245,
  },
  {
    id: 'match-2',
    matchDate: '2024-04-05',
    symbol: 'ES',
    similarityPercent: 0.89,
    outcome: 'win',
    pnl: 187,
  },
  {
    id: 'match-3',
    matchDate: '2024-03-28',
    symbol: 'NQ',
    similarityPercent: 0.86,
    outcome: 'loss',
    pnl: -125,
  },
  {
    id: 'match-4',
    matchDate: '2024-03-20',
    symbol: 'ES',
    similarityPercent: 0.91,
    outcome: 'win',
    pnl: 312,
  },
  {
    id: 'match-5',
    matchDate: '2024-03-15',
    symbol: 'GC',
    similarityPercent: 0.82,
    outcome: 'loss',
    pnl: -89,
  },
];

const currentSetup = {
  symbol: 'ES',
  timeframe: '15m',
  structure: 'Higher High, Higher Low',
  buyerAbsorption: 0.78,
  orderFlowDelta: 1240,
  regimeType: 'trending',
};

export default function RecallPage() {
  const [matches, setMatches] = useState<HistoricalMatch[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.memory.searchSimilar();
        setMatches(res);
      } catch {
        setMatches(mockMatches);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-56 bg-white/5 rounded mb-4" />
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Setup Recall</h1>
        <p className="text-gray-400">Historical similarity matching and pattern analysis</p>
      </div>

      {/* Current Setup */}
      <div className="bg-gradient-to-br from-blue-950/30 to-cyan-950/30 border border-cyan-800/30 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Current Setup</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-gray-400 text-sm mb-1">Symbol</p>
            <p className="text-2xl font-bold text-white">{currentSetup.symbol}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm mb-1">Structure</p>
            <p className="text-lg font-semibold text-cyan-400">{currentSetup.structure}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm mb-1">Buyer Absorption</p>
            <p className="text-2xl font-bold text-green-400">{(currentSetup.buyerAbsorption * 100).toFixed(0)}%</p>
          </div>
        </div>
      </div>

      {/* Matches Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-800/30">
          <h2 className="text-lg font-semibold text-white">Historical Matches</h2>
          <p className="text-sm text-gray-400 mt-1">
            {matches ? `Found ${matches.length} similar setups` : 'No matches found'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/20">
                <th className="px-6 py-3 text-left text-white font-semibold">Match Date</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Symbol</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Similarity</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Outcome</th>
                <th className="px-6 py-3 text-left text-white font-semibold">PnL</th>
              </tr>
            </thead>
            <tbody>
              {matches && matches.length > 0 ? (
                matches.map((match) => (
                  <tr key={match.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 text-gray-300">{match.matchDate}</td>
                    <td className="px-6 py-4 text-white font-semibold">{match.symbol}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
                            style={{ width: `${match.similarityPercent * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-white">{(match.similarityPercent * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium w-fit ${match.outcome === 'win' ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
                        {match.outcome === 'win' ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        <span className="capitalize">{match.outcome}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-semibold ${match.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {match.pnl > 0 ? '+' : ''}{match.pnl}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No historical matches found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
