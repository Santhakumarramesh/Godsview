"use client";

/**
 * Portfolio · PnL — Phase 6 surface.
 *
 * Wires two control-plane routes:
 *
 *   GET /v1/portfolio/accounts   → PortfolioAccountsList
 *   GET /v1/portfolio/pnl        → PortfolioPnlReport (summary + points)
 *
 * The page renders a summary strip (equity / R / win-rate / drawdown),
 * a daily PnL timeseries table, and a SVG equity curve. Filters:
 * account, start-date, end-date. Unbounded ranges clamp to the last
 * 90 days server-side.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { pickErrorMessage } from "@/lib/format";
import type {
  PortfolioPnlFilter,
  PortfolioPnlPoint,
  PortfolioPnlSummary,
} from "@gv/types";

const USD = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatUsd(v: number): string {
  return USD.format(v);
}

function formatR(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}R`;
}

function toneForR(v: number): "neutral" | "success" | "danger" {
  if (v > 0.01) return "success";
  if (v < -0.01) return "danger";
  return "neutral";
}

function EquityCurve({ points }: { points: ReadonlyArray<PortfolioPnlPoint> }) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        No data to chart.
      </div>
    );
  }
  const width = 720;
  const height = 160;
  const padX = 24;
  const padY = 12;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.endEquity);
  const xMin = 0;
  const xMax = Math.max(1, xs.length - 1);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const y0 = yMin - yPad;
  const y1 = yMax + yPad;
  const mapX = (i: number) =>
    padX + ((i - xMin) / (xMax - xMin || 1)) * (width - 2 * padX);
  const mapY = (v: number) =>
    height - padY - ((v - y0) / (y1 - y0 || 1)) * (height - 2 * padY);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${mapX(i).toFixed(2)} ${mapY(p.endEquity).toFixed(2)}`)
    .join(" ");
  const area = `${path} L ${mapX(xMax).toFixed(2)} ${(height - padY).toFixed(2)} L ${mapX(xMin).toFixed(2)} ${(height - padY).toFixed(2)} Z`;

  // peak line (for drawdown visibility)
  const peakPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${mapX(i).toFixed(2)} ${mapY(p.peakEquity).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Equity curve"
    >
      <defs>
        <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(14 165 233)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="rgb(14 165 233)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill="white" />
      <path d={area} fill="url(#equity-fill)" />
      <path d={peakPath} fill="none" stroke="rgb(148 163 184)" strokeWidth="1" strokeDasharray="4 3" />
      <path d={path} fill="none" stroke="rgb(2 132 199)" strokeWidth="1.5" />
    </svg>
  );
}

function SummaryStrip({ summary }: { summary: PortfolioPnlSummary }) {
  const netDelta = summary.endingEquity - summary.startingEquity;
  const netTone =
    netDelta > 0 ? "text-emerald-700" : netDelta < 0 ? "text-rose-700" : "text-slate-700";
  return (
    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 md:grid-cols-6">
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Equity</div>
        <div className="mt-1 font-mono text-sm text-slate-900">
          {formatUsd(summary.endingEquity)}
        </div>
        <div className={`mt-1 font-mono text-[11px] ${netTone}`}>
          {netDelta > 0 ? "+" : ""}
          {formatUsd(netDelta)}
        </div>
      </div>
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Net PnL</div>
        <div
          className={`mt-1 font-mono text-sm ${
            summary.netPnl > 0
              ? "text-emerald-700"
              : summary.netPnl < 0
                ? "text-rose-700"
                : "text-slate-900"
          }`}
        >
          {formatUsd(summary.netPnl)}
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">
          gross {formatUsd(summary.grossPnl)}
        </div>
      </div>
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Total R</div>
        <div className={`mt-1 font-mono text-sm ${summary.totalR >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {formatR(summary.totalR)}
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">
          best {formatR(summary.bestDayR)} · worst {formatR(summary.worstDayR)}
        </div>
      </div>
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Max Drawdown</div>
        <div className="mt-1 font-mono text-sm text-rose-700">
          {formatR(summary.maxDrawdownR)}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">across window</div>
      </div>
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Win Rate</div>
        <div className="mt-1 font-mono text-sm text-slate-900">
          {(summary.winRate * 100).toFixed(0)}%
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">
          {summary.winningTrades}W · {summary.losingTrades}L · {summary.scratchTrades}S
        </div>
      </div>
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Trades</div>
        <div className="mt-1 font-mono text-sm text-slate-900">
          {summary.tradeCount}
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">
          {summary.startDate} → {summary.endDate}
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPnlPage() {
  const [accountId, setAccountId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const accountsQuery = useQuery({
    queryKey: ["portfolio", "accounts"],
    queryFn: () => api.portfolio.accounts.list(),
    staleTime: 60_000,
  });

  const filter: PortfolioPnlFilter = useMemo(() => {
    const f: PortfolioPnlFilter = {};
    if (accountId) f.accountId = accountId;
    if (startDate) f.startDate = startDate;
    if (endDate) f.endDate = endDate;
    return f;
  }, [accountId, startDate, endDate]);

  const pnlQuery = useQuery({
    queryKey: ["portfolio", "pnl", filter],
    queryFn: () => api.portfolio.pnl.report(filter),
    refetchInterval: 30_000,
  });

  const columns: ReadonlyArray<DataTableColumn<PortfolioPnlPoint>> = [
    {
      key: "observedDate",
      header: "Date",
      render: (p) => (
        <span className="font-mono text-xs text-slate-900">{p.observedDate}</span>
      ),
    },
    {
      key: "rToday",
      header: "R",
      render: (p) => <Badge tone={toneForR(p.rToday)}>{formatR(p.rToday)}</Badge>,
    },
    {
      key: "cumulativeR",
      header: "Cum R",
      render: (p) => (
        <span
          className={`font-mono text-xs ${
            p.cumulativeR >= 0 ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {formatR(p.cumulativeR)}
        </span>
      ),
    },
    {
      key: "netPnl",
      header: "Net $",
      render: (p) => (
        <span
          className={`font-mono text-xs ${
            p.netPnl > 0 ? "text-emerald-700" : p.netPnl < 0 ? "text-rose-700" : "text-slate-700"
          }`}
        >
          {formatUsd(p.netPnl)}
        </span>
      ),
    },
    {
      key: "realized",
      header: "Realized",
      render: (p) => (
        <span className="font-mono text-xs text-slate-700">{formatUsd(p.realized)}</span>
      ),
    },
    {
      key: "unrealized",
      header: "Unrealized",
      render: (p) => (
        <span className="font-mono text-xs text-slate-700">{formatUsd(p.unrealized)}</span>
      ),
    },
    {
      key: "fees",
      header: "Fees",
      render: (p) => (
        <span className="font-mono text-xs text-slate-500">{formatUsd(p.fees)}</span>
      ),
    },
    {
      key: "drawdownR",
      header: "DD R",
      render: (p) => (
        <span
          className={`font-mono text-xs ${
            p.drawdownR < -0.01 ? "text-rose-700" : "text-slate-500"
          }`}
        >
          {formatR(p.drawdownR)}
        </span>
      ),
    },
    {
      key: "endEquity",
      header: "Equity",
      render: (p) => (
        <span className="font-mono text-xs text-slate-900">{formatUsd(p.endEquity)}</span>
      ),
    },
    {
      key: "tradeCount",
      header: "Trades",
      render: (p) => (
        <span className="font-mono text-xs text-slate-500">{p.tradeCount}</span>
      ),
    },
  ];

  const accounts = accountsQuery.data?.accounts ?? [];
  const report = pnlQuery.data;
  // Show most-recent first in the table
  const rows = useMemo(
    () => (report ? [...report.points].reverse() : []),
    [report],
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Portfolio · PnL"
        description="Realized + unrealized PnL per account with daily timeseries, equity curve, R-denominated drawdown, and win-rate summary."
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
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.displayName} · {a.provider}
                  {a.liveEnabled ? " · live" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="ml-auto text-[11px] text-slate-500">
            Unbounded ranges clamp to the last 90 days.
          </div>
        </div>
      </section>

      {/* Summary + Chart */}
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        {report ? (
          <>
            <SummaryStrip summary={report.summary} />
            <EquityCurve points={report.points} />
          </>
        ) : pnlQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-slate-500">
            Loading PnL…
          </div>
        ) : pnlQuery.error ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {pickErrorMessage(pnlQuery.error)}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-slate-500">
            No PnL points returned for this window.
          </div>
        )}
      </section>

      {/* Daily table */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Daily PnL</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Most recent first. R-denominated values use the Phase 4 risk-budget
              unit for the point-in-time account.
            </p>
          </div>
          <div className="text-[11px] text-slate-500">
            {report ? `${report.points.length} rows` : "—"}
          </div>
        </header>
        <DataTable
          rows={rows}
          columns={columns}
          loading={pnlQuery.isLoading}
          error={pnlQuery.error ? pickErrorMessage(pnlQuery.error) : null}
          emptyMessage="No PnL points in window."
          rowKey={(p) => p.observedDate}
        />
      </section>

      <p className="text-xs text-slate-500">
        Exposure breakdowns live on{" "}
        <Link href="/portfolio/exposure" className="text-sky-700 hover:underline">
          Portfolio · Exposure
        </Link>
        . Capital-allocation targets live on{" "}
        <Link href="/portfolio/allocation" className="text-sky-700 hover:underline">
          Portfolio · Allocation
        </Link>
        .
      </p>
    </section>
  );
}
