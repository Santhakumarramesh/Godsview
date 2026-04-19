"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export default function OverviewPage() {
  const { user } = useAuth();
  const ready = useQuery({
    queryKey: ["health", "ready"],
    queryFn: () => api.health.ready(),
    refetchInterval: 30_000,
  });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          Welcome back, {user?.displayName ?? "trader"}.
        </h1>
        <p className="text-sm text-muted">
          GodsView v2 command center — Phase 0 foundation. The remaining
          surface area lights up phase by phase.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Control plane" subtitle="FastAPI · postgres · redis">
          <StatusBadge
            ok={ready.data?.status === "ok"}
            label={ready.data?.status ?? "checking"}
          />
          <Detail
            label="Uptime"
            value={
              ready.data ? `${ready.data.uptimeSeconds.toFixed(1)}s` : "—"
            }
          />
          <Detail label="Version" value={ready.data?.version ?? "—"} />
        </Card>

        <Card title="Roles" subtitle="What you can do">
          <ul className="space-y-1 text-sm">
            {(user?.roles ?? []).map((r) => (
              <li key={r} className="rounded bg-background px-2 py-1 font-mono">
                {r}
              </li>
            ))}
            {user && user.roles.length === 0 ? (
              <li className="text-muted">no roles assigned</li>
            ) : null}
          </ul>
        </Card>

        <Card title="Quick links" subtitle="Functional in Phase 0">
          <ul className="space-y-1 text-sm">
            <li>
              <Link className="text-primary hover:underline" href="/market/symbols">
                Market · Symbols
              </Link>
            </li>
            <li>
              <Link className="text-primary hover:underline" href="/ops/health">
                Ops · Health
              </Link>
            </li>
            <li>
              <Link className="text-primary hover:underline" href="/ops/flags">
                Ops · Feature flags
              </Link>
            </li>
            <li>
              <Link className="text-primary hover:underline" href="/admin/system">
                Admin · System config
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </section>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <header className="mb-3">
        <div className="text-sm font-medium">{title}</div>
        {subtitle ? <div className="text-xs text-muted">{subtitle}</div> : null}
      </header>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono " +
        (ok ? "bg-success/15 text-success" : "bg-warn/15 text-warn")
      }
    >
      <span
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          (ok ? "bg-success" : "bg-warn")
        }
      />
      {label}
    </span>
  );
}
