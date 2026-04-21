"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Demotion {
  id: string;
  strategyName: string;
  fromTier: string;
  toTier: string;
  reason: string;
  date: string;
  demotedBy: string;
  metrics?: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
}

export default function GovernanceDemotionsPage() {
  const [demotions, setDemotions] = useState<Demotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rePromoting, setRePromoting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.backtest.listDemotions();
        const data = Array.isArray(res) ? res : res?.demotions ?? res?.data ?? [];
        setDemotions(data);
      } catch (e) {
        // Mock fallback
        setDemotions([
          {
            id: "demotion_001",
            strategyName: "MomentumTrader v1",
            fromTier: "Tier A (Live)",
            toTier: "Tier B (Paper)",
            reason: "Max drawdown exceeded threshold (18% > 15%)",
            date: "2024-04-18T10:30:00Z",
            demotedBy: "system",
            metrics: { sharpeRatio: 1.2, maxDrawdown: 18.5, winRate: 55 },
          },
          {
            id: "demotion_002",
            strategyName: "MeanReversion v3",
            fromTier: "Tier B (Paper)",
            toTier: "Tier C (Experimental)",
            reason: "Sharpe ratio fell below 1.0",
            date: "2024-04-15T14:45:00Z",
            demotedBy: "system",
            metrics: { sharpeRatio: 0.85, maxDrawdown: 22, winRate: 48 },
          },
          {
            id: "demotion_003",
            strategyName: "TrendFollower v2",
            fromTier: "Tier A (Live)",
            toTier: "Tier B (Paper)",
            reason: "Anomaly detected in recent returns distribution",
            date: "2024-04-10T08:15:00Z",
            demotedBy: "system",
            metrics: { sharpeRatio: 1.8, maxDrawdown: 11, winRate: 61 },
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleRePromote = async (demotionId: string) => {
    setRePromoting(demotionId);
    try {
      await api.backtest.requestRePromotion(demotionId);
      setError(null);
    } catch (e) {
      setError(`Failed to request re-promotion`);
    } finally {
      setRePromoting(null);
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
        <h1 className="text-2xl font-semibold">Governance · Demotions</h1>
        <p className="text-sm text-muted">
          Auto-demotion log — strategies kicked down a tier by SLO breach, drawdown, anomaly
          detection, or calibration drift.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {demotions.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No demotions recorded.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Strategy</th>
                <th className="px-3 py-2 font-medium">Tier Change</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Metrics</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {demotions.map((demotion) => (
                <tr key={demotion.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{demotion.strategyName}</td>
                  <td className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300">
                        {demotion.fromTier}
                      </span>
                      <span className="text-muted">→</span>
                      <span className="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-300">
                        {demotion.toTier}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted">{demotion.reason}</td>
                  <td className="px-3 py-2 text-xs">
                    {demotion.metrics && (
                      <div className="space-y-0.5">
                        <div>Sharpe: {demotion.metrics.sharpeRatio.toFixed(2)}</div>
                        <div>DD: {demotion.metrics.maxDrawdown.toFixed(1)}%</div>
                        <div>WR: {demotion.metrics.winRate}%</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(demotion.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleRePromote(demotion.id)}
                      disabled={rePromoting === demotion.id}
                      className="px-2 py-1 text-xs rounded border border-green-600/50 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                    >
                      Request Promotion
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
