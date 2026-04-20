"use client";

/**
 * Learning · Drift — Phase 5 surface.
 *
 * Wires two control-plane routes:
 *
 *   GET  /v1/regime/history                          → RegimeHistoryOut
 *   GET  /v1/data-truth/status                       → DataTruthStatusOut
 *   POST /v1/data-truth/kill-switch/reset            → DataTruthStatusOut
 *
 * The page exposes two sibling concerns that both feed the governance
 * gate: market-regime drift (what's the market doing right now, and how
 * has the verdict moved in the last N bars?) and data-truth health
 * (are feeds honest? is the kill-switch tripped?). When data-truth is
 * red the promotion FSM will unconditionally reject new live approvals.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  DataTruthCheck,
  DataTruthStatus,
  RegimeHistoryFilter,
  RegimeKind,
  RegimeSnapshot,
  Timeframe,
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

const DATA_TRUTH_TONE: Record<
  DataTruthStatus,
  "success" | "warn" | "danger"
> = {
  green: "success",
  amber: "warn",
  red: "danger",
};

const TIMEFRAMES: ReadonlyArray<Timeframe> = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

export default function LearningDriftPage() {
  const qc = useQueryClient();
  const [symbolId, setSymbolId] = useState("");
  const [tf, setTf] = useState<Timeframe>("5m");
  const [resetReason, setResetReason] = useState("");

  // ─────────── regime history ───────────
  const historyFilter: RegimeHistoryFilter | null = useMemo(() => {
    if (!symbolId.trim()) return null;
    return { symbolId: symbolId.trim(), tf, limit: 200 };
  }, [symbolId, tf]);

  const historyQuery = useQuery({
    queryKey: ["regime", "history", historyFilter],
    enabled: !!historyFilter,
    queryFn: () =>
      historyFilter
        ? api.regime.history(historyFilter)
        : Promise.resolve(null),
    refetchInterval: 30_000,
  });

  // ─────────── data truth ───────────
  const statusQuery = useQuery({
    queryKey: ["data-truth", "status"],
    queryFn: () => api.dataTruth.status(),
    refetchInterval: 10_000,
  });

  const resetMutation = useMutation({
    mutationFn: (reason: string) => api.dataTruth.resetKillSwitch(reason),
    onSuccess: () => {
      setResetReason("");
      void qc.invalidateQueries({ queryKey: ["data-truth"] });
    },
  });

  const regimeColumns: ReadonlyArray<DataTableColumn<RegimeSnapshot>> = [
    {
      key: "observedAt",
      header: "Bar",
      render: (r) => (
        <div className="flex flex-col text-[11px]">
          <span>{formatDate(r.observedAt)}</span>
          <span className="text-[10px] text-slate-500">
            {formatRelative(r.observedAt)}
          </span>
        </div>
      ),
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
      key: "trendStrength",
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
      key: "barAge",
      header: "Bar age",
      render: (r) => (
        <span className="font-mono text-[11px] text-slate-500">
          {(r.barAgeMs / 1000).toFixed(1)}s
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (r) => (
        <span className="text-[11px] text-slate-700">
          {r.notes ? r.notes.slice(0, 120) : "—"}
          {r.notes && r.notes.length > 120 ? "…" : ""}
        </span>
      ),
    },
  ];

  const dataTruthColumns: ReadonlyArray<DataTableColumn<DataTruthCheck>> = [
    {
      key: "kind",
      header: "Check",
      render: (c) => (
        <span className="font-mono text-xs text-slate-900">
          {c.kind.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <Badge tone={DATA_TRUTH_TONE[c.status]}>{c.status}</Badge>,
    },
    {
      key: "measurement",
      header: "Measurement",
      render: (c) => (
        <span className="font-mono text-xs text-slate-700">
          {c.measurement.toFixed(2)}
        </span>
      ),
    },
    {
      key: "thresholds",
      header: "Amber / Red",
      render: (c) => (
        <span className="font-mono text-[11px] text-slate-500">
          {c.amberThreshold.toFixed(2)} / {c.redThreshold.toFixed(2)}
        </span>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (c) =>
        c.symbolId ? (
          <code className="font-mono text-xs text-slate-700">
            {c.symbolId}
          </code>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "message",
      header: "Message",
      render: (c) => (
        <span className="text-xs text-slate-700">
          {c.message.slice(0, 140)}
          {c.message.length > 140 ? "…" : ""}
        </span>
      ),
    },
    {
      key: "observedAt",
      header: "Observed",
      render: (c) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(c.observedAt)}
        </span>
      ),
    },
  ];

  const snapshots = historyQuery.data?.snapshots ?? [];
  const truth = statusQuery.data;

  return (
    <section className="space-y-8">
      <PageHeader
        title="Learning · Drift"
        description="Regime drift and feed-truth health. The promotion FSM reads both — red data-truth trips the kill-switch and halts new live approvals system-wide."
      />

      {/* Data truth panel */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Data truth
            </h2>
            {truth ? (
              <Badge tone={DATA_TRUTH_TONE[truth.status]}>
                overall {truth.status}
              </Badge>
            ) : null}
            {truth?.killSwitchTripped ? (
              <Badge tone="danger">kill-switch tripped</Badge>
            ) : null}
          </div>
          {truth ? (
            <span className="text-[11px] text-slate-500">
              Generated {formatRelative(truth.generatedAt)}
            </span>
          ) : null}
        </header>

        {truth?.killSwitchTripped ? (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold text-rose-800">
              Kill-switch is active.{" "}
              {truth.killSwitchReason ? `Reason: ${truth.killSwitchReason}` : ""}
            </div>
            <p className="mt-1 text-[11px] text-rose-700">
              Live approvals are blocked. Reset below once the upstream
              condition is resolved; this writes a governance audit row.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="Resolution narrative (required)"
                className="block w-full rounded border border-rose-300 bg-white px-2 py-1 text-xs"
              />
              <Button
                size="sm"
                variant="danger"
                loading={resetMutation.isPending}
                onClick={() => {
                  if (!resetReason.trim()) return;
                  resetMutation.mutate(resetReason.trim());
                }}
              >
                Reset
              </Button>
            </div>
            {resetMutation.error ? (
              <div className="mt-2 text-[11px] text-rose-800">
                {pickErrorMessage(resetMutation.error)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4">
          <DataTable
            rows={truth?.checks ?? []}
            columns={dataTruthColumns}
            loading={statusQuery.isLoading}
            error={
              statusQuery.error ? pickErrorMessage(statusQuery.error) : null
            }
            emptyMessage="No data-truth checks reported"
            rowKey={(c) => c.id}
          />
        </div>
      </section>

      {/* Regime history panel */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Regime history
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Per (symbol, timeframe) regime verdicts emitted on each bar
              close. Drift between adjacent snapshots triggers a
              <code className="ml-1 font-mono">regime_flipped</code> learning
              event.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-700">
              Symbol ID
              <input
                type="text"
                value={symbolId}
                onChange={(e) => setSymbolId(e.target.value)}
                placeholder="sym_ES_cme"
                className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Timeframe
              <select
                value={tf}
                onChange={(e) => setTf(e.target.value as Timeframe)}
                className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="mt-4">
          {!symbolId.trim() ? (
            <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Enter a symbol ID to load its regime history.
            </div>
          ) : (
            <DataTable
              rows={snapshots}
              columns={regimeColumns}
              loading={historyQuery.isLoading}
              error={
                historyQuery.error
                  ? pickErrorMessage(historyQuery.error)
                  : null
              }
              emptyMessage="No regime snapshots for this (symbol, tf)."
              rowKey={(r) => r.id}
            />
          )}
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Calibration drift — Brier score + ECE per-bucket — lives on{" "}
        <Link href="/intel/calibration" className="text-sky-700 hover:underline">
          Intelligence · Calibration
        </Link>
        .
      </p>
    </section>
  );
}
