"use client";

/**
 * Intelligence · Recall — Phase 5 surface.
 *
 * Wires three recall routes served by
 * services/control_plane/app/routes/recall.py:
 *
 *   POST /v1/recall/search    → RecallSearchResult
 *   GET  /v1/recall/trades    → RecallTradesListOut
 *
 * The page is the operator-facing front-end to the 64-dim recall vector
 * store. Three search modes are supported:
 *
 *   1. by_setup       — "Setups like this one (by id)"
 *   2. by_live_trade  — "Live trades like this one (by id)"
 *   3. by_features    — advanced: pack a RecallFeatures envelope and
 *                       query directly.
 *
 * The first two are one-click searches; the third is lab-only, not
 * exposed from this page (use the API directly).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  RecallMatch,
  RecallOutcome,
  RecallSearchRequest,
  RecallSearchResult,
  RecallTrade,
} from "@gv/types";

const OUTCOME_TONE: Record<
  RecallOutcome,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  win: "success",
  loss: "danger",
  scratch: "neutral",
  open: "info",
};

function fmtR(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

type SearchKind = "by_setup" | "by_live_trade";

export default function IntelRecallPage() {
  const [searchKind, setSearchKind] = useState<SearchKind>("by_setup");
  const [subjectId, setSubjectId] = useState("");
  const [k, setK] = useState(20);
  const [minSim, setMinSim] = useState(0.3);
  const [result, setResult] = useState<RecallSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Recent trade memory — not search — gives an at-a-glance feel.
  const recentQuery = useQuery({
    queryKey: ["recall", "trades", "recent"],
    queryFn: () => api.recall.listTrades({ limit: 20 }),
    refetchInterval: 60_000,
  });

  const searchMutation = useMutation({
    mutationFn: (req: RecallSearchRequest) => api.recall.search(req),
    onSuccess: (r) => {
      setResult(r);
      setSearchError(null);
    },
    onError: (e) => {
      setSearchError(pickErrorMessage(e));
      setResult(null);
    },
  });

  const onSearch = () => {
    if (!subjectId.trim()) {
      setSearchError(
        searchKind === "by_setup"
          ? "Setup ID is required"
          : "Live trade ID is required",
      );
      return;
    }
    const req: RecallSearchRequest =
      searchKind === "by_setup"
        ? {
            kind: "by_setup",
            setupId: subjectId.trim(),
            k,
            minSimilarity: minSim,
          }
        : {
            kind: "by_live_trade",
            liveTradeId: subjectId.trim(),
            k,
            minSimilarity: minSim,
          };
    searchMutation.mutate(req);
  };

  const matchColumns: ReadonlyArray<DataTableColumn<RecallMatch>> = [
    {
      key: "similarity",
      header: "Sim",
      render: (m) => (
        <span className="font-mono text-xs font-semibold text-slate-900">
          {(m.similarity * 100).toFixed(1)}%
        </span>
      ),
    },
    {
      key: "setup",
      header: "Setup",
      render: (m) => (
        <Link
          href={`/intel/setups/${encodeURIComponent(m.setupId)}`}
          className="flex flex-col"
        >
          <span className="text-xs font-medium text-sky-700 hover:underline">
            {m.setupType}
          </span>
          <span className="text-[10px] text-slate-500">
            {m.direction} · {m.tf}
          </span>
        </Link>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (m) => (
        <code className="font-mono text-xs text-slate-900">{m.symbolId}</code>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (m) => <Badge tone={OUTCOME_TONE[m.outcome]}>{m.outcome}</Badge>,
    },
    {
      key: "pnlR",
      header: "PnL R",
      render: (m) => (
        <span
          className={`font-mono text-xs ${
            m.pnlR === null
              ? "text-slate-400"
              : m.pnlR > 0
                ? "text-emerald-700"
                : m.pnlR < 0
                  ? "text-rose-700"
                  : "text-slate-700"
          }`}
        >
          {fmtR(m.pnlR)}
        </span>
      ),
    },
    {
      key: "detectedAt",
      header: "Detected",
      render: (m) => (
        <span className="text-[11px] text-slate-600">
          {formatRelative(m.detectedAt)}
        </span>
      ),
    },
  ];

  const tradeColumns: ReadonlyArray<DataTableColumn<RecallTrade>> = [
    {
      key: "setup",
      header: "Setup · TF",
      render: (t) => (
        <div className="flex flex-col">
          <Link
            href={`/intel/setups/${encodeURIComponent(t.setupId)}`}
            className="text-xs font-medium text-sky-700 hover:underline"
          >
            {t.setupType}
          </Link>
          <span className="text-[10px] text-slate-500">
            {t.direction} · {t.tf}
          </span>
        </div>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (t) => (
        <code className="font-mono text-xs text-slate-900">{t.symbolId}</code>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (t) => <Badge tone={OUTCOME_TONE[t.outcome]}>{t.outcome}</Badge>,
    },
    {
      key: "pnlR",
      header: "PnL R",
      render: (t) => (
        <span
          className={`font-mono text-xs ${
            t.pnlR === null
              ? "text-slate-400"
              : t.pnlR > 0
                ? "text-emerald-700"
                : t.pnlR < 0
                  ? "text-rose-700"
                  : "text-slate-700"
          }`}
        >
          {fmtR(t.pnlR)}
        </span>
      ),
    },
    {
      key: "detectedAt",
      header: "Detected",
      render: (t) => (
        <span className="text-[11px] text-slate-600">
          {formatDate(t.detectedAt)}
        </span>
      ),
    },
    {
      key: "closedAt",
      header: "Closed",
      render: (t) =>
        t.closedAt ? (
          <span className="text-[11px] text-slate-600">
            {formatRelative(t.closedAt)}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">open</span>
        ),
    },
    {
      key: "reasoning",
      header: "Rationale",
      render: (t) => (
        <span className="text-[11px] text-slate-700">
          {t.reasoning ? t.reasoning.slice(0, 120) : "—"}
          {t.reasoning && t.reasoning.length > 120 ? "…" : ""}
        </span>
      ),
    },
  ];

  const summary = result?.summary;
  const matches = result?.matches ?? [];

  const summaryCards = useMemo(() => {
    if (!summary) return null;
    return (
      <div className="grid gap-3 md:grid-cols-4">
        <article className="rounded border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Matches
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-900">
            {summary.count}
          </div>
        </article>
        <article className="rounded border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Win rate
          </div>
          <div
            className={`mt-1 font-mono text-lg font-semibold ${
              summary.winRate === null
                ? "text-slate-400"
                : summary.winRate >= 0.5
                  ? "text-emerald-700"
                  : "text-rose-700"
            }`}
          >
            {summary.winRate === null
              ? "—"
              : `${(summary.winRate * 100).toFixed(0)}%`}
          </div>
        </article>
        <article className="rounded border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Mean PnL
          </div>
          <div
            className={`mt-1 font-mono text-lg font-semibold ${
              summary.meanPnlR === null
                ? "text-slate-400"
                : summary.meanPnlR > 0
                  ? "text-emerald-700"
                  : summary.meanPnlR < 0
                    ? "text-rose-700"
                    : "text-slate-700"
            }`}
          >
            {fmtR(summary.meanPnlR)}
          </div>
        </article>
        <article className="rounded border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Best / worst
          </div>
          <div className="mt-1 flex items-center gap-2">
            {summary.bestOutcome ? (
              <Badge tone={OUTCOME_TONE[summary.bestOutcome]}>
                {summary.bestOutcome}
              </Badge>
            ) : (
              <span className="text-[11px] text-slate-400">—</span>
            )}
            <span className="text-[11px] text-slate-500">/</span>
            {summary.worstOutcome ? (
              <Badge tone={OUTCOME_TONE[summary.worstOutcome]}>
                {summary.worstOutcome}
              </Badge>
            ) : (
              <span className="text-[11px] text-slate-400">—</span>
            )}
          </div>
        </article>
      </div>
    );
  }, [summary]);

  return (
    <section className="space-y-8">
      <PageHeader
        title="Intelligence · Recall"
        description="Similarity search over the 64-dim recall vector store. Ask 'setups like this have historically won X%?' and get a deterministic neighbour set with win-rate and mean R."
      />

      {/* Search form */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Similarity search
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_2fr_auto_auto]">
          <label className="text-xs font-medium text-slate-700">
            Mode
            <select
              value={searchKind}
              onChange={(e) => setSearchKind(e.target.value as SearchKind)}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="by_setup">by setup id</option>
              <option value="by_live_trade">by live trade id</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            {searchKind === "by_setup" ? "Setup ID" : "Live trade ID"}
            <input
              type="text"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              placeholder={
                searchKind === "by_setup" ? "setup_…" : "live_trade_…"
              }
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            k
            <input
              type="number"
              min={1}
              max={100}
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
              className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Min similarity
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={minSim}
              onChange={(e) => setMinSim(Number(e.target.value))}
              className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
        {searchError ? (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
            {searchError}
          </div>
        ) : null}
        <div className="mt-3">
          <Button
            size="sm"
            onClick={onSearch}
            loading={searchMutation.isPending}
          >
            Search
          </Button>
        </div>

        {result ? (
          <div className="mt-4 space-y-3">
            {summaryCards}
            <DataTable
              rows={matches}
              columns={matchColumns}
              emptyMessage="No matches above the similarity threshold"
              rowKey={(m) => m.recallTradeId}
            />
            <p className="text-[11px] text-slate-500">
              Search generated {formatRelative(result.generatedAt)}.
            </p>
          </div>
        ) : null}
      </section>

      {/* Recent trade memory */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Recent recall trades
          </h2>
          <span className="text-[11px] text-slate-500">
            The tail of the memory store — 20 most recent rows.
          </span>
        </header>
        <div className="mt-4">
          <DataTable
            rows={recentQuery.data?.trades ?? []}
            columns={tradeColumns}
            loading={recentQuery.isLoading}
            error={
              recentQuery.error ? pickErrorMessage(recentQuery.error) : null
            }
            emptyMessage="No trades in recall memory yet."
            rowKey={(t) => t.id}
          />
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/learning/missed" className="text-sky-700 hover:underline">
          Learning · Missed trades
        </Link>{" "}
        to see what we didn't take.
      </p>
    </section>
  );
}
