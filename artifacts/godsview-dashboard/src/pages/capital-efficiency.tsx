import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type CapitalData = {
  total_capital: number;
  deployed_capital: number;
  idle_capital: number;
  idle_percentage: number;
  margin_used: number;
  buying_power: number;
  risk_adjusted_usage: number;
  wasted_allocation: number;
  capital_utilization_pct: number;
};

export default function CapitalEfficiencyPage() {
  const { data: portfolioData, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => fetch(`${API}/api/portfolio`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: performanceData } = useQuery({
    queryKey: ["analytics", "performance"],
    queryFn: () => fetch(`${API}/api/analytics/performance`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading capital efficiency data...</div>;
  }

  const capital: CapitalData = {
    total_capital: portfolioData?.total_value || 0,
    deployed_capital: portfolioData?.deployed || 0,
    idle_capital: portfolioData?.cash || 0,
    idle_percentage: portfolioData?.cash_pct || 0,
    margin_used: portfolioData?.margin_used || 0,
    buying_power: portfolioData?.buying_power || 0,
    risk_adjusted_usage: performanceData?.risk_adjusted_usage || 0,
    wasted_allocation: performanceData?.wasted_allocation || 0,
    capital_utilization_pct: performanceData?.utilization_pct || 0,
  };

  const idleColor =
    capital.idle_percentage > 0.3
      ? "#ffd93d"
      : capital.idle_percentage > 0.5
        ? "#ff8a8a"
        : "#9cff93";

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
        Capital Efficiency
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Total Capital</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#ffffff",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${capital.total_capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Deployed</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${capital.deployed_capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Idle Capital</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: idleColor,
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${capital.idle_capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Idle %</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: idleColor,
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {(capital.idle_percentage * 100).toFixed(1)}%
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
        Capital Allocation
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
              fontFamily: "Space Grotesk",
            }}
          >
            <span style={{ fontSize: "13px", color: "#ffffff" }}>Capital Utilization</span>
            <span style={{ fontSize: "13px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
              {(capital.capital_utilization_pct * 100).toFixed(1)}%
            </span>
          </div>
          <div
            style={{
              height: "16px",
              backgroundColor: "rgba(72,72,73,0.2)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#9cff93",
                width: `${capital.capital_utilization_pct * 100}%`,
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
              fontFamily: "Space Grotesk",
            }}
          >
            <span style={{ fontSize: "13px", color: "#ffffff" }}>Risk-Adjusted Usage</span>
            <span style={{ fontSize: "13px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
              {(capital.risk_adjusted_usage * 100).toFixed(1)}%
            </span>
          </div>
          <div
            style={{
              height: "16px",
              backgroundColor: "rgba(72,72,73,0.2)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: capital.risk_adjusted_usage > 0.8 ? "#ffd93d" : "#9cff93",
                width: `${capital.risk_adjusted_usage * 100}%`,
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
              fontFamily: "Space Grotesk",
            }}
          >
            <span style={{ fontSize: "13px", color: "#ffffff" }}>Deployed vs Total</span>
            <span style={{ fontSize: "13px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
              {((capital.deployed_capital / capital.total_capital) * 100).toFixed(1)}%
            </span>
          </div>
          <div
            style={{
              height: "16px",
              backgroundColor: "rgba(72,72,73,0.2)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: "#9cff93",
                width: `${(capital.deployed_capital / capital.total_capital) * 100}%`,
              }}
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
              fontFamily: "Space Grotesk",
            }}
          >
            <span style={{ fontSize: "13px", color: "#ffffff" }}>Idle vs Total</span>
            <span style={{ fontSize: "13px", color: idleColor, fontFamily: "JetBrains Mono, monospace" }}>
              {(capital.idle_percentage * 100).toFixed(1)}%
            </span>
          </div>
          <div
            style={{
              height: "16px",
              backgroundColor: "rgba(72,72,73,0.2)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: idleColor,
                width: `${capital.idle_percentage * 100}%`,
              }}
            />
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
        Efficiency Metrics
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
        }}
      >
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Margin Used
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: capital.margin_used > 50000 ? "#ffd93d" : "#9cff93",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${capital.margin_used.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Buying Power
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: "#9cff93",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${capital.buying_power.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Wasted Allocation
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: capital.wasted_allocation > 10000 ? "#ff8a8a" : "#9cff93",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${capital.wasted_allocation.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>
    </div>
  );
}
