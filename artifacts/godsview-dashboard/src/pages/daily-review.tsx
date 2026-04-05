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
  yellow: "#eab308",
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

function useDailyReview(symbol: string, date: string) {
  return useQuery({
    queryKey: ["daily-review", symbol, date],
    queryFn: async () => {
      // Mock daily review data
      return {
        symbol,
        date,
        htf_bias: "BULLISH",
        trade_probabilities: { long: 72, short: 15, neutral: 13 },
        chance_of_trade: 78,
        findings: [
          {
            id: "f1",
            type: "order_block_break",
            importance: "high",
            description: "Demand block broken with strong volume",
            price: 42500,
            timeframe: "4H",
          },
          {
            id: "f2",
            type: "structure_break",
            importance: "medium",
            description: "Higher low confirmed on daily",
            price: 41900,
            timeframe: "Daily",
          },
          {
            id: "f3",
            type: "confluence",
            importance: "low",
            description: "Multiple timeframes aligned at 43200",
            price: 43200,
            timeframe: "1H",
          },
        ],
        key_levels: [
          { price: 41800, type: "support", strength: 9 },
          { price: 43500, type: "resistance", strength: 8.5 },
        ],
        stats: {
          signals_generated: 12,
          trades_executed: 8,
          trades_won: 6,
          trades_lost: 2,
          pnl_pct: 2.45,
        },
        active_order_blocks: 2,
        active_patterns: 1,
        structure_summary:
          "Market showing bullish bias with confirmed higher lows. Multiple confluence zones established around key resistance. Order blocks holding as expected.",
      };
    },
    staleTime: 30_000,
    enabled: !!symbol && !!date,
  });
}

function useDailyReviews(symbol: string) {
  return useQuery({
    queryKey: ["daily-reviews", symbol],
    queryFn: async () => {
      // Mock review history
      const today = new Date();
      return Array.from({ length: 10 }).map((_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return {
          date: d.toISOString().split("T")[0],
          pnl_pct: (Math.random() - 0.4) * 5,
          trades: Math.floor(Math.random() * 8),
          bias: ["BULLISH", "BEARISH", "RANGING"][
            Math.floor(Math.random() * 3)
          ],
        };
      });
    },
    enabled: !!symbol,
    staleTime: 60_000,
  });
}

function useGenerateDailyReview() {
  return useMutation({
    mutationFn: async (params: { symbol: string; date: string }) => {
      // Simulate API call
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              success: true,
              message: "Review generated",
            }),
          1000
        )
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
        fontSize: "12px",
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      {children}
    </div>
  );
}

function GaugeChart({
  label,
  value,
  color = C.green,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - value / 100);

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="80" height="100" viewBox="0 0 80 100">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={C.cardHigh}
          strokeWidth="5"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transform: "rotate(-90deg)", transformOrigin: "40px 40px" }}
        />
        <text
          x="40"
          y="45"
          textAnchor="middle"
          fontSize="16"
          fontWeight="bold"
          fill={C.text}
          fontFamily="JetBrains Mono, monospace"
        >
          {value}%
        </text>
      </svg>
      <div style={{ marginTop: "6px", fontSize: "10px", color: C.textMuted }}>
        {label}
      </div>
    </div>
  );
}

// ── Main Page Component ────────────────────────────────────────────────────
export default function DailyReviewPage() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const { data: watchlistData } = useWatchlist();
  const { data: reviewData } = useDailyReview(symbol, date);
  const { data: historyData } = useDailyReviews(symbol);
  const generateReviewMutation = useGenerateDailyReview();

  const handleGenerateReview = () => {
    generateReviewMutation.mutate({ symbol, date });
  };

  const handleExportHTML = () => {
    window.open(`/api/daily-review/${symbol}/${date}/html`, "_blank");
  };

  const handleExportMarkdown = () => {
    window.location.href = `/api/daily-review/${symbol}/${date}/markdown`;
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
          Daily Review Browser
        </h1>
        <p style={{ color: C.textMuted, fontSize: "14px" }}>
          Day-by-day trading analysis with market structure insights
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: "24px" }}>
        {/* Main Content */}
        <div>
          {/* Controls */}
          <div
            style={{
              padding: "16px",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              marginBottom: "24px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "16px",
              alignItems: "flex-end",
            }}
          >
            <div>
              <Label>Symbol</Label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
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
                {watchlistData?.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Date</Label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
              />
            </div>
            <button
              onClick={handleGenerateReview}
              disabled={generateReviewMutation.isPending}
              style={{
                padding: "8px 16px",
                background: C.green,
                color: "#0a0a1a",
                border: "none",
                borderRadius: "4px",
                fontWeight: "bold",
                fontSize: "13px",
                fontFamily: "Space Grotesk, sans-serif",
                cursor: "pointer",
                opacity: generateReviewMutation.isPending ? 0.6 : 1,
              }}
            >
              {generateReviewMutation.isPending ? "Generating..." : "Generate Review"}
            </button>
          </div>

          {/* Review Card */}
          {reviewData && (
            <>
              <div
                style={{
                  padding: "20px",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                    paddingBottom: "12px",
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: "13px", color: C.textMuted }}>
                      {symbol} • {date}
                    </div>
                    <div style={{ marginTop: "4px" }}>
                      <Badge
                        color={
                          reviewData.htf_bias === "BULLISH"
                            ? "green"
                            : reviewData.htf_bias === "BEARISH"
                              ? "red"
                              : "gray"
                        }
                      >
                        {reviewData.htf_bias}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Gauges */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "16px",
                    marginBottom: "20px",
                  }}
                >
                  <GaugeChart
                    label="Long %"
                    value={reviewData.trade_probabilities.long}
                    color={C.green}
                  />
                  <GaugeChart
                    label="Short %"
                    value={reviewData.trade_probabilities.short}
                    color={C.red}
                  />
                  <GaugeChart
                    label="Neutral %"
                    value={reviewData.trade_probabilities.neutral}
                    color={C.gray}
                  />
                </div>

                {/* Chance of Trade Meter */}
                <div style={{ marginBottom: "20px" }}>
                  <Label>Chance of Trade</Label>
                  <div
                    style={{
                      marginTop: "8px",
                      background: C.cardHigh,
                      borderRadius: "4px",
                      height: "24px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${reviewData.chance_of_trade}%`,
                        background: C.blue,
                        transition: "width 0.3s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: "11px",
                        fontWeight: "bold",
                      }}
                    >
                      {reviewData.chance_of_trade}%
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: "12px",
                  }}
                >
                  {[
                    {
                      label: "Signals",
                      value: reviewData.stats.signals_generated,
                    },
                    {
                      label: "Trades",
                      value: reviewData.stats.trades_executed,
                    },
                    {
                      label: "Won",
                      value: reviewData.stats.trades_won,
                      color: C.green,
                    },
                    {
                      label: "Lost",
                      value: reviewData.stats.trades_lost,
                      color: C.red,
                    },
                    {
                      label: "P&L",
                      value: `${reviewData.stats.pnl_pct > 0 ? "+" : ""}${reviewData.stats.pnl_pct.toFixed(2)}%`,
                      color:
                        reviewData.stats.pnl_pct > 0 ? C.green : C.red,
                    },
                  ].map((stat, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "12px",
                        background: C.cardHigh,
                        borderRadius: "4px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "10px", color: C.textMuted }}>
                        {stat.label}
                      </div>
                      <div
                        style={{
                          marginTop: "4px",
                          fontSize: "16px",
                          fontWeight: "bold",
                          color: stat.color || C.text,
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Findings Timeline */}
              <div
                style={{
                  padding: "16px",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  marginBottom: "24px",
                }}
              >
                <Label>Findings Timeline</Label>
                <div style={{ marginTop: "12px", paddingLeft: "16px" }}>
                  {reviewData.findings.map((finding, idx) => {
                    const dotColor =
                      finding.importance === "high"
                        ? C.red
                        : finding.importance === "medium"
                          ? C.yellow
                          : C.gray;
                    return (
                      <div
                        key={finding.id}
                        style={{
                          marginBottom: idx < reviewData.findings.length - 1 ? "16px" : 0,
                          position: "relative",
                          paddingLeft: "16px",
                        }}
                      >
                        {/* Timeline dot */}
                        <div
                          style={{
                            position: "absolute",
                            left: "-12px",
                            top: "2px",
                            width: "10px",
                            height: "10px",
                            borderRadius: "50%",
                            background: dotColor,
                          }}
                        />
                        {/* Timeline line */}
                        {idx < reviewData.findings.length - 1 && (
                          <div
                            style={{
                              position: "absolute",
                              left: "-7px",
                              top: "12px",
                              width: "1px",
                              height: "16px",
                              background: C.border,
                            }}
                          />
                        )}
                        <div style={{ color: C.text, fontSize: "13px" }}>
                          {finding.description}
                        </div>
                        <div
                          style={{
                            marginTop: "4px",
                            fontSize: "11px",
                            color: C.textMuted,
                          }}
                        >
                          ${finding.price.toLocaleString()} • {finding.timeframe}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Key Levels Table */}
              <div
                style={{
                  padding: "16px",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  marginBottom: "24px",
                }}
              >
                <Label>Key Levels</Label>
                <table
                  style={{
                    width: "100%",
                    marginTop: "12px",
                    borderCollapse: "collapse",
                    fontSize: "12px",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px",
                          color: C.textMuted,
                          fontWeight: "600",
                        }}
                      >
                        Price
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px",
                          color: C.textMuted,
                          fontWeight: "600",
                        }}
                      >
                        Type
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "8px",
                          color: C.textMuted,
                          fontWeight: "600",
                        }}
                      >
                        Strength
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewData.key_levels.map((level, idx) => (
                      <tr
                        key={idx}
                        style={{ borderBottom: `1px solid ${C.border}` }}
                      >
                        <td
                          style={{
                            padding: "8px",
                            color: C.text,
                            fontFamily: "JetBrains Mono, monospace",
                          }}
                        >
                          ${level.price.toLocaleString()}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            color:
                              level.type === "support" ? C.green : C.red,
                          }}
                        >
                          {level.type === "support"
                            ? "Support"
                            : "Resistance"}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            color: C.text,
                            textAlign: "right",
                          }}
                        >
                          {level.strength}/10
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Structure Summary */}
              <div
                style={{
                  padding: "16px",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  marginBottom: "24px",
                }}
              >
                <Label>Structure Summary</Label>
                <p
                  style={{
                    marginTop: "8px",
                    color: C.text,
                    fontSize: "13px",
                    lineHeight: "1.6",
                  }}
                >
                  {reviewData.structure_summary}
                </p>
              </div>

              {/* Export Buttons */}
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  marginBottom: "24px",
                }}
              >
                <button
                  onClick={handleExportHTML}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    background: C.blue,
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontWeight: "bold",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  View HTML Report
                </button>
                <button
                  onClick={handleExportMarkdown}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    background: C.orange,
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontWeight: "bold",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Download Markdown
                </button>
              </div>
            </>
          )}
        </div>

        {/* Sidebar - Review History */}
        <div
          style={{
            padding: "16px",
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            maxHeight: "600px",
            overflowY: "auto",
          }}
        >
          <Label>Review History</Label>
          <div style={{ marginTop: "12px" }}>
            {historyData?.map((review, idx) => (
              <button
                key={idx}
                onClick={() => setDate(review.date)}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginBottom: "8px",
                  background:
                    date === review.date ? C.cardHigh : "transparent",
                  border: `1px solid ${date === review.date ? C.green : C.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: C.textMuted,
                    textAlign: "left",
                  }}
                >
                  {review.date}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: "bold",
                    color:
                      review.pnl_pct > 0 ? C.green : review.pnl_pct < 0 ? C.red : C.textMuted,
                    marginTop: "2px",
                    textAlign: "left",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {review.pnl_pct > 0 ? "+" : ""}
                  {review.pnl_pct.toFixed(2)}%
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: C.textMuted,
                    marginTop: "4px",
                    textAlign: "left",
                  }}
                >
                  {review.trades} trades • {review.bias}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
