"use client";

/**
 * Portfolio · Exposure — Phase 6 surface.
 *
 * Wires two control-plane routes:
 *
 *   GET /v1/portfolio/accounts   → PortfolioAccountsList
 *   GET /v1/portfolio/exposure   → PortfolioExposureReport
 *
 * Layout:
 *   ▸ filters (account + asOf)
 *   ▸ top strip: equity / gross / net / % of equity
 *   ▸ warnings panel (risk-budget breaches evaluated server-side)
 *   ▸ per-correlation-class roll-up
 *   ▸ per-symbol detail (long/short, notional, unrealised PnL, % equity)
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  PortfolioClassExposure,
  PortfolioExposureFilter,
  PortfolioExposureWarning,
  PortfolioSymbolExposure,
} from "@gv/types";

const USD = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(v: number): string {
  return USD.format(v);
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const WARN_TONE: Record<
  PortfolioExposureWarning["severity"],
  "info" | "warn" | "danger"
> = {
  info: "info",
  warn: "warn",
  critical: "danger",
};

const WARN_LABEL: Record<PortfolioExposureWarning["code"], string> = {
  gross_exposure_breach: "Gross exposure breach",
  correlated_exposure_breach: "Correlated class breach",
  single_symbol_concentration: "Single-symbol concentration",
  drawdown_cap_approaching: "Drawdown cap approaching",
  cross_account_duplication: "Cross-account duplication",
};

export default function PortfolioExposurePage() {
  const [accountId, setAccountId] = useState<string>("");
  const [asOf, setAsOf] = useState<string>("");

  const accountsQuery = useQuery({
    queryKey: ["portfolio", "accounts"],
    queryFn: () => api.portfolio.accounts.list(),
    staleTime: 60_000,
  });

  const filter: PortfolioExposureFilter = useMemo(() => {
    const f: PortfolioExposureFilter = {};
    if (accountId) f.accountId = accountId;
    if (asOf) f.asOf = new Date(asOf).toISOString();
    return f;
  }, [accountId, asOf]);

  const exposureQuery = useQuery({
    queryKey: ["portfolio", "exposure", filter],
    queryFn: () => api.portfolio.exposure.get(filter),
    refetchInterval: 15_000,
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const report = exposureQuery.data;

  const classColumns: ReadonlyArray<DataTableColumn<PortfolioClassExposure>> = [
    {
      key: "correlationClass",
      header: "Class",
      render: (c) => (
        <span className="font-mono text-xs text-slate-900">
          {c.correlationClass.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "symbolCount",
      header: "Symbols",
      render: (c) => (
        <span className="font-mono text-xs text-slate-700">{c.symbolCount}</span>
      ),
    },
    {
      key: "grossNotional",
      header: "Gross $",
      render: (c) => (
        <span className="font-mono text-xs text-slate-900">
          {formatUsd(c.grossNotional)}
        </span>
      ),
    },
    {
      key: "netNotional",
      header: "Net $",
      render: (c) => (
        <span
          className={`font-mono text-xs ${
            c.netNotional > 0
              ? "text-emerald-700"
              : c.netNotional < 0
                ? "text-rose-700"
                : "text-slate-700"
          }`}
        >
          {formatUsd(c.netNotional)}
        </span>
      ),
    },
    {
      key: "grossPercentOfEquity",
      header: "% Equity (gross)",
      render: (c) => (
        <span className="font-mono text-xs text-slate-700">
          {formatPct(c.grossPercentOfEquity)}
        </span>
      ),
    },
    {
      key: "netPercentOfEquity",
      header: "% Equity (net)",
      render: (c) => (
        <span className="font-mono text-xs text-slate-700">
          {formatPct(c.netPercentOfEquity)}
        </span>
      ),
    },
  ];

  const symbolColumns: ReadonlyArray<DataTableColumn<PortfolioSymbolExposure>> = [
    {
      key: "symbolId",
      header: "Symbol",
      render: (s) => (
        <code className="font-mono text-xs text-slate-900">{s.symbolId}</code>
      ),
    },
    {
      key: "correlationClass",
      header: "Class",
      render: (s) => (
        <span className="text-[11px] text-slate-700">
          {s.correlationClass.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      key: "direction",
      header: "Side",
      render: (s) => (
        <Badge tone={s.direction === "long" ? "success" : "danger"}>
          {s.direction}
        </Badge>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      render: (s) => (
        <span className="font-mono text-xs text-slate-700">
          {s.qty.toLocaleString()}
        </span>
      ),
    },
    {
      key: "notional",
      header: "Notional",
      render: (s) => (
        <span className="font-mono text-xs text-slate-900">
          {formatUsd(s.notional)}
        </span>
      ),
    },
    {
      key: "unrealizedPnl",
      header: "Unrl. PnL",
      render: (s) => (
        <span
          className={`font-mono text-xs ${
            s.unrealizedPnl > 0
              ? "text-emerald-700"
              : s.unrealizedPnl < 0
                ? "text-rose-700"
                : "text-slate-700"
          }`}
        >
          {formatUsd(s.unrealizedPnl)}
        </span>
      ),
    },
    {
      key: "unrealizedR",
      header: "Unrl. R",
      render: (s) =>
        s.unrealizedR == null ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span
            className={`font-mono text-xs ${
              s.unrealizedR > 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {s.unrealizedR > 0 ? "+" : ""}
            {s.unrealizedR.toFixed(2)}R
          </span>
        ),
    },
    {
      key: "percentOfEquity",
      header: "% Equity",
      render: (s) => (
        <span
          className={`font-mono text-xs ${
            s.percentOfEquity > 0.1
              ? "text-amber-700"
              : "text-slate-700"
          }`}
        >
          {formatPct(s.percentOfEquity)}
        </span>
      ),
    },
    {
      key: "setupIds",
      header: "Setups",
      render: (s) => (
        <span className="font-mono text-[11px] text-slate-500">
          {s.setupIds.length ? s.setupIds.length : "—"}
        </span>
      ),
    },
    {
      key: "liveTradeIds",
      header: "Trades",
      render: (s) => (
        <span className="font-mono text-[11px] text-slate-500">
          {s.liveTradeIds.length ? s.liveTradeIds.length : "—"}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Portfolio · Exposure"
        description="Per-symbol, per-correlation-class, and per-account exposure — long/short, notional, % of equity — with risk-budget breach warnings evaluated server-side."
      />

      {/* Filters */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
              disabled={accountsQuery.isLoading}
            >
              <option value="">Default account</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.displayName} · {a.provider}
                  {a.liveEnabled ? " · live" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            As of (UTC)
            <input
              type="datetime-local"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="ml-auto text-[11px] text-slate-500">
            {report ? (
              <>Observed {formatRelative(report.observedAt)}</>
            ) : (
              <>—</>
            )}
          </div>
        </div>
      </section>

      {/* Top strip */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {report ? (
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Equity
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {formatUsd(report.totalEquity)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Gross notional
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {formatUsd(report.grossNotional)}
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                {formatPct(report.grossPercentOfEquity)} of equity
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Net notional
              </div>
              <div
                className={`mt-1 font-mono text-sm ${
                  report.netNotional > 0
                    ? "text-emerald-700"
                    : report.netNotional < 0
                      ? "text-rose-700"
                      : "text-slate-900"
                }`}
              >
                {formatUsd(report.netNotional)}
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                {formatPct(report.netPercentOfEquity)} of equity
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Symbols · classes
              </div>
              <div className="mt-1 font-mono text-sm text-slate-900">
                {report.bySymbol.length} / {report.byCorrelationClass.length}
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                {report.warnings.length} warning
                {report.warnings.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        ) : exposureQuery.isLoading ? (
          <div className="text-xs text-slate-500">Loading exposure…</div>
        ) : exposureQuery.error ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {pickErrorMessage(exposureQuery.error)}
          </div>
        ) : (
          <div className="text-xs text-slate-500">No exposure data.</div>
        )}
      </section>

      {/* Warnings */}
      {report && report.warnings.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Risk-budget warnings
          </h2>
          <ul className="mt-2 space-y-1">
            {report.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge tone={WARN_TONE[w.severity]}>{w.severity}</Badge>
                <div>
                  <div className="font-medium text-amber-900">
                    {WARN_LABEL[w.code]}
                    {w.subjectKey ? (
                      <code className="ml-2 font-mono text-[11px] text-amber-800">
                        {w.subjectKey}
                      </code>
                    ) : null}
                  </div>
                  <div className="text-amber-800">{w.message}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Per-class */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            By correlation class
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Aggregated across all symbols in each class. The live gate evaluates
            its <code className="font-mono">maxCorrelatedExposure</code> cap
            against these rows.
          </p>
        </header>
        <DataTable
          rows={report?.byCorrelationClass ?? []}
          columns={classColumns}
          loading={exposureQuery.isLoading}
          error={exposureQuery.error ? pickErrorMessage(exposureQuery.error) : null}
          emptyMessage="No exposure by class."
          rowKey={(c) => c.correlationClass}
        />
      </section>

      {/* Per-symbol */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              By symbol
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              One row per open position. Closed legs are excluded. Highlighted
              rows have &gt;10% of equity on a single symbol.
            </p>
          </div>
          <div className="text-[11px] text-slate-500">
            {report ? `${report.bySymbol.length} positions` : "—"}
          </div>
        </header>
        <DataTable
          rows={report?.bySymbol ?? []}
          columns={symbolColumns}
          loading={exposureQuery.isLoading}
          error={exposureQuery.error ? pickErrorMessage(exposureQuery.error) : null}
          emptyMessage="No open positions."
          rowKey={(s) => s.symbolId}
        />
      </section>

      <p className="text-xs text-slate-500">
        Correlation buckets are configured under{" "}
        <Link href="/settings" className="text-sky-700 hover:underline">
          Settings · System Config
        </Link>{" "}
        (<code className="font-mono">portfolio.correlation_map</code>). Kill-switch state
        lives on{" "}
        <Link href="/admin/kill-switch" className="text-sky-700 hover:underline">
          Admin · Kill Switch
        </Link>
        .
      </p>
    </section>
  );
}
