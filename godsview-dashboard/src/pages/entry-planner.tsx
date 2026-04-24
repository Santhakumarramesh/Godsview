import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function EntryPlanner() {
  const [entry, setEntry] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);
  const [takeProfit, setTakeProfit] = useState(0);
  const [riskPercent, setRiskPercent] = useState(1);
  const [symbol, setSymbol] = useState("BTCUSD");

  const { data: setup } = useQuery({
    queryKey: ["brain", "setup", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/brain/setup?symbol=${symbol}`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: account } = useQuery({
    queryKey: ["alpaca", "account"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/alpaca/account`);
      return res.json();
    },
    refetchInterval: 120000,
  });

  const { data: riskCheck } = useQuery({
    queryKey: ["risk", "check"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/risk/check`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const accountBalance = account?.equity || 10000;
  const riskAmount = (accountBalance * riskPercent) / 100;
  const pipsDifference = Math.abs(entry - stopLoss);
  const positionSize = pipsDifference > 0 ? riskAmount / pipsDifference : 0;
  const rewardAmount = Math.abs(takeProfit - entry);
  const rrRatio = pipsDifference > 0 ? rewardAmount / pipsDifference : 0;

  return (
    <div
      style={{
        backgroundColor: "#0e0e0f",
        color: "#ffffff",
        minHeight: "100vh",
        padding: "24px",
        fontFamily: '"Space Grotesk", sans-serif',
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ marginBottom: "16px" }}>Entry/Stop/Target Planner</h1>
        <input
          type="text"
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "#ffffff",
            width: "200px",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Price Levels
          </h2>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Entry Price
            </label>
            <input
              type="number"
              value={entry}
              onChange={(e) => setEntry(parseFloat(e.target.value))}
              placeholder="0.00"
              style={{
                width: "100%",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Stop Loss
            </label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(parseFloat(e.target.value))}
              placeholder="0.00"
              style={{
                width: "100%",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Take Profit
            </label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
              placeholder="0.00"
              style={{
                width: "100%",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Risk % of Account
            </label>
            <input
              type="number"
              value={riskPercent}
              onChange={(e) => setRiskPercent(Math.min(10, parseFloat(e.target.value)))}
              min="0.1"
              max="10"
              step="0.1"
              style={{
                width: "100%",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            />
          </div>
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Calculations
          </h2>

          <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Account Balance</div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: "#9cff93",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              ${accountBalance.toFixed(2)}
            </div>
          </div>

          <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Risk Amount</div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: "#ff6b6b",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              ${riskAmount.toFixed(2)}
            </div>
          </div>

          <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Position Size</div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: "#9cff93",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {positionSize.toFixed(2)} units
            </div>
          </div>

          <div>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Risk:Reward Ratio</div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: rrRatio >= 2 ? "#9cff93" : "#ff6b6b",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              1:{rrRatio.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
