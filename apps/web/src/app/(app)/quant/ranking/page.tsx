"use client";

/**
 * Quant Lab · Ranking — Phase 5 surface.
 *
 * Wires the control-plane ranking routes from
 * services/control_plane/app/routes/quant_lab.py:
 *
 *   GET   /v1/quant/rankings              → RankingsListOut
 *   POST  /v1/quant/rankings/recompute    → RankingsListOut (admin only)
 *
 * The ranking snapshot assigns every strategy to Tier A / B / C from a
 * composite of sample size, expectancy, Sharpe, calibration quality,
 * and regime fit. Tier gates what the promotion FSM will accept:
 *
 *   Tier A → live / assisted-live / autonomous eligible.
 *   Tier B → paper-only.
 *   Tier C → experimental (lab-only).
 */

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { StrategyRanking, StrategyTier } from "@gv/types";

const TIER_TONE: Record<StrategyTier, "success" | "info" | "warn"> = {
  A: "success",
  B: "info",
  C: "warn",
};

function fmtScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

function fmtR(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

export default function QuantRankingPage() {
  const qc = useQueryClient();

  const rankingsQuery = useQuery({
    queryKey: ["quant-rankings", "latest"],
    queryFn: () => api.rankings.latest(),
    refetchInterval: 30_000,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => api.rankings.recompute(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quant-rankings"] });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<StrategyRanking>> = [
    {
      key: "rank",
      header: "#",
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-slate-900">
          {r.rank}
        </span>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (r) => (
        <Link
          href={`/strategies/active?id=${encodeURIComponent(r.strategyId)}`}
          className="font-mono text-xs text-sky-700 hover:underline"
        >
          {r.strategyId.slice(0, 14)}…
        </Link>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      render: (r) => <Badge tone={TIER_TONE[r.tier]}>{r.tier}</Badge>,
    },
    {
      key: "composite",
      header: "Composite",
      render: (r) => (
        <span className="font-mono text-xs text-slate-700">
          {fmtScore(r.compositeScore)}
        </span>
      ),
    },
    {
      key: "bestExpectancy",
      header: "Best expectancy",
      render: (r) =>
        r.bestMetrics ? (
          <span
            className={`font-mono text-xs ${
              r.bestMetrics.expectancyR > 0
                ? "text-emerald-700"
                : r.bestMetrics.expectancyR < 0
                  ? "text-rose-700"
                  : "text-slate-700"
            }`}
          >
            {fmtR(r.bestMetrics.expectancyR)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "bestSharpe",
      header: "Best Sharpe",
      render: (r) =>
        r.bestMetrics ? (
          <span className="font-mono text-xs text-slate-700">
            {r.bestMetrics.sharpe.toFixed(2)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "liveExpectancy",
      header: "Live expectancy",
      render: (r) =>
        r.liveMetrics ? (
          <span
            className={`font-mono text-xs ${
              r.liveMetrics.expectancyR > 0
                ? "text-emerald-700"
                : r.liveMetrics.expectancyR < 0
                  ? "text-rose-700"
                  : "text-slate-700"
            }`}
          >
            {fmtR(r.liveMetrics.expectancyR)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "rationale",
      header: "Rationale",
      render: (r) => (
        <span className="text-xs text-slate-700">
          {r.rationale ? r.rationale.slice(0, 140) : "—"}
          {r.rationale && r.rationale.length > 140 ? "…" : ""}
        </span>
      ),
    },
    {
      key: "rankedAt",
      header: "Ranked",
      render: (r) => formatDate(r.rankedAt),
    },
  ];

  const rows = rankingsQuery.data?.rankings ?? [];
  const summary = useMemo(() => {
    const counts: Record<StrategyTier, number> = { A: 0, B: 0, C: 0 };
    for (const r of rows) counts[r.tier] += 1;
    return counts;
  }, [rows]);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Quant Lab · Ranking"
        description="Nightly tier snapshot — A (live-eligible), B (paper-only), C (experimental). Recomputed on-demand by the learning worker; feeds the promotion FSM."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <Badge tone="success">A</Badge>
            <span className="font-mono text-slate-700">{summary.A}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="info">B</Badge>
            <span className="font-mono text-slate-700">{summary.B}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="warn">C</Badge>
            <span className="font-mono text-slate-700">{summary.C}</span>
          </div>
          {rankingsQuery.data ? (
            <span className="text-slate-500">
              Generated {formatDate(rankingsQuery.data.generatedAt)}
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          loading={recomputeMutation.isPending}
          onClick={() => recomputeMutation.mutate()}
        >
          Recompute
        </Button>
      </div>

      {recomputeMutation.error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          {pickErrorMessage(recomputeMutation.error)}
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={rankingsQuery.isLoading}
        error={rankingsQuery.error ? pickErrorMessage(rankingsQuery.error) : null}
        emptyMessage="No strategy rankings yet — run Recompute."
        rowKey={(r) => r.id}
      />

      <p className="text-xs text-slate-500">
        Promotions respect the tier boundary — see{" "}
        <Link
          href="/strategies/promotions"
          className="text-sky-700 hover:underline"
        >
          Strategies · Promotions
        </Link>{" "}
        for the full FSM audit trail.
      </p>
    </section>
  );
}
