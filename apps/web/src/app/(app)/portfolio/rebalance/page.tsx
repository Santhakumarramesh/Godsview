"use client";

/**
 * Portfolio · Rebalance — Phase 7 PR7 surface.
 *
 * Wires three control-plane routes:
 *
 *   GET /v1/rebalance/plans          → RebalancePlansList
 *   GET /v1/rebalance/plans/:id/detail → RebalancePlanDetail (plan + intents)
 *   GET /v1/portfolio/accounts       → PortfolioAccountsList (filter)
 *
 * Layout:
 *   ▸ filters (account + status + trigger)
 *   ▸ plan table (status, trigger, intents, gross/net delta, proposed, actions)
 *   ▸ selected plan drawer: plan header + intents table + warnings
 *
 * Plan mutations (approve / reject / cancel / execute) all require a
 * reason and — for approve — a paired governance approval id. They are
 * scoped to the selected plan and invalidate the list + detail queries
 * on success. This page only reads + routes; the paired approval is
 * minted on the Governance surface.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  RebalanceIntent,
  RebalancePlan,
  RebalancePlanFilter,
  RebalancePlanStatus,
  RebalanceTrigger,
} from "@gv/types";

const USD = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(v: number): string {
  return USD.format(v);
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

const STATUS_TONE: Record<
  RebalancePlanStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  proposed: "info",
  approved: "info",
  executing: "warn",
  complete: "success",
  rejected: "neutral",
  cancelled: "neutral",
  failed: "danger",
};

const INTENT_STATUS_TONE: Record<
  RebalanceIntent["status"],
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  queued: "info",
  submitted: "warn",
  filled: "success",
  partial: "warn",
  cancelled: "neutral",
  failed: "danger",
};

export default function PortfolioRebalancePage() {
  const qc = useQueryClient();

  const [accountId, setAccountId] = useState<string>("");
  const [status, setStatus] = useState<RebalancePlanStatus | "">("");
  const [trigger, setTrigger] = useState<RebalanceTrigger | "">("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const [rejectReason, setRejectReason] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");
  const [executeReason, setExecuteReason] = useState<string>("");
  const [approvalId, setApprovalId] = useState<string>("");
  const [approveReason, setApproveReason] = useState<string>("");
  const [mutationError, setMutationError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["portfolio", "accounts"],
    queryFn: () => api.portfolio.accounts.list(),
    staleTime: 60_000,
  });

  const filter: RebalancePlanFilter = useMemo(() => {
    const f: RebalancePlanFilter = { limit: 100 };
    if (accountId) f.accountId = accountId;
    if (status) f.status = status;
    if (trigger) f.trigger = trigger;
    return f;
  }, [accountId, status, trigger]);

  const plansQuery = useQuery({
    queryKey: ["rebalance", "plans", filter],
    queryFn: () => api.rebalance.plans.list(filter),
    refetchInterval: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ["rebalance", "plans", selectedPlanId, "detail"],
    queryFn: () => api.rebalance.plans.detail(selectedPlanId!),
    enabled: !!selectedPlanId,
    refetchInterval: selectedPlanId ? 15_000 : false,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["rebalance", "plans"] });
    if (selectedPlanId) {
      void qc.invalidateQueries({
        queryKey: ["rebalance", "plans", selectedPlanId, "detail"],
      });
    }
  }

  const approveMutation = useMutation({
    mutationFn: ({ id, req }: { id: string; req: { approvalId: string; reason: string } }) =>
      api.rebalance.plans.approve(id, req),
    onSuccess: () => {
      setApproveReason("");
      setApprovalId("");
      setMutationError(null);
      invalidate();
    },
    onError: (err) => setMutationError(pickErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.rebalance.plans.reject(id, { reason }),
    onSuccess: () => {
      setRejectReason("");
      setMutationError(null);
      invalidate();
    },
    onError: (err) => setMutationError(pickErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.rebalance.plans.cancel(id, { reason }),
    onSuccess: () => {
      setCancelReason("");
      setMutationError(null);
      invalidate();
    },
    onError: (err) => setMutationError(pickErrorMessage(err)),
  });

  const executeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.rebalance.plans.execute(id, reason),
    onSuccess: () => {
      setExecuteReason("");
      setMutationError(null);
      invalidate();
    },
    onError: (err) => setMutationError(pickErrorMessage(err)),
  });

  const plans = plansQuery.data?.plans ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];
  const detail = detailQuery.data;

  const planColumns: ReadonlyArray<DataTableColumn<RebalancePlan>> = [
    {
      key: "id",
      header: "Plan",
      render: (p) => (
        <button
          type="button"
          className="font-mono text-xs text-sky-700 hover:underline"
          onClick={() => setSelectedPlanId(p.id)}
        >
          {p.id}
        </button>
      ),
    },
    {
      key: "account",
      header: "Account",
      render: (p) => (
        <code className="font-mono text-[11px] text-slate-700">{p.accountId}</code>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>,
    },
    {
      key: "trigger",
      header: "Trigger",
      render: (p) => (
        <span className="font-mono text-[11px] text-slate-600">
          {p.trigger.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "intents",
      header: "Intents",
      render: (p) => (
        <span className="font-mono text-xs text-slate-700">{p.intentCount}</span>
      ),
    },
    {
      key: "gross",
      header: "Gross Δ$",
      render: (p) => (
        <span className="font-mono text-xs text-slate-900">
          {formatUsd(p.grossDeltaNotional)}
        </span>
      ),
    },
    {
      key: "net",
      header: "Net Δ$",
      render: (p) => (
        <span
          className={`font-mono text-xs ${
            p.netDeltaNotional > 0
              ? "text-emerald-700"
              : p.netDeltaNotional < 0
                ? "text-rose-700"
                : "text-slate-700"
          }`}
        >
          {formatUsd(p.netDeltaNotional)}
        </span>
      ),
    },
    {
      key: "warnings",
      header: "Warn",
      render: (p) =>
        p.warnings.length === 0 ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <Badge tone="warn">{p.warnings.length}</Badge>
        ),
    },
    {
      key: "proposedAt",
      header: "Proposed",
      render: (p) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(p.proposedAt)}
        </span>
      ),
    },
  ];

  const intentColumns: ReadonlyArray<DataTableColumn<RebalanceIntent>> = [
    {
      key: "symbol",
      header: "Symbol",
      render: (i) => (
        <code className="font-mono text-xs text-slate-900">{i.symbolId}</code>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (i) => (
        <code className="font-mono text-[11px] text-slate-600">{i.strategyId}</code>
      ),
    },
    {
      key: "side",
      header: "Side",
      render: (i) => (
        <Badge tone={i.side === "long" ? "success" : "danger"}>{i.side}</Badge>
      ),
    },
    {
      key: "current",
      header: "Current",
      render: (i) => (
        <span className="font-mono text-xs text-slate-700">
          {formatUsd(i.currentNotional)}
        </span>
      ),
    },
    {
      key: "target",
      header: "Target",
      render: (i) => (
        <span className="font-mono text-xs text-slate-900">
          {formatUsd(i.targetNotional)}
        </span>
      ),
    },
    {
      key: "delta",
      header: "Δ$",
      render: (i) => (
        <span
          className={`font-mono text-xs ${
            i.deltaNotional > 0
              ? "text-emerald-700"
              : i.deltaNotional < 0
                ? "text-rose-700"
                : "text-slate-700"
          }`}
        >
          {formatUsd(i.deltaNotional)}
        </span>
      ),
    },
    {
      key: "deltaPct",
      header: "Δ%",
      render: (i) => (
        <span className="font-mono text-[11px] text-slate-600">
          {formatPct(i.deltaPercent)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (i) => (
        <Badge tone={INTENT_STATUS_TONE[i.status]}>{i.status}</Badge>
      ),
    },
    {
      key: "filled",
      header: "Filled",
      render: (i) => (
        <span className="font-mono text-xs text-slate-700">
          {formatUsd(i.filledNotional)}
        </span>
      ),
    },
    {
      key: "adapter",
      header: "Adapter",
      render: (i) =>
        i.adapterId ? (
          <code className="font-mono text-[11px] text-slate-500">{i.adapterId}</code>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  const selectedPlan = detail?.plan;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Portfolio · Rebalance"
        description="Plans emitted by the rebalancer cron. Approval mints a governance quorum (admin + operator); execute flips the plan to executing and drains its intents into the live execution bus."
      />

      {/* Filters */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              disabled={accountsQuery.isLoading}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.displayName} · {a.provider}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Status
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as RebalancePlanStatus | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              <option value="proposed">proposed</option>
              <option value="approved">approved</option>
              <option value="executing">executing</option>
              <option value="complete">complete</option>
              <option value="rejected">rejected</option>
              <option value="cancelled">cancelled</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Trigger
            <select
              value={trigger}
              onChange={(e) =>
                setTrigger(e.target.value as RebalanceTrigger | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              <option value="scheduled">scheduled</option>
              <option value="manual">manual</option>
              <option value="drift">drift</option>
              <option value="anomaly">anomaly</option>
              <option value="allocation_change">allocation_change</option>
            </select>
          </label>
          <div className="ml-auto text-[11px] text-slate-500">
            {plansQuery.data ? (
              <>{plansQuery.data.total} plans · updated {formatRelative(new Date().toISOString())}</>
            ) : (
              <>—</>
            )}
          </div>
        </div>
      </section>

      {/* Plan table */}
      <DataTable
        rows={plans}
        columns={planColumns}
        loading={plansQuery.isLoading}
        error={plansQuery.error ? pickErrorMessage(plansQuery.error) : null}
        emptyMessage="No rebalance plans match this filter."
        rowKey={(p) => p.id}
      />

      {/* Detail drawer */}
      {selectedPlanId ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <header className="mb-3 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Plan{" "}
                <code className="font-mono text-xs text-slate-700">
                  {selectedPlanId}
                </code>
              </h2>
              {selectedPlan ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  Status <Badge tone={STATUS_TONE[selectedPlan.status]}>{selectedPlan.status}</Badge>
                  {" "}· Proposed {formatDate(selectedPlan.proposedAt)}
                  {selectedPlan.approvedAt ? ` · Approved ${formatDate(selectedPlan.approvedAt)}` : ""}
                  {selectedPlan.executedAt ? ` · Executed ${formatDate(selectedPlan.executedAt)}` : ""}
                  {selectedPlan.completedAt ? ` · Completed ${formatDate(selectedPlan.completedAt)}` : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setSelectedPlanId(null)}
              className="text-xs text-slate-500 underline"
            >
              Close
            </button>
          </header>

          {detailQuery.isLoading ? (
            <div className="text-xs text-slate-500">Loading plan detail…</div>
          ) : detailQuery.error ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {pickErrorMessage(detailQuery.error)}
            </div>
          ) : selectedPlan ? (
            <div className="space-y-4">
              {/* Warnings */}
              {selectedPlan.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <h3 className="text-xs font-semibold text-amber-900">
                    Plan warnings
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {selectedPlan.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <Badge
                          tone={
                            w.severity === "critical"
                              ? "danger"
                              : w.severity === "warn"
                                ? "warn"
                                : "info"
                          }
                        >
                          {w.severity}
                        </Badge>
                        <div>
                          <div className="font-medium text-amber-900">
                            {w.code.replaceAll("_", " ")}
                            {w.subjectKey ? (
                              <code className="ml-2 font-mono text-[11px] text-amber-800">
                                {w.subjectKey}
                              </code>
                            ) : null}
                          </div>
                          <div className="text-amber-800">{w.message}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Action strip */}
              {mutationError ? (
                <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                  {mutationError}
                </div>
              ) : null}

              {selectedPlan.status === "proposed" ? (
                <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-800">Approve</h4>
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Governance approval id"
                      value={approvalId}
                      onChange={(e) => setApprovalId(e.target.value)}
                    />
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Reason (3–280 chars)"
                      value={approveReason}
                      onChange={(e) => setApproveReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      loading={approveMutation.isPending}
                      onClick={() =>
                        approveMutation.mutate({
                          id: selectedPlan.id,
                          req: { approvalId, reason: approveReason },
                        })
                      }
                      disabled={!approvalId || approveReason.length < 3}
                    >
                      Approve
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-800">Reject</h4>
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Reason (3–280 chars)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      loading={rejectMutation.isPending}
                      onClick={() =>
                        rejectMutation.mutate({
                          id: selectedPlan.id,
                          reason: rejectReason,
                        })
                      }
                      disabled={rejectReason.length < 3}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ) : null}

              {selectedPlan.status === "approved" ? (
                <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-800">Execute</h4>
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Reason (3–280 chars)"
                      value={executeReason}
                      onChange={(e) => setExecuteReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      loading={executeMutation.isPending}
                      onClick={() =>
                        executeMutation.mutate({
                          id: selectedPlan.id,
                          reason: executeReason,
                        })
                      }
                      disabled={executeReason.length < 3}
                    >
                      Execute now
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-800">Cancel</h4>
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Reason (3–280 chars)"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      loading={cancelMutation.isPending}
                      onClick={() =>
                        cancelMutation.mutate({
                          id: selectedPlan.id,
                          reason: cancelReason,
                        })
                      }
                      disabled={cancelReason.length < 3}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Intents */}
              <DataTable
                rows={detail?.intents ?? []}
                columns={intentColumns}
                emptyMessage="No intents."
                rowKey={(i) => i.id}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs text-slate-500">
        Allocation targets live on{" "}
        <Link href="/portfolio/allocation" className="text-sky-700 hover:underline">
          Portfolio · Allocation
        </Link>
        . Governance approvals mint on{" "}
        <Link href="/governance/approvals" className="text-sky-700 hover:underline">
          Governance · Approvals
        </Link>
        .
      </p>
    </section>
  );
}
