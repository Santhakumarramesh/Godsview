/**
 * bloomberg-terminal.tsx — Multi-panel terminal interface
 *
 * Real data sources:
 *   ticker     → /api/alpaca/ticker?symbols=...      (cached 5s)
 *   positions  → /api/alpaca/positions/live          (refetch 5s)
 *   orders     → /api/alpaca/orders                  (refetch 10s)
 *   signals    → /api/signals                        (refetch 15s)
 *   account    → /api/alpaca/account                 (refetch 15s)
 *   analytics  → /api/analytics/summary, daily-pnl   (refetch 30s)
 *
 * News panel currently has no real upstream feed (the news endpoint is
 * a known-broken 500 and there's no live wire). It renders an empty
 * state with a clear "feed not connected" notice — no fake headlines.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  apiFetch,
  useAlpacaPositionsLive,
  useAlpacaOrders,
  useAlpacaAccount,
  useSignals,
} from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

type PanelType =
  | "chart" | "positions" | "orders" | "news" | "signals"
  | "risk" | "pnl" | "watchlist" | "brain" | "empty";

interface PanelConfig {
  id: string;
  type: PanelType;
  title: string;
  symbol?: string;
}

interface TickerItem {
  symbol: string;
  price: number;
  change: number;
  change_pct: number;
}

const PANEL_TYPES: { type: PanelType; label: string; icon: string }[] = [
  { type: "chart", label: "Chart", icon: "📈" },
  { type: "positions", label: "Positions", icon: "💼" },
  { type: "orders", label: "Orders", icon: "📋" },
  { type: "news", label: "News", icon: "📰" },
  { type: "signals", label: "Signals", icon: "⚡" },
  { type: "risk", label: "Risk", icon: "🛡" },
  { type: "pnl", label: "P&L", icon: "💰" },
  { type: "watchlist", label: "Watchlist", icon: "👁" },
  { type: "brain", label: "Brain", icon: "🧠" },
];

const DEFAULT_PANELS: PanelConfig[] = [
  { id: "p1", type: "chart", title: "Chart — AAPL", symbol: "AAPL" },
  { id: "p2", type: "positions", title: "Open Positions" },
  { id: "p3", type: "signals", title: "Live Signals" },
  { id: "p4", type: "news", title: "Market News" },
];

const TICKER_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "SPY", "QQQ", "BTCUSD"];

// ─── Live ticker hook (uses /api/alpaca/ticker) ─────────────────────────────
function useLiveTicker(symbols: string[]) {
  return useQuery({
    queryKey: ["alpaca", "ticker", symbols.join(",")],
    queryFn: () =>
      apiFetch<{ tickers: Array<TickerItem & { error?: string }>; fetched_at: string }>(
        `/alpaca/ticker?symbols=${symbols.join(",")}`,
      ),
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
}

// ─── Daily P&L hook ─────────────────────────────────────────────────────────
function useDailyPnl() {
  return useQuery({
    queryKey: ["analytics", "daily-pnl"],
    queryFn: () => apiFetch<any>("/analytics/daily-pnl"),
    refetchInterval: 30_000,
  });
}

function useAnalyticsSummary() {
  return useQuery({
    queryKey: ["analytics", "summary"],
    queryFn: () => apiFetch<any>("/analytics/summary"),
    refetchInterval: 30_000,
  });
}

// ─── Style helpers ──────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  height: "100%", overflow: "auto", padding: 8, fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 11 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #334155",
  color: "#f59e0b", fontWeight: 600, fontSize: 10, textTransform: "uppercase",
};
const tdStyle: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid #1e293b" };

const emptyStyle: React.CSSProperties = {
  ...panelStyle, display: "flex", alignItems: "center", justifyContent: "center",
  color: "#475569", textAlign: "center", flexDirection: "column", gap: 6,
};
const loadingStyle: React.CSSProperties = { ...emptyStyle, color: "#64748b" };

function num(v: any, d = 2): string {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}
function fmtMoney(v: any): string {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.round(n).toLocaleString()}`;
}

// ─── Per-panel components (each fetches its own data) ───────────────────────

function PositionsPanel() {
  const { data, isLoading, error } = useAlpacaPositionsLive();
  if (isLoading) return <div style={loadingStyle}>Loading positions…</div>;
  if (error) return <div style={emptyStyle}><div>⚠ Couldn't load positions</div><div style={{ fontSize: 10 }}>{String((error as any)?.message ?? error)}</div></div>;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return <div style={emptyStyle}><div>No open positions</div><div style={{ fontSize: 10 }}>Connect a broker or run paper signals to populate</div></div>;
  return (
    <div style={panelStyle}>
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Symbol</th><th style={thStyle}>Qty</th>
          <th style={thStyle}>Avg</th><th style={thStyle}>Last</th><th style={thStyle}>P&L</th>
        </tr></thead>
        <tbody>
          {rows.map((p) => {
            const qty = Number(p.qty ?? p.quantity ?? 0);
            const avg = Number(p.avg_entry_price ?? p.avgPrice ?? p.entry_price ?? 0);
            const last = Number(p.current_price ?? p.market_price ?? p.last ?? avg);
            const pnl = Number(p.unrealized_pl ?? p.pnl ?? (last - avg) * qty);
            const pnlPct = avg ? (pnl / (avg * Math.abs(qty || 1))) * 100 : 0;
            const pnlPos = pnl >= 0;
            return (
              <tr key={p.symbol ?? p.asset_id}>
                <td style={{ ...tdStyle, color: "#f59e0b", fontWeight: 600 }}>{p.symbol}</td>
                <td style={{ ...tdStyle, color: qty >= 0 ? "#22c55e" : "#ef4444" }}>{qty}</td>
                <td style={tdStyle}>${num(avg)}</td>
                <td style={tdStyle}>${num(last)}</td>
                <td style={{ ...tdStyle, color: pnlPos ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                  {fmtMoney(pnl)} ({pnlPct >= 0 ? "+" : ""}{num(pnlPct)}%)
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrdersPanel() {
  const { data, isLoading, error } = useAlpacaOrders();
  if (isLoading) return <div style={loadingStyle}>Loading orders…</div>;
  if (error) return <div style={emptyStyle}><div>⚠ Couldn't load orders</div></div>;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return <div style={emptyStyle}><div>No active orders</div></div>;
  return (
    <div style={panelStyle}>
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Time</th><th style={thStyle}>Symbol</th>
          <th style={thStyle}>Side</th><th style={thStyle}>Qty</th>
          <th style={thStyle}>Status</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, 30).map((o, i) => (
            <tr key={o.id ?? i}>
              <td style={{ ...tdStyle, color: "#64748b", fontSize: 10 }}>
                {o.created_at ? new Date(o.created_at).toLocaleTimeString().slice(0, 5) : "—"}
              </td>
              <td style={{ ...tdStyle, color: "#f59e0b", fontWeight: 600 }}>{o.symbol}</td>
              <td style={{
                ...tdStyle,
                color: String(o.side).toLowerCase() === "buy" ? "#22c55e" : "#ef4444",
                fontWeight: 700,
              }}>{String(o.side ?? "—").toUpperCase()}</td>
              <td style={tdStyle}>{o.qty ?? o.quantity ?? "—"}</td>
              <td style={{ ...tdStyle, color: "#94a3b8", fontSize: 10 }}>{o.status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignalsPanel() {
  const { data, isLoading, error } = useSignals();
  if (isLoading) return <div style={loadingStyle}>Loading signals…</div>;
  if (error) return <div style={emptyStyle}><div>⚠ Couldn't load signals</div></div>;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return <div style={emptyStyle}><div>No live signals yet</div><div style={{ fontSize: 10 }}>Scanner runs every minute — wait or trigger a webhook</div></div>;
  return (
    <div style={panelStyle}>
      {rows.slice(0, 20).map((s, i) => {
        const time = s.created_at ? new Date(s.created_at).toLocaleTimeString().slice(0, 5) : "—";
        const conf = Number(s.final_quality ?? s.confidence ?? s.score ?? 0);
        const direction = String(s.direction ?? (s.side ?? "")).toUpperCase();
        const isBuy = direction === "LONG" || direction === "BUY";
        const isSell = direction === "SHORT" || direction === "SELL";
        return (
          <div key={s.id ?? i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
            borderBottom: "1px solid #1e293b",
          }}>
            <span style={{ color: "#64748b", fontSize: 10, width: 40 }}>{time}</span>
            <span style={{ color: "#f59e0b", fontWeight: 600, width: 60 }}>{s.instrument ?? s.symbol ?? "—"}</span>
            <span style={{
              color: isBuy ? "#22c55e" : isSell ? "#ef4444" : "#94a3b8",
              fontWeight: 700, width: 50, fontSize: 10,
            }}>{direction || "—"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(1, conf)) * 100}%`,
                  borderRadius: 2,
                  background: conf > 0.8 ? "#22c55e" : conf > 0.6 ? "#f59e0b" : "#ef4444",
                }} />
              </div>
            </div>
            <span style={{ color: "#64748b", fontSize: 10, width: 90, textAlign: "right" }}>
              {s.setup_type ?? s.source ?? "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NewsPanel() {
  // No real news source connected. Show explicit "feed offline" state
  // rather than fake headlines. Wire a real RSS/news provider to enable.
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 24 }}>📰</div>
      <div>News feed not connected</div>
      <div style={{ fontSize: 10, color: "#64748b", maxWidth: 280, lineHeight: 1.4 }}>
        Configure a news provider (RSS, Polygon, Alpaca News, etc.) and
        wire <code>/api/news/recent</code> to enable real headlines.
      </div>
    </div>
  );
}

function RiskPanel() {
  const account = useAlpacaAccount();
  const summary = useAnalyticsSummary();
  if (account.isLoading || summary.isLoading) return <div style={loadingStyle}>Loading risk…</div>;
  const a: any = account.data ?? {};
  const s: any = summary.data ?? {};
  const equity = Number(a.equity ?? a.portfolio_value ?? 0);
  const buyingPower = Number(a.buying_power ?? 0);
  const dayPnl = Number(a.equity ?? 0) - Number(a.last_equity ?? a.equity ?? 0);
  const exposure = equity ? Math.max(0, equity - buyingPower) : 0;
  const exposurePct = equity ? (exposure / equity) * 100 : 0;
  const hasAccount = equity > 0;
  const items = hasAccount ? [
    { label: "Equity", value: `$${num(equity, 0)}`, color: "#3b82f6" },
    { label: "Buying Power", value: `$${num(buyingPower, 0)}`, color: "#22c55e" },
    { label: "Exposure", value: `${num(exposurePct)}%`, color: "#f59e0b" },
    { label: "Day P&L", value: fmtMoney(dayPnl), color: dayPnl >= 0 ? "#22c55e" : "#ef4444" },
    { label: "Win Rate", value: s.win_rate != null ? `${num(Number(s.win_rate) * 100)}%` : "—", color: "#22c55e" },
    { label: "Total Trades", value: s.total_trades ?? "—", color: "#e2e8f0" },
    { label: "Sharpe", value: s.sharpe != null ? num(Number(s.sharpe)) : "—", color: "#22c55e" },
    { label: "Max DD", value: s.max_drawdown_pct != null ? `${num(Number(s.max_drawdown_pct))}%` : "—", color: "#ef4444" },
  ] : null;
  return (
    <div style={panelStyle}>
      {!hasAccount && (
        <div style={{ padding: 8, marginBottom: 8, background: "#1e1810", border: "1px solid #f59e0b", borderRadius: 4, fontSize: 10, color: "#fbbf24" }}>
          Broker not connected — set <code>ALPACA_API_KEY</code>/<code>ALPACA_SECRET</code> in .env to load live account data.
        </div>
      )}
      {items && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {items.map((m) => (
            <div key={m.label} style={{ padding: 8, background: "#0f1629", borderRadius: 4, border: "1px solid #1e293b" }}>
              <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PnlPanel() {
  const summary = useAnalyticsSummary();
  const daily = useDailyPnl();
  if (summary.isLoading) return <div style={loadingStyle}>Loading P&L…</div>;
  const s: any = summary.data ?? {};
  const d: any = daily.data ?? {};
  const today = Number(d.pnl ?? d.today_pnl ?? d.realized ?? 0);
  const realized = Number(s.realized_pnl ?? s.realized ?? 0);
  const unrealized = Number(s.unrealized_pnl ?? s.unrealized ?? 0);
  const total = realized + unrealized;
  const trades = Number(s.total_trades ?? 0);
  const wins = Number(s.winning_trades ?? s.wins ?? 0);
  const losses = Number(s.losing_trades ?? s.losses ?? 0);
  const totalPos = total >= 0;
  return (
    <div style={panelStyle}>
      <div style={{ textAlign: "center", padding: "16px 0" }}>
        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Today's P&L</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: totalPos ? "#22c55e" : "#ef4444", margin: "8px 0" }}>
          {fmtMoney(today)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
        {[
          { label: "Realized", value: fmtMoney(realized), color: realized >= 0 ? "#22c55e" : "#ef4444" },
          { label: "Unrealized", value: fmtMoney(unrealized), color: unrealized >= 0 ? "#22c55e" : "#ef4444" },
          { label: "Total", value: fmtMoney(total), color: total >= 0 ? "#22c55e" : "#ef4444" },
          { label: "Trades", value: String(trades), color: "#e2e8f0" },
          { label: "Winners", value: String(wins), color: "#22c55e" },
          { label: "Losers", value: String(losses), color: "#ef4444" },
        ].map((m) => (
          <div key={m.label} style={{ textAlign: "center", padding: 6, background: "#0f1629", borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>{m.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchlistPanel() {
  const { data } = useLiveTicker(TICKER_SYMBOLS);
  const tickers = (data?.tickers ?? []).filter((t: any) => !t.error);
  if (tickers.length === 0) {
    return <div style={emptyStyle}><div>Market data feed offline</div><div style={{ fontSize: 10 }}>Alpaca auth failing — check API keys</div></div>;
  }
  return (
    <div style={panelStyle}>
      <table style={tableStyle}>
        <thead><tr>
          <th style={thStyle}>Symbol</th><th style={thStyle}>Last</th><th style={thStyle}>Chg%</th>
        </tr></thead>
        <tbody>
          {tickers.map((t: any) => (
            <tr key={t.symbol}>
              <td style={{ ...tdStyle, color: "#f59e0b", fontWeight: 600 }}>{t.symbol}</td>
              <td style={tdStyle}>${num(t.price)}</td>
              <td style={{ ...tdStyle, color: Number(t.change_pct) >= 0 ? "#22c55e" : "#ef4444" }}>
                {Number(t.change_pct) >= 0 ? "+" : ""}{num(t.change_pct)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartPanel({ symbol }: { symbol?: string }) {
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 24 }}>📈</div>
      <div>{symbol || "AAPL"}</div>
      <div style={{ fontSize: 10 }}>Open <code>/tradingview-chart</code> for full chart</div>
    </div>
  );
}

function BrainPanel() {
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 24 }}>🧠</div>
      <div>Brain Orchestrator</div>
      <div style={{ fontSize: 10 }}>Open <code>/brain-graph</code> for full visualization</div>
    </div>
  );
}

function PanelContent({ panel }: { panel: PanelConfig }) {
  switch (panel.type) {
    case "positions": return <PositionsPanel />;
    case "orders":    return <OrdersPanel />;
    case "signals":   return <SignalsPanel />;
    case "news":      return <NewsPanel />;
    case "risk":      return <RiskPanel />;
    case "pnl":       return <PnlPanel />;
    case "watchlist": return <WatchlistPanel />;
    case "chart":     return <ChartPanel symbol={panel.symbol} />;
    case "brain":     return <BrainPanel />;
    default:
      return <div style={emptyStyle}>Empty panel — use header dropdown to change type</div>;
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BloombergTerminal() {
  const [panels, setPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);
  const [activePanel, setActivePanel] = useState<string>("p1");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState("");
  const [layout, setLayout] = useState<"2x2" | "1x2" | "3x1" | "1x1">("2x2");
  const cmdRef = useRef<HTMLInputElement>(null);

  // ── Live ticker bar ─────────────────────────────────────────────────────
  const tickerQ = useLiveTicker(TICKER_SYMBOLS);
  const tickers: TickerItem[] = (tickerQ.data?.tickers ?? [])
    .filter((t: any) => !t.error && t.price != null) as TickerItem[];
  const tickerOffline = !tickerQ.isLoading && tickers.length === 0;

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "/" && !cmdOpen) || (e.ctrlKey && e.key === "k")) {
        e.preventDefault();
        setCmdOpen(true);
        setTimeout(() => cmdRef.current?.focus(), 50);
        return;
      }
      if (e.key === "Escape" && cmdOpen) {
        setCmdOpen(false);
        setCmdInput("");
        return;
      }
      if (e.ctrlKey && e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        if (panels[idx]) setActivePanel(panels[idx].id);
        return;
      }
      if (e.ctrlKey && e.key === "l") {
        e.preventDefault();
        setLayout((prev) => {
          const layouts: typeof layout[] = ["2x2", "1x2", "3x1", "1x1"];
          const idx = layouts.indexOf(prev);
          return layouts[(idx + 1) % layouts.length];
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cmdOpen, panels]);

  const executeCommand = useCallback((cmd: string) => {
    const parts = cmd.trim().toUpperCase().split(/\s+/);
    const fn = parts[0];
    if (fn.length <= 5 && /^[A-Z]+$/.test(fn)) {
      setPanels((prev) => prev.map((p) =>
        p.id === activePanel ? { ...p, type: "chart", title: `Chart — ${fn}`, symbol: fn } : p
      ));
    }
    const typeMap: Record<string, PanelType> = {
      NEWS: "news", POS: "positions", POSITIONS: "positions", RISK: "risk",
      PNL: "pnl", SIGNALS: "signals", SIG: "signals", WATCH: "watchlist",
      BRAIN: "brain", CHART: "chart", ORDERS: "orders",
    };
    if (typeMap[fn]) {
      setPanels((prev) => prev.map((p) =>
        p.id === activePanel ? { ...p, type: typeMap[fn], title: typeMap[fn].charAt(0).toUpperCase() + typeMap[fn].slice(1) } : p
      ));
    }
    setCmdOpen(false);
    setCmdInput("");
  }, [activePanel]);

  const changePanelType = (panelId: string, newType: PanelType) => {
    setPanels((prev) => prev.map((p) =>
      p.id === panelId ? { ...p, type: newType, title: PANEL_TYPES.find((t) => t.type === newType)?.label || newType } : p
    ));
  };

  const gridStyle: React.CSSProperties = layout === "2x2"
    ? { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 1 }
    : layout === "1x2"
    ? { display: "grid", gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr", gap: 1 }
    : layout === "3x1"
    ? { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr", gap: 1 }
    : { display: "grid", gridTemplateColumns: "1fr", gridTemplateRows: "1fr", gap: 1 };

  const visiblePanels = layout === "1x1" ? panels.slice(0, 1)
    : layout === "3x1" ? panels.slice(0, 3) : panels.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#000", color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>
      {/* ── Live Ticker Strip ──────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 16, padding: "4px 12px", background: "#0a0e17",
        borderBottom: "1px solid #1e293b", overflow: "hidden", fontSize: 11,
        alignItems: "center",
      }}>
        <span style={{ color: tickerOffline ? "#ef4444" : "#22c55e", fontSize: 9 }}>●</span>
        {tickerQ.isLoading && <span style={{ color: "#64748b" }}>Loading market data…</span>}
        {tickerOffline && (
          <span style={{ color: "#ef4444", fontSize: 10 }}>
            Market data offline (Alpaca auth failing — set ALPACA_API_KEY)
          </span>
        )}
        {tickers.map((t) => (
          <span key={t.symbol} style={{ whiteSpace: "nowrap" }}>
            <span style={{ color: "#f59e0b", fontWeight: 600 }}>{t.symbol}</span>{" "}
            <span>${num(t.price)}</span>{" "}
            <span style={{ color: Number(t.change_pct) >= 0 ? "#22c55e" : "#ef4444" }}>
              {Number(t.change_pct) >= 0 ? "+" : ""}{num(t.change_pct)}%
            </span>
          </span>
        ))}
      </div>

      {/* ── Command Bar (overlay) ────────────────────────────────── */}
      {cmdOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.7)", zIndex: 100,
          display: "flex", justifyContent: "center", paddingTop: 120,
        }} onClick={() => { setCmdOpen(false); setCmdInput(""); }}>
          <div style={{
            width: 500, background: "#0f1629", border: "1px solid #f59e0b",
            borderRadius: 8, padding: 4, boxShadow: "0 0 30px rgba(245,158,11,0.2)",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>&gt;</span>
              <input
                ref={cmdRef}
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") executeCommand(cmdInput); }}
                placeholder="Type symbol, command (NEWS, RISK, PNL, SIGNALS)..."
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#e2e8f0", fontSize: 16, fontFamily: "inherit",
                }}
              />
            </div>
            <div style={{ padding: "4px 12px 8px", fontSize: 10, color: "#64748b" }}>
              Ctrl+1..4 focus panel · Ctrl+L cycle layout · / command bar · ESC close
            </div>
          </div>
        </div>
      )}

      {/* ── Panel Grid ───────────────────────────────────────────── */}
      <div style={{ flex: 1, ...gridStyle, minHeight: 0 }}>
        {visiblePanels.map((panel, idx) => (
          <div
            key={panel.id}
            style={{
              display: "flex", flexDirection: "column", background: "#0a0e17",
              border: activePanel === panel.id ? "1px solid #f59e0b" : "1px solid #1e293b",
              minHeight: 0, overflow: "hidden",
            }}
            onClick={() => setActivePanel(panel.id)}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "4px 8px", background: "#0f1629", borderBottom: "1px solid #1e293b",
              fontSize: 11,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: 10 }}>P{idx + 1}</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{panel.title}</span>
              </div>
              <select
                value={panel.type}
                onChange={(e) => changePanelType(panel.id, e.target.value as PanelType)}
                style={{
                  background: "#1e293b", color: "#94a3b8", border: "none",
                  borderRadius: 3, padding: "2px 4px", fontSize: 10, cursor: "pointer",
                }}
              >
                {PANEL_TYPES.map((pt) => (
                  <option key={pt.type} value={pt.type}>{pt.icon} {pt.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <PanelContent panel={panel} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Bottom Status Bar ────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 12px", background: "#0f1629", borderTop: "1px solid #1e293b",
        fontSize: 10, color: "#64748b",
      }}>
        <span>GODSVIEW TERMINAL — live data</span>
        <span>Layout: {layout} · / Command · Ctrl+L Layout · Ctrl+1..4 Panel</span>
        <span>{new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
