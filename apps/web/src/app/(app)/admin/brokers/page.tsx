"use client";

/**
 * Admin · Brokers — Phase 7 PR7 surface.
 *
 * Wires three control-plane routes:
 *
 *   GET  /v1/brokers/adapters          → BrokerAdaptersList
 *   GET  /v1/brokers/registry          → BrokerRegistrySummary
 *   POST /v1/brokers/adapters/:id/probe → BrokerHealthSnapshot
 *
 * Layout:
 *   ▸ quorum strip (healthy / degraded / down + live-routable)
 *   ▸ adapter table (kind, role, host, status, liveEnabled, probeEnabled,
 *     latency, last probe, actions)
 *
 * Probe is admin-gated server-side; the button fires the mutation and
 * invalidates both the registry and adapter queries so the new snapshot
 * is reflected in the table. Role/liveEnabled/probeEnabled toggles are
 * out of scope for this page — they route through the dedicated update
 * surface (requires paired governance approval).
 */

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  BrokerAdapter,
  BrokerAdapterStatus,
  BrokerHealthSnapshot,
} from "@gv/types";

const STATUS_TONE: Record<BrokerAdapterStatus, "success" | "warn" | "danger" | "neutral"> = {
  healthy: "success",
  degraded: "warn",
  down: "danger",
  unknown: "neutral",
};

function formatMs(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} ms`;
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function AdminBrokersPage() {
  const qc = useQueryClient();

  const registryQuery = useQuery({
    queryKey: ["brokers", "registry"],
    queryFn: () => api.brokers.adapters.registry(),
    refetchInterval: 30_000,
  });

  const adaptersQuery = useQuery({
    queryKey: ["brokers", "adapters"],
    queryFn: () => api.brokers.adapters.list(),
    refetchInterval: 30_000,
  });

  const healthQuery = useQuery({
    queryKey: ["brokers", "health", { limit: 200 }],
    queryFn: () => api.brokers.health.list({ limit: 200 }),
    refetchInterval: 30_000,
  });

  const probeMutation = useMutation({
    mutationFn: (id: string) => api.brokers.adapters.probe(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["brokers", "registry"] });
      void qc.invalidateQueries({ queryKey: ["brokers", "adapters"] });
      void qc.invalidateQueries({ queryKey: ["brokers", "health"] });
    },
  });

  // Index most-recent snapshot per adapter id for the table.
  const snapshotsByAdapter = new Map<string, BrokerHealthSnapshot>();
  for (const snap of healthQuery.data?.snapshots ?? []) {
    const existing = snapshotsByAdapter.get(snap.adapterId);
    if (!existing || existing.observedAt < snap.observedAt) {
      snapshotsByAdapter.set(snap.adapterId, snap);
    }
  }

  const adapters = adaptersQuery.data?.adapters ?? [];
  const registry = registryQuery.data;

  const columns: ReadonlyArray<DataTableColumn<BrokerAdapter>> = [
    {
      key: "displayName",
      header: "Name",
      render: (a) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{a.displayName}</span>
          <code className="font-mono text-[11px] text-slate-500">{a.id}</code>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (a) => (
        <span className="font-mono text-xs text-slate-700">
          {a.kind.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (a) => (
        <Badge tone={a.role === "primary" ? "info" : a.role === "secondary" ? "neutral" : "warn"}>
          {a.role}
        </Badge>
      ),
    },
    {
      key: "host",
      header: "Host",
      render: (a) => (
        <code className="font-mono text-[11px] text-slate-700">{a.host}</code>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>,
    },
    {
      key: "live",
      header: "Live",
      render: (a) => (
        <Badge tone={a.liveEnabled ? "success" : "neutral"}>
          {a.liveEnabled ? "enabled" : "paper-only"}
        </Badge>
      ),
    },
    {
      key: "probe",
      header: "Probe",
      render: (a) => (
        <Badge tone={a.probeEnabled ? "info" : "neutral"}>
          {a.probeEnabled ? "on" : "off"}
        </Badge>
      ),
    },
    {
      key: "latency",
      header: "p95 latency",
      render: (a) => {
        const snap = snapshotsByAdapter.get(a.id);
        return (
          <span className="font-mono text-xs text-slate-700">
            {formatMs(snap?.latencyP95Ms ?? null)}
          </span>
        );
      },
    },
    {
      key: "errorRate",
      header: "Error rate",
      render: (a) => {
        const snap = snapshotsByAdapter.get(a.id);
        if (!snap) return <span className="text-xs text-slate-400">—</span>;
        const pct = formatPct(snap.errorRate);
        return (
          <span
            className={`font-mono text-xs ${
              snap.errorRate > 0.05
                ? "text-rose-700"
                : snap.errorRate > 0.01
                  ? "text-amber-700"
                  : "text-slate-700"
            }`}
          >
            {pct}
          </span>
        );
      },
    },
    {
      key: "lastProbe",
      header: "Last probe",
      render: (a) => {
        const snap = snapshotsByAdapter.get(a.id);
        return (
          <span className="text-[11px] text-slate-500">
            {formatRelative(snap?.lastProbeAt ?? null)}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (a) => (
        <Button
          size="sm"
          variant="ghost"
          loading={probeMutation.isPending && probeMutation.variables === a.id}
          onClick={() => probeMutation.mutate(a.id)}
        >
          Probe now
        </Button>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Admin · Brokers"
        description="Multi-broker adapter registry. The live gate routes orders through the adapter picked by role + enabled + latest health snapshot. Adding or removing a live adapter routes through governance — only ad-hoc probes are exposed here."
      />

      {/* Quorum strip */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {registry ? (
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Total adapters
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {registry.quorum.total}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-emerald-700">
                Healthy
              </div>
              <div className="mt-1 font-mono text-sm text-emerald-700">
                {registry.quorum.healthy}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-amber-700">
                Degraded
              </div>
              <div className="mt-1 font-mono text-sm text-amber-700">
                {registry.quorum.degraded}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-rose-700">
                Down
              </div>
              <div className="mt-1 font-mono text-sm text-rose-700">
                {registry.quorum.down}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Live routable
              </div>
              <div className="mt-1">
                <Badge tone={registry.liveRoutable ? "success" : "danger"}>
                  {registry.liveRoutable ? "yes" : "no"}
                </Badge>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                Observed {formatRelative(registry.observedAt)}
              </div>
            </div>
          </div>
        ) : registryQuery.isLoading ? (
          <div className="text-xs text-slate-500">Loading registry…</div>
        ) : registryQuery.error ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {pickErrorMessage(registryQuery.error)}
          </div>
        ) : (
          <div className="text-xs text-slate-500">No registry data.</div>
        )}
      </section>

      {/* Adapter table */}
      <DataTable
        rows={adapters}
        columns={columns}
        loading={adaptersQuery.isLoading}
        error={adaptersQuery.error ? pickErrorMessage(adaptersQuery.error) : null}
        emptyMessage="No broker adapters registered."
        rowKey={(a) => a.id}
      />

      <p className="text-xs text-slate-500">
        Venue-level health lives on{" "}
        <Link href="/ops/venues" className="text-sky-700 hover:underline">
          Ops · Venues
        </Link>
        . Kill-switch state lives on{" "}
        <Link href="/execution/killswitch" className="text-sky-700 hover:underline">
          Execution · Kill switch
        </Link>
        .
      </p>
    </section>
  );
}
