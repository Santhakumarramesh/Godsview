import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type PaperPosition = {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  current_price: number;
  quantity: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
};

type PaperFill = {
  fill_id: string;
  symbol: string;
  price: number;
  quantity: number;
  timestamp: string;
};

export default function PaperTradingPage() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");

  const { data: positionsData, isLoading } = useQuery({
    queryKey: ["paper-trading", "positions"],
    queryFn: () => fetch(`${API}/api/paper-trading/positions`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: pnlData } = useQuery({
    queryKey: ["paper-trading", "pnl"],
    queryFn: () => fetch(`${API}/api/paper-trading/pnl`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const placePaperOrderMutation = useMutation({
    mutationFn: (data: { symbol: string; direction: string; quantity: number; price: number }) =>
      fetch(`${API}/api/paper-trading/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paper-trading"] });
      setSymbol("");
      setQuantity("");
      setPrice("");
    },
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading paper trading data...</div>;
  }

  const positions: PaperPosition[] = positionsData?.positions || [];
  const totalPnL: number = pnlData?.total_pnl || 0;
  const fills: PaperFill[] = pnlData?.fills || [];

  return (
    <div style={{ padding: "32px", backgroundColor: "#0e0e0f" }}>
      <h1
        style={{
          fontSize: "28px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "32px",
          fontFamily: "Space Grotesk",
        }}
      >
        Paper Trading Arena
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "32px" }}>
        <div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "16px",
              fontFamily: "Space Grotesk",
            }}
          >
            Place Paper Order
          </h2>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                style={{
                  width: "100%",
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  color: "#ffffff",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  marginTop: "4px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Direction</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "long" | "short")}
                  style={{
                    width: "100%",
                    backgroundColor: "#0e0e0f",
                    border: "1px solid rgba(72,72,73,0.2)",
                    color: "#ffffff",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    marginTop: "4px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "13px",
                  }}
                >
                  <option value="long">LONG</option>
                  <option value="short">SHORT</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Quantity</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="100"
                  style={{
                    width: "100%",
                    backgroundColor: "#0e0e0f",
                    border: "1px solid rgba(72,72,73,0.2)",
                    color: "#ffffff",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    marginTop: "4px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Price</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                step="0.01"
                style={{
                  width: "100%",
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  color: "#ffffff",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  marginTop: "4px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={() => {
                if (symbol && quantity && price) {
                  placePaperOrderMutation.mutate({
                    symbol,
                    direction,
                    quantity: parseInt(quantity),
                    price: parseFloat(price),
                  });
                }
              }}
              style={{
                width: "100%",
                backgroundColor: "#9cff93",
                border: "none",
                color: "#0e0e0f",
                padding: "12px",
                borderRadius: "6px",
                fontWeight: "600",
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              Place Order
            </button>
          </div>
        </div>

        <div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "16px",
              fontFamily: "Space Grotesk",
            }}
          >
            Paper P&L
          </h2>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Total P&L</div>
              <div
                style={{
                  fontSize: "32px",
                  fontWeight: "600",
                  color: totalPnL > 0 ? "#9cff93" : totalPnL < 0 ? "#ff8a8a" : "#767576",
                  marginTop: "8px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {totalPnL > 0 ? "+" : ""}
                {totalPnL.toFixed(2)}
              </div>
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "#767576",
                padding: "12px",
                backgroundColor: "rgba(72,72,73,0.1)",
                borderRadius: "6px",
              }}
            >
              Positions: {positions.length} | Fills: {fills.length}
            </div>
          </div>
        </div>
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Paper Positions
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
          overflowX: "auto",
        }}
      >
        {positions.length === 0 ? (
          <div style={{ color: "#767576", textAlign: "center", padding: "32px" }}>No paper positions open</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "12px",
              minWidth: "800px",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Symbol</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Direction</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Entry</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Current</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Qty</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>P&L</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>P&L %</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.symbol} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <td style={{ padding: "12px", color: "#ffffff", fontWeight: "600" }}>{pos.symbol}</td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: pos.direction === "long" ? "#9cff93" : "#ff8a8a",
                    }}
                  >
                    {pos.direction.toUpperCase()}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                    {pos.entry_price.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                    {pos.current_price.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                    {pos.quantity}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: pos.unrealized_pnl > 0 ? "#9cff93" : "#ff8a8a",
                    }}
                  >
                    {pos.unrealized_pnl > 0 ? "+" : ""}
                    {pos.unrealized_pnl.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: pos.unrealized_pnl_pct > 0 ? "#9cff93" : "#ff8a8a",
                    }}
                  >
                    {pos.unrealized_pnl_pct > 0 ? "+" : ""}
                    {(pos.unrealized_pnl_pct * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Recent Fills
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          overflowX: "auto",
        }}
      >
        {fills.length === 0 ? (
          <div style={{ color: "#767576", textAlign: "center", padding: "32px" }}>No fills yet</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "12px",
              minWidth: "600px",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Time</th>
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Symbol</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Price</th>
                <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {fills.slice(-10).map((fill) => (
                <tr key={fill.fill_id} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <td style={{ padding: "12px", color: "#767576" }}>
                    {new Date(fill.timestamp).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: "12px", color: "#ffffff", fontWeight: "600" }}>{fill.symbol}</td>
                  <td style={{ padding: "12px", textAlign: "right", color: "#9cff93" }}>
                    {fill.price.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                    {fill.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
