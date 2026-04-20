"use client";

/**
 * Execution · Orders — Phase 4 live surface.
 *
 * Wires the live-trade ledger against the Phase 4 routes:
 *   GET    /v1/live-trades                   → LiveTradesListOut
 *   PATCH  /v1/live-trades/:id/status        → LiveTrade (admin only; FSM)
 *   POST   /v1/live-trades/:id/cancel        → LiveTrade (admin only)
 *
 * Each row is a deterministic projection of the broker round-trip:
 *   setup → live gate → Alpaca → fills → realised PnL ($ + R).
 *
 * The FSM is enforced on the server; the UI mirrors the legal transitions.
 */

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type {
  Direction,
  LiveTrade,
  LiveTradeFilter,
  LiveTradeStatus,
} from "@gv/types";

// ──────────────────────────── display tone maps ─────────────────────────

const LIVE_TRADE_TONE: Record<
  LiveTradeStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  pending_submit: "info",
  submitted: "info",
  partially_filled: "warn",
  filled: "neutral",
  won: "success",
  lost: "danger",
  scratched: "neutral",
  cancelled: "neutral",
  rejected: "danger",
};

const DIRECTION_TONE: Record<Direction, "success" | "danger" | "neutral"> = {
  long: "success",
  short: "danger",
  neutral: "neutral",
};

const LIVE_TRADE_STATUSES: ReadonlyArray<LiveTradeStatus> = [
  "pending_submit",
  "submitted",
  "partially_filled",
  "filled",
  "won",
  "lost",
  "scratched",
  "cancelled",
  "rejected",
];

/**
 * FSM transitions legal from each current state. Mirrors
 * `services/control_plane/app/execution/live_trade_fsm.py`. The server
 * authoritatively enforces these; the UI just narrows the dropdown.
 */
const LEGAL_TRANSITIONS: Record<LiveTradeStatus, ReadonlyArray<LiveTradeStatus>> = {
  pending_submit: ["submitted", "rejected", "cancelled"],
  submitted: ["partially_filled", "filled", "rejected", "cancelled"],
  partially_filled: ["filled", "cancelled"],
  filled: ["won", "lost", "scratched"],
  won: [],
  lost: [],
  scratched: [],
  cancelled: [],
  rejected: [],
};

/** Pure statuses — terminal. A cancel is only legal on open rows. */
function isOpenStatus(s: LiveTradeStatus): boolean {
  return (
    s === "pending_submit" ||
    s === "submitted" ||
    s === "partially_filled"
  );
}

// ──────────────────────────── page ─────────────────────────────────────

export default function ExecutionOrdersPage() {
  const qc = useQueryClient();

  const [accountId, setAccountId] = useState("");
  const [symbolId, setSymbolId] = useState("");
  const [direction, setDirection] = useState<Direction | "">("");
  const [status, setStatus] = useState<LiveTradeStatus | "">("");
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(
    null,
  );

  const filter: LiveTradeFilter = useMemo(() => {
    const f: LiveTradeFilter = { limit: 100 };
    if (accountId.trim()) f.accountId = accountId.trim();
    if (symbolId.trim()) f.symbolId = symbolId.trim();
    if (direction) f.direction = direction;
    if (status) f.status = status;
    return f;
  }, [accountId, symbolId, direction, status]);

  const liveTradesQuery = useQuery({
    queryKey: ["live-trades", "list", filter],
    queryFn: () => api.liveTrades.list(filter),
    refetchInterval: 10_000,
  });

  const patchStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: LiveTradeStatus }) =>
      api.liveTrades.patchStatus(id, { status: next }),
    onSuccess: () => {
      setRowError(null);
      void qc.invalidateQueries({ queryKey: ["live-trades"] });
    },
    onError: (err, vars) =>
      setRowError({ id: vars.id, msg: pickErrorMessage(err) }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      api.liveTrades.cancel(id, { reason: "Cancelled from operator blotter" }),
    onSuccess: () => {
      setRowError(null);
      void qc.invalidateQueries({ queryKey: ["live-trades"] });
    },
    onError: (err, id) => setRowError({ id, msg: pickErrorMessage(err) }),
  });

  const columns: ReadonlyArray<DataTableColumn<LiveTrade>> = [
    {
      key: "id",
      header: "Trade",
      render: (t) => (
        <div>
          <code className="font-mono text-xs text-slate-900">
            {t.id.slice(0, 10)}…
          </code>
          {t.brokerOrderId ? (
            <div className="mt-0.5 font-mono text-[10px] text-slate-500">
              broker: {t.brokerOrderId.slice(0, 14)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "setup",
      header: "Setup",
      render: (t) => (
        <Link
          href={`/intel/setups/${encodeURIComponent(t.setupId)}`}
          className="font-mono text-xs text-sky-700 hover:underline"
        >
          {t.setupId.slice(0, 10)}…
        </Link>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (t) => (
        <div className="font-mono text-xs text-slate-700">{t.symbolId}</div>
      ),
    },
    {
      key: "direction",
      header: "Side",
      render: (t) => <Badge tone={DIRECTION_TONE[t.direction]}>{t.direction}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => {
        const legal = LEGAL_TRANSITIONS[t.status];
        const busy =
          patchStatusMutation.isPending &&
          patchStatusMutation.variables?.id === t.id;
        if (legal.length === 0) {
          return <Badge tone={LIVE_TRADE_TONE[t.status]}>{t.status}</Badge>;
        }
        return (
          <div className="flex items-center gap-2">
            <Badge tone={LIVE_TRADE_TONE[t.status]}>{t.status}</Badge>
            <select
              aria-label="Advance status"
              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px]"
              disabled={busy}
              value=""
              onChange={(e) => {
                const next = e.target.value as LiveTradeStatus;
                if (!next) return;
                patchStatusMutation.mutate({ id: t.id, next });
              }}
            >
              <option value="">→</option>
              {legal.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        );
      },
    },
    {
      key: "qty",
      header: "Qty",
      render: (t) => (
        <div className="font-mono text-xs">
          <div className="text-slate-900">{t.filledQty.toFixed(2)}</div>
          <div className="text-[10px] text-slate-500">of {t.qty.toFixed(2)}</div>
        </div>
      ),
    },
    {
      key: "entry",
      header: "Entry",
      render: (t) => (
        <div className="font-mono text-xs">
          <div className="text-slate-900">
            {t.avgFillPrice != null ? t.avgFillPrice.toFixed(4) : "—"}
          </div>
          <div className="text-[10px] text-slate-500">
            ref {t.entryRef.toFixed(4)}
          </div>
        </div>
      ),
    },
    {
      key: "pnlDollars",
      header: "PnL $",
      render: (t) => {
        if (t.realizedPnLDollars == null) {
          return <span className="font-mono text-xs text-slate-500">—</span>;
        }
        const positive = t.realizedPnLDollars > 0;
        const negative = t.realizedPnLDollars < 0;
        const cls = positive
          ? "text-emerald-700"
          : negative
            ? "text-rose-700"
            : "text-slate-700";
        return (
          <span className={`font-mono text-xs ${cls}`}>
            {positive ? "+" : ""}
            {t.realizedPnLDollars.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: "pnlR",
      header: "PnL R",
      render: (t) => {
        if (t.pnlR == null) {
          return <span className="font-mono text-xs text-slate-500">—</span>;
        }
        const positive = t.pnlR > 0;
        const cls = positive
          ? "text-emerald-700"
          : t.pnlR < 0
            ? "text-rose-700"
            : "text-slate-700";
        return (
          <span className={`font-mono text-xs ${cls}`}>
            {positive ? "+" : ""}
            {t.pnlR.toFixed(2)}R
          </span>
        );
      },
    },
    {
      key: "approvedAt",
      header: "Approved",
      render: (t) => formatDate(t.approvedAt),
    },
    {
      key: "filledAt",
      header: "Filled",
      render: (t) => formatDate(t.filledAt),
    },
    {
      key: "actions",
      header: "",
      render: (t) => {
        const canCancel = isOpenStatus(t.status);
        const busy =
          cancelMutation.isPending && cancelMutation.variables === t.id;
        return (
          <div className="flex items-center gap-2">
            {canCancel ? (
              <Button
                size="sm"
                variant="danger"
                loading={busy}
                onClick={() => cancelMutation.mutate(t.id)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const rows = liveTradesQuery.data?.trades ?? [];
  const total = liveTradesQuery.data?.total ?? 0;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Execution · Orders"
        description="Live-trade blotter — broker round-trip state, fills, and realised PnL. Status transitions + cancels are admin-audited and FSM-enforced."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-700">
          Account ID
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="(any)"
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
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
              setStatus((e.target.value || "") as LiveTradeStatus | "")
            }
          >
            <option value="">(any)</option>
            {LIVE_TRADE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rowError ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          <span className="font-mono">
            {rowError.id.slice(0, 10)}…
          </span>
          : {rowError.msg}
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={liveTradesQuery.isLoading}
        error={
          liveTradesQuery.error ? pickErrorMessage(liveTradesQuery.error) : null
        }
        emptyMessage="No live trades match this filter"
        rowKey={(t) => t.id}
      />

      {liveTradesQuery.data ? (
        <p className="text-xs text-slate-500">
          Showing {rows.length} of {total} live trades.
        </p>
      ) : null}
    </section>
  );
}
