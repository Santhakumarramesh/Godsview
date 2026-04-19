"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { Deployment } from "@gv/types";

const ENVS = ["local", "dev", "staging", "production"] as const;

export default function OpsDeploymentsPage() {
  const qc = useQueryClient();
  const [envFilter, setEnvFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");

  const deploymentsQuery = useQuery({
    queryKey: ["ops", "deployments", envFilter, serviceFilter],
    queryFn: () =>
      api.ops.listDeployments({
        environment: envFilter || undefined,
        service: serviceFilter || undefined,
      }),
  });

  const [draft, setDraft] = useState({
    service: "control_plane",
    version: "",
    environment: "staging",
    commitSha: "",
    initiator: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: typeof draft) =>
      api.ops.createDeployment({
        service: payload.service,
        version: payload.version,
        environment: payload.environment,
        commitSha: payload.commitSha || undefined,
        initiator: payload.initiator || undefined,
      }),
    onSuccess: () => {
      setDraft({ service: "control_plane", version: "", environment: "staging", commitSha: "", initiator: "" });
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["ops", "deployments"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const columns: ReadonlyArray<DataTableColumn<Deployment>> = [
    { key: "service", header: "Service", render: (d) => <code className="font-mono text-xs">{d.service}</code> },
    { key: "version", header: "Version", render: (d) => d.version },
    { key: "env", header: "Env", render: (d) => <Badge tone={d.environment === "production" ? "danger" : "info"}>{d.environment}</Badge> },
    { key: "status", header: "Status", render: (d) => <Badge>{d.status}</Badge> },
    { key: "sha", header: "SHA", render: (d) => d.commitSha ? <code className="font-mono text-xs">{d.commitSha.slice(0, 7)}</code> : "—" },
    { key: "initiator", header: "Initiator", render: (d) => d.initiator ?? "—" },
    { key: "started", header: "Started", render: (d) => formatDate(d.startedAt) },
    { key: "finished", header: "Finished", render: (d) => formatDate(d.finishedAt) },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    createMutation.mutate(draft);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · Deployments"
        description="Deployment ledger. Every rollout is audit-logged; production deploys always surface the commit SHA."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Environment
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
          >
            <option value="">(any)</option>
            {ENVS.map((env) => (
              <option key={env} value={env}>{env}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Service
          <input
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={serviceFilter}
            placeholder="control_plane"
            onChange={(e) => setServiceFilter(e.target.value)}
          />
        </label>
      </div>

      <DataTable
        rows={deploymentsQuery.data?.deployments ?? []}
        columns={columns}
        loading={deploymentsQuery.isLoading}
        error={deploymentsQuery.error ? pickErrorMessage(deploymentsQuery.error) : null}
        emptyMessage="No deployments recorded"
        rowKey={(d) => d.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Record a deployment</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Service
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.service}
                onChange={(e) => setDraft({ ...draft, service: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Version
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="2.1.0"
                value={draft.version}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Environment
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.environment}
                onChange={(e) => setDraft({ ...draft, environment: e.target.value })}
              >
                {ENVS.map((env) => (
                  <option key={env} value={env}>{env}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Commit SHA
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.commitSha}
                onChange={(e) => setDraft({ ...draft, commitSha: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Initiator
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.initiator}
                onChange={(e) => setDraft({ ...draft, initiator: e.target.value })}
                placeholder="user@godsview.dev or ci:github-actions"
              />
            </label>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Record deployment
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
