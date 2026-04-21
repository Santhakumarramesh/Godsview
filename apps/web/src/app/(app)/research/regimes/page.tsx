'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, TrendingUp, TrendingDown, Zap } from 'lucide-react';

interface RegimeData {
  type: 'trending' | 'choppy' | 'volatile' | 'news-driven';
  confidence: number;
  startDate: string;
  currentDuration: string;
}

interface HistoricalRegime {
  id: string;
  type: 'trending' | 'choppy' | 'volatile' | 'news-driven';
  startDate: string;
  endDate: string;
  duration: string;
  strategyPerformance: { name: string; winRate: number }[];
}

const mockCurrentRegime: RegimeData = {
  type: 'trending',
  confidence: 0.89,
  startDate: '2024-04-15',
  currentDuration: '4 days',
};

const mockHistoricalRegimes: HistoricalRegime[] = [
  {
    id: 'regime-1',
    type: 'trending',
    startDate: '2024-04-15',
    endDate: 'present',
    duration: '4 days',
    strategyPerformance: [
      { name: 'Breakout Strategy', winRate: 0.72 },
      { name: 'Mean Reversion', winRate: 0.38 },
      { name: 'Order Flow', winRate: 0.68 },
    ],
  },
  {
    id: 'regime-2',
    type: 'choppy',
    startDate: '2024-04-10',
    endDate: '2024-04-14',
    duration: '4 days',
    strategyPerformance: [
      { name: 'Mean Reversion', winRate: 0.62 },
      { name: 'Breakout Strategy', winRate: 0.35 },
      { name: 'Range Trading', winRate: 0.71 },
    ],
  },
  {
    id: 'regime-3',
    type: 'volatile',
    startDate: '2024-04-05',
    endDate: '2024-04-09',
    duration: '4 days',
    strategyPerformance: [
      { name: 'Volatility Trading', winRate: 0.58 },
      { name: 'Breakout Strategy', winRate: 0.52 },
      { name: 'Range Trading', winRate: 0.42 },
    ],
  },
  {
    id: 'regime-4',
    type: 'trending',
    startDate: '2024-03-25',
    endDate: '2024-04-04',
    duration: '10 days',
    strategyPerformance: [
      { name: 'Breakout Strategy', winRate: 0.78 },
      { name: 'Order Flow', winRate: 0.72 },
      { name: 'Momentum', winRate: 0.65 },
    ],
  },
  {
    id: 'regime-5',
    type: 'news-driven',
    startDate: '2024-03-20',
    endDate: '2024-03-24',
    duration: '4 days',
    strategyPerformance: [
      { name: 'Event Trading', winRate: 0.54 },
      { name: 'Breakout Strategy', winRate: 0.45 },
      { name: 'Range Trading', winRate: 0.38 },
    ],
  },
];

export default function RegimesPage() {
  const [currentRegime, setCurrentRegime] = useState<RegimeData | null>(null);
  const [regimeHistory, setRegimeHistory] = useState<HistoricalRegime[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.market.getRegime();
        setCurrentRegime(res?.current || mockCurrentRegime);
        setRegimeHistory(res?.history || mockHistoricalRegimes);
      } catch {
        setCurrentRegime(mockCurrentRegime);
        setRegimeHistory(mockHistoricalRegimes);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-32 bg-white/5 rounded mb-4" />
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  const getRegimeColor = (type: string) => {
    switch (type) {
      case 'trending':
        return 'from-green-950/30 to-emerald-950/30 border-green-800/30';
      case 'choppy':
        return 'from-blue-950/30 to-cyan-950/30 border-blue-800/30';
      case 'volatile':
        return 'from-red-950/30 to-orange-950/30 border-red-800/30';
      case 'news-driven':
        return 'from-purple-950/30 to-pink-950/30 border-purple-800/30';
      default:
        return 'from-gray-950/30 to-gray-950/30 border-gray-800/30';
    }
  };

  const getRegimeIcon = (type: string) => {
    switch (type) {
      case 'trending':
        return <TrendingUp className="w-5 h-5" />;
      case 'choppy':
        return <AlertCircle className="w-5 h-5" />;
      case 'volatile':
        return <Zap className="w-5 h-5" />;
      case 'news-driven':
        return <AlertCircle className="w-5 h-5" />;
      default:
        return null;
    }
  };

  const getRegimeTextColor = (type: string) => {
    switch (type) {
      case 'trending':
        return 'text-green-400';
      case 'choppy':
        return 'text-blue-400';
      case 'volatile':
        return 'text-red-400';
      case 'news-driven':
        return 'text-purple-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Market Regime Analysis</h1>
        <p className="text-gray-400">Current regime and historical performance analysis</p>
      </div>

      {/* Current Regime */}
      {currentRegime && (
        <div className={`bg-gradient-to-br ${getRegimeColor(currentRegime.type)} border rounded-lg p-6`}>
          <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
            <span className={getRegimeTextColor(currentRegime.type)}>
              {getRegimeIcon(currentRegime.type)}
            </span>
            Current Regime
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-gray-400 text-sm mb-2">Regime Type</p>
              <p className={`text-2xl font-bold capitalize ${getRegimeTextColor(currentRegime.type)}`}>
                {currentRegime.type}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm mb-2">Confidence</p>
              <p className="text-2xl font-bold text-white">{(currentRegime.confidence * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm mb-2">Duration</p>
              <p className="text-2xl font-bold text-white">{currentRegime.currentDuration}</p>
            </div>
          </div>
        </div>
      )}

      {/* Historical Regimes Timeline */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Historical Regimes</h2>
        {regimeHistory && regimeHistory.length > 0 ? (
          <div className="space-y-3">
            {regimeHistory.map((regime) => (
              <div
                key={regime.id}
                className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className={`${getRegimeTextColor(regime.type)}`}>
                      {getRegimeIcon(regime.type)}
                    </span>
                    <div>
                      <p className="text-white font-semibold capitalize">{regime.type}</p>
                      <p className="text-gray-400 text-sm">
                        {regime.startDate} to {regime.endDate === 'present' ? 'present' : regime.endDate} • {regime.duration}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-gray-400 text-sm font-medium">Strategy Performance</p>
                  {regime.strategyPerformance.map((strategy) => (
                    <div key={strategy.name} className="flex items-center justify-between">
                      <span className="text-gray-300 text-sm">{strategy.name}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              strategy.winRate >= 0.65
                                ? 'bg-green-500'
                                : strategy.winRate >= 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${strategy.winRate * 100}%` }}
                          />
                        </div>
                        <span className="text-white font-medium text-sm w-10 text-right">
                          {(strategy.winRate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-900/50 border border-gray-800 rounded-lg">
            <AlertCircle className="w-8 h-8 mx-auto text-gray-500 mb-4" />
            <p className="text-gray-400">No historical regime data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
