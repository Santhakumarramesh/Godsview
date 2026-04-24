import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type IntelligenceSnapshot = {
  intelligenceScore: number;
  activeAgents: number;
  signalPipelineStatus: string;
  decisionConfidence: number;
  timestamp: string;
};

type BrainState = {
  layer: string;
  status: string;
  confidence: number;
  lastUpdate: string;
};

export default function IntelligenceCenterPage() {
  const { data: snapshotData } = useQuery({
    queryKey: ["intelligence", "snapshot"],
    queryFn: () => fetch(`${API}/api/intelligence/snapshot`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: brainData } = useQuery({
    queryKey: ["brain", "state"],
    queryFn: () => fetch(`${API}/api/brain/state`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const snapshot: IntelligenceSnapshot = snapshotData?.data || {};
  const brainLayers: BrainState[] = brainData?.layers || [];

  const scoreColor = (score: number) => {
    if (score >= 0.8) return "#9cff93";
    if (score >= 0.6) return "#ffd700";
    return "#ff6b6b";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Intelligence Center
      </h1>

      {/* Main Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {/* Intelligence Score */}
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", marginBottom: "8px" }}>
            Intelligence Score
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "32px",
              fontWeight: "bold",
              color: scoreColor(snapshot.intelligenceScore),
            }}
          >
            {(snapshot.intelligenceScore * 100).toFixed(0)}%
          </p>
        </div>

        {/* Active Agents */}
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", marginBottom: "8px" }}>
            Active Agents
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "32px",
              fontWeight: "bold",
              color: "#9cff93",
            }}
          >
            {snapshot.activeAgents}
          </p>
        </div>

        {/* Pipeline Status */}
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", marginBottom: "8px" }}>
            Pipeline Status
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "14px",
              color: snapshot.signalPipelineStatus === "healthy" ? "#9cff93" : "#ff6b6b",
            }}
          >
            {snapshot.signalPipelineStatus}
          </p>
        </div>

        {/* Decision Confidence */}
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", marginBottom: "8px" }}>
            Decision Confidence
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "32px",
              fontWeight: "bold",
              color: scoreColor(snapshot.decisionConfidence),
            }}
          >
            {(snapshot.decisionConfidence * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Brain Layers */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Intelligence Layers
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          {brainLayers.map((layer) => (
            <div
              key={layer.layer}
              style={{
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "16px",
              }}
            >
              <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", fontWeight: "bold", marginBottom: "8px" }}>
                {layer.layer}
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#767576" }}>
                <span>{layer.status}</span>
                <span style={{ color: scoreColor(layer.confidence) }}>
                  {(layer.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
