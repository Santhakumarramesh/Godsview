import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type CorrelationMatrix = {
  symbols: string[];
  correlations: number[][];
};

type RiskCluster = {
  cluster_id: string;
  symbols: string[];
  avg_correlation: number;
  risk_exposure: number;
};

export default function CorrelationRiskPage() {
  const { data: correlationData, isLoading } = useQuery({
    queryKey: ["portfolio", "correlation"],
    queryFn: () => fetch(`${API}/api/portfolio/correlation`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: riskData } = useQuery({
    queryKey: ["portfolio-risk"],
    queryFn: () => fetch(`${API}/api/portfolio-risk`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading correlation data...</div>;
  }

  const correlation: CorrelationMatrix = correlationData?.matrix || {
    symbols: [],
    correlations: [],
  };
  const riskClusters: RiskCluster[] = riskData?.clusters || [];

  const getCorrelationColor = (value: number) => {
    if (value > 0.8) return "#ff6b6b";
    if (value > 0.5) return "#ffd93d";
    return "#9cff93";
  };

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
        Correlation Risk Analysis
      </h1>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Correlation Heatmap
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
        {correlation.symbols.length === 0 ? (
          <div style={{ color: "#767576" }}>No correlation data available</div>
        ) : (
          <div style={{ display: "inline-block", minWidth: "100%" }}>
            <div style={{ display: "flex", gap: "0" }}>
              <div style={{ width: "80px", flexShrink: 0 }} />
              <div style={{ display: "flex", gap: "0" }}>
                {correlation.symbols.map((sym) => (
                  <div
                    key={`header-${sym}`}
                    style={{
                      width: "50px",
                      textAlign: "center",
                      fontSize: "11px",
                      color: "#767576",
                      padding: "8px",
                      fontFamily: "JetBrains Mono, monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {sym}
                  </div>
                ))}
              </div>
            </div>

            {correlation.symbols.map((sym, i) => (
              <div key={`row-${sym}`} style={{ display: "flex", gap: "0" }}>
                <div
                  style={{
                    width: "80px",
                    flexShrink: 0,
                    fontSize: "11px",
                    color: "#767576",
                    padding: "8px",
                    fontFamily: "JetBrains Mono, monospace",
                    textAlign: "right",
                  }}
                >
                  {sym}
                </div>
                <div style={{ display: "flex", gap: "0" }}>
                  {correlation.correlations[i].map((corr, j) => (
                    <div
                      key={`cell-${i}-${j}`}
                      style={{
                        width: "50px",
                        height: "50px",
                        backgroundColor: getCorrelationColor(Math.abs(corr)),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        color: "#0e0e0f",
                        fontFamily: "JetBrains Mono, monospace",
                        fontWeight: "600",
                      }}
                    >
                      {corr.toFixed(2)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
        Risk Clusters
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "16px",
        }}
      >
        {riskClusters.map((cluster) => {
          const highCorr = cluster.avg_correlation > 0.7;

          return (
            <div
              key={cluster.cluster_id}
              style={{
                backgroundColor: "#1a191b",
                border: highCorr ? "2px solid #ff6b6b" : "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div style={{ fontSize: "13px", color: "#ffffff", fontFamily: "Space Grotesk" }}>
                  {cluster.cluster_id}
                </div>
                {highCorr && (
                  <div
                    style={{
                      backgroundColor: "#ff6b6b",
                      color: "#0e0e0f",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: "600",
                      fontFamily: "Space Grotesk",
                    }}
                  >
                    HIGH CORR
                  </div>
                )}
              </div>

              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                  Symbols
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "4px",
                  }}
                >
                  {cluster.symbols.map((sym) => (
                    <span
                      key={sym}
                      style={{
                        backgroundColor: "rgba(156, 255, 147, 0.1)",
                        color: "#9cff93",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {sym}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                  Avg Correlation
                </div>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: "600",
                    color: highCorr ? "#ff6b6b" : "#9cff93",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {(cluster.avg_correlation * 100).toFixed(1)}%
                </div>
              </div>

              <div>
                <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                  Risk Exposure
                </div>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: "600",
                    color: cluster.risk_exposure > 100000 ? "#ff8a8a" : "#9cff93",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  ${cluster.risk_exposure.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
