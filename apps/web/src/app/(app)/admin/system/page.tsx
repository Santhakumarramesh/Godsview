"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@gv/api-client";

export default function AdminSystemConfigPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["system-config"],
    queryFn: () => api.systemConfig.list(),
  });

  const upsert = useMutation({
    mutationFn: ({
      key,
      value,
      description,
    }: {
      key: string;
      value: unknown;
      description?: string;
    }) => api.systemConfig.upsert(key, { value, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system-config"] }),
  });

  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin · System config</h1>
        <p className="text-sm text-muted">
          Typed key/value store driving safety thresholds and runtime knobs.
          All writes are audit-logged.
        </p>
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted">Loading system config…</p>
      ) : null}
      {list.isError ? (
        <p className="text-sm text-danger">Failed to load system config.</p>
      ) : null}

      {list.data ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.entries.map((entry) => {
                const editing = editKey === entry.key;
                return (
                  <tr key={entry.key} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-mono">{entry.key}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {editing ? (
                        <textarea
                          className="w-full rounded border border-border bg-background p-2 font-mono text-xs"
                          rows={3}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap break-words">
                          {JSON.stringify(entry.value, null, 2)}
                        </pre>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">{entry.description}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      <div>{new Date(entry.updatedAt).toLocaleString()}</div>
                      <div className="font-mono">{entry.updatedBy}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editing ? (
                        <div className="flex gap-1 justify-end">
                          <button
                            className="rounded border border-border px-2 py-1 text-xs"
                            onClick={() => setEditKey(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="rounded bg-primary px-2 py-1 text-xs text-background disabled:opacity-50"
                            disabled={!isAdmin || upsert.isPending}
                            onClick={() => {
                              try {
                                const parsed = JSON.parse(draft);
                                upsert.mutate(
                                  { key: entry.key, value: parsed },
                                  { onSuccess: () => setEditKey(null) },
                                );
                              } catch {
                                /* keep in edit mode on parse failure */
                              }
                            }}
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!isAdmin}
                          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface disabled:opacity-50"
                          onClick={() => {
                            setEditKey(entry.key);
                            setDraft(JSON.stringify(entry.value, null, 2));
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.data.entries.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted" colSpan={5}>
                    No system config entries yet. Seeded defaults land via
                    <code className="mx-1 font-mono">make seed</code>.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {upsert.isError ? (
        <p className="text-sm text-danger">
          Save failed:{" "}
          {upsert.error instanceof ApiError
            ? upsert.error.body?.error?.message ?? `HTTP ${upsert.error.status}`
            : upsert.error instanceof Error
              ? upsert.error.message
              : "unknown error"}
        </p>
      ) : null}

      {!isAdmin ? (
        <p className="text-xs text-muted">
          Read-only view. Admin role required to edit config.
        </p>
      ) : null}
    </section>
  );
}
