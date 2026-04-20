"use client";

/**
 * Strategies · Active — Phase 5 surface.
 *
 * Wires /v1/quant/strategies from
 * services/control_plane/app/routes/quant_lab.py. Deep-linkable:
 * passing ?id=<strategyId> pins the row to the top of the table and
 * loads its full version history.
 *
 * Promotion states map to visual tone:
 *   experimental → neutral, paper → info, assisted_live → success,
 *   autonomous → success + gradient, retired → warn.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  PromotionState,
  SetupType,
  Strategy,
  StrategyFilter,
  StrategyTier,
  StrategyVersion,
} from "@gv/types";

const TIER_TONE: Record<StrategyTier, "success" | "info" | "warn"> = {
  A: "success",
  B: "info",
  C: "warn",
};

const STATE_TONE: Record<
  PromotionState,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  experimental: "neutral",
  paper: "info",
  assisted_live: "success",
  autonomous: "success",
  retired: "warn",
};

const SETUP_TYPES: ReadonlyArray<SetupType> = [
  "liquidity_sweep_reclaim",
  "ob_retest",
  "breakout_retest",
  "fvg_reaction",
  "momentum_continuation",
  "session_reversal",
];

const STATES: ReadonlyArray<PromotionState> = [
  "experimental",
  "paper",
  "assisted_live",
  "autonomous",
  "retired",
];

export default function StrategiesActivePage() {
  const searchParams = useSearchParams();
  const pinnedId = searchParams.get("id");

  const [tier, setTier] = useState<StrategyTier | "">("");
  const [state, setState] = useState<PromotionState | "">("");
  const [setupType, setSetupType] = useState<SetupType | "">("");

  const filter: StrategyFilter = useMemo(() => {
    const f: StrategyFilter = { limit: 100 };
    if (tier) f.tier = tier;
    if (state) f.promotionState = state;
    if (setupType) f.setupType = setupType;
    return f;
  }, [tier, state, setupType]);

  const strategiesQuery = useQuery({
    queryKey: ["strategies", "list", filter],
    queryFn: () => api.strategies.list(filter),
    refetchInterval: 30_000,
  });

  const versionsQuery = useQuery({
    queryKey: ["strategies", "versions", pinnedId],
    enabled: !!pinnedId,
    queryFn: () =>
      pinnedId ? api.strategies.listVersions(pinnedId) : Promise.resolve(null),
  });

  const rows = useMemo(() => {
    const list = strategiesQuery.data?.strategies ?? [];
    if (!pinnedId) return list;
    const idx = list.findIndex((s) => s.id === pinnedId);
    if (idx < 0) return list;
    const pinned = list[idx]!;
    return [pinned, ...list.filter((_, i) => i !== idx)];
  }, [strategiesQuery.data, pinnedId]);

  const pinnedStrategy = rows.find((s) => s.id === pinnedId) ?? null;

  const columns: ReadonlyArray<DataTableColumn<Strategy>> = [
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <div className="flex flex-col">
          <Link
            href={`/strategies/active?id=${encodeURIComponent(s.id)}`}
            className="text-xs font-semibold text-sky-700 hover:underline"
          >
            {s.name}
          </Link>
          <span className="mt-0.5 font-mono text-[10px] text-slate-500">
            {s.id.slice(0, 12)}…
          </span>
        </div>
      ),
    },
    {
      key: "setupType",
      header: "Setup",
      render: (s) => (
        <span className="font-mono text-[11px] text-slate-700">
          {s.setupType.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      render: (s) => <Badge tone={TIER_TONE[s.tier]}>{s.tier}</Badge>,
    },
    {
      key: "state",
      header: "State",
      render: (s) => (
        <Badge tone={STATE_TONE[s.promotionState]}>
          {s.promotionState.replaceAll("_", " ")}
        </Badge>
      ),
    },
    {
      key: "activeVersion",
      header: "Active version",
      render: (s) =>
        s.activeVersionId ? (
          <code className="font-mono text-[11px] text-slate-700">
            {s.activeVersionId.slice(0, 12)}…
          </code>
        ) : (
          <span className="text-[11px] text-slate-400">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (s) => formatDate(s.createdAt),
    },
    {
      key: "updatedAt",
      header: "Updated",
      render: (s) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(s.updatedAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <div className="flex gap-2">
          <Link
            href={`/strategies/promotions?id=${encodeURIComponent(s.id)}`}
            className="text-[11px] text-sky-700 hover:underline"
          >
            Promotions
          </Link>
          <Link
            href={`/strategies/dna?id=${encodeURIComponent(s.id)}`}
            className="text-[11px] text-sky-700 hover:underline"
          >
            DNA
          </Link>
        </div>
      ),
    },
  ];

  const versionColumns: ReadonlyArray<DataTableColumn<StrategyVersion>> = [
    {
      key: "version",
      header: "v",
      render: (v) => (
        <span className="font-mono text-xs font-semibold text-slate-900">
          v{v.version}
        </span>
      ),
    },
    {
      key: "setupType",
      header: "Setup",
      render: (v) => (
        <span className="font-mono text-[11px] text-slate-700">
          {v.entry.setupType.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "tfs",
      header: "TFs",
      render: (v) => (
        <span className="font-mono text-[11px] text-slate-700">
          {v.entry.timeframes.join(", ")}
        </span>
      ),
    },
    {
      key: "minConf",
      header: "Min conf",
      render: (v) => (
        <span className="font-mono text-[11px] text-slate-700">
          {(v.entry.minConfidence * 100).toFixed(0)}%
        </span>
      ),
    },
    {
      key: "exit",
      header: "Exit",
      render: (v) => (
        <span className="font-mono text-[11px] text-slate-700">
          {v.exit.stopStyle} · TP {v.exit.takeProfitRR}R
          {v.exit.trailAfterR !== null
            ? ` · trail@${v.exit.trailAfterR}R`
            : ""}
        </span>
      ),
    },
    {
      key: "sizing",
      header: "Sizing",
      render: (v) => (
        <span className="font-mono text-[11px] text-slate-700">
          {(v.sizing.perTradeR * 100).toFixed(2)}% · max{" "}
          {v.sizing.maxConcurrent}
        </span>
      ),
    },
    {
      key: "codeHash",
      header: "Code",
      render: (v) => (
        <code className="font-mono text-[10px] text-slate-500">
          {v.codeHash.slice(0, 10)}…
        </code>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (v) => formatRelative(v.createdAt),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Strategies · Active"
        description="Every strategy the lab knows about, with tier, promotion state, and active version. Click a name to pin it; its version history loads below."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Tier
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={tier}
            onChange={(e) => setTier((e.target.value || "") as StrategyTier | "")}
          >
            <option value="">(any)</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Promotion state
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={state}
            onChange={(e) =>
              setState((e.target.value || "") as PromotionState | "")
            }
          >
            <option value="">(any)</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Setup type
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={setupType}
            onChange={(e) =>
              setSetupType((e.target.value || "") as SetupType | "")
            }
          >
            <option value="">(any)</option>
            {SETUP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={strategiesQuery.isLoading}
        error={
          strategiesQuery.error ? pickErrorMessage(strategiesQuery.error) : null
        }
        emptyMessage="No strategies match this filter"
        rowKey={(s) => s.id}
      />

      {pinnedId ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Version history
              </h2>
              {pinnedStrategy ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {pinnedStrategy.name} ·{" "}
                  <code className="font-mono">{pinnedId.slice(0, 14)}…</code>
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  Pinned strategy is not in the current filter — widen the
                  filters to see it.
                </p>
              )}
            </div>
            <Link
              href="/strategies/active"
              className="text-[11px] text-sky-700 hover:underline"
            >
              Clear pin
            </Link>
          </header>
          <div className="mt-3">
            <DataTable
              rows={versionsQuery.data?.versions ?? []}
              columns={versionColumns}
              loading={versionsQuery.isLoading}
              error={
                versionsQuery.error
                  ? pickErrorMessage(versionsQuery.error)
                  : null
              }
              emptyMessage="No versions yet."
              rowKey={(v) => v.id}
            />
          </div>
        </section>
      ) : null}

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/strategies/builder" className="text-sky-700 hover:underline">
          Strategies · Builder
        </Link>{" "}
        to add a new version;{" "}
        <Link href="/quant/ranking" className="text-sky-700 hover:underline">
          Quant Lab · Ranking
        </Link>{" "}
        for the tier snapshot that governs promotions.
      </p>
    </section>
  );
}
