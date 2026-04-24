import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type Liquidity = {
  symbol: string;
  spread: number;
  depth: number;
  participationRate: number;
  sessionScore: number;
};

const COLORS = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  bearish: "#ff6b6b",
  warning: "#ffd700",
};

export default function LiquidityEnvironmentPage() {
  const { data: orderbookData, isLoading: obLoading, error: obError } = useQuery({
    queryKey: ["market", "orderbook"],
    queryFn: () => fetch(`${API}/api/market/orderbook`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: liquidityData, isLoading: lqLoading, error: lqError } = useQuery({
    queryKey: ["features", "liquidity"],
    queryFn: () => fetch(`${API}/api/features/liquidity`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const isLoading = obLoading || lqLoading;
  const error = obError || lqError;

  const orderbook = orderbookData?.data || {};
  const liquidity: Liquidity[] = liquidityData?.instruments || [];

  const spreadColor = (spread: number) => {
    if (spread < 0.01) return COLORS.accent;
    if (spread < 0.05) return COLORS.warning;
    return COLORS.bearish;
  };

  const depthColor = (depth: number) => {
    if (depth > 1000000) return COLORS.accent;
    if (depth > 100000) return COLORS.warning;
    return COLORS.bearish;
  };

  const metrics = useMemo(() => {
    if (!orderbook || !liquidity.length) return null;
    const avgSpread = orderbook.avgSpread || 0;
    const totalDepth = orderbook.totalDepth || 0;
    const avgParticipation = liquidity.reduce((sum, l) => sum + l.participationRate, 0) / liquidity.length;
    const avgScore = liquidity.reduce((sum, l) => sum + l.sessionScore, 0) / liquidity.length;
    return { avgSpread, totalDepth, avgParticipation, avgScore };
  }, [orderbook, liquidity]);

  const sessionHealth = useMemo(() => {
    if (!metrics) return "unknown";
    if (metrics.avgScore > 0.8 && metrics.avgSpread < 0.02) return "excellent";
    if (metrics.avgScore > 0.6 && metrics.avgSpread < 0.05) return "good";
    if (metrics.avgScore > 0.4) return "moderate";
    return "poor";
  }, [metrics]);

  const hasData = liquidity.length > 0 && orderbook.avgSpread !== undefined;

  if (error) {
    return (
      <div style={{ background: COLORS.bg, color: COLORS.text, minHeight: "100vh", padding: "24px" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "8px" }}>
          Liquidity Environment
        </h1>
        <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, marginBottom: "24px" }}>
          Assess market tradability and liquidity conditions across instruments
        </p>
        <div style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.bearish}`,
          borderRadius: "12px",
          padding: "24px",
          textAlign: "center",
        }}>
          <p style={{ color: COLORS.bearish, fontFamily: "Space Grotesk", marginBottom: "8px" }}>
            Unable to load liquidity data
          </p>
          <p style={{ color: COLORS.muted, fontSize: "13px" }}>
            {error instanceof Error ? error.message : "Please try again in a moment"}
          </p>
        </div>
      </div>
    );
  }

  if (!hasData && !isLoading) {
    return (
      <div style={{ background: COLORS.bg, color: COLORS.text, minHeight: "100vh", padding: "24px" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "8px" }}>
          Liquidity Environment
        </h1>
        <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, marginBottom: "24px" }}>
          Assess market tradability and liquidity conditions across instruments
        </p>
        <div style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "12px",
          padding: "48px 24px",
          textAlign: "center",
        }}>
          <p style={{ color: COLORS.muted, fontFamily: "Space Grotesk" }}>
            No liquidity data available
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "8px" }}>
        Liquidity Environment
      </h1>
      <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, marginBottom: "24px" }}>
        Assess market tradability and liquidity conditions across instruments
      </p>

      {/* Loading State */}
      {isLoading && (
        <div style={{ marginBottom: "24px", color: COLORS.muted, fontFamily: "Space Grotesk", fontSize: "13px" }}>
          Loading market data...
        </div>
      )}

      {/* Key Metrics Stats Bar */}
      {metrics && !isLoading && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}>
          <div style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "20px",
          }}>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: COLORS.muted, marginBottom: "8px" }}>
              AVG SPREAD
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "22px", color: spreadColor(metrics.avgSpread), marginBottom: "4px" }}>
              {(metrics.avgSpread * 100).toFixed(2)}%
            </p>
            <div style={{
              height: "4px",
              backgroundColor: "rgba(72,72,73,0.3)",
              borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, (1 - metrics.avgSpread * 100) * 100)}%`,
                backgroundColor: spreadColor(metrics.avgSpread),
              }} />
            </div>
          </div>

          <div style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "20px",
          }}>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: COLORS.muted, marginBottom: "8px" }}>
              BOOK DEPTH
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "22px", color: depthColor(metrics.totalDepth), marginBottom: "4px" }}>
              ${(metrics.totalDepth / 1000000).toFixed(1)}M
            </p>
            <div style={{
              height: "4px",
              backgroundColor: "rgba(72,72,73,0.3)",
              borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, (metrics.totalDepth / 5000000) * 100)}%`,
                backgroundColor: depthColor(metrics.totalDepth),
              }} />
            </div>
          </div>

          <div style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "20px",
          }}>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: COLORS.muted, marginBottom: "8px" }}>
              PARTICIPATION
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "22px", color: COLORS.accent, marginBottom: "4px" }}>
              {(metrics.avgParticipation * 100).toFixed(1)}%
            </p>
            <div style={{
              height: "4px",
              backgroundColor: "rgba(72,72,73,0.3)",
              borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${metrics.avgParticipation * 100}%`,
                backgroundColor: COLORS.accent,
              }} />
            </div>
          </div>

          <div style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "20px",
          }}>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: COLORS.muted, marginBottom: "8px" }}>
              LIQUIDITY SCORE
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "22px", color: COLORS.accent, marginBottom: "4px" }}>
              {(metrics.avgScore * 100).toFixed(0)}%
            </p>
            <div style={{
              height: "4px",
              backgroundColor: "rgba(72,72,73,0.3)",
              borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${metrics.avgScore * 100}%`,
                backgroundColor: COLORS.accent,
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Session Liquidity Indicator */}
      {sessionHealth && !isLoading && (
        <div style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "12px",
          padding: "16px 20px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}>
          <div style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            backgroundColor:
              sessionHealth === "excellent" ? COLORS.accent :
              sessionHealth === "good" ? COLORS.warning :
              sessionHealth === "moderate" ? "#ff9f43" :
              COLORS.bearish,
          }} />
          <p style={{
            fontFamily: "Space Grotesk",
            fontSize: "13px",
            color: COLORS.muted,
          }}>
            Session Liquidity: <span style={{ color: COLORS.text, fontWeight: "bold" }}>
              {sessionHealth.charAt(0).toUpperCase() + sessionHealth.slice(1)}
            </span> - Market is {sessionHealth === "excellent" || sessionHealth === "good" ? "highly" : "moderately"} tradable
          </p>
        </div>
      )}

      {/* Depth Visualization */}
      <div style={{
        backgroundColor: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: "12px",
        padding: "24px",
        marginBottom: "24px",
        height: "220px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: isLoading ? 0.6 : 1,
      }}>
        <svg viewBox="0 0 500 160" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="depthGrad" x1="0%" x2="100%">
              <stop offset="0%" stopColor={COLORS.accent} stopOpacity="0.4" />
              <stop offset="100%" stopColor={COLORS.bearish} stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <line x1="0" y1="150" x2="500" y2="150" stroke={COLORS.border} strokeWidth="1" />
          {[...Array(6)].map((_, i) => (
            <g key={i}>
              <line x1={i * 83} y1="145" x2={i * 83} y2="150" stroke={COLORS.border} strokeWidth="1" />
              <text x={i * 83} y="158" fontSize="10" fill={COLORS.muted} textAnchor="middle">
                {i * 20}%
              </text>
            </g>
          ))}
          <path
            d="M 0 150 Q 60 100 125 60 T 250 30 T 375 80 T 500 150 Z"
            fill="url(#depthGrad)"
          />
          <text x="250" y="25" fontSize="12" fill={COLORS.muted} textAnchor="middle" fontFamily="JetBrains Mono">
            Market Depth Distribution
          </text>
        </svg>
      </div>

      {/* Instrument Liquidity Table */}
      <div style={{
        backgroundColor: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: "12px",
        padding: "24px",
        overflowX: "auto",
        opacity: isLoading ? 0.6 : 1,
      }}>
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px", color: COLORS.text }}>
          Instrument Liquidity
        </h2>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "13px",
        }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              <th style={{ padding: "12px", textAlign: "left", color: COLORS.muted, fontWeight: "500" }}>Symbol</th>
              <th style={{ padding: "12px", textAlign: "right", color: COLORS.muted, fontWeight: "500" }}>Spread</th>
              <th style={{ padding: "12px", textAlign: "right", color: COLORS.muted, fontWeight: "500" }}>Depth</th>
              <th style={{ padding: "12px", textAlign: "right", color: COLORS.muted, fontWeight: "500" }}>Part. Rate</th>
              <th style={{ padding: "12px", textAlign: "right", color: COLORS.muted, fontWeight: "500" }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {liquidity.slice(0, 20).map((l, i) => (
              <tr key={i} style={{
                borderBottom: `1px solid ${COLORS.border}`,
                backgroundColor: i % 2 === 0 ? "rgba(72,72,73,0.05)" : "transparent",
              }}>
                <td style={{ padding: "12px", fontWeight: "bold", color: COLORS.accent }}>
                  {l.symbol}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: spreadColor(l.spread) }}>
                  {(l.spread * 100).toFixed(2)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: depthColor(l.depth) }}>
                  ${(l.depth / 1000000).toFixed(1)}M
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: COLORS.text }}>
                  {(l.participationRate * 100).toFixed(1)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: COLORS.accent }}>
                  {(l.sessionScore * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
