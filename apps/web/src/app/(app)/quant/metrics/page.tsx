"use client";

/**
 * Quant Lab · Metrics — Phase 5 surface.
 *
 * Aggregates the latest BacktestRun metrics across strategies into a
 * readable dashboard. No new endpoint — this view composes data already
 * served by /v1/quant/backtests. Each card projects the strategy's best
 * completed backtest into the canonical BacktestMetrics envelope
 * (win-rate, expectancy, Sharpe, Sortino, profit factor, max DD).
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { BacktestMetrics, BacktestRun } from "@gv/types";

interface StrategyAgg {
  strategyId: string;
  runCount: number;
  best: BacktestRun;
  completed: BacktestRun[];
}

function fmtNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(digits);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function MetricCell({
  label,
  value,
  className = "",
  tone = "neutral",
}: {
  label: string;
  value: string;
  className?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : "text-slate-900";
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-sm font-semibold ${toneClass}`}>
        {value}
      </dd>
    </div>
  );
}

function MetricCard({ agg }: { agg: StrategyAgg }) {
  const m = agg.best.metrics as BacktestMetrics;
  const expectancyTone =
    m.expectancyR > 0 ? "good" : m.expectancyR < 0 ? "bad" : "neutral";
  const totalRTone =
    m.totalR > 0 ? "good" : m.totalR < 0 ? "bad" : "neutral";

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-center justify-between">
        <Link
          href={`/strategies/active?id=${encodeURIComponent(agg.strategyId)}`}
          className="font-mono text-xs font-semibold text-sky-700 hover:underline"
        >
          {agg.strategyId.slice(0, 16)}…
        </Link>
        <Badge tone="neutral">{agg.runCount} runs</Badge>
      </header>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        <MetricCell
          label="Win rate"
          value={fmtPct(m.winRate)}
        />
        <MetricCell
          label="Expectancy"
          value={`${m.expectancyR > 0 ? "+" : ""}${fmtNumber(m.expectancyR, 3)}R`}
          tone={expectancyTone}
        />
        <MetricCell
          label="Profit factor"
          value={fmtNumber(m.profitFactor, 2)}
        />
        <MetricCell
          label="Sharpe"
          value={fmtNumber(m.sharpe, 2)}
        />
        <MetricCell
          label="Sortino"
          value={fmtNumber(m.sortino, 2)}
        />
        <MetricCell
          label="Max DD"
          value={`${fmtNumber(m.maxDrawdownR, 2)}R`}
          tone="bad"
        />
        <MetricCell
          label="MAE (mean)"
          value={fmtNumber(m.meanMAER, 2)}
        />
        <MetricCell
          label="MFE (mean)"
          value={fmtNumber(m.meanMFER, 2)}
        />
        <MetricCell
          label="Total R"
          value={`${m.totalR > 0 ? "+" : ""}${fmtNumber(m.totalR, 1)}`}
          tone={totalRTone}
        />
      </dl>

      <footer className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
        <span>
          Best run{" "}
          <code className="font-mono">{agg.best.id.slice(0, 10)}…</code>
        </span>
        <span>
          {m.totalTrades} trades · {formatDate(m.endedAt)}
        </span>
      </footer>
    </article>
  );
}

export default function QuantMetricsPage() {
  const runsQuery = useQuery({
    queryKey: ["backtests", "metrics", "completed"],
    queryFn: () => api.backtests.list({ status: "completed", limit: 200 }),
    refetchInterval: 30_000,
  });

  const aggregates: StrategyAgg[] = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    const byStrategy = new Map<string, BacktestRun[]>();
    for (const r of runs) {
      if (!r.metrics) continue;
      const list = byStrategy.get(r.strategyId) ?? [];
      list.push(r);
      byStrategy.set(r.strategyId, list);
    }
    const out: StrategyAgg[] = [];
    for (const [strategyId, list] of byStrategy) {
      let best = list[0]!;
      for (const r of list.slice(1)) {
        const curExp = r.metrics?.expectancyR ?? -Infinity;
        const bestExp = best.metrics?.expectancyR ?? -Infinity;
        if (curExp > bestExp) best = r;
      }
      out.push({
        strategyId,
        runCount: list.length,
        best,
        completed: list,
      });
    }
    out.sort(
      (a, b) =>
        (b.best.metrics?.expectancyR ?? 0) -
        (a.best.metrics?.expectancyR ?? 0),
    );
    return out;
  }, [runsQuery.data]);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Quant Lab · Metrics"
        description="Strategy performance dashboard. One card per strategy, showing the best completed BacktestRun across win-rate, expectancy, Sharpe, and drawdown."
      />

      {runsQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Loading metrics…
        </div>
      ) : runsQuery.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {pickErrorMessage(runsQuery.error)}
        </div>
      ) : aggregates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No completed backtests yet. Queue one on{" "}
          <Link href="/quant/backtests" className="text-sky-700 hover:underline">
            Quant Lab · Backtests
          </Link>
          .
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {aggregates.map((a) => (
            <MetricCard key={a.strategyId} agg={a} />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Total completed runs considered: {runsQuery.data?.runs?.length ?? 0}.
        Ranking tiers derived from these metrics drive the promotion FSM —
        see{" "}
        <Link href="/quant/ranking" className="text-sky-700 hover:underline">
          Quant Lab · Ranking
        </Link>
        .
      </p>
    </section>
  );
}
