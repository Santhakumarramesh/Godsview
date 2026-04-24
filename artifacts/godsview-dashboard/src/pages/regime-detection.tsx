import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type RegimeState = {
  currentRegime: string;
  confidence: number;
  volatilityProfile: string;
  trendStrength: number;
  lastChange: string;
};

type RegimeHistory = {
  timestamp: string;
  regime: string;
  durationSeconds: number;
};

export default function RegimeDetectionPage() {
  const { data: macroData, isLoading: loadingMacro, error: errorMacro } = useQuery({
    queryKey: ["macro", "regime"],
    queryFn: () => fetch(`${API}/api/macro`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: structureData, isLoading: loadingStructure, error: errorStructure } = useQuery({
    queryKey: ["market", "structure"],
    queryFn: () => fetch(`${API}/api/market-structure`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const regime: RegimeState = macroData?.regime || {};
  const history: RegimeHistory[] = structureData?.regimeHistory || [];

  const regimeColor = (regime: string) => {
    if (regime === "trending") return "#9cff93";
    if (regime === "choppy") return "#ffd700";
    if (regime === "volatile") return "#ff9500";
    return "#ff6b6b";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Regime Detection
      </h1>

      {(loadingMacro || loadingStructure) && (
        <div style={{ textAlign: "center", padding: "40px", color: "#767576" }}>Loading data...</div>
      )}

      {(errorMacro || errorStructure) && (
        <div style={{ backgroundColor: "#1a191b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ color: "#ff6b6b", fontSize: "14px" }}>Failed to load data</div>
          <div style={{ color: "#767576", fontSize: "12px", marginTop: "4px" }}>Check API connection</div>
        </div>
      )}

      {/* Current Regime */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Current Regime
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "24px",
              fontWeight: "bold",
              color: regimeColor(regime.currentRegime),
              marginTop: "8px",
            }}
          >
            {regime.currentRegime?.toUpperCase() || "---"}
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
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Confidence
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "24px",
              fontWeight: "bold",
              color: "#9cff93",
              marginTop: "8px",
            }}
          >
            {(regime.confidence * 100).toFixed(0)}%
          </p>
          {/* Confidence Meter */}
          <div
            style={{
              width: "100%",
              height: "4px",
              background: "rgba(72,72,73,0.2)",
              borderRadius: "2px",
              marginTop: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${regime.confidence * 100}%`,
                height: "100%",
                background: "#9cff93",
              }}
            />
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
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Trend Strength
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "24px",
              fontWeight: "bold",
              color: "#ffd700",
              marginTop: "8px",
            }}
          >
            {(regime.trendStrength * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Volatility Profile */}
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
          Volatility Profile
        </h2>
        <p
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "14px",
            color: "#9cff93",
          }}
        >
          {regime.volatilityProfile || "Analyzing..."}
        </p>
      </div>

      {/* Regime History */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Recent Regime Transitions
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {history.slice(0, 10).map((h, i) => (
            <div
              key={i}
              style={{
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "12px",
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
              }}
            >
              <span style={{ color: regimeColor(h.regime), fontWeight: "bold" }}>
                {h.regime.toUpperCase()}
              </span>
              <span style={{ color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                {new Date(h.timestamp).toLocaleTimeString()}
              </span>
              <span style={{ color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
                {(h.durationSeconds / 60).toFixed(0)}m
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
