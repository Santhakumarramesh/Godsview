/**
 * watchlist.tsx — Watchlist Manager & Autonomous Signal Scanner Dashboard
 *
 * Panels:
 *  1. ScannerStatusBanner  — live scanner on/off, interval, last run stats
 *  2. WatchlistTable       — symbol list with enable/disable + remove controls
 *  3. AddSymbolForm        — add new symbol to watchlist
 *  4. ScannerAlertsFeed    — live SSE alerts streamed from the scanner
 *  5. ScanHistoryTable     — last N scan runs with durations and signal counts
 */

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = "/api";

async function apiFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${r.status}`);
  }
  return r.json();
}

const api = {
  getWatchlist:   () => apiFetch(`${BASE}/watchlist`),
  addSymbol:      (b: any) => apiFetch(`${BASE}/watchlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }),
  removeSymbol:   (sym: string) => apiFetch(`${BASE}/watchlist/${sym}`, { method: "DELETE" }),
  enableSymbol:   (sym: string) => apiFetch(`${BASE}/watchlist/${sym}/enable`, { method: "PATCH" }),
  disableSymbol:  (sym: string) => apiFetch(`${BASE}/watchlist/${sym}/disable`, { method: "PATCH" }),
  getScanStatus:  () => apiFetch(`${BASE}/watchlist/scanner/status`),
  startScanner:   () => apiFetch(`${BASE}/watchlist/scanner/start`, { method: "POST" }),
  stopScanner:    () => apiFetch(`${BASE}/watchlist/scanner/stop`, { method: "POST" }),
  forceScan:      () => apiFetch(`${BASE}/watchlist/scanner/scan`, { method: "POST" }),
  resetCooldowns: (sym?: string) => apiFetch(sym ? `${BASE}/watchlist/scanner/cooldowns/${sym}` : `${BASE}/watchlist/scanner/cooldowns`, { method: "DELETE" }),
  getHistory:     (limit = 20) => apiFetch(`${BASE}/watchlist/scanner/history?limit=${limit}`),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ms(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000)  return `${Math.round(d / 1000)}s ago`;
  if (d < 3600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${Math.round(d / 3600_000)}h ago`;
}

// ─── Scanner Status Banner ─────────────────────────────────────────────────────

function ScannerStatusBanner() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["scanner-status"],
    queryFn:  api.getScanStatus,
    refetchInterval: 10_000,
  });

  const startMut  = useMutation({ mutationFn: api.startScanner,  onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner-status"] }) });
  const stopMut   = useMutation({ mutationFn: api.stopScanner,   onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner-status"] }) });
  const forceMut  = useMutation({ mutationFn: api.forceScan,     onSuccess: () => { qc.invalidateQueries({ queryKey: ["scanner-status"] }); qc.invalidateQueries({ queryKey: ["scan-history"] }); } });
  const resetMut  = useMutation({ mutationFn: () => api.resetCooldowns(), onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner-status"] }) });

  if (isLoading) return <div className="text-sm text-zinc-400 animate-pulse">Loading scanner status…</div>;

  const s = data ?? {};
  const running = s.running ?? false;

  return (
    <div className={`rounded-xl border p-4 flex flex-wrap items-center gap-4 ${
      running
        ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
    }`}>
      {/* Status dot */}
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${running ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} />
        <span className={`text-sm font-semibold ${running ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}>
          {running ? "Scanner Active" : "Scanner Stopped"}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-zinc-500 flex-wrap">
        <span>Interval: <strong className="text-zinc-700 dark:text-zinc-200">{ms(s.intervalMs)}</strong></span>
        <span>Cooldown: <strong className="text-zinc-700 dark:text-zinc-200">{ms(s.cooldownMs)}</strong></span>
        <span>Scans: <strong className="text-zinc-700 dark:text-zinc-200">{s.scanCount ?? 0}</strong></span>
        <span>Symbols: <strong className="text-zinc-700 dark:text-zinc-200">{s.watchlistSize ?? 0}</strong></span>
        {s.currentRun && (
          <span className="text-blue-500 animate-pulse">Scanning…</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 ml-auto">
        {running ? (
          <button
            className="h-8 px-3 text-sm rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            onClick={() => stopMut.mutate()}
            disabled={stopMut.isPending}
          >
            Stop
          </button>
        ) : (
          <button
            className="h-8 px-3 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
          >
            Start
          </button>
        )}
        <button
          className="h-8 px-3 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
          onClick={() => forceMut.mutate()}
          disabled={forceMut.isPending}
        >
          {forceMut.isPending ? "Scanning…" : "Scan Now"}
        </button>
        <button
          className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          onClick={() => resetMut.mutate()}
          title="Reset all symbol/setup cooldowns"
        >
          Reset Cooldowns
        </button>
      </div>
    </div>
  );
}

// ─── Watchlist Table ───────────────────────────────────────────────────────────

function WatchlistTable() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["watchlist"],
    queryFn:  api.getWatchlist,
    refetchInterval: 15_000,
  });

  const removeMut  = useMutation({ mutationFn: (sym: string) => api.removeSymbol(sym),  onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }) });
  const enableMut  = useMutation({ mutationFn: (sym: string) => api.enableSymbol(sym),  onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }) });
  const disableMut = useMutation({ mutationFn: (sym: string) => api.disableSymbol(sym), onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }) });
  const resetMut   = useMutation({ mutationFn: (sym: string) => api.resetCooldowns(sym) });

  if (isLoading) return <div className="text-sm text-zinc-400 animate-pulse px-2 py-6">Loading watchlist…</div>;
  if (!data?.watchlist?.length) return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center text-sm text-zinc-400">
      No symbols in watchlist. Add one below.
    </div>
  );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Watchlist</h3>
        <span className="text-xs text-zinc-400">{data.count} symbols</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Symbol</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Class</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Status</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Last Scanned</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Signals</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.watchlist.map((e: any) => (
              <tr key={e.symbol} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-100">{e.symbol}</div>
                  {e.label !== e.symbol && <div className="text-xs text-zinc-400">{e.label}</div>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    e.assetClass === "crypto"    ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" :
                    e.assetClass === "equity"    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" :
                    e.assetClass === "forex"     ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400" :
                    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}>{e.assetClass}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    e.enabled
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}>{e.enabled ? "Active" : "Paused"}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-zinc-500">{ago(e.lastScannedAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`text-sm font-semibold ${e.signalCount > 0 ? "text-blue-500" : "text-zinc-400"}`}>
                    {e.signalCount}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {e.enabled ? (
                      <button
                        className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        onClick={() => disableMut.mutate(e.symbol)}
                      >Pause</button>
                    ) : (
                      <button
                        className="text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 transition-colors"
                        onClick={() => enableMut.mutate(e.symbol)}
                      >Resume</button>
                    )}
                    <button
                      className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      onClick={() => resetMut.mutate(e.symbol)}
                      title="Reset cooldowns for this symbol"
                    >↺</button>
                    <button
                      className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      onClick={() => { if (confirm(`Remove ${e.symbol}?`)) removeMut.mutate(e.symbol); }}
                    >Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Add Symbol Form ───────────────────────────────────────────────────────────

function AddSymbolForm() {
  const qc = useQueryClient();
  const [symbol,     setSymbol]     = useState("");
  const [label,      setLabel]      = useState("");
  const [assetClass, setAssetClass] = useState<"crypto"|"forex"|"equity"|"commodity">("crypto");
  const [error, setError] = useState("");

  const addMut = useMutation({
    mutationFn: api.addSymbol,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      setSymbol(""); setLabel(""); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!symbol.trim()) { setError("Symbol is required"); return; }
    addMut.mutate({ symbol: symbol.trim().toUpperCase(), label: label.trim() || symbol.trim().toUpperCase(), assetClass });
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">Add Symbol</h3>
      <form className="flex flex-wrap gap-2 items-end" onSubmit={submit}>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Symbol</label>
          <input
            className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-28 uppercase"
            placeholder="BTCUSD"
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Label (optional)</label>
          <input
            className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
            placeholder="Bitcoin"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Asset Class</label>
          <select
            className="h-8 px-3 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={assetClass}
            onChange={e => setAssetClass(e.target.value as any)}
          >
            <option value="crypto">Crypto</option>
            <option value="equity">Equity</option>
            <option value="forex">Forex</option>
            <option value="commodity">Commodity</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={addMut.isPending}
          className="h-8 px-4 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
        >
          {addMut.isPending ? "Adding…" : "Add"}
        </button>
        {error && <p className="text-xs text-red-500 w-full mt-1">{error}</p>}
      </form>
    </div>
  );
}

// ─── Live Alerts Feed (SSE) ───────────────────────────────────────────────────

interface LiveAlert {
  id: string;
  symbol: string;
  setupType: string;
  direction: "long" | "short";
  quality: number;
  regime: string;
  entryPrice: number;
  macroBias: { bias: string; conviction: string };
  detectedAt: string;
}

function LiveAlertsFeed() {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    esRef.current = es;
    es.addEventListener("alert", (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload?.type !== "scanner_alert") return;
        const a: LiveAlert = payload.data;
        setAlerts(prev => [a, ...prev].slice(0, 50));
      } catch { /* malformed */ }
    });
    return () => es.close();
  }, []);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Live Scanner Alerts</h3>
        </div>
        <span className="text-xs text-zinc-400">{alerts.length} received</span>
      </div>
      {alerts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400">
          <p>Waiting for scanner alerts…</p>
          <p className="text-xs mt-1 text-zinc-400">Alerts will appear here in real time when the scanner detects quality setups.</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {alerts.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center gap-4 flex-wrap hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">{a.symbol}</span>
                  <span className="text-xs font-mono text-zinc-500">{a.setupType}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    a.direction === "long"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                  }`}>{a.direction === "long" ? "↑ Long" : "↓ Short"}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{a.regime} · entry {a.entryPrice.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  Q: {(a.quality * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">{new Date(a.detectedAt).toLocaleTimeString()}</div>
              </div>
              <div className="text-right text-xs">
                <div className={`font-semibold ${
                  a.macroBias?.conviction === "high" ? "text-purple-500" : "text-zinc-400"
                }`}>
                  {a.macroBias?.bias} / {a.macroBias?.conviction}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scan History Table ────────────────────────────────────────────────────────

function ScanHistoryTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["scan-history"],
    queryFn:  () => api.getHistory(20),
    refetchInterval: 30_000,
  });

  if (isLoading) return null;
  if (!data?.history?.length) return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 text-center text-sm text-zinc-400">
      No scan history yet.
    </div>
  );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Scan History</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Time</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Status</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Symbols</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Signals</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Alerts</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Blocked</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.history.map((r: any) => (
              <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-2.5 text-xs text-zinc-500">{ago(r.startedAt)}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    r.status === "completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" :
                    r.status === "running"   ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" :
                    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                  }`}>{r.status}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-300">{r.symbolsScanned}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={r.signalsFound > 0 ? "text-blue-500 font-semibold" : "text-zinc-400"}>{r.signalsFound}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className={r.alertsEmitted > 0 ? "text-emerald-600 font-semibold" : "text-zinc-400"}>{r.alertsEmitted}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-500">{r.blocked}</td>
                <td className="px-4 py-2.5 text-right text-zinc-500">{ms(r.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Watchlist Scanner</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Autonomous multi-symbol signal scanner — monitors your watchlist every 2 minutes
          and broadcasts high-quality setups in real time.
        </p>
      </div>

      {/* Scanner status + controls */}
      <ScannerStatusBanner />

      {/* Watchlist + Add form side by side */}
      <div className="space-y-4">
        <WatchlistTable />
        <AddSymbolForm />
      </div>

      {/* Live alerts */}
      <LiveAlertsFeed />

      {/* History */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Scan Cycle History
        </h3>
        <ScanHistoryTable />
      </div>
    </div>
  );
}
