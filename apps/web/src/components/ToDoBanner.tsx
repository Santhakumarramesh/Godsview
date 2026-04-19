"use client";

import Link from "next/link";

type Props = {
  title: string;
  /** Phase the page is scheduled to land in (e.g. "Phase 2"). */
  phase?: string;
  /** One-paragraph summary of what this page will do. */
  description?: string;
  /** Pages that will replace, depend on, or context-link this stub. */
  related?: ReadonlyArray<{ label: string; href: string }>;
};

export function ToDoBanner({ title, phase, description, related }: Props) {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <span className="rounded bg-warn/15 px-2 py-1 font-mono text-xs uppercase text-warn">
          {phase ?? "Phase 0"} · stub
        </span>
      </header>

      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p className="text-foreground/80">
          {description ??
            "This page is a Phase 0 placeholder. The full feature lands in a later phase per the GodsView v2 blueprint."}
        </p>
        {related && related.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1 text-xs uppercase tracking-wider text-muted">
              Related
            </div>
            <ul className="space-y-1">
              {related.map((r) => (
                <li key={r.href}>
                  <Link className="text-primary hover:underline" href={r.href}>
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
