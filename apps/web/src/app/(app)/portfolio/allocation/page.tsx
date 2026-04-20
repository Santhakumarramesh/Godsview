"use client";

/**
 * Portfolio · Allocation — Phase 6 surface.
 *
 * Wires four control-plane routes:
 *
 *   GET  /v1/portfolio/accounts              → PortfolioAccountsList
 *   GET  /v1/portfolio/allocation            → AllocationPlan
 *   POST /v1/portfolio/allocation            → AllocationPlan (setTarget)
 *   POST /v1/portfolio/allocation/rebalance  → AllocationPlan (rebalance all)
 *
 * The allocation plan pairs operator-set `targetPercent` with the live
 * `actualPercent` walked from the Phase 4 execution ledger. `deltaR` is
 * the R swing needed to re-balance; positive = under-allocated.
 *
 * Writes require an admin cookie; the server returns 403 otherwise and
 * the mutation surfaces the message in-place.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  AllocationPlan,
  AllocationSource,
  AllocationUpdateRequest,
  StrategyAllocation,
} from "@gv/types";

const TIER_TONE: Record<"A" | "B" | "C", "success" | "info" | "warn"> = {
  A: "success",
  B: "info",
  C: "warn",
};

const PROMOTION_TONE: Record<
  StrategyAllocation["promotionState"],
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  experimental: "neutral",
  paper: "info",
  assisted_live: "warn",
  autonomous: "success",
  retired: "danger",
};

const SOURCE_TONE: Record<AllocationSource, "success" | "info" | "warn"> = {
  operator: "success",
  automated: "info",
  inherited_default: "warn",
};

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatR(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}R`;
}

export default function PortfolioAllocationPage() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState<string>("");
  const [editing, setEditing] = useState<StrategyAllocation | null>(null);
  const [editTarget, setEditTarget] = useState<string>("");
  const [editReason, setEditReason] = useState<string>("");
  const [rebalanceError, setRebalanceError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["portfolio", "accounts"],
    queryFn: () => api.portfolio.accounts.list(),
    staleTime: 60_000,
  });

  const planQuery = useQuery({
    queryKey: ["portfolio", "allocation", accountId || null],
    queryFn: () =>
      api.portfolio.allocation.plan(accountId ? { accountId } : {}),
    refetchInterval: 30_000,
  });

  const setMutation = useMutation({
    mutationFn: (req: AllocationUpdateRequest) =>
      api.portfolio.allocation.setAllocation(req),
    onSuccess: (plan: AllocationPlan) => {
      qc.setQueryData(["portfolio", "allocation", accountId || null], plan);
      setEditing(null);
      setEditTarget("");
      setEditReason("");
    },
  });

  const rebalanceMutation = useMutation({
    mutationFn: () =>
      api.portfolio.allocation.rebalance(
        accountId ? { accountId } : undefined,
      ),
    onSuccess: (plan: AllocationPlan) => {
      qc.setQueryData(["portfolio", "allocation", accountId || null], plan);
      setRebalanceError(null);
    },
    onError: (err) => setRebalanceError(pickErrorMessage(err)),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const plan = planQuery.data;

  const strategies: ReadonlyArray<StrategyAllocation> = useMemo(() => {
    if (!plan) return [];
    // Sort by largest target first so the biggest allocations are up top.
    return [...plan.strategies].sort(
      (a, b) => b.targetPercent - a.targetPercent,
    );
  }, [plan]);

  const columns: ReadonlyArray<DataTableColumn<StrategyAllocation>> = [
    {
      key: "strategyId",
      header: "Strategy",
      render: (s) => (
        <code className="font-mono text-xs text-slate-900">{s.strategyId}</code>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      render: (s) => <Badge tone={TIER_TONE[s.tier]}>Tier {s.tier}</Badge>,
    },
    {
      key: "promotionState",
      header: "State",
      render: (s) => (
        <Badge tone={PROMOTION_TONE[s.promotionState]}>
          {s.promotionState.replaceAll("_", " ")}
        </Badge>
      ),
    },
    {
      key: "dnaTier",
      header: "DNA",
      render: (s) =>
        s.dnaTier ? (
          <Badge tone={TIER_TONE[s.dnaTier]}>{s.dnaTier}</Badge>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "targetPercent",
      header: "Target",
      render: (s) => (
        <span className="font-mono text-xs text-slate-900">
          {formatPct(s.targetPercent)}
        </span>
      ),
    },
    {
      key: "actualPercent",
      header: "Actual",
      render: (s) => (
        <span className="font-mono text-xs text-slate-700">
          {formatPct(s.actualPercent)}
        </span>
      ),
    },
    {
      key: "deltaR",
      header: "ΔR to rebalance",
      render: (s) => (
        <span
          className={`font-mono text-xs ${
            Math.abs(s.deltaR) < 0.1
              ? "text-slate-500"
              : s.deltaR > 0
                ? "text-emerald-700"
                : "text-rose-700"
          }`}
        >
          {formatR(s.deltaR)}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (s) => <Badge tone={SOURCE_TONE[s.source]}>{s.source}</Badge>,
    },
    {
      key: "reviewedAt",
      header: "Reviewed",
      render: (s) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(s.reviewedAt)}
        </span>
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
            setEditing(s);
            setEditTarget((s.targetPercent * 100).toFixed(1));
            setEditReason("");
          }}
        >
          Set target
        </Button>
      ),
    },
  ];

  function submitEdit() {
    if (!editing) return;
    const raw = Number.parseFloat(editTarget);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return;
    }
    if (editReason.trim().length < 3) return;
    setMutation.mutate({
      strategyId: editing.strategyId,
      targetPercent: raw / 100,
      reason: editReason.trim(),
    });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Portfolio · Allocation"
        description="Capital allocation targets per strategy. Admin-gated mutations retarget a single strategy or re-balance the full plan from current equity + active tiers."
      />

      {/* Filters + global actions */}
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
              <option value="">Default account</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.displayName} · {a.provider}
                  {a.liveEnabled ? " · live" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-3">
            {plan ? (
              <div className="text-[11px] text-slate-500">
                Observed {formatRelative(plan.observedAt)}
              </div>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              loading={rebalanceMutation.isPending}
              onClick={() => rebalanceMutation.mutate()}
            >
              Rebalance all
            </Button>
          </div>
        </div>
        {rebalanceError ? (
          <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
            Rebalance failed: {rebalanceError}
          </div>
        ) : null}
      </section>

      {/* Plan summary */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {plan ? (
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Strategies
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {plan.strategies.length}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Total target
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {formatPct(plan.totalTargetPercent)}
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                target budget is [50%, 100%]
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Total actual
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {formatPct(plan.totalActualPercent)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                In policy
              </div>
              <div className="mt-1">
                {plan.inPolicy ? (
                  <Badge tone="success">in policy</Badge>
                ) : (
                  <Badge tone="danger">out of policy</Badge>
                )}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">
                {plan.warnings.length} warning
                {plan.warnings.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        ) : planQuery.isLoading ? (
          <div className="text-xs text-slate-500">Loading allocation plan…</div>
        ) : planQuery.error ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {pickErrorMessage(planQuery.error)}
          </div>
        ) : (
          <div className="text-xs text-slate-500">No allocation plan yet.</div>
        )}
      </section>

      {/* Warnings */}
      {plan && plan.warnings.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Allocation warnings
          </h2>
          <ul className="mt-2 space-y-1">
            {plan.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-800">
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
                </Badge>{" "}
                <span className="ml-1 font-medium">{w.code}</span>
                {w.subjectKey ? (
                  <code className="ml-2 font-mono text-[11px]">{w.subjectKey}</code>
                ) : null}
                <span className="ml-2">{w.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Per-strategy table */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Strategy allocation
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Largest target first. <code className="font-mono">ΔR</code> is the R
            swing needed to bring actual to target; positive means
            under-allocated.
          </p>
        </header>
        <DataTable
          rows={strategies}
          columns={columns}
          loading={planQuery.isLoading}
          error={planQuery.error ? pickErrorMessage(planQuery.error) : null}
          emptyMessage="No strategy allocations yet."
          rowKey={(s) => s.strategyId}
        />
      </section>

      {/* Edit panel */}
      {editing ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-sky-900">
              Set target for{" "}
              <code className="font-mono">{editing.strategyId}</code>
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setEditTarget("");
                setEditReason("");
              }}
            >
              Cancel
            </Button>
          </header>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs font-medium text-slate-700">
              Target %
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={editTarget}
                onChange={(e) => setEditTarget(e.target.value)}
                className="mt-1 block w-full rounded border border-sky-300 bg-white px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Reason (required, ≥3 chars — recorded in audit log)
              <input
                type="text"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. downsizing after drawdown / raising after promotion"
                className="mt-1 block w-full rounded border border-sky-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              loading={setMutation.isPending}
              onClick={submitEdit}
              disabled={editReason.trim().length < 3 || !editTarget}
            >
              Save target
            </Button>
            {setMutation.error ? (
              <span className="text-[11px] text-rose-700">
                {pickErrorMessage(setMutation.error)}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <p className="text-xs text-slate-500">
        Strategy tiers feed this table from{" "}
        <Link href="/governance/trust" className="text-sky-700 hover:underline">
          Governance · Trust tiers
        </Link>
        . DNA drift lives on{" "}
        <Link href="/intel/dna" className="text-sky-700 hover:underline">
          Intelligence · DNA
        </Link>
        . Autonomy state — which gates a strategy onto the live bus — lives on{" "}
        <Link href="/admin/autonomy" className="text-sky-700 hover:underline">
          Admin · Autonomy
        </Link>
        .
      </p>
    </section>
  );
}
