import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

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
      // Mock watchlist - in production, fetch from /api/watchlist
      return ["BTCUSD", "ETHUSD", "SPY", "QQQ", "AAPL", "MSFT"];
    },
    staleTime: 60_000,
  });
}

function useMultiTimeframeStructure(symbol: string, timeframe: string) {
  return useQuery({
    queryKey: ["market-structure", symbol, timeframe],
    queryFn: async () => {
      // Real candle data from /api/alpaca/bars. The order-blocks /
      // key-levels / patterns / swing fields below are placeholders —
      // wire them to a proper structure-analysis endpoint when ready.
      let candles: any[] = [];
      try {
        const r = await fetch(`/api/alpaca/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=80`);
        if (r.ok) {
          const data = await r.json();
          const bars: any[] = Array.isArray(data) ? data : (data?.bars ?? data?.data ?? []);
          candles = bars.map((b: any, i: number) => ({
            idx: i,
            open: Math.round(Number(b.open ?? b.o ?? 0)),
            high: Math.round(Number(b.high ?? b.h ?? 0)),
            low: Math.round(Number(b.low ?? b.l ?? 0)),
            close: Math.round(Number(b.close ?? b.c ?? 0)),
          })).filter((c) => c.close > 0);
        }
      } catch {
        candles = [];
      }
      return {
        symbol,
        timeframe,
        htf_bias: "BULLISH",
        candles,
        order_blocks: [
          {
            id: "ob-1",
            type: "demand",
            price_high: 42500,
            price_low: 41800,
            strength: 8.5,
            timeframe: timeframe,
            status: "active",
          },
          {
            id: "ob-2",
            type: "supply",
            price_high: 43500,
            price_low: 43200,
            strength: 7.2,
            timeframe: timeframe,
            status: "active",
          },
        ],
        key_levels: [
          { price: 41800, type: "support", timeframe: "HTF", strength: 9 },
          { price: 43500, type: "resistance", timeframe: "HTF", strength: 8.5 },
          { price: 42500, type: "support", timeframe: "LTF", strength: 7 },
        ],
        patterns: [
          {
            id: "p-1",
            type: "AB=CD",
            a: 41000,
            b: 42500,
            c: 41500,
            d: 43000,
            fib_accuracy: 0.98,
            status: "completed",
          },
        ],
        trade_probabilities: {
          long: 68,
          short: 18,
          neutral: 14,
        },
        swing_highs: [43200, 42800],
        swing_lows: [41000, 40500],
      };
    },
    staleTime: 30_000,
  });
}

// generateMockCandles removed — candles now come from /api/alpaca/bars.

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
        padding: "8px 16px",
        borderRadius: "8px",
        backgroundColor: bgColor,
        color: "#0a0a1a",
        fontWeight: "bold",
        fontSize: "14px",
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
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - value / 100);

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="100" height="120" viewBox="0 0 100 120">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={C.cardHigh}
          strokeWidth="6"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
        />
        {/* Value text */}
        <text
          x="50"
          y="55"
          textAnchor="middle"
          fontSize="20"
          fontWeight="bold"
          fill={C.text}
          fontFamily="JetBrains Mono, monospace"
        >
          {value}%
        </text>
      </svg>
      <div style={{ marginTop: "8px", fontSize: "11px", color: C.textMuted }}>
        {label}
      </div>
    </div>
  );
}

function CandlestickChart({ candles }: { candles: any[] }) {
  const width = 800;
  const height = 300;
  const padding = 40;
  const chartWidth = width - 2 * padding;
  const chartHeight = height - 2 * padding;

  if (!candles || candles.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          background: C.cardHigh,
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.textMuted,
        }}
      >
        No data
      </div>
    );
  }

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const priceRange = maxPrice - minPrice;

  const candleWidth = chartWidth / candles.length;

  const yScale = (price: number) => {
    return (
      padding +
      chartHeight -
      ((price - minPrice) / priceRange) * chartHeight
    );
  };

  const xScale = (idx: number) => {
    return padding + (idx + 0.5) * candleWidth;
  };

  return (
    <svg width={width} height={height} style={{ background: C.cardHigh, borderRadius: "8px" }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = padding + chartHeight * (1 - pct);
        const price = minPrice + priceRange * pct;
        return (
          <g key={pct}>
            <line
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke={C.border}
              strokeWidth="1"
              strokeDasharray="4"
            />
            <text
              x={padding - 10}
              y={y + 4}
              textAnchor="end"
              fontSize="10"
              fill={C.textMuted}
              fontFamily="JetBrains Mono, monospace"
            >
              ${Math.round(price)}
            </text>
          </g>
        );
      })}

      {/* Candles */}
      {candles.map((candle, idx) => {
        const x = xScale(idx);
        const openY = yScale(candle.open);
        const closeY = yScale(candle.close);
        const highY = yScale(candle.high);
        const lowY = yScale(candle.low);

        const isBullish = candle.close > candle.open;
        const bodyColor = isBullish ? C.green : C.red;
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.abs(closeY - openY) || 2;

        return (
          <g key={idx}>
            {/* Wick */}
            <line
              x1={x}
              y1={highY}
              x2={x}
              y2={lowY}
              stroke={bodyColor}
              strokeWidth="1"
            />
            {/* Body */}
            <rect
              x={x - candleWidth * 0.3}
              y={bodyTop}
              width={candleWidth * 0.6}
              height={bodyHeight}
              fill={bodyColor}
              stroke={bodyColor}
              strokeWidth="1"
            />
          </g>
        );
      })}

      {/* Axes */}
      <line
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
        stroke={C.border}
        strokeWidth="1"
      />
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke={C.border}
        strokeWidth="1"
      />
    </svg>
  );
}

// ── Main Page Component ────────────────────────────────────────────────────
export default function MarketStructurePage() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState("1H");

  const { data: watchlistData } = useWatchlist();
  const { data: structureData, isLoading } = useMultiTimeframeStructure(
    symbol,
    timeframe
  );

  const timeframes = ["Weekly", "Daily", "4H", "1H", "15min"];

  return (
    <div style={{ padding: "24px", backgroundColor: C.bg, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "bold",
            color: C.text,
            fontFamily: "JetBrains Mono, monospace",
            marginBottom: "16px",
          }}
        >
          Market Structure HTF
        </h1>
        <p style={{ color: C.textMuted, fontSize: "14px" }}>
          Multi-timeframe analysis with order blocks, key levels, and harmonic patterns
        </p>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {/* Symbol Selector */}
        <div>
          <Label>Select Symbol</Label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              marginTop: "8px",
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: "6px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "14px",
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

        {/* Bias Badge */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
          <div style={{ flex: 1 }}>
            <Label>HTF Bias</Label>
            <div style={{ marginTop: "8px" }}>
              <Badge
                color={
                  structureData?.htf_bias === "BULLISH"
                    ? "green"
                    : structureData?.htf_bias === "BEARISH"
                      ? "red"
                      : "gray"
                }
              >
                {structureData?.htf_bias || "—"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Timeframe Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "24px",
          borderBottom: `1px solid ${C.border}`,
          paddingBottom: "12px",
        }}
      >
        {timeframes.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            style={{
              padding: "8px 16px",
              background:
                timeframe === tf ? C.card : "transparent",
              border:
                timeframe === tf
                  ? `1px solid ${C.green}`
                  : `1px solid ${C.border}`,
              color: timeframe === tf ? C.green : C.textMuted,
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: timeframe === tf ? "600" : "400",
              transition: "all 0.2s",
            }}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div
        style={{
          marginBottom: "24px",
          padding: "16px",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
        }}
      >
        <Label>Candlestick Chart</Label>
        <div style={{ marginTop: "12px", overflowX: "auto" }}>
          <CandlestickChart candles={structureData?.candles || []} />
        </div>
      </div>

      {/* Trade Probabilities */}
      <div
        style={{
          padding: "16px",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          marginBottom: "24px",
        }}
      >
        <Label>Trade Probability Gauges</Label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            marginTop: "16px",
          }}
        >
          <GaugeChart
            label="Long"
            value={structureData?.trade_probabilities.long || 0}
            color={C.green}
          />
          <GaugeChart
            label="Short"
            value={structureData?.trade_probabilities.short || 0}
            color={C.red}
          />
          <GaugeChart
            label="Neutral"
            value={structureData?.trade_probabilities.neutral || 0}
            color={C.gray}
          />
        </div>
      </div>

      {/* Order Blocks Panel */}
      <div
        style={{
          padding: "16px",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          marginBottom: "24px",
        }}
      >
        <Label>Active Order Blocks</Label>
        <div style={{ marginTop: "12px" }}>
          {structureData?.order_blocks.map((ob) => (
            <div
              key={ob.id}
              style={{
                padding: "12px",
                background: C.cardHigh,
                borderRadius: "6px",
                marginBottom: "8px",
                borderLeft: `4px solid ${ob.type === "demand" ? C.blue : C.orange}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "4px",
                }}
              >
                <span style={{ color: C.text, fontWeight: "600" }}>
                  {ob.type === "demand" ? "Demand" : "Supply"} Block
                </span>
                <span style={{ color: C.textMuted, fontSize: "12px" }}>
                  Score: {ob.strength}
                </span>
              </div>
              <div style={{ color: C.textMuted, fontSize: "12px" }}>
                ${ob.price_low.toLocaleString()} - ${ob.price_high.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key Levels Panel */}
      <div
        style={{
          padding: "16px",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
        }}
      >
        <Label>Key Levels</Label>
        <table
          style={{
            width: "100%",
            marginTop: "12px",
            borderCollapse: "collapse",
            fontSize: "13px",
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
                  textAlign: "left",
                  padding: "8px",
                  color: C.textMuted,
                  fontWeight: "600",
                }}
              >
                Timeframe
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
            {structureData?.key_levels.map((level, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.border}` }}>
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
                  {level.type === "support" ? "Support" : "Resistance"}
                </td>
                <td style={{ padding: "8px", color: C.textMuted }}>
                  {level.timeframe}
                </td>
                <td style={{ padding: "8px", color: C.text, textAlign: "right" }}>
                  {level.strength}/10
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
