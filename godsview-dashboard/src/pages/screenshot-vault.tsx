import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
};

interface Screenshot {
  id: string;
  symbol: string;
  timestamp: string;
  tags: string[];
  notes: string;
  trade_outcome?: "win" | "loss";
  url: string;
}

interface ScreenshotResponse {
  screenshots: Screenshot[];
  total: number;
}

export default function ScreenshotVault() {
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [tradeOutcomeFilter, setTradeOutcomeFilter] = useState<"" | "win" | "loss">("");

  const { data: screenshotData, isLoading } = useQuery({
    queryKey: ["screenshots", selectedSymbol, dateRange, tradeOutcomeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedSymbol) params.append("symbol", selectedSymbol);
      if (dateRange.start) params.append("start_date", dateRange.start);
      if (dateRange.end) params.append("end_date", dateRange.end);
      if (tradeOutcomeFilter) params.append("outcome", tradeOutcomeFilter);

      const res = await fetch(`${API}/api/storage?prefix=screenshots&${params.toString()}`);
      return res.json() as Promise<ScreenshotResponse>;
    },
  });

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Screenshot Memory Vault
        </h1>

        {/* Filters */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, display: "block", marginBottom: "8px" }}>
                SYMBOL
              </label>
              <input
                type="text"
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
                placeholder="e.g., AAPL"
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, display: "block", marginBottom: "8px" }}>
                START DATE
              </label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, display: "block", marginBottom: "8px" }}>
                END DATE
              </label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, display: "block", marginBottom: "8px" }}>
                OUTCOME
              </label>
              <select
                value={tradeOutcomeFilter}
                onChange={(e) => setTradeOutcomeFilter(e.target.value as "" | "win" | "loss")}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              >
                <option value="">All</option>
                <option value="win">Winners</option>
                <option value="loss">Losers</option>
              </select>
            </div>
          </div>
        </div>

        {/* Screenshots Grid */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading screenshots...</div>
        ) : screenshotData && screenshotData.screenshots.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "16px",
            }}
          >
            {screenshotData.screenshots.map((screenshot) => (
              <div
                key={screenshot.id}
                style={{
                  backgroundColor: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "12px",
                  overflow: "hidden",
                }}
              >
                {/* Placeholder for Image */}
                <div
                  style={{
                    backgroundColor: "#0e0e0f",
                    height: "200px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderBottom: `1px solid ${C.border}`,
                    fontFamily: "Space Grotesk",
                    color: C.muted,
                  }}
                >
                  Chart Screenshot
                </div>

                {/* Details */}
                <div style={{ padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "12px" }}>
                    <div>
                      <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", fontWeight: "600", marginBottom: "4px" }}>
                        {screenshot.symbol}
                      </h3>
                      <p style={{ fontFamily: "JetBrains Mono", fontSize: "11px", color: C.muted }}>
                        {new Date(screenshot.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    {screenshot.trade_outcome && (
                      <div
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: screenshot.trade_outcome === "win" ? "#52ff00" : "#ff7162",
                          backgroundColor: screenshot.trade_outcome === "win" ? "#52ff001a" : "#ff71621a",
                          padding: "4px 12px",
                          borderRadius: "4px",
                        }}
                      >
                        {screenshot.trade_outcome.toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  {screenshot.notes && (
                    <p
                      style={{
                        fontFamily: "JetBrains Mono",
                        fontSize: "11px",
                        color: C.muted,
                        marginBottom: "12px",
                        maxHeight: "60px",
                        overflow: "hidden",
                      }}
                    >
                      {screenshot.notes}
                    </p>
                  )}

                  {/* Tags */}
                  {screenshot.tags.length > 0 && (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {screenshot.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            padding: "3px 10px",
                            backgroundColor: "rgba(156, 255, 147, 0.1)",
                            border: `1px solid ${C.accent}`,
                            borderRadius: "4px",
                            fontFamily: "Space Grotesk",
                            fontSize: "9px",
                            color: C.accent,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "60px 24px",
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "12px",
              color: C.muted,
            }}
          >
            No screenshots found matching filters
          </div>
        )}

        {screenshotData && (
          <div style={{ marginTop: "24px", textAlign: "right", color: C.muted, fontSize: "12px" }}>
            {screenshotData.total} screenshot{screenshotData.total !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
