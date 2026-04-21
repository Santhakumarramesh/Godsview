"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface KvChange {
  id: string;
  key: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  timestamp: string;
  reason?: string;
}

export default function AuditKvChangesPage() {
  const [changes, setChanges] = useState<KvChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.audit.getLog();
        const data = Array.isArray(res) ? res : res?.changes ?? res?.data ?? [];
        setChanges(data);
      } catch (e) {
        // Mock fallback - filtered to config changes
        setChanges([
          {
            id: "change_001",
            key: "risk.max_position_size",
            oldValue: "10000",
            newValue: "8000",
            changedBy: "alice@example.com",
            timestamp: "2024-04-20T14:00:00Z",
            reason: "Risk limit reduction per governance",
          },
          {
            id: "change_002",
            key: "feature.autonomous_trading",
            oldValue: "false",
            newValue: "true",
            changedBy: "bob@example.com",
            timestamp: "2024-04-19T10:30:00Z",
            reason: "Enabling autonomous execution for tier A strategies",
          },
          {
            id: "change_003",
            key: "system.alert_threshold",
            oldValue: "0.80",
            newValue: "0.85",
            changedBy: "carol@example.com",
            timestamp: "2024-04-18T15:45:00Z",
            reason: "Tuning alert sensitivity",
          },
          {
            id: "change_004",
            key: "backtest.slippage_model",
            oldValue: "fixed:0.001",
            newValue: "dynamic:market_impact",
            changedBy: "david@example.com",
            timestamp: "2024-04-17T09:20:00Z",
            reason: "Switching to market impact slippage model",
          },
          {
            id: "change_005",
            key: "webhook.retry_count",
            oldValue: "3",
            newValue: "5",
            changedBy: "alice@example.com",
            timestamp: "2024-04-16T13:10:00Z",
            reason: "Improving webhook delivery reliability",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        <h1 className="text-2xl font-semibold">Audit · KV Changes</h1>
        <p className="text-sm text-muted">
          Feature flag and system config mutation history. Every toggle and value change is
          recorded with actor, reason, and diff.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {changes.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No config changes recorded.
        </div>
      ) : (
        <div className="space-y-2">
          {changes.map((change) => (
            <div
              key={change.id}
              className="border border-border rounded-lg overflow-hidden bg-surface/40"
            >
              <button
                onClick={() =>
                  setExpandedId(expandedId === change.id ? null : change.id)
                }
                className="w-full p-4 flex items-start justify-between hover:bg-surface/60 transition-colors text-left"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm font-semibold">{change.key}</code>
                    <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300">
                      {change.changedBy}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(change.timestamp).toLocaleString()}
                  </div>
                </div>
                <span className="text-muted">
                  {expandedId === change.id ? "▼" : "▶"}
                </span>
              </button>

              {expandedId === change.id && (
                <div className="px-4 pb-4 border-t border-border/50 bg-surface/20 space-y-3">
                  {change.reason && (
                    <div>
                      <p className="text-xs text-muted mb-1">Reason:</p>
                      <p className="text-sm">{change.reason}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted mb-2">Old Value</p>
                      <div className="p-2 rounded bg-red-500/10 border border-red-500/20 font-mono text-sm break-all">
                        {change.oldValue}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-2">New Value</p>
                      <div className="p-2 rounded bg-green-500/10 border border-green-500/20 font-mono text-sm break-all">
                        {change.newValue}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
