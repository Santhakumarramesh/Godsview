"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { AuditEventRow } from "@gv/types";

/**
 * KV-changes view = audit events scoped to feature_flag and system_config
 * resources. The same backend query, with a narrower client-side filter.
 */
export default function AuditKvChangesPage() {
  const [resourceType, setResourceType] = useState<"feature_flag" | "system_config" | "">("");

  const eventsQuery = useQuery({
    queryKey: ["audit", "kv-changes", resourceType],
    queryFn: () =>
      api.audit.listEvents({
        resourceType: resourceType || undefined,
        limit: 200,
      }),
  });

  const filtered = useMemo(() => {
    const all = eventsQuery.data?.events ?? [];
    if (resourceType) return all;
    return all.filter((e) => e.resourceType === "feature_flag" || e.resourceType === "system_config");
  }, [eventsQuery.data, resourceType]);

  const columns: ReadonlyArray<DataTableColumn<AuditEventRow>> = [
    { key: "ts", header: "When", render: (e) => formatDate(e.occurredAt) },
    { key: "actor", header: "Actor", render: (e) => e.actorEmail ?? e.actorUserId ?? "system" },
    {
      key: "type",
      header: "Type",
      render: (e) => <Badge tone={e.resourceType === "feature_flag" ? "info" : "warn"}>{e.resourceType}</Badge>,
    },
    { key: "key", header: "Resource", render: (e) => e.resourceId ?? "—" },
    { key: "action", header: "Action", render: (e) => <code className="font-mono text-xs">{e.action}</code> },
    {
      key: "diff",
      header: "Diff",
      render: (e) =>
        Object.keys(e.details).length === 0 ? (
          <span className="text-xs text-slate-500">—</span>
        ) : (
          <pre className="max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">
            {JSON.stringify(e.details, null, 2)}
          </pre>
        ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Audit · KV Changes"
        description="Feature flag + system config mutations. Server filters by resource type; client default shows both."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Resource type
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value as typeof resourceType)}
          >
            <option value="">flag + config</option>
            <option value="feature_flag">feature_flag only</option>
            <option value="system_config">system_config only</option>
          </select>
        </label>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        loading={eventsQuery.isLoading}
        error={eventsQuery.error ? pickErrorMessage(eventsQuery.error) : null}
        emptyMessage="No KV mutations recorded"
        rowKey={(e) => e.id}
      />
    </section>
  );
}
