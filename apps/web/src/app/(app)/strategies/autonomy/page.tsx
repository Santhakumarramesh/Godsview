"use client";

/**
 * Strategies · Autonomy — Phase 6 surface.
 *
 * Autonomy is the promotion-ceiling layer that sits above the Phase 5
 * strategy FSM. A record lands in `assisted_live` after the Phase 5
 * promotion pipeline approves it; from there the engine auto-advances
 * to `autonomous_candidate` once the three gates are green (DNA rollups
 * clear, calibration drift under tolerance, sample-size floor met).
 * Graduation to `autonomous` is the only transition that is never
 * automatic — it always requires a paired governance approval
 * (`strategy_autonomous_promote`).
 *
 * Backed by services/control_plane/app/routes/autonomy.py:
 *
 *   GET  /v1/autonomy/records                     → list
 *   GET  /v1/autonomy/records/:id                 → detail
 *   GET  /v1/autonomy/records/:id/history         → append-only trail
 *   POST /v1/autonomy/records/:id/transition      → FSM mutation (admin)
 *   POST /v1/autonomy/records/:id/recompute       → gate snapshot refresh
 *
 * Deep-link: ?id=<strategyId> preselects a record so links from other
 * surfaces (Active catalog, Governance · Approvals) land straight on
 * the row.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  AutonomyGateStatus,
  AutonomyHistoryEvent,
  AutonomyRecord,
  AutonomyReason,
  AutonomyState,
  AutonomyTransitionAction,
} from "@gv/types";

const STATE_TONE: Record<
  AutonomyState,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  assisted_live: "info",
  autonomous_candidate: "warn",
  autonomous: "success",
  overridden: "warn",
  suspended: "danger",
};

const STATE_LABEL: Record<AutonomyState, string> = {
  assisted_live: "assisted live",
  autonomous_candidate: "autonomous candidate",
  autonomous: "autonomous",
  overridden: "overridden",
  suspended: "suspended",
};

const GATE_TONE: Record<
  AutonomyGateStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  passing: "success",
  watch: "warn",
  failing: "danger",
  unknown: "neutral",
};

const REASON_LABEL: Record<AutonomyReason, string> = {
  initial_promotion: "initial promotion",
  gates_green: "gates green",
  governance_approved: "governance approved",
  governance_rejected: "governance rejected",
  operator_override: "operator override",
  operator_suspend: "operator suspend",
  operator_resume: "operator resume",
  anomaly_trip: "anomaly trip",
  calibration_regression: "calibration regression",
  dna_regression: "DNA regression",
  sample_size_regression: "sample size regression",
  manual_demote: "manual demote",
  kill_switch_active: "kill switch active",
};

const ACTION_OPTIONS: ReadonlyArray<{
  value: AutonomyTransitionAction;
  label: string;
  description: string;
}> = [
  {
    value: "promote",
    label: "Promote",
    description: "assisted_live → candidate → autonomous (autonomous requires approval)",
  },
  {
    value: "demote",
    label: "Demote",
    description: "autonomous → assisted_live",
  },
  {
    value: "override",
    label: "Override",
    description: "* → overridden (operator pause, reversible)",
  },
  {
    value: "suspend",
    label: "Suspend",
    description: "* → suspended (system halt, reversible)",
  },
  {
    value: "resume",
    label: "Resume",
    description: "overridden | suspended → assisted_live",
  },
];

const STATE_FILTER_OPTIONS: ReadonlyArray<AutonomyState> = [
  "assisted_live",
  "autonomous_candidate",
  "autonomous",
  "overridden",
  "suspended",
];

function transitionTone(
  from: AutonomyState | null,
  to: AutonomyState,
): { tone: "neutral" | "info" | "success" | "warn" | "danger"; label: string } {
  if (to === "suspended") return { tone: "danger", label: "suspend" };
  if (to === "overridden") return { tone: "warn", label: "override" };
  if (from === null) return { tone: "info", label: "initial" };
  const rank: Record<AutonomyState, number> = {
    assisted_live: 1,
    autonomous_candidate: 2,
    autonomous: 3,
    overridden: 0,
    suspended: 0,
  };
  const f = rank[from];
  const t = rank[to];
  if (t > f) return { tone: "success", label: "promote" };
  if (t < f) return { tone: "danger", label: "demote" };
  return { tone: "neutral", label: "transition" };
}

export default function StrategiesAutonomyPage() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("id") ?? "";
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;
  const qc = useQueryClient();

  const [strategyId, setStrategyId] = useState(initial);
  const [stateFilter, setStateFilter] = useState<AutonomyState | "">("");
  const [action, setAction] = useState<AutonomyTransitionAction | "">("");
  const [reason, setReason] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (initial && initial !== strategyId) setStrategyId(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const listQ = useQuery({
    queryKey: ["autonomy", "list", { state: stateFilter || undefined }],
    queryFn: () =>
      api.autonomy.list({
        state: stateFilter || undefined,
        limit: 200,
      }),
    refetchInterval: 30_000,
  });

  const recordQ = useQuery({
    queryKey: ["autonomy", "record", strategyId],
    enabled: !!strategyId,
    queryFn: () =>
      strategyId ? api.autonomy.get(strategyId) : Promise.resolve(null),
    refetchInterval: strategyId ? 15_000 : false,
  });

  const historyQ = useQuery({
    queryKey: ["autonomy", "history", strategyId],
    enabled: !!strategyId,
    queryFn: () =>
      strategyId
        ? api.autonomy.history(strategyId, { limit: 100 })
        : Promise.resolve(null),
    refetchInterval: strategyId ? 30_000 : false,
  });

  const transitionMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      body: {
        strategyId: string;
        action: AutonomyTransitionAction;
        reason: string;
        approvalId?: string | null;
      };
    }) => api.autonomy.transition(vars.id, vars.body),
    onSuccess: (row) => {
      setActionError(null);
      setAction("");
      setReason("");
      setApprovalId("");
      qc.setQueryData<AutonomyRecord | null>(
        ["autonomy", "record", row.strategyId],
        row,
      );
      void qc.invalidateQueries({ queryKey: ["autonomy"] });
    },
    onError: (err) => setActionError(pickErrorMessage(err)),
  });

  const recomputeMutation = useMutation({
    mutationFn: (id: string) => api.autonomy.recompute(id),
    onSuccess: (row) => {
      setActionError(null);
      qc.setQueryData<AutonomyRecord | null>(
        ["autonomy", "record", row.strategyId],
        row,
      );
      void qc.invalidateQueries({ queryKey: ["autonomy"] });
    },
    onError: (err) => setActionError(pickErrorMessage(err)),
  });

  const records = useMemo<ReadonlyArray<AutonomyRecord>>(
    () => listQ.data?.records ?? [],
    [listQ.data],
  );
  const record = recordQ.data ?? null;
  const historyEvents = useMemo<ReadonlyArray<AutonomyHistoryEvent>>(() => {
    const events = historyQ.data?.events ?? [];
    return [...events].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }, [historyQ.data]);

  const busy = transitionMutation.isPending || recomputeMutation.isPending;

  function submitTransition() {
    if (!strategyId) {
      setActionError("Pick a strategy first");
      return;
    }
    if (!action) {
      setActionError("Choose a transition action");
      return;
    }
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setActionError("Reason must be at least 3 characters");
      return;
    }
    if (trimmed.length > 280) {
      setActionError("Reason must be 280 characters or fewer");
      return;
    }
    // Promotion to `autonomous` requires a paired governance approval.
    // The backend enforces this, but we warn inline too so operators can
    // populate the approvalId field without a round-trip.
    const needsApproval =
      action === "promote" && record?.currentState === "autonomous_candidate";
    const approvalTrim = approvalId.trim();
    if (needsApproval && !approvalTrim) {
      setActionError(
        "Promotion to `autonomous` requires a governance approval id",
      );
      return;
    }
    transitionMutation.mutate({
      id: strategyId,
      body: {
        strategyId,
        action,
        reason: trimmed,
        approvalId: approvalTrim || null,
      },
    });
  }

  function triggerRecompute() {
    if (!strategyId) {
      setActionError("Pick a strategy first");
      return;
    }
    recomputeMutation.mutate(strategyId);
  }

  const recordColumns: ReadonlyArray<DataTableColumn<AutonomyRecord>> = [
    {
      key: "strategyId",
      header: "Strategy",
      render: (r) => (
        <button
          type="button"
          onClick={() => setStrategyId(r.strategyId)}
          className="font-mono text-xs text-sky-700 hover:underline"
        >
          {r.strategyId}
        </button>
      ),
    },
    {
      key: "currentState",
      header: "State",
      render: (r) => (
        <Badge tone={STATE_TONE[r.currentState]}>
          {STATE_LABEL[r.currentState]}
        </Badge>
      ),
    },
    {
      key: "gates",
      header: "Gates",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <Badge tone={GATE_TONE[r.gates.dnaAllClear]}>DNA</Badge>
          <Badge tone={GATE_TONE[r.gates.calibrationPass]}>cal</Badge>
          <Badge tone={GATE_TONE[r.gates.sampleSizeMet]}>size</Badge>
        </div>
      ),
    },
    {
      key: "fillsInState",
      header: "Fills (state)",
      render: (r) => (
        <span className="font-mono text-xs">{r.fillsInState}</span>
      ),
    },
    {
      key: "rInState",
      header: "R (state)",
      render: (r) => {
        const val = r.rInState;
        const tone = val > 0 ? "success" : val < 0 ? "danger" : "neutral";
        return (
          <Badge tone={tone}>
            {val >= 0 ? "+" : ""}
            {val.toFixed(2)} R
          </Badge>
        );
      },
    },
    {
      key: "enteredAt",
      header: "Entered",
      render: (r) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(r.enteredAt)}
        </span>
      ),
    },
    {
      key: "lastReason",
      header: "Last reason",
      render: (r) => (
        <span className="text-[11px] text-slate-700">
          {REASON_LABEL[r.lastReason]}
        </span>
      ),
    },
  ];

  const historyColumns: ReadonlyArray<DataTableColumn<AutonomyHistoryEvent>> = [
    {
      key: "occurredAt",
      header: "When",
      render: (e) => (
        <div className="flex flex-col text-[11px]">
          <span>{formatDate(e.occurredAt)}</span>
          <span className="text-[10px] text-slate-500">
            {formatRelative(e.occurredAt)}
          </span>
        </div>
      ),
    },
    {
      key: "transition",
      header: "Transition",
      render: (e) => {
        const tone = transitionTone(e.fromState, e.toState);
        return (
          <div className="flex flex-col gap-1">
            <Badge tone={tone.tone}>{tone.label}</Badge>
            <span className="font-mono text-[10px] text-slate-600">
              {e.fromState ? STATE_LABEL[e.fromState] : "∅"} →{" "}
              {STATE_LABEL[e.toState]}
            </span>
          </div>
        );
      },
    },
    {
      key: "reason",
      header: "Reason",
      render: (e) => (
        <div className="flex flex-col gap-1 text-[11px]">
          <Badge tone="info">{REASON_LABEL[e.reason]}</Badge>
          {e.note ? (
            <span className="text-slate-700">{e.note.slice(0, 200)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (e) =>
        e.actorUserId ? (
          <code className="font-mono text-[10px] text-slate-600">
            {e.actorUserId.slice(0, 14)}…
          </code>
        ) : (
          <Badge tone="neutral">system</Badge>
        ),
    },
    {
      key: "approval",
      header: "Approval",
      render: (e) =>
        e.approvalId ? (
          <Link
            href={`/governance/approvals?focus=${encodeURIComponent(e.approvalId)}`}
            className="font-mono text-[10px] text-sky-700 hover:underline"
          >
            {e.approvalId.slice(0, 10)}…
          </Link>
        ) : (
          <span className="text-[10px] text-slate-400">—</span>
        ),
    },
  ];

  const listCount = records.length;
  const byState = useMemo(() => {
    const counts: Record<AutonomyState, number> = {
      assisted_live: 0,
      autonomous_candidate: 0,
      autonomous: 0,
      overridden: 0,
      suspended: 0,
    };
    for (const r of records) counts[r.currentState] += 1;
    return counts;
  }, [records]);

  const promoteToAutonomous =
    action === "promote" && record?.currentState === "autonomous_candidate";

  return (
    <section className="space-y-6">
      <PageHeader
        title="Strategies · Autonomy"
        description="Promotion-ceiling FSM: assisted_live → autonomous_candidate → autonomous. Graduation to fully autonomous always requires a paired governance approval; demotions, overrides, and suspensions are operator-driven or anomaly-tripped."
      />

      <nav className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>Related:</span>
        <Link
          href="/strategies/promotions"
          className="text-sky-700 hover:underline"
        >
          Strategies · Promotions
        </Link>
        <span>·</span>
        <Link
          href="/governance/approvals"
          className="text-sky-700 hover:underline"
        >
          Governance · Approvals
        </Link>
        <span>·</span>
        <Link
          href="/execution/killswitch"
          className="text-sky-700 hover:underline"
        >
          Execution · Kill switch
        </Link>
      </nav>

      {/* Filter + counts bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            State filter
            <select
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              value={stateFilter}
              onChange={(e) =>
                setStateFilter(e.target.value as AutonomyState | "")
              }
            >
              <option value="">(all states)</option>
              {STATE_FILTER_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
            <Badge tone="info">{byState.assisted_live} assisted</Badge>
            <Badge tone="warn">{byState.autonomous_candidate} candidate</Badge>
            <Badge tone="success">{byState.autonomous} autonomous</Badge>
            <Badge tone="warn">{byState.overridden} overridden</Badge>
            <Badge tone="danger">{byState.suspended} suspended</Badge>
          </div>
        </div>
      </section>

      {/* Records table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Autonomy records ({listCount})
          </h2>
        </div>
        <DataTable
          rows={records}
          columns={recordColumns}
          loading={listQ.isLoading}
          error={listQ.error ? pickErrorMessage(listQ.error) : null}
          emptyMessage="No autonomy records yet — strategies must complete Phase 5 promotion before they surface here."
          rowKey={(r) => r.strategyId}
        />
      </section>

      {/* Detail panel */}
      {strategyId ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Detail · <code className="font-mono text-xs">{strategyId}</code>
              </h2>
              {record ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge tone={STATE_TONE[record.currentState]}>
                    {STATE_LABEL[record.currentState]}
                  </Badge>
                  <span className="text-slate-500">
                    entered {formatRelative(record.enteredAt)}
                  </span>
                  <span className="text-slate-500">
                    · next review {formatRelative(record.nextReviewAt)}
                  </span>
                  {record.lockoutUntil ? (
                    <>
                      <span className="text-slate-500">·</span>
                      <Badge tone="danger">
                        lockout until {formatRelative(record.lockoutUntil)}
                      </Badge>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={recomputeMutation.isPending}
              disabled={!strategyId || busy}
              onClick={triggerRecompute}
            >
              Recompute gates
            </Button>
          </header>

          {recordQ.error ? (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {pickErrorMessage(recordQ.error)}
            </div>
          ) : null}

          {record ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded border border-slate-200 p-3">
                <h3 className="text-xs font-semibold text-slate-700">
                  DNA all-clear
                </h3>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={GATE_TONE[record.gates.dnaAllClear]}>
                    {record.gates.dnaAllClear}
                  </Badge>
                  {record.gates.dnaTier ? (
                    <span className="text-[10px] text-slate-500">
                      tier {record.gates.dnaTier}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <h3 className="text-xs font-semibold text-slate-700">
                  Calibration pass
                </h3>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={GATE_TONE[record.gates.calibrationPass]}>
                    {record.gates.calibrationPass}
                  </Badge>
                  {record.gates.calibrationDrift !== null ? (
                    <span className="font-mono text-[10px] text-slate-500">
                      Δ{record.gates.calibrationDrift.toFixed(4)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">
                      no drift yet
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <h3 className="text-xs font-semibold text-slate-700">
                  Sample size
                </h3>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={GATE_TONE[record.gates.sampleSizeMet]}>
                    {record.gates.sampleSizeMet}
                  </Badge>
                  <span className="font-mono text-[10px] text-slate-500">
                    {record.gates.lastSampleSize} /{" "}
                    {record.gates.requiredSampleSize}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Transition panel */}
          {isAdmin && record ? (
            <div className="mt-6 rounded border border-slate-200 p-3">
              <h3 className="text-xs font-semibold text-slate-700">
                Apply transition · admin
              </h3>
              <p className="mt-1 text-[11px] text-slate-500">
                The server enforces FSM legality. Promotion to{" "}
                <code>autonomous</code> additionally requires a governance
                approval (<code>strategy_autonomous_promote</code>); paste its
                id below when promoting from <code>autonomous_candidate</code>.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-medium text-slate-700">
                  Action
                  <select
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    value={action}
                    onChange={(e) =>
                      setAction(
                        e.target.value as AutonomyTransitionAction | "",
                      )
                    }
                  >
                    <option value="">(choose…)</option>
                    {ACTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-700 md:col-span-2">
                  Reason (3–280 chars)
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Audit note — required"
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700 md:col-span-3">
                  Approval id{" "}
                  <span className="text-[10px] text-slate-500">
                    {promoteToAutonomous
                      ? "(required for promotion to autonomous)"
                      : "(optional)"}
                  </span>
                  <input
                    type="text"
                    value={approvalId}
                    onChange={(e) => setApprovalId(e.target.value)}
                    placeholder="apv_…"
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                  />
                </label>
              </div>
              {action ? (
                <p className="mt-2 text-[10px] text-slate-500">
                  {
                    ACTION_OPTIONS.find((opt) => opt.value === action)
                      ?.description
                  }
                </p>
              ) : null}
              {actionError ? (
                <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                  {actionError}
                </div>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={transitionMutation.isPending}
                  disabled={busy || !action || !reason.trim()}
                  onClick={submitTransition}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setAction("");
                    setReason("");
                    setApprovalId("");
                    setActionError(null);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          {!isAdmin ? (
            <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Transition controls require the <code>admin</code> role. Viewing
              the record and history in read-only mode.
            </div>
          ) : null}

          {/* History */}
          <div className="mt-6">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-700">
                History ({historyEvents.length})
              </h3>
              <span className="text-[10px] text-slate-500">polls every 30s</span>
            </header>
            <div className="mt-2">
              <DataTable
                rows={historyEvents}
                columns={historyColumns}
                loading={historyQ.isLoading}
                error={
                  historyQ.error ? pickErrorMessage(historyQ.error) : null
                }
                emptyMessage="No transitions recorded for this strategy yet."
                rowKey={(e) => e.id}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
          Click a strategy id in the table above to load its autonomy detail,
          gate snapshot, and transition history.
        </section>
      )}
    </section>
  );
}
