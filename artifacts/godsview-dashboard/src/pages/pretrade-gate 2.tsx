import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type GateCheck = {
  check_name: string;
  passed: boolean;
  blocker?: string;
  details?: string;
};

type GateResult = {
  trade_id?: string;
  timestamp: string;
  checks: GateCheck[];
  overall_passed: boolean;
  blockers: string[];
};

export default function PreTradeGatePage() {
  const { data: gateData, isLoading } = useQuery({
    queryKey: ["execution", "gate"],
    queryFn: () => fetch(`${API}/api/execution/gate`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: checkData } = useQuery({
    queryKey: ["risk", "check"],
    queryFn: () => fetch(`${API}/api/risk/check`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading gate data...</div>;
  }

  const gateResult: GateResult = gateData?.result || {
    timestamp: new Date().toISOString(),
    checks: [],
    overall_passed: false,
    blockers: [],
  };

  const defaultChecks = [
    "Position Limit Check",
    "Exposure Check",
    "Correlation Check",
    "Drawdown Check",
    "Session Check",
    "Regime Check",
  ];

  const checks: GateCheck[] = gateResult.checks.length > 0 ? gateResult.checks : defaultChecks.map((name) => ({
    check_name: name,
    passed: false,
    blocker: "Check not evaluated",
  }));

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
        Pre-Trade Risk Gate
      </h1>

      <div
        style={{
          backgroundColor:
            gateResult.overall_passed
              ? "rgba(45, 90, 45, 0.3)"
              : "rgba(255, 107, 107, 0.2)",
          border: gateResult.overall_passed
            ? "1px solid rgba(156, 255, 147, 0.3)"
            : "2px solid #ff6b6b",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              backgroundColor: gateResult.overall_passed ? "#2d5a2d" : "#ff6b6b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
              color: gateResult.overall_passed ? "#9cff93" : "#0e0e0f",
            }}
          >
            {gateResult.overall_passed ? "✓" : "✗"}
          </div>
          <div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "600",
                color: gateResult.overall_passed ? "#9cff93" : "#ff6b6b",
                fontFamily: "Space Grotesk",
              }}
            >
              {gateResult.overall_passed ? "GATE PASSED" : "GATE BLOCKED"}
            </div>
            <div style={{ fontSize: "12px", color: "#767576", marginTop: "4px" }}>
              {new Date(gateResult.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>

        {gateResult.blockers.length > 0 && (
          <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid rgba(255, 107, 107, 0.3)" }}>
            <div style={{ fontSize: "12px", color: "#ff8a8a", fontWeight: "600", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
              Blockers:
            </div>
            {gateResult.blockers.map((blocker) => (
              <div
                key={blocker}
                style={{
                  fontSize: "11px",
                  color: "#ff8a8a",
                  marginBottom: "4px",
                  paddingLeft: "16px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                • {blocker}
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
        Gate Checks Breakdown
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "16px",
        }}
      >
        {checks.map((check) => (
          <div
            key={check.check_name}
            style={{
              backgroundColor: "#1a191b",
              border: check.passed
                ? "1px solid rgba(156, 255, 147, 0.2)"
                : "2px solid #ff8a8a",
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
              <div style={{ fontSize: "13px", color: "#ffffff", fontWeight: "600", fontFamily: "Space Grotesk" }}>
                {check.check_name}
              </div>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  backgroundColor: check.passed ? "rgba(156, 255, 147, 0.2)" : "rgba(255, 138, 138, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "16px",
                  color: check.passed ? "#9cff93" : "#ff8a8a",
                }}
              >
                {check.passed ? "✓" : "✗"}
              </div>
            </div>

            {check.blocker && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#ff8a8a",
                  backgroundColor: "rgba(255, 138, 138, 0.1)",
                  padding: "8px",
                  borderRadius: "6px",
                  marginBottom: "8px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {check.blocker}
              </div>
            )}

            {check.details && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  padding: "8px",
                  backgroundColor: "rgba(72, 72, 73, 0.1)",
                  borderRadius: "6px",
                }}
              >
                {check.details}
              </div>
            )}

            <div
              style={{
                marginTop: "12px",
                padding: "8px",
                backgroundColor: check.passed ? "rgba(156, 255, 147, 0.1)" : "rgba(255, 138, 138, 0.1)",
                borderRadius: "6px",
                textAlign: "center",
                fontSize: "11px",
                color: check.passed ? "#9cff93" : "#ff8a8a",
                fontFamily: "Space Grotesk",
              }}
            >
              {check.passed ? "PASSED" : "FAILED"}
            </div>
          </div>
        ))}
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginTop: "32px",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Required Gate Checks
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
          {[
            { name: "Position Limit", description: "Max positions per account" },
            { name: "Exposure", description: "Total notional exposure cap" },
            { name: "Correlation", description: "Max correlation with portfolio" },
            { name: "Drawdown", description: "Daily/weekly/monthly limits" },
            { name: "Session", description: "Market hours restrictions" },
            { name: "Regime", description: "Market regime filters" },
          ].map((item) => (
            <div
              key={item.name}
              style={{
                padding: "12px",
                backgroundColor: "rgba(72,72,73,0.1)",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#ffffff",
                  fontWeight: "600",
                  fontFamily: "Space Grotesk",
                }}
              >
                {item.name}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  marginTop: "4px",
                }}
              >
                {item.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
