"use client";

/**
 * Governance · Demotions — Phase 6 surface.
 *
 * Read-only derived view over two sources:
 *
 *   GET /v1/governance/approvals?action=strategy_demote           → approvals list
 *   GET /v1/governance/approvals?action=strategy_autonomous_demote → approvals list
 *   GET /v1/governance/approvals?action=strategy_retire           → approvals list
 *   GET /v1/governance/anomalies?source=strategy_drift            → anomaly list
 *   GET /v1/governance/anomalies?source=allocation_breach         → anomaly list
 *   GET /v1/governance/anomalies?source=kill_switch_tripped       → anomaly list
 *
 * "Demotion" is any event that moves a strategy down a tier — whether
 * by approval-gated manual action, auto-demotion from a Phase 5
 * calibration drift detector, or a kill-switch trip. This page is the
 * unified log: operators can drill into the source approval or
 * anomaly without hopping between surfaces.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  AnomalyAlert,
  GovernanceAction,
  GovernanceApproval,
} from "@gv/types";

type DemotionEntry = {
  id: string;
  kind: "approval" | "anomaly";
  at: string;
  strategyId: string | null;
  description: string;
  severity: "info" | "warn" | "danger";
  sourceLabel: string;
  href: string | null;
};

const DEMOTION_APPROVAL_ACTIONS: ReadonlyArray<GovernanceAction> = [
  "strategy_demote",
  "strategy_autonomous_demote",
  "strategy_retire",
];

const DEMOTION_ANOMALY_SOURCES = [
  "strategy_drift",
  "allocation_breach",
  "kill_switch_tripped",
] as const;

function severityForAnomaly(
  a: AnomalyAlert,
): "info" | "warn" | "danger" {
  if (a.severity === "critical" || a.severity === "error") return "danger";
  if (a.severity === "warn") return "warn";
  return "info";
}

function severityForApproval(
  a: GovernanceApproval,
): "info" | "warn" | "danger" {
  if (a.state === "rejected") return "danger";
  if (a.state === "pending") return "warn";
  return "info";
}

export default function GovernanceDemotionsPage() {
  const [strategyFilter, setStrategyFilter] = useState<string>("");

  // One query per demotion action — concatenated client-side.
  const demoteQ = useQuery({
    queryKey: ["governance", "approvals", "demotions", "strategy_demote"],
    queryFn: () =>
      api.governance.approvals.list({
        action: "strategy_demote",
        limit: 100,
      }),
    refetchInterval: 30_000,
  });
  const autoDemoteQ = useQuery({
    queryKey: [
      "governance",
      "approvals",
      "demotions",
      "strategy_autonomous_demote",
    ],
    queryFn: () =>
      api.governance.approvals.list({
        action: "strategy_autonomous_demote",
        limit: 100,
      }),
    refetchInterval: 30_000,
  });
  const retireQ = useQuery({
    queryKey: ["governance", "approvals", "demotions", "strategy_retire"],
    queryFn: () =>
      api.governance.approvals.list({
        action: "strategy_retire",
        limit: 100,
      }),
    refetchInterval: 30_000,
  });
  const driftQ = useQuery({
    queryKey: ["governance", "anomalies", "demotions", "strategy_drift"],
    queryFn: () =>
      api.governance.anomalies.list({
        source: "strategy_drift",
        limit: 100,
      }),
    refetchInterval: 30_000,
  });
  const allocQ = useQuery({
    queryKey: ["governance", "anomalies", "demotions", "allocation_breach"],
    queryFn: () =>
      api.governance.anomalies.list({
        source: "allocation_breach",
        limit: 100,
      }),
    refetchInterval: 30_000,
  });
  const killQ = useQuery({
    queryKey: [
      "governance",
      "anomalies",
      "demotions",
      "kill_switch_tripped",
    ],
    queryFn: () =>
      api.governance.anomalies.list({
        source: "kill_switch_tripped",
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  const entries: ReadonlyArray<DemotionEntry> = useMemo(() => {
    const rows: DemotionEntry[] = [];
    const approvalBuckets = [demoteQ.data, autoDemoteQ.data, retireQ.data];
    for (const bucket of approvalBuckets) {
      if (!bucket) continue;
      for (const a of bucket.approvals) {
        rows.push({
          id: `approval:${a.id}`,
          kind: "approval",
          at: a.requestedAt,
          strategyId: a.subjectKey,
          description: a.reason,
          severity: severityForApproval(a),
          sourceLabel: a.action.replaceAll("_", " "),
          href: `/governance/approvals?focus=${encodeURIComponent(a.id)}`,
        });
      }
    }
    const anomalyBuckets = [driftQ.data, allocQ.data, killQ.data];
    for (const bucket of anomalyBuckets) {
      if (!bucket) continue;
      for (const al of bucket.alerts) {
        rows.push({
          id: `anomaly:${al.id}`,
          kind: "anomaly",
          at: al.detectedAt,
          strategyId: al.subjectKey,
          description: al.message,
          severity: severityForAnomaly(al),
          sourceLabel: al.source.replaceAll("_", " "),
          href: `/governance/anomalies?focus=${encodeURIComponent(al.id)}`,
        });
      }
    }
    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    if (!strategyFilter.trim()) return rows;
    const needle = strategyFilter.trim().toLowerCase();
    return rows.filter((r) =>
      (r.strategyId ?? "").toLowerCase().includes(needle),
    );
  }, [
    demoteQ.data,
    autoDemoteQ.data,
    retireQ.data,
    driftQ.data,
    allocQ.data,
    killQ.data,
    strategyFilter,
  ]);

  const approvalCount =
    (demoteQ.data?.approvals.length ?? 0) +
    (autoDemoteQ.data?.approvals.length ?? 0) +
    (retireQ.data?.approvals.length ?? 0);
  const anomalyCount =
    (driftQ.data?.alerts.length ?? 0) +
    (allocQ.data?.alerts.length ?? 0) +
    (killQ.data?.alerts.length ?? 0);

  const anyLoading =
    demoteQ.isLoading ||
    autoDemoteQ.isLoading ||
    retireQ.isLoading ||
    driftQ.isLoading ||
    allocQ.isLoading ||
    killQ.isLoading;

  const firstError =
    demoteQ.error ||
    autoDemoteQ.error ||
    retireQ.error ||
    driftQ.error ||
    allocQ.error ||
    killQ.error;

  const columns: ReadonlyArray<DataTableColumn<DemotionEntry>> = [
    {
      key: "at",
      header: "When",
      render: (e) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(e.at)}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (e) => (
        <Badge
          tone={
            e.severity === "danger"
              ? "danger"
              : e.severity === "warn"
                ? "warn"
                : "info"
          }
        >
          {e.severity}
        </Badge>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (e) => (
        <Badge tone={e.kind === "approval" ? "info" : "warn"}>
          {e.kind === "approval" ? "approval" : "detector"}
        </Badge>
      ),
    },
    {
      key: "sourceLabel",
      header: "Trigger",
      render: (e) => (
        <span className="text-xs text-slate-900">{e.sourceLabel}</span>
      ),
    },
    {
      key: "strategyId",
      header: "Strategy",
      render: (e) => (
        <code className="font-mono text-xs text-slate-700">
          {e.strategyId ?? "—"}
        </code>
      ),
    },
    {
      key: "description",
      header: "Reason",
      render: (e) => (
        <span className="line-clamp-2 text-xs text-slate-800">
          {e.description}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      render: (e) =>
        e.href ? (
          <Link
            href={e.href}
            className="text-xs font-medium text-sky-700 hover:underline"
          >
            Open →
          </Link>
        ) : null,
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Governance · Demotions"
        description="Unified log of strategy demotions — whether approval-gated manual moves, auto-demotions from Phase 5 drift detectors, or kill-switch trips."
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
          href="/governance/anomalies"
          className="text-sky-700 hover:underline"
        >
          Governance · Anomalies
        </Link>
      </nav>

      {/* Filter + counts */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Strategy id (contains)
            <input
              type="text"
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              placeholder="liq_sweep · breakout_…"
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
            <Badge tone="info">{approvalCount} approvals</Badge>
            <Badge tone="warn">{anomalyCount} detector events</Badge>
            <span>{anyLoading ? "Loading…" : null}</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Demotion log ({entries.length})
          </h2>
        </div>
        {firstError ? (
          <div className="p-4 text-xs text-rose-700">
            {pickErrorMessage(firstError)}
          </div>
        ) : (
          <DataTable
            rows={entries}
            columns={columns}
            rowKey={(e) => e.id}
            emptyMessage="No demotion events recorded."
          />
        )}
      </section>
    </section>
  );
}
