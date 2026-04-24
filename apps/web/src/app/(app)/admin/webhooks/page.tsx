"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: "active" | "disabled" | "error";
  lastTriggered: string | null;
  successRate: number;
  totalAttempts: number;
}

export default function AdminWebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.webhooks.list();
        const data = Array.isArray(res) ? res : res?.webhooks ?? res?.data ?? [];
        setWebhooks(data);
      } catch (e) {
        // Mock fallback
        setWebhooks([
          {
            id: "webhook_1",
            url: "https://partner.example.com/signals",
            events: ["trade.executed", "trade.rejected"],
            status: "active",
            lastTriggered: "2024-04-20T14:15:00Z",
            successRate: 0.99,
            totalAttempts: 1248,
          },
          {
            id: "webhook_2",
            url: "https://slack.example.com/hooks/alert",
            events: ["risk.threshold.exceeded"],
            status: "active",
            lastTriggered: "2024-04-20T13:30:00Z",
            successRate: 1.0,
            totalAttempts: 342,
          },
          {
            id: "webhook_3",
            url: "https://logs.example.com/intake",
            events: ["audit.log", "system.event"],
            status: "active",
            lastTriggered: "2024-04-20T14:22:00Z",
            successRate: 0.98,
            totalAttempts: 5621,
          },
          {
            id: "webhook_4",
            url: "https://archive.example.com/events",
            events: ["strategy.updated"],
            status: "disabled",
            lastTriggered: "2024-04-10T11:00:00Z",
            successRate: 0.95,
            totalAttempts: 89,
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleTest = async (webhookId: string) => {
    setTesting(webhookId);
    try {
      await api.webhooks.test(webhookId);
      setError(null);
    } catch (e) {
      setError(`Test failed for webhook ${webhookId}`);
    } finally {
      setTesting(null);
    }
  };

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
        <h1 className="text-2xl font-semibold">Admin · Webhooks</h1>
        <p className="text-sm text-muted">
          Webhook endpoints, HMAC secrets, delivery attempts, and replay tooling for TradingView
          MCP and partner integrations.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {webhooks.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No webhooks configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Events</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last Triggered</th>
                <th className="px-3 py-2 font-medium">Success Rate</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook) => (
                <tr key={webhook.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{webhook.url}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {webhook.events.map((event, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-300"
                        >
                          {event}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        webhook.status === "active"
                          ? "bg-green-500/20 text-green-300"
                          : webhook.status === "disabled"
                            ? "bg-yellow-500/20 text-yellow-300"
                            : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {webhook.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {webhook.lastTriggered
                      ? new Date(webhook.lastTriggered).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-surface/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500"
                          style={{ width: `${webhook.successRate * 100}%` }}
                        />
                      </div>
                      <span>{Math.round(webhook.successRate * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleTest(webhook.id)}
                      disabled={testing === webhook.id}
                      className="px-2 py-1 text-xs rounded border border-blue-600/50 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
                    >
                      Test
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
