'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Save, AlertCircle } from 'lucide-react';
import { api } from "@/lib/api";

interface ReplaySession {
  id: string;
  name: string;
  created_at: string;
  outcomes: number;
  status: string;
}

interface ReplayEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

export default function ReplayPage() {
  const [sessions, setSessions] = useState<ReplaySession[]>([]);
  const [recentEvents, setRecentEvents] = useState<ReplayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/tv/webhooks/events?limit=100');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setRecentEvents(data.events || []);
      // Mock sessions - in real implementation would fetch from /api/tv/replay/sessions
      setSessions(
        [
          {
            id: 'sess_001',
            name: 'Morning Break Trade',
            created_at: new Date(Date.now() - 3600000).toISOString(),
            outcomes: 5,
            status: 'replayed',
          },
          {
            id: 'sess_002',
            name: 'FOMC Event Response',
            created_at: new Date(Date.now() - 86400000).toISOString(),
            outcomes: 8,
            status: 'saved',
          },
        ].filter(() => true) // Keep existing mock
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveReplay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionName) {
      setError('Session name required');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch('/api/tv/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'replay_save',
          symbol: 'SYSTEM',
          params: { name: sessionName, events: recentEvents.length },
        }),
      });
      if (!res.ok) throw new Error('Failed to save session');
      setSessionName('');
      setShowSaveForm(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">TV Replay Connector</h1>
            <p className="mt-2 text-gray-400">Save and replay chart events with historical outcomes</p>
          </div>
          <button
            onClick={() => setShowSaveForm(!showSaveForm)}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
          >
            <Save size={18} />
            Save Session
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500 bg-red-500/10 p-4 text-red-400">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Save Form */}
        {showSaveForm && (
          <form
            onSubmit={handleSaveReplay}
            style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
            className="mb-6 rounded-lg border p-4"
          >
            <input
              type="text"
              placeholder="Session name (e.g., Morning Setup Test)"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              style={{ backgroundColor: DARK_BG, borderColor: DARK_BORDER }}
              className="w-full rounded border px-3 py-2 text-white placeholder-gray-500"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveForm(false)}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Sessions */}
            <div>
              <h2 className="mb-4 text-xl font-bold text-white">Saved Sessions</h2>
              {sessions.length === 0 ? (
                <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
                  <p className="text-gray-400">No sessions saved yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
                      className="rounded-lg border p-4 hover:bg-[#1a1a2e]"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-white">{session.name}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(session.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-purple-400">{session.outcomes}</p>
                          <p className="text-xs text-gray-400">outcomes</p>
                        </div>
                      </div>
                      <span className="mt-2 inline-block rounded-full bg-purple-500/20 px-2 py-1 text-xs text-purple-400">
                        {session.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Events */}
            <div>
              <h2 className="mb-4 text-xl font-bold text-white">Recent Events ({recentEvents.length})</h2>
              {recentEvents.length === 0 ? (
                <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
                  <p className="text-gray-400">No recent events</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {recentEvents.slice(0, 10).map((event) => (
                    <div
                      key={event.id}
                      style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono text-blue-400">{event.type}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
