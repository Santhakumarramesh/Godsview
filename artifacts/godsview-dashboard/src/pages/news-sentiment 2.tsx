import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  bearish: "#ff6b6b",
  warning: "#ff9500",
  neutral: "#ffd700",
};

type News = {
  headline: string;
  sentiment: number;
  impact: "high" | "medium" | "low";
  timestamp: string;
  source: string;
  symbols?: string[];
  detail?: string;
};

type SentimentData = {
  symbol: string;
  score: number;
  volume: number;
  headlines?: number;
};

const sentimentColor = (score: number) => {
  if (score > 0.5) return C.accent;
  if (score > 0.2) return C.neutral;
  if (score > -0.2) return C.muted;
  if (score > -0.5) return C.warning;
  return C.bearish;
};

const impactColor = (impact: string) => {
  if (impact === "high") return C.bearish;
  if (impact === "medium") return C.warning;
  return C.neutral;
};

const sentimentLabel = (score: number) => {
  if (score > 0.5) return "Very Bullish";
  if (score > 0.2) return "Bullish";
  if (score > -0.2) return "Neutral";
  if (score > -0.5) return "Bearish";
  return "Very Bearish";
};

export default function NewsSentimentPage() {
  const [impactFilter, setImpactFilter] = useState("all");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const { data: sentimentData, isLoading: loadingSentiment, error: sentimentError } = useQuery({
    queryKey: ["sentiment"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/sentiment`);
      if (!res.ok) throw new Error("Failed to fetch sentiment");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: newsData, isLoading: loadingNews, error: newsError } = useQuery({
    queryKey: ["macro", "news"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/macro/news`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const sentiments: SentimentData[] = sentimentData?.data || [];
  const allNews: News[] = newsData?.headlines || [];
  const isLoading = loadingSentiment || loadingNews;
  const error = sentimentError || newsError;

  const filteredNews = useMemo(() => {
    if (impactFilter === "all") return allNews;
    return allNews.filter((n) => n.impact === impactFilter);
  }, [allNews, impactFilter]);

  const stats = useMemo(() => {
    const highImpact = allNews.filter((n) => n.impact === "high").length;
    const avgSentiment = sentiments.length > 0
      ? sentiments.reduce((s, d) => s + d.score, 0) / sentiments.length
      : 0;
    const positive = sentiments.filter((s) => s.score > 0.2).length;
    const negative = sentiments.filter((s) => s.score < -0.2).length;
    return { total: allNews.length, highImpact, avgSentiment, positive, negative };
  }, [allNews, sentiments]);

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", padding: "24px", fontFamily: '"Space Grotesk", sans-serif' }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>News & Sentiment Radar</h1>
          <p style={{ color: C.muted, fontSize: "14px" }}>
            Market context from news and sentiment — major headlines, symbol-level scoring, and event risk assessment
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div style={{ backgroundColor: C.card, border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
            <div style={{ color: C.bearish, fontSize: "14px" }}>Failed to load sentiment data</div>
            <div style={{ color: C.muted, fontSize: "12px", marginTop: "4px" }}>{(error as Error).message}</div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div style={{ textAlign: "center", padding: "40px", color: C.muted }}>Loading sentiment data...</div>
        )}

        {/* Stats Bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          {[
            { label: "Total Headlines", value: stats.total, color: C.text },
            { label: "High Impact", value: stats.highImpact, color: C.bearish },
            { label: "Avg Sentiment", value: `${(stats.avgSentiment * 100).toFixed(0)}%`, color: sentimentColor(stats.avgSentiment) },
            { label: "Positive / Negative", value: `${stats.positive} / ${stats.negative}`, color: stats.positive >= stats.negative ? C.accent : C.bearish },
          ].map((m) => (
            <div key={m.label} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{m.label}</div>
              <div style={{ fontSize: "22px", fontWeight: "700", color: m.color, fontFamily: '"JetBrains Mono", monospace' }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Overall Sentiment */}
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "24px" }}>
          <div>
            <p style={{ fontSize: "12px", color: C.muted }}>Market Sentiment</p>
            <p style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "32px", fontWeight: "bold", color: sentimentColor(sentiments[0]?.score || 0), marginTop: "8px" }}>
              {sentiments[0] ? `${(sentiments[0].score * 100).toFixed(0)}%` : "—"}
            </p>
            <p style={{ fontSize: "12px", color: sentimentColor(sentiments[0]?.score || 0), marginTop: "4px" }}>
              {sentiments[0] ? sentimentLabel(sentiments[0].score) : "No data"}
            </p>
          </div>
          <svg viewBox="0 0 200 100" style={{ width: "200px", height: "100px" }}>
            <circle cx="100" cy="60" r="50" fill="none" stroke={C.border} strokeWidth="2" />
            <path
              d="M 100 60 L 130 45"
              stroke={sentimentColor(sentiments[0]?.score || 0)}
              strokeWidth="3"
              style={{
                transform: `rotate(${(sentiments[0]?.score || 0) * 180 - 90}deg)`,
                transformOrigin: "100px 60px",
              }}
            />
            <circle cx="100" cy="60" r="4" fill={sentimentColor(sentiments[0]?.score || 0)} />
          </svg>
        </div>

        {/* Impact Filter */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {["all", "high", "medium", "low"].map((f) => (
            <button
              key={f}
              onClick={() => setImpactFilter(f)}
              style={{
                padding: "6px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
                fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: "600",
                backgroundColor: impactFilter === f ? C.accent : C.card,
                color: impactFilter === f ? "#000" : C.text,
              }}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Major Headlines */}
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "16px", marginBottom: "16px" }}>Major Headlines</h2>
          {filteredNews.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: C.muted }}>
              <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.3 }}>📰</div>
              <div style={{ fontSize: "13px" }}>No headlines match the selected filter</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {filteredNews.slice(0, 10).map((n, i) => (
                <div
                  key={i}
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  style={{
                    backgroundColor: C.bg, border: `1px solid ${impactColor(n.impact)}33`,
                    borderRadius: "8px", padding: "12px", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: "13px", fontWeight: "bold" }}>{n.headline}</p>
                      <p style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: C.muted, marginTop: "4px" }}>
                        {n.source} | {new Date(n.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginLeft: "12px", flexShrink: 0 }}>
                      <span style={{
                        padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "600",
                        backgroundColor: `${sentimentColor(n.sentiment || 0)}22`,
                        color: sentimentColor(n.sentiment || 0),
                      }}>
                        {n.sentiment ? `${(n.sentiment * 100).toFixed(0)}%` : "—"}
                      </span>
                      <span style={{
                        fontFamily: '"JetBrains Mono", monospace', fontSize: "11px",
                        color: impactColor(n.impact), fontWeight: "bold",
                      }}>
                        {n.impact.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  {expandedIdx === i && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: "12px", color: C.muted, marginBottom: "4px" }}>
                        Sentiment: <span style={{ color: sentimentColor(n.sentiment || 0) }}>{sentimentLabel(n.sentiment || 0)}</span>
                      </div>
                      {n.symbols && n.symbols.length > 0 && (
                        <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                          {n.symbols.map((s) => (
                            <span key={s} style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "11px", backgroundColor: `${C.accent}22`, color: C.accent }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Symbol Sentiment Table */}
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", marginBottom: "16px" }}>Sentiment Per Symbol</h2>
          {sentiments.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: C.muted, fontSize: "13px" }}>No symbol sentiment data available</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: '"JetBrains Mono", monospace', fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>Symbol</th>
                  <th style={{ padding: "12px", textAlign: "center", color: C.muted, fontWeight: "normal" }}>Sentiment</th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>Volume</th>
                </tr>
              </thead>
              <tbody>
                {sentiments.slice(0, 15).map((s, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "12px", fontWeight: "bold", color: C.accent }}>{s.symbol}</td>
                    <td style={{ padding: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
                        <div style={{ width: "80px", height: "6px", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: "3px", overflow: "hidden", position: "relative" }}>
                          <div style={{
                            position: "absolute",
                            left: s.score >= 0 ? "50%" : `${50 + s.score * 50}%`,
                            width: `${Math.abs(s.score) * 50}%`,
                            height: "100%",
                            backgroundColor: s.score >= 0 ? C.accent : C.bearish,
                            borderRadius: "3px",
                          }} />
                        </div>
                        <span style={{ color: sentimentColor(s.score), fontSize: "12px", minWidth: "36px", textAlign: "right" }}>
                          {(s.score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>{s.volume.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Last Updated */}
        <div style={{ marginTop: "16px", textAlign: "right", fontSize: "11px", color: C.muted }}>
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
