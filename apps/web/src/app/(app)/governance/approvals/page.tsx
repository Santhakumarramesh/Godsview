"use client";

/**
 * Governance · Approvals — Phase 6 surface.
 *
 * Wires four control-plane routes:
 *
 *   GET  /v1/governance/approvals              → GovernanceApprovalsList
 *   GET  /v1/governance/approvals/:id          → GovernanceApproval
 *   POST /v1/governance/approvals/:id/decide   → GovernanceApproval
 *   POST /v1/governance/approvals/:id/withdraw → GovernanceApproval
 *
 * Every privileged mutation in GodsView funnels through an approval row.
 * This page is the operator queue: filter by state/action/requester,
 * select a request to inspect the decision history, and sign off or
 * reject if the viewer's tier meets the policy's `minApproverTier`.
 *
 * Decisions + withdrawals surface 403 from the server when the caller
 * doesn't have tier; the mutation error is rendered inline.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import type {
  ApprovalDecision,
  ApprovalState,
  GovernanceAction,
  GovernanceApproval,
  GovernanceApprovalFilter,
} from "@gv/types";

const STATE_TONE: Record<
  ApprovalState,
  "info" | "success" | "danger" | "warn" | "neutral"
> = {
  pending: "info",
  approved: "success",
  rejected: "danger",
  expired: "warn",
  withdrawn: "neutral",
};

const STATE_OPTIONS: ReadonlyArray<ApprovalState> = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "withdrawn",
];

const ACTION_OPTIONS: ReadonlyArray<GovernanceAction> = [
  "live_mode_enable",
  "kill_switch_toggle",
  "risk_budget_widen",
  "risk_budget_tighten",
  "strategy_promote",
  "strategy_demote",
  "strategy_retire",
  "strategy_autonomous_promote",
  "strategy_autonomous_demote",
  "allocation_set",
  "override_risk",
  "feature_flag_toggle",
  "trust_tier_change",
  "approval_policy_edit",
  "anomaly_acknowledge",
  "calibration_recompute",
  "dna_rebuild",
  "data_truth_override",
];

function prettyAction(a: GovernanceAction): string {
  return a.replaceAll("_", " ");
}

export default function GovernanceApprovalsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;

  const [stateFilter, setStateFilter] = useState<ApprovalState | "">("pending");
  const [actionFilter, setActionFilter] = useState<GovernanceAction | "">("");
  const [requestedByFilter, setRequestedByFilter] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [decisionComment, setDecisionComment] = useState<string>("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState<string>("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const filter: GovernanceApprovalFilter = useMemo(
    () => ({
      state: stateFilter || undefined,
      action: actionFilter || undefined,
      requestedByUserId: requestedByFilter.trim() || undefined,
      subjectKey: subjectFilter.trim() || undefined,
      limit: 100,
    }),
    [stateFilter, actionFilter, requestedByFilter, subjectFilter],
  );

  const listQuery = useQuery({
    queryKey: ["governance", "approvals", filter],
    queryFn: () => api.governance.approvals.list(filter),
    refetchInterval: 15_000,
  });

  const detailQuery = useQuery({
    queryKey: ["governance", "approvals", "detail", selectedId],
    queryFn: () => api.governance.approvals.get(selectedId as string),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 15_000 : false,
  });

  const decideMutation = useMutation({
    mutationFn: (decision: ApprovalDecision) =>
      api.governance.approvals.decide(selectedId as string, {
        decision,
        comment: decisionComment.trim() || undefined,
      }),
    onSuccess: (updated: GovernanceApproval) => {
      qc.setQueryData(
        ["governance", "approvals", "detail", updated.id],
        updated,
      );
      qc.invalidateQueries({ queryKey: ["governance", "approvals"] });
      setDecisionComment("");
      setDecisionError(null);
    },
    onError: (err) => setDecisionError(pickErrorMessage(err)),
  });

  const withdrawMutation = useMutation({
    mutationFn: () =>
      api.governance.approvals.withdraw(
        selectedId as string,
        withdrawReason.trim(),
      ),
    onSuccess: (updated: GovernanceApproval) => {
      qc.setQueryData(
        ["governance", "approvals", "detail", updated.id],
        updated,
      );
      qc.invalidateQueries({ queryKey: ["governance", "approvals"] });
      setWithdrawReason("");
      setWithdrawError(null);
    },
    onError: (err) => setWithdrawError(pickErrorMessage(err)),
  });

  const rows = listQuery.data?.approvals ?? [];
  const total = listQuery.data?.total ?? 0;
  const detail = detailQuery.data;
  const isMyRequest =
    Boolean(detail) && user?.id === detail?.requestedByUserId;

  const columns: ReadonlyArray<DataTableColumn<GovernanceApproval>> = [
    {
      key: "state",
      header: "State",
      render: (a) => <Badge tone={STATE_TONE[a.state]}>{a.state}</Badge>,
    },
    {
      key: "action",
      header: "Action",
      render: (a) => (
        <span className="text-xs text-slate-900">{prettyAction(a.action)}</span>
      ),
    },
    {
      key: "subjectKey",
      header: "Subject",
      render: (a) => (
        <code className="font-mono text-xs text-slate-700">
          {a.subjectKey ?? "—"}
        </code>
      ),
    },
    {
      key: "requestedByUserId",
      header: "Requested by",
      render: (a) => (
        <code className="font-mono text-xs text-slate-700">
          {a.requestedByUserId}
        </code>
      ),
    },
    {
      key: "decisions",
      header: "Signatures",
      render: (a) => (
        <span className="font-mono text-xs text-slate-700">
          {a.decisions.length} / {a.requiredApproverCount}
        </span>
      ),
    },
    {
      key: "requestedAt",
      header: "Requested",
      render: (a) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(a.requestedAt)}
        </span>
      ),
    },
    {
      key: "expiresAt",
      header: "Expires",
      render: (a) => (
        <span className="text-[11px] text-slate-500">
          {a.expiresAt ? formatRelative(a.expiresAt) : "—"}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      render: (a) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelectedId(a.id);
            setDecisionComment("");
            setDecisionError(null);
            setWithdrawReason("");
            setWithdrawError(null);
          }}
        >
          Inspect
        </Button>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Governance · Approvals"
        description="Pending and historical approval queue. Every privileged mutation funnels through an approval row; approvers must meet the policy's minimum trust tier."
      />

      {/* Filter bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            State
            <select
              value={stateFilter}
              onChange={(e) =>
                setStateFilter(e.target.value as ApprovalState | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {STATE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Action
            <select
              value={actionFilter}
              onChange={(e) =>
                setActionFilter(e.target.value as GovernanceAction | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {prettyAction(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Requested by (user id)
            <input
              type="text"
              value={requestedByFilter}
              onChange={(e) => setRequestedByFilter(e.target.value)}
              placeholder="user_…"
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Subject key
            <input
              type="text"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              placeholder="strategy id · account id · …"
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="ml-auto text-[11px] text-slate-500">
            {listQuery.isLoading
              ? "Loading…"
              : `${rows.length} / ${total} approvals`}
          </div>
        </div>
      </section>

      {/* List */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Queue</h2>
        </div>
        {listQuery.error ? (
          <div className="p-4 text-xs text-rose-700">
            {pickErrorMessage(listQuery.error)}
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(a) => a.id}
            emptyMessage="No approvals match the current filter."
          />
        )}
      </section>

      {/* Detail drawer */}
      {selectedId ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Approval {selectedId}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedId(null)}
            >
              Close
            </Button>
          </div>
          {detailQuery.isLoading ? (
            <div className="p-4 text-xs text-slate-500">Loading approval…</div>
          ) : detailQuery.error ? (
            <div className="p-4 text-xs text-rose-700">
              {pickErrorMessage(detailQuery.error)}
            </div>
          ) : detail ? (
            <div className="space-y-4 p-4">
              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Action
                  </div>
                  <div className="mt-1 text-slate-900">
                    {prettyAction(detail.action)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    State
                  </div>
                  <div className="mt-1">
                    <Badge tone={STATE_TONE[detail.state]}>
                      {detail.state}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Signatures
                  </div>
                  <div className="mt-1 font-mono text-slate-900">
                    {detail.decisions.length} / {detail.requiredApproverCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Expires
                  </div>
                  <div className="mt-1 text-slate-900">
                    {detail.expiresAt ? formatDate(detail.expiresAt) : "—"}
                  </div>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Subject key
                  </div>
                  <code className="mt-1 block font-mono text-xs text-slate-900">
                    {detail.subjectKey ?? "—"}
                  </code>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Reason
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    {detail.reason}
                  </div>
                </div>
              </div>

              {/* Payload */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Payload
                </div>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                  {JSON.stringify(detail.payload, null, 2)}
                </pre>
              </div>

              {/* Decision history */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Decision history
                </div>
                {detail.decisions.length === 0 ? (
                  <div className="mt-1 text-xs text-slate-500">
                    No signatures yet.
                  </div>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {detail.decisions.map((d) => (
                      <li
                        key={`${d.approverUserId}-${d.decidedAt}`}
                        className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <code className="font-mono text-slate-900">
                            {d.approverUserId}
                          </code>
                          <Badge
                            tone={
                              d.decision === "approve"
                                ? "success"
                                : d.decision === "reject"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {d.decision}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {formatDate(d.decidedAt)}
                        </div>
                        {d.comment ? (
                          <div className="mt-1 text-[11px] text-slate-700">
                            {d.comment}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Decision panel */}
              {detail.state === "pending" ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-900">
                    {isMyRequest ? "Withdraw request" : "Sign off"}
                  </div>
                  {!isMyRequest ? (
                    <>
                      <label className="mt-2 block text-[11px] text-slate-700">
                        Comment (optional)
                        <input
                          type="text"
                          value={decisionComment}
                          onChange={(e) => setDecisionComment(e.target.value)}
                          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                          placeholder="why you're approving / rejecting"
                        />
                      </label>
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={decideMutation.isPending}
                          onClick={() => decideMutation.mutate("approve")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={decideMutation.isPending}
                          onClick={() => decideMutation.mutate("reject")}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={decideMutation.isPending}
                          onClick={() => decideMutation.mutate("abstain")}
                        >
                          Abstain
                        </Button>
                      </div>
                      {decisionError ? (
                        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                          {decisionError}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label className="mt-2 block text-[11px] text-slate-700">
                        Withdraw reason (min 3 chars)
                        <input
                          type="text"
                          value={withdrawReason}
                          onChange={(e) => setWithdrawReason(e.target.value)}
                          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                          placeholder="why you're pulling the request"
                        />
                      </label>
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="danger"
                          loading={withdrawMutation.isPending}
                          disabled={withdrawReason.trim().length < 3}
                          onClick={() => withdrawMutation.mutate()}
                        >
                          Withdraw
                        </Button>
                      </div>
                      {withdrawError ? (
                        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                          {withdrawError}
                        </div>
                      ) : null}
                    </>
                  )}
                  {!isAdmin && !isMyRequest ? (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Heads-up: admin cookie is required for non-admin
                      approvers; the server will 403 if your tier is below the
                      policy's minApproverTier.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                  Terminal state. Resolved{" "}
                  {detail.resolvedAt ? formatRelative(detail.resolvedAt) : "—"}{" "}
                  {detail.resolvedByUserId ? (
                    <>
                      by{" "}
                      <code className="font-mono text-slate-900">
                        {detail.resolvedByUserId}
                      </code>
                    </>
                  ) : null}
                  .
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
