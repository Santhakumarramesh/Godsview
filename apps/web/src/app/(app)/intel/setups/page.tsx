"use client";

/**
 * Intelligence · Setups — list page.
 *
 * Wired in Phase 4 PR7 against the Phase 3 `/v1/setups` surface:
 *   GET /setups → SetupListResponse { items, nextCursor, total }
 *
 * Click a row → /intel/setups/[id] which surfaces the Phase 4
 * execution gate (live preview, sizing, risk projection) + the row's
 * associated live-trade ledger.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type {
  Direction,
  SetupFilter,
  SetupListItem,
  SetupStatus,
  SetupType,
  Timeframe,
} from "@gv/types";

const STATUS_TONE: Record<
  SetupStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  detected: "info",
  approved_paper: "neutral",
  approved_live: "warn",
  filled: "success",
  closed: "success",
  expired: "neutral",
  rejected: "danger",
};

const DIRECTION_TONE: Record<Direction, "success" | "danger" | "neutral"> = {
  long: "success",
  short: "danger",
  neutral: "neutral",
};

const SETUP_TYPES: ReadonlyArray<SetupType> = [
  "liquidity_sweep_reclaim",
  "ob_retest",
  "breakout_retest",
  "fvg_reaction",
  "momentum_continuation",
  "session_reversal",
];

const TIMEFRAMES: ReadonlyArray<Timeframe> = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

const STATUSES: ReadonlyArray<SetupStatus> = [
  "detected",
  "approved_paper",
  "approved_live",
  "filled",
  "closed",
  "expired",
  "rejected",
];

export default function IntelSetupsPage() {
  const [symbolId, setSymbolId] = useState("");
  const [type, setType] = useState<SetupType | "">("");
  const [direction, setDirection] = useState<Direction | "">("");
  const [status, setStatus] = useState<SetupStatus | "">("");
  const [tf, setTf] = useState<Timeframe | "">("");
  const [minConfidence, setMinConfidence] = useState<string>("");

  const filter: SetupFilter = useMemo(() => {
    const f: SetupFilter = { limit: 100 };
    if (symbolId.trim()) f.symbolId = symbolId.trim();
    if (type) f.type = type;
    if (direction) f.direction = direction;
    if (status) f.status = status;
    if (tf) f.tf = tf;
    const mc = Number(minConfidence);
    if (Number.isFinite(mc) && mc > 0 && mc <= 1) f.minConfidence = mc;
    return f;
  }, [symbolId, type, direction, status, tf, minConfidence]);

  const setupsQuery = useQuery({
    queryKey: ["setups", "list", filter],
    queryFn: () => api.setups.list(filter),
    refetchInterval: 15_000,
  });

  const columns: ReadonlyArray<DataTableColumn<SetupListItem>> = [
    {
      key: "id",
      header: "Setup",
      render: (s) => (
        <Link
          href={`/intel/setups/${encodeURIComponent(s.id)}`}
          className="font-mono text-xs text-sky-700 hover:underline"
        >
          {s.id.slice(0, 12)}…
        </Link>
      ),
    },
    {
      key: "ticker",
      header: "Ticker",
      render: (s) => (
        <div>
          <div className="font-mono font-semibold text-slate-900">{s.ticker}</div>
          <div className="text-xs text-slate-500">{s.symbolId}</div>
        </div>
      ),
    },
    { key: "tf", header: "TF", render: (s) => <code className="font-mono text-xs">{s.tf}</code> },
    { key: "type", header: "Type", render: (s) => <code className="font-mono text-xs">{s.type}</code> },
    {
      key: "direction",
      header: "Side",
      render: (s) => <Badge tone={DIRECTION_TONE[s.direction]}>{s.direction}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (s) => <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>,
    },
    {
      key: "confidence",
      header: "Confidence",
      render: (s) => (
        <div className="w-24">
          <div className="text-xs font-mono text-slate-700">
            {(s.confidenceScore * 100).toFixed(1)}%
          </div>
          <div className="mt-1 h-1.5 rounded bg-slate-100">
            <div
              className="h-1.5 rounded bg-sky-500"
              style={{ width: `${Math.round(s.confidenceScore * 100)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: "rr",
      header: "RR",
      render: (s) => <span className="font-mono text-xs">{s.rr.toFixed(2)}</span>,
    },
    { key: "detectedAt", header: "Detected", render: (s) => formatDate(s.detectedAt) },
    { key: "expiresAt", header: "Expires", render: (s) => formatDate(s.expiresAt) },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Intelligence · Setups"
        description="Detected setups from the Phase 3 detector library. Click any setup to open the Phase 4 live execution gate."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Symbol ID
          <input
            type="text"
            value={symbolId}
            onChange={(e) => setSymbolId(e.target.value)}
            placeholder="(any)"
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Type
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={type}
            onChange={(e) => setType((e.target.value || "") as SetupType | "")}
          >
            <option value="">(any)</option>
            {SETUP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Direction
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={direction}
            onChange={(e) => setDirection((e.target.value || "") as Direction | "")}
          >
            <option value="">(any)</option>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Status
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={status}
            onChange={(e) =>
              setStatus((e.target.value || "") as SetupStatus | "")
            }
          >
            <option value="">(any)</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Timeframe
          <select
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            value={tf}
            onChange={(e) => setTf((e.target.value || "") as Timeframe | "")}
          >
            <option value="">(any)</option>
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Min confidence
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={minConfidence}
            onChange={(e) => setMinConfidence(e.target.value)}
            placeholder="(any)"
            className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
      </div>

      <DataTable
        rows={setupsQuery.data?.items ?? []}
        columns={columns}
        loading={setupsQuery.isLoading}
        error={setupsQuery.error ? pickErrorMessage(setupsQuery.error) : null}
        emptyMessage="No setups match this filter"
        rowKey={(s) => s.id}
      />

      {setupsQuery.data ? (
        <p className="text-xs text-slate-500">
          Showing {setupsQuery.data.items.length} of {setupsQuery.data.total}{" "}
          setups.
        </p>
      ) : null}
    </section>
  );
}
