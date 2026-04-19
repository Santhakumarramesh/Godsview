"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { Alert, AlertSeverity, AlertStatus } from "@gv/types";

const SEVERITY_TONE: Record<AlertSeverity, "neutral" | "warn" | "danger" | "info"> = {
  low: "neutral",
  medium: "info",
  high: "warn",
  critical: "danger",
};

const STATUS_TONE: Record<AlertStatus, "neutral" | "warn" | "success"> = {
  open: "warn",
  acknowledged: "neutral",
  resolved: "success",
};

export default function OpsAlertsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<string>("");

  const alertsQuery = useQuery({
    queryKey: ["ops", "alerts", statusFilter, severityFilter],
    queryFn: () =>
      api.ops.listAlerts({
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
      }),
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => api.ops.acknowledgeAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "alerts"] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.ops.resolveAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "alerts"] }),
  });

  const columns: ReadonlyArray<DataTableColumn<Alert>> = [
    { key: "severity", header: "Severity", render: (a) => <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge> },
    { key: "status", header: "Status", render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
    { key: "slo", header: "SLO", render: (a) => a.sloKey ?? "—" },
    {
      key: "title",
      header: "Title",
      render: (a) => (
        <div className="max-w-md">
          <div className="font-medium text-slate-900">{a.title}</div>
          <div className="truncate text-xs text-slate-500">{a.description}</div>
        </div>
      ),
    },
    { key: "opened", header: "Opened", render: (a) => formatDate(a.openedAt) },
    { key: "acked", header: "Acked", render: (a) => formatDate(a.acknowledgedAt) },
    {
      key: "actions",
      header: "",
      render: (a) => (
        <div className="flex gap-2">
          {a.status === "open" ? (
            <Button
              size="sm"
              variant="secondary"
              loading={ackMutation.isPending && ackMutation.variables === a.id}
              onClick={() => ackMutation.mutate(a.id)}
            >
              Ack
            </Button>
          ) : null}
          {a.status !== "resolved" ? (
            <Button
              size="sm"
              loading={resolveMutation.isPending && resolveMutation.variables === a.id}
              onClick={() => resolveMutation.mutate(a.id)}
            >
              Resolve
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · Alerts"
        description="Active alert center. Filter by status or severity; ack/resolve actions are audit-logged."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Status
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">(any)</option>
            <option value="open">open</option>
            <option value="acknowledged">acknowledged</option>
            <option value="resolved">resolved</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Severity
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="">(any)</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>
      </div>

      <DataTable
        rows={alertsQuery.data?.alerts ?? []}
        columns={columns}
        loading={alertsQuery.isLoading}
        error={alertsQuery.error ? pickErrorMessage(alertsQuery.error) : null}
        emptyMessage="No alerts match this filter"
        rowKey={(a) => a.id}
      />
    </section>
  );
}
