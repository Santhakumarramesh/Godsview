"use client";

/**
 * Research · Regimes — Phase 5 surface.
 *
 * Wires three control-plane routes:
 *
 *   GET /v1/regime/current                    → RegimeCurrentOut
 *   GET /v1/quant/dna                         → StrategyDNAListOut
 *   GET /v1/quant/strategies/:id/dna          → StrategyDNAListOut
 *
 * Two panels live here:
 *
 *   1. Current regime per (symbolId, tf) — the live verdict the detector
 *      is emitting right now.
 *   2. Strategy DNA grid (4 regimes × 5 sessions) for a selected
 *      strategy — where it has worked historically, where it hasn't.
 *
 * Together they answer the research-seat question: "Is this strategy
 * in its happy zone right now, or am I fighting my own DNA?"
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  DNACell,
  RegimeKind,
  RegimeSnapshot,
  StrategyDNA,
  TradingSession,
} from "@gv/types";

const REGIME_TONE: Record<
  RegimeKind,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  trending: "success",
  ranging: "info",
  volatile: "warn",
  news_driven: "danger",
};

const REGIMES: ReadonlyArray<RegimeKind> = [
  "trending",
  "ranging",
  "volatile",
  "news_driven",
];

const SESSIONS: ReadonlyArray<TradingSession> = [
  "asia",
  "london",
  "ny_am",
  "ny_pm",
  "off_hours",
];

function cellKey(regime: RegimeKind, session: TradingSession): string {
  return `${regime}::${session}`;
}

function gridOf(
  cells: ReadonlyArray<DNACell>,
): Map<string, DNACell> {
  const m = new Map<string, DNACell>();
  for (const c of cells) m.set(cellKey(c.regime, c.session), c);
  return m;
}

function dnaCellClass(c: DNACell | undefined): string {
  if (!c || c.sampleSize === 0) return "bg-slate-50 text-slate-400";
  if (c.meanR === null) return "bg-slate-100 text-slate-500";
  if (c.meanR > 0.5) return "bg-emerald-100 text-emerald-900";
  if (c.meanR > 0) return "bg-emerald-50 text-emerald-800";
  if (c.meanR < -0.5) return "bg-rose-100 text-rose-900";
  if (c.meanR < 0) return "bg-rose-50 text-rose-800";
  return "bg-slate-50 text-slate-700";
}

export default function ResearchRegimesPage() {
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(
    null,
  );

  const currentQuery = useQuery({
    queryKey: ["regime", "current"],
    queryFn: () => api.regime.current(),
    refetchInterval: 15_000,
  });

  const dnaListQuery = useQuery({
    queryKey: ["strategyDNA", "listAll"],
    queryFn: () => api.strategyDNA.listAll(),
    refetchInterval: 60_000,
  });

  const dnaList = dnaListQuery.data?.dna ?? [];

  const selectedDNA: StrategyDNA | null = useMemo(() => {
    if (!dnaList.length) return null;
    const id = selectedStrategyId ?? dnaList[0]?.strategyId;
    if (!id) return null;
    return dnaList.find((d) => d.strategyId === id) ?? null;
  }, [dnaList, selectedStrategyId]);

  const cellGrid = useMemo(
    () => (selectedDNA ? gridOf(selectedDNA.cells) : new Map()),
    [selectedDNA],
  );

  const currentColumns: ReadonlyArray<DataTableColumn<RegimeSnapshot>> = [
    {
      key: "symbol",
      header: "Symbol",
      render: (r) => (
        <code className="font-mono text-xs text-slate-900">{r.symbolId}</code>
      ),
    },
    {
      key: "tf",
      header: "TF",
      render: (r) => <Badge tone="neutral">{r.tf}</Badge>,
    },
    {
      key: "kind",
      header: "Regime",
      render: (r) => <Badge tone={REGIME_TONE[r.kind]}>{r.kind}</Badge>,
    },
    {
      key: "confidence",
      header: "Conf",
      render: (r) => (
        <span className="font-mono text-xs text-slate-700">
          {(r.confidence * 100).toFixed(0)}%
        </span>
      ),
    },
    {
      key: "trend",
      header: "Trend",
      render: (r) => (
        <span
          className={`font-mono text-xs ${
            r.trendStrength > 0
              ? "text-emerald-700"
              : r.trendStrength < 0
                ? "text-rose-700"
                : "text-slate-700"
          }`}
        >
          {r.trendStrength > 0 ? "+" : ""}
          {r.trendStrength.toFixed(2)}
        </span>
      ),
    },
    {
      key: "vol",
      header: "Vol",
      render: (r) => (
        <span className="font-mono text-xs text-slate-700">
          {(r.volatility * 100).toFixed(0)}%
        </span>
      ),
    },
    {
      key: "age",
      header: "Bar age",
      render: (r) => (
        <span className="font-mono text-[11px] text-slate-500">
          {(r.barAgeMs / 1000).toFixed(1)}s
        </span>
      ),
    },
    {
      key: "observedAt",
      header: "Observed",
      render: (r) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(r.observedAt)}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-8">
      <PageHeader
        title="Research · Regimes"
        description="Where the market is, and where this strategy has historically made money. The governance gate cross-checks the live regime against each strategy's DNA before approving new trades."
      />

      {/* Current regime table */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Current regime
          </h2>
          {currentQuery.data ? (
            <span className="text-[11px] text-slate-500">
              Generated {formatRelative(currentQuery.data.generatedAt)}
            </span>
          ) : null}
        </header>
        <div className="mt-4">
          <DataTable
            rows={currentQuery.data?.snapshots ?? []}
            columns={currentColumns}
            loading={currentQuery.isLoading}
            error={
              currentQuery.error
                ? pickErrorMessage(currentQuery.error)
                : null
            }
            emptyMessage="No regime snapshots available yet."
            rowKey={(r) => r.id}
          />
        </div>
      </section>

      {/* Strategy DNA */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Strategy DNA
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Regime (rows) × session (columns). Each cell shows mean R +
              win-rate + sample size. Green = strategy happy zone; red =
              systematic failure mode.
            </p>
          </div>
          <label className="text-xs font-medium text-slate-700">
            Strategy
            <select
              value={selectedDNA?.strategyId ?? ""}
              onChange={(e) => setSelectedStrategyId(e.target.value || null)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              disabled={dnaListQuery.isLoading}
            >
              {dnaList.length === 0 ? (
                <option value="">— none —</option>
              ) : (
                dnaList.map((d) => (
                  <option key={d.strategyId} value={d.strategyId}>
                    {d.strategyId.slice(0, 18)}… ({d.tierAtGeneration})
                  </option>
                ))
              )}
            </select>
          </label>
        </header>

        {dnaListQuery.isLoading ? (
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Loading DNA…
          </div>
        ) : dnaListQuery.error ? (
          <div className="mt-4 rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {pickErrorMessage(dnaListQuery.error)}
          </div>
        ) : !selectedDNA ? (
          <div className="mt-4 rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            No DNA snapshots yet — strategies need at least one paper trade
            before DNA is computed.
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      regime ↓ / session →
                    </th>
                    {SESSIONS.map((s) => (
                      <th
                        key={s}
                        className="border border-slate-200 bg-slate-50 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-slate-500"
                      >
                        {s.replaceAll("_", " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {REGIMES.map((regime) => (
                    <tr key={regime}>
                      <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left text-[11px] font-semibold text-slate-700">
                        {regime.replaceAll("_", " ")}
                      </th>
                      {SESSIONS.map((session) => {
                        const c = cellGrid.get(cellKey(regime, session));
                        const klass = dnaCellClass(c);
                        return (
                          <td
                            key={session}
                            className={`border border-slate-200 px-2 py-2 text-center font-mono ${klass}`}
                          >
                            {!c || c.sampleSize === 0 ? (
                              <span className="text-[11px]">—</span>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold">
                                  {c.meanR === null
                                    ? "—"
                                    : `${c.meanR > 0 ? "+" : ""}${c.meanR.toFixed(2)}R`}
                                </span>
                                <span className="text-[10px]">
                                  {c.winRate === null
                                    ? "—"
                                    : `${(c.winRate * 100).toFixed(0)}% · `}
                                  n={c.sampleSize}
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="mt-4 grid gap-3 md:grid-cols-3 text-[11px] text-slate-600">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Best cell
                </div>
                {selectedDNA.bestCell ? (
                  <div>
                    {selectedDNA.bestCell.regime} /{" "}
                    {selectedDNA.bestCell.session} · mean{" "}
                    {selectedDNA.bestCell.meanR === null
                      ? "—"
                      : `${selectedDNA.bestCell.meanR.toFixed(2)}R`}{" "}
                    · n={selectedDNA.bestCell.sampleSize}
                  </div>
                ) : (
                  "—"
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Worst cell
                </div>
                {selectedDNA.worstCell ? (
                  <div>
                    {selectedDNA.worstCell.regime} /{" "}
                    {selectedDNA.worstCell.session} · mean{" "}
                    {selectedDNA.worstCell.meanR === null
                      ? "—"
                      : `${selectedDNA.worstCell.meanR.toFixed(2)}R`}{" "}
                    · n={selectedDNA.worstCell.sampleSize}
                  </div>
                ) : (
                  "—"
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Total trades · generated
                </div>
                <div>
                  {selectedDNA.totalTrades} · {formatDate(selectedDNA.generatedAt)}
                </div>
              </div>
            </footer>
          </>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/market/regimes" className="text-sky-700 hover:underline">
          Market · Regimes
        </Link>{" "}
        for the live detector,{" "}
        <Link href="/learning/drift" className="text-sky-700 hover:underline">
          Learning · Drift
        </Link>{" "}
        for historical regime flips, and{" "}
        <Link href="/quant/ranking" className="text-sky-700 hover:underline">
          Quant Lab · Ranking
        </Link>{" "}
        which weights DNA into the composite tier score.
      </p>
    </section>
  );
}
