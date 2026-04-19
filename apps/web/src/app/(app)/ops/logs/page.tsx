"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { LogLevel, LogLine } from "@gv/types";

const LEVEL_TONE: Record<LogLevel, "neutral" | "info" | "warn" | "danger"> = {
  debug: "neutral",
  info: "info",
  warning: "warn",
  error: "danger",
};

export default function OpsLogsPage() {
  const [level, setLevel] = useState<string>("");
  const [limit, setLimit] = useState<number>(100);

  const logsQuery = useQuery({
    queryKey: ["ops", "logs", level, limit],
    queryFn: () => api.ops.tailLogs({ level: level || undefined, limit }),
    refetchInterval: 10_000,
  });

  const columns: ReadonlyArray<DataTableColumn<LogLine>> = [
    { key: "ts", header: "Timestamp", render: (l) => formatDate(l.timestamp) },
    { key: "level", header: "Level", render: (l) => <Badge tone={LEVEL_TONE[l.level]}>{l.level}</Badge> },
    { key: "source", header: "Source", render: (l) => <code className="font-mono text-xs">{l.source}</code> },
    { key: "actor", header: "Actor", render: (l) => l.actorEmail ?? "—" },
    {
      key: "cid",
      header: "Correlation",
      render: (l) =>
        l.correlationId ? <code className="font-mono text-xs">{l.correlationId.slice(0, 12)}…</code> : "—",
    },
    { key: "message", header: "Message", render: (l) => <span className="text-slate-800">{l.message}</span> },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · Logs"
        description="Structured log tail, derived from the audit log. Auto-refreshes every 10 seconds."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Level
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">(any)</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Limit
          <input
            type="number"
            min={10}
            max={500}
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </label>
      </div>

      <DataTable
        rows={logsQuery.data?.lines ?? []}
        columns={columns}
        loading={logsQuery.isLoading}
        error={logsQuery.error ? pickErrorMessage(logsQuery.error) : null}
        emptyMessage="No logs"
        rowKey={(l) => `${l.timestamp}:${l.correlationId ?? ""}:${l.source}`}
      />
    </section>
  );
}
