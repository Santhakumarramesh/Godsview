"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { CreateWebhookRequest, Webhook, WebhookCreateResponse } from "@gv/types";

export default function AdminWebhooksPage() {
  const qc = useQueryClient();
  const webhooksQuery = useQuery({
    queryKey: ["admin", "webhooks"],
    queryFn: () => api.webhooks.list(),
  });

  const [draft, setDraft] = useState<CreateWebhookRequest>({ name: "", source: "", scopes: [] });
  const [scopesText, setScopesText] = useState("");
  const [reveal, setReveal] = useState<WebhookCreateResponse | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateWebhookRequest) => api.webhooks.create(payload),
    onSuccess: (data) => {
      setReveal(data);
      setDraft({ name: "", source: "", scopes: [] });
      setScopesText("");
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.webhooks.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "webhooks"] }),
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => api.webhooks.rotateSecret(id),
    onSuccess: (data) => {
      setReveal(data);
      void qc.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<Webhook>> = [
    { key: "name", header: "Name", render: (w) => w.name },
    { key: "source", header: "Source", render: (w) => <code className="font-mono text-xs">{w.source}</code> },
    {
      key: "scopes",
      header: "Scopes",
      render: (w) => (
        <div className="flex flex-wrap gap-1">
          {w.scopes.length === 0
            ? <span className="text-xs text-slate-500">—</span>
            : w.scopes.map((s) => <Badge key={s}>{s}</Badge>)}
        </div>
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (w) => <Badge tone={w.active ? "success" : "neutral"}>{w.active ? "active" : "inactive"}</Badge>,
    },
    { key: "created", header: "Created", render: (w) => formatDate(w.createdAt) },
    { key: "last", header: "Last delivered", render: (w) => formatDate(w.lastDeliveredAt) },
    {
      key: "actions",
      header: "",
      render: (w) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={rotateMutation.isPending && rotateMutation.variables === w.id}
            onClick={() => rotateMutation.mutate(w.id)}
          >
            Rotate
          </Button>
          {w.active ? (
            <Button
              size="sm"
              variant="danger"
              loading={deactivateMutation.isPending && deactivateMutation.variables === w.id}
              onClick={() => deactivateMutation.mutate(w.id)}
            >
              Deactivate
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    const scopes = scopesText.split(",").map((s) => s.trim()).filter(Boolean);
    createMutation.mutate({ ...draft, scopes });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Admin · Webhooks"
        description="Inbound webhook receivers. Secrets are HMAC-SHA256 and shown only at creation/rotation."
      />

      <DataTable
        rows={webhooksQuery.data?.webhooks ?? []}
        columns={columns}
        loading={webhooksQuery.isLoading}
        error={webhooksQuery.error ? pickErrorMessage(webhooksQuery.error) : null}
        emptyMessage="No webhooks yet"
        rowKey={(w) => w.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Register a webhook</CardTitle>
        </CardHeader>
        <CardBody>
          {reveal ? (
            <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-medium">Webhook secret (shown once)</div>
              <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-xs">
                {reveal.secret}
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
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Source
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="tradingview"
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Scopes (comma-separated)
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={scopesText}
                onChange={(e) => setScopesText(e.target.value)}
                placeholder="signals:write"
              />
            </label>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Register webhook
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
