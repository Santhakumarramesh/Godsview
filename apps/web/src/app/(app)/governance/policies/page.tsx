"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Policy {
  id: string;
  name: string;
  type: "risk" | "approval" | "execution" | "monitoring";
  status: "active" | "draft" | "archived";
  description: string;
  lastUpdated: string;
  updatedBy: string;
}

export default function GovernancePoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.risk.getPolicies();
        const data = Array.isArray(res) ? res : res?.policies ?? res?.data ?? [];
        setPolicies(data);
      } catch (e) {
        // Mock fallback
        setPolicies([
          {
            id: "policy_001",
            name: "Daily Loss Limit",
            type: "risk",
            status: "active",
            description:
              "Maximum daily loss threshold of $50K per strategy. Auto-halt trading if breached.",
            lastUpdated: "2024-04-10T14:30:00Z",
            updatedBy: "alice@example.com",
          },
          {
            id: "policy_002",
            name: "Large Trade Approval",
            type: "approval",
            status: "active",
            description:
              "Trades exceeding $100K notional require dual approval from operator and risk team.",
            lastUpdated: "2024-04-08T10:15:00Z",
            updatedBy: "bob@example.com",
          },
          {
            id: "policy_003",
            name: "Tier A Promotion Requirements",
            type: "execution",
            status: "active",
            description:
              "Strategy must have Sharpe > 2.0, max drawdown < 10%, win rate > 60% for 90 days.",
            lastUpdated: "2024-03-20T09:45:00Z",
            updatedBy: "carol@example.com",
          },
          {
            id: "policy_004",
            name: "Anomaly Detection Thresholds",
            type: "monitoring",
            status: "active",
            description:
              "Alert on return distribution shift > 3 sigma or strategy correlation change > 50%.",
            lastUpdated: "2024-04-15T16:20:00Z",
            updatedBy: "david@example.com",
          },
          {
            id: "policy_005",
            name: "Leverage Limits",
            type: "risk",
            status: "draft",
            description: "Maximum leverage of 2x for Tier B strategies, 1x for Tier C.",
            lastUpdated: "2024-04-18T13:00:00Z",
            updatedBy: "alice@example.com",
          },
          {
            id: "policy_006",
            name: "Legacy Risk Model",
            type: "risk",
            status: "archived",
            description: "Historical VaR-based risk framework (superseded by new model).",
            lastUpdated: "2024-01-01T00:00:00Z",
            updatedBy: "system",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const typeColors = {
    risk: "bg-red-500/20 text-red-300",
    approval: "bg-yellow-500/20 text-yellow-300",
    execution: "bg-blue-500/20 text-blue-300",
    monitoring: "bg-green-500/20 text-green-300",
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
        <h1 className="text-2xl font-semibold">Governance · Policies</h1>
        <p className="text-sm text-muted">
          Policy authoring — approval workflows, anomaly thresholds, dual-control rules. All edits
          audit-logged with diffs.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          Create New Policy
        </button>
      </div>

      {policies.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No policies configured.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map((policy) => (
            <button
              key={policy.id}
              onClick={() =>
                setSelectedPolicy(selectedPolicy === policy.id ? null : policy.id)
              }
              className="p-4 border border-border rounded-lg bg-surface/40 text-left hover:bg-surface/60 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold">{policy.name}</h3>
                <span
                  className={`text-xs px-2 py-1 rounded font-medium ${
                    typeColors[policy.type as keyof typeof typeColors]
                  }`}
                >
                  {policy.type}
                </span>
              </div>

              <div className="mb-2">
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    policy.status === "active"
                      ? "bg-green-500/20 text-green-300"
                      : policy.status === "draft"
                        ? "bg-yellow-500/20 text-yellow-300"
                        : "bg-gray-500/20 text-gray-300"
                  }`}
                >
                  {policy.status}
                </span>
              </div>

              <p className="text-sm text-muted mb-3">{policy.description}</p>

              <div className="text-xs text-muted">
                <div>Updated by {policy.updatedBy}</div>
                <div>{new Date(policy.lastUpdated).toLocaleDateString()}</div>
              </div>

              {selectedPolicy === policy.id && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                  <button className="w-full px-3 py-2 bg-blue-600/20 text-blue-300 rounded text-sm hover:bg-blue-600/30">
                    Edit Policy
                  </button>
                  <button className="w-full px-3 py-2 bg-yellow-600/20 text-yellow-300 rounded text-sm hover:bg-yellow-600/30">
                    View History
                  </button>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
