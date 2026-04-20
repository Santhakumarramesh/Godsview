"use client";

/**
 * Learning · Missed trades — Phase 5 surface.
 *
 * Wires the recall route for systematic misses:
 *
 *   GET /v1/recall/missed → MissedTradesListOut
 *
 * A MissedTrade is a setup the detector emitted but that we did not
 * action — filtered by gate, below confidence, risk-capped, manually
 * skipped, etc. The page aggregates hypothetical R contributions and
 * exposes reason-level filtering so the learning agent can spot
 * systematic leaks.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import type { MissedTradeFilter } from "@gv/api-client";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type { MissedTrade, MissedTradeReason } from "@gv/types";

const REASON_TONE: Record<
  MissedTradeReason,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  below_confidence: "info",
  gate_rejected: "warn",
  risk_capped: "warn",
  operator_skipped: "neutral",
  data_quality: "danger",
  duplicate: "neutral",
  expired: "neutral",
  other: "neutral",
};

const REASONS: ReadonlyArray<MissedTradeReason> = [
  "below_confidence",
  "gate_rejected",
  "risk_capped",
  "operator_skipped",
  "data_quality",
  "duplicate",
  "expired",
  "other",
];

function fmtR(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

export default function LearningMissedPage() {
  const [reason, setReason] = useState<MissedTradeReason | "">("");
  const [symbolId, setSymbolId] = useState("");

  const filter: MissedTradeFilter = useMemo(() => {
    const f: MissedTradeFilter = { limit: 200 };
    if (reason) f.reason = reason;
    if (symbolId.trim()) f.symbolId = symbolId.trim();
    return f;
  }, [reason, symbolId]);

  const missedQuery = useQuery({
    queryKey: ["recall", "missed", filter],
    queryFn: () => api.recall.listMissed(filter),
    refetchInterval: 30_000,
  });

  const rows = missedQuery.data?.trades ?? [];
  const total = missedQuery.data?.total ?? 0;
  const windowMean = missedQuery.data?.windowMeanR ?? null;

  const reasonCounts = useMemo(() => {
    const out = new Map<MissedTradeReason, number>();
    for (const r of REASONS) out.set(r, 0);
    for (const t of rows) out.set(t.reason, (out.get(t.reason) ?? 0) + 1);
    return [...out.entries()].filter(([, n]) => n > 0);
  }, [rows]);

  const columns: ReadonlyArray<DataTableColumn<MissedTrade>> = [
    {
      key: "detectedAt",
      header: "Detected",
      render: (t) => (
        <div className="flex flex-col text-[11px]">
          <span>{formatDate(t.detectedAt)}</span>
          <span className="text-[10px] text-slate-500">
            {formatRelative(t.detectedAt)}
          </span>
        </div>
      ),
    },
    {
      key: "symbol",
      header: "Symbol · TF",
      render: (t) => (
        <div className="flex flex-col">
          <code className="font-mono text-xs text-slate-900">{t.symbolId}</code>
          <span className="text-[10px] text-slate-500">{t.tf}</span>
        </div>
      ),
    },
    {
      key: "setup",
      header: "Setup",
      render: (t) => (
        <Link
          href={`/intel/setups/${encodeURIComponent(t.setupId)}`}
          className="flex flex-col"
        >
          <span className="text-xs font-medium text-sky-700 hover:underline">
            {t.setupType}
          </span>
          <span
            className={`text-[10px] ${
              t.direction === "long" ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {t.direction}
          </span>
        </Link>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (t) => <Badge tone={REASON_TONE[t.reason]}>{t.reason}</Badge>,
    },
    {
      key: "hypothetical",
      header: "Hypothetical",
      render: (t) => (
        <span
          className={`font-mono text-xs ${
            t.hypotheticalR === null
              ? "text-slate-400"
              : t.hypotheticalR > 0
                ? "text-emerald-700"
                : t.hypotheticalR < 0
                  ? "text-rose-700"
                  : "text-slate-700"
          }`}
        >
          {fmtR(t.hypotheticalR)}
        </span>
      ),
    },
    {
      key: "evaluated",
      header: "Evaluated through",
      render: (t) =>
        t.evaluatedThrough ? (
          <span className="text-[11px] text-slate-600">
            {formatRelative(t.evaluatedThrough)}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">pending</span>
        ),
    },
    {
      key: "detail",
      header: "Detail",
      render: (t) => (
        <span className="text-[11px] text-slate-700">
          {t.reasonDetail ? t.reasonDetail.slice(0, 120) : "—"}
          {t.reasonDetail && t.reasonDetail.length > 120 ? "…" : ""}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Learning · Missed trades"
        description="Setups the detector emitted but we did not action. Hypothetical R is backfilled after a closed window, giving the learning agent a signal for systematic leaks."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Reason
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={reason}
            onChange={(e) =>
              setReason((e.target.value || "") as MissedTradeReason | "")
            }
          >
            <option value="">(any)</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Symbol ID
          <input
            type="text"
            value={symbolId}
            onChange={(e) => setSymbolId(e.target.value)}
            placeholder="(any)"
            className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Window mean R
          </div>
          <div
            className={`mt-1 font-mono text-xl font-semibold ${
              windowMean === null
                ? "text-slate-500"
                : windowMean > 0
                  ? "text-emerald-700"
                  : windowMean < 0
                    ? "text-rose-700"
                    : "text-slate-700"
            }`}
          >
            {fmtR(windowMean)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Mean hypothetical R across the current filter. A positive value
            means the misses would have been profitable — prime learning
            targets.
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Total missed
          </div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
            {total}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Matching the current filter. Showing {rows.length} below.
          </p>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Reason breakdown
          </div>
          <ul className="mt-2 space-y-1">
            {reasonCounts.length === 0 ? (
              <li className="text-[11px] text-slate-400">—</li>
            ) : (
              reasonCounts.map(([r, n]) => (
                <li
                  key={r}
                  className="flex items-center justify-between text-[11px]"
                >
                  <Badge tone={REASON_TONE[r]}>{r.replaceAll("_", " ")}</Badge>
                  <span className="font-mono text-slate-700">{n}</span>
                </li>
              ))
            )}
          </ul>
        </article>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={missedQuery.isLoading}
        error={missedQuery.error ? pickErrorMessage(missedQuery.error) : null}
        emptyMessage="No missed trades match this filter"
        rowKey={(t) => t.id}
      />

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/intel/recall" className="text-sky-700 hover:underline">
          Intelligence · Recall
        </Link>{" "}
        to find similar past setups, and{" "}
        <Link href="/intel/calibration" className="text-sky-700 hover:underline">
          Intelligence · Calibration
        </Link>{" "}
        to tune the confidence threshold.
      </p>
    </section>
  );
}
