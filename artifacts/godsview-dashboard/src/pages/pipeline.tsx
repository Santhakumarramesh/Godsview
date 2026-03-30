import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface PipelineLayer {
  id: string;
  step: number;
  name: string;
  shortName: string;
  icon: string;
  weight: number;
  status: "OPTIMAL" | "SCANNING" | "PROCESSING" | "FORMING" | "DEGRADED" | "OFFLINE";
  latencyMs: number;
  score: number;
  details: string;
  lastUpdate: number;
}

interface PipelineSignal {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  scores: Record<string, number>;
  compositeScore: number;
  decision: "TRADE" | "PASS" | "REJECTED" | "BLOCKED_BY_RISK" | "DEGRADED_DATA";
  reason: string;
  timestamp: number;
  layers: LayerTrace[];
}

interface LayerTrace {
  layerId: string;
  score: number;
  latencyMs: number;
  passed: boolean;
  detail: string;
}

interface ConsoleEntry {
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR" | "SIGNAL" | "DECISION";
  source: string;
  message: string;
}

// ─── Mock Data Generator ─────────────────────────────────────────────────────
const LAYERS: PipelineLayer[] = [
  { id: "structure", step: 1, name: "TradingView Structure", shortName: "STRUCTURE", icon: "candlestick_chart", weight: 0.30, status: "OPTIMAL", latencyMs: 12, score: 0.87, details: "SK zones locked · 3 swing levels active · HTF bias: BULLISH", lastUpdate: Date.now() },
  { id: "orderflow", step: 2, name: "Order Flow Engine", shortName: "ORDERFLOW", icon: "reorder", weight: 0.25, status: "SCANNING", latencyMs: 8, score: 0.72, details: "CVD divergence detected · Delta sweep forming · Absorption at 894.20", lastUpdate: Date.now() - 2000 },
  { id: "recall", step: 3, name: "Recall Engine", shortName: "RECALL", icon: "history", weight: 0.20, status: "OPTIMAL", latencyMs: 45, score: 0.91, details: "Pattern match: sweep_reclaim (81% hist. win) · Similar setup 3d ago → +2.1R", lastUpdate: Date.now() - 5000 },
  { id: "ml", step: 4, name: "ML Model", shortName: "ML", icon: "psychology", weight: 0.15, status: "PROCESSING", latencyMs: 142, score: 0.68, details: "XGBoost prob: 0.68 · Feature drift: LOW · Last retrain: 2h ago · AUC: 0.74", lastUpdate: Date.now() - 8000 },
  { id: "claude", step: 5, name: "Claude Reasoning", shortName: "CLAUDE", icon: "auto_awesome", weight: 0.10, status: "FORMING", latencyMs: 890, score: 0.82, details: "Reasoning: Setup aligns with regime · No contradictions · R:R favorable at 2.4:1", lastUpdate: Date.now() - 12000 },
  { id: "risk", step: 6, name: "Risk Engine", shortName: "RISK", icon: "shield", weight: 0, status: "OPTIMAL", latencyMs: 3, score: 1.0, details: "Gate: ALLOW · Daily P&L: +$142 · Exposure: 28% · Positions: 1/3 · No cooldown", lastUpdate: Date.now() - 1000 },
];

const SYMBOLS = ["BTC/USD", "ETH/USD", "NVDA", "AAPL", "TSLA", "SPY", "QQQ", "META", "AMZN", "SOL/USD"];
const DIRECTIONS: ("LONG" | "SHORT")[] = ["LONG", "SHORT"];
const DECISIONS: PipelineSignal["decision"][] = ["TRADE", "PASS", "REJECTED", "BLOCKED_BY_RISK"];

function generateSignal(idx: number): PipelineSignal {
  const sym = SYMBOLS[idx % SYMBOLS.length];
  const dir = DIRECTIONS[Math.random() > 0.45 ? 0 : 1];
  const scores: Record<string, number> = {};
  const layers: LayerTrace[] = [];
  let composite = 0;

  LAYERS.forEach((l) => {
    const s = +(Math.random() * 0.4 + 0.55).toFixed(2);
    scores[l.id] = s;
    composite += s * l.weight;
    layers.push({
      layerId: l.id,
      score: s,
      latencyMs: l.latencyMs + Math.floor(Math.random() * 20),
      passed: l.id === "risk" ? Math.random() > 0.15 : s > 0.5,
      detail: l.details.split("·")[0].trim(),
    });
  });

  const decision = composite > 0.75 ? "TRADE" : composite > 0.6 ? "PASS" : DECISIONS[Math.floor(Math.random() * DECISIONS.length)];
  const reasons: Record<string, string> = {
    TRADE: "All layers approved — executing",
    PASS: "Below quality threshold (0.75)",
    REJECTED: "Claude veto: conflicting macro signals",
    BLOCKED_BY_RISK: "Daily loss limit proximity",
    DEGRADED_DATA: "Insufficient tick data",
  };

  return {
    id: `SIG-${Date.now().toString(36).toUpperCase()}-${idx}`,
    symbol: sym,
    direction: dir,
    scores,
    compositeScore: +composite.toFixed(3),
    decision,
    reason: reasons[decision],
    timestamp: Date.now() - idx * 45000,
    layers,
  };
}
function generateConsoleEntries(): ConsoleEntry[] {
  const now = Date.now();
  return [
    { timestamp: now - 1200, level: "INFO", source: "STRUCTURE", message: "SK zone recalculated — 3 active swing levels on NVDA 15m" },
    { timestamp: now - 3400, level: "SIGNAL", source: "PIPELINE", message: "New candidate: BTC/USD LONG — composite 0.812 — routing to risk gate" },
    { timestamp: now - 5800, level: "WARN", source: "ML", message: "Feature drift detected on ETH/USD model — AUC dropped 0.74 → 0.71" },
    { timestamp: now - 8200, level: "DECISION", source: "RISK", message: "ALLOW — BTC/USD LONG — daily P&L +$142 — exposure 28% — position 1/3" },
    { timestamp: now - 12500, level: "INFO", source: "RECALL", message: "Pattern match: sweep_reclaim on NVDA — 81% historical win rate (n=47)" },
    { timestamp: now - 18000, level: "INFO", source: "ORDERFLOW", message: "CVD divergence forming on ETH/USD — price ↓ but cumulative delta ↑" },
    { timestamp: now - 24000, level: "ERROR", source: "CLAUDE", message: "Circuit breaker OPEN — 3 consecutive timeouts — fallback heuristic active" },
    { timestamp: now - 28000, level: "INFO", source: "CLAUDE", message: "Circuit breaker CLOSED — Claude API recovered — resuming normal reasoning" },
    { timestamp: now - 35000, level: "DECISION", source: "PIPELINE", message: "REJECTED — ETH/USD SHORT — Claude veto: macro regime contradicts setup" },
    { timestamp: now - 42000, level: "SIGNAL", source: "STRUCTURE", message: "Breakout failure detected: AAPL tested resistance $198.40 — snap-back confirmed" },
    { timestamp: now - 48000, level: "WARN", source: "RISK", message: "Approaching daily loss limit — $212/$250 used — tightening position sizing" },
    { timestamp: now - 55000, level: "INFO", source: "ML", message: "Model retrained on 136K+ outcomes — new AUC: 0.76 — deploying to inference" },
  ];
}

// ─── Color Helpers ───────────────────────────────────────────────────────────
const statusColor: Record<string, string> = {
  OPTIMAL: "#9cff93",
  SCANNING: "#669dff",
  PROCESSING: "#669dff",
  FORMING: "#ffd166",
  DEGRADED: "#ff7162",
  OFFLINE: "#666",
};

const decisionColor: Record<string, string> = {
  TRADE: "#9cff93",
  PASS: "#8c909f",
  REJECTED: "#ff7162",
  BLOCKED_BY_RISK: "#ffd166",
  DEGRADED_DATA: "#666",
};

const logLevelColor: Record<string, string> = {
  INFO: "#8c909f",
  WARN: "#ffd166",
  ERROR: "#ff7162",
  SIGNAL: "#669dff",
  DECISION: "#9cff93",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PipelineHeader({ totalLatency, activeNodes }: { totalLatency: number; activeNodes: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid rgba(72,72,73,0.15)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="material-symbols-outlined" style={{ color: "#9cff93", fontSize: 28 }}>hub</span>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#e6e1e5", margin: 0, letterSpacing: "-0.02em" }}>
            PIPELINE ENGINE
          </h1>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
            6-LAYER HYBRID AI PIPELINE
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total Latency</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, color: totalLatency < 1500 ? "#9cff93" : "#ffd166", letterSpacing: "-0.02em" }}>
            {formatLatency(totalLatency)}
          </div>
        </div>
        <div style={{ width: 1, height: 36, background: "rgba(72,72,73,0.2)" }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>Active Nodes</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, color: "#e6e1e5", letterSpacing: "-0.02em" }}>
            {activeNodes.toString().padStart(2, "0")}/{LAYERS.length.toString().padStart(2, "0")}
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerCard({ layer, isActive, onClick }: { layer: PipelineLayer; isActive: boolean; onClick: () => void }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (layer.status === "SCANNING" || layer.status === "PROCESSING") {
      const iv = setInterval(() => setPulse((p) => !p), 1200);
      return () => clearInterval(iv);
    }
  }, [layer.status]);

  const borderColor = isActive ? "#669dff" : "rgba(72,72,73,0.15)";
  const bg = isActive ? "rgba(102,157,255,0.06)" : "#1a191b";
  return (
    <div
      onClick={onClick}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        padding: "16px 20px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Step number + status dot */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: `${statusColor[layer.status]}18`,
            border: `1.5px solid ${statusColor[layer.status]}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
            color: statusColor[layer.status],
          }}>
            {layer.step.toString().padStart(2, "0")}
          </div>
          <span className="material-symbols-outlined" style={{ color: statusColor[layer.status], fontSize: 20 }}>
            {layer.icon}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: statusColor[layer.status],
            boxShadow: pulse ? `0 0 8px ${statusColor[layer.status]}` : "none",
            transition: "box-shadow 0.6s ease",
          }} />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: statusColor[layer.status], letterSpacing: "0.08em",
            fontWeight: 600,
          }}>
            {layer.status}
          </span>
        </div>
      </div>

      {/* Name + weight */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: "#e6e1e5", letterSpacing: "-0.01em" }}>
          {layer.name}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", marginTop: 2 }}>
          {layer.id === "risk" ? "GATE (VETO POWER)" : `WEIGHT: ${(layer.weight * 100).toFixed(0)}%`}
        </div>
      </div>

      {/* Score bar */}
      {layer.id !== "risk" && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>SCORE</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: statusColor[layer.status], fontWeight: 700 }}>
              {(layer.score * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ height: 3, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              width: `${layer.score * 100}%`, height: "100%",
              background: `linear-gradient(90deg, ${statusColor[layer.status]}88, ${statusColor[layer.status]})`,
              borderRadius: 2, transition: "width 0.8s ease",
            }} />
          </div>
        </div>
      )}

      {/* Latency */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>LATENCY</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: layer.latencyMs < 100 ? "#9cff93" : layer.latencyMs < 500 ? "#ffd166" : "#ff7162", fontWeight: 600 }}>
          {formatLatency(layer.latencyMs)}
        </span>
      </div>

      {/* Details on hover/active */}
      {isActive && (
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: "1px solid rgba(72,72,73,0.15)",
          fontFamily: "Inter, sans-serif", fontSize: 12, color: "#b4b0b8",
          lineHeight: 1.6,
        }}>
          {layer.details}
        </div>
      )}
    </div>
  );
}
function PipelineConnector() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: 24, position: "relative",
    }}>
      <div style={{
        width: 1, height: "100%",
        background: "linear-gradient(180deg, rgba(156,255,147,0.4), rgba(102,157,255,0.4))",
      }} />
      <span className="material-symbols-outlined" style={{
        position: "absolute", fontSize: 14, color: "#669dff",
        background: "#131314", padding: "0 2px",
      }}>
        arrow_downward
      </span>
    </div>
  );
}

function SignalCard({ signal }: { signal: PipelineSignal }) {
  const [expanded, setExpanded] = useState(false);
  const dc = decisionColor[signal.decision];

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: "#1a191b",
        border: `1px solid ${expanded ? dc + "44" : "rgba(72,72,73,0.15)"}`,
        borderRadius: 6,
        padding: "14px 18px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        borderLeft: `3px solid ${dc}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700,
            color: "#e6e1e5",
          }}>
            {signal.symbol}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: signal.direction === "LONG" ? "#9cff93" : "#ff7162",
            background: signal.direction === "LONG" ? "rgba(156,255,147,0.1)" : "rgba(255,113,98,0.1)",
            padding: "2px 8px", borderRadius: 3, fontWeight: 600,
          }}>
            {signal.direction}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700,
            color: dc, letterSpacing: "-0.02em",
          }}>
            {(signal.compositeScore * 100).toFixed(0)}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: dc, background: `${dc}18`,
            padding: "3px 10px", borderRadius: 3, fontWeight: 600,
            letterSpacing: "0.06em",
          }}>
            {signal.decision}
          </span>
        </div>
      </div>

      {/* Mini score bars */}
      <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
        {LAYERS.filter(l => l.id !== "risk").map((l) => {
          const s = signal.scores[l.id] || 0;
          return (
            <div key={l.id} style={{ flex: 1 }}>
              <div style={{ height: 2, background: "rgba(72,72,73,0.2)", borderRadius: 1, overflow: "hidden" }}>
                <div style={{
                  width: `${s * 100}%`, height: "100%",
                  background: s > 0.7 ? "#9cff93" : s > 0.5 ? "#ffd166" : "#ff7162",
                  borderRadius: 1,
                }} />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: "#666", textAlign: "center", marginTop: 3, textTransform: "uppercase" }}>
                {l.shortName.slice(0, 4)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded trace */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(72,72,73,0.12)" }}>
          <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#b4b0b8", marginBottom: 10 }}>
            {signal.reason}
          </div>          {signal.layers.map((trace) => {
            const layer = LAYERS.find(l => l.id === trace.layerId);
            return (
              <div key={trace.layerId} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 0", fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              }}>
                <span className="material-symbols-outlined" style={{
                  fontSize: 14,
                  color: trace.passed ? "#9cff93" : "#ff7162",
                }}>
                  {trace.passed ? "check_circle" : "cancel"}
                </span>
                <span style={{ color: "#8c909f", width: 80 }}>{layer?.shortName}</span>
                <span style={{ color: trace.score > 0.7 ? "#9cff93" : trace.score > 0.5 ? "#ffd166" : "#ff7162", width: 40, textAlign: "right" }}>
                  {(trace.score * 100).toFixed(0)}%
                </span>
                <span style={{ color: "#666", width: 50, textAlign: "right" }}>{formatLatency(trace.latencyMs)}</span>
                <span style={{ color: "#8c909f", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {trace.detail}
                </span>
              </div>
            );
          })}
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#666", marginTop: 8 }}>
            {signal.id} · {formatTime(signal.timestamp)}
          </div>
        </div>
      )}
    </div>
  );
}

function ConsoleLog({ entries }: { entries: ConsoleEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{
      background: "#0e0e0f",
      border: "1px solid rgba(72,72,73,0.12)",
      borderRadius: 6,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid rgba(72,72,73,0.12)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#9cff93" }}>terminal</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
          SYSTEM CONSOLE
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {["INFO", "WARN", "ERROR", "SIGNAL"].map((lvl) => (
            <div key={lvl} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: logLevelColor[lvl],
              opacity: 0.6,
            }} />
          ))}
        </div>
      </div>
      <div ref={scrollRef} style={{
        maxHeight: 280, overflowY: "auto", padding: "8px 0",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        lineHeight: 1.8,
      }}>
        {entries.map((entry, i) => (
          <div key={i} style={{
            padding: "2px 16px",
            display: "flex", gap: 10,
            opacity: 0.9,
          }}>
            <span style={{ color: "#666", minWidth: 70 }}>{formatTime(entry.timestamp)}</span>
            <span style={{
              color: logLevelColor[entry.level],
              minWidth: 60,
              fontWeight: entry.level === "ERROR" ? 700 : 400,
            }}>
              [{entry.level}]
            </span>
            <span style={{ color: "#669dff", minWidth: 80 }}>{entry.source}</span>
            <span style={{ color: entry.level === "ERROR" ? "#ff7162" : "#b4b0b8" }}>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompositeScorePanel({ layers }: { layers: PipelineLayer[] }) {
  const composite = layers.reduce((sum, l) => sum + l.score * l.weight, 0);
  const pct = (composite * 100).toFixed(1);

  return (
    <div style={{
      background: "#1a191b",      border: "1px solid rgba(72,72,73,0.15)",
      borderRadius: 6,
      padding: "20px 24px",
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12,
        textTransform: "uppercase",
      }}>
        Composite Quality Score
      </div>

      {/* Big number */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 16 }}>
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 48, fontWeight: 700,
          color: composite > 0.75 ? "#9cff93" : composite > 0.6 ? "#ffd166" : "#ff7162",
          letterSpacing: "-0.03em", lineHeight: 1,
        }}>
          {pct}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: "#8c909f" }}>/ 100</span>
      </div>

      {/* Formula breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {layers.filter(l => l.id !== "risk").map((l) => {
          const contribution = l.score * l.weight;
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: "#8c909f", width: 70, textTransform: "uppercase",
              }}>
                {l.shortName.slice(0, 6)}
              </span>
              <div style={{ flex: 1, height: 4, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${l.score * 100}%`, height: "100%",
                  background: statusColor[l.status],
                  borderRadius: 2,
                }} />
              </div>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: statusColor[l.status], width: 35, textAlign: "right",
                fontWeight: 600,
              }}>
                {(l.score * 100).toFixed(0)}%
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: "#666", width: 20, textAlign: "right",
              }}>
                ×{(l.weight * 100).toFixed(0)}
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: "#e6e1e5", width: 40, textAlign: "right",
                fontWeight: 600,
              }}>
                +{(contribution * 100).toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Risk gate */}
      <div style={{
        marginTop: 16, paddingTop: 12,
        borderTop: "1px solid rgba(72,72,73,0.12)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#9cff93" }}>verified_user</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9cff93", fontWeight: 600 }}>
          RISK GATE: ALLOW
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>
          Threshold: 75.0
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const [layers, setLayers] = useState<PipelineLayer[]>(LAYERS);
  const [signals, setSignals] = useState<PipelineSignal[]>(() => Array.from({ length: 8 }, (_, i) => generateSignal(i)));
  const [consoleEntries] = useState<ConsoleEntry[]>(generateConsoleEntries);
  const [activeLayer, setActiveLayer] = useState<string | null>("structure");
  const [view, setView] = useState<"pipeline" | "signals" | "console">("pipeline");

  // Simulate live layer updates
  useEffect(() => {
    const iv = setInterval(() => {
      setLayers((prev) =>
        prev.map((l) => ({          ...l,
          score: Math.min(1, Math.max(0.3, l.score + (Math.random() - 0.48) * 0.04)),
          latencyMs: Math.max(1, l.latencyMs + Math.floor((Math.random() - 0.5) * 10)),
          lastUpdate: Date.now(),
        }))
      );
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  const totalLatency = layers.reduce((s, l) => s + l.latencyMs, 0);
  const activeNodes = layers.filter((l) => l.status !== "OFFLINE").length;

  return (
    <div style={{ minHeight: "100vh", background: "#131314", color: "#e6e1e5" }}>
      <PipelineHeader totalLatency={totalLatency} activeNodes={activeNodes} />

      {/* View Toggle */}
      <div style={{ padding: "16px 24px 0", display: "flex", gap: 4 }}>
        {(["pipeline", "signals", "console"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              background: view === v ? "rgba(102,157,255,0.12)" : "transparent",
              border: `1px solid ${view === v ? "rgba(102,157,255,0.3)" : "rgba(72,72,73,0.15)"}`,
              borderRadius: 4,
              padding: "8px 18px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: view === v ? "#669dff" : "#8c909f",
              cursor: "pointer",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: view === v ? 600 : 400,
              transition: "all 0.15s ease",
            }}
          >
            {v === "pipeline" ? "Pipeline Layers" : v === "signals" ? "Signal Feed" : "Console"}
          </button>
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {view === "pipeline" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, alignItems: "start" }}>
            {/* Left: Layer stack */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {layers.map((layer, i) => (
                <div key={layer.id}>
                  <LayerCard
                    layer={layer}
                    isActive={activeLayer === layer.id}
                    onClick={() => setActiveLayer(activeLayer === layer.id ? null : layer.id)}
                  />
                  {i < layers.length - 1 && <PipelineConnector />}
                </div>
              ))}
            </div>

            {/* Right: Composite + stats */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 24 }}>
              <CompositeScorePanel layers={layers} />

              {/* Pipeline formula */}
              <div style={{
                background: "#1a191b",
                border: "1px solid rgba(72,72,73,0.15)",
                borderRadius: 6,
                padding: "16px 20px",
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: "#8c909f", letterSpacing: "0.08em", marginBottom: 10,
                  textTransform: "uppercase",
                }}>
                  Scoring Formula
                </div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: "#669dff", lineHeight: 1.8,
                  padding: "10px 14px",
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: 4,
                }}>
                  <div>Q = 0.30×STRUCT + 0.25×OFLOW</div>
                  <div style={{ paddingLeft: 20 }}>+ 0.20×RECALL + 0.15×ML</div>
                  <div style={{ paddingLeft: 20 }}>+ 0.10×CLAUDE</div>
                  <div style={{ marginTop: 8, color: "#9cff93" }}>IF Q ≥ 0.75 AND RISK=ALLOW → TRADE</div>
                </div>
              </div>

              {/* Quick stats */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
              }}>
                {[
                  { label: "Signals Today", value: "23", color: "#669dff" },
                  { label: "Trades Executed", value: "4", color: "#9cff93" },
                  { label: "Pass Rate", value: "82.6%", color: "#ffd166" },                  { label: "Avg Latency", value: formatLatency(Math.round(totalLatency / layers.length)), color: "#e6e1e5" },
                ].map((stat) => (
                  <div key={stat.label} style={{
                    background: "#1a191b",
                    border: "1px solid rgba(72,72,73,0.15)",
                    borderRadius: 6,
                    padding: "14px 16px",
                  }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {stat.label}
                    </div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: stat.color, marginTop: 4 }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === "signals" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 8, textTransform: "uppercase" }}>
              Recent Signal Candidates ({signals.length})
            </div>
            {signals.map((sig) => (
              <SignalCard key={sig.id} signal={sig} />
            ))}
          </div>
        )}

        {view === "console" && (
          <ConsoleLog entries={consoleEntries} />
        )}
      </div>
    </div>
  );
}