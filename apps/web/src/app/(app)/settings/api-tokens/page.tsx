"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { CreateSelfApiTokenRequest, SelfApiToken, SelfApiTokenCreateResponse } from "@gv/types";

export default function SettingsApiTokensPage() {
  const qc = useQueryClient();
  const tokensQuery = useQuery({
    queryKey: ["settings", "api-tokens"],
    queryFn: () => api.settings.listApiTokens(),
  });

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("");
  const [reveal, setReveal] = useState<SelfApiTokenCreateResponse | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateSelfApiTokenRequest) => api.settings.createApiToken(payload),
    onSuccess: (data) => {
      setReveal(data);
      setName("");
      setScopes("");
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["settings", "api-tokens"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.settings.revokeApiToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "api-tokens"] }),
  });

  const columns: ReadonlyArray<DataTableColumn<SelfApiToken>> = [
    { key: "name", header: "Name", render: (t) => t.name },
    { key: "prefix", header: "Prefix", render: (t) => <code className="font-mono text-xs">{t.prefix}</code> },
    {
      key: "scopes",
      header: "Scopes",
      render: (t) => (
        <div className="flex flex-wrap gap-1">
          {t.scopes.length === 0 ? <span className="text-xs text-slate-500">—</span> : t.scopes.map((s) => <Badge key={s}>{s}</Badge>)}
        </div>
      ),
    },
    { key: "created", header: "Created", render: (t) => formatDate(t.createdAt) },
    { key: "last", header: "Last used", render: (t) => formatDate(t.lastUsedAt) },
    {
      key: "status",
      header: "Status",
      render: (t) => <Badge tone={t.revokedAt ? "danger" : "success"}>{t.revokedAt ? "revoked" : "active"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (t) =>
        t.revokedAt ? null : (
          <Button
            size="sm"
            variant="danger"
            loading={revokeMutation.isPending && revokeMutation.variables === t.id}
            onClick={() => revokeMutation.mutate(t.id)}
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
    const parsed = scopes.split(",").map((s) => s.trim()).filter(Boolean);
    createMutation.mutate({ name, scopes: parsed });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Settings · API Tokens"
        description="Personal access tokens scoped to you. Plaintext is shown once and never stored — copy or rotate."
      />

      <DataTable
        rows={tokensQuery.data?.tokens ?? []}
        columns={columns}
        loading={tokensQuery.isLoading}
        error={tokensQuery.error ? pickErrorMessage(tokensQuery.error) : null}
        emptyMessage="No tokens yet"
        rowKey={(t) => t.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Mint a token</CardTitle>
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
                placeholder="ops:read"
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
                Mint token
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
