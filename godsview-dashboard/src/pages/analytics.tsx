/**
 * analytics.tsx — Portfolio Performance Analytics & Circuit Breaker Dashboard
 *
 * Panels:
 *  1. CircuitBreakerPanel  — armed status, trip reason, reset/trip controls
 *  2. MetricsGrid          — Sharpe, Sortino, Calmar, win rate, max DD, etc.
 *  3. EquityCurveChart     — cumulative equity + drawdown over time (recharts)
 *  4. BreakdownTabs        — by setup | by symbol | by regime
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ─── API ──────────────────────────────────────────────────────────────────────

const BASE = "/api/analytics";

async function apiFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.message ?? `HTTP ${r.status}`); }
  return r.json();
}

const api = {
  equity:     (sym?: string) => apiFetch(`${BASE}/equity${sym ? `?symbol=${sym}` : ""}`),
  cb:         () => apiFetch(`${BASE}/circuit-breaker`),
  cbCheck:    () => apiFetch(`${BASE}/circuit-breaker/check`, { method: "POST" }),
  cbReset:    () => apiFetch(`${BASE}/circuit-breaker/reset`, { method: "POST" }),
  cbTrip:     (reason: string) => apiFetch(`${BASE}/circuit-breaker/trip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
  cbHistory:  () => apiFetch(`${BASE}/circuit-breaker/history`),
};

// ─── Formatters ───────────────────────────────────────────────────────────────

const pct = (v: number | null | undefined, dec = 1) => v == null ? "—" : `${(v * 100).toFixed(dec)}%`;
const num = (v: number | null | undefined, dec = 2) => v == null ? "—" : Number.isFinite(v) ? v.toFixed(dec) : "∞";
const pos = (v: number) => v >= 0 ? `text-emerald-600` : `text-red-500`;

// ─── Circuit Breaker Panel ────────────────────────────────────────────────────

function CircuitBreakerPanel() {
  const qc = useQueryClient();
  const { data: cbData, isLoading } = useQuery({
    queryKey: ["cb-status"],
    queryFn:  api.cb,
    refetchInterval: 10_000,
  });
  const { data: histData } = useQuery({ queryKey: ["cb-history"], queryFn: api.cbHistory, refetchInterval: 30_000 });

  const checkMut = useMutation({ mutationFn: api.cbCheck,  onSuccess: () => qc.invalidateQueries({ queryKey: ["cb-status"] }) });
  const resetMut = useMutation({ mutationFn: api.cbReset,  onSuccess: () => qc.invalidateQueries({ queryKey: ["cb-status"] }) });
  const tripMut  = useMutation({ mutationFn: () => api.cbTrip("Manual emergency halt via dashboard"), onSuccess: () => qc.invalidateQueries({ queryKey: ["cb-status"] }) });

  if (isLoading) return <div className="text-sm text-zinc-400 animate-pulse">Loading circuit breaker…</div>;
  const s = cbData?.status;
  if (!s) return null;

  const armed = s.armed;

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${
      armed
        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        : "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${armed ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`} />
          <div>
            <h2 className={`text-base font-bold ${armed ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
              Circuit Breaker — {armed ? "ARMED 🛑" : "Clear ✓"}
            </h2>
            {armed && s.lastTripDetail && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{s.lastTripDetail}</p>
            )}
            {armed && s.autoResetAt && (
              <p className="text-xs text-zinc-500 mt-0.5">Auto-reset: {new Date(s.autoResetAt).toLocaleTimeString()}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="h-8 px-3 text-sm rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 transition-colors"
            onClick={() => checkMut.mutate()}
            disabled={checkMut.isPending}
          >Check Now</button>
          {armed ? (
            <button
              className="h-8 px-3 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
            >Reset</button>
          ) : (
            <button
              className="h-8 px-3 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              onClick={() => { if (confirm("Engage emergency halt?")) tripMut.mutate(); }}
            >Emergency Halt</button>
          )}
        </div>
      </div>

      {/* Today stats vs thresholds */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        {[
          { label: "Session P&L",       value: pct(s.todayStats.sessionPnlPct),         limit: `Limit: ${pct(s.config.maxDailyLossPct)}`,         warn: s.todayStats.sessionPnlPct < -s.config.maxDailyLossPct * 0.75 },
          { label: "Consec. Losses",    value: String(s.todayStats.consecutiveLosses),   limit: `Limit: ${s.config.maxConsecutiveLosses}`,          warn: s.todayStats.consecutiveLosses >= s.config.maxConsecutiveLosses - 1 },
          { label: "Current Drawdown",  value: pct(s.todayStats.currentDrawdownPct),     limit: `Limit: ${pct(s.config.maxDrawdownPct)}`,           warn: s.todayStats.currentDrawdownPct > s.config.maxDrawdownPct * 0.75 },
        ].map(c => (
          <div key={c.label} className={`rounded-lg p-3 border ${c.warn ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800" : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800"}`}>
            <p className="text-zinc-500 uppercase tracking-wide font-medium">{c.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${c.warn ? "text-amber-600 dark:text-amber-400" : "text-zinc-700 dark:text-zinc-200"}`}>{c.value}</p>
            <p className="text-zinc-400 mt-0.5">{c.limit}</p>
          </div>
        ))}
      </div>

      {/* Trip history */}
      {histData?.history?.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Trip History ({histData.count})</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {histData.history.slice(0, 5).map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="text-red-500 font-mono">{new Date(t.triggeredAt).toLocaleString()}</span>
                <span className="text-zinc-400">—</span>
                <span className="font-medium text-zinc-600 dark:text-zinc-300">{t.reason}</span>
                <span className="text-zinc-400 truncate">{t.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Metrics Grid ─────────────────────────────────────────────────────────────

function MetricsGrid({ metrics }: { metrics: any }) {
  if (!metrics) return null;
  const cards = [
    { label: "Win Rate",        value: pct(metrics.winRate),         accent: metrics.winRate >= 0.55 ? "text-emerald-600" : "text-amber-500" },
    { label: "Profit Factor",   value: num(metrics.profitFactor),    accent: metrics.profitFactor >= 1.5 ? "text-emerald-600" : metrics.profitFactor >= 1 ? "text-amber-500" : "text-red-500" },
    { label: "Expectancy",      value: pct(metrics.expectancy),      accent: metrics.expectancy >= 0 ? "text-emerald-600" : "text-red-500" },
    { label: "Sharpe Ratio",    value: num(metrics.sharpeRatio),     accent: metrics.sharpeRatio >= 1 ? "text-emerald-600" : metrics.sharpeRatio >= 0.5 ? "text-amber-500" : "text-red-500" },
    { label: "Sortino",         value: num(metrics.sortinoRatio),    accent: metrics.sortinoRatio >= 1.5 ? "text-emerald-600" : "text-amber-500" },
    { label: "Calmar",          value: num(metrics.calmarRatio),     accent: metrics.calmarRatio >= 0.5 ? "text-emerald-600" : "text-amber-500" },
    { label: "Max Drawdown",    value: pct(metrics.maxDrawdown),     accent: metrics.maxDrawdown <= 0.05 ? "text-emerald-600" : metrics.maxDrawdown <= 0.10 ? "text-amber-500" : "text-red-500" },
    { label: "Cur. Drawdown",   value: pct(metrics.currentDrawdown), accent: metrics.currentDrawdown <= 0.03 ? "text-emerald-600" : "text-amber-500" },
    { label: "Avg Win",         value: pct(metrics.avgWinPct),       accent: "text-emerald-600" },
    { label: "Avg Loss",        value: pct(metrics.avgLossPct),      accent: "text-red-500" },
    { label: "Avg R:R",         value: num(metrics.avgRR),           accent: metrics.avgRR >= 1.5 ? "text-emerald-600" : "text-amber-500" },
    { label: "Total Trades",    value: String(metrics.totalTrades),  accent: "text-zinc-700 dark:text-zinc-200" },
    { label: "Win Streak",      value: String(metrics.maxWinStreak), accent: "text-emerald-600" },
    { label: "Loss Streak",     value: String(metrics.maxLossStreak),accent: metrics.maxLossStreak >= 3 ? "text-red-500" : "text-zinc-500" },
    { label: "Ann. Return",     value: pct(metrics.annualisedReturnPct), accent: metrics.annualisedReturnPct >= 0 ? "text-emerald-600" : "text-red-500" },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {cards.map(c => (
        <div key={c.label} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">{c.label}</p>
          <p className={`text-lg font-bold mt-0.5 ${c.accent}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Equity Chart ─────────────────────────────────────────────────────────────

function EquityChart({ curve }: { curve: any[] }) {
  if (!curve?.length) return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center text-sm text-zinc-400">
      No resolved trades yet — equity curve will populate as outcomes are recorded.
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Equity curve */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">Equity Curve</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={curve} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} tickFormatter={v => v.toFixed(0)} />
            <Tooltip
              formatter={(v: number) => [v.toFixed(2), "Equity"]}
              labelFormatter={l => `Date: ${l}`}
            />
            <ReferenceLine y={100} stroke="#a1a1aa" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Drawdown chart */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">Drawdown</h3>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={curve.map(p => ({ ...p, drawdownPct: p.drawdown * 100 }))} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)}%`} />
            <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "Drawdown"]} />
            <ReferenceLine y={0} stroke="#a1a1aa" />
            <Area type="monotone" dataKey="drawdownPct" stroke="#ef4444" fill="#fee2e2" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Breakdown Tables ─────────────────────────────────────────────────────────

function BreakdownTable({ rows, columns }: { rows: any[]; columns: { key: string; label: string; fmt: (v: any) => string; color?: (v: any) => string }[] }) {
  if (!rows?.length) return <div className="text-sm text-zinc-400 py-4 text-center">No data yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 dark:bg-zinc-800/50">
            {columns.map(c => (
              <th key={c.key} className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
              {columns.map(c => (
                <td key={c.key} className={`px-4 py-2.5 ${c.color ? c.color(row[c.key]) : "text-zinc-600 dark:text-zinc-300"}`}>
                  {c.fmt(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownTabs({ report }: { report: any }) {
  const [tab, setTab] = useState<"setup" | "symbol" | "regime">("setup");

  const setupCols = [
    { key: "setupType",   label: "Setup",       fmt: (v: string) => v, color: () => "font-mono text-xs text-zinc-600 dark:text-zinc-300" },
    { key: "trades",      label: "Trades",      fmt: String },
    { key: "winRate",     label: "Win Rate",    fmt: (v: number) => pct(v), color: (v: number) => v >= 0.55 ? "text-emerald-600 font-semibold" : "text-amber-500" },
    { key: "avgPnlPct",   label: "Avg PnL",     fmt: (v: number) => pct(v), color: (v: number) => v >= 0 ? "text-emerald-600" : "text-red-500" },
    { key: "expectancy",  label: "Expectancy",  fmt: (v: number) => pct(v), color: (v: number) => v >= 0 ? "text-emerald-600" : "text-red-500" },
    { key: "totalPnlPct", label: "Total PnL",   fmt: (v: number) => pct(v), color: (v: number) => v >= 0 ? "text-emerald-600 font-bold" : "text-red-500 font-bold" },
  ];

  const symCols = [
    { key: "symbol",    label: "Symbol",   fmt: (v: string) => v, color: () => "font-semibold text-zinc-800 dark:text-zinc-100" },
    { key: "trades",    label: "Trades",   fmt: String },
    { key: "winRate",   label: "Win Rate", fmt: (v: number) => pct(v), color: (v: number) => v >= 0.55 ? "text-emerald-600" : "text-amber-500" },
    { key: "avgPnlPct", label: "Avg PnL",  fmt: (v: number) => pct(v), color: (v: number) => v >= 0 ? "text-emerald-600" : "text-red-500" },
  ];

  const regCols = [
    { key: "regime",    label: "Regime",   fmt: (v: string) => v, color: () => "font-mono text-xs text-zinc-600 dark:text-zinc-300" },
    { key: "trades",    label: "Trades",   fmt: String },
    { key: "winRate",   label: "Win Rate", fmt: (v: number) => pct(v), color: (v: number) => v >= 0.55 ? "text-emerald-600" : "text-amber-500" },
    { key: "avgPnlPct", label: "Avg PnL",  fmt: (v: number) => pct(v), color: (v: number) => v >= 0 ? "text-emerald-600" : "text-red-500" },
  ];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800">
        {(["setup", "symbol", "regime"] as const).map(t => (
          <button
            key={t}
            className={`px-5 py-3 text-sm font-medium transition-colors capitalize ${
              tab === t
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
            onClick={() => setTab(t)}
          >
            By {t}
          </button>
        ))}
      </div>
      <div className="p-2">
        {tab === "setup"  && <BreakdownTable rows={report?.bySetup  ?? []} columns={setupCols} />}
        {tab === "symbol" && <BreakdownTable rows={report?.bySymbol ?? []} columns={symCols}   />}
        {tab === "regime" && <BreakdownTable rows={report?.byRegime ?? []} columns={regCols}   />}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [symbolFilter, setSymbolFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["equity-report", symbolFilter],
    queryFn:  () => api.equity(symbolFilter || undefined),
    refetchInterval: 60_000,
  });

  const report  = data?.report;
  const metrics = report?.metrics;
  const curve   = report?.equityCurve ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Performance Analytics</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Equity curve, risk-adjusted metrics, and automated circuit breaker protection.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-28 uppercase"
            placeholder="Symbol…"
            value={symbolFilter}
            onChange={e => setSymbolFilter(e.target.value.toUpperCase())}
          />
          {metrics && (
            <div className="text-xs text-zinc-400 text-right">
              <div>{metrics.totalTrades} resolved trades</div>
              {metrics.fromDate && <div>{metrics.fromDate} → {metrics.toDate}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Circuit Breaker */}
      <CircuitBreakerPanel />

      {/* Metrics */}
      {isLoading ? (
        <div className="text-sm text-zinc-400 animate-pulse">Loading performance metrics…</div>
      ) : metrics ? (
        <MetricsGrid metrics={metrics} />
      ) : null}

      {/* Equity Curve */}
      {!isLoading && <EquityChart curve={curve} />}

      {/* Breakdowns */}
      {!isLoading && report && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Performance Breakdown
          </h3>
          <BreakdownTabs report={report} />
        </div>
      )}
    </div>
  );
}
