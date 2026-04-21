"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface PendingApproval {
  id: string;
  type: "trade" | "strategy_promotion" | "threshold_change";
  title: string;
  details: string;
  requestor: string;
  riskScore: number;
  createdAt: string;
}

export default function GovernanceApprovalsPage() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.execution.getPendingApprovals();
        const data = Array.isArray(res)
          ? res
          : res?.approvals ?? res?.pending ?? res?.data ?? [];
        setApprovals(data);
      } catch (e) {
        // Mock fallback
        setApprovals([
          {
            id: "approval_001",
            type: "trade",
            title: "Execute Large Trade",
            details: "BUY 5000 AAPL @ market (Estimated size: $750K)",
            requestor: "alice@example.com",
            riskScore: 8.2,
            createdAt: "2024-04-20T13:45:00Z",
          },
          {
            id: "approval_002",
            type: "strategy_promotion",
            title: "Promote MomentumTrader v2 to Live",
            details: "Sharpe: 2.15, Drawdown: 8%, Win Rate: 62%",
            requestor: "carol@example.com",
            riskScore: 4.5,
            createdAt: "2024-04-20T12:30:00Z",
          },
          {
            id: "approval_003",
            type: "threshold_change",
            title: "Increase Risk Limit to $50K",
            details: "Current: $35K, Requested: $50K (42% increase)",
            requestor: "bob@example.com",
            riskScore: 6.8,
            createdAt: "2024-04-20T11:15:00Z",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleApprove = async (approvalId: string) => {
    setProcessing(approvalId);
    try {
      await api.execution.approveRequest(approvalId);
      setApprovals(approvals.filter((a) => a.id !== approvalId));
    } catch (e) {
      setError(`Failed to approve request`);
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    setProcessing(approvalId);
    try {
      await api.execution.rejectRequest(approvalId);
      setApprovals(approvals.filter((a) => a.id !== approvalId));
    } catch (e) {
      setError(`Failed to reject request`);
    } finally {
      setProcessing(null);
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
        <h1 className="text-2xl font-semibold">Governance · Approvals</h1>
        <p className="text-sm text-muted">
          Pending approval queue — strategy promotions, threshold changes, kill-switch bypass
          requests. Dual-control gating for high-risk actions.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {approvals.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No pending approvals.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {approvals.map((approval) => (
            <div
              key={approval.id}
              className="p-4 border border-border rounded-lg bg-surface/40 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{approval.title}</h3>
                  <p className="text-xs text-muted mt-1">
                    Requested by {approval.requestor}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded font-medium ${
                    approval.type === "trade"
                      ? "bg-red-500/20 text-red-300"
                      : approval.type === "strategy_promotion"
                        ? "bg-blue-500/20 text-blue-300"
                        : "bg-yellow-500/20 text-yellow-300"
                  }`}
                >
                  {approval.type.replace("_", " ")}
                </span>
              </div>

              <p className="text-sm text-muted">{approval.details}</p>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Risk Score:</span>
                <div className="flex-1 h-2 bg-surface/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      approval.riskScore > 7
                        ? "bg-red-500"
                        : approval.riskScore > 4
                          ? "bg-yellow-500"
                          : "bg-green-500"
                    }`}
                    style={{ width: `${approval.riskScore * 10}%` }}
                  />
                </div>
                <span className="text-xs font-mono">{approval.riskScore.toFixed(1)}</span>
              </div>

              <div className="text-xs text-muted">
                {new Date(approval.createdAt).toLocaleString()}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleApprove(approval.id)}
                  disabled={processing === approval.id}
                  className="flex-1 px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReject(approval.id)}
                  disabled={processing === approval.id}
                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
