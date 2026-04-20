"use client";

/**
 * Quant Lab · Replay — Phase 5 surface.
 *
 * Wires the control-plane quant replay routes from
 * services/control_plane/app/routes/replay_v5.py:
 *
 *   GET   /v1/quant/replay              → ReplayRunsListOut
 *   POST  /v1/quant/replay              → ReplayRun (admin only)
 *   POST  /v1/quant/replay/:id/cancel   → ReplayRun (admin only)
 *
 * Replay is the "time-travel" sibling of backtest. Instead of realising
 * PnL over a window, it plays the market tick-by-tick against the
 * frozen detector so operators can see what GodsView *would* have done
 * at each frame. The page provides a queue + launcher; deep-dive into
 * frames lives on the replay detail view (follow-up PR).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { ReplayRun, ReplayRunRequest, ReplayStatus, Timeframe } from "@gv/types";

const STATUS_TONE: Record<
  ReplayStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  queued: "info",
  streaming: "info",
  completed: "success",
  failed: "danger",
  cancelled: "warn",
};

const REPLAY_STATUSES: ReadonlyArray<ReplayStatus> = [
  "queued",
  "streaming",
  "completed",
  "failed",
  "cancelled",
];

const TIMEFRAMES: ReadonlyArray<Timeframe> = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

export default function QuantReplayPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ReplayStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    setupId: string;
    symbolId: string;
    startAt: string;
    endAt: string;
    tf: Timeframe;
    stepMs: number;
    withLiveGate: boolean;
  }>({
    setupId: "",
    symbolId: "",
    startAt: "",
    endAt: "",
    tf: "5m",
    stepMs: 0,
    withLiveGate: false,
  });

  const listQuery = useQuery({
    queryKey: ["quant-replay", "list", statusFilter],
    queryFn: () =>
      api.quantReplay.list(
        statusFilter ? { status: statusFilter, limit: 50 } : { limit: 50 },
      ),
    refetchInterval: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: (req: ReplayRunRequest) => api.quantReplay.create(req),
    onSuccess: () => {
      setCreateOpen(false);
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["quant-replay"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.quantReplay.cancel(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quant-replay"] });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<ReplayRun>> = [
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
      key: "target",
      header: "Target",
      render: (r) => {
        if (r.request.setupId) {
          return (
            <Link
              href={`/intel/setups/${encodeURIComponent(r.request.setupId)}`}
              className="font-mono text-xs text-sky-700 hover:underline"
            >
              setup {r.request.setupId.slice(0, 10)}…
            </Link>
          );
        }
        return (
          <span className="font-mono text-xs text-slate-700">
            {r.request.symbolId ?? "—"}
          </span>
        );
      },
    },
    {
      key: "tf",
      header: "TF",
      render: (r) => (
        <Badge tone="neutral">{r.request.tf}</Badge>
      ),
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
      key: "liveGate",
      header: "Gate",
      render: (r) =>
        r.request.withLiveGate ? (
          <Badge tone="info">live-gate on</Badge>
        ) : (
          <Badge tone="neutral">off</Badge>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: "frames",
      header: "Frames",
      render: (r) => (
        <span className="font-mono text-xs text-slate-700">{r.totalFrames}</span>
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
        const canCancel = r.status === "queued" || r.status === "streaming";
        const busy =
          cancelMutation.isPending && cancelMutation.variables === r.id;
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

  const rows = useMemo(() => listQuery.data?.runs ?? [], [listQuery.data]);
  const total = listQuery.data?.total ?? 0;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Quant Lab · Replay"
        description="Candle-by-candle replay engine. Rewind any session and ask 'what would GodsView do here?' with full detector + live-gate provenance."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs font-medium text-slate-700">
          Status
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter((e.target.value || "") as ReplayStatus | "")
            }
          >
            <option value="">(any)</option>
            {REPLAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant={createOpen ? "ghost" : "primary"}
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? "Close" : "New replay"}
        </Button>
      </div>

      {createOpen ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Queue a replay
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Admin-only. Provide either a setupId OR a symbolId — the
            replay centres on the former or scans the latter over the
            chosen window.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Setup ID (optional)
              <input
                type="text"
                value={form.setupId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, setupId: e.target.value }))
                }
                placeholder="setup_… or leave empty"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Symbol ID (optional)
              <input
                type="text"
                value={form.symbolId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, symbolId: e.target.value }))
                }
                placeholder="sym_ES_cme or leave empty"
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
                placeholder="2024-06-01T13:00:00Z"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              End (ISO)
              <input
                type="text"
                value={form.endAt}
                onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                placeholder="2024-06-01T20:00:00Z"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Timeframe
              <select
                value={form.tf}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tf: e.target.value as Timeframe }))
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Step delay (ms)
              <input
                type="number"
                min={0}
                max={60_000}
                value={form.stepMs}
                onChange={(e) =>
                  setForm((f) => ({ ...f, stepMs: Number(e.target.value) }))
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="mt-0.5 block text-[10px] text-slate-500">
                0 = run as fast as possible; &gt; 0 streams via SSE.
              </span>
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.withLiveGate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, withLiveGate: e.target.checked }))
                }
                className="mr-2"
              />
              Evaluate the live gate at each frame (simulates governance + risk)
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
                if (!form.setupId.trim() && !form.symbolId.trim()) {
                  setCreateError("Provide either setupId or symbolId");
                  return;
                }
                if (!form.startAt.trim() || !form.endAt.trim()) {
                  setCreateError("Start and end timestamps are required");
                  return;
                }
                const req: ReplayRunRequest = {
                  startAt: form.startAt.trim(),
                  endAt: form.endAt.trim(),
                  tf: form.tf,
                  stepMs: form.stepMs,
                  withLiveGate: form.withLiveGate,
                };
                if (form.setupId.trim()) req.setupId = form.setupId.trim();
                if (form.symbolId.trim()) req.symbolId = form.symbolId.trim();
                createMutation.mutate(req);
              }}
            >
              Enqueue
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={listQuery.isLoading}
        error={listQuery.error ? pickErrorMessage(listQuery.error) : null}
        emptyMessage="No replay runs match this filter"
        rowKey={(r) => r.id}
      />

      {listQuery.data ? (
        <p className="text-xs text-slate-500">
          Showing {rows.length} of {total} runs.
        </p>
      ) : null}
    </section>
  );
}
