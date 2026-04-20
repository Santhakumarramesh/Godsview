"use client";

/**
 * Ops · Venues — Phase 7 PR7 surface.
 *
 * Wires four control-plane routes:
 *
 *   GET /v1/venue/registry           → VenueRegistrySummary
 *   GET /v1/venue/latency            → VenueLatencyReportsList
 *   GET /v1/venue/outages?open=true  → VenueOutageEventsList (open)
 *   POST /v1/venue/latency/probe     → VenueLatencyReport
 *   POST /v1/venue/outages/:id/close → VenueOutageEvent
 *
 * Layout:
 *   ▸ quorum strip (venues total / healthy / degraded / down / open outages)
 *   ▸ venue table (status, p50/p95/p99 latency, error rate, outage flag, last)
 *   ▸ open outage panel (venue, trigger, reason, started, close action)
 *
 * The kill-switch automatically flips on `probe_*` outages for `primary`
 * adapters; this page only handles the operator-declared close path.
 */

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  BrokerAdapterStatus,
  VenueLatencyReport,
  VenueOutageEvent,
  VenueRegistryRow,
} from "@gv/types";

const STATUS_TONE: Record<
  BrokerAdapterStatus,
  "success" | "warn" | "danger" | "neutral"
> = {
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

export default function OpsVenuesPage() {
  const qc = useQueryClient();
  const [closeReason, setCloseReason] = useState<Record<string, string>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  const registryQuery = useQuery({
    queryKey: ["venue", "registry"],
    queryFn: () => api.venue.registry.summary(),
    refetchInterval: 20_000,
  });

  const latencyQuery = useQuery({
    queryKey: ["venue", "latency", { limit: 200 }],
    queryFn: () => api.venue.latency.list({ limit: 200 }),
    refetchInterval: 30_000,
  });

  const outagesQuery = useQuery({
    queryKey: ["venue", "outages", { open: true }],
    queryFn: () => api.venue.outages.list({ open: true, limit: 100 }),
    refetchInterval: 20_000,
  });

  const probeMutation = useMutation({
    mutationFn: ({ venue, adapterId }: { venue: VenueLatencyReport["venue"]; adapterId?: string }) =>
      api.venue.latency.probe(venue, adapterId),
    onSuccess: () => {
      setMutationError(null);
      void qc.invalidateQueries({ queryKey: ["venue", "registry"] });
      void qc.invalidateQueries({ queryKey: ["venue", "latency"] });
    },
    onError: (err) => setMutationError(pickErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.venue.outages.close(id, reason),
    onSuccess: () => {
      setMutationError(null);
      void qc.invalidateQueries({ queryKey: ["venue", "outages"] });
      void qc.invalidateQueries({ queryKey: ["venue", "registry"] });
    },
    onError: (err) => setMutationError(pickErrorMessage(err)),
  });

  const registry = registryQuery.data;

  // Index most-recent latency row per venue for drilldown metrics.
  const latestByVenue = new Map<string, VenueLatencyReport>();
  for (const r of latencyQuery.data?.reports ?? []) {
    const key = r.venue;
    const existing = latestByVenue.get(key);
    if (!existing || existing.observedAt < r.observedAt) {
      latestByVenue.set(key, r);
    }
  }

  const rows: ReadonlyArray<VenueRegistryRow> = registry?.venues ?? [];

  const venueColumns: ReadonlyArray<DataTableColumn<VenueRegistryRow>> = [
    {
      key: "venue",
      header: "Venue",
      render: (r) => (
        <span className="font-mono text-xs text-slate-900">
          {r.venue.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "adapter",
      header: "Adapter",
      render: (r) =>
        r.adapterId ? (
          <code className="font-mono text-[11px] text-slate-700">{r.adapterId}</code>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: "p50",
      header: "p50",
      render: (r) => {
        const snap = latestByVenue.get(r.venue);
        return (
          <span className="font-mono text-xs text-slate-700">
            {formatMs(snap?.latencyP50Ms ?? null)}
          </span>
        );
      },
    },
    {
      key: "p95",
      header: "p95",
      render: (r) => (
        <span
          className={`font-mono text-xs ${
            r.latencyP95Ms != null && r.latencyP95Ms > 500
              ? "text-rose-700"
              : r.latencyP95Ms != null && r.latencyP95Ms > 250
                ? "text-amber-700"
                : "text-slate-700"
          }`}
        >
          {formatMs(r.latencyP95Ms)}
        </span>
      ),
    },
    {
      key: "p99",
      header: "p99",
      render: (r) => {
        const snap = latestByVenue.get(r.venue);
        return (
          <span className="font-mono text-xs text-slate-700">
            {formatMs(snap?.latencyP99Ms ?? null)}
          </span>
        );
      },
    },
    {
      key: "errorRate",
      header: "Err %",
      render: (r) => (
        <span
          className={`font-mono text-xs ${
            r.errorRate > 0.05
              ? "text-rose-700"
              : r.errorRate > 0.01
                ? "text-amber-700"
                : "text-slate-700"
          }`}
        >
          {formatPct(r.errorRate)}
        </span>
      ),
    },
    {
      key: "outage",
      header: "Outage",
      render: (r) =>
        r.outageOpen ? <Badge tone="danger">open</Badge> : <Badge tone="success">clear</Badge>,
    },
    {
      key: "last",
      header: "Last report",
      render: (r) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(r.lastReportAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          loading={
            probeMutation.isPending &&
            probeMutation.variables?.venue === r.venue
          }
          onClick={() =>
            probeMutation.mutate({
              venue: r.venue,
              adapterId: r.adapterId ?? undefined,
            })
          }
        >
          Probe
        </Button>
      ),
    },
  ];

  const outageColumns: ReadonlyArray<DataTableColumn<VenueOutageEvent>> = [
    {
      key: "venue",
      header: "Venue",
      render: (o) => (
        <span className="font-mono text-xs text-slate-900">
          {o.venue.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "adapter",
      header: "Adapter",
      render: (o) =>
        o.adapterId ? (
          <code className="font-mono text-[11px] text-slate-700">{o.adapterId}</code>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "trigger",
      header: "Trigger",
      render: (o) => (
        <span className="font-mono text-[11px] text-slate-700">
          {o.trigger.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (o) => (
        <span className="text-xs text-slate-700">{o.reason}</span>
      ),
    },
    {
      key: "killSwitch",
      header: "KS",
      render: (o) =>
        o.killSwitchEventId ? (
          <Badge tone="danger">tripped</Badge>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "startedAt",
      header: "Opened",
      render: (o) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(o.startedAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Close",
      render: (o) => {
        const value = closeReason[o.id] ?? "";
        return (
          <div className="flex items-center gap-2">
            <input
              className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Reason"
              value={value}
              onChange={(e) =>
                setCloseReason((m) => ({ ...m, [o.id]: e.target.value }))
              }
            />
            <Button
              size="sm"
              variant="danger"
              loading={
                closeMutation.isPending && closeMutation.variables?.id === o.id
              }
              onClick={() =>
                closeMutation.mutate({ id: o.id, reason: value })
              }
              disabled={value.length < 3}
            >
              Close
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · Venues"
        description="Per-venue health — round-trip latency, error rate, and outage state — consumed by the live gate and kill-switch. The probe cron writes a row per venue per minute; breaches raise anomalies and can trip the switch."
      />

      {mutationError ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          {mutationError}
        </div>
      ) : null}

      {/* Quorum strip */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {registry ? (
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Total venues
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
                Open outages
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {registry.openOutages}
              </div>
              <div className="font-mono text-[11px] text-slate-500">
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

      {/* Venue table */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Venues</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Most-recent probe snapshot per venue. The live gate blocks routes
            to any venue where the p95 breaches its configured ceiling — the
            per-venue ceiling lives under{" "}
            <code className="font-mono">venue.latency.ceiling.*</code> in
            system config.
          </p>
        </header>
        <DataTable
          rows={rows}
          columns={venueColumns}
          loading={registryQuery.isLoading}
          error={
            registryQuery.error ? pickErrorMessage(registryQuery.error) : null
          }
          emptyMessage="No venues registered."
          rowKey={(r) => r.venue}
        />
      </section>

      {/* Outage panel */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Open outages
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Active venue outages. Probe-detected outages close themselves when
            the probe series stabilises; operator-declared outages require the
            close action below. Closing an outage is admin-gated and audit-logged.
          </p>
        </header>
        <DataTable
          rows={outagesQuery.data?.events ?? []}
          columns={outageColumns}
          loading={outagesQuery.isLoading}
          error={
            outagesQuery.error ? pickErrorMessage(outagesQuery.error) : null
          }
          emptyMessage="No open outages — all venues are routable."
          rowKey={(o) => o.id}
        />
      </section>

      <p className="text-xs text-slate-500">
        Adapter-level health lives on{" "}
        <Link href="/admin/brokers" className="text-sky-700 hover:underline">
          Admin · Brokers
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
