"use client";

/**
 * Strategies · DNA — Phase 5 surface.
 *
 * Per-strategy DNA fingerprint served by
 * services/control_plane/app/routes/learning.py:
 *
 *   GET /v1/quant/strategies/:id/dna → StrategyDNAListOut
 *
 * DNA is the 4 × 5 (regime × session) grid of (winRate, meanR, sampleSize)
 * telling the operator *where* a strategy works and *where* it fails. This
 * page pulls the grid for a single strategy chosen from the live list and
 * renders it alongside best / worst cells and a trade-count rollup.
 *
 * Deep-link: ?id=<strategyId> preselects the strategy so links from the
 * Active catalog land straight here.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  DNACell,
  RegimeKind,
  StrategyDNA,
  TradingSession,
} from "@gv/types";

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

function indexCells(cells: ReadonlyArray<DNACell>): Map<string, DNACell> {
  const out = new Map<string, DNACell>();
  for (const c of cells) out.set(cellKey(c.regime, c.session), c);
  return out;
}

function dnaCellClass(c: DNACell | undefined): string {
  if (!c || c.sampleSize === 0) {
    return "bg-slate-50 text-slate-400";
  }
  const r = c.meanR ?? 0;
  if (r >= 0.5) return "bg-emerald-200 text-emerald-900";
  if (r > 0) return "bg-emerald-50 text-emerald-800";
  if (r <= -0.5) return "bg-rose-200 text-rose-900";
  if (r < 0) return "bg-rose-50 text-rose-800";
  return "bg-slate-100 text-slate-700";
}

function fmtR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

const TIER_TONE: Record<"A" | "B" | "C", "success" | "info" | "warn"> = {
  A: "success",
  B: "info",
  C: "warn",
};

export default function StrategiesDnaPage() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("id") ?? "";
  const [strategyId, setStrategyId] = useState(initial);

  // If the URL id changes (user navigated), reflect it.
  useEffect(() => {
    if (initial && initial !== strategyId) setStrategyId(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const strategiesQuery = useQuery({
    queryKey: ["strategies", "list", { limit: 200 }],
    queryFn: () => api.strategies.list({ limit: 200 }),
    staleTime: 30_000,
  });

  const dnaQuery = useQuery({
    queryKey: ["strategy-dna", "get", strategyId],
    enabled: !!strategyId,
    queryFn: () =>
      strategyId ? api.strategyDNA.get(strategyId) : Promise.resolve(null),
    refetchInterval: strategyId ? 60_000 : false,
  });

  const strategyOptions = strategiesQuery.data?.strategies ?? [];
  const selected = useMemo(
    () => strategyOptions.find((s) => s.id === strategyId) ?? null,
    [strategyOptions, strategyId],
  );

  const dna: StrategyDNA | null = dnaQuery.data?.dna?.[0] ?? null;
  const cellIndex = useMemo(
    () => (dna ? indexCells(dna.cells) : new Map<string, DNACell>()),
    [dna],
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Strategies · DNA"
        description="Regime × session performance grid for a single strategy. Each cell shows win rate, mean R, and sample size — the fingerprint of where this strategy thrives or fails."
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-xs font-medium text-slate-700">
          Strategy
          <select
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm md:w-96"
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            disabled={strategiesQuery.isLoading}
          >
            <option value="">
              {strategiesQuery.isLoading ? "loading…" : "(choose a strategy)"}
            </option>
            {strategyOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.tier} · {s.promotionState}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone={TIER_TONE[selected.tier]}>Tier {selected.tier}</Badge>
            <Badge tone="info">{selected.promotionState.replaceAll("_", " ")}</Badge>
            <span className="font-mono text-slate-500">
              {selected.setupType.replaceAll("_", " ")}
            </span>
          </div>
        ) : null}
      </div>

      {!strategyId ? (
        <div className="rounded border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          Pick a strategy above to load its DNA fingerprint.
        </div>
      ) : dnaQuery.isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          Loading DNA…
        </div>
      ) : dnaQuery.error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {pickErrorMessage(dnaQuery.error)}
        </div>
      ) : !dna ? (
        <div className="rounded border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          No DNA snapshot for this strategy yet — it runs off live + backtest
          trades, so a freshly-created strategy needs a few fills before the
          grid is populated.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Total trades
              </div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                {dna.totalTrades}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Sample size across the full regime × session grid. Tier at
                generation:{" "}
                <Badge tone={TIER_TONE[dna.tierAtGeneration]}>
                  {dna.tierAtGeneration}
                </Badge>
              </p>
            </article>
            <article className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-[10px] uppercase tracking-wide text-emerald-700">
                Best cell
              </div>
              {dna.bestCell ? (
                <>
                  <div className="mt-1 font-mono text-sm font-semibold text-emerald-900">
                    {dna.bestCell.regime} · {dna.bestCell.session}
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    Mean {fmtR(dna.bestCell.meanR)} · win{" "}
                    {fmtPct(dna.bestCell.winRate)} · n={dna.bestCell.sampleSize}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-emerald-800">—</p>
              )}
            </article>
            <article className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <div className="text-[10px] uppercase tracking-wide text-rose-700">
                Worst cell
              </div>
              {dna.worstCell ? (
                <>
                  <div className="mt-1 font-mono text-sm font-semibold text-rose-900">
                    {dna.worstCell.regime} · {dna.worstCell.session}
                  </div>
                  <p className="mt-1 text-[11px] text-rose-800">
                    Mean {fmtR(dna.worstCell.meanR)} · win{" "}
                    {fmtPct(dna.worstCell.winRate)} · n={dna.worstCell.sampleSize}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-rose-800">—</p>
              )}
            </article>
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Regime × session grid
              </h2>
              <span className="text-[11px] text-slate-500">
                Generated {formatRelative(dna.generatedAt)}
              </span>
            </header>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-1 text-[11px]">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-slate-500">
                      regime ↓ / session →
                    </th>
                    {SESSIONS.map((sess) => (
                      <th
                        key={sess}
                        className="px-2 py-1 text-center font-medium text-slate-500"
                      >
                        {sess.replaceAll("_", " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {REGIMES.map((regime) => (
                    <tr key={regime}>
                      <td className="px-2 py-1 font-medium text-slate-700">
                        {regime.replaceAll("_", " ")}
                      </td>
                      {SESSIONS.map((sess) => {
                        const c = cellIndex.get(cellKey(regime, sess));
                        return (
                          <td
                            key={sess}
                            className={`rounded p-2 text-center align-top ${dnaCellClass(c)}`}
                          >
                            {c && c.sampleSize > 0 ? (
                              <div className="space-y-0.5">
                                <div className="font-mono text-xs font-semibold">
                                  {fmtR(c.meanR)}
                                </div>
                                <div className="font-mono text-[10px]">
                                  win {fmtPct(c.winRate)}
                                </div>
                                <div className="text-[10px] opacity-75">
                                  n={c.sampleSize}
                                </div>
                              </div>
                            ) : (
                              <div className="text-[10px]">—</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              Emerald cells are positive expectancy; rose cells are negative.
              Grey cells have no trades. The learning agent uses this grid to
              gate promotions — a strategy with all emeralds in a single
              session is a specialist, not a generalist.
            </p>
          </section>
        </>
      )}

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/strategies/active" className="text-sky-700 hover:underline">
          Strategies · Active
        </Link>{" "}
        for the tier + promotion view;{" "}
        <Link href="/research/regimes" className="text-sky-700 hover:underline">
          Research · Regimes
        </Link>{" "}
        for live regime snapshots across the entire catalog.
      </p>
    </section>
  );
}
