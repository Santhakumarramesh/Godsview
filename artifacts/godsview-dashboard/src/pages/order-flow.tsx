import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const cardStyle: React.CSSProperties = {
  backgroundColor: "#1a191b",
  border: "1px solid rgba(72,72,73,0.2)",
  borderRadius: "12px",
  padding: "24px",
};

const strengthColor = (s: string) => {
  if (s === "high_conviction") return "#00ff88";
  if (s === "strong") return "#9cff93";
  if (s === "neutral") return "#ffcc00";
  return "#ff6464";
};

const scoreColor = (v: number) => {
  if (v >= 76) return "#00ff88";
  if (v >= 61) return "#9cff93";
  if (v >= 41) return "#ffcc00";
  return "#ff6464";
};

const ScoreGauge = ({ label, score, max = 100 }: { label: string; score: number; max?: number }) => {
  const pct = Math.min((score / max) * 100, 100);
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ccc" }}>{label}</span>
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: scoreColor(score) }}>
          {score.toFixed(0)}
        </span>
      </div>
      <div style={{ height: "8px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: scoreColor(score),
            borderRadius: "4px",
            transition: "width 0.5s ease",
          }}
        />
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, color = "#ffffff", sub = "" }: { label: string; value: string | number; color?: string; sub?: string }) => (
  <div style={cardStyle}>
    <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#9cff93", margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>
      {label}
    </p>
    <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "22px", color, margin: 0 }}>
      {value}
    </p>
    {sub && <p style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: "#767576", margin: "4px 0 0 0" }}>{sub}</p>}
  </div>
);

const SymbolFlowCard = ({ symbol, data }: { symbol: string; data: any }) => {
  const [direction, setDirection] = useState<"long" | "short">("long");
  const scoreData = direction === "long" ? data.long_score : data.short_score;
  const threshold = data.threshold_paper || 60;

  if (!scoreData) {
    return (
      <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
        <p style={{ color: "#767576" }}>No score data for {symbol}</p>
      </div>
    );
  }

  const passesGate = scoreData.total >= threshold;

  return (
    <div style={{ ...cardStyle, position: "relative", overflow: "hidden" }}>
      {/* Glow border for high scores */}
      {passesGate && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "3px",
          background: `linear-gradient(90deg, ${scoreColor(scoreData.total)}, transparent)`,
        }} />
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3 style={{ fontFamily: "Space Grotesk", fontSize: "18px", color: "#fff", margin: "0 0 4px 0" }}>
            {symbol}
          </h3>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576", margin: 0 }}>
            {data.timeframe} | ${data.price?.toLocaleString()}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setDirection("long")}
            style={{
              padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
              fontFamily: "Space Grotesk", border: "none",
              backgroundColor: direction === "long" ? "#9cff93" : "#2a2a2b",
              color: direction === "long" ? "#000" : "#aaa",
            }}
          >
            LONG
          </button>
          <button
            onClick={() => setDirection("short")}
            style={{
              padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
              fontFamily: "Space Grotesk", border: "none",
              backgroundColor: direction === "short" ? "#ff6464" : "#2a2a2b",
              color: direction === "short" ? "#fff" : "#aaa",
            }}
          >
            SHORT
          </button>
        </div>
      </div>

      {/* Composite Score */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
        <div style={{
          width: "80px", height: "80px", borderRadius: "50%",
          border: `4px solid ${scoreColor(scoreData.total)}`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.3)",
        }}>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: scoreColor(scoreData.total), fontWeight: "bold" }}>
            {scoreData.total}
          </span>
        </div>
        <div>
          <p style={{
            fontFamily: "Space Grotesk", fontSize: "14px", margin: "0 0 4px 0",
            color: strengthColor(scoreData.strength),
            textTransform: "uppercase", fontWeight: "bold",
          }}>
            {scoreData.strength?.replace("_", " ")}
          </p>
          <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", margin: "0 0 2px 0" }}>
            Bias: <span style={{ color: scoreData.bias === "bullish" ? "#9cff93" : scoreData.bias === "bearish" ? "#ff6464" : "#ffcc00" }}>
              {scoreData.bias?.toUpperCase()}
            </span>
          </p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: passesGate ? "#9cff93" : "#ff6464", margin: 0 }}>
            {passesGate ? `PASSES GATE (>=${threshold})` : `BELOW GATE (<${threshold})`}
          </p>
        </div>
      </div>

      {/* Score Breakdown */}
      <div style={{ marginBottom: "16px" }}>
        <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", margin: "0 0 8px 0", textTransform: "uppercase" }}>
          Score Breakdown (OHLCV Proxy)
        </p>
        <ScoreGauge label="Delta / Pressure (25%)" score={scoreData.delta || 0} />
        <ScoreGauge label="Volume Spike (20%)" score={scoreData.volume_spike || 0} />
        <ScoreGauge label="Absorption (20%)" score={scoreData.absorption || 0} />
        <ScoreGauge label="Imbalance (20%)" score={scoreData.imbalance || 0} />
        <ScoreGauge label="Sweep / Trapped (15%)" score={scoreData.sweep_trapped || 0} />
      </div>

      {/* Confirmations & Warnings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#9cff93", margin: "0 0 6px 0" }}>
            Confirmations
          </p>
          {(scoreData.confirmations || []).length > 0 ? (
            (scoreData.confirmations || []).map((c: string, i: number) => (
              <p key={i} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#9cff93", margin: "0 0 3px 0", opacity: 0.8 }}>
                + {c}
              </p>
            ))
          ) : (
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#555", margin: 0 }}>None</p>
          )}
        </div>
        <div>
          <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#ff6464", margin: "0 0 6px 0" }}>
            Warnings
          </p>
          {(scoreData.warnings || []).length > 0 ? (
            (scoreData.warnings || []).map((w: string, i: number) => (
              <p key={i} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#ff6464", margin: "0 0 3px 0", opacity: 0.8 }}>
                ! {w}
              </p>
            ))
          ) : (
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#555", margin: 0 }}>None</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default function OrderFlow() {
  // Fetch from signal engine's /order-flow endpoint
  const { data: flowData, isLoading, error } = useQuery({
    queryKey: ["order-flow-live"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signal-engine/order-flow`);
      if (!res.ok) throw new Error("Signal engine order flow unavailable");
      return res.json();
    },
    refetchInterval: 30000, // refresh every 30s
  });

  // Also fetch BOS scan log for recent order flow history
  const { data: bosLog = [] } = useQuery({
    queryKey: ["bos-log-of"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signal-engine/bos-log?limit=50`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Extract order flow history from BOS log
  const ofHistory = useMemo(() => {
    return (bosLog || [])
      .filter((e: any) => e.order_flow && !e.order_flow.error)
      .slice(-20)
      .map((e: any) => ({
        symbol: e.symbol,
        time: e.timestamp,
        longScore: e.order_flow.long_score,
        shortScore: e.order_flow.short_score,
        bias: e.order_flow.bias,
      }));
  }, [bosLog]);

  const symbols = flowData ? Object.keys(flowData).filter(k => !flowData[k]?.error) : [];

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Order Flow Intelligence
          </h1>
          <p style={{ color: "#767576", fontSize: "14px", margin: 0 }}>
            Advanced composite scoring: delta, absorption, imbalance, liquidity sweeps, trapped traders
            <span style={{ color: "#ffcc00", marginLeft: "8px", fontSize: "11px" }}>OHLCV PROXY</span>
          </p>
        </div>

        {/* Loading / Error */}
        {isLoading && (
          <div style={{ color: "#767576", fontFamily: "Space Grotesk", padding: "40px 0" }}>
            Fetching live order flow analysis from signal engine...
          </div>
        )}
        {error && (
          <div style={{ ...cardStyle, marginBottom: "24px", borderColor: "#ff6464" }}>
            <p style={{ color: "#ff6464", fontFamily: "Space Grotesk", margin: 0 }}>
              Signal engine not reachable — order flow requires live engine on port 8099
            </p>
          </div>
        )}

        {/* Summary Row */}
        {symbols.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            {symbols.map(sym => {
              const d = flowData[sym];
              const best = Math.max(d.long_score?.total || 0, d.short_score?.total || 0);
              const bestDir = (d.long_score?.total || 0) >= (d.short_score?.total || 0) ? "LONG" : "SHORT";
              return (
                <MetricCard
                  key={sym}
                  label={`${sym} BEST`}
                  value={best.toFixed(0)}
                  color={scoreColor(best)}
                  sub={`${bestDir} | ${d.long_score?.bias?.toUpperCase() || "?"}`}
                />
              );
            })}
            <MetricCard
              label="GATE THRESHOLD"
              value="60"
              color="#ffcc00"
              sub="Paper mode minimum"
            />
            <MetricCard
              label="DATA TYPE"
              value="PROXY"
              color="#767576"
              sub="OHLCV-based estimation"
            />
          </div>
        )}

        {/* Per-Symbol Flow Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "24px", marginBottom: "24px" }}>
          {symbols.map(sym => (
            <SymbolFlowCard key={sym} symbol={sym} data={flowData[sym]} />
          ))}
        </div>

        {/* Order Flow Score History from BOS Log */}
        {ofHistory.length > 0 && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", margin: "0 0 16px 0" }}>
              Recent Order Flow Score History
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "JetBrains Mono, monospace", fontSize: "11px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.3)" }}>
                    <th style={{ textAlign: "left", padding: "8px", color: "#767576" }}>Time</th>
                    <th style={{ textAlign: "left", padding: "8px", color: "#767576" }}>Symbol</th>
                    <th style={{ textAlign: "right", padding: "8px", color: "#9cff93" }}>Long Score</th>
                    <th style={{ textAlign: "right", padding: "8px", color: "#ff6464" }}>Short Score</th>
                    <th style={{ textAlign: "center", padding: "8px", color: "#767576" }}>Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {ofHistory.map((row: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                      <td style={{ padding: "6px 8px", color: "#aaa" }}>
                        {new Date(row.time).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#fff" }}>{row.symbol}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: scoreColor(row.longScore) }}>
                        {row.longScore?.toFixed(0)}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: scoreColor(row.shortScore) }}>
                        {row.shortScore?.toFixed(0)}
                      </td>
                      <td style={{
                        padding: "6px 8px", textAlign: "center",
                        color: row.bias === "bullish" ? "#9cff93" : row.bias === "bearish" ? "#ff6464" : "#ffcc00",
                      }}>
                        {row.bias?.toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
