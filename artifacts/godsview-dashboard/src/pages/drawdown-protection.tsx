import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type DrawdownLevel = {
  period: "daily" | "weekly" | "monthly";
  current_dd: number;
  max_allowed_dd: number;
  restriction_threshold: number;
  is_restricted: boolean;
};

type DrawdownData = {
  peak_equity: number;
  current_equity: number;
  daily_dd: number;
  weekly_dd: number;
  monthly_dd: number;
  all_time_dd: number;
  circuit_breaker_status: "off" | "warning" | "triggered";
  auto_derisk_enabled: boolean;
};

export default function DrawdownProtectionPage() {
  const { data: breakerData, isLoading } = useQuery({
    queryKey: ["breaker"],
    queryFn: () => fetch(`${API}/api/breaker`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: drawdownData } = useQuery({
    queryKey: ["risk", "drawdown"],
    queryFn: () => fetch(`${API}/api/risk/drawdown`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading drawdown data...</div>;
  }

  const dd: DrawdownData = drawdownData?.data || {
    peak_equity: 0,
    current_equity: 0,
    daily_dd: 0,
    weekly_dd: 0,
    monthly_dd: 0,
    all_time_dd: 0,
    circuit_breaker_status: "off",
    auto_derisk_enabled: false,
  };

  const levels: DrawdownLevel[] = [
    {
      period: "daily",
      current_dd: dd.daily_dd,
      max_allowed_dd: 0.02,
      restriction_threshold: 0.015,
      is_restricted: dd.daily_dd > 0.015,
    },
    {
      period: "weekly",
      current_dd: dd.weekly_dd,
      max_allowed_dd: 0.05,
      restriction_threshold: 0.035,
      is_restricted: dd.weekly_dd > 0.035,
    },
    {
      period: "monthly",
      current_dd: dd.monthly_dd,
      max_allowed_dd: 0.10,
      restriction_threshold: 0.07,
      is_restricted: dd.monthly_dd > 0.07,
    },
  ];

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
        Drawdown Protection
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Peak Equity</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${dd.peak_equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Current Equity</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#ffffff",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            ${dd.current_equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>All-Time Drawdown</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: dd.all_time_dd > 0.15 ? "#ff6b6b" : dd.all_time_dd > 0.1 ? "#ffd93d" : "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {(dd.all_time_dd * 100).toFixed(2)}%
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
        Drawdown Levels & Restrictions
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        {levels.map((level) => (
          <div
            key={level.period}
            style={{
              backgroundColor: "#1a191b",
              border: level.is_restricted ? "2px solid #ff8a8a" : "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "14px", color: "#ffffff", fontFamily: "Space Grotesk", fontWeight: "600" }}>
                {level.period.charAt(0).toUpperCase() + level.period.slice(1)}
              </div>
              {level.is_restricted && (
                <div
                  style={{
                    backgroundColor: "#ff8a8a",
                    color: "#0e0e0f",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: "600",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  RESTRICTED
                </div>
              )}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "4px",
                  fontSize: "11px",
                  fontFamily: "Space Grotesk",
                }}
              >
                <span style={{ color: "#767576" }}>Current Drawdown</span>
                <span
                  style={{
                    color: level.current_dd > level.max_allowed_dd ? "#ff6b6b" : level.current_dd > level.restriction_threshold ? "#ffd93d" : "#9cff93",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {(level.current_dd * 100).toFixed(3)}%
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  backgroundColor: "rgba(72,72,73,0.2)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    backgroundColor:
                      level.current_dd > level.max_allowed_dd
                        ? "#ff6b6b"
                        : level.current_dd > level.restriction_threshold
                          ? "#ffd93d"
                          : "#9cff93",
                    width: `${Math.min((level.current_dd / level.max_allowed_dd) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "4px",
                  fontSize: "11px",
                  fontFamily: "Space Grotesk",
                }}
              >
                <span style={{ color: "#767576" }}>Restriction Threshold</span>
                <span style={{ color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                  {(level.restriction_threshold * 100).toFixed(3)}%
                </span>
              </div>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "4px",
                  fontSize: "11px",
                  fontFamily: "Space Grotesk",
                }}
              >
                <span style={{ color: "#767576" }}>Max Allowed</span>
                <span style={{ color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                  {(level.max_allowed_dd * 100).toFixed(3)}%
                </span>
              </div>
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
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: "600", color: "#ffffff", marginBottom: "16px", fontFamily: "Space Grotesk" }}>
          Circuit Breaker Status
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
              Status
            </div>
            <div
              style={{
                display: "inline-block",
                backgroundColor:
                  dd.circuit_breaker_status === "triggered"
                    ? "#ff6b6b"
                    : dd.circuit_breaker_status === "warning"
                      ? "#ffd93d"
                      : "#2d5a2d",
                color: dd.circuit_breaker_status === "triggered" ? "#0e0e0f" : "#ffffff",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: "600",
                fontSize: "13px",
                fontFamily: "Space Grotesk",
              }}
            >
              {dd.circuit_breaker_status.toUpperCase()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
              Auto De-Risk
            </div>
            <div
              style={{
                display: "inline-block",
                backgroundColor: dd.auto_derisk_enabled ? "#2d5a2d" : "#5a2d2d",
                color: dd.auto_derisk_enabled ? "#9cff93" : "#ff8a8a",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: "600",
                fontSize: "13px",
                fontFamily: "Space Grotesk",
              }}
            >
              {dd.auto_derisk_enabled ? "ENABLED" : "DISABLED"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
