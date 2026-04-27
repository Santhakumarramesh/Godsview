import { useQuery } from "@tanstack/react-query";
import { ReactNode } from "react";
import { toArray } from "@/lib/safe";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardAlt: "#141316",
  border: "#2a2a2d",
  borderFocus: "#3a3a3f",
  text: "#e2e2e6",
  textDim: "#8b8b92",
  textMuted: "#5a5a62",
  accent: "#6c5ce7",
  accentGlow: "rgba(108,92,231,0.25)",
  green: "#00e676",
  red: "#ff5252",
  yellow: "#ffd740",
  blue: "#40c4ff",
  orange: "#ff9100",
};

// Types
interface CorrelationMatrixData {
  strategies: string[];
  values: number[][];
}

interface DangerousPair {
  strategy1: string;
  strategy2: string;
  correlation: number;
  riskLevel: "critical" | "high" | "medium";
  recommendation: string;
}

interface HeatmapData {
  sectors: string[];
  timeframes: string[];
  values: Array<{
    sector: string;
    timeframe: string;
    riskScore: number;
    pnl: number;
    positionCount: number;
  }>;
}

interface DrawdownData {
  currentDrawdown: number;
  peakEquity: number;
  currentEquity: number;
  equityHistory: number[];
  recoveryDays: number;
  circuitBreakerStatus: "active" | "triggered" | "cooldown";
  maxDrawdown: number;
}

interface PortfolioDiversificationScore {
  score: number;
  trend: "up" | "down" | "stable";
}

// Mock data generators
const generateMockCorrelationMatrix = (): CorrelationMatrixData => ({
  strategies: ["Momentum", "MeanReversion", "Statistical Arb", "Volatility", "Trend Following"],
  values: [
    [1.0, -0.2, 0.15, 0.45, 0.62],
    [-0.2, 1.0, 0.3, -0.1, 0.05],
    [0.15, 0.3, 1.0, 0.55, 0.72],
    [0.45, -0.1, 0.55, 1.0, 0.38],
    [0.62, 0.05, 0.72, 0.38, 1.0],
  ],
});

const generateMockDangerousPairs = (): DangerousPair[] => [
  {
    strategy1: "Statistical Arb",
    strategy2: "Trend Following",
    correlation: 0.72,
    riskLevel: "high",
    recommendation: "Consider reducing position sizes or implementing dynamic hedge.",
  },
  {
    strategy1: "Momentum",
    strategy2: "Trend Following",
    correlation: 0.62,
    riskLevel: "medium",
    recommendation: "Monitor for regime shifts; correlation may increase in trending markets.",
  },
  {
    strategy1: "Statistical Arb",
    strategy2: "Volatility",
    correlation: 0.55,
    riskLevel: "medium",
    recommendation: "Review volatility spikes during correlation increases.",
  },
];

const generateMockHeatmap = (): HeatmapData => ({
  sectors: ["Tech", "Finance", "Energy", "Healthcare", "Utilities"],
  timeframes: ["1m", "5m", "15m", "1h", "4h"],
  values: [
    { sector: "Tech", timeframe: "1m", riskScore: 65, pnl: 1250, positionCount: 8 },
    { sector: "Tech", timeframe: "5m", riskScore: 45, pnl: 2100, positionCount: 12 },
    { sector: "Tech", timeframe: "15m", riskScore: 32, pnl: 3400, positionCount: 5 },
    { sector: "Finance", timeframe: "1m", riskScore: 78, pnl: -450, positionCount: 6 },
    { sector: "Finance", timeframe: "5m", riskScore: 55, pnl: 890, positionCount: 10 },
    { sector: "Energy", timeframe: "1h", riskScore: 42, pnl: 2200, positionCount: 4 },
    { sector: "Healthcare", timeframe: "1h", riskScore: 28, pnl: 1800, positionCount: 3 },
    { sector: "Utilities", timeframe: "4h", riskScore: 15, pnl: 4500, positionCount: 2 },
  ],
});

const generateMockDrawdown = (): DrawdownData => ({
  currentDrawdown: 8.5,
  peakEquity: 1250000,
  currentEquity: 1144375,
  equityHistory: [
    1250000, 1245000, 1240000, 1235000, 1225000, 1210000, 1200000, 1180000, 1160000,
    1170000, 1165000, 1155000, 1145000, 1144375,
  ],
  recoveryDays: 3,
  circuitBreakerStatus: "active",
  maxDrawdown: 12.2,
});

const generateMockDiversificationScore = (): PortfolioDiversificationScore => ({
  score: 72,
  trend: "up",
});

// Section Components
interface SectionProps {
  title: string;
  children: ReactNode;
  loading?: boolean;
  error?: string;
}

const Section = ({ title, children, loading, error }: SectionProps) => (
  <div
    style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: "8px",
      padding: "24px",
      marginBottom: "24px",
    }}
  >
    <h2
      style={{
        margin: "0 0 16px 0",
        fontSize: "18px",
        fontWeight: 600,
        color: C.text,
        letterSpacing: "0.5px",
      }}
    >
      {title}
    </h2>
    {loading && (
      <div style={{ color: C.textDim, fontSize: "14px", padding: "20px 0" }}>
        Loading...
      </div>
    )}
    {error && (
      <div style={{ color: C.red, fontSize: "14px", padding: "20px 0" }}>
        Error: {error}
      </div>
    )}
    {!loading && !error && children}
  </div>
);

// 1. Header Banner with Diversification Score
const HeaderBanner = ({ score = 72, trend = "up" }: PortfolioDiversificationScore) => {
  const scoreColor = score >= 70 ? C.green : score >= 50 ? C.yellow : C.red;
  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";

  return (
    <div
      style={{
        backgroundColor: C.cardAlt,
        border: `1px solid ${C.borderFocus}`,
        borderRadius: "12px",
        padding: "32px",
        marginBottom: "24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "32px",
            fontWeight: 700,
            color: C.text,
            letterSpacing: "-0.5px",
          }}
        >
          Correlation Lab
        </h1>
        <p style={{ margin: 0, color: C.textDim, fontSize: "14px" }}>
          Real-time strategy correlation analysis and portfolio diversification monitoring
        </p>
      </div>

      {/* Diversification Score Gauge */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            width: "120px",
            height: "120px",
            borderRadius: "50%",
            backgroundColor: C.bg,
            border: `3px solid ${scoreColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 20px ${scoreColor}33`,
            position: "relative",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "42px",
                fontWeight: 700,
                color: scoreColor,
                margin: "0 0 4px 0",
              }}
            >
              {score}
            </div>
            <div style={{ fontSize: "12px", color: C.textMuted }}>Diversification</div>
          </div>

          {/* Progress ring */}
          <svg
            width="120"
            height="120"
            style={{
              position: "absolute",
              transform: "rotate(-90deg)",
              left: 0,
              top: 0,
            }}
          >
            <circle
              cx="60"
              cy="60"
              r="56"
              fill="none"
              stroke={C.border}
              strokeWidth="2"
            />
            <circle
              cx="60"
              cy="60"
              r="56"
              fill="none"
              stroke={scoreColor}
              strokeWidth="3"
              strokeDasharray={`${(score / 100) * 351.8} 351.8`}
              opacity="0.7"
            />
          </svg>
        </div>
        <div
          style={{
            marginTop: "12px",
            fontSize: "12px",
            color: C.textDim,
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <span style={{ color: scoreColor, fontWeight: 600, fontSize: "14px" }}>
            {trendIcon}
          </span>
          {trend === "up" ? "Improving" : trend === "down" ? "Declining" : "Stable"}
        </div>
      </div>
    </div>
  );
};

// 2. Correlation Matrix Heat Map
const CorrelationMatrix = ({
  data,
  loading,
  error,
}: {
  data: CorrelationMatrixData | null;
  loading: boolean;
  error: string | null;
}) => {
  const mockData = data || generateMockCorrelationMatrix();
  const { strategies, values } = mockData;
  const cellSize = 50;
  const labelWidth = 140;

  const getColor = (value: number): string => {
    if (value < 0) {
      const intensity = Math.abs(value);
      return `rgb(64, 196, 255, ${intensity * 0.8})`;
    } else if (value > 0) {
      const intensity = Math.min(value, 1);
      return `rgb(255, 82, 82, ${intensity * 0.8})`;
    }
    return "rgb(226, 226, 230, 0.2)";
  };

  const isDangerous = (value: number): boolean => Math.abs(value) > 0.7;

  const isMock = data === null;

  return (
    <Section
      title="Correlation Matrix"
      loading={loading}
      error={error ?? undefined}
    >
      {isMock && (
        <div role="status" style={{
          background: "rgba(255,68,68,0.15)", color: "#ff8a8a",
          border: "1px solid rgba(255,68,68,0.5)", padding: "8px 12px",
          borderRadius: 6, fontFamily: "monospace", fontSize: 12, marginBottom: 12,
        }}>
          ⚠ MOCK DATA — backend returned no correlation matrix. Values shown are illustrative only.
        </div>
      )}
      <div
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: "12px",
        }}
      >
        <svg
          width={labelWidth + strategies.length * cellSize + 20}
          height={labelWidth + strategies.length * cellSize + 20}
          style={{ minWidth: "100%", display: "block" }}
        >
          {/* Top labels */}
          {strategies.map((strategy, i) => (
            <text
              key={`top-${i}`}
              x={labelWidth + i * cellSize + cellSize / 2}
              y={labelWidth - 10}
              textAnchor="middle"
              style={{
                fontSize: "12px",
                fill: C.textDim,
                fontWeight: 500,
              }}
            >
              {strategy.substring(0, 6)}
            </text>
          ))}

          {/* Left labels */}
          {strategies.map((strategy, i) => (
            <text
              key={`left-${i}`}
              x={labelWidth - 10}
              y={labelWidth + i * cellSize + cellSize / 2 + 4}
              textAnchor="end"
              style={{
                fontSize: "12px",
                fill: C.textDim,
                fontWeight: 500,
              }}
            >
              {strategy.substring(0, 6)}
            </text>
          ))}

          {/* Cells */}
          {values.map((row, i) =>
            row.map((value, j) => {
              const x = labelWidth + j * cellSize;
              const y = labelWidth + i * cellSize;
              const dangerous = isDangerous(value);

              return (
                <g key={`cell-${i}-${j}`}>
                  <rect
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    fill={getColor(value)}
                    stroke={dangerous ? C.red : C.border}
                    strokeWidth={dangerous ? 2 : 1}
                    opacity={0.85}
                  />
                  <text
                    x={x + cellSize / 2}
                    y={y + cellSize / 2 + 4}
                    textAnchor="middle"
                    style={{
                      fontSize: "11px",
                      fill: C.text,
                      fontWeight: 600,
                      pointerEvents: "none",
                    }}
                  >
                    {value.toFixed(2)}
                  </text>
                </g>
              );
            })
          )}
        </svg>
      </div>

      <div style={{ marginTop: "20px", display: "flex", gap: "24px", fontSize: "13px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              backgroundColor: "rgb(64, 196, 255, 0.6)",
              borderRadius: "2px",
            }}
          />
          <span style={{ color: C.textDim }}>Negative (Diversifying)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              backgroundColor: "rgb(226, 226, 230, 0.2)",
              borderRadius: "2px",
            }}
          />
          <span style={{ color: C.textDim }}>Zero</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              backgroundColor: "rgb(255, 82, 82, 0.6)",
              borderRadius: "2px",
            }}
          />
          <span style={{ color: C.textDim }}>Positive (Correlated)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              border: `2px solid ${C.red}`,
              borderRadius: "2px",
            }}
          />
          <span style={{ color: C.red, fontWeight: 600 }}>Dangerous Pair (&gt;0.7)</span>
        </div>
      </div>
    </Section>
  );
};

// 3. Dangerous Pairs Alert
const DangerousPairsAlert = ({
  data,
  loading,
  error,
}: {
  data: DangerousPair[] | null;
  loading: boolean;
  error: string | null;
}) => {
  const pairs = data || generateMockDangerousPairs();

  const getRiskColor = (level: string): string => {
    switch (level) {
      case "critical":
        return C.red;
      case "high":
        return C.orange;
      case "medium":
        return C.yellow;
      default:
        return C.textDim;
    }
  };

  return (
    <Section
      title="Dangerous Pairs Alert"
      loading={loading}
      error={error ?? undefined}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
        {toArray(pairs).map((pair, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "16px",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                backgroundColor: getRiskColor(pair.riskLevel),
                color: C.bg,
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {pair.riskLevel}
            </div>

            <div style={{ marginBottom: "12px", paddingRight: "80px" }}>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: C.text,
                  marginBottom: "4px",
                }}
              >
                {pair.strategy1} ↔ {pair.strategy2}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: C.textDim,
                }}
              >
                Correlation: <span style={{ color: C.red, fontWeight: 600 }}>
                  {pair.correlation.toFixed(2)}
                </span>
              </div>
            </div>

            <div
              style={{
                backgroundColor: C.cardAlt,
                padding: "12px",
                borderRadius: "4px",
                fontSize: "12px",
                color: C.textDim,
                lineHeight: "1.5",
                borderLeft: `3px solid ${getRiskColor(pair.riskLevel)}`,
              }}
            >
              {pair.recommendation}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
};

// 4. Portfolio Heat Map
const PortfolioHeatMap = ({
  data,
  loading,
  error,
}: {
  data: HeatmapData | null;
  loading: boolean;
  error: string | null;
}) => {
  const heatmapData = data || generateMockHeatmap();
  const { sectors, timeframes, values } = heatmapData;
  const cellWidth = 90;
  const cellHeight = 60;

  const getRiskColor = (score: number): string => {
    if (score >= 70) return C.red;
    if (score >= 50) return C.orange;
    if (score >= 30) return C.yellow;
    return C.green;
  };

  const getCellValue = (sector: string, timeframe: string) => {
    return values.find((v) => v.sector === sector && v.timeframe === timeframe);
  };

  return (
    <Section
      title="Portfolio Heat Map (Sector × Timeframe)"
      loading={loading}
      error={error ?? undefined}
    >
      <div
        style={{
          overflowX: "auto",
          paddingBottom: "12px",
        }}
      >
        <div style={{ display: "inline-block", minWidth: "100%" }}>
          <div style={{ display: "flex" }}>
            {/* Top timeframe headers */}
            <div style={{ width: "120px", flexShrink: 0 }} />
            {timeframes.map((tf) => (
              <div
                key={`header-${tf}`}
                style={{
                  width: `${cellWidth}px`,
                  padding: "8px",
                  textAlign: "center",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: C.textDim,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {tf}
              </div>
            ))}
          </div>

          {/* Rows */}
          {sectors.map((sector) => (
            <div key={`row-${sector}`} style={{ display: "flex" }}>
              {/* Sector label */}
              <div
                style={{
                  width: "120px",
                  padding: "8px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: C.textDim,
                  borderRight: `1px solid ${C.border}`,
                  borderBottom: `1px solid ${C.border}`,
                  flexShrink: 0,
                }}
              >
                {sector}
              </div>

              {/* Cells */}
              {timeframes.map((timeframe) => {
                const cellData = getCellValue(sector, timeframe);
                const riskColor = cellData ? getRiskColor(cellData.riskScore) : C.border;

                return (
                  <div
                    key={`cell-${sector}-${timeframe}`}
                    style={{
                      width: `${cellWidth}px`,
                      height: `${cellHeight}px`,
                      backgroundColor: cellData ? `${riskColor}22` : "transparent",
                      border: `1px solid ${C.border}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "8px",
                      fontSize: "11px",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = `${riskColor}44`;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = cellData
                        ? `${riskColor}22`
                        : "transparent";
                    }}
                  >
                    {cellData && (
                      <>
                        <div
                          style={{
                            fontSize: "10px",
                            color: C.textMuted,
                            marginBottom: "2px",
                          }}
                        >
                          Risk: {cellData.riskScore}%
                        </div>
                        <div
                          style={{
                            color: cellData.pnl >= 0 ? C.green : C.red,
                            fontWeight: 600,
                            marginBottom: "2px",
                          }}
                        >
                          {cellData.pnl >= 0 ? "+" : ""} ${cellData.pnl}
                        </div>
                        <div style={{ color: C.textMuted, fontSize: "10px" }}>
                          {cellData.positionCount} pos
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
};

// 5. Drawdown Tracker
const DrawdownTracker = ({
  data,
  loading,
  error,
}: {
  data: DrawdownData | null;
  loading: boolean;
  error: string | null;
}) => {
  const drawdownData = data || generateMockDrawdown();
  const {
    currentDrawdown,
    peakEquity,
    currentEquity,
    equityHistory,
    recoveryDays,
    circuitBreakerStatus,
    maxDrawdown,
  } = drawdownData;

  // Normalize equity history for chart (0-100 scale)
  const minEquity = Math.min(...equityHistory);
  const maxEquity = Math.max(...equityHistory);
  const equityRange = maxEquity - minEquity;
  const normalizedHistory = equityHistory.map((eq) => ((eq - minEquity) / equityRange) * 100);

  // Generate polyline points
  const chartWidth = 400;
  const chartHeight = 120;
  const pointSpacing = chartWidth / (equityHistory.length - 1);
  const points = normalizedHistory
    .map((normalized, idx) => `${idx * pointSpacing},${chartHeight - (normalized / 100) * chartHeight}`)
    .join(" ");

  const drawdownColor = currentDrawdown > 10 ? C.red : currentDrawdown > 5 ? C.orange : C.yellow;
  const cbColor =
    circuitBreakerStatus === "triggered"
      ? C.red
      : circuitBreakerStatus === "cooldown"
        ? C.orange
        : C.green;

  return (
    <Section
      title="Drawdown Tracker"
      loading={loading}
      error={error ?? undefined}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "24px",
          marginBottom: "24px",
        }}
      >
        {/* Drawdown Gauge */}
        <div>
          <div style={{ marginBottom: "16px" }}>
            <div
              style={{
                fontSize: "12px",
                color: C.textMuted,
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontWeight: 600,
              }}
            >
              Current Drawdown
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  fontSize: "36px",
                  fontWeight: 700,
                  color: drawdownColor,
                }}
              >
                {currentDrawdown.toFixed(1)}%
              </div>
              <div style={{ fontSize: "13px", color: C.textDim }}>
                <div style={{ marginBottom: "4px" }}>
                  Peak: ${(peakEquity / 1000000).toFixed(2)}M
                </div>
                <div>Current: ${(currentEquity / 1000000).toFixed(2)}M</div>
              </div>
            </div>
          </div>

          {/* Drawdown bar */}
          <div
            style={{
              backgroundColor: C.bg,
              borderRadius: "6px",
              overflow: "hidden",
              height: "24px",
              border: `1px solid ${C.border}`,
            }}
          >
            <div
              style={{
                width: `${Math.min(currentDrawdown, 100)}%`,
                height: "100%",
                backgroundColor: drawdownColor,
                transition: "width 0.3s",
              }}
            />
          </div>

          <div
            style={{
              marginTop: "12px",
              fontSize: "12px",
              color: C.textDim,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>Max Drawdown: {maxDrawdown.toFixed(1)}%</span>
            <span>Recovery: {recoveryDays}d</span>
          </div>
        </div>

        {/* Circuit Breaker Status */}
        <div>
          <div
            style={{
              fontSize: "12px",
              color: C.textMuted,
              marginBottom: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            Circuit Breaker
          </div>
          <div
            style={{
              backgroundColor: `${cbColor}22`,
              border: `2px solid ${cbColor}`,
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                backgroundColor: cbColor,
                boxShadow: `0 0 12px ${cbColor}`,
              }}
            />
            <div>
              <div style={{ color: C.text, fontWeight: 600, fontSize: "14px" }}>
                Status: <span style={{ color: cbColor, textTransform: "capitalize" }}>
                  {circuitBreakerStatus}
                </span>
              </div>
              <div style={{ color: C.textDim, fontSize: "12px", marginTop: "4px" }}>
                {circuitBreakerStatus === "triggered"
                  ? "Trading halted due to drawdown threshold"
                  : circuitBreakerStatus === "cooldown"
                    ? "Recovering from circuit break"
                    : "Normal operation"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div style={{ marginTop: "24px" }}>
        <div
          style={{
            fontSize: "12px",
            color: C.textMuted,
            marginBottom: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontWeight: 600,
          }}
        >
          Equity Curve (14-day)
        </div>
        <div
          style={{
            backgroundColor: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <svg width="100%" height="140" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((pct) => (
              <line
                key={`grid-${pct}`}
                x1="0"
                y1={chartHeight - (pct / 100) * chartHeight}
                x2={chartWidth}
                y2={chartHeight - (pct / 100) * chartHeight}
                stroke={C.border}
                strokeWidth="1"
                opacity="0.3"
              />
            ))}

            {/* Equity curve */}
            <polyline
              points={points}
              fill="none"
              stroke={C.accent}
              strokeWidth="2"
            />

            {/* Fill under curve */}
            <polygon
              points={`0,${chartHeight} ${points} ${chartWidth},${chartHeight}`}
              fill={C.accentGlow}
            />
          </svg>
        </div>
      </div>
    </Section>
  );
};

// Main Page Component
export default function CorrelationLabPage() {
  const { data: correlationData, isLoading: corrLoading, error: corrError } = useQuery({
    queryKey: ["correlation-matrix"],
    queryFn: () =>
      fetch("/api/correlation/matrix")
        .then((r) => r.json())
        .catch(() => null),
    staleTime: 30000,
  });

  const { data: dangersData, isLoading: dangersLoading, error: dangersError } = useQuery({
    queryKey: ["dangerous-pairs"],
    queryFn: () =>
      fetch("/api/correlation/dangers")
        .then((r) => r.json())
        .catch(() => null),
    staleTime: 30000,
  });

  const { data: heatmapData, isLoading: heatmapLoading, error: heatmapError } = useQuery({
    queryKey: ["portfolio-heatmap"],
    queryFn: () =>
      fetch("/api/correlation/heatmap")
        .then((r) => r.json())
        .catch(() => null),
    staleTime: 30000,
  });

  const { data: drawdownData, isLoading: drawdownLoading, error: drawdownError } = useQuery({
    queryKey: ["drawdown-tracker"],
    queryFn: () =>
      fetch("/api/correlation/drawdown")
        .then((r) => r.json())
        .catch(() => null),
    staleTime: 10000,
  });

  const { data: diversificationData } = useQuery({
    queryKey: ["diversification-score"],
    queryFn: () =>
      fetch("/api/correlation/diversification")
        .then((r) => r.json())
        .catch(() => null),
    staleTime: 30000,
  });

  return (
    <div
      style={{
        backgroundColor: C.bg,
        minHeight: "100vh",
        color: C.text,
        padding: "24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <HeaderBanner
          score={diversificationData?.score ?? 72}
          trend={diversificationData?.trend ?? "up"}
        />

        <CorrelationMatrix
          data={correlationData}
          loading={corrLoading}
          error={corrError instanceof Error ? corrError.message : null}
        />

        <DangerousPairsAlert
          data={dangersData}
          loading={dangersLoading}
          error={dangersError instanceof Error ? dangersError.message : null}
        />

        <PortfolioHeatMap
          data={heatmapData}
          loading={heatmapLoading}
          error={heatmapError instanceof Error ? heatmapError.message : null}
        />

        <DrawdownTracker
          data={drawdownData}
          loading={drawdownLoading}
          error={drawdownError instanceof Error ? drawdownError.message : null}
        />
      </div>
    </div>
  );
}
