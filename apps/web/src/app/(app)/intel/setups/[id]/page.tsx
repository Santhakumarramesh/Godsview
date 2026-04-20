"use client";

/**
 * Intelligence · Setups · Detail — Phase 4 execution-gate surface.
 *
 * Wired in Phase 4 PR7 against:
 *   GET   /v1/setups/:id                     → SetupDetailResponse
 *   POST  /v1/execution/live/preview         → LivePreviewOut
 *   POST  /v1/setups/:id/approve-live        → LiveApprovalOut
 *   GET   /v1/live-trades?setupId=…          → LiveTradesListOut
 *
 * The page renders:
 *   1. Setup metadata + confidence components + recall neighbours.
 *   2. A "live-gate preview" panel — operators fill in `accountId`
 *      (pulled from the setup-level risk budget) and optionally nudge
 *      the per-trade risk / gross / correlated caps via OverrideRisk.
 *      The preview is a pure dry-run: no broker side-effects.
 *   3. An "approve live" button gated on `preview.approved === true` —
 *      submits the order and displays the freshly-minted LiveTrade row.
 *   4. The full live-trade ledger for this setup, auto-refreshing.
 */

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@gv/ui";
import { use, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type {
  Direction,
  LivePreviewIn,
  LivePreviewOut,
  LiveTrade,
  LiveTradeStatus,
  OverrideRisk,
  SetupRecallMatch,
  SetupStatus,
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

const LIVE_TRADE_TONE: Record<
  LiveTradeStatus,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  pending_submit: "info",
  submitted: "info",
  partially_filled: "warn",
  filled: "warn",
  won: "success",
  lost: "danger",
  scratched: "neutral",
  cancelled: "neutral",
  rejected: "danger",
};

const RECALL_OUTCOME_TONE: Record<
  SetupRecallMatch["outcome"],
  "success" | "danger" | "neutral" | "info"
> = {
  win: "success",
  loss: "danger",
  scratch: "neutral",
  open: "info",
};

export default function SetupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SetupDetailInner setupId={id} />;
}

function SetupDetailInner({ setupId }: { setupId: string }) {
  const qc = useQueryClient();

  // ── setup metadata ───────────────────────────────────────────────
  const setupQuery = useQuery({
    queryKey: ["setup", setupId],
    queryFn: () => api.setups.get(setupId),
  });

  // ── live-gate form state ─────────────────────────────────────────
  const [accountId, setAccountId] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [maxDollarRisk, setMaxDollarRisk] = useState("");
  const [maxGrossExposure, setMaxGrossExposure] = useState("");
  const [maxCorrelatedExposure, setMaxCorrelatedExposure] = useState("");
  const [preview, setPreview] = useState<LivePreviewOut | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const buildOverrideRisk = (): OverrideRisk | undefined => {
    if (!overrideEnabled) return undefined;
    const override: OverrideRisk = {};
    const parseNum = (v: string): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const dr = parseNum(maxDollarRisk);
    const ge = parseNum(maxGrossExposure);
    const ce = parseNum(maxCorrelatedExposure);
    if (dr !== undefined) override.maxDollarRisk = dr;
    if (ge !== undefined) override.maxGrossExposure = ge;
    if (ce !== undefined) override.maxCorrelatedExposure = ce;
    return Object.keys(override).length > 0 ? override : undefined;
  };

  const previewMutation = useMutation({
    mutationFn: (req: LivePreviewIn) => api.liveExecution.previewGate(req),
    onSuccess: (data) => {
      setPreview(data);
      setPreviewError(null);
      setApproveError(null);
    },
    onError: (err) => {
      setPreview(null);
      setPreviewError(pickErrorMessage(err));
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => {
      if (!accountId.trim()) {
        throw new Error("accountId is required before approving live");
      }
      const req: LivePreviewIn = {
        setupId,
        accountId: accountId.trim(),
        mode: "live",
      };
      const override = buildOverrideRisk();
      if (override) req.overrideRisk = override;
      return api.liveExecution.approve(setupId, req);
    },
    onSuccess: (data) => {
      setApproveError(null);
      if (data.approved && data.liveTrade) {
        // clear the preview so the operator can't double-fire
        setPreview(null);
      } else if (!data.approved) {
        setApproveError(
          `Rejected: ${data.reason} — ${data.detail || "no detail"}`,
        );
      }
      void qc.invalidateQueries({ queryKey: ["live-trades", setupId] });
      void qc.invalidateQueries({ queryKey: ["setup", setupId] });
    },
    onError: (err) => setApproveError(pickErrorMessage(err)),
  });

  function submitPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accountId.trim()) {
      setPreviewError("accountId is required");
      setPreview(null);
      return;
    }
    const req: LivePreviewIn = {
      setupId,
      accountId: accountId.trim(),
      mode: "live",
    };
    const override = buildOverrideRisk();
    if (override) req.overrideRisk = override;
    previewMutation.mutate(req);
  }

  // ── live trades for this setup ───────────────────────────────────
  const liveTradesQuery = useQuery({
    queryKey: ["live-trades", setupId],
    queryFn: () => api.liveTrades.list({ setupId, limit: 100 }),
    refetchInterval: 10_000,
  });

  const liveTradeColumns: ReadonlyArray<DataTableColumn<LiveTrade>> = useMemo(
    () => [
      {
        key: "id",
        header: "Trade",
        render: (t) => (
          <code className="font-mono text-xs">{t.id.slice(0, 12)}…</code>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (t) => <Badge tone={LIVE_TRADE_TONE[t.status]}>{t.status}</Badge>,
      },
      {
        key: "direction",
        header: "Side",
        render: (t) => (
          <Badge tone={DIRECTION_TONE[t.direction]}>{t.direction}</Badge>
        ),
      },
      {
        key: "qty",
        header: "Qty",
        render: (t) => (
          <span className="font-mono text-xs">
            {t.filledQty || 0}/{t.qty}
          </span>
        ),
      },
      {
        key: "entry",
        header: "Entry",
        render: (t) => (
          <span className="font-mono text-xs">
            {t.avgFillPrice !== null
              ? t.avgFillPrice.toFixed(4)
              : t.entryRef.toFixed(4)}
          </span>
        ),
      },
      {
        key: "pnl",
        header: "PnL $",
        render: (t) => (
          <span
            className={
              "font-mono text-xs " +
              (t.realizedPnLDollars === null
                ? "text-slate-500"
                : t.realizedPnLDollars >= 0
                  ? "text-emerald-700"
                  : "text-rose-700")
            }
          >
            {t.realizedPnLDollars === null
              ? "—"
              : `$${t.realizedPnLDollars.toFixed(2)}`}
          </span>
        ),
      },
      {
        key: "pnlR",
        header: "PnL R",
        render: (t) => (
          <span className="font-mono text-xs">
            {t.pnlR === null ? "—" : `${t.pnlR.toFixed(2)}R`}
          </span>
        ),
      },
      {
        key: "approved",
        header: "Approved",
        render: (t) => formatDate(t.approvedAt),
      },
      {
        key: "filled",
        header: "Filled",
        render: (t) => formatDate(t.filledAt),
      },
    ],
    [],
  );

  if (setupQuery.isLoading) {
    return (
      <section className="space-y-4">
        <PageHeader title="Intelligence · Setup Detail" description="Loading…" />
      </section>
    );
  }

  if (setupQuery.error || !setupQuery.data) {
    return (
      <section className="space-y-4">
        <PageHeader
          title="Intelligence · Setup Detail"
          description="Failed to load the setup."
        />
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {setupQuery.error
            ? pickErrorMessage(setupQuery.error)
            : "Setup not found."}
        </div>
        <Link
          href="/intel/setups"
          className="text-sm text-sky-700 hover:underline"
        >
          ← Back to setups
        </Link>
      </section>
    );
  }

  const { setup, recall, paperTrade } = setupQuery.data;

  const canApproveLive =
    preview?.approved === true &&
    setup.status !== "approved_live" &&
    setup.status !== "filled" &&
    setup.status !== "closed" &&
    setup.status !== "expired" &&
    setup.status !== "rejected";

  return (
    <section className="space-y-6">
      <PageHeader
        title={`Setup · ${setup.id.slice(0, 12)}…`}
        description={`${setup.type.replaceAll("_", " ")} · ${setup.direction} · ${setup.tf}`}
      />

      <div className="flex items-center gap-2 text-xs">
        <Link
          href="/intel/setups"
          className="text-sky-700 hover:underline"
        >
          ← Setups
        </Link>
      </div>

      {/* ── metadata card ─────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <MetaRow label="Symbol" value={setup.symbolId} mono />
              <MetaRow label="Timeframe" value={setup.tf} mono />
              <MetaRow label="Type" value={setup.type} mono />
              <MetaRow
                label="Direction"
                value={
                  <Badge tone={DIRECTION_TONE[setup.direction]}>
                    {setup.direction}
                  </Badge>
                }
              />
              <MetaRow
                label="Status"
                value={<Badge tone={STATUS_TONE[setup.status]}>{setup.status}</Badge>}
              />
              <MetaRow label="Detected" value={formatDate(setup.detectedAt)} />
              <MetaRow label="Expires" value={formatDate(setup.expiresAt)} />
              <MetaRow
                label="Entry"
                value={
                  <span className="font-mono">
                    {setup.entry.ref.toFixed(4)}{" "}
                    <span className="text-slate-500">
                      [{setup.entry.low.toFixed(4)} –{" "}
                      {setup.entry.high.toFixed(4)}]
                    </span>
                  </span>
                }
              />
              <MetaRow
                label="Stop loss"
                value={<span className="font-mono">{setup.stopLoss.toFixed(4)}</span>}
              />
              <MetaRow
                label="Take profit"
                value={<span className="font-mono">{setup.takeProfit.toFixed(4)}</span>}
              />
              <MetaRow
                label="RR"
                value={<span className="font-mono">{setup.rr.toFixed(2)}</span>}
              />
            </dl>
            <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-700">
              {setup.reasoning}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confidence</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="mb-3">
              <div className="text-xs text-slate-500">Calibrated score</div>
              <div className="text-2xl font-semibold">
                {(setup.confidence.score * 100).toFixed(1)}%
              </div>
              <div className="mt-1 h-2 rounded bg-slate-100">
                <div
                  className="h-2 rounded bg-sky-500"
                  style={{
                    width: `${Math.round(setup.confidence.score * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Drawn from {setup.confidence.historyCount} historical setups.
              </div>
            </div>
            <dl className="space-y-1 text-xs">
              <ComponentBar
                label="Structure"
                value={setup.confidence.components.structureScore}
              />
              <ComponentBar
                label="Order flow"
                value={setup.confidence.components.orderFlowScore}
              />
              <ComponentBar
                label="Regime"
                value={setup.confidence.components.regimeScore}
              />
              <ComponentBar
                label="Session"
                value={setup.confidence.components.sessionScore}
              />
              <ComponentBar
                label="History"
                value={setup.confidence.components.historyScore}
              />
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* ── live gate card ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Phase 4 · Live execution gate</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submitPreview}>
            <label className="text-xs font-medium text-slate-700">
              Account ID
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                placeholder="acct_abc123"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={overrideEnabled}
                onChange={(e) => setOverrideEnabled(e.target.checked)}
              />
              Override risk envelope
            </label>
            {overrideEnabled ? (
              <>
                <label className="text-xs font-medium text-slate-700">
                  Max $ risk
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={maxDollarRisk}
                    onChange={(e) => setMaxDollarRisk(e.target.value)}
                    placeholder="(use budget default)"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Max gross exposure ($)
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={maxGrossExposure}
                    onChange={(e) => setMaxGrossExposure(e.target.value)}
                    placeholder="(use budget default)"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Max correlated exposure ($)
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={maxCorrelatedExposure}
                    onChange={(e) => setMaxCorrelatedExposure(e.target.value)}
                    placeholder="(use budget default)"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                  />
                </label>
              </>
            ) : null}
            <div className="md:col-span-2 flex items-center gap-3">
              <Button type="submit" loading={previewMutation.isPending}>
                Preview gate
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canApproveLive}
                loading={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
              >
                Approve live
              </Button>
              {!canApproveLive && preview?.approved === false ? (
                <span className="text-xs text-rose-700">
                  Gate rejected — resolve reason below before approval.
                </span>
              ) : null}
            </div>
            {previewError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {previewError}
              </div>
            ) : null}
            {approveError ? (
              <div className="md:col-span-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                {approveError}
              </div>
            ) : null}
          </form>

          {preview ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="mb-3 flex items-center gap-2">
                <Badge tone={preview.approved ? "success" : "danger"}>
                  {preview.approved ? "Approved" : "Rejected"}
                </Badge>
                <code className="font-mono text-xs text-slate-600">
                  {preview.reason}
                </code>
              </div>
              <p className="text-xs text-slate-700">{preview.detail}</p>
              {preview.sizing ? (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatBox label="Qty" value={preview.sizing.qty.toFixed(2)} />
                  <StatBox
                    label="Notional"
                    value={`$${preview.sizing.notional.toFixed(2)}`}
                  />
                  <StatBox
                    label="$ risk"
                    value={`$${preview.sizing.dollarRisk.toFixed(2)}`}
                  />
                  <StatBox
                    label="R risk"
                    value={preview.sizing.rRisk.toFixed(4)}
                  />
                </div>
              ) : null}
              {preview.risk ? (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <StatBox
                    label="Projected gross"
                    value={`$${preview.risk.projectedGross.toFixed(2)}`}
                  />
                  <StatBox
                    label="Projected correlated"
                    value={`$${preview.risk.projectedCorrelated.toFixed(2)}`}
                  />
                  <StatBox
                    label="Projected DD (R)"
                    value={preview.risk.drawdownR.toFixed(2)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ── live trades ledger ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Live trades for this setup</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            rows={liveTradesQuery.data?.trades ?? []}
            columns={liveTradeColumns}
            loading={liveTradesQuery.isLoading}
            error={
              liveTradesQuery.error
                ? pickErrorMessage(liveTradesQuery.error)
                : null
            }
            emptyMessage="No live trades yet."
            rowKey={(t) => t.id}
          />
          {liveTradesQuery.data ? (
            <p className="mt-2 text-xs text-slate-500">
              Showing {liveTradesQuery.data.trades.length} of{" "}
              {liveTradesQuery.data.total} live trades. Auto-refreshing every
              10s.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* ── paper trade (optional) ────────────────────────────── */}
      {paperTrade ? (
        <Card>
          <CardHeader>
            <CardTitle>Paper trade (Phase 3)</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-1 text-xs md:grid-cols-4">
              <MetaRow label="Status" value={paperTrade.status} mono />
              <MetaRow
                label="Entry"
                value={paperTrade.entryRef.toFixed(4)}
                mono
              />
              <MetaRow
                label="Stop"
                value={paperTrade.stopLoss.toFixed(4)}
                mono
              />
              <MetaRow
                label="Target"
                value={paperTrade.takeProfit.toFixed(4)}
                mono
              />
              <MetaRow
                label="Size ×"
                value={paperTrade.sizeMultiplier.toFixed(2)}
                mono
              />
              <MetaRow
                label="PnL R"
                value={paperTrade.pnlR === null ? "—" : paperTrade.pnlR.toFixed(2)}
                mono
              />
              <MetaRow label="Approved" value={formatDate(paperTrade.approvedAt)} />
              <MetaRow label="Closed" value={formatDate(paperTrade.closedAt)} />
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {/* ── recall matches ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Recall · similar historical setups</CardTitle>
        </CardHeader>
        <CardBody>
          {recall.length === 0 ? (
            <p className="text-xs text-slate-500">
              No recall neighbours yet — the similarity index is still warming
              up.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {recall.map((r) => (
                <li
                  key={r.setupId}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/intel/setups/${encodeURIComponent(r.setupId)}`}
                      className="font-mono text-xs text-sky-700 hover:underline"
                    >
                      {r.setupId.slice(0, 12)}…
                    </Link>
                    <span className="text-slate-500">
                      {formatDate(r.detectedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-600">
                      sim {Math.round(r.similarity * 100)}%
                    </span>
                    <Badge tone={RECALL_OUTCOME_TONE[r.outcome]}>
                      {r.outcome}
                    </Badge>
                    {r.pnlR !== null ? (
                      <span
                        className={
                          "font-mono text-xs " +
                          (r.pnlR >= 0 ? "text-emerald-700" : "text-rose-700")
                        }
                      >
                        {r.pnlR.toFixed(2)}R
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

// ─── tiny presentational helpers ─────────────────────────────────────

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </>
  );
}

function ComponentBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-xs text-slate-600">{label}</span>
      <div className="h-1.5 flex-1 rounded bg-slate-100">
        <div
          className="h-1.5 rounded bg-sky-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 text-right font-mono text-xs text-slate-600">
        {pct}%
      </span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="font-mono text-sm text-slate-900">{value}</div>
    </div>
  );
}
