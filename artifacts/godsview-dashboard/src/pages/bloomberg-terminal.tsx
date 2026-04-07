/**
 * bloomberg-terminal.tsx — Phase 126: Bloomberg Terminal UI
 *
 * Multi-panel terminal interface inspired by Bloomberg Terminal:
 *   - Draggable/resizable panel grid (4-panel default layout)
 *   - Keyboard hotkeys for rapid navigation (Ctrl+1..9 panels)
 *   - Command bar (/) for quick symbol lookup and function codes
 *   - Real-time price ticker strip
 *   - Panel types: Chart, Positions, Orders, News, Signals, Risk, P&L
 *   - Dark terminal aesthetic with orange/amber accent
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type PanelType = "chart" | "positions" | "orders" | "news" | "signals" | "risk" | "pnl" | "watchlist" | "brain" | "empty";

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
  changePct: number;
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

// Mock data generators
function mockTicker(): TickerItem[] {
  const symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "SPY", "QQQ", "BTC"];
  return symbols.map((s) => {
    const price = s === "BTC" ? 68000 + Math.random() * 2000 : 100 + Math.random() * 300;
    const change = (Math.random() - 0.45) * price * 0.03;
    return { symbol: s, price, change, changePct: (change / price) * 100 };
  });
}

function mockPositions() {
  return [
    { symbol: "AAPL", qty: 150, avgPrice: 178.50, currentPrice: 185.20, pnl: 1005, pnlPct: 3.75 },
    { symbol: "NVDA", qty: 50, avgPrice: 880.00, currentPrice: 910.30, pnl: 1515, pnlPct: 3.44 },
    { symbol: "TSLA", qty: -30, avgPrice: 175.80, currentPrice: 172.10, pnl: 111, pnlPct: 2.10 },
    { symbol: "SPY", qty: 200, avgPrice: 520.40, currentPrice: 518.90, pnl: -300, pnlPct: -0.29 },
  ];
}

function mockNews() {
  return [
    { time: "14:32", headline: "Fed signals potential rate pause in June meeting", source: "Reuters", sentiment: "neutral" },
    { time: "14:28", headline: "NVDA beats Q1 earnings estimates, guidance raised", source: "Bloomberg", sentiment: "bullish" },
    { time: "14:15", headline: "US 10Y yield rises to 4.52% on strong jobs data", source: "CNBC", sentiment: "bearish" },
    { time: "14:02", headline: "AAPL announces $110B buyback program, largest ever", source: "AP", sentiment: "bullish" },
    { time: "13:45", headline: "Oil prices surge 3% on OPEC+ output cut extension", source: "Reuters", sentiment: "bullish" },
    { time: "13:30", headline: "China PMI contracts for second straight month", source: "Bloomberg", sentiment: "bearish" },
    { time: "13:12", headline: "TSLA deliveries miss estimates by 8%, shares slide", source: "MarketWatch", sentiment: "bearish" },
    { time: "12:55", headline: "EU antitrust probe targets major US tech firms", source: "FT", sentiment: "bearish" },
  ];
}

function mockSignals() {
  return [
    { time: "14:33", symbol: "AAPL", direction: "BUY", confidence: 0.87, source: "SMC+OrderFlow" },
    { time: "14:30", symbol: "NVDA", direction: "BUY", confidence: 0.92, source: "ML Ensemble" },
    { time: "14:25", symbol: "SPY", direction: "SELL", confidence: 0.71, source: "Regime Shift" },
    { time: "14:18", symbol: "TSLA", direction: "SELL", confidence: 0.65, source: "Sentiment" },
    { time: "14:10", symbol: "MSFT", direction: "BUY", confidence: 0.78, source: "Confluence" },
  ];
}

// ─── Panel Content Renderers ────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  height: "100%", overflow: "auto", padding: 8, fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

const tableStyle: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 11,
};

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #334155",
  color: "#f59e0b", fontWeight: 600, fontSize: 10, textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 8px", borderBottom: "1px solid #1e293b",
};

function PanelContent({ panel }: { panel: PanelConfig }) {
  switch (panel.type) {
    case "positions":
      return (
        <div style={panelStyle}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={thStyle}>Symbol</th><th style={thStyle}>Qty</th>
              <th style={thStyle}>Avg</th><th style={thStyle}>Last</th><th style={thStyle}>P&L</th>
            </tr></thead>
            <tbody>
              {mockPositions().map((p) => (
                <tr key={p.symbol}>
                  <td style={{ ...tdStyle, color: "#f59e0b", fontWeight: 600 }}>{p.symbol}</td>
                  <td style={{ ...tdStyle, color: p.qty > 0 ? "#22c55e" : "#ef4444" }}>{p.qty}</td>
                  <td style={tdStyle}>${p.avgPrice.toFixed(2)}</td>
                  <td style={tdStyle}>${p.currentPrice.toFixed(2)}</td>
                  <td style={{ ...tdStyle, color: p.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                    {p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(0)} ({p.pnlPct.toFixed(2)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "news":
      return (
        <div style={panelStyle}>
          {mockNews().map((n, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: "#64748b", fontSize: 10 }}>{n.time} · {n.source}</span>
                <span style={{
                  fontSize: 9, padding: "1px 6px", borderRadius: 3,
                  background: n.sentiment === "bullish" ? "#14532d" : n.sentiment === "bearish" ? "#7f1d1d" : "#1e293b",
                  color: n.sentiment === "bullish" ? "#22c55e" : n.sentiment === "bearish" ? "#ef4444" : "#94a3b8",
                }}>{n.sentiment.toUpperCase()}</span>
              </div>
              <div style={{ color: "#e2e8f0" }}>{n.headline}</div>
            </div>
          ))}
        </div>
      );

    case "signals":
      return (
        <div style={panelStyle}>
          {mockSignals().map((s, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
              borderBottom: "1px solid #1e293b",
            }}>
              <span style={{ color: "#64748b", fontSize: 10, width: 40 }}>{s.time}</span>
              <span style={{ color: "#f59e0b", fontWeight: 600, width: 50 }}>{s.symbol}</span>
              <span style={{
                color: s.direction === "BUY" ? "#22c55e" : "#ef4444",
                fontWeight: 700, width: 40,
              }}>{s.direction}</span>
              <div style={{ flex: 1 }}>
                <div style={{
                  height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", width: `${s.confidence * 100}%`, borderRadius: 2,
                    background: s.confidence > 0.8 ? "#22c55e" : s.confidence > 0.6 ? "#f59e0b" : "#ef4444",
                  }} />
                </div>
              </div>
              <span style={{ color: "#64748b", fontSize: 10, width: 80 }}>{s.source}</span>
            </div>
          ))}
        </div>
      );

    case "risk":
      return (
        <div style={panelStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: "Portfolio VaR (95%)", value: "$12,340", color: "#f59e0b" },
              { label: "Daily Loss Limit", value: "42% used", color: "#22c55e" },
              { label: "Exposure", value: "$284K / $500K", color: "#3b82f6" },
              { label: "Max Drawdown", value: "-2.1%", color: "#ef4444" },
              { label: "Sharpe (30d)", value: "1.84", color: "#22c55e" },
              { label: "Win Rate", value: "67.3%", color: "#22c55e" },
              { label: "Circuit Breaker", value: "ARMED", color: "#22c55e" },
              { label: "Capital Tier", value: "Standard", color: "#f59e0b" },
            ].map((m) => (
              <div key={m.label} style={{
                padding: 8, background: "#0f1629", borderRadius: 4, border: "1px solid #1e293b",
              }}>
                <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "pnl":
      return (
        <div style={panelStyle}>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Today's P&L</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#22c55e", margin: "8px 0" }}>+$2,331.40</div>
            <div style={{ fontSize: 12, color: "#22c55e" }}>+1.12%</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
            {[
              { label: "Realized", value: "+$1,580", color: "#22c55e" },
              { label: "Unrealized", value: "+$751", color: "#22c55e" },
              { label: "Fees", value: "-$12.40", color: "#ef4444" },
              { label: "Trades", value: "14", color: "#e2e8f0" },
              { label: "Winners", value: "9", color: "#22c55e" },
              { label: "Losers", value: "5", color: "#ef4444" },
            ].map((m) => (
              <div key={m.label} style={{ textAlign: "center", padding: 6, background: "#0f1629", borderRadius: 4 }}>
                <div style={{ fontSize: 9, color: "#64748b" }}>{m.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "chart":
      return (
        <div style={{ ...panelStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📈</div>
            <div>{panel.symbol || "AAPL"} — Open /tradingview-chart for full chart</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>Ctrl+Shift+C to open charting</div>
          </div>
        </div>
      );

    case "watchlist":
      return (
        <div style={panelStyle}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={thStyle}>Symbol</th><th style={thStyle}>Last</th><th style={thStyle}>Chg%</th>
            </tr></thead>
            <tbody>
              {mockTicker().map((t) => (
                <tr key={t.symbol}>
                  <td style={{ ...tdStyle, color: "#f59e0b", fontWeight: 600 }}>{t.symbol}</td>
                  <td style={tdStyle}>${t.price.toFixed(2)}</td>
                  <td style={{ ...tdStyle, color: t.changePct >= 0 ? "#22c55e" : "#ef4444" }}>
                    {t.changePct >= 0 ? "+" : ""}{t.changePct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "brain":
      return (
        <div style={{ ...panelStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🧠</div>
            <div>Brain Orchestrator — 20 subsystems active</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>Open /brain-graph for full visualization</div>
          </div>
        </div>
      );

    default:
      return (
        <div style={{ ...panelStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569" }}>
          Empty panel — click header to change type
        </div>
      );
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BloombergTerminal() {
  const [panels, setPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);
  const [activePanel, setActivePanel] = useState<string>("p1");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState("");
  const [ticker] = useState<TickerItem[]>(mockTicker);
  const [layout, setLayout] = useState<"2x2" | "1x2" | "3x1" | "1x1">("2x2");
  const cmdRef = useRef<HTMLInputElement>(null);

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // / or Ctrl+K → command bar
      if ((e.key === "/" && !cmdOpen) || (e.ctrlKey && e.key === "k")) {
        e.preventDefault();
        setCmdOpen(true);
        setTimeout(() => cmdRef.current?.focus(), 50);
        return;
      }
      // Escape → close command bar
      if (e.key === "Escape" && cmdOpen) {
        setCmdOpen(false);
        setCmdInput("");
        return;
      }
      // Ctrl+1..4 → focus panel
      if (e.ctrlKey && e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        if (panels[idx]) setActivePanel(panels[idx].id);
        return;
      }
      // Ctrl+L → cycle layout
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

  // ── Command execution ───────────────────────────────────────────────────
  const executeCommand = useCallback((cmd: string) => {
    const parts = cmd.trim().toUpperCase().split(/\s+/);
    const fn = parts[0];

    // Symbol lookup: just type a symbol
    if (fn.length <= 5 && /^[A-Z]+$/.test(fn)) {
      setPanels((prev) => prev.map((p) =>
        p.id === activePanel ? { ...p, type: "chart", title: `Chart — ${fn}`, symbol: fn } : p
      ));
    }

    // Panel type change: NEWS, POSITIONS, RISK, etc.
    const typeMap: Record<string, PanelType> = {
      NEWS: "news", POS: "positions", POSITIONS: "positions", RISK: "risk",
      PNL: "pnl", SIGNALS: "signals", SIG: "signals", WATCH: "watchlist",
      BRAIN: "brain", CHART: "chart", ORDERS: "orders",
    };
    if (typeMap[fn]) {
      setPanels((prev) => prev.map((p) =>
        p.id === activePanel ? { ...p, type: typeMap[fn], title: `${typeMap[fn].charAt(0).toUpperCase() + typeMap[fn].slice(1)}` } : p
      ));
    }

    setCmdOpen(false);
    setCmdInput("");
  }, [activePanel]);

  // ── Panel type switcher for header dropdown ─────────────────────────────
  const changePanelType = (panelId: string, newType: PanelType) => {
    setPanels((prev) => prev.map((p) =>
      p.id === panelId ? { ...p, type: newType, title: PANEL_TYPES.find((t) => t.type === newType)?.label || newType } : p
    ));
  };

  // ── Layout grid styles ──────────────────────────────────────────────────
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
      {/* ── Ticker Strip ──────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 16, padding: "4px 12px", background: "#0a0e17",
        borderBottom: "1px solid #1e293b", overflow: "hidden", fontSize: 11,
      }}>
        {ticker.map((t) => (
          <span key={t.symbol} style={{ whiteSpace: "nowrap" }}>
            <span style={{ color: "#f59e0b", fontWeight: 600 }}>{t.symbol}</span>{" "}
            <span>${t.price.toFixed(2)}</span>{" "}
            <span style={{ color: t.changePct >= 0 ? "#22c55e" : "#ef4444" }}>
              {t.changePct >= 0 ? "+" : ""}{t.changePct.toFixed(2)}%
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

            {/* Panel header with type switcher */}
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
            {/* Panel content */}
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
        <span>GODSVIEW TERMINAL v1.0 — Phase 126</span>
        <span>Layout: {layout} · / Command · Ctrl+L Layout · Ctrl+1..4 Panel</span>
        <span>{new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
