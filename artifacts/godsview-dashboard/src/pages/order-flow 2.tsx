import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const cardStyle = {
  backgroundColor: "#1a191b",
  border: "1px solid rgba(72,72,73,0.2)",
  borderRadius: "12px",
  padding: "24px",
};

const MetricCard = ({ label, value, color = "#ffffff" }) => (
  <div style={cardStyle}>
    <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
      {label}
    </p>
    <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color, margin: 0 }}>
      {value}
    </p>
  </div>
);

export default function OrderFlow() {
  const [symbol, setSymbol] = useState("AAPL");

  const { data: features = {}, isLoading, error } = useQuery({
    queryKey: ["features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch features");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const deltaHistory = features.delta_history || [];
  const absorptionEvents = features.absorption_events || [];
  const flowSignals = features.flow_signals || [];

  const deltaMax = useMemo(() => {
    if (!deltaHistory.length) return 1;
    return Math.max(...deltaHistory.map(d => Math.abs(d)), 1);
  }, [deltaHistory]);

  const executionControl = useMemo(() => {
    const buyAgg = features.aggressive_buyers || 0;
    const sellAgg = features.aggressive_sellers || 0;
    if (buyAgg > sellAgg + 10) return { label: "BUYERS IN CONTROL", color: "#9cff93", pct: 75 };
    if (sellAgg > buyAgg + 10) return { label: "SELLERS IN CONTROL", color: "#ff6464", pct: 75 };
    return { label: "NEUTRAL", color: "#ffcc00", pct: 50 };
  }, [features.aggressive_buyers, features.aggressive_sellers]);

  const imbalancePersistence = useMemo(() => {
    const ratio = features.imbalance_ratio || 1;
    if (ratio > 1.5) return "Strong Buy Momentum";
    if (ratio < 0.67) return "Strong Sell Pressure";
    return "Balanced Market";
  }, [features.imbalance_ratio]);

  if (error) {
    return (
      <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px", color: "#ffffff" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <h1 style={{ fontFamily: "Space Grotesk" }}>Error Loading Data</h1>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Order Flow Dashboard
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Advanced delta analysis, imbalances, and market structure</p>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Enter symbol (e.g. AAPL)..."
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "12px 16px",
              fontFamily: "Space Grotesk",
              color: "#ffffff",
              fontSize: "14px",
              width: "100%",
              maxWidth: "300px",
            }}
          />
        </div>

        {isLoading && (
          <div style={{ color: "#767576", fontFamily: "Space Grotesk" }}>
            Loading {symbol} data...
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          <MetricCard label="BUY VOLUME" value={features.buy_volume?.toLocaleString() || "—"} />
          <MetricCard label="SELL VOLUME" value={features.sell_volume?.toLocaleString() || "—"} />
          <MetricCard
            label="DELTA"
            value={features.delta?.toLocaleString() || "—"}
            color={features.delta > 0 ? "#9cff93" : "#ff6464"}
          />
          <MetricCard label="CUMULATIVE DELTA" value={features.cumulative_delta?.toLocaleString() || "—"} />
          <MetricCard label="IMBALANCE RATIO" value={(features.imbalance_ratio || 0).toFixed(2)} />
          <MetricCard label="ABSORPTION EVENTS" value={absorptionEvents.length} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
              Delta Visualization
            </h2>
            <div style={{
              height: "220px",
              backgroundColor: "#0e0e0f",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-around",
              padding: "16px",
              gap: "4px",
            }}>
              {deltaHistory.length ? (
                deltaHistory.slice(-20).map((delta, i) => {
                  const pct = Math.abs(delta) / deltaMax;
                  const height = Math.max(pct * 180, 4);
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        height: "180px",
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          height: `${height}px`,
                          width: "100%",
                          backgroundColor: delta > 0 ? "#9cff93" : "#ff6464",
                          borderRadius: "2px",
                          opacity: 0.8,
                        }}
                      />
                    </div>
                  );
                })
              ) : (
                <p style={{ color: "#767576", margin: 0 }}>No delta history available</p>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
              Aggression Meter
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff" }}>
                    Buyer Aggression
                  </span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", color: "#9cff93" }}>
                    {(features.aggressive_buyers || 0).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: "10px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(features.aggressive_buyers || 0, 100)}%`, backgroundColor: "#9cff93", transition: "width 0.3s" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff" }}>
                    Seller Aggression
                  </span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", color: "#ff6464" }}>
                    {(features.aggressive_sellers || 0).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: "10px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(features.aggressive_sellers || 0, 100)}%`, backgroundColor: "#ff6464", transition: "width 0.3s" }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
              Execution Pressure
            </h2>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff" }}>
                  {executionControl.label}
                </span>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: executionControl.color }}>
                  {executionControl.pct}%
                </span>
              </div>
              <div style={{ height: "12px", backgroundColor: "#0e0e0f", borderRadius: "6px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${executionControl.pct}%`, backgroundColor: executionControl.color, transition: "width 0.3s" }} />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
              Imbalance Engine
            </h2>
            <div>
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                Ratio: {(features.imbalance_ratio || 0).toFixed(2)}
              </p>
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: 0 }}>
                {imbalancePersistence}
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
              Absorption Detection
            </h2>
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {absorptionEvents.length ? (
                absorptionEvents.map((event, i) => (
                  <div key={i} style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff" }}>
                        Price: {event.price}
                      </span>
                      <span style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: event.side === "buy" ? "#9cff93" : "#ff6464", backgroundColor: event.side === "buy" ? "rgba(156,255,147,0.1)" : "rgba(255,100,100,0.1)", padding: "2px 8px", borderRadius: "4px" }}>
                        {event.side?.toUpperCase()}
                      </span>
                    </div>
                    <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: "0 0 2px 0" }}>
                      Vol: {event.volume?.toLocaleString()}
                    </p>
                    <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576", margin: 0 }}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                ))
              ) : (
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: 0 }}>
                  No absorption events detected
                </p>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
              Flow Signals Timeline
            </h2>
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {flowSignals.length ? (
                flowSignals.reverse().map((signal, i) => (
                  <div key={i} style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff" }}>
                        {signal.type || "Signal"}
                      </span>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576" }}>
                        {new Date(signal.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#9cff93", margin: 0 }}>
                      {signal.description || "Flow event"}
                    </p>
                  </div>
                ))
              ) : (
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: 0 }}>
                  No flow signals available
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
