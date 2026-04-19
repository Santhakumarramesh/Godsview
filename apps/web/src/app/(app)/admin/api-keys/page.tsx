"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { ApiKey, ApiKeyCreateResponse, CreateApiKeyRequest } from "@gv/types";

export default function AdminApiKeysPage() {
  const qc = useQueryClient();
  const keysQuery = useQuery({
    queryKey: ["admin", "api-keys"],
    queryFn: () => api.apiKeys.list(),
  });

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("");
  const [reveal, setReveal] = useState<ApiKeyCreateResponse | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateApiKeyRequest) => api.apiKeys.create(payload),
    onSuccess: (data) => {
      setReveal(data);
      setName("");
      setScopes("");
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.apiKeys.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "api-keys"] }),
  });

  const columns: ReadonlyArray<DataTableColumn<ApiKey>> = [
    { key: "name", header: "Name", render: (k) => k.name },
    { key: "prefix", header: "Prefix", render: (k) => <code className="font-mono text-xs">{k.prefix}</code> },
    { key: "owner", header: "Owner", render: (k) => k.ownerUserId },
    {
      key: "scopes",
      header: "Scopes",
      render: (k) => (
        <div className="flex flex-wrap gap-1">
          {k.scopes.length === 0
            ? <span className="text-xs text-slate-500">—</span>
            : k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}
        </div>
      ),
    },
    { key: "created", header: "Created", render: (k) => formatDate(k.createdAt) },
    { key: "last", header: "Last used", render: (k) => formatDate(k.lastUsedAt) },
    {
      key: "status",
      header: "Status",
      render: (k) => <Badge tone={k.revokedAt ? "danger" : "success"}>{k.revokedAt ? "revoked" : "active"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (k) =>
        k.revokedAt ? null : (
          <Button
            size="sm"
            variant="danger"
            loading={revokeMutation.isPending && revokeMutation.variables === k.id}
            onClick={() => revokeMutation.mutate(k.id)}
          >
            Revoke
          </Button>
        ),
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    setReveal(null);
    const parsed = scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    createMutation.mutate({ name, scopes: parsed });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Admin · API Keys"
        description="Service tokens. Plaintext is shown once at creation — copy it now or rotate."
      />

      <DataTable
        rows={keysQuery.data?.apiKeys ?? []}
        columns={columns}
        loading={keysQuery.isLoading}
        error={keysQuery.error ? pickErrorMessage(keysQuery.error) : null}
        emptyMessage="No API keys yet"
        rowKey={(k) => k.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Mint a new key</CardTitle>
        </CardHeader>
        <CardBody>
          {reveal ? (
            <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-medium">Plaintext (shown once)</div>
              <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-xs">
                {reveal.plaintext}
              </code>
              <button
                className="mt-2 text-xs text-emerald-800 underline"
                onClick={() => setReveal(null)}
                type="button"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Name
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Scopes (comma-separated)
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={scopes}
                placeholder="ops:read, alerts:write"
                onChange={(e) => setScopes(e.target.value)}
              />
            </label>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Mint key
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
