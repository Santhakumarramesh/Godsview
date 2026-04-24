import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type News = {
  headline: string;
  sentiment: number;
  impact: "high" | "medium" | "low";
  timestamp: string;
  source: string;
};

type SentimentData = {
  symbol: string;
  score: number;
  volume: number;
};

export default function NewsSentimentPage() {
  const { data: sentimentData } = useQuery({
    queryKey: ["sentiment"],
    queryFn: () => fetch(`${API}/api/sentiment`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: newsData } = useQuery({
    queryKey: ["macro", "news"],
    queryFn: () => fetch(`${API}/api/macro/news`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const sentiments: SentimentData[] = sentimentData?.data || [];
  const news: News[] = newsData?.headlines || [];

  const sentimentColor = (score: number) => {
    if (score > 0.5) return "#9cff93";
    if (score > 0.2) return "#ffd700";
    if (score > -0.2) return "#767576";
    if (score > -0.5) return "#ff9500";
    return "#ff6b6b";
  };

  const impactColor = (impact: string) => {
    if (impact === "high") return "#ff6b6b";
    if (impact === "medium") return "#ff9500";
    return "#ffd700";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        News & Sentiment Radar
      </h1>

      {/* Overall Sentiment */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          gap: "24px",
        }}
      >
        <div>
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Market Sentiment
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "32px",
              fontWeight: "bold",
              color: sentimentColor(sentiments[0]?.score || 0),
              marginTop: "8px",
            }}
          >
            {(sentiments[0]?.score * 100).toFixed(0) || "0"}%
          </p>
        </div>
        {/* Sentiment Gauge */}
        <svg viewBox="0 0 200 100" style={{ width: "200px", height: "100px" }}>
          <circle cx="100" cy="60" r="50" fill="none" stroke="rgba(72,72,73,0.2)" strokeWidth="2" />
          <path
            d="M 100 60 L 130 45"
            stroke="#9cff93"
            strokeWidth="3"
            style={{
              transform: `rotate(${(sentiments[0]?.score || 0) * 180 - 90}deg)`,
              transformOrigin: "100px 60px",
            }}
          />
          <circle cx="100" cy="60" r="4" fill="#9cff93" />
        </svg>
      </div>

      {/* Major Headlines */}
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
          Major Headlines
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {news.slice(0, 8).map((n, i) => (
            <div
              key={i}
              style={{
                backgroundColor: "#0e0e0f",
                border: `1px solid ${impactColor(n.impact)}33`,
                borderRadius: "8px",
                padding: "12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", fontWeight: "bold" }}>
                    {n.headline}
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", marginTop: "4px" }}>
                    {n.source} | {new Date(n.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "12px",
                    color: impactColor(n.impact),
                    fontWeight: "bold",
                    marginLeft: "12px",
                  }}
                >
                  {n.impact.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Symbol Sentiment */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          overflowX: "auto",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Sentiment Per Symbol
        </h2>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "13px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Symbol</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Sentiment</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Volume</th>
            </tr>
          </thead>
          <tbody>
            {sentiments.slice(0, 15).map((s, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", fontWeight: "bold", color: "#9cff93" }}>
                  {s.symbol}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: sentimentColor(s.score) }}>
                  {(s.score * 100).toFixed(0)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  {s.volume.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
