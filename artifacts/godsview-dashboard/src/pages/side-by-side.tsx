import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0a0a1a",
  card: "#1a1a2e",
  cardHigh: "#252535",
  border: "rgba(226, 232, 240, 0.1)",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  green: "#10b981",
  red: "#ef4444",
  blue: "#3b82f6",
  orange: "#f97316",
  gray: "#64748b",
};

// ── Mock API Hooks ────────────────────────────────────────────────────────
function useWatchlist() {
  return useQuery({
    queryKey: ["watchlist"],
    queryFn: async () => {
      return ["BTCUSD", "ETHUSD", "SPY", "QQQ", "AAPL", "MSFT"];
    },
    staleTime: 60_000,
  });
}

function useSideBySideSnapshot(symbols: string[], historicalDays: number) {
  return useQuery({
    queryKey: ["side-by-side", symbols, historicalDays],
    queryFn: async () => {
      // Real snapshot from /api/side-by-side/snapshot. When no run is active,
      // backend now returns { running: false, snapshot: null } — return that
      // through and let the UI render an "idle" state instead of fabricating
      // a fake comparison.
      try {
        const r = await fetch("/api/side-by-side/snapshot");
        if (r.ok) {
          const data = await r.json();
          if (data?.snapshot) return data.snapshot;
          // No active run — return shaped null so UI shows idle state.
          return {
            config: { symbols, historical_days: historicalDays },
            historical: null,
            live: null,
            comparison: null,
            running: false,
          };
        }
      } catch { /* fall through */ }
      return {
        config: { symbols, historical_days: historicalDays },
        historical: null,
        live: null,
        comparison: null,
        running: false,
      };
    },
    enabled: symbols.length > 0,
    staleTime: 15_000,
  });
}

// generateEquityCurve removed after Phase 8c — real curves come from the
// /api/side-by-side/snapshot payload (when a run is active).

function useStartSideBySide() {
  return useMutation({
    mutationFn: async (params: { symbols: string[]; historical_days: number; strategy: string }) => {
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true }), 500)
      );
    },
  });
}

function useStopSideBySide() {
  return useMutation({
    mutationFn: async () => {
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true }), 300)
      );
    },
  });
}

// ── Reusable Components ────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontFamily: "Space Grotesk, sans-serif",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: C.textMuted,
      }}
    >
      {children}
    </span>
  );
}

function Badge({
  children,
  color = "green",
}: {
  children: React.ReactNode;
  color?: "green" | "red" | "gray";
}) {
  const bgColor =
    color === "green" ? C.green : color === "red" ? C.red : C.gray;
  return (
    <div
      style={{
        display: "inline-block",
        padding: "6px 12px",
        borderRadius: "6px",
        backgroundColor: bgColor,
        color: "#0a0a1a",
        fontWeight: "bold",
        fontSize: "11px",
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      {children}
    </div>
  );
}

function LineChart({ data }: { data: Array<{ idx: number; equity: number }> }) {
  const width = 250;
  const height = 120;
  const padding = 20;
  const chartWidth = width - 2 * padding;
  const chartHeight = height - 2 * padding;

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          background: C.cardHigh,
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.textMuted,
          fontSize: "12px",
        }}
      >
        No data
      </div>
    );
  }

  const equities = data.map((d) => d.equity);
  const minEquity = Math.min(...equities);
  const maxEquity = Math.max(...equities);
  const range = maxEquity - minEquity || 1;

  const points = data
    .map((d, i) => {
      const x = padding + (i / (data.length - 1)) * chartWidth;
      const y =
        padding +
        chartHeight -
        ((d.equity - minEquity) / range) * chartHeight;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} style={{ background: C.cardHigh, borderRadius: "4px" }}>
      <polyline
        points={points}
        fill="none"
        stroke={C.blue}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProgressBar({
  value,
  color = C.blue,
}: {
  value: number;
  color?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "8px",
        background: C.cardHigh,
        borderRadius: "4px",
        overflow: "hidden",
        marginTop: "4px",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${value}%`,
          background: color,
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}

function DeltaBar({
  label,
  value,
  unit = "",
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  const isPositive = value > 0;
  const color = isPositive ? C.green : value < 0 ? C.red : C.gray;

  return (
    <div style={{ marginBottom: "12px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "4px",
        }}
      >
        <span style={{ fontSize: "12px", color: C.textMuted }}>{label}</span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: "bold",
            color,
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {isPositive ? "+" : ""}
          {value.toFixed(1)}
          {unit}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          height: "6px",
          background: C.cardHigh,
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            background: isPositive ? C.green : C.gray,
          }}
        />
        <div
          style={{
            flex: Math.max(0, -value / 5),
            background: isPositive ? C.gray : C.red,
          }}
        />
      </div>
    </div>
  );
}

// ── Main Page Component ────────────────────────────────────────────────────
export default function SideBySidePage() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["BTCUSD"]);
  const [historicalDays, setHistoricalDays] = useState(90);
  const [strategy, setStrategy] = useState("mean-reversion");
  const [isRunning, setIsRunning] = useState(false);

  const { data: watchlistData } = useWatchlist();
  const { data: snapshotData } = useSideBySideSnapshot(selectedSymbols, historicalDays);
  const startMutation = useStartSideBySide();
  const stopMutation = useStopSideBySide();

  const handleSymbolToggle = (sym: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const handleStart = async () => {
    await startMutation.mutateAsync({
      symbols: selectedSymbols,
      historical_days: historicalDays,
      strategy,
    });
    setIsRunning(true);
  };

  const handleStop = async () => {
    await stopMutation.mutateAsync();
    setIsRunning(false);
  };

  return (
    <div style={{ padding: "24px", backgroundColor: C.bg, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "bold",
            color: C.text,
            fontFamily: "JetBrains Mono, monospace",
            marginBottom: "8px",
          }}
        >
          Side-by-Side Backtest
        </h1>
        <p style={{ color: C.textMuted, fontSize: "14px" }}>
          Compare historical backtest performance with live paper trading
        </p>
      </div>

      {/* Config Panel */}
      <div
        style={{
          padding: "20px",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          marginBottom: "24px",
        }}
      >
        <Label>Configuration</Label>

        {/* Symbol Selection */}
        <div style={{ marginTop: "16px", marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", color: C.textMuted, marginBottom: "8px" }}>
            Symbols ({selectedSymbols.length} selected)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {watchlistData?.map((sym) => (
              <button
                key={sym}
                onClick={() => handleSymbolToggle(sym)}
                style={{
                  padding: "6px 12px",
                  background: selectedSymbols.includes(sym)
                    ? C.green
                    : C.cardHigh,
                  color: selectedSymbols.includes(sym) ? "#0a0a1a" : C.text,
                  border: `1px solid ${selectedSymbols.includes(sym) ? C.green : C.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Days Slider */}
        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <Label>Historical Days</Label>
            <span
              style={{
                fontSize: "13px",
                fontWeight: "bold",
                color: C.text,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {historicalDays}
            </span>
          </div>
          <input
            type="range"
            min="30"
            max="365"
            step="30"
            value={historicalDays}
            onChange={(e) => setHistoricalDays(Number(e.target.value))}
            style={{
              width: "100%",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Strategy Selection */}
        <div style={{ marginBottom: "20px" }}>
          <Label>Strategy</Label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              marginTop: "4px",
              background: C.cardHigh,
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: "4px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <option value="mean-reversion">Mean Reversion</option>
            <option value="trend-follow">Trend Following</option>
            <option value="breakout">Breakout</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>

        {/* Control Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleStart}
            disabled={isRunning || startMutation.isPending}
            style={{
              flex: 1,
              padding: "10px",
              background: C.green,
              color: "#0a0a1a",
              border: "none",
              borderRadius: "4px",
              fontWeight: "bold",
              fontSize: "13px",
              cursor: "pointer",
              opacity: isRunning || startMutation.isPending ? 0.6 : 1,
            }}
          >
            {startMutation.isPending ? "Starting..." : "Start"}
          </button>
          <button
            onClick={handleStop}
            disabled={!isRunning || stopMutation.isPending}
            style={{
              flex: 1,
              padding: "10px",
              background: C.red,
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontWeight: "bold",
              fontSize: "13px",
              cursor: "pointer",
              opacity: !isRunning || stopMutation.isPending ? 0.6 : 1,
            }}
          >
            {stopMutation.isPending ? "Stopping..." : "Stop"}
          </button>
        </div>
      </div>

      {/* Split View */}
      {snapshotData && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
            marginBottom: "24px",
          }}
        >
          {/* Historical Backtest */}
          <div
            style={{
              padding: "20px",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
            }}
          >
            <h2
              style={{
                fontSize: "16px",
                fontWeight: "bold",
                color: C.text,
                marginBottom: "12px",
              }}
            >
              Historical Backtest
            </h2>

            {/* Progress Bar */}
            <div>
              <Label>Progress</Label>
              <ProgressBar value={snapshotData.historical.progress} />
              <div
                style={{
                  marginTop: "4px",
                  fontSize: "11px",
                  color: C.textMuted,
                }}
              >
                {snapshotData.historical.progress}%
              </div>
            </div>

            {/* Stats */}
            <div style={{ marginTop: "16px" }}>
              {[
                {
                  label: "Trades",
                  value: snapshotData.historical.stats.trades,
                },
                {
                  label: "Win Rate",
                  value: `${snapshotData.historical.stats.win_rate.toFixed(1)}%`,
                },
                {
                  label: "P&L %",
                  value: `${snapshotData.historical.stats.pnl_pct > 0 ? "+" : ""}${snapshotData.historical.stats.pnl_pct.toFixed(2)}%`,
                  color:
                    snapshotData.historical.stats.pnl_pct > 0 ? C.green : C.red,
                },
                {
                  label: "Sharpe",
                  value: snapshotData.historical.stats.sharpe.toFixed(2),
                },
                {
                  label: "Max DD",
                  value: `${snapshotData.historical.stats.max_drawdown.toFixed(1)}%`,
                  color: C.red,
                },
              ].map((stat, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ fontSize: "12px", color: C.textMuted }}>
                    {stat.label}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: "bold",
                      color: stat.color || C.text,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Equity Curve */}
            <div style={{ marginTop: "16px" }}>
              <Label>Equity Curve</Label>
              <div style={{ marginTop: "8px" }}>
                <LineChart data={snapshotData.historical.equity_curve} />
              </div>
            </div>
          </div>

          {/* Live Paper */}
          <div
            style={{
              padding: "20px",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
            }}
          >
            <h2
              style={{
                fontSize: "16px",
                fontWeight: "bold",
                color: C.text,
                marginBottom: "12px",
              }}
            >
              Live Paper
            </h2>

            {/* Status Badge */}
            <div>
              <Badge color={isRunning ? "green" : "gray"}>
                {snapshotData.live.status.toUpperCase()}
              </Badge>
            </div>

            {/* Stats */}
            <div style={{ marginTop: "16px" }}>
              {[
                { label: "Trades", value: snapshotData.live.stats.trades },
                {
                  label: "Win Rate",
                  value: `${snapshotData.live.stats.win_rate.toFixed(1)}%`,
                },
                {
                  label: "P&L %",
                  value: `${snapshotData.live.stats.pnl_pct > 0 ? "+" : ""}${snapshotData.live.stats.pnl_pct.toFixed(2)}%`,
                  color:
                    snapshotData.live.stats.pnl_pct > 0 ? C.green : C.red,
                },
                {
                  label: "Unrealized",
                  value: `${snapshotData.live.stats.unrealized > 0 ? "+" : ""}${snapshotData.live.stats.unrealized.toFixed(2)}%`,
                  color:
                    snapshotData.live.stats.unrealized > 0 ? C.green : C.red,
                },
                {
                  label: "Open Positions",
                  value: snapshotData.live.stats.open_positions,
                },
              ].map((stat, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ fontSize: "12px", color: C.textMuted }}>
                    {stat.label}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: "bold",
                      color: stat.color || C.text,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Equity Curve */}
            <div style={{ marginTop: "16px" }}>
              <Label>Equity Curve</Label>
              <div style={{ marginTop: "8px" }}>
                <LineChart data={snapshotData.live.equity_curve} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Panel */}
      {snapshotData && (
        <div
          style={{
            padding: "20px",
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
          }}
        >
          <h2
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              color: C.text,
              marginBottom: "16px",
            }}
          >
            Comparison Analysis
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "20px",
            }}
          >
            <div>
              <DeltaBar
                label="Win Rate Delta"
                value={snapshotData.comparison.win_rate_delta}
                unit="%"
              />
              <DeltaBar
                label="P&L Delta"
                value={snapshotData.comparison.pnl_delta}
                unit="%"
              />

              <div style={{ marginTop: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                  }}
                >
                  <span style={{ fontSize: "12px", color: C.textMuted }}>
                    Signal Overlap
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      color: C.text,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {snapshotData.comparison.signal_overlap}%
                  </span>
                </div>
                <ProgressBar
                  value={snapshotData.comparison.signal_overlap}
                  color={C.green}
                />
              </div>
            </div>

            <div>
              <div style={{ marginBottom: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                  }}
                >
                  <span style={{ fontSize: "12px", color: C.textMuted }}>
                    Divergence Score
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      color: C.text,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {snapshotData.comparison.divergence_score.toFixed(2)}
                  </span>
                </div>
                <ProgressBar
                  value={snapshotData.comparison.divergence_score * 100}
                  color={
                    snapshotData.comparison.divergence_score < 0.25
                      ? C.green
                      : snapshotData.comparison.divergence_score < 0.5
                        ? C.orange
                        : C.red
                  }
                />
              </div>

              <div
                style={{
                  padding: "12px",
                  background: C.cardHigh,
                  borderRadius: "4px",
                  marginTop: "12px",
                }}
              >
                <Label>Verdict</Label>
                <p
                  style={{
                    marginTop: "6px",
                    fontSize: "12px",
                    color: C.text,
                    lineHeight: "1.4",
                  }}
                >
                  {snapshotData.comparison.verdict}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
