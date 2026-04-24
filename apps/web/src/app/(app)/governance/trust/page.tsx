"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface TierSpecs {
  tier: string;
  allowedActions: string[];
  maxPositionSize: string;
  maxLeverage: string;
  approvalRequired: boolean;
  approverCount: number;
}

interface StrategyAssignment {
  id: string;
  strategyName: string;
  currentTier: string;
  assignedAt: string;
  metrics: {
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
  };
}

export default function GovernanceTrustPage() {
  const [strategies, setStrategies] = useState<StrategyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tierSpecs: TierSpecs[] = [
    {
      tier: "Manual",
      allowedActions: ["view", "simulate"],
      maxPositionSize: "N/A",
      maxLeverage: "0x",
      approvalRequired: false,
      approverCount: 0,
    },
    {
      tier: "Assisted",
      allowedActions: ["view", "simulate", "propose"],
      maxPositionSize: "$10K",
      maxLeverage: "1x",
      approvalRequired: true,
      approverCount: 1,
    },
    {
      tier: "Semi-Auto",
      allowedActions: ["view", "simulate", "execute"],
      maxPositionSize: "$50K",
      maxLeverage: "2x",
      approvalRequired: true,
      approverCount: 2,
    },
    {
      tier: "Autonomous",
      allowedActions: ["view", "simulate", "execute", "hedge"],
      maxPositionSize: "$500K",
      maxLeverage: "3x",
      approvalRequired: false,
      approverCount: 0,
    },
  ];

  useEffect(() => {
    (async () => {
      try {
        const res = await api.risk.getTrustTiers();
        const data = Array.isArray(res) ? res : res?.strategies ?? res?.data ?? [];
        setStrategies(data);
      } catch (e) {
        // Mock fallback
        setStrategies([
          {
            id: "strat_001",
            strategyName: "MomentumTrader v1",
            currentTier: "Autonomous",
            assignedAt: "2024-02-15T10:00:00Z",
            metrics: { sharpe: 2.15, maxDrawdown: 8, winRate: 62 },
          },
          {
            id: "strat_002",
            strategyName: "MeanReversion v3",
            currentTier: "Semi-Auto",
            assignedAt: "2024-03-01T14:30:00Z",
            metrics: { sharpe: 1.45, maxDrawdown: 12, winRate: 55 },
          },
          {
            id: "strat_003",
            strategyName: "TrendFollower v2",
            currentTier: "Autonomous",
            assignedAt: "2024-01-20T09:15:00Z",
            metrics: { sharpe: 2.8, maxDrawdown: 7, winRate: 68 },
          },
          {
            id: "strat_004",
            strategyName: "ArbitrageBot v1",
            currentTier: "Assisted",
            assignedAt: "2024-03-15T11:45:00Z",
            metrics: { sharpe: 0.95, maxDrawdown: 15, winRate: 52 },
          },
          {
            id: "strat_005",
            strategyName: "ExperimentalStrategy",
            currentTier: "Manual",
            assignedAt: "2024-04-01T08:00:00Z",
            metrics: { sharpe: 1.2, maxDrawdown: 20, winRate: 48 },
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "Manual":
        return "bg-gray-500/20 text-gray-300";
      case "Assisted":
        return "bg-yellow-500/20 text-yellow-300";
      case "Semi-Auto":
        return "bg-blue-500/20 text-blue-300";
      case "Autonomous":
        return "bg-green-500/20 text-green-300";
      default:
        return "bg-gray-500/20 text-gray-300";
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
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Governance · Trust Tiers</h1>
        <p className="text-sm text-muted">
          Per-strategy trust tier — Manual, Assisted, Semi-Auto, Autonomous. Drives execution
          sizing and approval gates.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Tier Specifications</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {tierSpecs.map((spec) => (
            <div key={spec.tier} className="p-4 border border-border rounded-lg bg-surface/40">
              <h3 className={`font-semibold px-2 py-1 rounded mb-3 inline-block ${getTierColor(spec.tier)}`}>
                {spec.tier}
              </h3>

              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted mb-1">Max Position Size</p>
                  <p className="font-mono">{spec.maxPositionSize}</p>
                </div>

                <div>
                  <p className="text-xs text-muted mb-1">Max Leverage</p>
                  <p className="font-mono">{spec.maxLeverage}</p>
                </div>

                <div>
                  <p className="text-xs text-muted mb-1">Approval Required</p>
                  <p>
                    {spec.approvalRequired
                      ? `Yes (${spec.approverCount} approver${spec.approverCount > 1 ? "s" : ""})`
                      : "No"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted mb-1">Allowed Actions</p>
                  <div className="flex flex-wrap gap-1">
                    {spec.allowedActions.map((action) => (
                      <span
                        key={action}
                        className="text-xs px-1.5 py-0.5 rounded bg-surface text-muted"
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Strategy Assignments</h2>

        {strategies.length === 0 ? (
          <div className="p-6 text-center text-muted rounded border border-border">
            No strategy assignments yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Strategy</th>
                  <th className="px-3 py-2 font-medium">Current Tier</th>
                  <th className="px-3 py-2 font-medium">Sharpe</th>
                  <th className="px-3 py-2 font-medium">Max DD</th>
                  <th className="px-3 py-2 font-medium">Win Rate</th>
                  <th className="px-3 py-2 font-medium">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => (
                  <tr key={strategy.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{strategy.strategyName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-1 rounded font-medium ${getTierColor(
                          strategy.currentTier
                        )}`}
                      >
                        {strategy.currentTier}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {strategy.metrics.sharpe.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {strategy.metrics.maxDrawdown.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {strategy.metrics.winRate}%
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {new Date(strategy.assignedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
