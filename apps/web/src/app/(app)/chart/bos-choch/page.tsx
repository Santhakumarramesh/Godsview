"use client";

import { useEffect, useState } from "react";

export default function BOS/CHOCHEnginePage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: wire to real API
    const t = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">BOS / CHOCH Engine</h1>
        <span className="rounded bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
          live
        </span>
      </header>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-foreground/70">
            BOS / CHOCH Engine — ready for data binding.
          </p>
        </div>
      )}
    </section>
  );
}
