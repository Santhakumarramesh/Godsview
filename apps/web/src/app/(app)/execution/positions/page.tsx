"use client";

/**
 * Execution · Positions — Phase 4 live surface.
 *
 * Wires the broker positions route:
 *   GET /v1/broker/positions?accountId=… → BrokerPositionsOut
 *
 * Each row is one canonical open position reported by the broker
 * adapter (`services/control_plane/app/execution/broker/*`). Position
 * objects carry optional back-links to the setup + live trade that
 * opened them so operators can pivot directly to /intel/setups/[id] or
 * /execution/orders.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type { Direction, Position, PositionStatus } from "@gv/types";

const DIRECTION_TONE: Record<Direction, "success" | "danger" | "neutral"> = {
  long: "success",
  short: "danger",
  neutral: "neutral",
};

const STATUS_TONE: Record<PositionStatus, "info" | "neutral"> = {
  open: "info",
  closed: "neutral",
};

const DEFAULT_ACCOUNT = "default";

export default function ExecutionPositionsPage() {
  const [accountInput, setAccountInput] = useState(DEFAULT_ACCOUNT);
  const [accountId, setAccountId] = useState(DEFAULT_ACCOUNT);

  const positionsQuery = useQuery({
    queryKey: ["broker", "positions", accountId],
    queryFn: () => api.broker.listPositions(accountId),
    refetchInterval: 10_000,
    enabled: Boolean(accountId.trim()),
  });

  const data = positionsQuery.data;
  const rows = data?.positions ?? [];

  const aggregates = useMemo(() => {
    let gross = 0;
    let unreal = 0;
    let openCount = 0;
    for (const p of rows) {
      gross += Math.abs(p.qty * p.markPrice);
      unreal += p.unrealizedPnL;
      if (p.status === "open") openCount += 1;
    }
    return { gross, unreal, openCount };
  }, [rows]);

  const columns: ReadonlyArray<DataTableColumn<Position>> = [
    {
      key: "symbolId",
      header: "Symbol",
      render: (p) => (
        <div className="font-mono text-xs text-slate-900">{p.symbolId}</div>
      ),
    },
    {
      key: "direction",
      header: "Side",
      render: (p) => <Badge tone={DIRECTION_TONE[p.direction]}>{p.direction}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>,
    },
    {
      key: "qty",
      header: "Qty",
      render: (p) => (
        <div className="font-mono text-xs">
          <div className="text-slate-900">{p.qty.toFixed(4)}</div>
        </div>
      ),
    },
    {
      key: "avgEntry",
      header: "Avg entry",
      render: (p) => (
        <span className="font-mono text-xs text-slate-900">
          {p.avgEntryPrice.toFixed(4)}
        </span>
      ),
    },
    {
      key: "mark",
      header: "Mark",
      render: (p) => (
        <span className="font-mono text-xs text-slate-900">
          {p.markPrice.toFixed(4)}
        </span>
      ),
    },
    {
      key: "notional",
      header: "Notional",
      render: (p) => (
        <span className="font-mono text-xs text-slate-700">
          ${Math.abs(p.qty * p.markPrice).toFixed(2)}
        </span>
      ),
    },
    {
      key: "unrealizedPnL",
      header: "Unrealized",
      render: (p) => {
        const positive = p.unrealizedPnL > 0;
        const cls = positive
          ? "text-emerald-700"
          : p.unrealizedPnL < 0
            ? "text-rose-700"
            : "text-slate-700";
        return (
          <span className={`font-mono text-xs ${cls}`}>
            {positive ? "+" : ""}
            {p.unrealizedPnL.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: "links",
      header: "Refs",
      render: (p) => (
        <div className="flex flex-col gap-0.5">
          {p.setupId ? (
            <Link
              href={`/intel/setups/${encodeURIComponent(p.setupId)}`}
              className="font-mono text-[11px] text-sky-700 hover:underline"
            >
              setup {p.setupId.slice(0, 8)}…
            </Link>
          ) : null}
          {p.liveTradeId ? (
            <Link
              href={`/execution/orders`}
              className="font-mono text-[11px] text-sky-700 hover:underline"
            >
              trade {p.liveTradeId.slice(0, 8)}…
            </Link>
          ) : null}
          {!p.setupId && !p.liveTradeId ? (
            <span className="text-[11px] text-slate-400">—</span>
          ) : null}
        </div>
      ),
    },
    { key: "openedAt", header: "Opened", render: (p) => formatDate(p.openedAt) },
    { key: "closedAt", header: "Closed", render: (p) => formatDate(p.closedAt) },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAccountId(accountInput.trim() || DEFAULT_ACCOUNT);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Execution · Positions"
        description="Open broker positions with real-time mark-to-market. Each row links back to the setup + live trade that opened it."
      />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Account ID
              <input
                type="text"
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              Load
            </button>
            {data ? (
              <div className="ml-auto text-xs text-slate-500">
                Observed {formatRelative(data.observedAt)} · mode{" "}
                <code className="font-mono">{data.mode}</code>
              </div>
            ) : null}
          </form>
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Open positions" value={String(aggregates.openCount)} />
        <SummaryCard
          label="Gross notional"
          value={`$${aggregates.gross.toFixed(2)}`}
        />
        <SummaryCard
          label="Unrealized PnL"
          value={`${aggregates.unreal >= 0 ? "+" : ""}${aggregates.unreal.toFixed(2)}`}
          tone={
            aggregates.unreal > 0
              ? "good"
              : aggregates.unreal < 0
                ? "bad"
                : "neutral"
          }
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={positionsQuery.isLoading}
        error={
          positionsQuery.error ? pickErrorMessage(positionsQuery.error) : null
        }
        emptyMessage="No open positions"
        rowKey={(p) => p.id}
      />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
