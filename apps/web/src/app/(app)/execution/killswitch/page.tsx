"use client";

/**
 * Execution · Kill switch — Phase 6 surface.
 *
 * Wires four control-plane routes shipped in PR5:
 *
 *   GET  /v1/kill-switch/states   → KillSwitchStatesList
 *   GET  /v1/kill-switch/events   → KillSwitchEventsList
 *   POST /v1/kill-switch/trip     → KillSwitchStatesList
 *   POST /v1/kill-switch/reset    → KillSwitchStatesList
 *
 * The kill switch is the global circuit-breaker that overrides every
 * autonomy tier. A tripped `global` scope blocks every outbound broker
 * intent regardless of strategy state; narrower `account` / `strategy`
 * scopes only block intents that match the `subjectKey`.
 *
 * Trips always land immediately (the live gate should fail-closed). A
 * reset on the `global` scope requires a paired `kill_switch_toggle`
 * governance approval — the server returns 403 + `approvalId` and we
 * surface the inline error so operators can finish the flow in
 * /governance/approvals.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import type {
  KillSwitchAction,
  KillSwitchEvent,
  KillSwitchFilter,
  KillSwitchResetRequest,
  KillSwitchScope,
  KillSwitchState,
  KillSwitchTrigger,
  KillSwitchTripRequest,
} from "@gv/types";

const SCOPE_TONE: Record<
  KillSwitchScope,
  "danger" | "warn" | "info"
> = {
  global: "danger",
  account: "warn",
  strategy: "info",
};

const TRIGGER_TONE: Record<
  KillSwitchTrigger,
  "neutral" | "info" | "warn" | "danger"
> = {
  operator: "info",
  anomaly: "danger",
  governance: "warn",
  automated_drawdown: "danger",
  automated_data_truth: "danger",
  automated_broker_health: "warn",
};

const SCOPE_OPTIONS: ReadonlyArray<KillSwitchScope> = [
  "global",
  "account",
  "strategy",
];

const TRIGGER_OPTIONS: ReadonlyArray<KillSwitchTrigger> = [
  "operator",
  "anomaly",
  "governance",
  "automated_drawdown",
  "automated_data_truth",
  "automated_broker_health",
];

const ACTION_OPTIONS: ReadonlyArray<KillSwitchAction> = ["trip", "reset"];

function prettyTrigger(t: KillSwitchTrigger): string {
  return t.replaceAll("_", " ");
}

function scopeLabel(s: KillSwitchState): string {
  if (s.scope === "global") return "global";
  return `${s.scope}:${s.subjectKey ?? "(none)"}`;
}

export default function ExecutionKillSwitchPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;

  // ── trip panel state ──────────────────────────────────────────────
  const [tripScope, setTripScope] = useState<KillSwitchScope>("global");
  const [tripSubject, setTripSubject] = useState<string>("");
  const [tripTrigger, setTripTrigger] =
    useState<KillSwitchTrigger>("operator");
  const [tripReason, setTripReason] = useState<string>("");
  const [tripError, setTripError] = useState<string | null>(null);

  // ── reset panel state (selected row) ─────────────────────────────
  const [resetTarget, setResetTarget] = useState<KillSwitchState | null>(null);
  const [resetReason, setResetReason] = useState<string>("");
  const [resetApprovalId, setResetApprovalId] = useState<string>("");
  const [resetError, setResetError] = useState<string | null>(null);

  // ── events filter state ──────────────────────────────────────────
  const [scopeFilter, setScopeFilter] = useState<KillSwitchScope | "">("");
  const [triggerFilter, setTriggerFilter] = useState<KillSwitchTrigger | "">(
    "",
  );
  const [actionFilter, setActionFilter] = useState<KillSwitchAction | "">("");

  const statesQuery = useQuery({
    queryKey: ["kill-switch", "states"],
    queryFn: () => api.killSwitch.states(),
    refetchInterval: 10_000,
  });

  const eventsFilter: KillSwitchFilter = useMemo(
    () => ({
      scope: scopeFilter || undefined,
      trigger: triggerFilter || undefined,
      action: actionFilter || undefined,
      limit: 200,
    }),
    [scopeFilter, triggerFilter, actionFilter],
  );

  const eventsQuery = useQuery({
    queryKey: ["kill-switch", "events", eventsFilter],
    queryFn: () => api.killSwitch.events(eventsFilter),
    refetchInterval: 15_000,
  });

  const tripMutation = useMutation({
    mutationFn: (req: KillSwitchTripRequest) => api.killSwitch.trip(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kill-switch"] });
      setTripReason("");
      setTripSubject("");
      setTripError(null);
    },
    onError: (err) => setTripError(pickErrorMessage(err)),
  });

  const resetMutation = useMutation({
    mutationFn: (req: KillSwitchResetRequest) => api.killSwitch.reset(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kill-switch"] });
      setResetTarget(null);
      setResetReason("");
      setResetApprovalId("");
      setResetError(null);
    },
    onError: (err) => setResetError(pickErrorMessage(err)),
  });

  const allStates: ReadonlyArray<KillSwitchState> = useMemo(
    () => statesQuery.data?.states ?? [],
    [statesQuery.data],
  );

  const activeStates = useMemo(
    () =>
      [...allStates]
        .filter((s) => s.active)
        .sort((a, b) => {
          // Global first, then by scope alpha, then by scope key.
          if (a.scope !== b.scope) {
            if (a.scope === "global") return -1;
            if (b.scope === "global") return 1;
            return a.scope.localeCompare(b.scope);
          }
          return (a.subjectKey ?? "").localeCompare(b.subjectKey ?? "");
        }),
    [allStates],
  );

  const events = eventsQuery.data?.events ?? [];
  const eventsTotal = eventsQuery.data?.total ?? 0;
  const globalTripped = activeStates.some((s) => s.scope === "global");

  function submitTrip() {
    if (tripReason.trim().length < 3) return;
    if (tripScope !== "global" && !tripSubject.trim()) return;
    tripMutation.mutate({
      scope: tripScope,
      subjectKey: tripScope === "global" ? null : tripSubject.trim(),
      trigger: tripTrigger,
      reason: tripReason.trim(),
    });
  }

  function submitReset() {
    if (!resetTarget) return;
    if (resetReason.trim().length < 3) return;
    resetMutation.mutate({
      scope: resetTarget.scope,
      subjectKey: resetTarget.subjectKey,
      reason: resetReason.trim(),
      approvalId: resetApprovalId.trim() || null,
    });
  }

  const stateColumns: ReadonlyArray<DataTableColumn<KillSwitchState>> = [
    {
      key: "scope",
      header: "Scope",
      render: (s) => <Badge tone={SCOPE_TONE[s.scope]}>{s.scope}</Badge>,
    },
    {
      key: "subjectKey",
      header: "Subject",
      render: (s) => (
        <code className="font-mono text-xs text-slate-900">
          {s.subjectKey ?? "—"}
        </code>
      ),
    },
    {
      key: "trigger",
      header: "Trigger",
      render: (s) =>
        s.trigger ? (
          <Badge tone={TRIGGER_TONE[s.trigger]}>
            {prettyTrigger(s.trigger)}
          </Badge>
        ) : (
          <span className="text-[11px] text-slate-500">—</span>
        ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (s) => (
        <span className="line-clamp-2 text-xs text-slate-800">
          {s.reason ?? "—"}
        </span>
      ),
    },
    {
      key: "trippedAt",
      header: "Tripped",
      render: (s) => (
        <span className="text-[11px] text-slate-500">
          {s.trippedAt ? formatRelative(s.trippedAt) : "—"}
        </span>
      ),
    },
    {
      key: "trippedByUserId",
      header: "By",
      render: (s) => (
        <code className="font-mono text-[11px] text-slate-700">
          {s.trippedByUserId ?? "—"}
        </code>
      ),
    },
    {
      key: "_actions",
      header: "",
      render: (s) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setResetTarget(s);
            setResetReason("");
            setResetApprovalId("");
            setResetError(null);
          }}
          disabled={!isAdmin}
        >
          Reset
        </Button>
      ),
    },
  ];

  const eventColumns: ReadonlyArray<DataTableColumn<KillSwitchEvent>> = [
    {
      key: "occurredAt",
      header: "When",
      render: (e) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(e.occurredAt)}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (e) => (
        <Badge tone={e.action === "trip" ? "danger" : "success"}>
          {e.action}
        </Badge>
      ),
    },
    {
      key: "scope",
      header: "Scope",
      render: (e) => (
        <div className="flex items-center gap-2">
          <Badge tone={SCOPE_TONE[e.scope]}>{e.scope}</Badge>
          {e.subjectKey ? (
            <code className="font-mono text-[11px] text-slate-700">
              {e.subjectKey}
            </code>
          ) : null}
        </div>
      ),
    },
    {
      key: "trigger",
      header: "Trigger",
      render: (e) => (
        <Badge tone={TRIGGER_TONE[e.trigger]}>{prettyTrigger(e.trigger)}</Badge>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (e) => (
        <span className="line-clamp-2 text-xs text-slate-800">{e.reason}</span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (e) => (
        <code className="font-mono text-[11px] text-slate-700">
          {e.actorUserId ?? "(system)"}
        </code>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Execution · Kill switch"
        description="Global circuit-breaker that overrides every autonomy tier. Trips land immediately; resets on the global scope require a paired governance approval."
      />
      <nav className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>Related:</span>
        <Link
          href="/governance/approvals"
          className="text-sky-700 hover:underline"
        >
          Governance · Approvals
        </Link>
        <span>·</span>
        <Link
          href="/strategies/autonomy"
          className="text-sky-700 hover:underline"
        >
          Strategies · Autonomy
        </Link>
        <span>·</span>
        <Link href="/ops/flags" className="text-sky-700 hover:underline">
          Operations · Flags
        </Link>
      </nav>

      {globalTripped ? (
        <section className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
          <strong className="font-semibold">Global kill switch is TRIPPED.</strong>{" "}
          Every outbound broker intent is blocked regardless of strategy state.
          A reset requires a paired <code>kill_switch_toggle</code> approval —
          finish the flow in{" "}
          <Link
            href="/governance/approvals"
            className="underline underline-offset-2"
          >
            /governance/approvals
          </Link>
          .
        </section>
      ) : null}

      {/* Active scopes */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Active scopes ({activeStates.length})
          </h2>
          <span className="text-[11px] text-slate-500">
            {statesQuery.isLoading ? "Loading…" : "polls every 10s"}
          </span>
        </div>
        {statesQuery.error ? (
          <div className="p-4 text-xs text-rose-700">
            {pickErrorMessage(statesQuery.error)}
          </div>
        ) : (
          <DataTable
            rows={activeStates}
            columns={stateColumns}
            rowKey={(s) => `${s.scope}:${s.subjectKey ?? "null"}`}
            emptyMessage="No active kill-switch scopes — all live intents are flowing."
          />
        )}
      </section>

      {/* Trip panel */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Trip a scope
          </h2>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="text-[11px] text-slate-700">
              Scope
              <select
                value={tripScope}
                onChange={(e) => {
                  const next = e.target.value as KillSwitchScope;
                  setTripScope(next);
                  if (next === "global") setTripSubject("");
                }}
                disabled={!isAdmin}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-700 md:col-span-2">
              Subject key {tripScope === "global" ? "(n/a)" : "(required)"}
              <input
                type="text"
                value={tripSubject}
                onChange={(e) => setTripSubject(e.target.value)}
                disabled={!isAdmin || tripScope === "global"}
                placeholder={
                  tripScope === "account"
                    ? "account id"
                    : tripScope === "strategy"
                      ? "strategy id"
                      : "—"
                }
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-700">
              Trigger
              <select
                value={tripTrigger}
                onChange={(e) =>
                  setTripTrigger(e.target.value as KillSwitchTrigger)
                }
                disabled={!isAdmin}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {TRIGGER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {prettyTrigger(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-[11px] text-slate-700">
            Reason (min 3 chars, max 280)
            <input
              type="text"
              value={tripReason}
              onChange={(e) => setTripReason(e.target.value)}
              disabled={!isAdmin}
              placeholder="what you're seeing + why we're halting"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              maxLength={280}
            />
          </label>
          <div>
            <Button
              size="sm"
              variant="danger"
              loading={tripMutation.isPending}
              disabled={
                !isAdmin ||
                tripReason.trim().length < 3 ||
                (tripScope !== "global" && !tripSubject.trim())
              }
              onClick={submitTrip}
            >
              Trip {tripScope === "global" ? "global" : `${tripScope} scope`}
            </Button>
          </div>
          {tripError ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
              {tripError}
            </div>
          ) : null}
          {!isAdmin ? (
            <div className="text-[11px] text-slate-500">
              Tripping requires an admin role cookie. The server will 403
              otherwise.
            </div>
          ) : null}
        </div>
      </section>

      {/* Reset panel */}
      {resetTarget ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Reset {scopeLabel(resetTarget)}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setResetTarget(null)}
            >
              Close
            </Button>
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
              {resetTarget.scope === "global" ? (
                <>
                  Resetting the global scope requires a paired{" "}
                  <code>kill_switch_toggle</code> approval. Paste the
                  approval id below; without it the server will 403.
                </>
              ) : (
                <>
                  Scope-level resets land immediately with an audit-log
                  entry. An approval id is optional but recommended.
                </>
              )}
            </div>
            <label className="block text-[11px] text-slate-700">
              Reason (min 3 chars, max 280)
              <input
                type="text"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="root-cause + why we're resuming"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                maxLength={280}
              />
            </label>
            <label className="block text-[11px] text-slate-700">
              Approval id{" "}
              {resetTarget.scope === "global" ? "(required)" : "(optional)"}
              <input
                type="text"
                value={resetApprovalId}
                onChange={(e) => setResetApprovalId(e.target.value)}
                placeholder="approval_…"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={resetMutation.isPending}
                disabled={!isAdmin || resetReason.trim().length < 3}
                onClick={submitReset}
              >
                Reset scope
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setResetTarget(null)}
              >
                Cancel
              </Button>
            </div>
            {resetError ? (
              <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                {resetError}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Events log */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Audit log ({events.length} / {eventsTotal})
          </h2>
          <span className="text-[11px] text-slate-500">
            {eventsQuery.isLoading ? "Loading…" : "polls every 15s"}
          </span>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-slate-700">
              Scope
              <select
                value={scopeFilter}
                onChange={(e) =>
                  setScopeFilter(e.target.value as KillSwitchScope | "")
                }
                className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">All</option>
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-700">
              Trigger
              <select
                value={triggerFilter}
                onChange={(e) =>
                  setTriggerFilter(e.target.value as KillSwitchTrigger | "")
                }
                className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">All</option>
                {TRIGGER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {prettyTrigger(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-700">
              Action
              <select
                value={actionFilter}
                onChange={(e) =>
                  setActionFilter(e.target.value as KillSwitchAction | "")
                }
                className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">All</option>
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {eventsQuery.error ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {pickErrorMessage(eventsQuery.error)}
            </div>
          ) : (
            <DataTable
              rows={events}
              columns={eventColumns}
              rowKey={(e) => e.id}
              emptyMessage="No kill-switch events match the current filter."
            />
          )}
        </div>
      </section>

      <p className="text-[11px] text-slate-500">
        Most recent snapshot:{" "}
        {statesQuery.dataUpdatedAt
          ? formatDate(new Date(statesQuery.dataUpdatedAt).toISOString())
          : "—"}
      </p>
    </section>
  );
}
