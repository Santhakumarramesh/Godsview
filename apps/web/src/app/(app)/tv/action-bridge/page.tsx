'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { api } from "@/lib/api";

interface Action {
  id: string;
  type: string;
  symbol: string;
  params: Record<string, unknown>;
  status: string;
  created_at: string;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

export default function ActionBridgePage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newAction, setNewAction] = useState({ type: '', symbol: '', params: '{}' });
  const [creating, setCreating] = useState(false);

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/tv/actions?limit=50');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setActions(data.actions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const handleCreateAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAction.type || !newAction.symbol) {
      setError('Type and symbol required');
      return;
    }

    try {
      setCreating(true);
      let params = {};
      try {
        params = JSON.parse(newAction.params);
      } catch {
        params = { raw: newAction.params };
      }

      const res = await fetch('/api/tv/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newAction.type,
          symbol: newAction.symbol,
          params,
        }),
      });
      if (!res.ok) throw new Error('Failed to create action');
      setNewAction({ type: '', symbol: '', params: '{}' });
      setShowForm(false);
      await fetchActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setCreating(false);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === 'completed') return 'bg-emerald-500/20 text-emerald-400';
    if (status === 'failed') return 'bg-red-500/20 text-red-400';
    if (status === 'executing') return 'bg-blue-500/20 text-blue-400';
    return 'bg-yellow-500/20 text-yellow-400';
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Chart Action Bridge</h1>
            <p className="mt-2 text-gray-400">Queue and execute chart actions from TradingView</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            <Plus size={18} />
            New Action
          </button>
        </div>

        {/* Create Form */}
        {showForm && (
          <form
            onSubmit={handleCreateAction}
            style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
            className="mb-6 rounded-lg border p-4"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <input
                type="text"
                placeholder="Action type (e.g., buy, sell, alert)"
                value={newAction.type}
                onChange={(e) => setNewAction({ ...newAction, type: e.target.value })}
                style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
                className="rounded border px-3 py-2 text-white placeholder-gray-500"
              />
              <input
                type="text"
                placeholder="Symbol (e.g., AAPL)"
                value={newAction.symbol}
                onChange={(e) => setNewAction({ ...newAction, symbol: e.target.value.toUpperCase() })}
                style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
                className="rounded border px-3 py-2 text-white placeholder-gray-500"
              />
              <input
                type="text"
                placeholder='JSON params (e.g., {"qty": 100})'
                value={newAction.params}
                onChange={(e) => setNewAction({ ...newAction, params: e.target.value })}
                style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
                className="rounded border px-3 py-2 text-white placeholder-gray-500"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : actions.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No actions queued</p>
          </div>
        ) : (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead style={{ backgroundColor: DARK_BG, borderBottomColor: DARK_BORDER }} className="border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Type</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Symbol</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Params</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Created</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action, idx) => (
                  <tr
                    key={action.id}
                    style={{ backgroundColor: idx % 2 === 0 ? DARK_CARD : '#0f0f14' }}
                    className="border-t border-[#1e1e2e] hover:bg-[#1a1a2e]"
                  >
                    <td className="px-6 py-4 text-white font-medium">{action.type}</td>
                    <td className="px-6 py-4 text-blue-400 font-mono">{action.symbol}</td>
                    <td className="px-6 py-4 text-xs text-gray-400">
                      <code>{JSON.stringify(action.params).substring(0, 50)}...</code>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(action.status)}`}>
                        {action.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {new Date(action.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Stats */}
        {!loading && actions.length > 0 && (
          <div className="mt-8 grid grid-cols-4 gap-4">
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Total</p>
              <p className="text-2xl font-bold text-white">{actions.length}</p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Pending</p>
              <p className="text-2xl font-bold text-yellow-400">
                {actions.filter((a) => a.status === 'pending').length}
              </p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Completed</p>
              <p className="text-2xl font-bold text-emerald-400">
                {actions.filter((a) => a.status === 'completed').length}
              </p>
            </div>
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
              <p className="text-gray-400">Failed</p>
              <p className="text-2xl font-bold text-red-400">
                {actions.filter((a) => a.status === 'failed').length}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
