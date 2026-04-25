import React, { useState, useEffect, useCallback } from "react";

/* ── design tokens ─────────────────────────────────────────────── */
const BG   = "#0a0e17";
const CARD = "#111827";
const EDGE = "#1e293b";
const TXT  = "#e2e8f0";
const DIM  = "#64748b";
const CYAN = "#22d3ee";
const GREEN = "#10b981";
const RED   = "#ef4444";
const AMBER = "#f59e0b";
const PURPLE = "#a78bfa";

const API = "/api/signal-engine";

interface Strategy {
  name: string; symbol: string; timeframe: string;
  enabled: boolean; paused: boolean;
  backtest_pf: number; backtest_wr: number;
}
interface Position {
  position_id: string; symbol: string; direction: string;
  entry_price: number; entry_time: string;
  stop_loss: number; take_profit: number;
  pnl: number; pnl_pct: number; status: string;
  strategy_name: string; candles_held: number;
  close_reason?: string; close_time?: string; close_price?: number;
}
interface PerfEntry {
  total_trades: number; wins: number; losses: number;
  win_rate: number; profit_factor: number;
  total_pnl: number; max_drawdown: number;
  avg_r_multiple: number;
}
interface Alert {
  timestamp: string; level: string;
  strategy?: string; message: string;
}

/* ── small helpers ─────────────────────────────────────────────── */
const card = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: CARD, border: `1px solid ${EDGE}`, borderRadius: 10,
  padding: "16px 20px", ...extra,
});
const pill = (c: string): React.CSSProperties => ({
  display: "inline-block", padding: "2px 10px", borderRadius: 999,
  fontSize: 11, fontWeight: 700, background: `${c}22`, color: c,
});
const mono: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace" };

export default function PaperTradingLive() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [closed, setClosed] = useState<Position[]>([]);
  const [performance, setPerformance] = useState<Record<string, PerfEntry>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "positions" | "performance" | "alerts" | "comparison">("overview");

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, pRes, pfRes, aRes, hRes, cRes] = await Promise.all([
        fetch(`${API}/strategies`), fetch(`${API}/positions`),
        fetch(`${API}/performance`), fetch(`${API}/alerts`),
        fetch(`${API}/health`), fetch(`${API}/comparison`),
      ]);
      const [s, p, pf, a, h, c] = await Promise.all([
        sRes.json(), pRes.json(), pfRes.json(), aRes.json(), hRes.json(), cRes.json(),
      ]);
      setStrategies(s || []);
      const allPos = p || [];
      setPositions(allPos.filter((x: Position) => x.status === "open"));
      setClosed(allPos.filter((x: Position) => x.status !== "open"));
      setPerformance(pf || {});
      setAlerts((a || []).slice(-50).reverse());
      setHealth(h);
      setComparison(c);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to reach signal engine");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 15000); return () => clearInterval(iv); }, [fetchAll]);

  const pauseStrategy = async (name: string) => {
    await fetch(`${API}/pause/${name}`, { method: "POST" }); fetchAll();
  };
  const resumeStrategy = async (name: string) => {
    await fetch(`${API}/resume/${name}`, { method: "POST" }); fetchAll();
  };
  const killAll = async () => {
    if (!confirm("KILL ALL positions and flatten? This is irreversible.")) return;
    await fetch(`${API}/kill`, { method: "POST" }); fetchAll();
  };

  if (loading) return <div style={{ color: TXT, padding: 40 }}>Loading signal engine...</div>;

  const equity = health?.current_equity || 100000;
  const pnlTotal = equity - 100000;
  const pnlPct = ((equity - 100000) / 100000 * 100);

  return (
    <div style={{ background: BG, color: TXT, minHeight: "100vh", padding: "24px 32px", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>
            <span style={{ color: CYAN }}>PAPER</span> Trading — Live Engine
          </h1>
          <p style={{ margin: "4px 0 0", color: DIM, fontSize: 13 }}>
            {health?.status === "healthy" ? "🟢" : "🔴"} Engine {health?.status || "offline"}
            {error && <span style={{ color: RED, marginLeft: 12 }}>⚠ {error}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={fetchAll} style={btnStyle(CYAN)}>Refresh</button>
          <button onClick={killAll} style={btnStyle(RED)}>⛔ Kill All</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 24 }}>
        <KPI label="Equity" value={`$${equity.toLocaleString()}`} sub="Starting: $100,000" color={CYAN} />
        <KPI label="P&L" value={`${pnlTotal >= 0 ? "+" : ""}$${pnlTotal.toFixed(2)}`}
             sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`}
             color={pnlTotal >= 0 ? GREEN : RED} />
        <KPI label="Open Positions" value={String(positions.length)} sub={`of max ${3}`} color={PURPLE} />
        <KPI label="Strategies" value={`${strategies.filter(s => s.enabled && !s.paused).length}/${strategies.length}`}
             sub="active / total" color={AMBER} />
        <KPI label="Closed Trades" value={String(closed.length)} sub="total paper trades" color={DIM} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${EDGE}`, paddingBottom: 8 }}>
        {(["overview", "positions", "performance", "alerts", "comparison"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "6px 18px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600,
              background: tab === t ? `${CYAN}22` : "transparent",
              color: tab === t ? CYAN : DIM, fontSize: 13 }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && <OverviewTab strategies={strategies} positions={positions} performance={performance}
        onPause={pauseStrategy} onResume={resumeStrategy} />}
      {tab === "positions" && <PositionsTab open={positions} closed={closed} />}
      {tab === "performance" && <PerformanceTab performance={performance} />}
      {tab === "alerts" && <AlertsTab alerts={alerts} />}
      {tab === "comparison" && <ComparisonTab data={comparison} />}
    </div>
  );
}

/* ── KPI Card ──────────────────────────────────────────────────── */
function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={card()}>
      <div style={{ color: DIM, fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, ...mono }}>{value}</div>
      <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/* ── Overview Tab ──────────────────────────────────────────────── */
function OverviewTab({ strategies, positions, performance, onPause, onResume }: {
  strategies: Strategy[]; positions: Position[];
  performance: Record<string, PerfEntry>;
  onPause: (n: string) => void; onResume: (n: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Strategies */}
      <div style={card()}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, color: CYAN }}>Strategies</h3>
        {strategies.map(s => {
          const perf = performance[s.name];
          return (
            <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderBottom: `1px solid ${EDGE}` }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{s.symbol} <span style={{ color: DIM }}>{s.timeframe}</span></div>
                <div style={{ fontSize: 11, color: DIM }}>
                  BT PF={s.backtest_pf} WR={s.backtest_wr}%
                  {perf && ` → Live PF=${perf.profit_factor?.toFixed(2) || "–"} WR=${perf.win_rate?.toFixed(1) || "–"}%`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={pill(s.paused ? RED : s.enabled ? GREEN : DIM)}>
                  {s.paused ? "PAUSED" : s.enabled ? "ACTIVE" : "OFF"}
                </span>
                {s.paused
                  ? <button onClick={() => onResume(s.name)} style={btnStyle(GREEN, true)}>Resume</button>
                  : <button onClick={() => onPause(s.name)} style={btnStyle(AMBER, true)}>Pause</button>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Open Positions */}
      <div style={card()}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, color: GREEN }}>Open Positions</h3>
        {positions.length === 0
          ? <div style={{ color: DIM, fontSize: 13, padding: 20, textAlign: "center" }}>No open positions</div>
          : positions.map(p => (
            <div key={p.position_id} style={{ padding: "10px 0", borderBottom: `1px solid ${EDGE}` }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>{p.symbol} <span style={pill(p.direction === "LONG" ? GREEN : RED)}>{p.direction}</span></span>
                <span style={{ color: p.pnl >= 0 ? GREEN : RED, fontWeight: 700, ...mono }}>
                  {p.pnl >= 0 ? "+" : ""}{p.pnl_pct.toFixed(2)}%
                </span>
              </div>
              <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>
                Entry: ${p.entry_price.toFixed(2)} | SL: ${p.stop_loss.toFixed(2)} | TP: ${p.take_profit.toFixed(2)} | {p.candles_held} candles
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ── Positions Tab ─────────────────────────────────────────────── */
function PositionsTab({ open, closed }: { open: Position[]; closed: Position[] }) {
  return (
    <div>
      <h3 style={{ color: GREEN, fontSize: 15, margin: "0 0 12px" }}>Open ({open.length})</h3>
      <PosTable positions={open} />
      <h3 style={{ color: DIM, fontSize: 15, margin: "20px 0 12px" }}>Closed ({closed.length})</h3>
      <PosTable positions={closed} />
    </div>
  );
}

function PosTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) return <div style={{ color: DIM, padding: 16 }}>None</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, ...mono }}>
        <thead>
          <tr style={{ color: DIM, textAlign: "left", borderBottom: `1px solid ${EDGE}` }}>
            {["Symbol", "Dir", "Strategy", "Entry", "SL", "TP", "P&L%", "Status", "Candles"].map(h =>
              <th key={h} style={{ padding: "8px 10px", fontWeight: 600 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <tr key={p.position_id} style={{ borderBottom: `1px solid ${EDGE}15` }}>
              <td style={{ padding: "6px 10px", fontWeight: 700 }}>{p.symbol}</td>
              <td><span style={pill(p.direction === "LONG" ? GREEN : RED)}>{p.direction}</span></td>
              <td style={{ color: DIM }}>{p.strategy_name}</td>
              <td>${p.entry_price.toFixed(2)}</td>
              <td>${p.stop_loss.toFixed(2)}</td>
              <td>${p.take_profit.toFixed(2)}</td>
              <td style={{ color: p.pnl_pct >= 0 ? GREEN : RED, fontWeight: 700 }}>
                {p.pnl_pct >= 0 ? "+" : ""}{p.pnl_pct.toFixed(2)}%
              </td>
              <td><span style={pill(p.status === "open" ? GREEN : p.close_reason?.includes("tp") ? GREEN : RED)}>
                {p.status === "open" ? "OPEN" : p.close_reason?.toUpperCase() || "CLOSED"}
              </span></td>
              <td>{p.candles_held}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Performance Tab ───────────────────────────────────────────── */
function PerformanceTab({ performance }: { performance: Record<string, PerfEntry> }) {
  const entries = Object.entries(performance);
  if (entries.length === 0) return <div style={{ color: DIM, padding: 24 }}>No performance data yet — trades need to close first.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
      {entries.map(([name, p]) => (
        <div key={name} style={card()}>
          <h4 style={{ margin: "0 0 10px", color: CYAN }}>{name}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            <Stat label="Trades" value={String(p.total_trades)} />
            <Stat label="Win Rate" value={`${p.win_rate?.toFixed(1)}%`} color={p.win_rate > 50 ? GREEN : RED} />
            <Stat label="Profit Factor" value={p.profit_factor?.toFixed(2)} color={p.profit_factor > 1.5 ? GREEN : p.profit_factor > 1 ? AMBER : RED} />
            <Stat label="Total P&L" value={`${p.total_pnl >= 0 ? "+" : ""}${p.total_pnl?.toFixed(2)}%`} color={p.total_pnl >= 0 ? GREEN : RED} />
            <Stat label="Max DD" value={`${p.max_drawdown?.toFixed(2)}%`} color={p.max_drawdown < 5 ? GREEN : RED} />
            <Stat label="Avg R" value={`${p.avg_r_multiple?.toFixed(2)}R`} color={p.avg_r_multiple > 0 ? GREEN : RED} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: DIM, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 700, color: color || TXT, ...mono }}>{value}</div>
    </div>
  );
}

/* ── Alerts Tab ────────────────────────────────────────────────── */
function AlertsTab({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return <div style={{ color: DIM, padding: 24 }}>No alerts yet.</div>;
  const levelColor: Record<string, string> = { INFO: CYAN, WARNING: AMBER, CRITICAL: RED, SIGNAL: GREEN };
  return (
    <div style={card()}>
      {alerts.map((a, i) => (
        <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${EDGE}15`, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={pill(levelColor[a.level] || DIM)}>{a.level}</span>
          <div>
            <div style={{ fontSize: 13 }}>{a.message}</div>
            <div style={{ fontSize: 10, color: DIM }}>{a.timestamp} {a.strategy && `· ${a.strategy}`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Comparison Tab ────────────────────────────────────────────── */
function ComparisonTab({ data }: { data: any }) {
  if (!data || Object.keys(data).length === 0) return <div style={{ color: DIM, padding: 24 }}>No comparison data yet.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
      {Object.entries(data).map(([name, cmp]: [string, any]) => (
        <div key={name} style={card()}>
          <h4 style={{ margin: "0 0 12px", color: CYAN }}>{name}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "6px 16px", fontSize: 12 }}>
            <div style={{ color: DIM, fontWeight: 600 }}>Metric</div>
            <div style={{ color: DIM, fontWeight: 600 }}>Backtest</div>
            <div style={{ color: DIM, fontWeight: 600 }}>Paper</div>
            <div>PF</div><div style={mono}>{cmp.backtest_pf?.toFixed(2)}</div><div style={mono}>{cmp.paper_pf?.toFixed(2) || "–"}</div>
            <div>WR</div><div style={mono}>{cmp.backtest_wr?.toFixed(1)}%</div><div style={mono}>{cmp.paper_wr?.toFixed(1) || "–"}%</div>
            <div>Trades</div><div style={mono}>{cmp.backtest_trades || "–"}</div><div style={mono}>{cmp.paper_trades || 0}</div>
          </div>
          {cmp.deviation_alert && (
            <div style={{ marginTop: 10, padding: "6px 10px", background: `${RED}15`, borderRadius: 6, fontSize: 11, color: RED }}>
              ⚠ Significant deviation from backtest performance
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── button helper ─────────────────────────────────────────────── */
function btnStyle(color: string, small = false): React.CSSProperties {
  return {
    padding: small ? "4px 10px" : "8px 16px", borderRadius: 6,
    border: `1px solid ${color}44`, background: `${color}15`, color,
    cursor: "pointer", fontWeight: 600, fontSize: small ? 11 : 13,
  };
}
