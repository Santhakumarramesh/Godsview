import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type BriefingData = {
  overnightMovements: Array<{ symbol: string; change: number }>;
  macroEvents: Array<{ event: string; impact: string; time: string }>;
  watchlistStatus: string;
  highRiskAssets: string[];
  todaysPlan: string;
};

type MacroData = {
  vix: number;
  yield: number;
  dxy: number;
  sentiment: string;
};

export default function DailyBriefingPage() {
  const { data: briefingData } = useQuery({
    queryKey: ["daily", "briefing"],
    queryFn: () => fetch(`${API}/api/daily-review/generate`).then((r) => r.json()),
    refetchInterval: 3600000,
  });

  const { data: macroData } = useQuery({
    queryKey: ["macro", "data"],
    queryFn: () => fetch(`${API}/api/macro`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const brief: BriefingData = briefingData?.data || {};
  const macro: MacroData = macroData?.data || {};

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Daily Briefing
      </h1>

      {/* Macro Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>VIX</p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#9cff93" }}>
            {macro.vix?.toFixed(1) || "-"}
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
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>10Y Yield</p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#9cff93" }}>
            {macro.yield?.toFixed(2) || "-"}%
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
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>DXY</p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#9cff93" }}>
            {macro.dxy?.toFixed(1) || "-"}
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
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Sentiment</p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: "#ffd700" }}>
            {macro.sentiment || "-"}
          </p>
        </div>
      </div>

      {/* Overnight Movements */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Overnight Movements
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
          {brief.overnightMovements?.map((m) => (
            <div
              key={m.symbol}
              style={{
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "12px",
                textAlign: "center",
              }}
            >
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", marginBottom: "4px" }}>
                {m.symbol}
              </p>
              <p
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "16px",
                  fontWeight: "bold",
                  color: m.change > 0 ? "#9cff93" : "#ff6b6b",
                }}
              >
                {m.change > 0 ? "+" : ""}{m.change.toFixed(2)}%
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Macro Events */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Key Macro Events
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {brief.macroEvents?.map((e, i) => (
            <div
              key={i}
              style={{
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "12px",
              }}
            >
              <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", fontWeight: "bold" }}>
                {e.event}
              </p>
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
                {e.time} | Impact: {e.impact}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Today's Plan */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Today's Plan
        </h2>
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", lineHeight: "1.6" }}>
          {brief.todaysPlan || "No plan generated yet"}
        </p>
      </div>
    </div>
  );
}
