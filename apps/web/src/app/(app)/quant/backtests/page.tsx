"use client";

/**
 * Quant Lab · Backtests — Phase 5 surface.
 *
 * Wires the control-plane routes from
 * services/control_plane/app/routes/quant_lab.py:
 *
 *   GET   /v1/quant/backtests                  → BacktestsListOut
 *   POST  /v1/quant/backtests                  → BacktestRun (admin only)
 *   POST  /v1/quant/backtests/:id/cancel       → BacktestRun (admin only)
 *
 * A BacktestRun is deterministic: given the same strategyVersionId,
 * symbolIds, window, and friction/latency model, reruns produce
 * bit-identical metrics. The list page polls for status updates so
 * "queued" → "running" → "completed" animates without a manual refresh.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type {
  BacktestFilter,
  BacktestRequest,
  BacktestRun,
  BacktestStatus,
} from "@gv/types";

const STATUS_TONE: Record<
  BacktestStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  queued: "info",
  running: "info",
  completed: "success",
  failed: "danger",
  cancelled: "warn",
};

const BACKTEST_STATUSES: ReadonlyArray<BacktestStatus> = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];

function fmtNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(digits);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export default function QuantBacktestsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<BacktestStatus | "">("");
  const [strategyId, setStrategyId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({
    strategyVersionId: "",
    symbolIds: "",
    startAt: "",
    endAt: "",
    frictionBps: 5,
    latencyMs: 100,
    startingEquity: 100_000,
    seed: 0,
  });

  const filter: BacktestFilter = useMemo(() => {
    const f: BacktestFilter = { limit: 50 };
    if (status) f.status = status;
    if (strategyId.trim()) f.strategyId = strategyId.trim();
    return f;
  }, [status, strategyId]);

  const backtestsQuery = useQuery({
    queryKey: ["backtests", "list", filter],
    queryFn: () => api.backtests.list(filter),
    refetchInterval: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: (req: BacktestRequest) => api.backtests.create(req),
    onSuccess: () => {
      setCreateError(null);
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["backtests"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.backtests.cancel(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["backtests"] });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<BacktestRun>> = [
    {
      key: "id",
      header: "Run",
      render: (r) => (
        <code className="font-mono text-xs text-slate-900">
          {r.id.slice(0, 10)}…
        </code>
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
          {r.strategyId.slice(0, 10)}…
        </Link>
      ),
    },
    {
      key: "version",
      header: "Version",
      render: (r) => (
        <code className="font-mono text-[10px] text-slate-500">
          {r.strategyVersionId.slice(0, 8)}…
        </code>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: "window",
      header: "Window",
      render: (r) => (
        <div className="text-[10px] text-slate-600">
          <div>{formatDate(r.request.startAt)}</div>
          <div>→ {formatDate(r.request.endAt)}</div>
        </div>
      ),
    },
    {
      key: "symbols",
      header: "Symbols",
      render: (r) => (
        <span className="font-mono text-xs text-slate-700">
          {r.request.symbolIds.length}
        </span>
      ),
    },
    {
      key: "metrics",
      header: "Expectancy (R)",
      render: (r) => {
        if (!r.metrics) {
          return <span className="text-xs text-slate-400">—</span>;
        }
        const cls =
          r.metrics.expectancyR > 0
            ? "text-emerald-700"
            : r.metrics.expectancyR < 0
              ? "text-rose-700"
              : "text-slate-700";
        return (
          <span className={`font-mono text-xs ${cls}`}>
            {r.metrics.expectancyR > 0 ? "+" : ""}
            {fmtNumber(r.metrics.expectancyR, 3)}R
          </span>
        );
      },
    },
    {
      key: "winRate",
      header: "Win rate",
      render: (r) =>
        r.metrics ? (
          <span className="font-mono text-xs text-slate-700">
            {fmtPct(r.metrics.winRate)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "sharpe",
      header: "Sharpe",
      render: (r) =>
        r.metrics ? (
          <span className="font-mono text-xs text-slate-700">
            {fmtNumber(r.metrics.sharpe, 2)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "maxDD",
      header: "Max DD",
      render: (r) =>
        r.metrics ? (
          <span className="font-mono text-xs text-rose-700">
            {fmtNumber(r.metrics.maxDrawdownR, 2)}R
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (r) => formatDate(r.createdAt),
    },
    {
      key: "actions",
      header: "",
      render: (r) => {
        const canCancel = r.status === "queued" || r.status === "running";
        const busy = cancelMutation.isPending && cancelMutation.variables === r.id;
        return canCancel ? (
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onClick={() => cancelMutation.mutate(r.id)}
          >
            Cancel
          </Button>
        ) : null;
      },
    },
  ];

  const rows = backtestsQuery.data?.runs ?? [];
  const total = backtestsQuery.data?.total ?? 0;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Quant Lab · Backtests"
        description="Multi-timeframe backtest runner with realistic fills, slippage, latency modeling, and deterministic reruns. All runs are audit-trailed."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Status
            <select
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              value={status}
              onChange={(e) =>
                setStatus((e.target.value || "") as BacktestStatus | "")
              }
            >
              <option value="">(any)</option>
              {BACKTEST_STATUSES.map((s) => (
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
        <Button
          size="sm"
          variant={createOpen ? "ghost" : "primary"}
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? "Close" : "New backtest"}
        </Button>
      </div>

      {createOpen ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Queue a new backtest
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Admin-only. The request is frozen at enqueue — reruns of the
            same request are bit-identical.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Strategy version ID
              <input
                type="text"
                value={form.strategyVersionId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, strategyVersionId: e.target.value }))
                }
                placeholder="stratver_…"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Symbol IDs (comma-separated)
              <input
                type="text"
                value={form.symbolIds}
                onChange={(e) =>
                  setForm((f) => ({ ...f, symbolIds: e.target.value }))
                }
                placeholder="ES,NQ,AAPL"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Start (ISO)
              <input
                type="text"
                value={form.startAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startAt: e.target.value }))
                }
                placeholder="2024-01-01T00:00:00Z"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              End (ISO)
              <input
                type="text"
                value={form.endAt}
                onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                placeholder="2024-12-31T23:59:59Z"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Friction (bps)
              <input
                type="number"
                min={0}
                max={200}
                value={form.frictionBps}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    frictionBps: Number(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Latency (ms)
              <input
                type="number"
                min={0}
                max={10_000}
                value={form.latencyMs}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    latencyMs: Number(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Starting equity
              <input
                type="number"
                min={1}
                value={form.startingEquity}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startingEquity: Number(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Seed
              <input
                type="number"
                min={0}
                value={form.seed}
                onChange={(e) =>
                  setForm((f) => ({ ...f, seed: Number(e.target.value) }))
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
          {createError ? (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {createError}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              loading={createMutation.isPending}
              onClick={() => {
                const symbolIds = form.symbolIds
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (!form.strategyVersionId.trim()) {
                  setCreateError("strategyVersionId is required");
                  return;
                }
                if (symbolIds.length === 0) {
                  setCreateError("At least one symbol id is required");
                  return;
                }
                if (!form.startAt.trim() || !form.endAt.trim()) {
                  setCreateError("Start and end timestamps are required");
                  return;
                }
                createMutation.mutate({
                  strategyVersionId: form.strategyVersionId.trim(),
                  symbolIds,
                  startAt: form.startAt.trim(),
                  endAt: form.endAt.trim(),
                  frictionBps: form.frictionBps,
                  latencyMs: form.latencyMs,
                  startingEquity: form.startingEquity,
                  seed: form.seed,
                });
              }}
            >
              Enqueue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={backtestsQuery.isLoading}
        error={
          backtestsQuery.error ? pickErrorMessage(backtestsQuery.error) : null
        }
        emptyMessage="No backtest runs match this filter"
        rowKey={(r) => r.id}
      />

      {backtestsQuery.data ? (
        <p className="text-xs text-slate-500">
          Showing {rows.length} of {total} runs.
        </p>
      ) : null}
    </section>
  );
}
