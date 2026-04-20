"use client";

/**
 * Quant Lab · Experiments — Phase 5 surface.
 *
 * Surfaces the control-plane routes from
 * services/control_plane/app/routes/quant_lab.py:
 *
 *   GET    /v1/quant/experiments              → ExperimentsListOut
 *   POST   /v1/quant/experiments              → Experiment (admin only)
 *   POST   /v1/quant/experiments/:id/complete → Experiment (admin only)
 *
 * An experiment freezes a hypothesis ("does raising minConfidence from
 * 0.6 to 0.7 improve expectancy in trending regimes?") and gathers a
 * set of BacktestRun ids that answer it. Completion writes a verdict
 * + winning-backtest pointer, turning the experiment into a frozen
 * research artefact.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
} from "@gv/types";

const STATUS_TONE: Record<
  ExperimentStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  draft: "neutral",
  running: "info",
  completed: "success",
  cancelled: "warn",
};

const EXPERIMENT_STATUSES: ReadonlyArray<ExperimentStatus> = [
  "draft",
  "running",
  "completed",
  "cancelled",
];

export default function QuantExperimentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ExperimentStatus | "">("");
  const [strategyId, setStrategyId] = useState("");
  const [newName, setNewName] = useState("");
  const [newHypothesis, setNewHypothesis] = useState("");
  const [newStrategyId, setNewStrategyId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [verdictFor, setVerdictFor] = useState<string | null>(null);
  const [verdictText, setVerdictText] = useState("");
  const [verdictWinner, setVerdictWinner] = useState("");

  const filter: ExperimentFilter = useMemo(() => {
    const f: ExperimentFilter = { limit: 50 };
    if (status) f.status = status;
    if (strategyId.trim()) f.strategyId = strategyId.trim();
    return f;
  }, [status, strategyId]);

  const experimentsQuery = useQuery({
    queryKey: ["experiments", "list", filter],
    queryFn: () => api.experiments.list(filter),
    refetchInterval: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: (req: {
      name: string;
      hypothesis: string;
      strategyId: string;
    }) => api.experiments.create(req),
    onSuccess: () => {
      setCreateError(null);
      setNewName("");
      setNewHypothesis("");
      setNewStrategyId("");
      void qc.invalidateQueries({ queryKey: ["experiments"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const completeMutation = useMutation({
    mutationFn: ({
      id,
      verdict,
      winningBacktestId,
    }: {
      id: string;
      verdict: string;
      winningBacktestId: string | null;
    }) => api.experiments.complete(id, { winningBacktestId, verdict }),
    onSuccess: () => {
      setVerdictFor(null);
      setVerdictText("");
      setVerdictWinner("");
      void qc.invalidateQueries({ queryKey: ["experiments"] });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<Experiment>> = [
    {
      key: "name",
      header: "Experiment",
      render: (e) => (
        <div>
          <div className="font-medium text-slate-900">{e.name}</div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-500">
            {e.id.slice(0, 10)}…
          </div>
        </div>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (e) => (
        <Link
          href={`/strategies/active?id=${encodeURIComponent(e.strategyId)}`}
          className="font-mono text-xs text-sky-700 hover:underline"
        >
          {e.strategyId.slice(0, 10)}…
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (e) => <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>,
    },
    {
      key: "backtests",
      header: "Backtests",
      render: (e) => (
        <span className="font-mono text-xs text-slate-700">
          {e.backtestIds.length}
        </span>
      ),
    },
    {
      key: "hypothesis",
      header: "Hypothesis",
      render: (e) => (
        <span className="text-xs text-slate-700">
          {e.hypothesis ? e.hypothesis.slice(0, 120) : "—"}
          {e.hypothesis && e.hypothesis.length > 120 ? "…" : ""}
        </span>
      ),
    },
    {
      key: "verdict",
      header: "Verdict",
      render: (e) =>
        e.verdict ? (
          <span className="text-xs text-slate-800">
            {e.verdict.slice(0, 100)}
            {e.verdict.length > 100 ? "…" : ""}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (e) => formatDate(e.createdAt),
    },
    {
      key: "actions",
      header: "",
      render: (e) => {
        if (e.status === "completed" || e.status === "cancelled") {
          return null;
        }
        return (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setVerdictFor(e.id);
              setVerdictText("");
              setVerdictWinner(e.backtestIds[0] ?? "");
            }}
          >
            Complete
          </Button>
        );
      },
    },
  ];

  const rows = experimentsQuery.data?.experiments ?? [];
  const total = experimentsQuery.data?.total ?? 0;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Quant Lab · Experiments"
        description="Hypothesis-driven comparisons over BacktestRuns. A completed experiment writes a verdict + winning-run pointer, freezing the research record."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Status
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={status}
            onChange={(e) =>
              setStatus((e.target.value || "") as ExperimentStatus | "")
            }
          >
            <option value="">(any)</option>
            {EXPERIMENT_STATUSES.map((s) => (
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

      <DataTable
        rows={rows}
        columns={columns}
        loading={experimentsQuery.isLoading}
        error={
          experimentsQuery.error ? pickErrorMessage(experimentsQuery.error) : null
        }
        emptyMessage="No experiments match this filter"
        rowKey={(e) => e.id}
      />

      {experimentsQuery.data ? (
        <p className="text-xs text-slate-500">
          Showing {rows.length} of {total} experiments.
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          New experiment
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Admin-only. Creates an empty experiment in the <code>draft</code>{" "}
          state; attach backtest runs via the detail view.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Name
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Raise min-confidence to 0.7"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Strategy ID
            <input
              type="text"
              value={newStrategyId}
              onChange={(e) => setNewStrategyId(e.target.value)}
              placeholder="strategy_…"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="md:col-span-2 text-xs font-medium text-slate-700">
            Hypothesis
            <textarea
              value={newHypothesis}
              onChange={(e) => setNewHypothesis(e.target.value)}
              rows={3}
              placeholder="A falsifiable statement the backtest can prove or disprove."
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
        {createError ? (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
            {createError}
          </div>
        ) : null}
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => {
              if (!newName.trim() || !newStrategyId.trim()) {
                setCreateError("Name and strategy id are required");
                return;
              }
              createMutation.mutate({
                name: newName.trim(),
                hypothesis: newHypothesis.trim(),
                strategyId: newStrategyId.trim(),
              });
            }}
            loading={createMutation.isPending}
          >
            Create experiment
          </Button>
        </div>
      </section>

      {verdictFor ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Complete experiment{" "}
            <code className="font-mono text-xs text-slate-600">
              {verdictFor.slice(0, 10)}…
            </code>
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Winning backtest ID (optional)
              <input
                type="text"
                value={verdictWinner}
                onChange={(e) => setVerdictWinner(e.target.value)}
                placeholder="backtest_… or leave empty"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="md:col-span-2 text-xs font-medium text-slate-700">
              Verdict narrative
              <textarea
                value={verdictText}
                onChange={(e) => setVerdictText(e.target.value)}
                rows={3}
                placeholder="Short, specific, falsifiable. Becomes the frozen research record."
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              loading={completeMutation.isPending}
              onClick={() =>
                completeMutation.mutate({
                  id: verdictFor,
                  verdict: verdictText.trim() || "(no verdict text)",
                  winningBacktestId:
                    verdictWinner.trim() === ""
                      ? null
                      : verdictWinner.trim(),
                })
              }
            >
              Finalise
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setVerdictFor(null);
                setVerdictText("");
                setVerdictWinner("");
              }}
            >
              Cancel
            </Button>
          </div>
          {completeMutation.error ? (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {pickErrorMessage(completeMutation.error)}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
