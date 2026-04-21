'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, TrendingUp, Filter } from 'lucide-react';

interface MissedOpportunity {
  id: string;
  date: string;
  symbol: string;
  expectedMove: number;
  reasonMissed: string;
  potentialPnL: number;
  conviction: 'high' | 'medium' | 'low';
}

const mockMissed: MissedOpportunity[] = [
  {
    id: 'miss-1',
    date: '2024-04-18',
    symbol: 'ES',
    expectedMove: 45,
    reasonMissed: 'Waiting for stronger confirmation, BOS formed too quickly',
    potentialPnL: 450,
    conviction: 'high',
  },
  {
    id: 'miss-2',
    date: '2024-04-17',
    symbol: 'NQ',
    reasonMissed: 'Was in another position, capital unavailable',
    expectedMove: 75,
    potentialPnL: 750,
    conviction: 'high',
  },
  {
    id: 'miss-3',
    date: '2024-04-16',
    symbol: 'GC',
    expectedMove: 12,
    reasonMissed: 'Conflicting signals on 1H timeframe, too risky',
    potentialPnL: 120,
    conviction: 'medium',
  },
  {
    id: 'miss-4',
    date: '2024-04-15',
    symbol: 'CL',
    expectedMove: 0.8,
    reasonMissed: 'Missed entry window - order fill issue',
    potentialPnL: 400,
    conviction: 'high',
  },
  {
    id: 'miss-5',
    date: '2024-04-14',
    symbol: 'ZB',
    expectedMove: 1.2,
    reasonMissed: 'Not in watch list, no alert triggered',
    potentialPnL: 240,
    conviction: 'low',
  },
  {
    id: 'miss-6',
    date: '2024-04-13',
    symbol: 'ES',
    expectedMove: 32,
    reasonMissed: 'Sentiment conflicted with technicals',
    potentialPnL: 320,
    conviction: 'medium',
  },
];

export default function MissedPage() {
  const [opportunities, setOpportunities] = useState<MissedOpportunity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.ml.getMissedSetups();
        setOpportunities(res);
      } catch {
        setOpportunities(mockMissed);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  const filtered =
    opportunities && filter !== 'all'
      ? opportunities.filter((opp) => opp.conviction === filter)
      : opportunities;

  const getConvictionColor = (conviction: string) => {
    switch (conviction) {
      case 'high':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      case 'low':
        return 'bg-orange-500/20 text-orange-300 border border-orange-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  const getTotalMissed = () => {
    return opportunities ? opportunities.reduce((sum, opp) => sum + opp.potentialPnL, 0) : 0;
  };

  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-500 mb-4" />
          <p className="text-gray-400">No missed opportunities available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Missed Opportunities</h1>
        <p className="text-gray-400">High-conviction setups that were not executed</p>
      </div>

      {/* Summary Card */}
      <div className="bg-gradient-to-br from-orange-950/30 to-red-950/30 border border-red-800/30 rounded-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-gray-400 text-sm mb-2">Total Opportunities Missed</p>
            <p className="text-3xl font-bold text-white">{opportunities.length}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm mb-2">Potential PnL Lost</p>
            <p className="text-3xl font-bold text-red-400">
              {getTotalMissed() > 0 ? '+' : ''}{getTotalMissed()}
            </p>
          </div>
          <div>
            <p className="text-gray-400 text-sm mb-2">High Conviction Missed</p>
            <p className="text-3xl font-bold text-orange-400">
              {opportunities.filter((o) => o.conviction === 'high').length}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          <Filter className="w-4 h-4 inline mr-2" />
          All
        </button>
        <button
          onClick={() => setFilter('high')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${filter === 'high' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          High Conviction
        </button>
        <button
          onClick={() => setFilter('medium')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${filter === 'medium' ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Medium Conviction
        </button>
        <button
          onClick={() => setFilter('low')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${filter === 'low' ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Low Conviction
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/30">
                <th className="px-6 py-3 text-left text-white font-semibold">Date</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Symbol</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Expected Move</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Reason Missed</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Potential PnL</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Conviction</th>
              </tr>
            </thead>
            <tbody>
              {filtered && filtered.length > 0 ? (
                filtered.map((opp) => (
                  <tr key={opp.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 text-gray-300">{opp.date}</td>
                    <td className="px-6 py-4 text-white font-semibold">{opp.symbol}</td>
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-1 text-blue-400 font-medium">
                        <TrendingUp className="w-4 h-4" />
                        {opp.expectedMove > 1 ? opp.expectedMove : opp.expectedMove.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-300 max-w-xs">{opp.reasonMissed}</td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-yellow-400">+{opp.potentialPnL}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${getConvictionColor(opp.conviction)}`}>
                        {opp.conviction}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No missed opportunities in this category
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
