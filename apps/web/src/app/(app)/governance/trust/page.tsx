"use client";

/**
 * Governance · Trust tiers — Phase 6 surface.
 *
 * Wires three control-plane routes:
 *
 *   GET  /v1/governance/trust            → TrustRegistryList
 *   GET  /v1/governance/trust/:userId    → TrustRegistryEntry
 *   POST /v1/governance/trust            → TrustRegistryEntry (assign)
 *
 * Each user has a current tier and an append-only tier-change history.
 * The assign endpoint is admin-gated and, if the target tier is
 * `admin` or `owner`, requires a `trust_tier_change` governance
 * approval to land. The server returns 403 + `approvalId` on the
 * mutation when dual-control is required; we surface the message so
 * operators know to finish the flow in /governance/approvals.
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
  AssignTrustTierRequest,
  TrustRegistryEntry,
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

const TIER_RANK: Record<TrustTier, number> = {
  readonly: 0,
  operator: 1,
  senior_operator: 2,
  admin: 3,
  owner: 4,
};

function prettyTier(t: TrustTier): string {
  return t.replaceAll("_", " ");
}

export default function GovernanceTrustPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;

  const [tierFilter, setTierFilter] = useState<TrustTier | "">("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [editTier, setEditTier] = useState<TrustTier>("operator");
  const [editReason, setEditReason] = useState<string>("");
  const [assignError, setAssignError] = useState<string | null>(null);

  const registryQuery = useQuery({
    queryKey: ["governance", "trust"],
    queryFn: () => api.governance.trust.list(),
    refetchInterval: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ["governance", "trust", "detail", selectedUserId],
    queryFn: () => api.governance.trust.get(selectedUserId as string),
    enabled: Boolean(selectedUserId),
    refetchInterval: selectedUserId ? 30_000 : false,
  });

  const assignMutation = useMutation({
    mutationFn: (req: AssignTrustTierRequest) =>
      api.governance.trust.assign(req),
    onSuccess: (updated: TrustRegistryEntry) => {
      qc.setQueryData(
        ["governance", "trust", "detail", updated.userId],
        updated,
      );
      qc.invalidateQueries({ queryKey: ["governance", "trust"] });
      setEditReason("");
      setAssignError(null);
    },
    onError: (err) => setAssignError(pickErrorMessage(err)),
  });

  const allEntries: ReadonlyArray<TrustRegistryEntry> =
    registryQuery.data?.entries ?? [];

  const entries = useMemo(() => {
    const filtered = tierFilter
      ? allEntries.filter((e) => e.currentTier === tierFilter)
      : allEntries;
    return [...filtered].sort(
      (a, b) => TIER_RANK[b.currentTier] - TIER_RANK[a.currentTier],
    );
  }, [allEntries, tierFilter]);

  const detail = detailQuery.data;

  const columns: ReadonlyArray<DataTableColumn<TrustRegistryEntry>> = [
    {
      key: "userId",
      header: "User",
      render: (e) => (
        <code className="font-mono text-xs text-slate-900">{e.userId}</code>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (e) => (
        <span className="text-xs text-slate-700">{e.email ?? "—"}</span>
      ),
    },
    {
      key: "currentTier",
      header: "Tier",
      render: (e) => (
        <Badge tone={TIER_TONE[e.currentTier]}>
          {prettyTier(e.currentTier)}
        </Badge>
      ),
    },
    {
      key: "history",
      header: "Changes",
      render: (e) => (
        <span className="font-mono text-xs text-slate-700">
          {e.history.length}
        </span>
      ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      render: (e) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(e.updatedAt)}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      render: (e) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelectedUserId(e.userId);
            setEditTier(e.currentTier);
            setEditReason("");
            setAssignError(null);
          }}
        >
          Inspect
        </Button>
      ),
    },
  ];

  function submitAssign() {
    if (!selectedUserId) return;
    if (editReason.trim().length < 3) return;
    assignMutation.mutate({
      userId: selectedUserId,
      tier: editTier,
      reason: editReason.trim(),
    });
  }

  const requiresDualControl =
    editTier === "admin" || editTier === "owner";

  return (
    <section className="space-y-6">
      <PageHeader
        title="Governance · Trust tiers"
        description="Per-user trust registry. Tier drives which actions a principal can take directly vs. which require approval. admin/owner promotions land via the approval queue."
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
          href="/governance/policies"
          className="text-sky-700 hover:underline"
        >
          Governance · Policies
        </Link>
      </nav>

      {/* Filter + counts */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Tier
            <select
              value={tierFilter}
              onChange={(e) =>
                setTierFilter(e.target.value as TrustTier | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All tiers</option>
              {TIER_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {prettyTier(t)}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto text-[11px] text-slate-500">
            {registryQuery.isLoading
              ? "Loading…"
              : `${entries.length} / ${allEntries.length} users`}
          </div>
        </div>
        {/* Tier distribution */}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
          {TIER_OPTIONS.map((t) => {
            const count = allEntries.filter(
              (e) => e.currentTier === t,
            ).length;
            return (
              <Badge key={t} tone={TIER_TONE[t]}>
                {prettyTier(t)} · {count}
              </Badge>
            );
          })}
        </div>
      </section>

      {/* Registry table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Registry</h2>
        </div>
        {registryQuery.error ? (
          <div className="p-4 text-xs text-rose-700">
            {pickErrorMessage(registryQuery.error)}
          </div>
        ) : (
          <DataTable
            rows={entries}
            columns={columns}
            rowKey={(e) => e.userId}
            emptyMessage="No users match the current filter."
          />
        )}
      </section>

      {/* Detail + assign */}
      {selectedUserId ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              User {selectedUserId}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedUserId(null)}
            >
              Close
            </Button>
          </div>
          {detailQuery.isLoading ? (
            <div className="p-4 text-xs text-slate-500">Loading user…</div>
          ) : detailQuery.error ? (
            <div className="p-4 text-xs text-rose-700">
              {pickErrorMessage(detailQuery.error)}
            </div>
          ) : detail ? (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Current tier
                  </div>
                  <div className="mt-1">
                    <Badge tone={TIER_TONE[detail.currentTier]}>
                      {prettyTier(detail.currentTier)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Email
                  </div>
                  <div className="mt-1 text-slate-900">
                    {detail.email ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Updated
                  </div>
                  <div className="mt-1 text-slate-900">
                    {formatDate(detail.updatedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    History entries
                  </div>
                  <div className="mt-1 font-mono text-slate-900">
                    {detail.history.length}
                  </div>
                </div>
              </div>

              {/* History list */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Tier history (most recent first)
                </div>
                {detail.history.length === 0 ? (
                  <div className="mt-1 text-xs text-slate-500">
                    No tier changes recorded.
                  </div>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {[...detail.history]
                      .sort(
                        (a, b) =>
                          new Date(b.assignedAt).getTime() -
                          new Date(a.assignedAt).getTime(),
                      )
                      .map((h, idx) => (
                        <li
                          key={`${h.assignedAt}-${idx}`}
                          className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <Badge tone={TIER_TONE[h.tier]}>
                              {prettyTier(h.tier)}
                            </Badge>
                            <span className="text-[11px] text-slate-500">
                              {formatRelative(h.assignedAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600">
                            by{" "}
                            <code className="font-mono">
                              {h.assignedByUserId}
                            </code>{" "}
                            — {h.reason}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {/* Assign form (admin-gated) */}
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-900">
                  Assign tier
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="text-[11px] text-slate-700">
                    New tier
                    <select
                      value={editTier}
                      onChange={(e) =>
                        setEditTier(e.target.value as TrustTier)
                      }
                      className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      disabled={!isAdmin}
                    >
                      {TIER_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {prettyTier(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-700">
                    Reason (min 3 chars)
                    <input
                      type="text"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      disabled={!isAdmin}
                      className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="promotion justification"
                    />
                  </label>
                </div>
                {requiresDualControl ? (
                  <div className="mt-2 text-[11px] text-amber-800">
                    {prettyTier(editTier)} assignments land as a{" "}
                    <code>trust_tier_change</code> approval request. Another
                    approver must sign off in{" "}
                    <Link
                      href="/governance/approvals"
                      className="underline underline-offset-2"
                    >
                      /governance/approvals
                    </Link>{" "}
                    before it takes effect.
                  </div>
                ) : null}
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!isAdmin || editReason.trim().length < 3}
                    loading={assignMutation.isPending}
                    onClick={submitAssign}
                  >
                    Assign
                  </Button>
                </div>
                {assignError ? (
                  <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                    {assignError}
                  </div>
                ) : null}
                {!isAdmin ? (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Tier changes require an admin role cookie. Ask an admin
                    to make the change — the server will 403 otherwise.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
