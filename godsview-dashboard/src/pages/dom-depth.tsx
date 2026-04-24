import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function DOMDepth() {
  const [symbol, setSymbol] = useState("AAPL");

  const { data: quote = {} } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/alpaca/quote/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch quote");
      return res.json();
    },
  });

  const { data: orderbook = {} } = useQuery({
    queryKey: ["orderbook-depth", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/orderbook`);
      if (!res.ok) throw new Error("Failed to fetch orderbook");
      return res.json();
    },
  });

  const bids = [
    { price: 150.45, size: 2500, cum: 2500 },
    { price: 150.40, size: 1800, cum: 4300 },
    { price: 150.35, size: 3200, cum: 7500 },
    { price: 150.30, size: 2100, cum: 9600 },
    { price: 150.25, size: 1900, cum: 11500 },
  ];

  const asks = [
    { price: 150.55, size: 2100, cum: 2100 },
    { price: 150.60, size: 1700, cum: 3800 },
    { price: 150.65, size: 3100, cum: 6900 },
    { price: 150.70, size: 2200, cum: 9100 },
    { price: 150.75, size: 1800, cum: 10900 },
  ];

  const maxSize = 3500;
  const spread = (quote.ask_price || 150.55) - (quote.bid_price || 150.45);

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            DOM/Depth Monitor
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Real-time bid/ask ladder with depth visualization</p>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Enter symbol..."
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "10px 12px",
              fontFamily: "Space Grotesk",
              color: "#ffffff",
              fontSize: "14px",
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "16px",
              textAlign: "center",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#9cff93", margin: "0 0 8px 0" }}>
              BID PRICE
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "20px", color: "#ffffff", margin: 0 }}>
              {quote.bid_price || "—"}
            </p>
          </div>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "16px",
              textAlign: "center",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#ffffff", margin: "0 0 8px 0" }}>
              SPREAD
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "20px", color: "#9cff93", margin: 0 }}>
              {spread.toFixed(2)}
            </p>
          </div>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "16px",
              textAlign: "center",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#ff6464", margin: "0 0 8px 0" }}>
              ASK PRICE
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "20px", color: "#ffffff", margin: 0 }}>
              {quote.ask_price || "—"}
            </p>
          </div>
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Bid/Ask Ladder
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ textAlign: "left", padding: "8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "11px" }}>
                    BID PRICE
                  </th>
                  <th style={{ textAlign: "right", padding: "8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "11px" }}>
                    SIZE
                  </th>
                  <th style={{ textAlign: "right", padding: "8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "11px" }}>
                    CUM SIZE
                  </th>
                  <th style={{ padding: "8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "11px" }}>
                    VIZ
                  </th>
                </tr>
              </thead>
              <tbody>
                {bids.map((bid, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                    <td style={{ padding: "8px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#9cff93" }}>
                      {bid.price.toFixed(2)}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {bid.size.toLocaleString()}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
                      {bid.cum.toLocaleString()}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ height: "4px", width: `${(bid.size / maxSize) * 100}px`, backgroundColor: "#9cff93", borderRadius: "2px" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ textAlign: "center", padding: "16px", borderTop: "2px solid rgba(72,72,73,0.2)", margin: "16px 0" }}>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: 0 }}>
              MID: {((quote.bid_price || 150.45) + (quote.ask_price || 150.55)) / 2}
            </p>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ textAlign: "left", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "11px" }}>
                    ASK PRICE
                  </th>
                  <th style={{ textAlign: "right", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "11px" }}>
                    SIZE
                  </th>
                  <th style={{ textAlign: "right", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "11px" }}>
                    CUM SIZE
                  </th>
                  <th style={{ padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "11px" }}>
                    VIZ
                  </th>
                </tr>
              </thead>
              <tbody>
                {asks.map((ask, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                    <td style={{ padding: "8px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ff6464" }}>
                      {ask.price.toFixed(2)}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {ask.size.toLocaleString()}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
                      {ask.cum.toLocaleString()}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ height: "4px", width: `${(ask.size / maxSize) * 100}px`, backgroundColor: "#ff6464", borderRadius: "2px" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
