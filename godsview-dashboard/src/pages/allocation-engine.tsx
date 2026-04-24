import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type StrategyAllocation = {
  strategy_id: string;
  target_allocation: number;
  actual_allocation: number;
  deployed_capital: number;
};

type AllocationData = {
  total_portfolio_value: number;
  target_allocations: Record<string, number>;
  actual_allocations: Record<string, number>;
  strategy_allocations: StrategyAllocation[];
  cash_target: number;
  cash_actual: number;
};

export default function AllocationEnginePage() {
  const { data: portfolioData, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => fetch(`${API}/api/portfolio`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: allocationData } = useQuery({
    queryKey: ["portfolio", "allocation"],
    queryFn: () => fetch(`${API}/api/portfolio/allocation`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading allocation data...</div>;
  }

  const allocation: AllocationData = allocationData?.allocation || {
    total_portfolio_value: 0,
    target_allocations: {},
    actual_allocations: {},
    strategy_allocations: [],
    cash_target: 0,
    cash_actual: 0,
  };

  const assetClasses = Object.keys(allocation.target_allocations || {});

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
        Allocation Engine
      </h1>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", fontFamily: "Space Grotesk" }}>
          Portfolio Total Value
        </div>
        <div
          style={{
            fontSize: "36px",
            fontWeight: "600",
            color: "#9cff93",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          ${allocation.total_portfolio_value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
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
        Target vs Actual Allocation
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
        {assetClasses.length === 0 ? (
          <div style={{ color: "#767576" }}>No allocation data available</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "32px" }}>
            {assetClasses.map((asset) => {
              const target = allocation.target_allocations[asset] || 0;
              const actual = allocation.actual_allocations[asset] || 0;
              const diff = actual - target;

              return (
                <div key={asset}>
                  <div style={{ marginBottom: "12px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                        fontFamily: "Space Grotesk",
                      }}
                    >
                      <span style={{ fontSize: "13px", color: "#ffffff" }}>{asset}</span>
                      <span
                        style={{
                          fontSize: "13px",
                          color: diff > 0.01 ? "#ffd93d" : diff < -0.01 ? "#ff8a8a" : "#9cff93",
                        }}
                      >
                        {(actual * 100).toFixed(1)}% (target: {(target * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>Target</div>
                    <div
                      style={{
                        height: "20px",
                        backgroundColor: "rgba(72,72,73,0.2)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          backgroundColor: "rgba(156, 255, 147, 0.4)",
                          width: `${target * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>Actual</div>
                    <div
                      style={{
                        height: "20px",
                        backgroundColor: "rgba(72,72,73,0.2)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          backgroundColor:
                            diff > 0.01 ? "rgba(255, 217, 61, 0.4)" : diff < -0.01 ? "rgba(255, 138, 138, 0.4)" : "rgba(156, 255, 147, 0.6)",
                          width: `${actual * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
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
        Per-Strategy Allocation
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "16px",
        }}
      >
        {allocation.strategy_allocations.map((strat) => (
          <div
            key={strat.strategy_id}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
              {strat.strategy_id}
            </div>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>Target</div>
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "#9cff93",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {(strat.target_allocation * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>Actual</div>
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  color: Math.abs(strat.actual_allocation - strat.target_allocation) > 0.02 ? "#ffd93d" : "#9cff93",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {(strat.actual_allocation * 100).toFixed(1)}%
              </div>
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "#767576",
                padding: "12px",
                backgroundColor: "rgba(72,72,73,0.1)",
                borderRadius: "6px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              Deployed: ${strat.deployed_capital.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginTop: "32px",
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: "600", color: "#ffffff", marginBottom: "16px", fontFamily: "Space Grotesk" }}>
          Cash Position
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
              Target Cash Reserve
            </div>
            <div style={{ fontSize: "18px", fontWeight: "600", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
              {(allocation.cash_target * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
              Actual Cash
            </div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "600",
                color:
                  Math.abs(allocation.cash_actual - allocation.cash_target) > 0.02 ? "#ffd93d" : "#9cff93",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {(allocation.cash_actual * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
