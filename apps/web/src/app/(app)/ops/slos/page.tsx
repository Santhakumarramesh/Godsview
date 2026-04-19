"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { CreateSloRequest, Slo } from "@gv/types";

export default function OpsSlosPage() {
  const qc = useQueryClient();
  const slosQuery = useQuery({
    queryKey: ["ops", "slos"],
    queryFn: () => api.ops.listSlos(),
  });

  const [draft, setDraft] = useState<CreateSloRequest>({
    key: "",
    description: "",
    target: "99.9%",
    windowSeconds: 2592000,
    ownerTeam: "platform",
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateSloRequest) => api.ops.createSlo(payload),
    onSuccess: () => {
      setDraft({ key: "", description: "", target: "99.9%", windowSeconds: 2592000, ownerTeam: "platform" });
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["ops", "slos"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const columns: ReadonlyArray<DataTableColumn<Slo>> = [
    { key: "key", header: "Key", render: (s) => <code className="font-mono text-xs">{s.key}</code> },
    { key: "target", header: "Target", render: (s) => <Badge tone="info">{s.target}</Badge> },
    {
      key: "window",
      header: "Window",
      render: (s) => `${Math.round(s.windowSeconds / 86_400)}d`,
    },
    { key: "owner", header: "Owner", render: (s) => s.ownerTeam },
    { key: "description", header: "Description", render: (s) => s.description || "—" },
    { key: "updated", header: "Updated", render: (s) => formatDate(s.updatedAt) },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    createMutation.mutate(draft);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · SLOs"
        description="Service-level objectives. SLO keys link directly to alert rules — see the Alerts tab."
      />

      <DataTable
        rows={slosQuery.data?.slos ?? []}
        columns={columns}
        loading={slosQuery.isLoading}
        error={slosQuery.error ? pickErrorMessage(slosQuery.error) : null}
        emptyMessage="No SLOs defined yet"
        rowKey={(s) => s.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Define an SLO</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Key
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.key}
                placeholder="control_plane.availability"
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Target
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.target}
                onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Window (seconds)
              <input
                required
                type="number"
                min={60}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.windowSeconds}
                onChange={(e) => setDraft({ ...draft, windowSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Owner team
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.ownerTeam ?? ""}
                onChange={(e) => setDraft({ ...draft, ownerTeam: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Description
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Define SLO
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
