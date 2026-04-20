"use client";

/**
 * Execution · Fills — Phase 4 live surface.
 *
 * Wires the broker fills route:
 *   GET /v1/broker/fills?accountId=… → BrokerFillsOut
 *
 * A single `BrokerRequest` produced by the live gate can yield many
 * `BrokerFill`s (partials, rejects, expiries). This surface is the
 * audit-grade ledger — one row per execution report — with slippage
 * vs. the gate's expected entry price.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  BrokerFill,
  BrokerFillStatus,
  Direction,
} from "@gv/types";
import type { BrokerFillsFilter } from "@gv/api-client";

const DIRECTION_TONE: Record<Direction, "success" | "danger" | "neutral"> = {
  long: "success",
  short: "danger",
  neutral: "neutral",
};

const FILL_STATUS_TONE: Record<
  BrokerFillStatus,
  "info" | "warn" | "success" | "neutral" | "danger"
> = {
  accepted: "info",
  partially_filled: "warn",
  filled: "success",
  canceled: "neutral",
  rejected: "danger",
  expired: "neutral",
};

const DEFAULT_ACCOUNT = "default";

interface DraftFilter {
  accountId: string;
  symbolId: string;
  clientOrderId: string;
  fromTs: string;
  toTs: string;
  limit: string;
}

function emptyDraft(): DraftFilter {
  return {
    accountId: DEFAULT_ACCOUNT,
    symbolId: "",
    clientOrderId: "",
    fromTs: "",
    toTs: "",
    limit: "100",
  };
}

function toFilter(d: DraftFilter): BrokerFillsFilter {
  const f: BrokerFillsFilter = {
    accountId: d.accountId.trim() || DEFAULT_ACCOUNT,
  };
  if (d.symbolId.trim()) f.symbolId = d.symbolId.trim();
  if (d.clientOrderId.trim()) f.clientOrderId = d.clientOrderId.trim();
  if (d.fromTs.trim()) {
    const iso = new Date(d.fromTs).toISOString();
    f.fromTs = iso;
  }
  if (d.toTs.trim()) {
    const iso = new Date(d.toTs).toISOString();
    f.toTs = iso;
  }
  const lim = Number(d.limit);
  if (Number.isFinite(lim) && lim > 0 && lim <= 1000) f.limit = Math.round(lim);
  return f;
}

export default function ExecutionFillsPage() {
  const [draft, setDraft] = useState<DraftFilter>(emptyDraft());
  const [applied, setApplied] = useState<BrokerFillsFilter>(() =>
    toFilter(emptyDraft()),
  );
  const [offset, setOffset] = useState(0);

  const queryFilter = useMemo<BrokerFillsFilter>(
    () => ({ ...applied, offset }),
    [applied, offset],
  );

  const fillsQuery = useQuery({
    queryKey: ["broker", "fills", queryFilter],
    queryFn: () => api.broker.listFills(queryFilter),
    refetchInterval: 15_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.broker.listFills(queryFilter),
  });

  const data = fillsQuery.data;
  const rows = data?.fills ?? [];
  const total = data?.total ?? 0;
  const limit = queryFilter.limit ?? 100;

  const aggregates = useMemo(() => {
    let filled = 0;
    let commission = 0;
    let slippageSum = 0;
    let slippageCount = 0;
    for (const f of rows) {
      if (f.status === "filled" || f.status === "partially_filled") {
        filled += Math.abs(f.filledQty);
      }
      commission += f.commission;
      if (f.slippage != null) {
        slippageSum += f.slippage;
        slippageCount += 1;
      }
    }
    const avgSlip = slippageCount > 0 ? slippageSum / slippageCount : null;
    return { filled, commission, avgSlip };
  }, [rows]);

  const columns: ReadonlyArray<DataTableColumn<BrokerFill>> = [
    {
      key: "observedAt",
      header: "Time",
      render: (f) => (
        <div>
          <div className="text-xs text-slate-900">{formatDate(f.observedAt)}</div>
          <div className="text-[10px] text-slate-500">
            {formatRelative(f.observedAt)}
          </div>
        </div>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (f) => (
        <div className="font-mono text-xs text-slate-900">{f.symbolId}</div>
      ),
    },
    {
      key: "direction",
      header: "Side",
      render: (f) => <Badge tone={DIRECTION_TONE[f.direction]}>{f.direction}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (f) => <Badge tone={FILL_STATUS_TONE[f.status]}>{f.status}</Badge>,
    },
    {
      key: "qty",
      header: "Filled qty",
      render: (f) => (
        <span className="font-mono text-xs">{f.filledQty.toFixed(4)}</span>
      ),
    },
    {
      key: "avgFill",
      header: "Avg fill",
      render: (f) => (
        <span className="font-mono text-xs">
          {f.avgFillPrice != null ? f.avgFillPrice.toFixed(4) : "—"}
        </span>
      ),
    },
    {
      key: "slippage",
      header: "Slippage",
      render: (f) => {
        if (f.slippage == null) {
          return <span className="font-mono text-xs text-slate-500">—</span>;
        }
        const cls =
          f.slippage > 0
            ? "text-rose-700"
            : f.slippage < 0
              ? "text-emerald-700"
              : "text-slate-700";
        return (
          <span className={`font-mono text-xs ${cls}`}>
            {f.slippage > 0 ? "+" : ""}
            {f.slippage.toFixed(4)}
          </span>
        );
      },
    },
    {
      key: "commission",
      header: "Commission",
      render: (f) => (
        <span className="font-mono text-xs text-slate-700">
          {f.commission.toFixed(2)}
        </span>
      ),
    },
    {
      key: "ids",
      header: "IDs",
      render: (f) => (
        <div className="flex flex-col">
          <code className="font-mono text-[10px] text-slate-700">
            clo: {f.clientOrderId.slice(0, 16)}
          </code>
          <code className="font-mono text-[10px] text-slate-500">
            broker: {f.brokerOrderId.slice(0, 16)}
          </code>
        </div>
      ),
    },
    {
      key: "error",
      header: "Error",
      render: (f) =>
        f.errorCode || f.errorMessage ? (
          <div className="max-w-xs">
            {f.errorCode ? (
              <code className="font-mono text-[10px] text-rose-700">
                {f.errorCode}
              </code>
            ) : null}
            {f.errorMessage ? (
              <div className="truncate text-[10px] text-slate-600">
                {f.errorMessage}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOffset(0);
    setApplied(toFilter(draft));
  }

  function reset() {
    const fresh = emptyDraft();
    setDraft(fresh);
    setOffset(0);
    setApplied(toFilter(fresh));
  }

  const pageStart = rows.length === 0 ? 0 : offset + 1;
  const pageEnd = offset + rows.length;
  const hasPrev = offset > 0;
  const hasNext = pageEnd < total;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Execution · Fills"
        description="Broker execution report ledger — one row per fill/cancel/reject. Slippage is computed vs. the gate's expected entry."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Account ID
              <input
                required
                type="text"
                value={draft.accountId}
                onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Symbol ID
              <input
                type="text"
                value={draft.symbolId}
                onChange={(e) => setDraft({ ...draft, symbolId: e.target.value })}
                placeholder="(any)"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Client order ID
              <input
                type="text"
                value={draft.clientOrderId}
                onChange={(e) =>
                  setDraft({ ...draft, clientOrderId: e.target.value })
                }
                placeholder="(any)"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              From (local time)
              <input
                type="datetime-local"
                value={draft.fromTs}
                onChange={(e) => setDraft({ ...draft, fromTs: e.target.value })}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              To (local time)
              <input
                type="datetime-local"
                value={draft.toTs}
                onChange={(e) => setDraft({ ...draft, toTs: e.target.value })}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Page size
              <input
                type="number"
                min="1"
                max="1000"
                value={draft.limit}
                onChange={(e) => setDraft({ ...draft, limit: e.target.value })}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <div className="md:col-span-3 flex items-center gap-2">
              <Button type="submit">Apply</Button>
              <Button type="button" variant="secondary" onClick={reset}>
                Reset
              </Button>
              <Button
                type="button"
                variant="ghost"
                loading={refreshMutation.isPending}
                onClick={() => refreshMutation.mutate()}
              >
                Refresh
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Fills on page" value={String(rows.length)} />
        <SummaryCard
          label="Filled qty"
          value={aggregates.filled.toFixed(4)}
        />
        <SummaryCard
          label="Avg slippage"
          value={
            aggregates.avgSlip == null
              ? "—"
              : `${aggregates.avgSlip > 0 ? "+" : ""}${aggregates.avgSlip.toFixed(4)}`
          }
          tone={
            aggregates.avgSlip == null
              ? "neutral"
              : aggregates.avgSlip > 0
                ? "bad"
                : "good"
          }
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={fillsQuery.isLoading}
        error={fillsQuery.error ? pickErrorMessage(fillsQuery.error) : null}
        emptyMessage="No fills match this filter"
        rowKey={(f) => f.id}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {total > 0
            ? `Rows ${pageStart}–${pageEnd} of ${total}`
            : "No results"}
          {data ? (
            <>
              {" · provider "}
              <code className="font-mono">{data.provider}</code>
              {" · mode "}
              <code className="font-mono">{data.mode}</code>
            </>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!hasPrev || fillsQuery.isLoading}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!hasNext || fillsQuery.isLoading}
            onClick={() => setOffset((o) => o + limit)}
          >
            Next
          </Button>
        </div>
      </div>
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
