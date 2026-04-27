import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { safeObj } from "@/lib/safe";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
};

interface PipelineStage {
  name: string;
  strategies: StrategyCard[];
}

interface StrategyCard {
  id: string;
  name: string;
  stage: string;
  metrics: { sharpe: number; pf: number; winRate: number };
  gatingRules: string[];
  blockerReason?: string;
  canPromote: boolean;
  canDemote: boolean;
}

interface GovernanceResponse {
  stages: PipelineStage[];
  rules: Record<string, string[]>;
}

export default function PromotionPipeline() {
  const [selectedStage, setSelectedStage] = useState("research");

  const { data: governanceData, isLoading } = useQuery({
    queryKey: ["governance"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/governance/status`);
      return res.json() as Promise<GovernanceResponse>;
    },
  });

  const { data: certificationData } = useQuery({
    queryKey: ["certification"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/certification/results`);
      return res.json();
    },
  });

  const stageOrder = ["Research", "Paper", "Assisted", "Semi-Auto", "Autonomous"];

  const handlePromote = async (strategyId: string) => {
    console.log("Promoting strategy:", strategyId);
  };

  const handleDemote = async (strategyId: string) => {
    console.log("Demoting strategy:", strategyId);
  };

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Promotion Pipeline
        </h1>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading pipeline...</div>
        ) : (
          <div>
            {/* Pipeline Visualization */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginBottom: "32px",
                overflowX: "auto",
                paddingBottom: "12px",
              }}
            >
              {stageOrder.map((stage) => (
                <button
                  key={stage}
                  onClick={() => setSelectedStage(stage.toLowerCase().replace("-", "_"))}
                  style={{
                    padding: "12px 24px",
                    backgroundColor:
                      selectedStage === stage.toLowerCase().replace("-", "_") ? C.accent : C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: "8px",
                    color: selectedStage === stage.toLowerCase().replace("-", "_") ? "#000" : C.text,
                    fontFamily: "Space Grotesk",
                    cursor: "pointer",
                    fontWeight: "600",
                    whiteSpace: "nowrap",
                  }}
                >
                  {stage}
                </button>
              ))}
            </div>

            {/* Stage Details */}
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <h2 style={{ fontFamily: "Space Grotesk", fontSize: "18px", marginBottom: "20px" }}>
                {selectedStage.toUpperCase().replace("_", " ")}
              </h2>

              {/* Gating Rules */}
              {governanceData && governanceData.rules[selectedStage] && (
                <div
                  style={{
                    backgroundColor: "#0e0e0f",
                    border: `1px solid ${C.border}`,
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "24px",
                  }}
                >
                  <h3 style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted, marginBottom: "12px" }}>
                    GATING RULES
                  </h3>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      fontFamily: "JetBrains Mono",
                      fontSize: "12px",
                    }}
                  >
                    {governanceData.rules[selectedStage].map((rule, idx) => (
                      <li key={idx} style={{ marginBottom: "8px", color: C.muted }}>
                        • {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Strategy Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
                {governanceData &&
                  governanceData.stages
                    .find((s) => s.name.toLowerCase().replace(" ", "_") === selectedStage)
                    ?.strategies.map((strategy) => (
                      <div
                        key={strategy.id}
                        style={{
                          backgroundColor: "#0e0e0f",
                          border: `1px solid ${strategy.blockerReason ? "#ff7162" : C.border}`,
                          borderRadius: "8px",
                          padding: "16px",
                        }}
                      >
                        <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", marginBottom: "8px" }}>
                          {strategy.name}
                        </h3>

                        {/* Metrics */}
                        <div style={{ marginBottom: "12px" }}>
                          <div
                            style={{
                              fontFamily: "JetBrains Mono",
                              fontSize: "12px",
                              color: C.muted,
                              marginBottom: "4px",
                            }}
                          >
                            Sharpe: <span style={{ color: C.accent }}>{strategy.metrics.sharpe.toFixed(2)}</span>
                          </div>
                          <div
                            style={{
                              fontFamily: "JetBrains Mono",
                              fontSize: "12px",
                              color: C.muted,
                              marginBottom: "4px",
                            }}
                          >
                            PF: <span style={{ color: C.accent }}>{strategy.metrics.pf.toFixed(2)}</span>
                          </div>
                          <div
                            style={{
                              fontFamily: "JetBrains Mono",
                              fontSize: "12px",
                              color: C.muted,
                            }}
                          >
                            Win Rate:{" "}
                            <span style={{ color: C.accent }}>{(strategy.metrics.winRate * 100).toFixed(0)}%</span>
                          </div>
                        </div>

                        {/* Blocker */}
                        {strategy.blockerReason && (
                          <div
                            style={{
                              backgroundColor: "#ff71621a",
                              border: "1px solid #ff7162",
                              borderRadius: "6px",
                              padding: "8px",
                              marginBottom: "12px",
                              fontFamily: "Space Grotesk",
                              fontSize: "11px",
                              color: "#ff9999",
                            }}
                          >
                            {strategy.blockerReason}
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: "flex", gap: "8px" }}>
                          {strategy.canPromote && (
                            <button
                              onClick={() => handlePromote(strategy.id)}
                              style={{
                                flex: 1,
                                padding: "8px",
                                backgroundColor: C.accent,
                                border: "none",
                                borderRadius: "6px",
                                color: "#000",
                                fontFamily: "Space Grotesk",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                              }}
                            >
                              Promote
                            </button>
                          )}
                          {strategy.canDemote && (
                            <button
                              onClick={() => handleDemote(strategy.id)}
                              style={{
                                flex: 1,
                                padding: "8px",
                                backgroundColor: "#ff7162",
                                border: "none",
                                borderRadius: "6px",
                                color: "white",
                                fontFamily: "Space Grotesk",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                              }}
                            >
                              Demote
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
