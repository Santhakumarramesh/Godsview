import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

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

const PAGE_DESCRIPTION = "Start-of-day intelligence summary — overnight movements, macro context, and today's trading plan";
const COLORS = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  positive: "#9cff93",
  negative: "#ff6b6b",
  warning: "#ffc107",
  danger: "#ff6b6b",
  orange: "#ff9800",
  yellow: "#ffc107",
};

const SkeletonLoader = () => (
  <div style={{ backgroundColor: COLORS.card, borderRadius: "8px", padding: "12px", animation: "pulse 2s infinite", opacity: 0.6 }} />
);

const getImpactColor = (impact: string) => {
  const lower = impact.toLowerCase();
  if (lower.includes("high")) return COLORS.danger;
  if (lower.includes("medium")) return COLORS.orange;
  return COLORS.yellow;
};

const getSessionContext = () => {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 9) return "Pre-Market";
  if (hour >= 9 && hour < 16) return "Live Trading";
  if (hour >= 16 && hour < 20) return "After-Hours";
  return "Closed";
};

const timeUntilEvent = (eventTime: string): string => {
  try {
    const eventDate = new Date(eventTime);
    const now = new Date();
    const diffMs = eventDate.getTime() - now.getTime();
    if (diffMs < 0) return "Past";
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    return `${Math.floor(diffMins / 60)}h`;
  } catch {
    return "Soon";
  }
};

export default function DailyBriefingPage() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { data: briefingData, isLoading: briefingLoading, error: briefingError } = useQuery({
    queryKey: ["daily", "briefing"],
    queryFn: () => fetch(`${API}/api/daily-review/generate`).then((r) => r.json()),
    refetchInterval: 3600000,
  });

  const { data: macroData, isLoading: macroLoading, error: macroError } = useQuery({
    queryKey: ["macro", "data"],
    queryFn: () => fetch(`${API}/api/macro`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const brief: BriefingData = briefingData?.data || {};
  const macro: MacroData = macroData?.data || {};
  const hasHighRiskAssets = brief.highRiskAssets && brief.highRiskAssets.length > 0;

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, minHeight: "100vh", padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <h1 style={{ fontFamily: "Space Grotesk", fontSize: "32px", margin: "0 0 8px 0" }}>
              Daily Briefing
            </h1>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, margin: 0 }}>
              {PAGE_DESCRIPTION}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, margin: "0 0 4px 0" }}>
              {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, margin: 0 }}>
              {currentTime.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "16px" }}>
          <div
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "6px",
              padding: "8px 12px",
              fontFamily: "Space Grotesk",
              fontSize: "12px",
              color: COLORS.accent,
            }}
          >
            {getSessionContext()}
          </div>
          <div
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "6px",
              padding: "8px 12px",
              fontFamily: "Space Grotesk",
              fontSize: "12px",
              color: COLORS.muted,
            }}
          >
            Watchlist: {brief.watchlistStatus || "—"}
          </div>
        </div>
      </div>

      {/* Macro Summary */}
      {macroError && (
        <div style={{ backgroundColor: "#3d2222", border: "1px solid #ff6b6b", borderRadius: "12px", padding: "16px", marginBottom: "24px", fontFamily: "Space Grotesk", fontSize: "13px" }}>
          Error loading macro data. Please try again.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {macroLoading ? (
          <>
            <SkeletonLoader />
            <SkeletonLoader />
            <SkeletonLoader />
            <SkeletonLoader />
          </>
        ) : (
          <>
            <div style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "12px", padding: "24px" }}>
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: COLORS.muted, margin: "0 0 8px 0" }}>
                VIX
              </p>
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: COLORS.accent, margin: 0 }}>
                {macro.vix?.toFixed(1) || "—"}
              </p>
            </div>
            <div style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "12px", padding: "24px" }}>
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: COLORS.muted, margin: "0 0 8px 0" }}>
                10Y Yield
              </p>
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: COLORS.accent, margin: 0 }}>
                {macro.yield?.toFixed(2) || "—"}%
              </p>
            </div>
            <div style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "12px", padding: "24px" }}>
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: COLORS.muted, margin: "0 0 8px 0" }}>
                DXY
              </p>
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: COLORS.accent, margin: 0 }}>
                {macro.dxy?.toFixed(1) || "—"}
              </p>
            </div>
            <div style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "12px", padding: "24px" }}>
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: COLORS.muted, margin: "0 0 8px 0" }}>
                Sentiment
              </p>
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: COLORS.warning, margin: 0 }}>
                {macro.sentiment || "—"}
              </p>
            </div>
          </>
        )}
      </div>

      {/* High Risk Assets */}
      {hasHighRiskAssets && (
        <div
          style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.danger}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", margin: "0 0 16px 0" }}>
            High-Risk Assets
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "12px" }}>
            {brief.highRiskAssets.map((symbol) => (
              <div
                key={symbol}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${COLORS.danger}`,
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <span style={{ fontFamily: "Space Grotesk", fontSize: "13px", fontWeight: "bold" }}>
                    {symbol}
                  </span>
                  <span style={{ fontSize: "12px", color: COLORS.danger }}>
                    ⚠
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overnight Movements */}
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", margin: "0 0 16px 0" }}>
          Overnight Movements
        </h2>
        {briefingLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
            {Array(4)
              .fill(0)
              .map((_, i) => (
                <SkeletonLoader key={i} />
              ))}
          </div>
        ) : !brief.overnightMovements || brief.overnightMovements.length === 0 ? (
          <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, margin: 0 }}>
            No overnight movement data available.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
            {brief.overnightMovements.map((m) => (
              <div
                key={m.symbol}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center",
                }}
              >
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", margin: "0 0 4px 0" }}>
                  {m.symbol}
                </p>
                <p
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "16px",
                    fontWeight: "bold",
                    color: m.change > 0 ? COLORS.positive : COLORS.negative,
                    margin: 0,
                  }}
                >
                  {m.change > 0 ? "+" : ""}{m.change.toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Macro Events */}
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", margin: "0 0 16px 0" }}>
          Key Macro Events
        </h2>
        {briefingLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Array(3)
              .fill(0)
              .map((_, i) => (
                <SkeletonLoader key={i} />
              ))}
          </div>
        ) : !brief.macroEvents || brief.macroEvents.length === 0 ? (
          <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, margin: 0 }}>
            No macro events scheduled.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {brief.macroEvents.map((e, i) => {
              const impactColor = getImpactColor(e.impact);
              const timeRemaining = timeUntilEvent(e.time);
              return (
                <div
                  key={i}
                  style={{
                    backgroundColor: "#0e0e0f",
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", fontWeight: "bold", margin: "0 0 4px 0" }}>
                        {e.event}
                      </p>
                      <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: COLORS.muted, margin: 0 }}>
                        {e.time} • {timeRemaining}
                      </p>
                    </div>
                    <div
                      style={{
                        backgroundColor: impactColor,
                        color: "#000",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontFamily: "Space Grotesk",
                        fontSize: "11px",
                        fontWeight: "bold",
                      }}
                    >
                      {e.impact.toUpperCase()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Today's Plan */}
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", margin: "0 0 16px 0" }}>
          Today's Plan
        </h2>
        {briefingLoading ? (
          <SkeletonLoader />
        ) : !brief.todaysPlan ? (
          <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: COLORS.muted, margin: 0 }}>
            No trading plan generated yet.
          </p>
        ) : (
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", lineHeight: "1.6", margin: 0, whiteSpace: "pre-wrap" }}>
            {brief.todaysPlan}
          </p>
        )}
      </div>
    </div>
  );
}
