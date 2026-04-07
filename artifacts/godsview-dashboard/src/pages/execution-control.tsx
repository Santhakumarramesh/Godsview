import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

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

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ExecutionStatus {
  mode: "LIVE" | "PAPER" | "SHADOW";
  fillRate: number;
  avgSlippage: number;
  activeOrdersCount: number;
}

interface Order {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP";
  qty: number;
  fillPercent: number;
  price: number;
  status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";
  time: string;
}

interface Position {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  stopLoss: number;
  takeProfit: number;
  duration: string;
}

interface Venue {
  name: string;
  status: "HEALTHY" | "DEGRADED" | "ERROR";
  latency: number;
  fillRate: number;
  orderCount: number;
  fees: number;
}

interface ExecutionReport {
  fillRate: number;
  avgSlippage: number;
  totalFees: number;
  avgFillTime: number;
}

interface Fill {
  time: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  venue: string;
  slippage: number;
}

// ============================================================================
// MOCK DATA
// ============================================================================

const mockStatus: ExecutionStatus = {
  mode: "LIVE",
  fillRate: 94.2,
  avgSlippage: 1.3,
  activeOrdersCount: 8,
};

const mockOrders: Order[] = [
  {
    id: "ORD-001",
    symbol: "AAPL",
    side: "BUY",
    type: "LIMIT",
    qty: 500,
    fillPercent: 85,
    price: 185.42,
    status: "PARTIAL",
    time: "14:32:18",
  },
  {
    id: "ORD-002",
    symbol: "MSFT",
    side: "SELL",
    type: "MARKET",
    qty: 300,
    fillPercent: 100,
    price: 417.89,
    status: "FILLED",
    time: "14:31:05",
  },
  {
    id: "ORD-003",
    symbol: "GOOGL",
    side: "BUY",
    type: "LIMIT",
    qty: 150,
    fillPercent: 45,
    price: 169.23,
    status: "OPEN",
    time: "14:30:42",
  },
  {
    id: "ORD-004",
    symbol: "TSLA",
    side: "SELL",
    type: "STOP",
    qty: 200,
    fillPercent: 60,
    price: 178.15,
    status: "PARTIAL",
    time: "14:29:31",
  },
];

const mockPositions: Position[] = [
  {
    symbol: "AAPL",
    side: "LONG",
    size: 1000,
    entryPrice: 182.50,
    currentPrice: 185.42,
    unrealizedPnL: 2920,
    stopLoss: 180.00,
    takeProfit: 190.00,
    duration: "2h 15m",
  },
  {
    symbol: "MSFT",
    side: "SHORT",
    size: 500,
    entryPrice: 420.00,
    currentPrice: 417.89,
    unrealizedPnL: 1055,
    stopLoss: 425.00,
    takeProfit: 410.00,
    duration: "1h 32m",
  },
];

const mockVenues: Venue[] = [
  {
    name: "NASDAQ",
    status: "HEALTHY",
    latency: 2.1,
    fillRate: 95.8,
    orderCount: 342,
    fees: 0.0035,
  },
  {
    name: "NYSE",
    status: "HEALTHY",
    latency: 2.8,
    fillRate: 93.2,
    orderCount: 218,
    fees: 0.0035,
  },
  {
    name: "CBOE",
    status: "DEGRADED",
    latency: 5.2,
    fillRate: 87.5,
    orderCount: 89,
    fees: 0.005,
  },
  {
    name: "EDGE",
    status: "HEALTHY",
    latency: 1.9,
    fillRate: 96.1,
    orderCount: 156,
    fees: 0.003,
  },
];

const mockReport: ExecutionReport = {
  fillRate: 94.2,
  avgSlippage: 1.3,
  totalFees: 2847.50,
  avgFillTime: 1250,
};

const mockFills: Fill[] = [
  { time: "14:35:42", symbol: "AAPL", side: "BUY", qty: 300, price: 185.48, venue: "NASDAQ", slippage: 0.6 },
  { time: "14:34:18", symbol: "MSFT", side: "SELL", qty: 300, price: 417.85, venue: "NASDAQ", slippage: 0.4 },
  { time: "14:33:55", symbol: "GOOGL", side: "BUY", qty: 100, price: 169.31, venue: "NYSE", slippage: 0.8 },
  { time: "14:32:10", symbol: "TSLA", side: "SELL", qty: 120, price: 178.22, venue: "CBOE", slippage: 0.7 },
  { time: "14:31:45", symbol: "NVDA", side: "BUY", qty: 250, price: 892.45, venue: "NASDAQ", slippage: 0.5 },
];

// ============================================================================
// SECTION 1: EXECUTION MODE BANNER
// ============================================================================

function ExecutionModeBanner() {
  const [selectedMode, setSelectedMode] = useState<"LIVE" | "PAPER" | "SHADOW">("LIVE");

  const { data: status = mockStatus, isLoading } = useQuery({
    queryKey: ["executionStatus"],
    queryFn: () => fetch("/api/execution/status").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const modeColor = {
    LIVE: C.red,
    PAPER: C.blue,
    SHADOW: C.yellow,
  }[selectedMode];

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        padding: "20px",
        marginBottom: "24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: modeColor,
              boxShadow: `0 0 8px ${modeColor}`,
            }}
          />
          <span style={{ fontSize: "18px", fontWeight: 600, color: C.text }}>Mode: {selectedMode}</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["LIVE", "PAPER", "SHADOW"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSelectedMode(mode)}
              style={{
                padding: "8px 16px",
                background: selectedMode === mode ? C.accent : C.cardAlt,
                color: C.text,
                border: `1px solid ${selectedMode === mode ? C.accent : C.border}`,
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 500,
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <div>
          <div style={{ fontSize: "12px", color: C.textMuted, marginBottom: "4px" }}>Fill Rate</div>
          <div style={{ fontSize: "24px", fontWeight: 600, color: C.green }}>{status.fillRate}%</div>
        </div>
        <div>
          <div style={{ fontSize: "12px", color: C.textMuted, marginBottom: "4px" }}>Avg Slippage</div>
          <div style={{ fontSize: "24px", fontWeight: 600, color: C.orange }}>{status.avgSlippage} bps</div>
        </div>
        <div>
          <div style={{ fontSize: "12px", color: C.textMuted, marginBottom: "4px" }}>Active Orders</div>
          <div style={{ fontSize: "24px", fontWeight: 600, color: C.blue }}>{status.activeOrdersCount}</div>
        </div>
      </div>

      {isLoading && <div style={{ marginTop: "12px", fontSize: "12px", color: C.textMuted }}>Loading...</div>}
    </div>
  );
}

// ============================================================================
// SECTION 2: ACTIVE ORDERS TABLE
// ============================================================================

function ActiveOrdersTable() {
  const [sortKey, setSortKey] = useState<keyof Order>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: orders = mockOrders, isLoading } = useQuery({
    queryKey: ["activeOrders"],
    queryFn: () => fetch("/api/execution/orders/active").then((r) => r.json()),
    refetchInterval: 2000,
  });

  const sorted = [...orders].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleSort = (key: keyof Order) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sideColor = (side: "BUY" | "SELL") => (side === "BUY" ? C.green : C.red);
  const statusColor = (status: string) => {
    switch (status) {
      case "FILLED":
        return C.green;
      case "PARTIAL":
        return C.yellow;
      case "OPEN":
        return C.blue;
      default:
        return C.textMuted;
    }
  };

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        overflow: "hidden",
        marginBottom: "24px",
      }}
    >
      <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}` }}>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: C.text }}>Active Orders</h3>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
              {["id", "symbol", "side", "type", "qty", "fillPercent", "price", "status", "time"].map((key) => (
                <th
                  key={key}
                  onClick={() => handleSort(key as keyof Order)}
                  style={{
                    padding: "12px 16px",
                    textAlign: "left",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: C.textDim,
                    cursor: "pointer",
                    userSelect: "none",
                    background: C.cardAlt,
                  }}
                >
                  {key.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => (
              <tr key={order.id} style={{ borderBottom: `1px solid ${C.border}`, background: C.card }}>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.textDim }}>
                  {order.id.substring(0, 8)}...
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text, fontWeight: 500 }}>
                  {order.symbol}
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: sideColor(order.side),
                  }}
                >
                  {order.side}
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.textDim }}>{order.type}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>{order.qty}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>{order.fillPercent}%</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>${order.price.toFixed(2)}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px" }}>
                  <span
                    style={{
                      background: statusColor(order.status),
                      color: C.bg,
                      padding: "4px 8px",
                      borderRadius: "3px",
                      fontWeight: 600,
                    }}
                  >
                    {order.status}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>{order.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && <div style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>Refreshing...</div>}
      {!isLoading && sorted.length === 0 && (
        <div style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>No active orders</div>
      )}
    </div>
  );
}

// ============================================================================
// SECTION 3: POSITION BOOK
// ============================================================================

function PositionBook() {
  const { data: positions = mockPositions, isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: () => fetch("/api/execution/positions").then((r) => r.json()),
    refetchInterval: 3000,
  });

  const totalSize = positions.reduce((sum: any, p: any) => sum + p.size, 0);
  const totalPnL = positions.reduce((sum: any, p: any) => sum + p.unrealizedPnL, 0);

  const pnlColor = (pnl: number) => (pnl >= 0 ? C.green : C.red);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        overflow: "hidden",
        marginBottom: "24px",
      }}
    >
      <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}` }}>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: C.text }}>Position Book</h3>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
              {["Symbol", "Side", "Size", "Entry", "Current", "Unrealized P&L", "Stop Loss", "Take Profit", "Duration"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "12px 16px",
                    textAlign: "left",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: C.textDim,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos: any) => (
              <tr key={pos.symbol} style={{ borderBottom: `1px solid ${C.border}`, background: C.card }}>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text, fontWeight: 600 }}>
                  {pos.symbol}
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: pos.side === "LONG" ? C.green : C.red,
                  }}
                >
                  {pos.side}
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>{pos.size}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>${pos.entryPrice.toFixed(2)}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>${pos.currentPrice.toFixed(2)}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", fontWeight: 600, color: pnlColor(pos.unrealizedPnL) }}>
                  ${pos.unrealizedPnL.toFixed(0)}
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>${pos.stopLoss.toFixed(2)}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>${pos.takeProfit.toFixed(2)}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>{pos.duration}</td>
              </tr>
            ))}
            <tr style={{ background: C.cardAlt, borderTop: `2px solid ${C.border}`, fontWeight: 600 }}>
              <td colSpan={2} style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>
                TOTAL
              </td>
              <td style={{ padding: "12px 16px", fontSize: "12px", color: C.text }}>{totalSize}</td>
              <td colSpan={2} />
              <td style={{ padding: "12px 16px", fontSize: "12px", fontWeight: 700, color: pnlColor(totalPnL) }}>
                ${totalPnL.toFixed(0)}
              </td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>

      {isLoading && <div style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>Loading...</div>}
    </div>
  );
}

// ============================================================================
// SECTION 4: VENUE HEALTH GRID
// ============================================================================

function VenueHealthGrid() {
  const { data: venues = mockVenues, isLoading } = useQuery({
    queryKey: ["venues"],
    queryFn: () => fetch("/api/execution/venues").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "HEALTHY":
        return C.green;
      case "DEGRADED":
        return C.yellow;
      case "ERROR":
        return C.red;
      default:
        return C.textMuted;
    }
  };

  return (
    <div style={{ marginBottom: "24px" }}>
      <h3 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: 600, color: C.text }}>Venue Health</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
        {venues.map((venue: any) => (
          <div
            key={venue.name}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: statusColor(venue.status),
                }}
              />
              <span style={{ fontSize: "13px", fontWeight: 600, color: C.text }}>{venue.name}</span>
            </div>

            <div style={{ fontSize: "12px", marginBottom: "8px" }}>
              <div style={{ color: C.textMuted, marginBottom: "4px" }}>Latency</div>
              <div style={{ color: C.text, fontWeight: 500 }}>{venue.latency.toFixed(1)}ms</div>
            </div>

            <div style={{ fontSize: "12px", marginBottom: "8px" }}>
              <div style={{ color: C.textMuted, marginBottom: "4px" }}>Fill Rate</div>
              <div
                style={{
                  background: C.cardAlt,
                  borderRadius: "3px",
                  height: "4px",
                  overflow: "hidden",
                  marginBottom: "4px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: C.green,
                    width: `${venue.fillRate}%`,
                  }}
                />
              </div>
              <div style={{ color: C.text, fontWeight: 500 }}>{venue.fillRate}%</div>
            </div>

            <div style={{ fontSize: "12px", marginBottom: "8px" }}>
              <div style={{ color: C.textMuted }}>Orders: {venue.orderCount}</div>
              <div style={{ color: C.textMuted }}>Fees: {(venue.fees * 100).toFixed(3)}%</div>
            </div>
          </div>
        ))}
      </div>

      {isLoading && <div style={{ marginTop: "12px", fontSize: "12px", color: C.textMuted }}>Loading...</div>}
    </div>
  );
}

// ============================================================================
// SECTION 5: EXECUTION STATS
// ============================================================================

function ExecutionStats() {
  const { data: report = mockReport, isLoading } = useQuery({
    queryKey: ["executionReport"],
    queryFn: () => fetch("/api/execution/report").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const stats = [
    { label: "Fill Rate", value: report.fillRate, unit: "%", color: C.green },
    { label: "Avg Slippage", value: report.avgSlippage, unit: " bps", color: C.orange },
    { label: "Total Fees", value: report.totalFees, unit: " $", color: C.text },
    { label: "Avg Fill Time", value: report.avgFillTime, unit: " ms", color: C.blue },
  ];

  return (
    <div style={{ marginBottom: "24px" }}>
      <h3 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: 600, color: C.text }}>Execution Stats</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "12px", color: C.textMuted, marginBottom: "8px" }}>{stat.label}</div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: stat.color, marginBottom: "4px" }}>
              {stat.value.toFixed(stat.label === "Total Fees" ? 2 : 1)}
              <span style={{ fontSize: "16px" }}>{stat.unit}</span>
            </div>
            <div
              style={{
                height: "2px",
                background: C.cardAlt,
                borderRadius: "1px",
                marginTop: "8px",
              }}
            />
          </div>
        ))}
      </div>

      {isLoading && <div style={{ marginTop: "12px", fontSize: "12px", color: C.textMuted }}>Loading...</div>}
    </div>
  );
}

// ============================================================================
// SECTION 6: RECENT FILLS FEED
// ============================================================================

function RecentFillsFeed() {
  const { data: fills = mockFills, isLoading } = useQuery({
    queryKey: ["fills"],
    queryFn: () => fetch("/api/execution/fills").then((r) => r.json()),
    refetchInterval: 3000,
  });

  const sideColor = (side: "BUY" | "SELL") => (side === "BUY" ? C.green : C.red);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        overflow: "hidden",
        marginBottom: "24px",
      }}
    >
      <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}` }}>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: C.text }}>Recent Fills</h3>
      </div>

      <div style={{ maxHeight: "400px", overflowY: "auto" }}>
        {fills.map((fill: any, i: any) => (
          <div
            key={i}
            style={{
              padding: "12px 16px",
              borderBottom: i < fills.length - 1 ? `1px solid ${C.border}` : "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12px", color: C.textMuted, marginBottom: "4px" }}>{fill.time}</div>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: C.text }}>{fill.symbol}</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: sideColor(fill.side) }}>{fill.side}</span>
                <span style={{ fontSize: "12px", color: C.textDim }}>
                  {fill.qty} @ ${fill.price.toFixed(2)}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: C.textMuted, minWidth: "50px", textAlign: "right" }}>
                {fill.venue}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  background: C.cardAlt,
                  color: C.textMuted,
                  padding: "4px 8px",
                  borderRadius: "3px",
                  fontWeight: 500,
                }}
              >
                {fill.slippage.toFixed(1)} bps
              </span>
            </div>
          </div>
        ))}
      </div>

      {isLoading && <div style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>Loading...</div>}
      {!isLoading && fills.length === 0 && (
        <div style={{ padding: "12px 16px", fontSize: "12px", color: C.textMuted }}>No recent fills</div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ExecutionControlPage() {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 32px 0", fontSize: "28px", fontWeight: 700, color: C.text }}>Execution Control</h1>

        <ExecutionModeBanner />
        <ActiveOrdersTable />
        <PositionBook />
        <VenueHealthGrid />
        <ExecutionStats />
        <RecentFillsFeed />
      </div>
    </div>
  );
}
