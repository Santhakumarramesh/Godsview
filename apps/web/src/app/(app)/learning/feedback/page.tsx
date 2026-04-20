"use client";

/**
 * Learning · Feedback loop — Phase 5 surface.
 *
 * Wires the learning event bus served by
 * services/control_plane/app/routes/learning.py:
 *
 *   GET /v1/learning/events → LearningEventsListOut
 *
 * The page is a tail-of-the-bus viewer. Operators can filter by event
 * kind, subject kind, and strategy id to understand what the learning
 * worker has been reacting to — every trade outcome, calibration
 * refresh, regime flip, data-truth breach, and promotion flows through
 * here.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  LearningEvent,
  LearningEventFilter,
  LearningEventKind,
} from "@gv/types";

type SubjectKind = LearningEvent["subjectKind"];

const KIND_TONE: Record<
  LearningEventKind,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  setup_detected: "neutral",
  setup_approved: "info",
  setup_rejected: "warn",
  trade_opened: "info",
  trade_closed_win: "success",
  trade_closed_loss: "danger",
  trade_closed_scratch: "neutral",
  backtest_completed: "info",
  calibration_updated: "info",
  regime_flipped: "warn",
  data_truth_breach: "danger",
  promotion_auto_demote: "warn",
  promotion_manual: "info",
};

const EVENT_KINDS: ReadonlyArray<LearningEventKind> = [
  "setup_detected",
  "setup_approved",
  "setup_rejected",
  "trade_opened",
  "trade_closed_win",
  "trade_closed_loss",
  "trade_closed_scratch",
  "backtest_completed",
  "calibration_updated",
  "regime_flipped",
  "data_truth_breach",
  "promotion_auto_demote",
  "promotion_manual",
];

const SUBJECT_KINDS: ReadonlyArray<SubjectKind> = [
  "setup",
  "paper_trade",
  "live_trade",
  "backtest",
  "strategy",
  "calibration",
  "regime",
  "data_truth",
];

function summarisePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return "(empty)";
  const preview = keys
    .slice(0, 3)
    .map((k) => {
      const v = payload[k];
      if (v === null || v === undefined) return `${k}=∅`;
      if (typeof v === "string")
        return `${k}=${v.length > 24 ? v.slice(0, 24) + "…" : v}`;
      if (typeof v === "number") return `${k}=${v.toFixed(3)}`;
      if (typeof v === "boolean") return `${k}=${v}`;
      return `${k}=[obj]`;
    })
    .join(" · ");
  return keys.length > 3 ? `${preview} …(+${keys.length - 3})` : preview;
}

export default function LearningFeedbackPage() {
  const [kind, setKind] = useState<LearningEventKind | "">("");
  const [subjectKind, setSubjectKind] = useState<SubjectKind | "">("");
  const [strategyId, setStrategyId] = useState("");

  const filter: LearningEventFilter = useMemo(() => {
    const f: LearningEventFilter = { limit: 200 };
    if (kind) f.kind = kind;
    if (subjectKind) f.subjectKind = subjectKind;
    if (strategyId.trim()) f.strategyId = strategyId.trim();
    return f;
  }, [kind, subjectKind, strategyId]);

  const eventsQuery = useQuery({
    queryKey: ["learning", "events", filter],
    queryFn: () => api.learning.listEvents(filter),
    refetchInterval: 15_000,
  });

  const columns: ReadonlyArray<DataTableColumn<LearningEvent>> = [
    {
      key: "kind",
      header: "Kind",
      render: (e) => (
        <Badge tone={KIND_TONE[e.kind]}>{e.kind.replaceAll("_", " ")}</Badge>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      render: (e) => (
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {e.subjectKind}
          </span>
          <code className="font-mono text-xs text-slate-700">
            {e.subjectId.slice(0, 14)}…
          </code>
        </div>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (e) =>
        e.strategyId ? (
          <Link
            href={`/strategies/active?id=${encodeURIComponent(e.strategyId)}`}
            className="font-mono text-xs text-sky-700 hover:underline"
          >
            {e.strategyId.slice(0, 12)}…
          </Link>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "payload",
      header: "Payload",
      render: (e) => (
        <span className="font-mono text-[11px] text-slate-700">
          {summarisePayload(e.payload)}
        </span>
      ),
    },
    {
      key: "correlation",
      header: "Corr",
      render: (e) =>
        e.correlationId ? (
          <code className="font-mono text-[10px] text-slate-500">
            {e.correlationId.slice(0, 8)}…
          </code>
        ) : (
          <span className="text-[10px] text-slate-400">—</span>
        ),
    },
    {
      key: "occurredAt",
      header: "Occurred",
      render: (e) => (
        <div className="flex flex-col text-[11px] text-slate-700">
          <span>{formatDate(e.occurredAt)}</span>
          <span className="text-[10px] text-slate-500">
            {formatRelative(e.occurredAt)}
          </span>
        </div>
      ),
    },
    {
      key: "ingestedAt",
      header: "Ingested",
      render: (e) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(e.ingestedAt)}
        </span>
      ),
    },
  ];

  const rows = eventsQuery.data?.events ?? [];
  const total = eventsQuery.data?.total ?? 0;

  const kindCounts = useMemo(() => {
    const out = new Map<LearningEventKind, number>();
    for (const e of rows) out.set(e.kind, (out.get(e.kind) ?? 0) + 1);
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Learning · Feedback loop"
        description="Tail of the learning event bus. Every trade outcome, calibration refresh, regime flip, data-truth breach, and promotion is appended here and consumed by the learning worker in strict occurredAt order."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Kind
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={kind}
            onChange={(e) =>
              setKind((e.target.value || "") as LearningEventKind | "")
            }
          >
            <option value="">(any)</option>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Subject kind
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={subjectKind}
            onChange={(e) =>
              setSubjectKind((e.target.value || "") as SubjectKind | "")
            }
          >
            <option value="">(any)</option>
            {SUBJECT_KINDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Strategy ID
          <input
            type="text"
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            placeholder="(any)"
            className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
      </div>

      {kindCounts.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {kindCounts.map(([k, n]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5"
            >
              <Badge tone={KIND_TONE[k]}>{k.replaceAll("_", " ")}</Badge>
              <span className="font-mono text-slate-700">{n}</span>
            </span>
          ))}
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={eventsQuery.isLoading}
        error={eventsQuery.error ? pickErrorMessage(eventsQuery.error) : null}
        emptyMessage="No learning events match this filter"
        rowKey={(e) => e.id}
      />

      {eventsQuery.data ? (
        <p className="text-xs text-slate-500">
          Showing {rows.length} of {total} events. Feeds{" "}
          <Link href="/intel/calibration" className="text-sky-700 hover:underline">
            Intelligence · Calibration
          </Link>
          ,{" "}
          <Link href="/research/regimes" className="text-sky-700 hover:underline">
            Research · Regimes
          </Link>
          , and{" "}
          <Link href="/strategies/promotions" className="text-sky-700 hover:underline">
            Strategies · Promotions
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
