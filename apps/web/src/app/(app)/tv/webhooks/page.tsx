'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, AlertCircle } from 'lucide-react';

interface WebhookEvent {
  id: string;
  source: string;
  symbol: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

const DARK_BG = '#0a0a0f';
const DARK_CARD = '#12121a';
const DARK_BORDER = '#1e1e2e';

export default function WebhooksPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSymbol, setFilterSymbol] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/tv/webhooks/events?limit=100');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const filteredEvents = filterSymbol
    ? events.filter((e) => e.symbol.toUpperCase().includes(filterSymbol.toUpperCase()))
    : events;

  const getStatusColor = (action: string) => {
    if (action.includes('error') || action.includes('fail')) return 'text-red-400';
    if (action.includes('success') || action.includes('complete')) return 'text-emerald-400';
    return 'text-blue-400';
  };

  return (
    <div style={{ backgroundColor: DARK_BG }} className="min-h-screen p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Webhook Event Router</h1>
            <p className="mt-2 text-gray-400">Real-time TradingView webhook events</p>
          </div>
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
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
        {loading && events.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-8 text-center">
            <p className="text-gray-400">No events found</p>
          </div>
        ) : (
          <>
            {/* Filter */}
            <div className="mb-6">
              <input
                type="text"
                placeholder="Filter by symbol..."
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
                className="w-full rounded border px-4 py-2 text-white placeholder-gray-500"
              />
            </div>

            {/* Events List */}
            <div className="space-y-2">
              {filteredEvents.map((event) => (
                <div
                  key={event.id}
                  style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }}
                  className="rounded-lg border"
                >
                  <button
                    onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                    className="w-full px-6 py-4 text-left hover:opacity-80"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <ChevronDown
                          size={18}
                          className={`transition ${expandedId === event.id ? 'rotate-180' : ''}`}
                        />
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-white">{event.symbol}</span>
                            <span className={`text-sm font-medium ${getStatusColor(event.action)}`}>
                              {event.action}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{event.source}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Payload */}
                  {expandedId === event.id && (
                    <div style={{ backgroundColor: DARK_BG, borderTopColor: DARK_BORDER }} className="border-t p-6">
                      <p className="text-xs font-semibold text-gray-400 mb-2">PAYLOAD</p>
                      <pre className="bg-black/50 rounded p-3 text-xs text-emerald-400 overflow-auto max-h-48">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="mt-8 grid grid-cols-3 gap-4">
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400">Total Events</p>
                <p className="text-2xl font-bold text-white">{events.length}</p>
              </div>
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400">Unique Symbols</p>
                <p className="text-2xl font-bold text-blue-400">
                  {new Set(events.map((e) => e.symbol)).size}
                </p>
              </div>
              <div style={{ backgroundColor: DARK_CARD, borderColor: DARK_BORDER }} className="rounded-lg border p-4">
                <p className="text-gray-400">Sources</p>
                <p className="text-2xl font-bold text-purple-400">
                  {new Set(events.map((e) => e.source)).size}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
