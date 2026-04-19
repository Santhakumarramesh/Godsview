"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { CreateMcpServerRequest, McpServer } from "@gv/types";

const TRANSPORTS = ["stdio", "http", "websocket"] as const;
const AUTH_MODES = ["none", "bearer", "secret_ref"] as const;

export default function AdminMcpPage() {
  const qc = useQueryClient();
  const serversQuery = useQuery({
    queryKey: ["admin", "mcp"],
    queryFn: () => api.mcp.list(),
  });

  const [draft, setDraft] = useState<CreateMcpServerRequest>({
    name: "",
    transport: "http",
    authMode: "none",
    scopes: [],
  });
  const [scopesText, setScopesText] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateMcpServerRequest) => api.mcp.create(payload),
    onSuccess: () => {
      setDraft({ name: "", transport: "http", authMode: "none", scopes: [] });
      setScopesText("");
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "mcp"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.mcp.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "mcp"] }),
  });

  const columns: ReadonlyArray<DataTableColumn<McpServer>> = [
    { key: "name", header: "Name", render: (s) => s.name },
    { key: "transport", header: "Transport", render: (s) => <Badge tone="info">{s.transport}</Badge> },
    {
      key: "endpoint",
      header: "Endpoint / Command",
      render: (s) => <code className="font-mono text-xs">{s.endpointUrl ?? s.command ?? "—"}</code>,
    },
    { key: "auth", header: "Auth", render: (s) => s.authMode },
    {
      key: "scopes",
      header: "Scopes",
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.scopes.length === 0 ? <span className="text-xs text-slate-500">—</span> : s.scopes.map((x) => <Badge key={x}>{x}</Badge>)}
        </div>
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (s) => <Badge tone={s.active ? "success" : "neutral"}>{s.active ? "active" : "inactive"}</Badge>,
    },
    { key: "updated", header: "Updated", render: (s) => formatDate(s.updatedAt) },
    {
      key: "actions",
      header: "",
      render: (s) =>
        s.active ? (
          <Button
            size="sm"
            variant="danger"
            loading={deactivateMutation.isPending && deactivateMutation.variables === s.id}
            onClick={() => deactivateMutation.mutate(s.id)}
          >
            Deactivate
          </Button>
        ) : null,
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    const scopes = scopesText.split(",").map((s) => s.trim()).filter(Boolean);
    const payload: CreateMcpServerRequest = { ...draft, scopes };
    if (!payload.endpointUrl) delete (payload as Partial<CreateMcpServerRequest>).endpointUrl;
    if (!payload.command) delete (payload as Partial<CreateMcpServerRequest>).command;
    if (!payload.secretRef) delete (payload as Partial<CreateMcpServerRequest>).secretRef;
    createMutation.mutate(payload);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Admin · MCP Servers"
        description="Registered Model Context Protocol servers. Each server's scopes gate which tools agents can call."
      />

      <DataTable
        rows={serversQuery.data?.servers ?? []}
        columns={columns}
        loading={serversQuery.isLoading}
        error={serversQuery.error ? pickErrorMessage(serversQuery.error) : null}
        emptyMessage="No MCP servers registered"
        rowKey={(s) => s.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Register an MCP server</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Name
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Transport
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.transport}
                onChange={(e) => setDraft({ ...draft, transport: e.target.value })}
              >
                {TRANSPORTS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Endpoint URL (http/ws)
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.endpointUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, endpointUrl: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Command (stdio)
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.command ?? ""}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Auth mode
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.authMode ?? "none"}
                onChange={(e) => setDraft({ ...draft, authMode: e.target.value })}
              >
                {AUTH_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Secret ref
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.secretRef ?? ""}
                onChange={(e) => setDraft({ ...draft, secretRef: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Scopes (comma-separated)
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={scopesText}
                onChange={(e) => setScopesText(e.target.value)}
              />
            </label>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Register
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
