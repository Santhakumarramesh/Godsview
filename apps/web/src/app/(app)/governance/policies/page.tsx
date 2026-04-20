"use client";

/**
 * Governance · Policies — Phase 6 surface.
 *
 * Wires three control-plane routes:
 *
 *   GET   /v1/governance/policies           → ApprovalPolicyList
 *   GET   /v1/governance/policies/:action   → ApprovalPolicy
 *   PATCH /v1/governance/policies/:action   → ApprovalPolicy
 *
 * Each canonical governance action (strategy promotion, kill-switch
 * toggle, allocation set, …) has one policy row: whether it requires
 * approval, minimum requester tier, approver count + tier, and TTL.
 * Edits themselves funnel through an `approval_policy_edit` approval
 * — the server returns 403 + `approvalId` when dual-control is
 * required; we surface the message so operators finish the flow in
 * /governance/approvals.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import type {
  ApprovalPolicy,
  ApprovalPolicyUpdate,
  GovernanceAction,
  TrustTier,
} from "@gv/types";

const TIER_TONE: Record<
  TrustTier,
  "neutral" | "info" | "warn" | "success" | "danger"
> = {
  readonly: "neutral",
  operator: "info",
  senior_operator: "info",
  admin: "warn",
  owner: "danger",
};

const TIER_OPTIONS: ReadonlyArray<TrustTier> = [
  "readonly",
  "operator",
  "senior_operator",
  "admin",
  "owner",
];

function prettyAction(a: GovernanceAction): string {
  return a.replaceAll("_", " ");
}

function prettyTier(t: TrustTier): string {
  return t.replaceAll("_", " ");
}

function formatTtl(seconds: number): string {
  if (seconds === 0) return "no expiry";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export default function GovernancePoliciesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;

  const [editing, setEditing] = useState<ApprovalPolicy | null>(null);
  const [editRequiresApproval, setEditRequiresApproval] = useState<boolean>(
    false,
  );
  const [editMinRequester, setEditMinRequester] = useState<TrustTier>(
    "operator",
  );
  const [editMinApprover, setEditMinApprover] = useState<TrustTier>(
    "senior_operator",
  );
  const [editApproverCount, setEditApproverCount] = useState<string>("1");
  const [editTtlSeconds, setEditTtlSeconds] = useState<string>("0");
  const [updateError, setUpdateError] = useState<string | null>(null);

  const policiesQuery = useQuery({
    queryKey: ["governance", "policies"],
    queryFn: () => api.governance.policies.list(),
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      action,
      patch,
    }: {
      action: GovernanceAction;
      patch: ApprovalPolicyUpdate;
    }) => api.governance.policies.update(action, patch),
    onSuccess: (updated: ApprovalPolicy) => {
      qc.invalidateQueries({ queryKey: ["governance", "policies"] });
      setEditing(null);
      setUpdateError(null);
      // Stash the updated row so the UI reflects the PATCH immediately.
      qc.setQueryData(
        ["governance", "policies", updated.action],
        updated,
      );
    },
    onError: (err) => setUpdateError(pickErrorMessage(err)),
  });

  const policies: ReadonlyArray<ApprovalPolicy> = useMemo(() => {
    const raw = policiesQuery.data?.policies ?? [];
    // Sort requires-approval first, then by action name.
    return [...raw].sort((a, b) => {
      if (a.requiresApproval !== b.requiresApproval) {
        return a.requiresApproval ? -1 : 1;
      }
      return a.action.localeCompare(b.action);
    });
  }, [policiesQuery.data]);

  function openEdit(p: ApprovalPolicy) {
    setEditing(p);
    setEditRequiresApproval(p.requiresApproval);
    setEditMinRequester(p.minRequesterTier);
    setEditMinApprover(p.minApproverTier);
    setEditApproverCount(String(p.approverCount));
    setEditTtlSeconds(String(p.ttlSeconds));
    setUpdateError(null);
  }

  function submitEdit() {
    if (!editing) return;
    const approverCount = Number.parseInt(editApproverCount, 10);
    const ttlSeconds = Number.parseInt(editTtlSeconds, 10);
    if (!Number.isFinite(approverCount) || approverCount < 1 || approverCount > 5) {
      return;
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0 || ttlSeconds > 30 * 24 * 3600) {
      return;
    }
    const patch: ApprovalPolicyUpdate = {
      requiresApproval: editRequiresApproval,
      minRequesterTier: editMinRequester,
      minApproverTier: editMinApprover,
      approverCount,
      ttlSeconds,
    };
    updateMutation.mutate({ action: editing.action, patch });
  }

  const columns: ReadonlyArray<DataTableColumn<ApprovalPolicy>> = [
    {
      key: "action",
      header: "Action",
      render: (p) => (
        <span className="font-medium text-xs text-slate-900">
          {prettyAction(p.action)}
        </span>
      ),
    },
    {
      key: "requiresApproval",
      header: "Gated",
      render: (p) =>
        p.requiresApproval ? (
          <Badge tone="warn">requires approval</Badge>
        ) : (
          <Badge tone="neutral">auto</Badge>
        ),
    },
    {
      key: "minRequesterTier",
      header: "Min requester",
      render: (p) => (
        <Badge tone={TIER_TONE[p.minRequesterTier]}>
          {prettyTier(p.minRequesterTier)}
        </Badge>
      ),
    },
    {
      key: "minApproverTier",
      header: "Min approver",
      render: (p) => (
        <Badge tone={TIER_TONE[p.minApproverTier]}>
          {prettyTier(p.minApproverTier)}
        </Badge>
      ),
    },
    {
      key: "approverCount",
      header: "# Approvers",
      render: (p) => (
        <span className="font-mono text-xs text-slate-900">
          {p.approverCount}
        </span>
      ),
    },
    {
      key: "ttlSeconds",
      header: "TTL",
      render: (p) => (
        <span className="font-mono text-xs text-slate-700">
          {formatTtl(p.ttlSeconds)}
        </span>
      ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      render: (p) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(p.updatedAt)}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      render: (p) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openEdit(p)}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Governance · Policies"
        description="One policy row per canonical governance action. Requires-approval, minimum requester + approver tiers, approver count, and request TTL. Edits themselves go through the approval queue."
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
          href="/governance/trust"
          className="text-sky-700 hover:underline"
        >
          Governance · Trust tiers
        </Link>
      </nav>

      {/* Summary */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Badge tone="warn">
            {policies.filter((p) => p.requiresApproval).length} gated
          </Badge>
          <Badge tone="neutral">
            {policies.filter((p) => !p.requiresApproval).length} auto
          </Badge>
          <Badge tone="info">{policies.length} total</Badge>
          <div className="ml-auto text-[11px] text-slate-500">
            {policiesQuery.isLoading ? "Loading…" : null}
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Policy map</h2>
        </div>
        {policiesQuery.error ? (
          <div className="p-4 text-xs text-rose-700">
            {pickErrorMessage(policiesQuery.error)}
          </div>
        ) : (
          <DataTable
            rows={policies}
            columns={columns}
            rowKey={(p) => p.action}
            emptyMessage="No policies configured."
          />
        )}
      </section>

      {/* Edit panel */}
      {editing ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Edit policy · {prettyAction(editing.action)}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              Close
            </Button>
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
              <label className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-2">
                <input
                  type="checkbox"
                  checked={editRequiresApproval}
                  onChange={(e) => setEditRequiresApproval(e.target.checked)}
                  disabled={!isAdmin}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-slate-900">
                    Requires approval
                  </div>
                  <div className="text-[11px] text-slate-600">
                    When unchecked, this action lands immediately with a
                    single audit-log row. When checked, the approval queue
                    gates the mutation.
                  </div>
                </div>
              </label>
              <label className="text-[11px] text-slate-700">
                Minimum requester tier
                <select
                  value={editMinRequester}
                  onChange={(e) =>
                    setEditMinRequester(e.target.value as TrustTier)
                  }
                  disabled={!isAdmin}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {prettyTier(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-700">
                Minimum approver tier
                <select
                  value={editMinApprover}
                  onChange={(e) =>
                    setEditMinApprover(e.target.value as TrustTier)
                  }
                  disabled={!isAdmin}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {prettyTier(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-700">
                Required approver count (1–5)
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={editApproverCount}
                  onChange={(e) => setEditApproverCount(e.target.value)}
                  disabled={!isAdmin}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-[11px] text-slate-700 md:col-span-2">
                Request TTL (seconds, 0 = no expiry, max 30d)
                <input
                  type="number"
                  min={0}
                  max={30 * 24 * 3600}
                  step={60}
                  value={editTtlSeconds}
                  onChange={(e) => setEditTtlSeconds(e.target.value)}
                  disabled={!isAdmin}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Current: {formatTtl(editing.ttlSeconds)} · pending:{" "}
                  {formatTtl(Number.parseInt(editTtlSeconds, 10) || 0)}
                </div>
              </label>
            </div>

            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
              Policy edits themselves funnel through an{" "}
              <code>approval_policy_edit</code> governance approval. If
              dual-control is required, this PATCH will return 403 with the
              pending approval id; finish the flow in{" "}
              <Link
                href="/governance/approvals"
                className="underline underline-offset-2"
              >
                /governance/approvals
              </Link>
              .
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={updateMutation.isPending}
                disabled={!isAdmin}
                onClick={submitEdit}
              >
                Submit edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>

            {updateError ? (
              <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                {updateError}
              </div>
            ) : null}
            {!isAdmin ? (
              <div className="text-[11px] text-slate-500">
                Policy edits require an admin role cookie.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
