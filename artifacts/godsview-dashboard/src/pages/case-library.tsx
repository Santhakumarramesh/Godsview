import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toArray } from "@/lib/safe";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
};

interface TradeCase {
  id: string;
  symbol: string;
  date: string;
  setup_type: string;
  entry_price: number;
  exit_price: number;
  pnl_r: number;
  outcome: "win" | "loss" | "breakeven";
  duration: string;
  lessons: string[];
  tags: string[];
}

interface CaseLibraryResponse {
  cases: TradeCase[];
}

export default function CaseLibrary() {
  const [filterType, setFilterType] = useState<"all" | "winners" | "losers" | "edge_cases">("all");

  const { data: caseData, isLoading } = useQuery({
    queryKey: ["cases", filterType],
    queryFn: async () => {
      const res = await fetch(`${API}/api/journal?type=case`);
      return res.json() as Promise<CaseLibraryResponse>;
    },
  });

  const filteredCases = toArray<any>(caseData, "cases").filter((c: any) => {
    if (filterType === "all") return true;
    if (filterType === "winners") return c.outcome === "win";
    if (filterType === "losers") return c.outcome === "loss";
    if (filterType === "edge_cases") return c.tags.includes("anomaly");
    return true;
  }) || [];

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case "win":
        return "#52ff00";
      case "loss":
        return "#ff7162";
      default:
        return "#ffcc00";
    }
  };

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Case Library
        </h1>

        {/* Filter Tabs */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "24px",
            borderBottom: `1px solid ${C.border}`,
            paddingBottom: "16px",
          }}
        >
          {(["all", "winners", "losers", "edge_cases"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterType(tab)}
              style={{
                padding: "8px 16px",
                backgroundColor: filterType === tab ? C.accent : "transparent",
                border: filterType === tab ? "none" : `1px solid ${C.border}`,
                borderRadius: "6px",
                color: filterType === tab ? "#000" : C.text,
                fontFamily: "Space Grotesk",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: "600",
                textTransform: "capitalize",
              }}
            >
              {tab.replace("_", " ")}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading cases...</div>
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {filteredCases.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: C.muted }}>
                No cases found for this filter
              </div>
            ) : (
              filteredCases.map((caseItem) => (
                <div
                  key={caseItem.id}
                  style={{
                    backgroundColor: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: "12px",
                    padding: "20px",
                  }}
                >
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "16px" }}>
                    <div>
                      <h3
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "16px",
                          fontWeight: "600",
                          marginBottom: "4px",
                        }}
                      >
                        {caseItem.symbol}
                      </h3>
                      <p style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.muted }}>
                        {caseItem.date} • {caseItem.setup_type}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontFamily: "JetBrains Mono",
                          fontSize: "18px",
                          fontWeight: "600",
                          color: getOutcomeColor(caseItem.outcome),
                        }}
                      >
                        {caseItem.pnl_r > 0 ? "+" : ""}{caseItem.pnl_r.toFixed(2)}R
                      </div>
                      <div
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "11px",
                          color: C.muted,
                          marginTop: "4px",
                        }}
                      >
                        {caseItem.outcome.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  {/* Trade Details */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                      gap: "16px",
                      marginBottom: "16px",
                      paddingBottom: "16px",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <div>
                      <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Entry</span>
                      <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", marginTop: "4px" }}>
                        {caseItem.entry_price.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Exit</span>
                      <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", marginTop: "4px" }}>
                        {caseItem.exit_price.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Duration</span>
                      <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", marginTop: "4px" }}>
                        {caseItem.duration}
                      </div>
                    </div>
                  </div>

                  {/* Lessons Learned */}
                  {caseItem.lessons.length > 0 && (
                    <div style={{ marginBottom: "12px" }}>
                      <h4 style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
                        LESSONS LEARNED
                      </h4>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          fontFamily: "JetBrains Mono",
                          fontSize: "12px",
                        }}
                      >
                        {caseItem.lessons.map((lesson, idx) => (
                          <li key={idx} style={{ marginBottom: "4px", color: C.text }}>
                            • {lesson}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tags */}
                  {caseItem.tags.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {caseItem.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            padding: "4px 12px",
                            backgroundColor: "rgba(156, 255, 147, 0.1)",
                            border: `1px solid ${C.accent}`,
                            borderRadius: "4px",
                            fontFamily: "Space Grotesk",
                            fontSize: "10px",
                            color: C.accent,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
