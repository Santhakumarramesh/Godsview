'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Copy, AlertCircle } from 'lucide-react';
import { api } from "@/lib/api";

interface PineScript {
  id: string;
  name: string;
  version: string;
  code: string;
  active: boolean;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

export default function PineScriptsPage() {
  const [scripts, setScripts] = useState<PineScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newScript, setNewScript] = useState({ name: '', code: '', version: '1.0' });
  const [creating, setCreating] = useState(false);

  const fetchScripts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/tv/pine-scripts');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setScripts(data.scripts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  const handleCreateScript = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScript.name || !newScript.code) {
      setError('Name and code required');
      return;
    }

    try {
      setCreating(true);
      const res = await fetch('/api/tv/pine-scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newScript.name,
          code: newScript.code,
          version: newScript.version,
        }),
      });
      if (!res.ok) throw new Error('Failed to create script');
      setNewScript({ name: '', code: '', version: '1.0' });
      setShowCreateForm(false);
      await fetchScripts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setCreating(false);
    }
  };

  const filteredScripts = scripts.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.id.toLowerCase().includes(search.toLowerCase())
  );

  const truncateCode = (code: string, maxLen: number = 100) => {
    return code.length > maxLen ? code.substring(0, maxLen) + '...' : code;
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Pine Script Registry</h1>
            <p className="mt-2 text-gray-400">Manage and deploy TradingView signal scripts</p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
          >
            <Plus size={18} />
            New Script
          </button>
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateScript}
            style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
            className="mb-6 rounded-lg border p-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="text"
                placeholder="Script name"
                value={newScript.name}
                onChange={(e) => setNewScript({ ...newScript, name: e.target.value })}
                style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
                className="rounded border px-3 py-2 text-white placeholder-gray-500"
              />
              <input
                type="text"
                placeholder="Version (e.g., 1.0)"
                value={newScript.version}
                onChange={(e) => setNewScript({ ...newScript, version: e.target.value })}
                style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
                className="rounded border px-3 py-2 text-white placeholder-gray-500"
              />
            </div>
            <textarea
              placeholder="Pine Script code"
              value={newScript.code}
              onChange={(e) => setNewScript({ ...newScript, code: e.target.value })}
              style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
              className="mt-4 h-24 w-full rounded border px-3 py-2 text-white placeholder-gray-500"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : filteredScripts.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No scripts found</p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="mb-6 flex items-center gap-2">
              <Search size={18} className="text-gray-400" />
              <input
                type="text"
                placeholder="Search scripts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
                className="w-full rounded border px-4 py-2 text-white placeholder-gray-500"
              />
            </div>

            {/* Scripts Table */}
            <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead style={{ backgroundColor: DARK_BG, borderBottomColor: DARK_BORDER }} className="border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Version</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Code Preview</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Status</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScripts.map((script, idx) => (
                    <tr key={script.id} style={{ backgroundColor: idx % 2 === 0 ? DARK_CARD : '#0f0f14' }}>
                      <td className="px-6 py-4 text-white">{script.name}</td>
                      <td className="px-6 py-4 text-gray-400">{script.version}</td>
                      <td className="px-6 py-4">
                        <code className="text-xs text-blue-400">{truncateCode(script.code, 60)}</code>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            script.active
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {script.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => navigator.clipboard.writeText(script.code)}
                          className="text-blue-400 hover:text-blue-300"
                          title="Copy code"
                        >
                          <Copy size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400">Total Scripts</p>
                <p className="text-2xl font-bold text-white">{scripts.length}</p>
              </div>
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400">Active</p>
                <p className="text-2xl font-bold text-emerald-400">{scripts.filter((s) => s.active).length}</p>
              </div>
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400">Inactive</p>
                <p className="text-2xl font-bold text-gray-400">{scripts.filter((s) => !s.active).length}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
