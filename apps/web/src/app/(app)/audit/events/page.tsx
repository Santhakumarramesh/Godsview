"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { AuditEventQuery, AuditEventRow } from "@gv/types";

const PAGE = 50;

export default function AuditEventsPage() {
  const [filter, setFilter] = useState<AuditEventQuery>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const effectiveQuery: AuditEventQuery = {
    ...filter,
    limit: PAGE,
    beforeId: cursor ?? undefined,
  };

  const eventsQuery = useQuery({
    queryKey: ["audit", "events", effectiveQuery],
    queryFn: () => api.audit.listEvents(effectiveQuery),
  });

  const columns: ReadonlyArray<DataTableColumn<AuditEventRow>> = [
    { key: "ts", header: "Occurred", render: (e) => formatDate(e.occurredAt) },
    { key: "actor", header: "Actor", render: (e) => e.actorEmail ?? e.actorUserId ?? "system" },
    { key: "action", header: "Action", render: (e) => <code className="font-mono text-xs">{e.action}</code> },
    { key: "resource", header: "Resource", render: (e) => `${e.resourceType}${e.resourceId ? `:${e.resourceId.slice(0, 8)}` : ""}` },
    {
      key: "outcome",
      header: "Outcome",
      render: (e) => <Badge tone={e.outcome === "success" ? "success" : e.outcome === "denied" ? "danger" : "warn"}>{e.outcome}</Badge>,
    },
    { key: "ip", header: "Source IP", render: (e) => e.sourceIp ?? "—" },
    { key: "cid", header: "Correlation", render: (e) => <code className="font-mono text-xs">{e.correlationId.slice(0, 12)}…</code> },
  ];

  const next = eventsQuery.data?.nextCursor ?? null;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Audit · Events"
        description="Append-only audit log. Filter, paginate, and click an export to bundle a slice for compliance."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs font-medium text-slate-700">
              Action
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={filter.action ?? ""}
                onChange={(e) => {
                  setCursor(null);
                  setFilter({ ...filter, action: e.target.value || undefined });
                }}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Resource type
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={filter.resourceType ?? ""}
                onChange={(e) => {
                  setCursor(null);
                  setFilter({ ...filter, resourceType: e.target.value || undefined });
                }}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Outcome
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={filter.outcome ?? ""}
                onChange={(e) => {
                  setCursor(null);
                  setFilter({ ...filter, outcome: e.target.value || undefined });
                }}
              >
                <option value="">(any)</option>
                <option value="success">success</option>
                <option value="denied">denied</option>
                <option value="error">error</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Actor user ID
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={filter.actorUserId ?? ""}
                onChange={(e) => {
                  setCursor(null);
                  setFilter({ ...filter, actorUserId: e.target.value || undefined });
                }}
              />
            </label>
          </div>
        </CardBody>
      </Card>

      <DataTable
        rows={eventsQuery.data?.events ?? []}
        columns={columns}
        loading={eventsQuery.isLoading}
        error={eventsQuery.error ? pickErrorMessage(eventsQuery.error) : null}
        emptyMessage="No audit events for this filter"
        rowKey={(e) => e.id}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {eventsQuery.data?.events.length ?? 0} shown · total {eventsQuery.data?.total ?? 0}
        </span>
        <div className="flex gap-2">
          {cursor ? (
            <Button variant="secondary" size="sm" onClick={() => setCursor(null)}>
              Reset
            </Button>
          ) : null}
          {next ? (
            <Button size="sm" onClick={() => setCursor(next)}>
              Older →
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
