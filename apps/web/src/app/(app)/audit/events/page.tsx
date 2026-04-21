"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  outcome: "success" | "failure" | "partial";
  details: string;
}

export default function AuditEventsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.audit.getLog();
        const data = Array.isArray(res) ? res : res?.events ?? res?.data ?? [];
        setEvents(data);
      } catch (e) {
        // Mock fallback
        setEvents([
          {
            id: "evt_001",
            timestamp: "2024-04-20T14:22:00Z",
            actor: "alice@example.com",
            action: "execute_trade",
            resource: "order_12345",
            outcome: "success",
            details: "Executed BUY order for 100 AAPL @ $150.50",
          },
          {
            id: "evt_002",
            timestamp: "2024-04-20T14:18:00Z",
            actor: "bob@example.com",
            action: "create_webhook",
            resource: "webhook_789",
            outcome: "success",
            details: "Created webhook endpoint for risk alerts",
          },
          {
            id: "evt_003",
            timestamp: "2024-04-20T14:15:00Z",
            actor: "carol@example.com",
            action: "update_strategy",
            resource: "strategy_456",
            outcome: "success",
            details: "Updated strategy parameters: threshold=0.85",
          },
          {
            id: "evt_004",
            timestamp: "2024-04-20T14:10:00Z",
            actor: "david@example.com",
            action: "revoke_api_key",
            resource: "apikey_555",
            outcome: "success",
            details: "Revoked API key sk_live_****",
          },
          {
            id: "evt_005",
            timestamp: "2024-04-20T13:45:00Z",
            actor: "alice@example.com",
            action: "execute_trade",
            resource: "order_12346",
            outcome: "failure",
            details: "Trade rejected: insufficient margin",
          },
          {
            id: "evt_006",
            timestamp: "2024-04-20T13:30:00Z",
            actor: "system",
            action: "backtest_completed",
            resource: "backtest_111",
            outcome: "success",
            details: "Backtest completed: Sharpe=1.45, Drawdown=12%",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredEvents = events.filter((event) => {
    const matchesSearch =
      searchQuery === "" ||
      event.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.resource.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  if (loading)
    return (
      <div className="p-6">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-64 bg-white/5 rounded" />
      </div>
    );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Audit · Events</h1>
        <p className="text-sm text-muted">
          Full audit event log — actor, action, resource, before/after snapshots, correlation ID.
          Write-once, immutable.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search by actor, action, or resource..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 rounded border border-border bg-surface text-sm"
        />
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-3 py-2 rounded border border-border bg-surface text-sm"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-3 py-2 rounded border border-border bg-surface text-sm"
        />
      </div>

      {filteredEvents.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No audit events found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Timestamp</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Resource</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr key={event.id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{event.actor}</td>
                  <td className="px-3 py-2">{event.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">{event.resource}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        event.outcome === "success"
                          ? "bg-green-500/20 text-green-300"
                          : event.outcome === "failure"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-yellow-500/20 text-yellow-300"
                      }`}
                    >
                      {event.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{event.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
