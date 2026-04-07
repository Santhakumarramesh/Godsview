/**
 * autonomous-brain.tsx — Phase 148: Autonomous Brain Dashboard
 *
 * Visualizes per-symbol brain nodes with all 9 analysis dimensions:
 *   - Radar chart per stock showing all scores
 *   - Decision cards with reasoning chain
 *   - Live SSE updates
 *   - Multi-timeframe decision matrix
 *   - Top opportunities panel
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrainSummary {
  symbol: string; isActive: boolean; compositeScore: number;
  compositeBias: string; compositeDecision: string;
  winRate: number; totalTrades: number; pnl: number; sharpe: number;
  lastUpdate: number;
}

interface ReasoningStep {
  module: string; observation: string; conclusion: string;
  confidence: number; weight: number;
}

interface BrainDetail {
  symbol: string; compositeScore: number; compositeBias: string;
  compositeDecision: string; winRate: number; pnl: number; sharpe: number;
  decisions: Record<string, {
    timeframe: string; decision: string; confidence: number; bias: string;
    entryPrice: number; stopLoss: number; targets: number[];
    riskReward: number; positionSizePct: number;
    humanReadableSummary: string;
    reasoningChain: ReasoningStep[];
    scores: Record<string, { score: number; bias: string }>;
  }>;
}

const ANALYSIS_DIMS = [
  "fundamental", "technical", "smc", "ict", "orderFlow",
  "priceAction", "liquidity", "heatmap", "indicators",
] as const;

const DIM_LABELS: Record<string, string> = {
  fundamental: "Fundamental", technical: "Technical", smc: "SMC",
  ict: "ICT", orderFlow: "Order Flow", priceAction: "Price Action",
  liquidity: "Liquidity", heatmap: "Heatmap", indicators: "Indicators",
};

const DIM_COLORS: Record<string, string> = {
  fundamental: "#3b82f6", technical: "#22c55e", smc: "#f59e0b",
  ict: "#a855f7", orderFlow: "#ef4444", priceAction: "#06b6d4",
  liquidity: "#ec4899", heatmap: "#f97316", indicators: "#84cc16",
};

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"];

const BIAS_COLORS: Record<string, string> = {
  STRONG_BULL: "#22c55e", BULL: "#4ade80", NEUTRAL: "#94a3b8",
  BEAR: "#f87171", STRONG_BEAR: "#ef4444",
};

const DECISION_COLORS: Record<string, string> = {
  AGGRESSIVE_LONG: "#16a34a", LONG: "#22c55e", HOLD: "#64748b",
  SHORT: "#ef4444", AGGRESSIVE_SHORT: "#dc2626",
};

// ─── Radar Chart (Canvas) ───────────────────────────────────────────────────

function RadarChart({ scores, size = 180 }: { scores: Record<string, { score: number }>; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2, radius = size * 0.38;
    const dims = ANALYSIS_DIMS;
    const n = dims.length;
    const angleStep = (2 * Math.PI) / n;

    // Grid rings
    for (let ring = 1; ring <= 4; ring++) {
      const r = radius * (ring / 4);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const angle = -Math.PI / 2 + i * angleStep;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(100,116,139,0.25)";
      ctx.stroke();
    }

    // Axis lines + labels
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(100,116,139,0.3)"; ctx.stroke();
      // Label
      const lx = cx + (radius + 14) * Math.cos(angle);
      const ly = cy + (radius + 14) * Math.sin(angle);
      ctx.font = "9px sans-serif";
      ctx.fillStyle = DIM_COLORS[dims[i]] || "#94a3b8";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(DIM_LABELS[dims[i]] || dims[i], lx, ly);
    }

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const val = (scores[dims[i]]?.score ?? 50) / 100;
      const x = cx + radius * val * Math.cos(angle);
      const y = cy + radius * val * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(59,130,246,0.2)";
    ctx.fill();
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Data points
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const val = (scores[dims[i]]?.score ?? 50) / 100;
      const x = cx + radius * val * Math.cos(angle);
      const y = cy + radius * val * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = DIM_COLORS[dims[i]] || "#3b82f6";
      ctx.fill();
    }
  }, [scores, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} />;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AutonomousBrainPage() {
  const [brains, setBrains] = useState<BrainSummary[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrainDetail | null>(null);
  const [selectedTf, setSelectedTf] = useState("1h");
  const [searchQuery, setSearchQuery] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch initial brain list
  useEffect(() => {
    fetch("/api/autonomous/brains")
      .then(r => r.json())
      .then(d => setBrains(d.brains ?? []))
      .catch(() => {
        // Seed mock data if API not available
        const mockSymbols = ["AAPL","MSFT","GOOGL","AMZN","TSLA","NVDA","META","SPY","QQQ","AMD","NFLX","JPM","V","BTCUSD","ETHUSD"];
        setBrains(mockSymbols.map(s => {
          const score = 30 + Math.random() * 50;
          return {
            symbol: s, isActive: true, compositeScore: Math.round(score),
            compositeBias: score > 60 ? "BULL" : score < 40 ? "BEAR" : "NEUTRAL",
            compositeDecision: score > 60 ? "LONG" : score < 40 ? "SHORT" : "HOLD",
            winRate: 0.4 + Math.random() * 0.3, totalTrades: Math.floor(50 + Math.random() * 200),
            pnl: -5000 + Math.random() * 30000, sharpe: 0.5 + Math.random() * 2.5,
            lastUpdate: Date.now(),
          };
        }));
      });
  }, []);

  // SSE stream for live updates
  useEffect(() => {
    try {
      const es = new EventSource("/api/autonomous/stream");
      eventSourceRef.current = es;
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "update" && msg.brains) {
            setBrains(msg.brains);
          }
        } catch {}
      };
      return () => es.close();
    } catch { return; }
  }, []);

  // Fetch detail when symbol selected
  useEffect(() => {
    if (!selectedSymbol) { setDetail(null); return; }
    fetch(`/api/autonomous/brain/${selectedSymbol}`)
      .then(r => r.json())
      .then(d => setDetail(d))
      .catch(() => {
        // Generate mock detail
        const dims = ANALYSIS_DIMS;
        const decisions: any = {};
        for (const tf of TIMEFRAMES) {
          const sc: any = {};
          for (const dim of dims) sc[dim] = { score: 20 + Math.random() * 60, bias: "NEUTRAL" };
          const conf = Math.round(30 + Math.random() * 50);
          decisions[tf] = {
            timeframe: tf, decision: conf > 60 ? "LONG" : conf < 40 ? "SHORT" : "HOLD",
            confidence: conf, bias: conf > 60 ? "BULL" : "NEUTRAL",
            entryPrice: 100 + Math.random() * 200, stopLoss: 90 + Math.random() * 180,
            targets: [110 + Math.random() * 100, 120 + Math.random() * 100, 130 + Math.random() * 100],
            riskReward: 1.5 + Math.random() * 3, positionSizePct: 1 + Math.random() * 5,
            humanReadableSummary: `[${selectedSymbol}] Brain analysis for ${tf}`,
            reasoningChain: dims.map(d => ({
              module: DIM_LABELS[d], observation: `${DIM_LABELS[d]} score: ${Math.round(sc[d].score)}/100`,
              conclusion: sc[d].score > 60 ? `${DIM_LABELS[d]} supports LONG` : `${DIM_LABELS[d]} is NEUTRAL`,
              confidence: sc[d].score / 100, weight: 0.11,
            })),
            scores: sc,
          };
        }
        const b = brains.find(x => x.symbol === selectedSymbol);
        setDetail({
          symbol: selectedSymbol, compositeScore: b?.compositeScore ?? 50,
          compositeBias: b?.compositeBias ?? "NEUTRAL", compositeDecision: b?.compositeDecision ?? "HOLD",
          winRate: b?.winRate ?? 0.5, pnl: b?.pnl ?? 0, sharpe: b?.sharpe ?? 1, decisions,
        });
      });
  }, [selectedSymbol, brains]);

  const filteredBrains = useMemo(() => {
    if (!searchQuery) return brains;
    return brains.filter(b => b.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [brains, searchQuery]);

  const currentDecision = detail?.decisions[selectedTf];

  // ── Render ──────────────────────────────────────────────────────────────────
  const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", height: "100%", background: "#0a0e17", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" },
    sidebar: { width: 280, borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", background: "#0f1629" },
    main: { flex: 1, overflow: "auto", padding: 24 },
    search: { margin: 12, padding: "8px 12px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 },
    brainCard: { padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #1e293b", transition: "background 0.15s" },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#f1f5f9" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280, 1fr))", gap: 16 },
    card: { background: "#0f1629", border: "1px solid #1e293b", borderRadius: 8, padding: 16 },
    badge: { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 },
    tfBtn: { padding: "6px 14px", border: "none", borderRadius: 4, fontSize: 13, cursor: "pointer", fontWeight: 600 },
  };

  return (
    <div style={S.page}>
      {/* ── Sidebar: Brain Nodes List ────────────────────────────── */}
      <div style={S.sidebar}>
        <div style={{ padding: "16px 14px 8px", fontSize: 18, fontWeight: 800, color: "#f59e0b" }}>
          🧠 Autonomous Brains
        </div>
        <div style={{ padding: "0 14px 8px", fontSize: 11, color: "#64748b" }}>
          {brains.filter(b => b.isActive).length} active nodes
        </div>
        <input
          placeholder="Search symbol..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={S.search}
        />
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filteredBrains.map(b => (
            <div
              key={b.symbol}
              onClick={() => setSelectedSymbol(b.symbol)}
              style={{
                ...S.brainCard,
                background: selectedSymbol === b.symbol ? "#1e293b" : "transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{b.symbol}</span>
                <span style={{ ...S.badge, background: DECISION_COLORS[b.compositeDecision] || "#64748b", color: "#fff" }}>
                  {b.compositeDecision}
                </span>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
                <span>Score: <b style={{ color: BIAS_COLORS[b.compositeBias] || "#94a3b8" }}>{b.compositeScore}</b></span>
                <span>WR: {(b.winRate * 100).toFixed(1)}%</span>
                <span style={{ color: b.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                  ${b.pnl >= 0 ? "+" : ""}{b.pnl.toFixed(0)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────── */}
      <div style={S.main}>
        {!selectedSymbol ? (
          <div style={{ textAlign: "center", paddingTop: 100 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f59e0b" }}>Autonomous Symbol Brain Engine</div>
            <div style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>
              Select a symbol from the sidebar to view its brain analysis
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 16 }}>
              Each node acts as a human trader analyzing: Fundamental · Technical · SMC · ICT · Order Flow · Price Action · Liquidity · Heatmap · Indicators
            </div>
          </div>
        ) : !detail ? (
          <div style={{ textAlign: "center", paddingTop: 100, color: "#64748b" }}>Loading brain for {selectedSymbol}...</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{detail.symbol}</div>
              <span style={{ ...S.badge, background: DECISION_COLORS[detail.compositeDecision] || "#64748b", color: "#fff", fontSize: 14, padding: "4px 12px" }}>
                {detail.compositeDecision}
              </span>
              <span style={{ ...S.badge, background: BIAS_COLORS[detail.compositeBias] || "#64748b", color: "#fff", fontSize: 14, padding: "4px 12px" }}>
                {detail.compositeBias}
              </span>
              <div style={{ flex: 1 }} />
              <div style={{ textAlign: "right", fontSize: 12, color: "#64748b" }}>
                <div>Score: <b style={{ fontSize: 24, color: "#f59e0b" }}>{detail.compositeScore}</b>/100</div>
                <div>WR: {(detail.winRate * 100).toFixed(1)}% · Sharpe: {detail.sharpe.toFixed(2)} · PnL: <span style={{ color: detail.pnl >= 0 ? "#22c55e" : "#ef4444" }}>${detail.pnl.toFixed(0)}</span></div>
              </div>
            </div>

            {/* Timeframe selector */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => setSelectedTf(tf)}
                  style={{
                    ...S.tfBtn,
                    background: selectedTf === tf ? "#3b82f6" : "#1e293b",
                    color: selectedTf === tf ? "#fff" : "#9ca3af",
                  }}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Radar + Decision Panel */}
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, marginBottom: 24 }}>
              {/* Radar Chart */}
              <div style={{ ...S.card, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>9-Dimension Analysis</div>
                {currentDecision && <RadarChart scores={currentDecision.scores} size={200} />}
              </div>

              {/* Decision Card */}
              {currentDecision && (
                <div style={S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div>
                      <span style={{ ...S.badge, background: DECISION_COLORS[currentDecision.decision] || "#64748b", color: "#fff", fontSize: 16, padding: "4px 14px" }}>
                        {currentDecision.decision}
                      </span>
                      <span style={{ marginLeft: 12, fontSize: 14, color: "#94a3b8" }}>Confidence: <b style={{ color: "#f59e0b" }}>{currentDecision.confidence}%</b></span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>R:R {currentDecision.riskReward} · Size {currentDecision.positionSizePct}%</div>
                  </div>

                  {/* Entry/SL/TP */}
                  <div style={{ display: "flex", gap: 20, marginBottom: 12, fontSize: 13 }}>
                    <div>Entry: <b style={{ color: "#e2e8f0" }}>${currentDecision.entryPrice.toFixed(2)}</b></div>
                    <div>SL: <b style={{ color: "#ef4444" }}>${currentDecision.stopLoss.toFixed(2)}</b></div>
                    {currentDecision.targets.map((t, i) => (
                      <div key={i}>TP{i + 1}: <b style={{ color: "#22c55e" }}>${t.toFixed(2)}</b></div>
                    ))}
                  </div>

                  {/* Human summary */}
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, marginBottom: 12, fontStyle: "italic" }}>
                    {currentDecision.humanReadableSummary}
                  </div>

                  {/* Reasoning Chain */}
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>REASONING CHAIN</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {currentDecision.reasoningChain.map((step, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <span style={{ ...S.badge, background: DIM_COLORS[step.module.toLowerCase().replace(" ", "")] || "#334155", color: "#fff", minWidth: 70, textAlign: "center" }}>
                          {step.module}
                        </span>
                        <div style={{ flex: 1, color: "#94a3b8" }}>{step.conclusion}</div>
                        <div style={{ width: 60, background: "#1e293b", borderRadius: 4, height: 6, overflow: "hidden" }}>
                          <div style={{ width: `${step.confidence * 100}%`, height: "100%", background: step.confidence > 0.6 ? "#22c55e" : step.confidence > 0.4 ? "#f59e0b" : "#ef4444", borderRadius: 4 }} />
                        </div>
                        <span style={{ width: 30, textAlign: "right", color: "#64748b" }}>{(step.confidence * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Multi-Timeframe Decision Matrix */}
            <div style={S.section}>
              <div style={S.sectionTitle}>Multi-Timeframe Decision Matrix</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e293b" }}>
                      <th style={{ padding: 8, textAlign: "left", color: "#64748b" }}>TF</th>
                      <th style={{ padding: 8, textAlign: "center", color: "#64748b" }}>Decision</th>
                      <th style={{ padding: 8, textAlign: "center", color: "#64748b" }}>Confidence</th>
                      <th style={{ padding: 8, textAlign: "center", color: "#64748b" }}>Bias</th>
                      <th style={{ padding: 8, textAlign: "right", color: "#64748b" }}>Entry</th>
                      <th style={{ padding: 8, textAlign: "right", color: "#64748b" }}>SL</th>
                      <th style={{ padding: 8, textAlign: "right", color: "#64748b" }}>TP1</th>
                      <th style={{ padding: 8, textAlign: "right", color: "#64748b" }}>R:R</th>
                      <th style={{ padding: 8, textAlign: "right", color: "#64748b" }}>Size%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TIMEFRAMES.map(tf => {
                      const d = detail.decisions[tf];
                      if (!d) return null;
                      return (
                        <tr key={tf} style={{ borderBottom: "1px solid #0f1629", background: selectedTf === tf ? "#1e293b" : "transparent", cursor: "pointer" }} onClick={() => setSelectedTf(tf)}>
                          <td style={{ padding: 8, fontWeight: 700 }}>{tf}</td>
                          <td style={{ padding: 8, textAlign: "center" }}>
                            <span style={{ ...S.badge, background: DECISION_COLORS[d.decision] || "#64748b", color: "#fff" }}>{d.decision}</span>
                          </td>
                          <td style={{ padding: 8, textAlign: "center" }}>
                            <span style={{ color: d.confidence >= 60 ? "#22c55e" : d.confidence >= 40 ? "#f59e0b" : "#ef4444" }}>{d.confidence}%</span>
                          </td>
                          <td style={{ padding: 8, textAlign: "center" }}>
                            <span style={{ color: BIAS_COLORS[d.bias] || "#94a3b8" }}>{d.bias}</span>
                          </td>
                          <td style={{ padding: 8, textAlign: "right", fontFamily: "monospace" }}>${d.entryPrice.toFixed(2)}</td>
                          <td style={{ padding: 8, textAlign: "right", fontFamily: "monospace", color: "#ef4444" }}>${d.stopLoss.toFixed(2)}</td>
                          <td style={{ padding: 8, textAlign: "right", fontFamily: "monospace", color: "#22c55e" }}>${d.targets[0]?.toFixed(2)}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{d.riskReward}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{d.positionSizePct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Score Bars for Current Timeframe */}
            {currentDecision && (
              <div style={S.section}>
                <div style={S.sectionTitle}>Analysis Scores — {selectedTf}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {ANALYSIS_DIMS.map(dim => {
                    const s = currentDecision.scores[dim];
                    if (!s) return null;
                    return (
                      <div key={dim} style={S.card}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: DIM_COLORS[dim] }}>{DIM_LABELS[dim]}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: BIAS_COLORS[s.bias] || "#94a3b8" }}>{s.score}/100</span>
                        </div>
                        <div style={{ background: "#1e293b", borderRadius: 4, height: 8, overflow: "hidden" }}>
                          <div style={{
                            width: `${s.score}%`, height: "100%", borderRadius: 4,
                            background: s.score >= 60 ? "#22c55e" : s.score >= 40 ? "#f59e0b" : "#ef4444",
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{s.bias}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
