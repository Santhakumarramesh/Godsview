import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function FootprintDelta() {
  const [symbol, setSymbol] = useState("AAPL");

  const { data: features = {}, isLoading: loadingFeatures, error: errorFeatures } = useQuery({
    queryKey: ["delta-features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch features");
      return res.json();
    },
  });

  // Pull real delta clusters from the features payload when available;
  // otherwise show empty (zeros) — no fabricated direction or magnitude.
  const featuresAny = features as any;
  const realClusters: Array<{ level: number; delta: number; bullish: boolean }> =
    Array.isArray(featuresAny?.delta_clusters) ? featuresAny.delta_clusters
      : Array.isArray(featuresAny?.clusters) ? featuresAny.clusters
      : [];
  const clusters = realClusters.length > 0
    ? realClusters
    : Array.from({ length: 8 }, (_, i) => ({
        level: 150 + i * 0.5,
        delta: 0,
        bullish: false,
      }));

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Footprint/Delta View
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Delta clusters, imbalance candles, and volume aggression</p>
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

        {loadingFeatures && (
          <div style={{ textAlign: "center", padding: "40px", color: "#767576" }}>Loading data...</div>
        )}

        {errorFeatures && (
          <div style={{ backgroundColor: "#1a191b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
            <div style={{ color: "#ff6b6b", fontSize: "14px" }}>Failed to load data</div>
            <div style={{ color: "#767576", fontSize: "12px", marginTop: "4px" }}>Check API connection</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
              NET DELTA
            </p>
            <p style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "28px",
              color: (features.net_delta || 0) > 0 ? "#9cff93" : "#ff6464",
              margin: 0,
            }}>
              {((features.net_delta || 0) > 0 ? "+" : "") + (features.net_delta || 0).toFixed(0)}
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
              AGGRESSIVE BUYERS %
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "28px", color: "#9cff93", margin: 0 }}>
              {(features.aggressive_buyers || 0).toFixed(1)}%
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ff6464", margin: "0 0 8px 0" }}>
              AGGRESSIVE SELLERS %
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "28px", color: "#ff6464", margin: 0 }}>
              {(features.aggressive_sellers || 0).toFixed(1)}%
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
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
            Delta Clusters
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {clusters.map((cluster, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ minWidth: "60px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
                  {cluster.level.toFixed(2)}
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    height: "24px",
                    backgroundColor: "#0e0e0f",
                    borderRadius: "4px",
                    overflow: "hidden",
                  }}
                >
                  {cluster.delta > 0 ? (
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.abs(cluster.delta)}%`,
                        backgroundColor: "#9cff93",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        marginLeft: `${100 + cluster.delta}%`,
                        width: `${Math.abs(cluster.delta)}%`,
                        backgroundColor: "#ff6464",
                      }}
                    />
                  )}
                </div>
                <div style={{ minWidth: "50px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: cluster.bullish ? "#9cff93" : "#ff6464", textAlign: "right" }}>
                  {cluster.delta.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
              Imbalance Candles
            </h2>
            <div
              style={{
                height: "150px",
                backgroundColor: "#0e0e0f",
                borderRadius: "8px",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-around",
                padding: "16px",
              }}
            >
              {[30, 65, 45, 80, 50, 70, 55, 75].map((val, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                  <div style={{ height: `${val}px`, width: "12px", backgroundColor: val > 50 ? "#9cff93" : "#ff6464", borderRadius: "2px" }} />
                  <div style={{ height: "2px", width: "16px", backgroundColor: "#767576" }} />
                </div>
              ))}
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
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
              Volume Aggression
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: 0 }}>
                    Buyer Aggression
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#9cff93", margin: 0 }}>
                    {(features.buyer_aggression || 0).toFixed(1)}
                  </p>
                </div>
                <div style={{ height: "8px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(features.buyer_aggression || 0) * 10}%`, backgroundColor: "#9cff93" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: 0 }}>
                    Seller Aggression
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ff6464", margin: 0 }}>
                    {(features.seller_aggression || 0).toFixed(1)}
                  </p>
                </div>
                <div style={{ height: "8px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(features.seller_aggression || 0) * 10}%`, backgroundColor: "#ff6464" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
