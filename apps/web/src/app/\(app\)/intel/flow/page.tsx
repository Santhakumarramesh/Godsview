'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

interface FlowMetrics {
  delta: number;
  imbalanceRatio: number;
  absorptionScore: number;
  aggression: number;
}

interface FlowData {
  symbol: string;
  bidPressure: number;
  askPressure: number;
  netDelta: number;
  signal: string;
}

const mockFlowAnalysis: FlowData[] = [
  {
    symbol: 'ES',
    bidPressure: 0.62,
    askPressure: 0.38,
    netDelta: 1240,
    signal: 'bullish',
  },
  {
    symbol: 'NQ',
    bidPressure: 0.55,
    askPressure: 0.45,
    netDelta: 856,
    signal: 'neutral',
  },
  {
    symbol: 'GC',
    bidPressure: 0.48,
    askPressure: 0.52,
    netDelta: -342,
    signal: 'bearish',
  },
  {
    symbol: 'CL',
    bidPressure: 0.59,
    askPressure: 0.41,
    netDelta: 634,
    signal: 'bullish',
  },
  {
    symbol: 'ZB',
    bidPressure: 0.51,
    askPressure: 0.49,
    netDelta: 78,
    signal: 'neutral',
  },
];

const mockMetrics: FlowMetrics = {
  delta: 2466,
  imbalanceRatio: 1.42,
  absorptionScore: 0.78,
  aggression: 0.64,
};

export default function FlowPage() {
  const [data, setData] = useState<FlowData[] | null>(null);
  const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.flow.getAnalysis();
        setData(res?.data || mockFlowAnalysis);
        setMetrics(res?.metrics || mockMetrics);
      } catch {
        setData(mockFlowAnalysis);
        setMetrics(mockMetrics);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse h-24 bg-white/5 rounded" />
          ))}
        </div>
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'bullish':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'bearish':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case 'bullish':
        return <TrendingUp className="w-4 h-4" />;
      case 'bearish':
        return <TrendingDown className="w-4 h-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Order Flow Intelligence</h1>
        <p className="text-gray-400">Market microstructure and order flow analysis</p>
      </div>

      {/* Key Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Net Delta</p>
            <p className="text-2xl font-bold text-white">{metrics.delta.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-2">Contracts</p>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Imbalance Ratio</p>
            <p className="text-2xl font-bold text-white">{metrics.imbalanceRatio.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-2">Bid:Ask</p>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Absorption Score</p>
            <p className="text-2xl font-bold text-cyan-400">{(metrics.absorptionScore * 100).toFixed(0)}%</p>
            <p className="text-xs text-gray-500 mt-2">Seller exhaustion</p>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Aggression</p>
            <p className="text-2xl font-bold text-white">{(metrics.aggression * 100).toFixed(0)}%</p>
            <p className="text-xs text-gray-500 mt-2">Buy side pressure</p>
          </div>
        </div>
      )}

      {/* Flow Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/30">
                <th className="px-6 py-3 text-left text-white font-semibold">Symbol</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Bid Pressure</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Ask Pressure</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Net Delta</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Signal</th>
              </tr>
            </thead>
            <tbody>
              {data && data.length > 0 ? (
                data.map((row) => (
                  <tr key={row.symbol} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 font-semibold text-white">{row.symbol}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500"
                            style={{ width: `${row.bidPressure * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-white">{(row.bidPressure * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500"
                            style={{ width: `${row.askPressure * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-white">{(row.askPressure * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={row.netDelta > 0 ? 'text-green-400' : 'text-red-400'}>
                        {row.netDelta > 0 ? '+' : ''}{row.netDelta.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium w-fit ${getSignalColor(row.signal)}`}>
                        {getSignalIcon(row.signal)}
                        <span className="capitalize">{row.signal}</span>
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No flow data available
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
