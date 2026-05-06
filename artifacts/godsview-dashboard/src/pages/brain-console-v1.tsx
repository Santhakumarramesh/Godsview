/**
 * brain-console-v1.tsx — Brain Console v1.
 *
 * The honest command-center landing for GodsView.
 *
 * Queries ONE endpoint:
 *   GET /api/brain-state
 *
 * That endpoint is a server-side aggregator over real, already-working
 * sources (Phase 6 health, Alpaca paper account, watchlist scanner, paper-
 * trade proof system, system status). Every section is a SectionResult of
 * the form { status, value, reason }. Sections that cannot be reached are
 * rendered as "Not connected" with the underlying reason — never with
 * fabricated values.
 *
 * No Math.random. No fixtures. No demo banners. The verdict paragraph at
 * the bottom is generated server-side from the same JSON payload.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Database,
  Heart,
  Inbox,
  ListChecks,
  Newspaper,
  Radar,
  RefreshCw,
  Server,
  ShieldCheck,
  Wallet,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type Status = "ok" | "not_connected";

interface Section<T = unknown> {
  status: Status;
  value: T | null;
  reason?: string;
}

interface Mode {
  system_mode: string;
  live_writes_enabled: boolean;
  kill_switch_active: boolean;
  starting_equity_usd: number;
}

interface M2ChartPayload {
  symbol: string;
  timeframe: string;
  timestamp: string;
  direction: "long" | "short" | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  invalidation: { ob_low: number | null; expire_at: string | null };
  order_block_zone: { status: string; value: unknown };
  fvg_zone: { status: string; value: unknown };
  strategy_name: string;
  strategy_version: string;
  reason: string | null;
  confidence: number | null;
}

interface M2Execution {
  attempted: boolean;
  executed: boolean;
  order_id: string | null;
  blocking_gate: string | null;
  error: string | null;
  audit_id: string | null;
  skipped_reason: string | null;
}

interface M2DecisionLite {
  decided_at: string;
  symbol: string;
  timeframe: string;
  bars_consumed: number;
  status: "accepted" | "no_trade" | "evaluation_error";
  reason: string | null;
  chart_payload: M2ChartPayload;
  execution: M2Execution | null;
  data_source: string;
}

interface BrainState {
  generated_at: string;
  mode: Mode;
  health: Section<{
    service: { status: string; uptime_sec: number };
    db: { status: string; latency_ms: number };
    redis: { status: string; latency_ms: number };
    last_reconciler_run: string | null;
    last_data_health_check: string | null;
  }>;
  ready: Section<{
    ready: boolean;
    reasons: string[];
    db: { status: string; latency_ms: number };
    redis: { status: string; latency_ms: number };
    env_missing: string[];
  }>;
  account: Section<{
    status: string;
    currency: string;
    equity: string;
    cash: string;
    buying_power: string;
    trading_blocked: boolean;
    is_paper: boolean;
    mode: string;
  }>;
  scanner: {
    status: Section<{
      running: boolean;
      scanCount: number;
      intervalMs: number;
      cooldownMs: number;
      watchlistSize: number;
    }>;
    history: Section<{
      history: Array<{
        id: string;
        startedAt: string;
        completedAt: string | null;
        status: string;
        symbolsScanned: number;
        signalsFound: number;
        alertsEmitted: number;
        blocked: number;
        durationMs: number;
        error: string | null;
      }>;
      count: number;
    }>;
  };
  proof: {
    trades: Section<{ count: number; open_count: number; closed_count: number }>;
    metrics: Section<{
      starting_equity: number;
      metrics: {
        total_executed: number;
        total_open: number;
        total_closed: number;
        total_wins: number;
        total_losses: number;
        win_rate: number | null;
        loss_rate: number | null;
        total_pnl: number;
        profit_factor: number | null;
        max_drawdown_pct: number | null;
      };
    }>;
    equity: Section<{
      starting_equity: number;
      points: Array<{ ts: string; equity: number }>;
      ending_equity: number;
    }>;
    integrity: Section<{
      total_trades: number;
      total_violations: number;
      by_rule: Record<string, number>;
    }>;
    reconciliation: Section<{
      reconciler: { enabled: boolean; running: boolean; interval_ms: number };
      data_health: { enabled: boolean; running: boolean; interval_ms: number };
    }>;
  };
  signals: {
    active: Section<{
      signals_today: number | null;
      trades_today: number | null;
      active_instrument: string | null;
      active_session: string | null;
      session_allowed: boolean;
      news_lockout_active: boolean;
    }>;
    rejected: Section<{ count: number; recent: unknown[] }>;
  };
  risk: {
    summary: Section<{
      kill_switch: boolean;
      news_lockout: boolean;
      session_allowed: boolean;
      active_session: string | null;
      equity: number | null;
      buying_power: number | null;
      unrealized_pnl: number | null;
      live_positions: number | null;
      layers: Array<{ name: string; status: string; message: string }>;
    }>;
  };
  // M5d-β: macro/news aggregator (real FRED + macro_engine + honest not_connected)
  macro: Section<{
    status: "ok" | "partial" | "not_connected";
    generated_at: string;
    macro_risk: {
      level: "low" | "moderate" | "elevated" | "high" | null;
      drivers: string[];
      source_quality: "real" | "partial" | "not_connected";
    };
    fred: {
      status: "ok" | "not_connected";
      value: {
        cpi_yoy: number | null;
        cpi_mom: number | null;
        fed_funds_rate: number | null;
        unemployment_rate: number | null;
        treasury_10y: number | null;
        treasury_2y: number | null;
        yield_curve_spread: number | null;
        gdp_growth: number | null;
        initial_claims: number | null;
        vix: number | null;
        macro_risk: string | null;
        fetched_at: string | null;
        quality: string | null;
      } | null;
      reason?: string;
    };
    events: {
      status: "ok" | "not_connected";
      count_24h: number;
      high_impact_upcoming: Array<{
        id: string; type: string; title: string; impact: string;
        sentiment: number; related_symbols: string[]; source: string; timestamp: string;
      }>;
      next_event: {
        id: string; type: string; title: string; impact: string; timestamp: string;
        related_symbols: string[];
      } | null;
      reason?: string;
    };
    news_window: {
      active: boolean;
      reason: string | null;
      affected_symbols: string[];
    };
    news_feed: {
      status: "ok" | "not_connected";
      feed_connected: boolean;
      reason: string;
    };
    last_updated: string | null;
  }>;
  mcp: {
    status: "not_connected";
    reason: string;
    servers: string[];
  };
  pipeline?: Section<{
    strategy_name: string;
    strategy_version: string;
    last_evaluation_at: string | null;
    last_attempt_at: string | null;
    last_symbol: string | null;
    last_timeframe: string | null;
    last_error: string | null;
    last_insufficient_bars_reason: { symbol: string; bars: number; threshold: number; at: string } | null;
    totals: {
      evaluated: number;
      accepted: number;
      no_trade: number;
      error: number;
      executed: number;
      execution_blocked: number;
      attempted: number;
      insufficient_bars: number;
      fetch_errors: number;
    };
    last_decision: M2DecisionLite | null;
    last_accepted: M2DecisionLite | null;
    last_no_trade: M2DecisionLite | null;
    by_symbol: Record<string, M2DecisionLite>;
    not_connected_layers: string[];
  }>;
  verdict: string;
}

// ── Style constants (mirrors production-proof.tsx for consistency) ───────────

const C = {
  bg: "#0e0e0f",
  panel: "#0f172a",
  panel2: "#020617",
  border: "#1e293b",
  borderSoft: "#334155",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textBold: "#f1f5f9",
  green: "#22c55e",
  greenSoft: "#86efac",
  red: "#ef4444",
  amber: "#fbbf24",
  cyan: "#67e8f9",
  violet: "#a78bfa",
  blue: "#60a5fa",
};

// ── Primitives ───────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? C.green : C.red,
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
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "16px 18px",
        color: C.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {props.icon}
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: C.textBold,
          }}
        >
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
      <span style={{ color: C.textMuted }}>{k}</span>
      <span style={{ color: C.textBold, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function NotConnected({ reason }: { reason?: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: C.panel2,
        border: `1px dashed ${C.borderSoft}`,
        borderRadius: 6,
        color: C.textMuted,
        fontSize: 12,
        fontStyle: "italic",
      }}
    >
      Not connected{reason ? ` · ${reason}` : ""}
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "err" | "muted"; children: React.ReactNode }) {
  const palette = {
    ok: { bg: "#14532d", border: "#166534", fg: C.greenSoft },
    warn: { bg: "#3f2d04", border: "#854d0e", fg: C.amber },
    err: { bg: "#3f0f0f", border: "#991b1b", fg: "#fca5a5" },
    muted: { bg: "#0b1220", border: C.borderSoft, fg: C.textMuted },
  }[tone];
  return (
    <span
      style={{
        background: palette.bg,
        color: palette.fg,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </span>
  );
}

// ── Formatting helpers (no fabrication: missing → "—") ───────────────────────

function fmtCurrency(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}
function fmtUptime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
function fmtRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(1) + "%";
}
function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}
function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(0)}s` : `${ms}ms`;
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchBrainState(): Promise<BrainState> {
  const res = await fetch("/api/brain-state", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`/api/brain-state → HTTP ${res.status}`);
  return (await res.json()) as BrainState;
}

const REFRESH_MS = 15_000;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BrainConsoleV1Page() {
  const q = useQuery({
    queryKey: ["brain-state"],
    queryFn: fetchBrainState,
    refetchInterval: REFRESH_MS,
  });

  const data = q.data ?? null;
  const mode = data?.mode;
  const modeLabel =
    mode?.system_mode === "live_enabled"
      ? "LIVE"
      : mode?.system_mode === "live_disabled"
      ? "LIVE (writes off)"
      : (mode?.system_mode ?? "paper").toUpperCase();
  const modeTone: "ok" | "warn" | "err" | "muted" =
    mode?.kill_switch_active
      ? "err"
      : mode?.live_writes_enabled
      ? "warn"
      : mode
      ? "ok"
      : "muted";

  return (
    <div style={{ padding: "24px 28px", color: C.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <Bot size={28} color={C.cyan} />
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: 0.2 }}>Brain Console v1</h1>
        <Pill tone={modeTone}>
          {modeLabel}
          {mode?.kill_switch_active ? " · KILLED" : ""}
        </Pill>
        <Pill tone="muted">Live Aggregator</Pill>
        {q.isFetching && <Pill tone="muted">refreshing…</Pill>}
      </div>
      <p style={{ marginTop: 4, marginBottom: 24, color: C.textMuted, fontSize: 13, maxWidth: 820 }}>
        Single read from <code style={{ color: C.cyan }}>/api/brain-state</code> — a server-side aggregator
        over the production-honest spine (Phase 6 health, Alpaca paper account, watchlist scanner, paper-
        trade proof system). No mock data, no Math.random. Sections that cannot be reached say so explicitly.
        Refreshes every {REFRESH_MS / 1000}s.
      </p>

      {q.isError && (
        <div
          style={{
            padding: 16,
            background: "#3f0f0f",
            border: "1px solid #991b1b",
            borderRadius: 8,
            color: "#fca5a5",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {`/api/brain-state failed: ${(q.error as Error)?.message ?? "unknown error"}`}
        </div>
      )}

      {/* ── Verdict ──────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#0b1530",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "16px 18px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: C.cyan,
            marginBottom: 6,
          }}
        >
          Brain Verdict (server-generated from real values)
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: C.textBold, fontVariantNumeric: "tabular-nums" }}>
          {data?.verdict ?? (q.isLoading ? "Loading…" : "—")}
        </div>
        {data?.generated_at && (
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
            generated_at: <code>{data.generated_at}</code>
          </div>
        )}
      </div>

      {/* ── Row 1: Health · Readiness · Broker ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <Card title="Service Health" icon={<Heart size={16} color={C.red} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.health.status !== "ok" || !data.health.value ? (
            <NotConnected reason={data.health.reason} />
          ) : (
            <>
              <KV
                k="Service"
                v={
                  <>
                    <StatusDot ok={data.health.value.service.status === "ok"} />
                    {data.health.value.service.status}
                  </>
                }
              />
              <KV
                k="Database"
                v={
                  <>
                    <StatusDot ok={data.health.value.db.status === "ok"} />
                    {data.health.value.db.status} · {data.health.value.db.latency_ms}ms
                  </>
                }
              />
              <KV
                k="Redis"
                v={
                  <>
                    <StatusDot ok={data.health.value.redis.status === "ok"} />
                    {data.health.value.redis.status} · {data.health.value.redis.latency_ms}ms
                  </>
                }
              />
              <KV k="Uptime" v={fmtUptime(data.health.value.service.uptime_sec)} />
              <KV
                k="Last reconciler run"
                v={data.health.value.last_reconciler_run ?? "never"}
              />
              <KV
                k="Last data-health check"
                v={data.health.value.last_data_health_check ?? "never"}
              />
            </>
          )}
        </Card>

        <Card title="Ready to Trade" icon={<ShieldCheck size={16} color={C.blue} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.ready.status !== "ok" || !data.ready.value ? (
            <NotConnected reason={data.ready.reason} />
          ) : (
            <>
              <KV
                k="Ready"
                v={
                  <>
                    <StatusDot ok={data.ready.value.ready} />
                    {data.ready.value.ready ? "yes" : "no"}
                  </>
                }
              />
              <KV
                k="Blocking reasons"
                v={data.ready.value.reasons.length === 0 ? "none" : data.ready.value.reasons.join(", ")}
              />
              <KV
                k="Missing env"
                v={
                  data.ready.value.env_missing.length === 0
                    ? "none"
                    : data.ready.value.env_missing.join(", ")
                }
              />
              <KV k="DB ping" v={`${data.ready.value.db.latency_ms}ms`} />
              <KV k="Redis ping" v={`${data.ready.value.redis.latency_ms}ms`} />
            </>
          )}
        </Card>

        <Card title="Broker (Alpaca Paper)" icon={<Wallet size={16} color={C.amber} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.account.status !== "ok" || !data.account.value ? (
            <NotConnected reason={data.account.reason} />
          ) : (
            <>
              <KV
                k="Account"
                v={
                  <>
                    <StatusDot
                      ok={data.account.value.status === "ACTIVE" && !data.account.value.trading_blocked}
                    />
                    {data.account.value.status}
                  </>
                }
              />
              <KV k="Mode" v={data.account.value.mode} />
              <KV k="Paper" v={data.account.value.is_paper ? "yes" : "no"} />
              <KV k="Equity" v={fmtCurrency(data.account.value.equity)} />
              <KV k="Cash" v={fmtCurrency(data.account.value.cash)} />
              <KV k="Buying power" v={fmtCurrency(data.account.value.buying_power)} />
              <KV k="Trading blocked" v={data.account.value.trading_blocked ? "yes" : "no"} />
            </>
          )}
        </Card>
      </div>

      {/* ── Row 2: Scanner status · Scanner history ─────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title="Watchlist Scanner" icon={<Radar size={16} color={C.green} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.scanner.status.status !== "ok" || !data.scanner.status.value ? (
            <NotConnected reason={data.scanner.status.reason} />
          ) : (
            <>
              <KV
                k="Running"
                v={
                  <>
                    <StatusDot ok={data.scanner.status.value.running} />
                    {data.scanner.status.value.running ? "yes" : "no"}
                  </>
                }
              />
              <KV k="Total scans" v={data.scanner.status.value.scanCount} />
              <KV k="Watchlist size" v={data.scanner.status.value.watchlistSize} />
              <KV k="Interval" v={fmtMs(data.scanner.status.value.intervalMs)} />
              <KV k="Alert cooldown" v={fmtMs(data.scanner.status.value.cooldownMs)} />
            </>
          )}
        </Card>

        <Card title="Latest Scan History" icon={<Inbox size={16} color={C.violet} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.scanner.history.status !== "ok" || !data.scanner.history.value ? (
            <NotConnected reason={data.scanner.history.reason} />
          ) : data.scanner.history.value.history.length === 0 ? (
            <NotConnected reason="no scans yet" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: C.textMuted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px", borderBottom: `1px solid ${C.border}` }}>Started</th>
                    <th style={{ padding: "4px 6px", borderBottom: `1px solid ${C.border}` }}>Sym</th>
                    <th style={{ padding: "4px 6px", borderBottom: `1px solid ${C.border}` }}>Sig</th>
                    <th style={{ padding: "4px 6px", borderBottom: `1px solid ${C.border}` }}>Blocked</th>
                    <th style={{ padding: "4px 6px", borderBottom: `1px solid ${C.border}` }}>ms</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scanner.history.value.history.slice(0, 6).map((h) => (
                    <tr key={h.id}>
                      <td style={{ padding: "4px 6px", color: C.textBold, fontVariantNumeric: "tabular-nums" }}>
                        {new Date(h.startedAt).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "4px 6px" }}>{h.symbolsScanned}</td>
                      <td
                        style={{
                          padding: "4px 6px",
                          color: h.signalsFound > 0 ? C.green : C.textMuted,
                          fontWeight: h.signalsFound > 0 ? 700 : 400,
                        }}
                      >
                        {h.signalsFound}
                      </td>
                      <td style={{ padding: "4px 6px", color: C.textMuted }}>{h.blocked}</td>
                      <td style={{ padding: "4px 6px", color: C.textMuted }}>{h.durationMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 3: Active signals · Rejected signals · Risk ─────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title="Active Signal" icon={<Activity size={16} color={C.green} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.signals.active.status !== "ok" || !data.signals.active.value ? (
            <NotConnected reason={data.signals.active.reason} />
          ) : (
            <>
              <KV k="Signals today" v={data.signals.active.value.signals_today ?? "—"} />
              <KV k="Trades today" v={data.signals.active.value.trades_today ?? "—"} />
              <KV k="Active instrument" v={data.signals.active.value.active_instrument ?? "—"} />
              <KV k="Active session" v={data.signals.active.value.active_session ?? "—"} />
              <KV k="Session allowed" v={data.signals.active.value.session_allowed ? "yes" : "no"} />
              <KV
                k="News lockout"
                v={data.signals.active.value.news_lockout_active ? "ACTIVE" : "off"}
              />
              {(data.signals.active.value.signals_today ?? 0) === 0 && (
                <div style={{ marginTop: 8 }}>
                  <NotConnected reason="No valid signal" />
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Rejected Signals" icon={<ListChecks size={16} color={C.amber} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.signals.rejected.status !== "ok" || !data.signals.rejected.value ? (
            <NotConnected reason={data.signals.rejected.reason} />
          ) : data.signals.rejected.value.count === 0 ? (
            <NotConnected reason="No rejections recorded yet" />
          ) : (
            <>
              <KV k="Total rejected" v={data.signals.rejected.value.count} />
              <KV k="Recent (top 5)" v={`${data.signals.rejected.value.recent.length} shown`} />
              <pre
                style={{
                  marginTop: 8,
                  background: C.panel2,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: 8,
                  fontSize: 11,
                  color: C.textMuted,
                  overflowX: "auto",
                  maxHeight: 220,
                }}
              >
                {JSON.stringify(data.signals.rejected.value.recent, null, 2)}
              </pre>
            </>
          )}
        </Card>

        <Card title="Risk Defense" icon={<ShieldCheck size={16} color={C.red} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.risk.summary.status !== "ok" || !data.risk.summary.value ? (
            <NotConnected reason={data.risk.summary.reason} />
          ) : (
            <>
              <KV
                k="Kill switch"
                v={
                  <>
                    <StatusDot ok={!data.risk.summary.value.kill_switch} />
                    {data.risk.summary.value.kill_switch ? "ACTIVE" : "off"}
                  </>
                }
              />
              <KV
                k="News lockout"
                v={
                  <>
                    <StatusDot ok={!data.risk.summary.value.news_lockout} />
                    {data.risk.summary.value.news_lockout ? "ACTIVE" : "off"}
                  </>
                }
              />
              <KV k="Active session" v={data.risk.summary.value.active_session ?? "—"} />
              <KV
                k="Session allowed"
                v={
                  <>
                    <StatusDot ok={data.risk.summary.value.session_allowed} />
                    {data.risk.summary.value.session_allowed ? "yes" : "no"}
                  </>
                }
              />
              <KV k="Equity" v={fmtCurrency(data.risk.summary.value.equity)} />
              <KV k="Buying power" v={fmtCurrency(data.risk.summary.value.buying_power)} />
              <KV k="Unrealized PnL" v={fmtCurrency(data.risk.summary.value.unrealized_pnl)} />
              <KV k="Live positions" v={data.risk.summary.value.live_positions ?? "—"} />
            </>
          )}
        </Card>
      </div>

      {/* ── Row 4: Paper proof metrics · Equity summary · Integrity · Recon ─ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title="Paper Proof Metrics" icon={<Activity size={16} color={C.green} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.proof.metrics.status !== "ok" || !data.proof.metrics.value ? (
            <NotConnected reason={data.proof.metrics.reason} />
          ) : (
            <>
              <KV
                k="Starting equity"
                v={fmtCurrency(data.proof.metrics.value.starting_equity)}
              />
              <KV k="Total executed" v={data.proof.metrics.value.metrics.total_executed} />
              <KV
                k="W / L / Open"
                v={`${data.proof.metrics.value.metrics.total_wins} / ${data.proof.metrics.value.metrics.total_losses} / ${data.proof.metrics.value.metrics.total_open}`}
              />
              <KV k="Win rate" v={fmtRatio(data.proof.metrics.value.metrics.win_rate)} />
              <KV k="Profit factor" v={fmtNum(data.proof.metrics.value.metrics.profit_factor)} />
              <KV k="Total PnL" v={fmtCurrency(data.proof.metrics.value.metrics.total_pnl)} />
              <KV
                k="Max drawdown"
                v={fmtRatio(data.proof.metrics.value.metrics.max_drawdown_pct)}
              />
              {data.proof.metrics.value.metrics.total_executed === 0 && (
                <div style={{ marginTop: 8 }}>
                  <NotConnected reason="No trades yet — empty by design, not by mocking" />
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Equity Curve Summary" icon={<Server size={16} color={C.cyan} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.proof.equity.status !== "ok" || !data.proof.equity.value ? (
            <NotConnected reason={data.proof.equity.reason} />
          ) : (
            <>
              <KV k="Starting equity" v={fmtCurrency(data.proof.equity.value.starting_equity)} />
              <KV k="Ending equity" v={fmtCurrency(data.proof.equity.value.ending_equity)} />
              <KV k="Points" v={data.proof.equity.value.points.length} />
              {data.proof.equity.value.points.length === 0 && (
                <div style={{ marginTop: 8 }}>
                  <NotConnected reason="No equity points until first close" />
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Trade Integrity" icon={<Database size={16} color={C.violet} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.proof.integrity.status !== "ok" || !data.proof.integrity.value ? (
            <NotConnected reason={data.proof.integrity.reason} />
          ) : (
            <>
              <KV k="Trades scanned" v={data.proof.integrity.value.total_trades} />
              <KV
                k="Total violations"
                v={
                  <>
                    <StatusDot ok={data.proof.integrity.value.total_violations === 0} />
                    {data.proof.integrity.value.total_violations}
                  </>
                }
              />
              <div style={{ fontSize: 11, color: C.textMuted, margin: "8px 0 4px" }}>
                Rules ({Object.keys(data.proof.integrity.value.by_rule).length}):
              </div>
              {Object.entries(data.proof.integrity.value.by_rule).map(([rule, count]) => (
                <KV key={rule} k={rule} v={String(count)} />
              ))}
            </>
          )}
        </Card>

        <Card title="Reconciler & Data Health" icon={<RefreshCw size={16} color={C.amber} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.proof.reconciliation.status !== "ok" || !data.proof.reconciliation.value ? (
            <NotConnected reason={data.proof.reconciliation.reason} />
          ) : (
            <>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Reconciler</div>
              <KV
                k="Enabled"
                v={
                  <>
                    <StatusDot ok={data.proof.reconciliation.value.reconciler.enabled} />
                    {data.proof.reconciliation.value.reconciler.enabled ? "yes" : "no"}
                  </>
                }
              />
              <KV
                k="Running"
                v={data.proof.reconciliation.value.reconciler.running ? "yes" : "no"}
              />
              <KV k="Interval" v={fmtMs(data.proof.reconciliation.value.reconciler.interval_ms)} />
              <div style={{ fontSize: 11, color: C.textMuted, margin: "10px 0 4px" }}>Data Health</div>
              <KV
                k="Enabled"
                v={
                  <>
                    <StatusDot ok={data.proof.reconciliation.value.data_health.enabled} />
                    {data.proof.reconciliation.value.data_health.enabled ? "yes" : "no"}
                  </>
                }
              />
              <KV
                k="Running"
                v={data.proof.reconciliation.value.data_health.running ? "yes" : "no"}
              />
              <KV k="Interval" v={fmtMs(data.proof.reconciliation.value.data_health.interval_ms)} />
            </>
          )}
        </Card>
      </div>

      {/* ── Row 5: Macro · MCP ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title="News / Macro Risk" icon={<Newspaper size={16} color={C.violet} />}>
          {/* M5d-β: aggregator-driven view. Per-section source quality always shown. */}
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : data.macro.status !== "ok" || !data.macro.value ? (
            <NotConnected reason={data.macro.reason} />
          ) : (
            <>
              {/* Synthesized risk level — anchored on REAL FRED label */}
              <KV
                k="Risk level"
                v={
                  <>
                    <StatusDot
                      ok={
                        data.macro.value.macro_risk.level === "low" ||
                        data.macro.value.macro_risk.level === "moderate"
                      }
                    />
                    {(data.macro.value.macro_risk.level ?? "unknown").toUpperCase()}
                    <span style={{ marginLeft: 8, fontSize: 11, color: C.textMuted }}>
                      ({data.macro.value.macro_risk.source_quality})
                    </span>
                  </>
                }
              />
              <KV
                k="Source quality"
                v={
                  <span style={{ fontSize: 11 }}>
                    FRED: <b style={{ color: data.macro.value.fred.status === "ok" ? C.green : C.amber }}>{data.macro.value.fred.status}</b>
                    {" · "}
                    Events: <b style={{ color: data.macro.value.events.status === "ok" ? C.green : C.amber }}>{data.macro.value.events.status}</b>
                    {" · "}
                    News: <b style={{ color: data.macro.value.news_feed.feed_connected ? C.green : C.amber }}>{data.macro.value.news_feed.feed_connected ? "ok" : "not_connected"}</b>
                  </span>
                }
              />
              {/* News window state (REAL, derived from macro_engine events) */}
              <KV
                k="News window"
                v={
                  <span style={{ color: data.macro.value.news_window.active ? C.red : C.textMuted }}>
                    {data.macro.value.news_window.active ? "ACTIVE" : "off"}
                    {data.macro.value.news_window.affected_symbols.length > 0
                      ? ` (${data.macro.value.news_window.affected_symbols.join(", ")})`
                      : ""}
                  </span>
                }
              />
              {/* Real FRED values when available */}
              {data.macro.value.fred.status === "ok" && data.macro.value.fred.value && (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 1.6 }}>
                  CPI {data.macro.value.fred.value.cpi_yoy?.toFixed(2) ?? "—"}% ·{" "}
                  Fed {data.macro.value.fred.value.fed_funds_rate?.toFixed(2) ?? "—"}% ·{" "}
                  10Y {data.macro.value.fred.value.treasury_10y?.toFixed(2) ?? "—"}% ·{" "}
                  VIX {data.macro.value.fred.value.vix?.toFixed(1) ?? "—"}
                </div>
              )}
              {/* Next event when an event provider is connected */}
              {data.macro.value.events.status === "ok" && data.macro.value.events.next_event ? (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  Next: <b style={{ color: C.text }}>{data.macro.value.events.next_event.title}</b>
                  {" · "}
                  {data.macro.value.events.next_event.impact} ·{" "}
                  {fmtTime(data.macro.value.events.next_event.timestamp)}
                </div>
              ) : data.macro.value.events.status === "not_connected" ? (
                <div style={{ fontSize: 11, color: C.amber, marginTop: 6 }}>
                  Events: not_connected — {data.macro.value.events.reason ?? "no provider"}
                </div>
              ) : null}
              {/* News feed honesty */}
              {!data.macro.value.news_feed.feed_connected && (
                <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>
                  News feed: not_connected — {data.macro.value.news_feed.reason}
                </div>
              )}
              {/* Drivers (always real, sourced from FRED + events) */}
              {data.macro.value.macro_risk.drivers.length > 0 && (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
                  Drivers: {data.macro.value.macro_risk.drivers.slice(0, 3).join(" · ")}
                </div>
              )}
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>
                Last updated: {fmtTime(data.macro.value.last_updated)}
              </div>
            </>
          )}
        </Card>

        <Card title="MCP Layer" icon={<Bot size={16} color={C.cyan} />}>
          {!data ? (
            <NotConnected reason={q.isLoading ? "loading" : "no payload"} />
          ) : (
            <>
              <KV
                k="Status"
                v={
                  <>
                    <StatusDot ok={false} />
                    not connected yet
                  </>
                }
              />
              <KV k="Servers (scaffolds)" v={data.mcp.servers.join(", ")} />
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>
                {data.mcp.reason}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Row 6: Milestone 2 Intelligence Pipeline ────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Card title="Milestone 2 Intelligence Pipeline" icon={<Bot size={16} color={C.cyan} />}>
          {!data || !data.pipeline ? (
            <NotConnected reason={q.isLoading ? "loading" : "field absent on server (older build)"} />
          ) : data.pipeline.status !== "ok" || !data.pipeline.value ? (
            <NotConnected reason={data.pipeline.reason} />
          ) : (
            <div>
              <KV k="Strategy" v={`${data.pipeline.value.strategy_name}@${data.pipeline.value.strategy_version}`} />
              <KV k="Last evaluation at" v={fmtTime(data.pipeline.value.last_evaluation_at)} />
              <KV k="Last attempt at" v={fmtTime(data.pipeline.value.last_attempt_at)} />
              <KV k="Last attempted symbol/timeframe" v={data.pipeline.value.last_symbol ? `${data.pipeline.value.last_symbol} · ${data.pipeline.value.last_timeframe ?? "—"}` : "—"} />
              <KV
                k="Attempts"
                v={`${data.pipeline.value.totals.attempted} attempted · ${data.pipeline.value.totals.evaluated} evaluated · ${data.pipeline.value.totals.insufficient_bars} insufficient bars · ${data.pipeline.value.totals.fetch_errors} fetch errors`}
              />
              <KV
                k="Strategy outcomes"
                v={`${data.pipeline.value.totals.accepted} accepted · ${data.pipeline.value.totals.no_trade} no_trade · ${data.pipeline.value.totals.error} error`}
              />
              <KV
                k="Execution"
                v={`${data.pipeline.value.totals.executed} executed · ${data.pipeline.value.totals.execution_blocked} blocked by risk`}
              />
              {/* Diagnostic block — surfaces WHY evaluated may be 0 */}
              {data.pipeline.value.totals.attempted > 0 && data.pipeline.value.totals.evaluated === 0 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    background: "#3f2d04",
                    border: "1px solid #854d0e",
                    borderRadius: 6,
                    color: C.amber,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>
                    Pipeline attempted but never reached the strategy
                  </div>
                  {data.pipeline.value.last_error && (
                    <div>Last fetch error: <code>{data.pipeline.value.last_error}</code></div>
                  )}
                  {data.pipeline.value.last_insufficient_bars_reason && (
                    <div>
                      Latest insufficient-bars: <code>{data.pipeline.value.last_insufficient_bars_reason.symbol}</code> returned {data.pipeline.value.last_insufficient_bars_reason.bars} of {data.pipeline.value.last_insufficient_bars_reason.threshold} required at {fmtTime(data.pipeline.value.last_insufficient_bars_reason.at)}
                    </div>
                  )}
                  {!data.pipeline.value.last_error && !data.pipeline.value.last_insufficient_bars_reason && (
                    <div>Cause not classified yet — check container logs for [m2] entries.</div>
                  )}
                </div>
              )}
              {data.pipeline.value.totals.attempted > 0 && data.pipeline.value.last_error && data.pipeline.value.totals.evaluated > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: C.amber }}>
                  Last error (recovered): <code>{data.pipeline.value.last_error}</code>
                </div>
              )}
              {/* Latest decision */}
              {data.pipeline.value.last_decision ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: 12,
                    background: C.panel2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color:
                        data.pipeline.value.last_decision.status === "accepted"
                          ? C.green
                          : data.pipeline.value.last_decision.status === "no_trade"
                          ? C.amber
                          : C.red,
                      marginBottom: 8,
                    }}
                  >
                    Latest decision: {data.pipeline.value.last_decision.status}
                  </div>
                  <KV k="Symbol" v={data.pipeline.value.last_decision.symbol} />
                  <KV k="Timeframe" v={data.pipeline.value.last_decision.timeframe} />
                  <KV k="Decided at" v={fmtTime(data.pipeline.value.last_decision.decided_at)} />
                  <KV k="Bars consumed" v={data.pipeline.value.last_decision.bars_consumed} />
                  <KV k="Reason" v={data.pipeline.value.last_decision.reason ?? (data.pipeline.value.last_decision.status === "accepted" ? "—" : "—")} />
                  <KV k="Data source" v={data.pipeline.value.last_decision.data_source} />
                  {/* Chart payload */}
                  <div style={{ fontSize: 11, color: C.textMuted, margin: "10px 0 4px" }}>Chart Payload</div>
                  <KV k="Direction" v={data.pipeline.value.last_decision.chart_payload.direction ?? "—"} />
                  <KV
                    k="Entry / Stop / Target"
                    v={`${fmtNum(data.pipeline.value.last_decision.chart_payload.entry)} / ${fmtNum(data.pipeline.value.last_decision.chart_payload.stop_loss)} / ${fmtNum(data.pipeline.value.last_decision.chart_payload.take_profit)}`}
                  />
                  <KV
                    k="Invalidation OB low"
                    v={fmtNum(data.pipeline.value.last_decision.chart_payload.invalidation.ob_low)}
                  />
                  <KV
                    k="Invalidation expires"
                    v={fmtTime(data.pipeline.value.last_decision.chart_payload.invalidation.expire_at)}
                  />
                  <KV
                    k="Order block zone"
                    v={
                      <>
                        <StatusDot ok={data.pipeline.value.last_decision.chart_payload.order_block_zone.status === "ok"} />
                        {data.pipeline.value.last_decision.chart_payload.order_block_zone.status}
                      </>
                    }
                  />
                  <KV
                    k="FVG zone"
                    v={
                      <>
                        <StatusDot ok={data.pipeline.value.last_decision.chart_payload.fvg_zone.status === "ok"} />
                        {data.pipeline.value.last_decision.chart_payload.fvg_zone.status}
                      </>
                    }
                  />
                  {/* Execution */}
                  {data.pipeline.value.last_decision.execution && (
                    <>
                      <div style={{ fontSize: 11, color: C.textMuted, margin: "10px 0 4px" }}>Execution (paper)</div>
                      <KV
                        k="Attempted / Executed"
                        v={`${data.pipeline.value.last_decision.execution.attempted ? "yes" : "no"} / ${data.pipeline.value.last_decision.execution.executed ? "yes" : "no"}`}
                      />
                      {data.pipeline.value.last_decision.execution.blocking_gate && (
                        <KV k="Blocking gate" v={data.pipeline.value.last_decision.execution.blocking_gate} />
                      )}
                      {data.pipeline.value.last_decision.execution.error && (
                        <KV k="Error" v={data.pipeline.value.last_decision.execution.error} />
                      )}
                      {data.pipeline.value.last_decision.execution.skipped_reason && (
                        <KV k="Skipped reason" v={data.pipeline.value.last_decision.execution.skipped_reason} />
                      )}
                      {data.pipeline.value.last_decision.execution.order_id && (
                        <KV k="Order id" v={data.pipeline.value.last_decision.execution.order_id} />
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <NotConnected reason="No evaluations yet — first 1H bar fetch pending" />
                </div>
              )}
              {/* Not-connected layers */}
              <div style={{ fontSize: 11, color: C.textMuted, margin: "12px 0 4px" }}>Not connected layers</div>
              <div style={{ fontSize: 12, color: C.textBold }}>
                {data.pipeline.value.not_connected_layers.length === 0
                  ? "—"
                  : data.pipeline.value.not_connected_layers.join(", ")}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Footer: source endpoint ────────────────────────────────────── */}
      <div
        style={{
          marginTop: 28,
          padding: 16,
          background: C.panel2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: C.textMuted,
            marginBottom: 8,
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
        >
          AGGREGATED FROM ONE ENDPOINT (refresh every {REFRESH_MS / 1000}s)
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            color: "#cbd5e1",
            fontSize: 12,
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          <li>
            <a href="/api/brain-state" target="_blank" rel="noreferrer" style={{ color: C.cyan, textDecoration: "none" }}>
              GET /api/brain-state
            </a>
          </li>
        </ul>
        <div style={{ marginTop: 10, color: "#64748b", fontSize: 11 }}>
          Source: <code>artifacts/godsview-dashboard/src/pages/brain-console-v1.tsx</code> ·
          Backend: <code>artifacts/api-server/src/routes/brain_state.ts</code> · No Math.random, no fixtures.
        </div>
      </div>
    </div>
  );
}
