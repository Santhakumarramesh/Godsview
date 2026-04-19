"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { AlertSeverity, Incident, IncidentStatus } from "@gv/types";

const SEV_TONE: Record<AlertSeverity, "neutral" | "warn" | "danger" | "info"> = {
  low: "neutral",
  medium: "info",
  high: "warn",
  critical: "danger",
};

const STATUS_ORDER: ReadonlyArray<IncidentStatus> = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];

export default function OpsIncidentsPage() {
  const qc = useQueryClient();
  const incidentsQuery = useQuery({
    queryKey: ["ops", "incidents"],
    queryFn: () => api.ops.listIncidents(),
  });

  const [draft, setDraft] = useState({
    code: "",
    title: "",
    severity: "medium" as AlertSeverity,
    summary: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: typeof draft) => api.ops.createIncident(payload),
    onSuccess: () => {
      setDraft({ code: "", title: "", severity: "medium", summary: "" });
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["ops", "incidents"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: IncidentStatus }) =>
      api.ops.updateIncident(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "incidents"] }),
  });

  const columns: ReadonlyArray<DataTableColumn<Incident>> = [
    { key: "code", header: "Code", render: (i) => <code className="font-mono text-xs">{i.code}</code> },
    { key: "title", header: "Title", render: (i) => i.title },
    { key: "severity", header: "Severity", render: (i) => <Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge> },
    {
      key: "status",
      header: "Status",
      render: (i) => (
        <select
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          value={i.status}
          disabled={transitionMutation.isPending && transitionMutation.variables?.id === i.id}
          onChange={(e) =>
            transitionMutation.mutate({ id: i.id, status: e.target.value as IncidentStatus })
          }
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      ),
    },
    { key: "opened", header: "Opened", render: (i) => formatDate(i.openedAt) },
    { key: "resolved", header: "Resolved", render: (i) => formatDate(i.resolvedAt) },
    {
      key: "postmortem",
      header: "Postmortem",
      render: (i) =>
        i.postmortemUrl ? (
          <a href={i.postmortemUrl} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
            link
          </a>
        ) : "—",
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    createMutation.mutate(draft);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · Incidents"
        description="Incident ledger with status transitions. Each transition is audit-logged."
      />

      <DataTable
        rows={incidentsQuery.data?.incidents ?? []}
        columns={columns}
        loading={incidentsQuery.isLoading}
        error={incidentsQuery.error ? pickErrorMessage(incidentsQuery.error) : null}
        emptyMessage="No incidents logged"
        rowKey={(i) => i.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Open an incident</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Code
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="INC-2026-001"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Severity
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.severity}
                onChange={(e) => setDraft({ ...draft, severity: e.target.value as AlertSeverity })}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Title
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Summary
              <textarea
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                rows={3}
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
            </label>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Open incident
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
