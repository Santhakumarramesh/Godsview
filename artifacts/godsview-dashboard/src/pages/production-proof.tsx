/**
 * production-proof.tsx — The honest dashboard.
 *
 * This page intentionally queries ONLY production endpoints that return real
 * data backed by the database, the proof system, the live Alpaca paper
 * account, or live health probes. No Math.random, no hard-coded demo numbers,
 * no fixtures — empty states are shown when there is nothing to show.
 *
 * Whitelisted endpoints (and only these):
 *   GET /api/health/phase6                   — service + db + redis + uptime
 *   GET /api/ready/phase6                    — readiness gate
 *   GET /api/alpaca/account                  — live Alpaca paper account
 *   GET /api/alpaca/positions/live           — open positions (live)
 *   GET /api/proof/trades                    — paper trade audit log (DB)
 *   GET /api/proof/metrics                   — computed metrics (DB)
 *   GET /api/proof/equity                    — equity curve (DB)
 *   GET /api/proof/integrity                 — integrity rule violations
 *   GET /api/proof/reconciliation/status     — reconciler + data-health jobs
 */

import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Activity,
  Database,
  Server,
  Wallet,
  ShieldCheck,
  Heart,
  ListChecks,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Circle,
} from "lucide-react";

// ─── Types matching the actual server responses ──────────────────────────────

interface HealthPhase6 {
  service: { status: string; uptime_sec: number };
  db: { status: string; latency_ms: number };
  redis: { status: string; latency_ms: number };
  last_reconciler_run: string | null;
  last_data_health_check: string | null;
  checked_at: string;
}

interface ReadyPhase6 {
  ready: boolean;
  reasons: string[];
  db: { status: string; latency_ms: number };
  redis: { status: string; latency_ms: number };
  env_missing: string[];
  checked_at: string;
}

interface AlpacaAccount {
  status: string;
  crypto_status?: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  trading_blocked: boolean;
  account_blocked: boolean;
  is_paper: boolean;
  mode: string;
}

interface AlpacaPositionsLive {
  positions: Array<Record<string, unknown>>;
  fetched_at: string;
}

interface ProofTrades {
  kind: string;
  count: number;
  open_count: number;
  closed_count: number;
  trades: Array<Record<string, unknown>>;
}

interface ProofMetrics {
  starting_equity: number;
  metrics: {
    total_executed: number;
    total_open: number;
    total_closed: number;
    total_wins: number;
    total_losses: number;
    total_breakevens: number;
    total_rejected: number;
    win_rate: number | null;
    loss_rate: number | null;
    avg_r: number | null;
    median_r: number | null;
    best_r: number | null;
    worst_r: number | null;
    total_pnl: number;
    avg_pnl_per_trade: number | null;
    profit_factor: number | null;
    max_drawdown_pct: number | null;
    max_drawdown_abs: number | null;
    first_trade_at: string | null;
    last_trade_at: string | null;
    computed_at: string;
  };
}

interface ProofEquity {
  starting_equity: number;
  starting_at: string | null;
  points: Array<{ ts: string; equity: number }>;
  ending_equity: number;
}

interface ProofIntegrity {
  checked_at: string;
  total_trades: number;
  total_violations: number;
  by_rule: Record<string, number>;
  violations: Array<Record<string, unknown>>;
}

interface ProofReconciliation {
  reconciler: {
    enabled: boolean;
    interval_ms: number;
    running: boolean;
    last_result: unknown;
  };
  data_health: {
    enabled: boolean;
    interval_ms: number;
    running: boolean;
    last_result: unknown;
  };
}

// ─── Fetch helper (no extra dependencies, no client-side mock fallback) ──────

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Small UI primitives (no design-system dependencies) ─────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "#22c55e" : "#ef4444",
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function Card(props: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 8,
        padding: "16px 18px",
        color: "#e2e8f0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {props.icon}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>
          {props.title}
        </h3>
      </div>
      {props.children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: "#94a3b8" }}>{k}</span>
      <span style={{ color: "#f1f5f9", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "#0b1220",
        border: "1px dashed #334155",
        borderRadius: 6,
        color: "#94a3b8",
        fontSize: 12,
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function fmtCurrency(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function fmtRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(1) + "%";
}

function fmtNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

// ─── The page ────────────────────────────────────────────────────────────────

const REFRESH_MS = 15_000;

const ENDPOINTS = [
  "/api/health/phase6",
  "/api/ready/phase6",
  "/api/alpaca/account",
  "/api/alpaca/positions/live",
  "/api/proof/trades",
  "/api/proof/metrics",
  "/api/proof/equity",
  "/api/proof/integrity",
  "/api/proof/reconciliation/status",
];

export default function ProductionProofPage() {
  const health = useQuery({
    queryKey: ["pp:health"],
    queryFn: () => fetchJson<HealthPhase6>("/api/health/phase6"),
    refetchInterval: REFRESH_MS,
  });
  const ready = useQuery({
    queryKey: ["pp:ready"],
    queryFn: () => fetchJson<ReadyPhase6>("/api/ready/phase6"),
    refetchInterval: REFRESH_MS,
  });
  const account = useQuery({
    queryKey: ["pp:account"],
    queryFn: () => fetchJson<AlpacaAccount>("/api/alpaca/account"),
    refetchInterval: REFRESH_MS,
  });
  const positions = useQuery({
    queryKey: ["pp:positions"],
    queryFn: () => fetchJson<AlpacaPositionsLive>("/api/alpaca/positions/live"),
    refetchInterval: REFRESH_MS,
  });
  const trades = useQuery({
    queryKey: ["pp:trades"],
    queryFn: () => fetchJson<ProofTrades>("/api/proof/trades"),
    refetchInterval: REFRESH_MS,
  });
  const metrics = useQuery({
    queryKey: ["pp:metrics"],
    queryFn: () => fetchJson<ProofMetrics>("/api/proof/metrics"),
    refetchInterval: REFRESH_MS,
  });
  const equity = useQuery({
    queryKey: ["pp:equity"],
    queryFn: () => fetchJson<ProofEquity>("/api/proof/equity"),
    refetchInterval: REFRESH_MS,
  });
  const integrity = useQuery({
    queryKey: ["pp:integrity"],
    queryFn: () => fetchJson<ProofIntegrity>("/api/proof/integrity"),
    refetchInterval: REFRESH_MS,
  });
  const reconciliation = useQuery({
    queryKey: ["pp:reconciliation"],
    queryFn: () => fetchJson<ProofReconciliation>("/api/proof/reconciliation/status"),
    refetchInterval: REFRESH_MS,
  });

  return (
    <div style={{ padding: "24px 28px", color: "#e2e8f0", fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ── Header / honesty badge ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <CheckCircle2 size={28} color="#22c55e" />
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: 0.2 }}>
          Production Proof
        </h1>
        <span
          style={{
            background: "#14532d",
            color: "#86efac",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            border: "1px solid #166534",
          }}
        >
          🟢 Live Production Data
        </span>
      </div>
      <p style={{ marginTop: 4, marginBottom: 24, color: "#94a3b8", fontSize: 13, maxWidth: 760 }}>
        Every value on this page is fetched live from a production endpoint backed by the database,
        the live Alpaca paper account, or a real health probe. No mock data, no Math.random, no
        fixtures. Empty states are shown honestly when there is nothing to display.
      </p>

      {/* ── Top row: Health + Readiness + Broker ───────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {/* Health */}
        <Card title="Service Health" icon={<Heart size={16} color="#f87171" />}>
          {health.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {health.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {health.data && (
            <>
              <KV
                k="Service"
                v={
                  <>
                    <StatusDot ok={health.data.service.status === "ok"} />
                    {health.data.service.status}
                  </>
                }
              />
              <KV
                k="Database"
                v={
                  <>
                    <StatusDot ok={health.data.db.status === "ok"} />
                    {health.data.db.status} · {health.data.db.latency_ms}ms
                  </>
                }
              />
              <KV
                k="Redis"
                v={
                  <>
                    <StatusDot ok={health.data.redis.status === "ok"} />
                    {health.data.redis.status} · {health.data.redis.latency_ms}ms
                  </>
                }
              />
              <KV k="Uptime" v={fmtUptime(health.data.service.uptime_sec)} />
              <KV
                k="Last reconciler run"
                v={health.data.last_reconciler_run ?? "never (job not started)"}
              />
              <KV
                k="Last data-health check"
                v={health.data.last_data_health_check ?? "never (job not started)"}
              />
            </>
          )}
        </Card>

        {/* Readiness */}
        <Card title="Ready to Trade" icon={<ShieldCheck size={16} color="#60a5fa" />}>
          {ready.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {ready.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {ready.data && (
            <>
              <KV
                k="Ready"
                v={
                  <>
                    <StatusDot ok={ready.data.ready} />
                    {ready.data.ready ? "yes" : "no"}
                  </>
                }
              />
              <KV
                k="Blocking reasons"
                v={ready.data.reasons.length === 0 ? "none" : ready.data.reasons.join(", ")}
              />
              <KV
                k="Missing env"
                v={ready.data.env_missing.length === 0 ? "none" : ready.data.env_missing.join(", ")}
              />
              <KV k="DB ping" v={`${ready.data.db.latency_ms}ms`} />
              <KV k="Redis ping" v={`${ready.data.redis.latency_ms}ms`} />
            </>
          )}
        </Card>

        {/* Broker */}
        <Card title="Broker (Alpaca Paper)" icon={<Wallet size={16} color="#fbbf24" />}>
          {account.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {account.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {account.data && (
            <>
              <KV
                k="Account"
                v={
                  <>
                    <StatusDot ok={account.data.status === "ACTIVE" && !account.data.account_blocked} />
                    {account.data.status}
                  </>
                }
              />
              <KV k="Mode" v={account.data.mode} />
              <KV k="Equity" v={fmtCurrency(account.data.equity)} />
              <KV k="Cash" v={fmtCurrency(account.data.cash)} />
              <KV k="Buying power" v={fmtCurrency(account.data.buying_power)} />
              <KV
                k="Trading blocked"
                v={account.data.trading_blocked ? "yes" : "no"}
              />
              <KV
                k="Open positions"
                v={positions.data ? positions.data.positions.length : "—"}
              />
            </>
          )}
        </Card>
      </div>

      {/* ── Trades + Metrics ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title="Paper Trade Audit" icon={<ListChecks size={16} color="#a78bfa" />}>
          {trades.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {trades.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {trades.data && (
            <>
              <KV k="Total executed" v={trades.data.count} />
              <KV k="Open" v={trades.data.open_count} />
              <KV k="Closed" v={trades.data.closed_count} />
              {trades.data.count === 0 ? (
                <div style={{ marginTop: 10 }}>
                  <EmptyHint>
                    No trades recorded yet. The strategy hasn't fired any signals on this container's
                    lifetime. The audit table is empty by design — not by mocking.
                  </EmptyHint>
                </div>
              ) : (
                <KV k="Most recent" v={String(trades.data.trades[0]?.symbol ?? "—")} />
              )}
            </>
          )}
        </Card>

        <Card title="Performance Metrics" icon={<Activity size={16} color="#34d399" />}>
          {metrics.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {metrics.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {metrics.data && (
            <>
              <KV k="Starting equity" v={fmtCurrency(metrics.data.starting_equity)} />
              <KV k="Total executed" v={metrics.data.metrics.total_executed} />
              <KV k="Wins / Losses / BE" v={`${metrics.data.metrics.total_wins} / ${metrics.data.metrics.total_losses} / ${metrics.data.metrics.total_breakevens}`} />
              <KV k="Win rate" v={fmtRatio(metrics.data.metrics.win_rate)} />
              <KV k="Profit factor" v={fmtNumber(metrics.data.metrics.profit_factor)} />
              <KV k="Total PnL" v={fmtCurrency(metrics.data.metrics.total_pnl)} />
              <KV k="Max drawdown" v={fmtRatio(metrics.data.metrics.max_drawdown_pct)} />
              <KV k="Best R / Worst R" v={`${fmtNumber(metrics.data.metrics.best_r)} / ${fmtNumber(metrics.data.metrics.worst_r)}`} />
              {metrics.data.metrics.total_executed === 0 && (
                <div style={{ marginTop: 8 }}>
                  <EmptyHint>
                    Ratios shown as "—" because there are no trades yet to derive a ratio from. Real
                    metric, real null — not a fake zero.
                  </EmptyHint>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* ── Equity curve ───────────────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Card title="Equity Curve" icon={<Server size={16} color="#67e8f9" />}>
          {equity.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {equity.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {equity.data && equity.data.points.length === 0 && (
            <EmptyHint>
              No equity points yet (starting equity {fmtCurrency(equity.data.starting_equity)} ·
              ending equity {fmtCurrency(equity.data.ending_equity)}). The chart will populate once
              the first trade closes and writes to the DB.
            </EmptyHint>
          )}
          {equity.data && equity.data.points.length > 0 && (
            <div style={{ height: 240, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equity.data.points}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="ts" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                  <Line type="monotone" dataKey="equity" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* ── Integrity + Reconciliation ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title="Data Integrity" icon={<Database size={16} color="#a78bfa" />}>
          {integrity.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {integrity.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {integrity.data && (
            <>
              <KV k="Trades scanned" v={integrity.data.total_trades} />
              <KV
                k="Total violations"
                v={
                  <>
                    {integrity.data.total_violations === 0 ? (
                      <CheckCircle2 size={14} color="#22c55e" style={{ verticalAlign: "middle", marginRight: 4 }} />
                    ) : (
                      <AlertCircle size={14} color="#fbbf24" style={{ verticalAlign: "middle", marginRight: 4 }} />
                    )}
                    {integrity.data.total_violations}
                  </>
                }
              />
              <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
                Rules ({Object.keys(integrity.data.by_rule).length}):
              </div>
              {Object.entries(integrity.data.by_rule).map(([rule, count]) => (
                <KV key={rule} k={rule} v={String(count)} />
              ))}
              <KV k="Checked at" v={new Date(integrity.data.checked_at).toLocaleString()} />
            </>
          )}
        </Card>

        <Card title="Reconciler & Data Health Jobs" icon={<RefreshCw size={16} color="#f59e0b" />}>
          {reconciliation.isLoading && <EmptyHint>Loading…</EmptyHint>}
          {reconciliation.isError && <EmptyHint>Endpoint unreachable.</EmptyHint>}
          {reconciliation.data && (
            <>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Reconciler</div>
              <KV
                k="Enabled"
                v={
                  <>
                    <StatusDot ok={reconciliation.data.reconciler.enabled} />
                    {reconciliation.data.reconciler.enabled ? "yes" : "no"}
                  </>
                }
              />
              <KV k="Running" v={reconciliation.data.reconciler.running ? "yes" : "no"} />
              <KV k="Interval" v={`${Math.round(reconciliation.data.reconciler.interval_ms / 1000)}s`} />
              <KV
                k="Last result"
                v={reconciliation.data.reconciler.last_result === null ? "n/a (never run)" : "available"}
              />
              <div style={{ fontSize: 12, color: "#94a3b8", margin: "10px 0 4px" }}>Data Health</div>
              <KV
                k="Enabled"
                v={
                  <>
                    <StatusDot ok={reconciliation.data.data_health.enabled} />
                    {reconciliation.data.data_health.enabled ? "yes" : "no"}
                  </>
                }
              />
              <KV k="Running" v={reconciliation.data.data_health.running ? "yes" : "no"} />
              <KV k="Interval" v={`${Math.round(reconciliation.data.data_health.interval_ms / 1000)}s`} />
              <KV
                k="Last result"
                v={reconciliation.data.data_health.last_result === null ? "n/a (never run)" : "available"}
              />
            </>
          )}
        </Card>
      </div>

      {/* ── Footer: endpoints used (transparency) ──────────────────────── */}
      <div
        style={{
          marginTop: 28,
          padding: 16,
          background: "#020617",
          border: "1px solid #1e293b",
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8, fontWeight: 600, letterSpacing: 0.4 }}>
          ENDPOINTS QUERIED BY THIS PAGE (refreshes every {REFRESH_MS / 1000}s)
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
          {ENDPOINTS.map((ep) => (
            <li key={ep}>
              <a href={ep} target="_blank" rel="noreferrer" style={{ color: "#67e8f9", textDecoration: "none" }}>
                GET {ep}
              </a>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 10, color: "#64748b", fontSize: 11 }}>
          <Circle size={8} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Source: <code>artifacts/godsview-dashboard/src/pages/production-proof.tsx</code> · No
          Math.random, no demo fixtures. View source on GitHub for verification.
        </div>
      </div>
    </div>
  );
}
