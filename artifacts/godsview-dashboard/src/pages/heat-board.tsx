import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type HeatSetup = {
  symbol: string;
  strength: number;
  bias: "bullish" | "bearish" | "neutral";
  urgency: "hot" | "warm" | "cool";
  momentum: number;
};

export default function HeatBoardPage() {
  const { data: signalsData, isLoading: loadingSignals, error: errorSignals } = useQuery({
    queryKey: ["signals", "latest"],
    queryFn: () => fetch(`${API}/api/signals/latest`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: watchlistData, isLoading: loadingWatchlist, error: errorWatchlist } = useQuery({
    queryKey: ["watchlist", "scan"],
    queryFn: () => fetch(`${API}/api/watchlist/scan`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  let setups: HeatSetup[] = signalsData?.data || [];
  watchlistData?.data?.forEach((w: HeatSetup) => {
    if (!setups.find((s) => s.symbol === w.symbol)) setups.push(w);
  });

  const strengthColor = (strength: number) => {
    if (strength > 0.8) return "#ff2e2e";
    if (strength > 0.6) return "#ff6b6b";
    if (strength > 0.4) return "#ff9500";
    return "#ffd700";
  };

  const biasArrow = (bias: string) => {
    if (bias === "bullish") return "↑";
    if (bias === "bearish") return "↓";
    return "→";
  };

  const biasColor = (bias: string) => {
    if (bias === "bullish") return "#9cff93";
    if (bias === "bearish") return "#ff6b6b";
    return "#767576";
  };

  const urgencyBg = (urgency: string) => {
    if (urgency === "hot") return "rgba(255, 46, 46, 0.15)";
    if (urgency === "warm") return "rgba(255, 107, 107, 0.15)";
    return "rgba(255, 215, 0, 0.15)";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Heat Candidate Board
      </h1>

      {(loadingSignals || loadingWatchlist) && (
        <div style={{ textAlign: "center", padding: "40px", color: "#767576" }}>Loading data...</div>
      )}

      {(errorSignals || errorWatchlist) && (
        <div style={{ backgroundColor: "#1a191b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ color: "#ff6b6b", fontSize: "14px" }}>Failed to load data</div>
          <div style={{ color: "#767576", fontSize: "12px", marginTop: "4px" }}>Check API connection</div>
        </div>
      )}

      {/* Grid of Hot Setups */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
        {setups.slice(0, 20).map((setup, i) => (
          <div
            key={i}
            style={{
              backgroundColor: "#1a191b",
              border: `1px solid ${strengthColor(setup.strength)}`,
              borderRadius: "8px",
              padding: "16px",
              background: urgencyBg(setup.urgency),
            }}
          >
            {/* Header: Symbol + Bias */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <span
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "16px",
                  fontWeight: "bold",
                  color: "#9cff93",
                }}
              >
                {setup.symbol}
              </span>
              <span
                style={{
                  fontSize: "24px",
                  color: biasColor(setup.bias),
                  fontWeight: "bold",
                }}
              >
                {biasArrow(setup.bias)}
              </span>
            </div>

            {/* Strength Bar */}
            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  marginBottom: "4px",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Strength</span>
                <span style={{ color: strengthColor(setup.strength) }}>
                  {(setup.strength * 100).toFixed(0)}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "6px",
                  background: "rgba(72,72,73,0.2)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${setup.strength * 100}%`,
                    height: "100%",
                    background: strengthColor(setup.strength),
                  }}
                />
              </div>
            </div>

            {/* Momentum */}
            <div
              style={{
                fontSize: "11px",
                color: "#767576",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <span>Momentum</span>
              <span style={{ color: setup.momentum > 0 ? "#9cff93" : "#ff6b6b" }}>
                {setup.momentum > 0 ? "+" : ""}{(setup.momentum * 100).toFixed(0)}%
              </span>
            </div>

            {/* Urgency Badge */}
            <div
              style={{
                display: "inline-block",
                padding: "4px 12px",
                background: strengthColor(setup.strength),
                color: "#0e0e0f",
                borderRadius: "4px",
                fontSize: "10px",
                fontWeight: "bold",
                fontFamily: "Space Grotesk",
              }}
            >
              {setup.urgency.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "16px",
          marginTop: "24px",
          fontSize: "12px",
        }}
      >
        <p style={{ fontFamily: "Space Grotesk", fontWeight: "bold", marginBottom: "8px" }}>Legend</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          <div>
            <span style={{ color: "#ff2e2e" }}>■</span> <span style={{ color: "#767576" }}>Extreme Heat (80%+)</span>
          </div>
          <div>
            <span style={{ color: "#ff6b6b" }}>■</span> <span style={{ color: "#767576" }}>Hot (60-80%)</span>
          </div>
          <div>
            <span style={{ color: "#ff9500" }}>■</span> <span style={{ color: "#767576" }}>Warm (40-60%)</span>
          </div>
          <div>
            <span style={{ color: "#9cff93" }}>↑</span> <span style={{ color: "#767576" }}>Bullish Bias</span>
          </div>
          <div>
            <span style={{ color: "#ff6b6b" }}>↓</span> <span style={{ color: "#767576" }}>Bearish Bias</span>
          </div>
          <div>
            <span style={{ color: "#767576" }}>→</span> <span style={{ color: "#767576" }}>Neutral Bias</span>
          </div>
        </div>
      </div>
    </div>
  );
}
