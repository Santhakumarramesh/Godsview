'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react';

interface TradeRecord {
  id: string;
  date: string;
  symbol: string;
  strategy: string;
  entry: number;
  exit: number;
  pnl: number;
  lessonLearned: string;
}

interface FeedbackStats {
  winRateImprovement: number;
  winRate: number;
  totalTrades: number;
  commonMistakes: string[];
  bestPatterns: string[];
}

const mockTrades: TradeRecord[] = [
  {
    id: 'trade-1',
    date: '2024-04-19',
    symbol: 'ES',
    strategy: 'Structure Breakout',
    entry: 5485,
    exit: 5520,
    pnl: 350,
    lessonLearned: 'Confirmed CHOCH before entry - high conviction',
  },
  {
    id: 'trade-2',
    date: '2024-04-18',
    symbol: 'NQ',
    strategy: 'Order Flow Confluence',
    entry: 17620,
    exit: 17695,
    pnl: 525,
    lessonLearned: 'Volume spike confirmed uptick - best signals',
  },
  {
    id: 'trade-3',
    date: '2024-04-17',
    symbol: 'ES',
    strategy: 'Mean Reversion',
    entry: 5510,
    exit: 5495,
    pnl: -225,
    lessonLearned: 'Entered too early - need stronger BOS confirmation',
  },
  {
    id: 'trade-4',
    date: '2024-04-16',
    symbol: 'CL',
    strategy: 'Structure Breakout',
    entry: 83.45,
    exit: 84.10,
    pnl: 445,
    lessonLearned: 'MTF alignment was key - wait for confluence',
  },
  {
    id: 'trade-5',
    date: '2024-04-15',
    symbol: 'GC',
    strategy: 'Order Flow Confluence',
    entry: 2455,
    exit: 2430,
    pnl: -150,
    lessonLearned: 'Ignored contradicting flow signal - cost entry',
  },
];

const mockStats: FeedbackStats = {
  winRateImprovement: 0.12,
  winRate: 0.64,
  totalTrades: 32,
  commonMistakes: ['Ignoring contradicting signals', 'Early entry before confirmation', 'Not respecting support/resistance'],
  bestPatterns: ['CHOCH with volume spike', 'MTF alignment on BOS', 'Order flow delta confirmation'],
};

export default function FeedbackPage() {
  const [trades, setTrades] = useState<TradeRecord[] | null>(null);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.memory.getFeedback();
        setTrades(res?.trades || mockTrades);
        setStats(res?.stats || mockStats);
      } catch {
        setTrades(mockTrades);
        setStats(mockStats);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse h-24 bg-white/5 rounded" />
          ))}
        </div>
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Feedback Loop</h1>
        <p className="text-gray-400">Post-trade analysis and pattern recognition</p>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Win Rate</p>
            <p className="text-3xl font-bold text-green-400">{(stats.winRate * 100).toFixed(1)}%</p>
            <p className="text-xs text-gray-500 mt-2">
              <span className="text-green-400">
                +{(stats.winRateImprovement * 100).toFixed(1)}%
              </span>{' '}
              improvement
            </p>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Total Trades</p>
            <p className="text-3xl font-bold text-white">{stats.totalTrades}</p>
            <p className="text-xs text-gray-500 mt-2">Analyzed</p>
          </div>
          <div className="bg-blue-950/30 border border-blue-800/30 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Best Pattern</p>
            <p className="text-lg font-bold text-cyan-400">{stats.bestPatterns[0]}</p>
            <p className="text-xs text-gray-500 mt-2">Highest success rate</p>
          </div>
        </div>
      )}

      {/* Common Mistakes & Best Patterns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats && (
          <>
            <div className="bg-red-950/20 border border-red-800/30 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-400" />
                Common Mistakes
              </h2>
              <ul className="space-y-2">
                {stats.commonMistakes.map((mistake, idx) => (
                  <li key={idx} className="text-red-300 text-sm flex gap-2">
                    <span className="text-red-500 font-bold">•</span>
                    {mistake}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-green-950/20 border border-green-800/30 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-yellow-400" />
                Best Patterns
              </h2>
              <ul className="space-y-2">
                {stats.bestPatterns.map((pattern, idx) => (
                  <li key={idx} className="text-green-300 text-sm flex gap-2">
                    <span className="text-green-500 font-bold">•</span>
                    {pattern}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Trade Records Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-800/30">
          <h2 className="text-lg font-semibold text-white">Recent Trades</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/20">
                <th className="px-6 py-3 text-left text-white font-semibold">Date</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Symbol</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Strategy</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Entry</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Exit</th>
                <th className="px-6 py-3 text-left text-white font-semibold">PnL</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Lesson</th>
              </tr>
            </thead>
            <tbody>
              {trades && trades.length > 0 ? (
                trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 text-gray-300">{trade.date}</td>
                    <td className="px-6 py-4 text-white font-semibold">{trade.symbol}</td>
                    <td className="px-6 py-4 text-gray-300">{trade.strategy}</td>
                    <td className="px-6 py-4 text-gray-300">{trade.entry.toFixed(2)}</td>
                    <td className="px-6 py-4 text-gray-300">{trade.exit.toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span className={`font-semibold flex items-center gap-1 ${trade.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {trade.pnl > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {trade.pnl > 0 ? '+' : ''}{trade.pnl}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-300 max-w-xs truncate">{trade.lessonLearned}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No trades available
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
