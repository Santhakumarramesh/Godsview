import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

// Placeholder data for fallback
const PLACEHOLDER_BIDS = [
  { price: 150.45, size: 2500 },
  { price: 150.40, size: 1800 },
  { price: 150.35, size: 3200 },
  { price: 150.30, size: 2100 },
  { price: 150.25, size: 1900 },
  { price: 150.20, size: 2300 },
  { price: 150.15, size: 1600 },
  { price: 150.10, size: 2800 },
  { price: 150.05, size: 1900 },
  { price: 150.00, size: 2200 },
];

const PLACEHOLDER_ASKS = [
  { price: 150.55, size: 2100 },
  { price: 150.60, size: 1700 },
  { price: 150.65, size: 3100 },
  { price: 150.70, size: 2200 },
  { price: 150.75, size: 1800 },
  { price: 150.80, size: 2400 },
  { price: 150.85, size: 1900 },
  { price: 150.90, size: 2600 },
  { price: 150.95, size: 2100 },
  { price: 151.00, size: 2300 },
];

export default function DOMDepth() {
  const [symbol, setSymbol] = useState("AAPL");
  const [depthLevel, setDepthLevel] = useState(10);
  const [previousBids, setPreviousBids] = useState<{ price: number; size: number }[]>([]);
  const [previousAsks, setPreviousAsks] = useState<{ price: number; size: number }[]>([]);

  const { data: quote = {}, isLoading: quoteLoading, error: quoteError } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/alpaca/quote/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch quote");
      return res.json();
    },
    refetchInterval: 3000,
    enabled: !!symbol,
  });

  const { data: orderbookRaw = {}, isLoading: orderbookLoading, error: orderbookError } = useQuery({
    queryKey: ["orderbook-depth", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/orderbook?symbol=${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch orderbook");
      return res.json();
    },
    refetchInterval: 3000,
    enabled: !!symbol,
  });

  // Use real data or fallback to placeholder
  const rawBids = useMemo(() => {
    return (orderbookRaw?.bids?.slice(0, depthLevel) || PLACEHOLDER_BIDS.slice(0, depthLevel)) as Array<{ price: number; size: number }>;
  }, [orderbookRaw, depthLevel]);

  const rawAsks = useMemo(() => {
    return (orderbookRaw?.asks?.slice(0, depthLevel) || PLACEHOLDER_ASKS.slice(0, depthLevel)) as Array<{ price: number; size: number }>;
  }, [orderbookRaw, depthLevel]);

  // Compute cumulative sizes and track changes
  const bids = useMemo(() => {
    let cumSize = 0;
    return rawBids.map((b, i) => {
      cumSize += b.size;
      const prev = previousBids[i];
      const sizeChanged = prev && Math.abs(b.size - prev.size) > prev.size * 0.2;
      return { ...b, cum: cumSize, sizeChanged };
    });
  }, [rawBids, previousBids]);

  const asks = useMemo(() => {
    let cumSize = 0;
    return rawAsks.map((a, i) => {
      cumSize += a.size;
      const prev = previousAsks[i];
      const sizeChanged = prev && Math.abs(a.size - prev.size) > prev.size * 0.2;
      return { ...a, cum: cumSize, sizeChanged };
    });
  }, [rawAsks, previousAsks]);

  // Update previous data for flash detection
  useEffect(() => {
    if (bids.length > 0) setPreviousBids(bids.map(b => ({ price: b.price, size: b.size })));
  }, [bids]);

  useEffect(() => {
    if (asks.length > 0) setPreviousAsks(asks.map(a => ({ price: a.price, size: a.size })));
  }, [asks]);

  const bidPrice = quote.bid_price || 150.45;
  const askPrice = quote.ask_price || 150.55;
  const spread = askPrice - bidPrice;
  const midPrice = (bidPrice + askPrice) / 2;

  const maxSize = Math.max(...bids.map(b => b.size), ...asks.map(a => a.size), 1);
  const totalBidDepth = bids.reduce((s, b) => s + b.size, 0);
  const totalAskDepth = asks.reduce((s, a) => s + a.size, 0);
  const depthRatio = totalBidDepth / (totalBidDepth + totalAskDepth) || 0.5;

  const isLoading = quoteLoading || orderbookLoading;
  const hasError = quoteError || orderbookError;

  // Detect spoof-like events (placeholder)
  const spoofEvents = [
    { time: "14:32:15", symbol: "AAPL", size: 50000, duration: "2s", status: "Pulled" },
  ];

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            DOM/Depth Monitor
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Real-time bid/ask ladder with depth visualization</p>
        </div>

        {hasError && (
          <div style={{
            backgroundColor: "rgba(255, 100, 100, 0.1)",
            border: "1px solid #ff6464",
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "24px",
            color: "#ff6464",
            fontSize: "13px",
            fontFamily: "Space Grotesk",
          }}>
            ⚠ MOCK DATA — backend unreachable. The DOM/depth values shown below are placeholders, not live order book data.
          </div>
        )}

        <div style={{ display: "flex", gap: "16px", marginBottom: "24px", alignItems: "center" }}>
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
              flex: 1,
              maxWidth: "200px",
            }}
          />
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Levels:</span>
            {[5, 10, 20, 50].map(level => (
              <button
                key={level}
                onClick={() => setDepthLevel(level)}
                style={{
                  backgroundColor: depthLevel === level ? "#9cff93" : "#1a191b",
                  border: `1px solid ${depthLevel === level ? "#9cff93" : "rgba(72,72,73,0.2)"}`,
                  color: depthLevel === level ? "#0e0e0f" : "#ffffff",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontWeight: depthLevel === level ? "600" : "400",
                }}
              >
                {level}
              </button>
            ))}
          </div>
          {isLoading && <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Refreshing...</span>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
          {[
            { label: "BID PRICE", value: bidPrice.toFixed(2), color: "#9cff93" },
            { label: "ASK PRICE", value: askPrice.toFixed(2), color: "#ff6464" },
            { label: "SPREAD", value: spread.toFixed(4), color: "#9cff93" },
            { label: "MID PRICE", value: midPrice.toFixed(2), color: "#ffffff" },
            { label: "BID DEPTH", value: totalBidDepth.toLocaleString(), color: "#9cff93" },
            { label: "ASK DEPTH", value: totalAskDepth.toLocaleString(), color: "#ff6464" },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: stat.color, margin: "0 0 8px 0" }}>
                {stat.label}
              </p>
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "18px", color: "#ffffff", margin: 0 }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: "16px", marginBottom: "24px" }}>
          <div style={{ height: "12px", backgroundColor: "#1a191b", borderRadius: "6px", border: "1px solid rgba(72,72,73,0.2)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                backgroundColor: "#9cff93",
                width: `${depthRatio * 100}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
            Bid {(depthRatio * 100).toFixed(0)}% / Ask {((1 - depthRatio) * 100).toFixed(0)}%
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "20px",
          }}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: "#9cff93", marginBottom: "12px", margin: 0 }}>
              BID SIDE
            </h2>
            <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)", position: "sticky", top: 0, backgroundColor: "#1a191b" }}>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "10px" }}>PRICE</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "10px" }}>SIZE</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "10px" }}>CUM</th>
                    <th style={{ padding: "6px 8px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "10px" }}>BAR</th>
                  </tr>
                </thead>
                <tbody>
                  {bids.map((bid, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid rgba(72,72,73,0.2)",
                        backgroundColor: bid.sizeChanged ? "rgba(156, 255, 147, 0.1)" : "transparent",
                        transition: "background-color 0.5s ease",
                      }}
                    >
                      <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "JetBrains Mono, monospace", color: "#9cff93" }}>
                        {bid.price.toFixed(2)}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>
                        {bid.size.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "JetBrains Mono, monospace", color: "#767576" }}>
                        {bid.cum.toLocaleString()}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        <div style={{ display: "inline-block", height: "6px", backgroundColor: "#9cff93", borderRadius: "2px", width: Math.max(2, (bid.size / maxSize) * 80) + "px" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "20px",
          }}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: "#ff6464", marginBottom: "12px", margin: 0 }}>
              ASK SIDE
            </h2>
            <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)", position: "sticky", top: 0, backgroundColor: "#1a191b" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>BAR</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>CUM</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>SIZE</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>PRICE</th>
                  </tr>
                </thead>
                <tbody>
                  {asks.map((ask, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid rgba(72,72,73,0.2)",
                        backgroundColor: ask.sizeChanged ? "rgba(255, 100, 100, 0.1)" : "transparent",
                        transition: "background-color 0.5s ease",
                      }}
                    >
                      <td style={{ padding: "6px 8px", textAlign: "left" }}>
                        <div style={{ display: "inline-block", height: "6px", backgroundColor: "#ff6464", borderRadius: "2px", width: Math.max(2, (ask.size / maxSize) * 80) + "px" }} />
                      </td>
                      <td style={{ textAlign: "left", padding: "6px 8px", fontFamily: "JetBrains Mono, monospace", color: "#767576" }}>
                        {ask.cum.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>
                        {ask.size.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "JetBrains Mono, monospace", color: "#ff6464" }}>
                        {ask.price.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "20px",
        }}>
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: "#ffffff", marginBottom: "12px", margin: 0 }}>
            Spoof Detection Alerts
          </h2>
          {spoofEvents.length === 0 ? (
            <p style={{ color: "#767576", fontFamily: "Space Grotesk", fontSize: "12px", margin: 0 }}>
              No suspicious activity detected
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                    <th style={{ textAlign: "left", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>TIME</th>
                    <th style={{ textAlign: "left", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>SYMBOL</th>
                    <th style={{ textAlign: "right", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>SIZE</th>
                    <th style={{ textAlign: "right", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>DURATION</th>
                    <th style={{ textAlign: "left", padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464", fontSize: "10px" }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {spoofEvents.map((event, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                      <td style={{ padding: "8px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>{event.time}</td>
                      <td style={{ padding: "8px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>{event.symbol}</td>
                      <td style={{ textAlign: "right", padding: "8px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>{event.size.toLocaleString()}</td>
                      <td style={{ textAlign: "right", padding: "8px", fontFamily: "JetBrains Mono, monospace", color: "#767576" }}>{event.duration}</td>
                      <td style={{ padding: "8px", fontFamily: "Space Grotesk", color: "#ff6464" }}>{event.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
