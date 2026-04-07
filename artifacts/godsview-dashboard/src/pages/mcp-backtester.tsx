import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell, AreaChart, Area, CartesianGrid, Legend } from "recharts";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
  gold: "#fbbf24",
  purple: "#a78bfa",
};

// ─── Types ───────────────────────────────────────────────────────────────────
interface MCPBacktestConfig {
  symbol: string;
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  startDate: string;
  endDate: string;
  initialCapital: number;
  runBaseline: boolean;
}

interface MCPSignal {
  barIndex: number;
  symbol: string;
  direction: "long" | "short";
  action: "entry" | "exit";
  grade: "A" | "B" | "C" | "D" | "F";
  overallScore: number;
  pnl?: number;
  holdBars: number;
}

interface MCPBacktestResult {
  runId: string;
  config: MCPBacktestConfig;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  mcpMetrics: {
    totalSignals: number;
    approvedSignals: number;
    rejectedSignals: number;
    filterPercentage: number;
    avgScore: number;
    winRate: number;
    sharpe: number;
    profitFactor: number;
    totalPnL: number;
    maxDrawdown: number;
  };
  baselineMetrics?: {
    winRate: number;
    sharpe: number;
    profitFactor: number;
    totalPnL: number;
    maxDrawdown: number;
  };
  signals: MCPSignal[];
}

// ─── Component: MicroLabel ───────────────────────────────────────────────────
function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "8px",
        fontFamily: "Space Grotesk",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: C.outline,
      }}
    >
      {children}
    </span>
  );
}

// ─── Component: Metric Card ──────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string | number;
  improvement?: number; // null = no comparison, positive = better, negative = worse
  variant?: "primary" | "secondary" | "neutral";
}

function MetricCard({ label, value, improvement, variant = "neutral" }: MetricCardProps) {
  let arrowColor = C.muted;
  let arrowText = "";

  if (improvement !== undefined && improvement !== null) {
    if (improvement > 0) {
      arrowColor = C.primary;
      arrowText = `↑ ${formatPercent(Math.abs(improvement))}`;
    } else if (improvement < 0) {
      arrowColor = C.tertiary;
      arrowText = `↓ ${formatPercent(Math.abs(improvement))}`;
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: "140px",
        padding: "12px 14px",
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "6px",
      }}
    >
      <div style={{ marginBottom: "8px" }}>
        <MicroLabel>{label}</MicroLabel>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span
          style={{
            fontSize: "18px",
            fontWeight: "600",
            fontFamily: "Space Grotesk",
            color: variant === "primary" ? C.primary : variant === "secondary" ? C.secondary : "white",
          }}
        >
          {value}
        </span>
        {arrowText && (
          <span
            style={{
              fontSize: "11px",
              fontFamily: "Space Grotesk",
              color: arrowColor,
              fontWeight: "500",
            }}
          >
            {arrowText}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Component: Comparison Row ───────────────────────────────────────────────
interface ComparisonRowProps {
  result: MCPBacktestResult;
}

function ComparisonRow({ result }: ComparisonRowProps) {
  const calculateImprovement = (mcp: number, baseline?: number): number | null => {
    if (!baseline) return null;
    return (mcp - baseline) / baseline;
  };

  const winRateImprovement = calculateImprovement(
    result.mcpMetrics.winRate / 100,
    result.baselineMetrics ? result.baselineMetrics.winRate / 100 : undefined
  );
  const sharpeImprovement = calculateImprovement(result.mcpMetrics.sharpe, result.baselineMetrics?.sharpe);
  const profitFactorImprovement = calculateImprovement(result.mcpMetrics.profitFactor, result.baselineMetrics?.profitFactor);
  const pnlImprovement = calculateImprovement(result.mcpMetrics.totalPnL, result.baselineMetrics?.totalPnL);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "20px",
        marginBottom: "24px",
      }}
    >
      {/* MCP Filtered */}
      <div
        style={{
          padding: "16px",
          backgroundColor: C.cardHigh,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            marginBottom: "16px",
            paddingBottom: "12px",
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <h3
            style={{
              margin: "0",
              fontSize: "13px",
              fontWeight: "600",
              color: C.primary,
              fontFamily: "Space Grotesk",
            }}
          >
            MCP FILTERED
          </h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <MetricCard label="Win Rate" value={formatPercent(result.mcpMetrics.winRate / 100)} improvement={winRateImprovement} variant="primary" />
          <MetricCard label="Sharpe Ratio" value={formatNumber(result.mcpMetrics.sharpe, 2)} improvement={sharpeImprovement} variant="primary" />
          <MetricCard label="Profit Factor" value={formatNumber(result.mcpMetrics.profitFactor, 2)} improvement={profitFactorImprovement} variant="primary" />
          <MetricCard label="Total PnL" value={formatCurrency(result.mcpMetrics.totalPnL)} improvement={pnlImprovement} variant="primary" />
        </div>
      </div>

      {/* Baseline */}
      {result.baselineMetrics && (
        <div
          style={{
            padding: "16px",
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            opacity: 0.75,
          }}
        >
          <div
            style={{
              marginBottom: "16px",
              paddingBottom: "12px",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <h3
              style={{
                margin: "0",
                fontSize: "13px",
                fontWeight: "600",
                color: C.muted,
                fontFamily: "Space Grotesk",
              }}
            >
              BASELINE (NO FILTER)
            </h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <MetricCard label="Win Rate" value={formatPercent(result.baselineMetrics.winRate / 100)} variant="neutral" />
            <MetricCard label="Sharpe Ratio" value={formatNumber(result.baselineMetrics.sharpe, 2)} variant="neutral" />
            <MetricCard label="Profit Factor" value={formatNumber(result.baselineMetrics.profitFactor, 2)} variant="neutral" />
            <MetricCard label="Total PnL" value={formatCurrency(result.baselineMetrics.totalPnL)} variant="neutral" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component: Filtering Stats ──────────────────────────────────────────────
interface FilteringStatsProps {
  result: MCPBacktestResult;
}

function FilteringStats({ result }: FilteringStatsProps) {
  const stats = [
    { label: "Signals Total", value: result.mcpMetrics.totalSignals },
    { label: "Approved", value: result.mcpMetrics.approvedSignals, color: C.primary },
    { label: "Rejected", value: result.mcpMetrics.rejectedSignals, color: C.tertiary },
    { label: "Filtered %", value: formatPercent(result.mcpMetrics.filterPercentage / 100) },
    { label: "Avg Score", value: formatNumber(result.mcpMetrics.avgScore, 2) },
  ];

  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        marginBottom: "24px",
      }}
    >
      <h3
        style={{
          margin: "0 0 16px 0",
          fontSize: "12px",
          fontWeight: "600",
          color: C.secondary,
          fontFamily: "Space Grotesk",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Filtering Stats
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "12px" }}>
        {stats.map((stat, idx) => (
          <div key={idx}>
            <MicroLabel>{stat.label}</MicroLabel>
            <div
              style={{
                fontSize: "16px",
                fontWeight: "600",
                color: stat.color || "white",
                marginTop: "4px",
                fontFamily: "Space Grotesk",
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Component: Signal Log Table ─────────────────────────────────────────────
interface SignalLogProps {
  signals: MCPSignal[];
  isLoading?: boolean;
}

function SignalLogTable({ signals, isLoading }: SignalLogProps) {
  const displaySignals = signals.slice(0, 50); // Show first 50 for performance

  const getGradeColor = (grade: string): string => {
    switch (grade) {
      case "A":
        return C.primary;
      case "B":
        return C.secondary;
      case "C":
        return C.gold;
      case "D":
        return C.tertiary;
      default:
        return C.muted;
    }
  };

  const getActionColor = (action: string): string => {
    return action === "entry" ? C.primary : C.tertiary;
  };

  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        marginBottom: "24px",
        overflowX: "auto",
      }}
    >
      <h3
        style={{
          margin: "0 0 16px 0",
          fontSize: "12px",
          fontWeight: "600",
          color: C.secondary,
          fontFamily: "Space Grotesk",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Signal Log {signals.length > 50 && `(showing 50 of ${signals.length})`}
      </h3>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "24px", color: C.muted }}>
          <p>Loading signals...</p>
        </div>
      ) : signals.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px", color: C.muted }}>
          <p>No signals generated</p>
        </div>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12px",
            fontFamily: "Space Grotesk",
          }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: "600" }}>Bar</th>
              <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: "600" }}>Symbol</th>
              <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: "600" }}>Dir</th>
              <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: "600" }}>Action</th>
              <th style={{ padding: "8px", textAlign: "left", color: C.outline, fontWeight: "600" }}>Grade</th>
              <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: "600" }}>Score</th>
              <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: "600" }}>PnL</th>
              <th style={{ padding: "8px", textAlign: "right", color: C.outline, fontWeight: "600" }}>Hold</th>
            </tr>
          </thead>
          <tbody>
            {displaySignals.map((sig, idx) => (
              <tr
                key={idx}
                style={{
                  borderBottom: `1px solid ${C.outlineVar}`,
                  backgroundColor: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                }}
              >
                <td style={{ padding: "8px" }}>{sig.barIndex}</td>
                <td style={{ padding: "8px", fontWeight: "500" }}>{sig.symbol}</td>
                <td
                  style={{
                    padding: "8px",
                    color: sig.direction === "long" ? C.primary : C.tertiary,
                    fontWeight: "600",
                  }}
                >
                  {sig.direction === "long" ? "↑" : "↓"}
                </td>
                <td style={{ padding: "8px", color: getActionColor(sig.action) }}>
                  {sig.action.charAt(0).toUpperCase() + sig.action.slice(1)}
                </td>
                <td style={{ padding: "8px", color: getGradeColor(sig.grade), fontWeight: "600" }}>{sig.grade}</td>
                <td style={{ padding: "8px", textAlign: "right", color: C.secondary }}>{formatNumber(sig.overallScore, 2)}</td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: sig.pnl ? (sig.pnl > 0 ? C.primary : C.tertiary) : C.muted,
                  }}
                >
                  {sig.pnl !== undefined ? formatCurrency(sig.pnl) : "—"}
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>{sig.holdBars}b</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Component: Past Runs Sidebar ────────────────────────────────────────────
interface PastRunsProps {
  runs: MCPBacktestResult[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  isLoading?: boolean;
}

function PastRunsSidebar({ runs, selectedRunId, onSelectRun, isLoading }: PastRunsProps) {
  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        maxHeight: "500px",
        overflowY: "auto",
      }}
    >
      <h3
        style={{
          margin: "0 0 12px 0",
          fontSize: "12px",
          fontWeight: "600",
          color: C.secondary,
          fontFamily: "Space Grotesk",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Past Runs
      </h3>

      {isLoading ? (
        <div style={{ color: C.muted, fontSize: "12px" }}>Loading...</div>
      ) : runs.length === 0 ? (
        <div style={{ color: C.muted, fontSize: "12px" }}>No past runs</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {runs.map((run) => (
            <div
              key={run.runId}
              onClick={() => onSelectRun(run.runId)}
              style={{
                padding: "10px",
                backgroundColor: selectedRunId === run.runId ? C.cardHigh : "transparent",
                border: `1px solid ${selectedRunId === run.runId ? C.primary : C.border}`,
                borderRadius: "4px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontWeight: "600", color: "white", fontSize: "12px" }}>{run.config.symbol}</span>
                <span
                  style={{
                    fontSize: "10px",
                    color: run.status === "completed" ? C.primary : run.status === "running" ? C.secondary : C.tertiary,
                    fontWeight: "500",
                  }}
                >
                  {run.status === "completed" ? "✓" : run.status === "running" ? "…" : "✗"}
                </span>
              </div>
              <div style={{ fontSize: "10px", color: C.muted, marginBottom: "4px" }}>
                {run.config.timeframe} • {format(parseISO(run.startedAt), "MMM d, HH:mm")}
              </div>
              {run.status === "completed" && (
                <div style={{ fontSize: "10px", color: C.secondary, fontWeight: "500" }}>
                  Sharpe: {formatNumber(run.mcpMetrics.sharpe, 2)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function MCPBacktesterPage() {
  const [config, setConfig] = useState<MCPBacktestConfig>({
    symbol: "SPY",
    timeframe: "1h",
    startDate: format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    initialCapital: 100000,
    runBaseline: true,
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // ─── Mock: useRunMCPBacktest ────────────────────────────────────────────────
  const runBacktestMutation = useMutation({
    mutationFn: async (cfg: MCPBacktestConfig) => {
      // Simulate API call
      await new Promise((r) => setTimeout(r, 2000));
      const mockResult: MCPBacktestResult = {
        runId: `RUN-${Date.now()}`,
        config: cfg,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        mcpMetrics: {
          totalSignals: 156,
          approvedSignals: 94,
          rejectedSignals: 62,
          filterPercentage: 39.7,
          avgScore: 0.72,
          winRate: 62,
          sharpe: 2.14,
          profitFactor: 2.38,
          totalPnL: 12450,
          maxDrawdown: -2100,
        },
        baselineMetrics: cfg.runBaseline
          ? {
              winRate: 54,
              sharpe: 1.67,
              profitFactor: 1.89,
              totalPnL: 8920,
              maxDrawdown: -3200,
            }
          : undefined,
        signals: Array.from({ length: 94 }, (_, i) => ({
          barIndex: i * 2 + 10,
          symbol: cfg.symbol,
          direction: Math.random() > 0.5 ? "long" : "short",
          action: i % 3 === 0 ? "exit" : "entry",
          grade: ["A", "B", "C", "D"][Math.floor(Math.random() * 4)] as any,
          overallScore: 0.6 + Math.random() * 0.4,
          pnl: (Math.random() - 0.4) * 500,
          holdBars: Math.floor(Math.random() * 20) + 1,
        })),
      };
      return mockResult;
    },
    onSuccess: (result) => {
      setSelectedRunId(result.runId);
    },
  });

  // ─── Mock: useMCPBacktestHistory ────────────────────────────────────────────
  const historyQuery = useQuery({
    queryKey: ["mcpBacktestHistory"],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 500));
      const mockRuns: MCPBacktestResult[] = [
        {
          runId: "RUN-20260405-001",
          config: { symbol: "AAPL", timeframe: "1h", startDate: "2026-03-05", endDate: "2026-04-05", initialCapital: 100000, runBaseline: true },
          status: "completed",
          startedAt: "2026-04-05T10:30:00Z",
          completedAt: "2026-04-05T10:45:00Z",
          mcpMetrics: { totalSignals: 120, approvedSignals: 78, rejectedSignals: 42, filterPercentage: 35, avgScore: 0.71, winRate: 61, sharpe: 2.0, profitFactor: 2.1, totalPnL: 10200, maxDrawdown: -1800 },
          baselineMetrics: { winRate: 52, sharpe: 1.45, profitFactor: 1.72, totalPnL: 6500, maxDrawdown: -3100 },
          signals: [],
        },
        {
          runId: "RUN-20260404-001",
          config: { symbol: "MSFT", timeframe: "5m", startDate: "2026-03-05", endDate: "2026-04-04", initialCapital: 100000, runBaseline: true },
          status: "completed",
          startedAt: "2026-04-04T14:20:00Z",
          completedAt: "2026-04-04T14:35:00Z",
          mcpMetrics: { totalSignals: 245, approvedSignals: 152, rejectedSignals: 93, filterPercentage: 37.9, avgScore: 0.68, winRate: 58, sharpe: 1.83, profitFactor: 2.05, totalPnL: 8750, maxDrawdown: -2300 },
          baselineMetrics: { winRate: 49, sharpe: 1.21, profitFactor: 1.54, totalPnL: 5200, maxDrawdown: -3500 },
          signals: [],
        },
      ];
      return mockRuns;
    },
  });

  // ─── Mock: useMCPBacktestComparison & useMCPBacktestSignalLog ─────────────
  const selectedRun = useMemo(() => {
    if (runBacktestMutation.data && selectedRunId === runBacktestMutation.data.runId) {
      return runBacktestMutation.data;
    }
    return historyQuery.data?.find((r) => r.runId === selectedRunId) || runBacktestMutation.data;
  }, [selectedRunId, runBacktestMutation.data, historyQuery.data]);

  const handleRunBacktest = useCallback(() => {
    runBacktestMutation.mutate(config);
  }, [config, runBacktestMutation]);

  const handleInputChange = (field: keyof MCPBacktestConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div style={{ backgroundColor: C.bg, color: "white", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1
            style={{
              margin: "0 0 8px 0",
              fontSize: "28px",
              fontWeight: "700",
              fontFamily: "Space Grotesk",
              color: C.primary,
            }}
          >
            MCP Backtester
          </h1>
          <p
            style={{
              margin: "0",
              fontSize: "13px",
              color: C.muted,
              fontFamily: "Space Grotesk",
            }}
          >
            Compare MCP-filtered signal performance against raw baseline across multiple symbols and timeframes
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "24px" }}>
          {/* Main Content */}
          <div>
            {/* Section A: Run New Backtest */}
            <div
              style={{
                padding: "20px",
                backgroundColor: C.cardHigh,
                border: `1px solid ${C.border}`,
                borderRadius: "8px",
                marginBottom: "24px",
              }}
            >
              <h2
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: C.secondary,
                  fontFamily: "Space Grotesk",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Run New Backtest
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "16px",
                  marginBottom: "16px",
                }}
              >
                {/* Symbol */}
                <div>
                  <label style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk", display: "block", marginBottom: "6px" }}>
                    SYMBOL
                  </label>
                  <input
                    type="text"
                    value={config.symbol}
                    onChange={(e) => handleInputChange("symbol", e.target.value.toUpperCase())}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: "4px",
                      color: "white",
                      fontFamily: "Space Grotesk",
                      fontSize: "12px",
                    }}
                    placeholder="SPY"
                  />
                </div>

                {/* Timeframe */}
                <div>
                  <label style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk", display: "block", marginBottom: "6px" }}>
                    TIMEFRAME
                  </label>
                  <select
                    value={config.timeframe}
                    onChange={(e) => handleInputChange("timeframe", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: "4px",
                      color: "white",
                      fontFamily: "Space Grotesk",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <option value="1m">1 min</option>
                    <option value="5m">5 min</option>
                    <option value="15m">15 min</option>
                    <option value="1h">1 hour</option>
                    <option value="4h">4 hours</option>
                    <option value="1d">1 day</option>
                  </select>
                </div>

                {/* Start Date */}
                <div>
                  <label style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk", display: "block", marginBottom: "6px" }}>
                    START DATE
                  </label>
                  <input
                    type="date"
                    value={config.startDate}
                    onChange={(e) => handleInputChange("startDate", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: "4px",
                      color: "white",
                      fontFamily: "Space Grotesk",
                      fontSize: "12px",
                    }}
                  />
                </div>

                {/* End Date */}
                <div>
                  <label style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk", display: "block", marginBottom: "6px" }}>
                    END DATE
                  </label>
                  <input
                    type="date"
                    value={config.endDate}
                    onChange={(e) => handleInputChange("endDate", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: "4px",
                      color: "white",
                      fontFamily: "Space Grotesk",
                      fontSize: "12px",
                    }}
                  />
                </div>

                {/* Initial Capital */}
                <div>
                  <label style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk", display: "block", marginBottom: "6px" }}>
                    INITIAL CAPITAL
                  </label>
                  <input
                    type="number"
                    value={config.initialCapital}
                    onChange={(e) => handleInputChange("initialCapital", parseInt(e.target.value) || 100000)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: "4px",
                      color: "white",
                      fontFamily: "Space Grotesk",
                      fontSize: "12px",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <input
                  type="checkbox"
                  checked={config.runBaseline}
                  onChange={(e) => handleInputChange("runBaseline", e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label
                  style={{
                    fontSize: "12px",
                    color: "white",
                    fontFamily: "Space Grotesk",
                    cursor: "pointer",
                  }}
                >
                  Run Baseline Comparison
                </label>
              </div>

              <button
                onClick={handleRunBacktest}
                disabled={runBacktestMutation.isPending}
                style={{
                  padding: "10px 16px",
                  backgroundColor: runBacktestMutation.isPending ? C.outlineVar : C.primary,
                  color: runBacktestMutation.isPending ? C.muted : "#000",
                  border: "none",
                  borderRadius: "4px",
                  fontFamily: "Space Grotesk",
                  fontWeight: "600",
                  fontSize: "12px",
                  cursor: runBacktestMutation.isPending ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {runBacktestMutation.isPending ? "Running..." : "Run Backtest"}
              </button>

              {runBacktestMutation.isPending && (
                <div style={{ marginTop: "12px", fontSize: "12px", color: C.secondary }}>
                  <div style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", backgroundColor: C.secondary, marginRight: "8px", animation: "pulse 1.5s infinite" }} />
                  Backtest in progress...
                </div>
              )}
            </div>

            {/* Section B: Results */}
            {selectedRun ? (
              <>
                <ComparisonRow result={selectedRun} />
                <FilteringStats result={selectedRun} />
                <SignalLogTable signals={selectedRun.signals} isLoading={runBacktestMutation.isPending} />
              </>
            ) : (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: C.muted,
                  backgroundColor: C.card,
                  border: `1px dashed ${C.border}`,
                  borderRadius: "8px",
                }}
              >
                <p style={{ margin: "0" }}>Run a backtest or select a past run to see results</p>
              </div>
            )}
          </div>

          {/* Sidebar: Past Runs */}
          <PastRunsSidebar
            runs={historyQuery.data || []}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            isLoading={historyQuery.isLoading}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
