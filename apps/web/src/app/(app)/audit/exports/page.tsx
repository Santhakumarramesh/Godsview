"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { AuditExport, CreateAuditExportRequest } from "@gv/types";

const STATUS_TONE: Record<AuditExport["status"], "neutral" | "warn" | "info" | "success" | "danger"> = {
  pending: "neutral",
  running: "warn",
  ready: "success",
  failed: "danger",
};

export default function AuditExportsPage() {
  const qc = useQueryClient();
  const exportsQuery = useQuery({
    queryKey: ["audit", "exports"],
    queryFn: () => api.audit.listExports(),
    refetchInterval: 5_000,
  });

  const [format, setFormat] = useState<"csv" | "jsonl">("csv");
  const [actionFilter, setActionFilter] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateAuditExportRequest) => api.audit.createExport(payload),
    onSuccess: () => {
      setActionFilter("");
      setResourceTypeFilter("");
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["audit", "exports"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const columns: ReadonlyArray<DataTableColumn<AuditExport>> = [
    { key: "id", header: "ID", render: (e) => <code className="font-mono text-xs">{e.id.slice(0, 12)}</code> },
    { key: "format", header: "Format", render: (e) => <Badge tone="info">{e.format}</Badge> },
    { key: "status", header: "Status", render: (e) => <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge> },
    { key: "rows", header: "Rows", render: (e) => e.rowCount?.toString() ?? "—" },
    { key: "requested", header: "Requested", render: (e) => formatDate(e.requestedAt) },
    { key: "completed", header: "Completed", render: (e) => formatDate(e.completedAt) },
    { key: "by", header: "By", render: (e) => <code className="font-mono text-xs">{e.requestedBy.slice(0, 12)}</code> },
    {
      key: "download",
      header: "Artifact",
      render: (e) =>
        e.status === "ready" && e.downloadUrl ? (
          <a className="text-sky-700 hover:underline" href={e.downloadUrl} rel="noreferrer">
            download
          </a>
        ) : "—",
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    const filters: Record<string, string> = {};
    if (actionFilter) filters.action = actionFilter;
    if (resourceTypeFilter) filters.resourceType = resourceTypeFilter;
    createMutation.mutate({ format, filters });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Audit · Exports"
        description="Schedule signed CSV/JSONL bundles of audit events. Download links are 15-minute HMAC-signed URLs."
      />

      <DataTable
        rows={exportsQuery.data?.exports ?? []}
        columns={columns}
        loading={exportsQuery.isLoading}
        error={exportsQuery.error ? pickErrorMessage(exportsQuery.error) : null}
        emptyMessage="No exports requested yet"
        rowKey={(e) => e.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Request an export</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Format
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={format}
                onChange={(e) => setFormat(e.target.value as "csv" | "jsonl")}
              >
                <option value="csv">csv</option>
                <option value="jsonl">jsonl</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Filter: action prefix
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Filter: resource type
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={resourceTypeFilter}
                onChange={(e) => setResourceTypeFilter(e.target.value)}
              />
            </label>
            {createError ? (
              <div className="md:col-span-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-3">
              <Button type="submit" loading={createMutation.isPending}>
                Request export
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
