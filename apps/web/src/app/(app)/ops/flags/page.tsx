"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { ApiError } from "@gv/api-client";
import { useAuth } from "@/lib/auth-context";

export default function OpsFlagsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;
  const qc = useQueryClient();

  const flags = useQuery({
    queryKey: ["flags"],
    queryFn: () => api.flags.list(),
  });

  const patch = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api.flags.update(key, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flags"] }),
  });

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Operations · Feature flags</h1>
        <p className="text-sm text-muted">
          Toggle runtime-gated features. Changes are audit-logged. Admin role
          required to mutate.
        </p>
      </header>

      {flags.isLoading ? <p className="text-sm text-muted">Loading flags…</p> : null}
      {flags.isError ? (
        <p className="text-sm text-danger">
          Failed to load flags —{" "}
          {flags.error instanceof Error ? flags.error.message : "unknown error"}
        </p>
      ) : null}

      {flags.data ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {flags.data.flags.map((flag) => {
                const busy = pendingKey === flag.key && patch.isPending;
                return (
                  <tr key={flag.key} className="border-t border-border hover:bg-surface/40">
                    <td className="px-3 py-2 font-mono text-foreground">{flag.key}</td>
                    <td className="px-3 py-2 text-muted">{flag.description}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {flag.scope}
                      {flag.scopeRef ? `:${flag.scopeRef}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded px-2 py-0.5 text-xs font-mono " +
                          (flag.enabled
                            ? "bg-success/15 text-success"
                            : "bg-muted/20 text-muted")
                        }
                      >
                        {flag.enabled ? "enabled" : "disabled"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={!isAdmin || busy}
                        onClick={() => {
                          setPendingKey(flag.key);
                          patch.mutate({ key: flag.key, enabled: !flag.enabled });
                        }}
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-surface disabled:opacity-50"
                      >
                        {busy ? "…" : flag.enabled ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {patch.isError ? (
        <p className="text-sm text-danger">
          Update failed:{" "}
          {patch.error instanceof ApiError
            ? patch.error.body?.error?.message ?? `HTTP ${patch.error.status}`
            : patch.error instanceof Error
              ? patch.error.message
              : "unknown error"}
        </p>
      ) : null}

      {!isAdmin ? (
        <p className="text-xs text-muted">
          You are viewing in read-only mode. Admin role required to toggle
          flags.
        </p>
      ) : null}
    </section>
  );
}
