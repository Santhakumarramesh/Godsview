import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function PremiumDiscount() {
  const [symbol, setSymbol] = useState("BTCUSD");

  const { data: features, isLoading: loadingFeatures, error: errorFeatures } = useQuery({
    queryKey: ["features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: bars, isLoading: loadingBars, error: errorBars } = useQuery({
    queryKey: ["bars", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/bars/${symbol}?timeframe=1h&limit=200`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const equilibrium = features?.equilibriumPrice || 0;
  const premiumZone = features?.premiumZone || { high: 0, low: 0 };
  const discountZone = features?.discountZone || { high: 0, low: 0 };
  const currentPrice = bars?.bars?.[bars.bars.length - 1]?.c || 0;

  const getPosition = () => {
    if (currentPrice > premiumZone.high) return "ABOVE PREMIUM";
    if (currentPrice >= premiumZone.low) return "IN PREMIUM";
    if (currentPrice > discountZone.high) return "NEUTRAL";
    if (currentPrice >= discountZone.low) return "IN DISCOUNT";
    return "BELOW DISCOUNT";
  };

  const getPositionColor = () => {
    const pos = getPosition();
    if (pos.includes("PREMIUM")) return "#ff6b6b";
    if (pos.includes("DISCOUNT")) return "#9cff93";
    return "#767576";
  };

  const getGaugePercentage = () => {
    const range = (premiumZone.high || 0) - (discountZone.low || 0);
    const offset = currentPrice - (discountZone.low || 0);
    return Math.max(0, Math.min(100, (offset / range) * 100));
  };

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
        <h1 style={{ marginBottom: "16px" }}>Premium/Discount Map</h1>
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

      {(loadingFeatures || loadingBars) && (
        <div style={{ textAlign: "center", padding: "40px", color: "#767576" }}>Loading data...</div>
      )}

      {(errorFeatures || errorBars) && (
        <div style={{ backgroundColor: "#1a191b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ color: "#ff6b6b", fontSize: "14px" }}>Failed to load data</div>
          <div style={{ color: "#767576", fontSize: "12px", marginTop: "4px" }}>Check API connection</div>
        </div>
      )}

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
            Price Position
          </h2>
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Current Price</div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "700",
                color: "#9cff93",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              ${currentPrice.toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Status</div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: "700",
                color: getPositionColor(),
                textTransform: "uppercase",
              }}
            >
              {getPosition()}
            </div>
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
            Key Levels
          </h2>
          <div style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace', lineHeight: "1.8" }}>
            <div style={{ marginBottom: "8px" }}>
              <span style={{ color: "#767576" }}>Equilibrium:</span>
              <span style={{ color: "#9cff93", marginLeft: "8px" }}>${equilibrium.toFixed(2)}</span>
            </div>
            <div style={{ marginBottom: "8px" }}>
              <span style={{ color: "#767576" }}>Premium High:</span>
              <span style={{ color: "#ff6b6b", marginLeft: "8px" }}>${premiumZone.high?.toFixed(2)}</span>
            </div>
            <div style={{ marginBottom: "8px" }}>
              <span style={{ color: "#767576" }}>Premium Low:</span>
              <span style={{ color: "#ff6b6b", marginLeft: "8px" }}>${premiumZone.low?.toFixed(2)}</span>
            </div>
            <div style={{ marginBottom: "8px" }}>
              <span style={{ color: "#767576" }}>Discount High:</span>
              <span style={{ color: "#9cff93", marginLeft: "8px" }}>${discountZone.high?.toFixed(2)}</span>
            </div>
            <div>
              <span style={{ color: "#767576" }}>Discount Low:</span>
              <span style={{ color: "#9cff93", marginLeft: "8px" }}>${discountZone.low?.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginTop: "20px",
        }}
      >
        <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
          Range Gauge
        </h2>
        <div style={{ marginBottom: "12px" }}>
          <div
            style={{
              height: "32px",
              backgroundColor: "#0e0e0f",
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid rgba(72,72,73,0.2)",
              position: "relative",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${getGaugePercentage()}%`,
                backgroundColor: getPositionColor(),
                transition: "width 0.3s ease",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${getGaugePercentage()}%`,
                top: "0",
                height: "100%",
                width: "2px",
                backgroundColor: "#ffffff",
                transform: "translateX(-50%)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "8px" }}>
            <span style={{ color: "#767576" }}>Discount</span>
            <span style={{ color: "#767576" }}>Neutral</span>
            <span style={{ color: "#767576" }}>Premium</span>
          </div>
        </div>
      </div>
    </div>
  );
}
