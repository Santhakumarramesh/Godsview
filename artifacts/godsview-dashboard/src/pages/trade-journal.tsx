/**
 * trade-journal.tsx — Trade Journal & PnL Attribution Dashboard
 *
 * Surfaces the per-gate attribution report from Phase 18 so traders can see
 * exactly which YoungTraderWealth filters are helping vs hurting performance.
 *
 * Panels:
 *  1. JournalStatsBar     — total / win-rate / avg PnL quick summary
 *  2. LayerSummaryCards   — verdict cards for each active gate layer
 *  3. GateAttributionTable — per-gate save/miss/netEdge table
 *  4. RecentEntriesTable  — last 50 journal entries with outcome badges
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";

// ─── API helpers ──────────────────────────────────────────────────────────────

const API = "/api/journal";

async function fetchStats() {
  const r = await fetch(`${API}/stats`);
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json();
}

async function fetchAttribution(symbol?: string) {
  const params = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const r = await fetch(`${API}/attribution${params}`);
  if (!r.ok) throw new Error("Failed to fetch attribution");
  return r.json();
}

async function fetchEntries(opts: { symbol?: string; decision?: string; outcome?: string; limit?: number }) {
  const p = new URLSearchParams();
  if (opts.symbol)   p.set("symbol", opts.symbol);
  if (opts.decision) p.set("decision", opts.decision);
  if (opts.outcome)  p.set("outcome", opts.outcome);
  p.set("limit", String(opts.limit ?? 50));
  const r = await fetch(`${API}?${p.toString()}`);
  if (!r.ok) throw new Error("Failed to fetch entries");
  return r.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 flex flex-col gap-1">
      <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-zinc-900 dark:text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    helping:          { label: "✓ Helping",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
    hurting:          { label: "✗ Hurting",     cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
    neutral:          { label: "→ Neutral",     cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
    insufficient_data:{ label: "⏳ More data",  cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  };
  const { label, cls } = map[verdict] ?? { label: verdict, cls: "bg-zinc-100 text-zinc-500" };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const map: Record<string, string> = {
    win:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    loss:      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    breakeven: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    unknown:   "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[outcome] ?? map.unknown}`}>
      {outcome}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
      decision === "passed"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
        : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
    }`}>
      {decision}
    </span>
  );
}

function pct(n: number | null | undefined, decimals = 1) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function JournalStatsBar({ symbolFilter }: { symbolFilter: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["journal-stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="text-sm text-zinc-400 animate-pulse">Loading stats…</div>;
  if (error || !data?.stats) return <div className="text-sm text-red-400">Stats unavailable</div>;

  const s = data.stats;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      <StatCard label="Total Decisions" value={s.total} />
      <StatCard label="Blocked" value={s.blocked} accent="text-orange-500" />
      <StatCard label="Passed" value={s.passed} accent="text-blue-500" />
      <StatCard label="Resolved" value={s.resolved} sub={`of ${s.total}`} />
      <StatCard label="Wins" value={s.wins} accent="text-emerald-600" />
      <StatCard label="Win Rate" value={pct(s.winRate)} accent={s.winRate >= 0.55 ? "text-emerald-600" : s.winRate >= 0.45 ? "text-amber-500" : "text-red-500"} />
      <StatCard label="Avg PnL" value={pct(s.avgPnlPct)} accent={s.avgPnlPct >= 0 ? "text-emerald-600" : "text-red-500"} />
    </div>
  );
}

// ─── Layer Summary Cards ──────────────────────────────────────────────────────

function LayerSummaryCards({ report }: { report: any }) {
  if (!report?.layerSummary?.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
        Filter Layer Verdicts
      </h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {report.layerSummary.map((layer: any) => (
          <div key={layer.layer} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{layer.layer}</span>
              <VerdictBadge verdict={layer.verdict} />
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">{layer.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Gate Attribution Table ───────────────────────────────────────────────────

function GateAttributionTable({ report }: { report: any }) {
  if (!report?.gateAttribution?.length) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 text-center text-sm text-zinc-400">
        No blocked trades recorded yet. Gate attribution will populate as the pipeline processes signals.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Per-Gate Attribution</h3>
        <p className="text-xs text-zinc-400 mt-0.5">Save rate &gt; 50% = gate is blocking more losers than winners</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Gate</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Blocks</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Saves</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Misses</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Save Rate</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Net Edge</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Avg Blocked PnL</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {report.gateAttribution.map((g: any) => {
              const verdict = g.saves + g.misses < 5
                ? "insufficient_data"
                : g.netEdge > 0.1 ? "helping"
                : g.netEdge < -0.1 ? "hurting"
                : "neutral";
              return (
                <tr key={g.gate} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">{g.gate}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-300">{g.blocks}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600">{g.saves}</td>
                  <td className="px-4 py-2.5 text-right text-red-500">{g.misses}</td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    <span className={g.saveRate >= 0.5 ? "text-emerald-600" : "text-red-500"}>
                      {pct(g.saveRate, 0)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    <span className={g.netEdge >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {g.netEdge >= 0 ? "+" : ""}{fmt(g.netEdge)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={g.avgBlockedPnlPct <= 0 ? "text-emerald-600" : "text-red-500"}>
                      {pct(g.avgBlockedPnlPct)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right"><VerdictBadge verdict={verdict} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Macro Conviction Performance ─────────────────────────────────────────────

function MacroConvictionTable({ report }: { report: any }) {
  if (!report?.macroConvictionPerformance?.length) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Performance by Macro Conviction</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Conviction</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Direction</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Trades</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Wins</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Win Rate</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Avg PnL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {report.macroConvictionPerformance.map((m: any, i: number) => (
              <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    m.conviction === "high" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                    : m.conviction === "medium" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}>{m.conviction}</span>
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-300">{m.direction}</td>
                <td className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-300">{m.trades}</td>
                <td className="px-4 py-2.5 text-right text-emerald-600">{m.wins}</td>
                <td className="px-4 py-2.5 text-right font-medium">
                  <span className={m.winRate >= 0.55 ? "text-emerald-600" : m.winRate >= 0.45 ? "text-amber-500" : "text-red-500"}>
                    {pct(m.winRate)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className={m.avgPnlPct >= 0 ? "text-emerald-600" : "text-red-500"}>
                    {pct(m.avgPnlPct)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Recent Entries Table ─────────────────────────────────────────────────────

function RecentEntriesTable({
  symbolFilter, decisionFilter, outcomeFilter,
}: {
  symbolFilter: string; decisionFilter: string; outcomeFilter: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["journal-entries", symbolFilter, decisionFilter, outcomeFilter],
    queryFn: () => fetchEntries({
      symbol:   symbolFilter || undefined,
      decision: decisionFilter || undefined,
      outcome:  outcomeFilter || undefined,
      limit: 50,
    }),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="text-sm text-zinc-400 animate-pulse px-4 py-6">Loading entries…</div>;
  if (error) return <div className="text-sm text-red-400 px-4 py-6">Failed to load entries</div>;
  if (!data?.entries?.length) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center">
        <p className="text-zinc-400 text-sm">No journal entries yet.</p>
        <p className="text-zinc-400 text-xs mt-1">Entries are recorded automatically as the signal pipeline runs.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Recent Decisions</h3>
        <span className="text-xs text-zinc-400">{data.count} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Time</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Symbol</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Setup</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Dir</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Decision</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Block Reason</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Outcome</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">PnL%</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Macro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.entries.map((e: any) => {
              const time = new Date(e.decidedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const date = new Date(e.decidedAt).toLocaleDateString([], { month: "short", day: "numeric" });
              return (
                <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-zinc-500">
                    <div>{time}</div>
                    <div className="text-zinc-400">{date}</div>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-200">{e.symbol}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-zinc-500">{e.setupType}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold ${e.direction === "long" ? "text-emerald-600" : "text-red-500"}`}>
                      {e.direction === "long" ? "↑" : "↓"} {e.direction}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><DecisionBadge decision={e.decision} /></td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 font-mono">
                    {e.blockReason !== "none" ? e.blockReason : "—"}
                  </td>
                  <td className="px-4 py-2.5"><OutcomeBadge outcome={e.outcome} /></td>
                  <td className="px-4 py-2.5 text-right font-medium text-xs">
                    {e.pnlPct != null ? (
                      <span className={e.pnlPct >= 0 ? "text-emerald-600" : "text-red-500"}>
                        {e.pnlPct >= 0 ? "+" : ""}{pct(e.pnlPct)}
                      </span>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    <div className={`font-semibold ${
                      e.macroBias?.conviction === "high" ? "text-purple-500"
                      : e.macroBias?.conviction === "medium" ? "text-blue-500"
                      : "text-zinc-400"
                    }`}>
                      {e.macroBias?.direction ?? "—"} / {e.macroBias?.conviction ?? "—"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function TradeJournalPage() {
  const [symbolFilter,   setSymbolFilter]   = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [outcomeFilter,  setOutcomeFilter]  = useState("");

  const { data: attrData, isLoading: attrLoading } = useQuery({
    queryKey: ["journal-attribution", symbolFilter],
    queryFn: () => fetchAttribution(symbolFilter || undefined),
    refetchInterval: 60_000,
  });

  const report = attrData?.report;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Trade Journal</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Per-gate PnL attribution — did each YoungTraderWealth filter help or hurt?
          </p>
        </div>
        {report && (
          <div className="text-xs text-zinc-400 text-right">
            <div>{report.totalEntries} decisions analysed</div>
            <div>{report.resolvedEntries} resolved</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
          placeholder="Symbol…"
          value={symbolFilter}
          onChange={e => setSymbolFilter(e.target.value.toUpperCase())}
        />
        <select
          className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={decisionFilter}
          onChange={e => setDecisionFilter(e.target.value)}
        >
          <option value="">All decisions</option>
          <option value="passed">Passed</option>
          <option value="blocked">Blocked</option>
        </select>
        <select
          className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={outcomeFilter}
          onChange={e => setOutcomeFilter(e.target.value)}
        >
          <option value="">All outcomes</option>
          <option value="win">Win</option>
          <option value="loss">Loss</option>
          <option value="breakeven">Breakeven</option>
          <option value="unknown">Pending</option>
        </select>
        {(symbolFilter || decisionFilter || outcomeFilter) && (
          <button
            className="h-8 px-3 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            onClick={() => { setSymbolFilter(""); setDecisionFilter(""); setOutcomeFilter(""); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stats */}
      <JournalStatsBar symbolFilter={symbolFilter} />

      {/* Attribution */}
      {attrLoading ? (
        <div className="text-sm text-zinc-400 animate-pulse">Loading attribution report…</div>
      ) : report ? (
        <div className="space-y-6">
          {/* Layer verdicts */}
          <LayerSummaryCards report={report} />

          {/* Gate attribution */}
          <GateAttributionTable report={report} />

          {/* Macro conviction performance */}
          <MacroConvictionTable report={report} />

          {/* Headline attribution numbers */}
          <div className="grid sm:grid-cols-2 gap-3">
            <StatCard
              label="Passed Trade Win Rate"
              value={pct(report.passedWinRate)}
              accent={report.passedWinRate >= 0.55 ? "text-emerald-600" : "text-amber-500"}
              sub="% of passed trades that won"
            />
            <StatCard
              label="Blocked Trade Miss Rate"
              value={pct(report.blockedMissRate)}
              accent={report.blockedMissRate <= 0.4 ? "text-emerald-600" : "text-red-500"}
              sub="% of blocked trades that would have won (lower = gates are helping)"
            />
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center">
          <p className="text-zinc-400 text-sm">Attribution data unavailable</p>
        </div>
      )}

      {/* Recent entries */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Decision Log
        </h3>
        <RecentEntriesTable
          symbolFilter={symbolFilter}
          decisionFilter={decisionFilter}
          outcomeFilter={outcomeFilter}
        />
      </div>
    </div>
  );
}
