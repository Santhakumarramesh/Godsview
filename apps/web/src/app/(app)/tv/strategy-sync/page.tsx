'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';

interface StrategySync {
  id: string;
  strategy: string;
  tv_strategy: string;
  status: string;
  last_sync: string;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

export default function StrategySyncPage() {
  const [syncs, setSyncs] = useState<StrategySync[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const fetchSyncs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/tv/strategy-sync');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setSyncs(data.syncs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncs();
  }, [fetchSyncs]);

  const handleSync = async (id: string) => {
    try {
      setSyncing(id);
      const res = await fetch('/api/tv/strategy-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Sync failed');
      await fetchSyncs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync error');
    } finally {
      setSyncing(null);
    }
  };

  const getStatusBadge = (status: string) => {
    if (status.includes('synced') || status.includes('ok')) {
      return { color: 'bg-emerald-500/20 text-emerald-400', icon: CheckCircle };
    }
    if (status.includes('error') || status.includes('failed')) {
      return { color: 'bg-red-500/20 text-red-400', icon: AlertCircle };
    }
    return { color: 'bg-blue-500/20 text-blue-400', icon: RefreshCw };
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Strategy Sync Manager</h1>
            <p className="mt-2 text-gray-400">Synchronize strategies between GodsView and TradingView</p>
          </div>
          <button
            onClick={fetchSyncs}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : syncs.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No strategies synced yet</p>
          </div>
        ) : (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead style={{ backgroundColor: DARK_BG, borderBottomColor: DARK_BORDER }} className="border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Strategy</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">TV Strategy</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Last Sync</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Action</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map((sync, idx) => {
                  const statusBadge = getStatusBadge(sync.status);
                  return (
                    <tr
                      key={sync.id}
                      style={{ backgroundColor: idx % 2 === 0 ? DARK_CARD : '#0f0f14' }}
                      className="border-t border-[#1e1e2e] hover:bg-[#1a1a2e]"
                    >
                      <td className="px-6 py-4 text-white font-medium">{sync.strategy}</td>
                      <td className="px-6 py-4 text-gray-400 text-sm">{sync.tv_strategy}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge.color}`}>
                          {sync.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-sm">
                        {new Date(sync.last_sync).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleSync(sync.id)}
                          disabled={syncing === sync.id}
                          className="flex items-center gap-2 rounded px-3 py-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm"
                        >
                          <RefreshCw size={14} className={syncing === sync.id ? 'animate-spin' : ''} />
                          Sync Now
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Health Stats */}
        {!loading && syncs.length > 0 && (
          <div className="mt-8 grid grid-cols-3 gap-4">
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Total Strategies</p>
              <p className="text-2xl font-bold text-white">{syncs.length}</p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Synced</p>
              <p className="text-2xl font-bold text-emerald-400">
                {syncs.filter((s) => s.status.includes('synced') || s.status.includes('ok')).length}
              </p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Errors</p>
              <p className="text-2xl font-bold text-red-400">
                {syncs.filter((s) => s.status.includes('error') || s.status.includes('failed')).length}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
