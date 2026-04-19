"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function OpsHealthPage() {
  const ready = useQuery({
    queryKey: ["health", "ready", "detail"],
    queryFn: () => api.health.ready(),
    refetchInterval: 10_000,
  });
  const live = useQuery({
    queryKey: ["health", "live"],
    queryFn: () => api.health.live(),
    refetchInterval: 10_000,
  });

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Operations · Health</h1>
        <p className="text-sm text-muted">
          Real-time probe of the control plane and its dependencies.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">Liveness</h2>
          <Status ok={live.data?.status === "ok"} label={live.data?.status ?? "unknown"} />
          {live.isError ? <p className="mt-2 text-xs text-danger">Probe failed.</p> : null}
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">Readiness</h2>
          <Status
            ok={ready.data?.status === "ok"}
            label={ready.data?.status ?? "unknown"}
          />
          {ready.data ? (
            <dl className="mt-3 space-y-1 text-xs">
              <Row label="Service" value={ready.data.service} />
              <Row label="Version" value={ready.data.version} />
              <Row
                label="Uptime"
                value={`${ready.data.uptimeSeconds.toFixed(1)}s`}
              />
            </dl>
          ) : null}
        </div>
      </div>

      {ready.data ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">Dependency checks</h2>
          <ul className="divide-y divide-border text-sm">
            {Object.entries(ready.data.checks).map(([name, state]) => (
              <li key={name} className="flex items-center justify-between py-2">
                <span className="font-mono">{name}</span>
                <Status ok={state.status === "ok"} label={state.status} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono " +
        (ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger")
      }
    >
      <span
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          (ok ? "bg-success" : "bg-danger")
        }
      />
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
