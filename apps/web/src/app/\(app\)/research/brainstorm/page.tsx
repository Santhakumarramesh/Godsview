'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, Lightbulb, Send } from 'lucide-react';

interface Experiment {
  id: string;
  hypothesis: string;
  date: string;
  status: 'tested' | 'untested';
  resultSummary: string;
}

const mockExperiments: Experiment[] = [
  {
    id: 'exp-1',
    hypothesis: 'Order flow delta + CHOCH confluence predicts 100+ pips moves',
    date: '2024-04-15',
    status: 'tested',
    resultSummary: '72% win rate on 28 trades, Sharpe 1.4',
  },
  {
    id: 'exp-2',
    hypothesis: 'Multi-timeframe alignment on 15m BOS has lower drawdown',
    date: '2024-04-10',
    status: 'tested',
    resultSummary: '68% win rate, max DD -12%, needs more volume threshold',
  },
  {
    id: 'exp-3',
    hypothesis: 'Sentiment reversal on volume spike entry works post-9:30',
    date: '2024-04-05',
    status: 'untested',
    resultSummary: 'Backtested 45% win rate - too weak for live trading',
  },
  {
    id: 'exp-4',
    hypothesis: 'Order block retest + RSI divergence on 1H timeframe',
    date: '2024-03-28',
    status: 'tested',
    resultSummary: '81% win rate on trending markets, 42% in ranges',
  },
  {
    id: 'exp-5',
    hypothesis: 'Volume profile POC rejection = reversal setup',
    date: '2024-03-20',
    status: 'untested',
    resultSummary: 'Pending evaluation on current regime',
  },
];

export default function BrainstormPage() {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hypothesis, setHypothesis] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.backtest.listExperiments();
        setExperiments(res);
      } catch {
        setExperiments(mockExperiments);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = async () => {
    if (!hypothesis.trim()) return;
    setSubmitting(true);
    try {
      const newExp: Experiment = {
        id: `exp-${Date.now()}`,
        hypothesis: hypothesis,
        date: new Date().toISOString().split('T')[0],
        status: 'untested',
        resultSummary: 'Pending backtest evaluation',
      };
      setExperiments((prev) => (prev ? [newExp, ...prev] : [newExp]));
      setHypothesis('');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-32 bg-white/5 rounded mb-4" />
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    return status === 'tested'
      ? 'bg-green-500/20 text-green-300 border border-green-500/30'
      : 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Strategy Brainstorm</h1>
        <p className="text-gray-400">Hypothesis testing and strategy discovery workspace</p>
      </div>

      {/* Input Area */}
      <div className="bg-blue-950/30 border border-blue-800/30 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-400" />
          New Hypothesis
        </h2>
        <div className="flex gap-2">
          <textarea
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            placeholder="Describe your trading hypothesis... e.g., 'Volume surge at resistance + order flow reversal predicts 50+ pips move'"
            className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 h-24"
          />
          <button
            onClick={handleSubmit}
            disabled={!hypothesis.trim() || submitting}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg flex items-center gap-2 transition-colors h-fit"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Submit</span>
          </button>
        </div>
      </div>

      {/* Experiments Grid */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-white">Past Brainstorms</h2>
        {experiments && experiments.length > 0 ? (
          <div className="space-y-3">
            {experiments.map((exp) => (
              <div
                key={exp.id}
                className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <p className="text-white font-semibold mb-2">{exp.hypothesis}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ml-4 ${getStatusColor(exp.status)}`}>
                    {exp.status === 'tested' ? 'Tested' : 'Untested'}
                  </span>
                </div>
                <p className="text-gray-400 text-sm mb-2">{exp.resultSummary}</p>
                <p className="text-gray-500 text-xs">{exp.date}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-900/50 border border-gray-800 rounded-lg">
            <AlertCircle className="w-8 h-8 mx-auto text-gray-500 mb-4" />
            <p className="text-gray-400">No hypotheses yet. Start brainstorming!</p>
          </div>
        )}
      </div>
    </div>
  );
}
