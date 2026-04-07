import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

const C = {
  bg: "#0e0e0f", card: "#1a191b", cardAlt: "#141316",
  border: "#2a2a2d", borderFocus: "#3a3a3f",
  text: "#e2e2e6", textDim: "#8b8b92", textMuted: "#5a5a62",
  accent: "#6c5ce7", accentGlow: "rgba(108,92,231,0.25)",
  green: "#00e676", red: "#ff5252", yellow: "#ffd740", blue: "#40c4ff",
  orange: "#ff9100",
};

// Mock data for fallback
const mockSnapshot = {
  overall_sentiment: 0.42,
  direction: "Bullish",
  confidence: 78,
  momentum: 1,
  symbols: [
    { symbol: "AAPL", score: 0.65, direction: "Bullish", news: 45, social: 32, analyst: 23, signals: 12, trend: 1 },
    { symbol: "MSFT", score: 0.58, direction: "Bullish", news: 38, social: 28, analyst: 20, signals: 10, trend: 1 },
    { symbol: "TSLA", score: 0.35, direction: "Neutral", news: 52, social: 41, analyst: 7, signals: 8, trend: 0 },
    { symbol: "NVDA", score: 0.72, direction: "Bullish", news: 48, social: 35, analyst: 17, signals: 14, trend: 1 },
    { symbol: "AMD", score: -0.15, direction: "Bearish", news: 22, social: 18, analyst: 5, signals: 3, trend: -1 },
    { symbol: "GOOGL", score: 0.48, direction: "Bullish", news: 35, social: 25, analyst: 15, signals: 9, trend: 1 },
    { symbol: "META", score: 0.32, direction: "Neutral", news: 28, social: 32, analyst: 12, signals: 6, trend: 0 },
    { symbol: "AMZN", score: 0.55, direction: "Bullish", news: 41, social: 29, analyst: 19, signals: 11, trend: 1 },
  ]
};

const mockNews = [
  { id: 1, headline: "Fed signals slower rate hikes, markets rally", source: "Reuters", sentiment: 0.7, impact: "HIGH", implication: "Bullish", timestamp: "2 hours ago" },
  { id: 2, headline: "Tech earnings beat expectations in Q1", source: "Bloomberg", sentiment: 0.65, impact: "HIGH", implication: "Bullish", timestamp: "4 hours ago" },
  { id: 3, headline: "Supply chain concerns ease for semiconductor makers", source: "CNBC", sentiment: 0.55, impact: "MED", implication: "Bullish", timestamp: "6 hours ago" },
  { id: 4, headline: "Regulatory scrutiny increases on AI governance", source: "Reuters", sentiment: -0.45, impact: "HIGH", implication: "Bearish", timestamp: "8 hours ago" },
  { id: 5, headline: "Cloud computing demand remains strong", source: "TechCrunch", sentiment: 0.58, impact: "MED", implication: "Bullish", timestamp: "10 hours ago" },
  { id: 6, headline: "Energy sector volatility amid geopolitical tensions", source: "Bloomberg", sentiment: -0.35, impact: "MED", implication: "Bearish", timestamp: "12 hours ago" },
  { id: 7, headline: "Consumer spending shows resilience", source: "Reuters", sentiment: 0.52, impact: "MED", implication: "Bullish", timestamp: "14 hours ago" },
];

const mockSocial = {
  trending: [
    { symbol: "AAPL", mentions: 1240 },
    { symbol: "TSLA", mentions: 1100 },
    { symbol: "NVDA", mentions: 950 },
    { symbol: "META", mentions: 780 },
    { symbol: "GOOGL", mentions: 720 },
    { symbol: "MSFT", mentions: 680 },
  ],
  alerts: [
    { text: "TSLA unusual volume spike detected", severity: "HIGH", time: "5m ago" },
    { text: "NVDA AI sentiment surge on new product", severity: "MED", time: "15m ago" },
    { text: "AAPL bearish sentiment cluster", severity: "LOW", time: "35m ago" },
  ],
  platforms: {
    twitter: { bullish: 62, bearish: 38 },
    reddit: { bullish: 58, bearish: 42 },
    stocktwits: { bullish: 71, bearish: 29 }
  },
  volumeSpikes: ["TSLA", "NVDA", "AAPL"]
};

const mockMovers = {
  bullish: [
    { symbol: "NVDA", score: 0.72, delta: 0.08, sources: 18 },
    { symbol: "AAPL", score: 0.65, delta: 0.12, sources: 14 },
    { symbol: "MSFT", score: 0.58, delta: 0.06, sources: 12 },
  ],
  bearish: [
    { symbol: "AMD", score: -0.15, delta: -0.18, sources: 8 },
    { symbol: "INTC", score: -0.22, delta: -0.14, sources: 6 },
  ]
};

const mockKeywords = [
  { word: "bullish", size: 42, sentiment: 1 },
  { word: "earnings", size: 38, sentiment: 0 },
  { word: "rally", size: 36, sentiment: 1 },
  { word: "surge", size: 32, sentiment: 1 },
  { word: "growth", size: 30, sentiment: 1 },
  { word: "correction", size: 28, sentiment: -1 },
  { word: "risk", size: 26, sentiment: -1 },
  { word: "selloff", size: 24, sentiment: -1 },
  { word: "innovation", size: 22, sentiment: 1 },
  { word: "volatility", size: 20, sentiment: -1 },
  { word: "momentum", size: 19, sentiment: 0 },
  { word: "breakout", size: 18, sentiment: 1 },
  { word: "decline", size: 17, sentiment: -1 },
  { word: "pressure", size: 16, sentiment: -1 },
  { word: "optimism", size: 15, sentiment: 1 },
  { word: "concern", size: 14, sentiment: -1 },
  { word: "strength", size: 13, sentiment: 1 },
  { word: "weakness", size: 12, sentiment: -1 },
  { word: "upside", size: 11, sentiment: 1 },
  { word: "downside", size: 10, sentiment: -1 },
];

// Market Sentiment Banner
function MarketSentimentBanner() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sentiment-snapshot'],
    queryFn: () => fetch('/api/sentiment/snapshot').then(r => r.json()),
  });

  const snapshot = data || mockSnapshot;
  const sentiment = snapshot.overall_sentiment || 0;
  const direction = snapshot.direction || "Neutral";
  const confidence = snapshot.confidence || 0;
  const momentum = snapshot.momentum || 0;

  const sentimentColor = sentiment > 0.2 ? C.green : sentiment < -0.2 ? C.red : C.yellow;
  const gaugeRotation = (sentiment + 1) * 90;
  const momentumArrow = momentum > 0 ? "↑" : momentum < 0 ? "↓" : "→";

  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.card} 0%, ${C.cardAlt} 100%)`,
      border: `1px solid ${C.border}`,
      borderRadius: "12px",
      padding: "32px",
      marginBottom: "24px",
      display: "flex",
      alignItems: "center",
      gap: "40px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    }}>
      <div style={{ flex: 1 }}>
        <h2 style={{ color: C.text, fontSize: "28px", fontWeight: "bold", margin: "0 0 8px 0" }}>Market Sentiment</h2>
        <p style={{ color: C.textDim, fontSize: "14px", margin: "0" }}>Real-time sentiment analysis</p>
      </div>

      <div style={{ position: "relative", width: "140px", height: "140px" }}>
        <svg width="140" height="140" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="70" cy="70" r="60" fill="none" stroke={C.border} strokeWidth="12" />
          <circle cx="70" cy="70" r="60" fill="none" stroke={sentimentColor} strokeWidth="12" strokeDasharray={`${(sentiment + 1) * 30 * 3.14}px`} strokeLinecap="round" opacity={0.8} />
          <text x="70" y="75" textAnchor="middle" style={{ fontSize: "24px", fontWeight: "bold", fill: sentimentColor }}>
            {(sentiment * 100).toFixed(0)}%
          </text>
        </svg>
      </div>

      <div style={{ minWidth: "200px" }}>
        <div style={{ marginBottom: "16px" }}>
          <p style={{ color: C.textMuted, fontSize: "12px", margin: "0 0 4px 0", textTransform: "uppercase" }}>Direction</p>
          <p style={{ color: sentimentColor, fontSize: "20px", fontWeight: "bold", margin: 0 }}>{direction}</p>
        </div>
        <div style={{ marginBottom: "16px" }}>
          <p style={{ color: C.textMuted, fontSize: "12px", margin: "0 0 4px 0", textTransform: "uppercase" }}>Confidence</p>
          <p style={{ color: C.text, fontSize: "16px", fontWeight: "600", margin: 0 }}>{confidence}%</p>
        </div>
        <div>
          <p style={{ color: C.textMuted, fontSize: "12px", margin: "0 0 4px 0", textTransform: "uppercase" }}>Momentum</p>
          <p style={{ color: C.accent, fontSize: "18px", fontWeight: "bold", margin: 0 }}>{momentumArrow}</p>
        </div>
      </div>
    </div>
  );
}

// Symbol Sentiment Grid
function SymbolSentimentGrid() {
  const { data, isLoading } = useQuery({
    queryKey: ['sentiment-snapshot'],
    queryFn: () => fetch('/api/sentiment/snapshot').then(r => r.json()),
  });

  const symbols = data?.symbols || mockSnapshot.symbols;

  return (
    <div style={{ marginBottom: "32px" }}>
      <h3 style={{ color: C.text, fontSize: "20px", fontWeight: "bold", margin: "0 0 16px 0" }}>Top Symbols</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
        {symbols.slice(0, 8).map((sym) => {
          const scoreColor = sym.score > 0.2 ? C.green : sym.score < -0.2 ? C.red : C.yellow;
          const total = sym.news + sym.social + sym.analyst;
          return (
            <div key={sym.symbol} style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "16px",
              transition: "all 0.3s",
              cursor: "pointer",
            }} onMouseEnter={(e) => {
              e.currentTarget.style.background = C.cardAlt;
              e.currentTarget.style.borderColor = C.borderFocus;
            }} onMouseLeave={(e) => {
              e.currentTarget.style.background = C.card;
              e.currentTarget.style.borderColor = C.border;
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h4 style={{ color: C.text, fontSize: "16px", fontWeight: "bold", margin: 0 }}>{sym.symbol}</h4>
                <span style={{
                  background: sym.score > 0.2 ? `${C.green}20` : sym.score < -0.2 ? `${C.red}20` : `${C.yellow}20`,
                  color: scoreColor,
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: "600",
                }}>
                  {sym.direction}
                </span>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <p style={{ color: C.textMuted, fontSize: "11px", margin: "0 0 6px 0" }}>Score</p>
                <div style={{ background: C.bg, borderRadius: "4px", height: "8px", overflow: "hidden" }}>
                  <div style={{
                    width: `${((sym.score + 1) / 2) * 100}%`,
                    height: "100%",
                    background: scoreColor,
                    transition: "width 0.3s",
                  }} />
                </div>
                <p style={{ color: scoreColor, fontSize: "12px", fontWeight: "600", margin: "4px 0 0 0" }}>{(sym.score * 100).toFixed(0)}</p>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <p style={{ color: C.textMuted, fontSize: "11px", margin: "0 0 6px 0" }}>Sources</p>
                <div style={{ display: "flex", gap: "4px", fontSize: "12px" }}>
                  <span style={{ color: C.textDim }}>News <strong style={{ color: C.text }}>{((sym.news / total) * 100).toFixed(0)}%</strong></span>
                  <span style={{ color: C.textDim }}>Social <strong style={{ color: C.text }}>{((sym.social / total) * 100).toFixed(0)}%</strong></span>
                  <span style={{ color: C.textDim }}>Analyst <strong style={{ color: C.text }}>{((sym.analyst / total) * 100).toFixed(0)}%</strong></span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: C.textDim }}>
                <span>{sym.signals} signals</span>
                <span style={{ color: sym.trend > 0 ? C.green : sym.trend < 0 ? C.red : C.textDim }}>
                  {sym.trend > 0 ? "↑" : sym.trend < 0 ? "↓" : "→"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// News Feed
function NewsFeed() {
  const [filter, setFilter] = useState("All");
  const { data, isLoading } = useQuery({
    queryKey: ['sentiment-news'],
    queryFn: () => fetch('/api/sentiment/news').then(r => r.json()),
  });

  const news = data || mockNews;
  const filtered = filter === "All" ? news : news.filter(n => {
    if (filter === "Bullish") return n.sentiment > 0.3;
    if (filter === "Bearish") return n.sentiment < -0.3;
    if (filter === "High Impact") return n.impact === "HIGH";
    return true;
  });

  return (
    <div style={{ marginBottom: "32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h3 style={{ color: C.text, fontSize: "20px", fontWeight: "bold", margin: 0 }}>News Feed</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          {["All", "Bullish", "Bearish", "High Impact"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? C.accent : C.card,
              color: filter === f ? "#000" : C.text,
              border: filter === f ? "none" : `1px solid ${C.border}`,
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.2s",
            }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxHeight: "400px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        {filtered.map(item => {
          const sentimentColor = item.sentiment > 0.3 ? C.green : item.sentiment < -0.3 ? C.red : C.yellow;
          const impactColor = item.impact === "HIGH" ? C.red : item.impact === "MED" ? C.yellow : C.textDim;
          return (
            <div key={item.id} style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "12px",
            }}>
              <div style={{ marginBottom: "8px" }}>
                <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ background: `${sentimentColor}20`, color: sentimentColor, padding: "2px 6px", borderRadius: "3px", fontSize: "10px", fontWeight: "600" }}>
                    {item.source}
                  </span>
                  <span style={{ background: `${impactColor}20`, color: impactColor, padding: "2px 6px", borderRadius: "3px", fontSize: "10px", fontWeight: "600" }}>
                    {item.impact}
                  </span>
                  <span style={{ marginLeft: "auto", color: C.textMuted, fontSize: "10px" }}>{item.timestamp}</span>
                </div>
                <h4 style={{ color: C.text, fontSize: "14px", fontWeight: "600", margin: "0 0 6px 0" }}>{item.headline}</h4>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                <div style={{ flex: 1, marginRight: "12px" }}>
                  <div style={{ background: C.bg, borderRadius: "3px", height: "6px", overflow: "hidden" }}>
                    <div style={{
                      width: `${((item.sentiment + 1) / 2) * 100}%`,
                      height: "100%",
                      background: sentimentColor,
                    }} />
                  </div>
                </div>
                <span style={{
                  background: item.sentiment > 0 ? `${C.green}20` : item.sentiment < 0 ? `${C.red}20` : `${C.yellow}20`,
                  color: sentimentColor,
                  padding: "2px 6px",
                  borderRadius: "3px",
                  fontSize: "10px",
                  fontWeight: "600",
                  minWidth: "40px",
                  textAlign: "center",
                }}>
                  {item.implication}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Social Pulse
function SocialPulse() {
  const { data, isLoading } = useQuery({
    queryKey: ['sentiment-social'],
    queryFn: () => fetch('/api/sentiment/social').then(r => r.json()),
  });

  const social = data || mockSocial;
  const maxMentions = Math.max(...social.trending.map(t => t.mentions));

  return (
    <div style={{ marginBottom: "32px" }}>
      <h3 style={{ color: C.text, fontSize: "20px", fontWeight: "bold", margin: "0 0 16px 0" }}>Social Pulse</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Trending Symbols */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          padding: "16px",
        }}>
          <h4 style={{ color: C.text, fontSize: "14px", fontWeight: "bold", margin: "0 0 12px 0" }}>Trending Symbols</h4>
          {social.trending.map(t => (
            <div key={t.symbol} style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <span style={{ color: C.text, fontWeight: "600" }}>{t.symbol}</span>
                <span style={{ color: C.textDim }}>{t.mentions} mentions</span>
              </div>
              <div style={{ background: C.bg, borderRadius: "3px", height: "6px", overflow: "hidden" }}>
                <div style={{ width: `${(t.mentions / maxMentions) * 100}%`, height: "100%", background: C.accent }} />
              </div>
            </div>
          ))}
        </div>

        {/* Active Alerts */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          padding: "16px",
        }}>
          <h4 style={{ color: C.text, fontSize: "14px", fontWeight: "bold", margin: "0 0 12px 0" }}>Active Alerts</h4>
          {social.alerts.map((a, i) => {
            const severityColor = a.severity === "HIGH" ? C.red : a.severity === "MED" ? C.yellow : C.green;
            return (
              <div key={i} style={{
                display: "flex",
                gap: "8px",
                marginBottom: "12px",
                alignItems: "flex-start",
              }}>
                <span style={{
                  background: severityColor,
                  color: "#000",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  fontSize: "10px",
                  fontWeight: "700",
                  minWidth: "40px",
                  textAlign: "center",
                  marginTop: "2px",
                }}>
                  {a.severity}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ color: C.text, fontSize: "12px", margin: "0 0 2px 0", fontWeight: "600" }}>{a.text}</p>
                  <p style={{ color: C.textMuted, fontSize: "11px", margin: 0 }}>{a.time}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Platform Gauges */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          padding: "16px",
          gridColumn: "1 / -1",
        }}>
          <h4 style={{ color: C.text, fontSize: "14px", fontWeight: "bold", margin: "0 0 12px 0" }}>Bull/Bear Ratio by Platform</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
            {Object.entries(social.platforms).map(([platform, data]) => (
              <div key={platform}>
                <p style={{ color: C.textMuted, fontSize: "11px", margin: "0 0 8px 0", textTransform: "capitalize" }}>{platform}</p>
                <div style={{ display: "flex", height: "20px", borderRadius: "4px", overflow: "hidden", marginBottom: "4px" }}>
                  <div style={{ flex: data.bullish, background: C.green, opacity: 0.8 }} />
                  <div style={{ flex: data.bearish, background: C.red, opacity: 0.8 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                  <span style={{ color: C.green }}>{data.bullish}%</span>
                  <span style={{ color: C.red }}>{data.bearish}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Volume Spikes */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          padding: "16px",
          gridColumn: "1 / -1",
        }}>
          <h4 style={{ color: C.text, fontSize: "14px", fontWeight: "bold", margin: "0 0 12px 0" }}>Volume Spike Indicators</h4>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {social.volumeSpikes.map(symbol => (
              <div key={symbol} style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: `${C.orange}20`,
                border: `1px solid ${C.orange}`,
                padding: "6px 10px",
                borderRadius: "6px",
              }}>
                <span style={{ width: "6px", height: "6px", background: C.orange, borderRadius: "50%", animation: "pulse 2s infinite" }} />
                <span style={{ color: C.text, fontSize: "12px", fontWeight: "600" }}>{symbol}</span>
              </div>
            ))}
          </div>
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}

// Top Movers
function TopMovers() {
  const { data, isLoading } = useQuery({
    queryKey: ['sentiment-movers'],
    queryFn: () => fetch('/api/sentiment/movers').then(r => r.json()),
  });

  const movers = data || mockMovers;

  return (
    <div style={{ marginBottom: "32px" }}>
      <h3 style={{ color: C.text, fontSize: "20px", fontWeight: "bold", margin: "0 0 16px 0" }}>Top Movers</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Most Bullish */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          padding: "16px",
        }}>
          <h4 style={{ color: C.green, fontSize: "14px", fontWeight: "bold", margin: "0 0 12px 0" }}>Most Bullish</h4>
          {movers.bullish.map((m, i) => (
            <div key={i} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: i < movers.bullish.length - 1 ? `1px solid ${C.border}` : "none",
              animation: m.score > 0.6 ? "pulse 2s infinite" : "none",
            }}>
              <div>
                <p style={{ color: C.text, fontSize: "14px", fontWeight: "bold", margin: 0 }}>{m.symbol}</p>
                <p style={{ color: C.textDim, fontSize: "11px", margin: "2px 0 0 0" }}>{m.sources} sources</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ color: C.green, fontSize: "14px", fontWeight: "bold", margin: 0 }}>{(m.score * 100).toFixed(0)}</p>
                <p style={{ color: C.green, fontSize: "12px", margin: "2px 0 0 0" }}>+{(m.delta * 100).toFixed(1)}%</p>
              </div>
            </div>
          ))}
        </div>

        {/* Most Bearish */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          padding: "16px",
        }}>
          <h4 style={{ color: C.red, fontSize: "14px", fontWeight: "bold", margin: "0 0 12px 0" }}>Most Bearish</h4>
          {movers.bearish.map((m, i) => (
            <div key={i} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: i < movers.bearish.length - 1 ? `1px solid ${C.border}` : "none",
              animation: m.score < -0.4 ? "pulse 2s infinite" : "none",
            }}>
              <div>
                <p style={{ color: C.text, fontSize: "14px", fontWeight: "bold", margin: 0 }}>{m.symbol}</p>
                <p style={{ color: C.textDim, fontSize: "11px", margin: "2px 0 0 0" }}>{m.sources} sources</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ color: C.red, fontSize: "14px", fontWeight: "bold", margin: 0 }}>{(m.score * 100).toFixed(0)}</p>
                <p style={{ color: C.red, fontSize: "12px", margin: "2px 0 0 0" }}>{(m.delta * 100).toFixed(1)}%</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Keyword Cloud
function KeywordCloud() {
  const { data, isLoading } = useQuery({
    queryKey: ['sentiment-keywords'],
    queryFn: () => fetch('/api/sentiment/keywords').then(r => r.json()),
  });

  const keywords = data || mockKeywords;
  const maxSize = Math.max(...keywords.map(k => k.size));
  const minSize = Math.min(...keywords.map(k => k.size));

  // Generate word cloud layout
  const positions = keywords.map((kw, i) => {
    const angle = (i / keywords.length) * Math.PI * 2;
    const radius = 60 + (i % 3) * 40;
    return {
      ...kw,
      x: 200 + Math.cos(angle) * radius,
      y: 150 + Math.sin(angle) * radius,
    };
  });

  return (
    <div style={{ marginBottom: "32px" }}>
      <h3 style={{ color: C.text, fontSize: "20px", fontWeight: "bold", margin: "0 0 16px 0" }}>Trending Keywords</h3>
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        padding: "16px",
        minHeight: "300px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}>
        <svg width="100%" height="300" style={{ minHeight: "300px" }}>
          {positions.map((kw, i) => {
            const fontSize = (((kw.size - minSize) / (maxSize - minSize)) * 24) + 12;
            const color = kw.sentiment > 0 ? C.green : kw.sentiment < 0 ? C.red : C.textDim;
            const opacity = 0.6 + ((kw.size - minSize) / (maxSize - minSize)) * 0.4;
            return (
              <text
                key={i}
                x={kw.x}
                y={kw.y}
                textAnchor="middle"
                style={{
                  fontSize: `${fontSize}px`,
                  fontWeight: "600",
                  fill: color,
                  opacity: opacity,
                  cursor: "pointer",
                  userSelect: "none",
                  transition: "all 0.3s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.fontSize = `${fontSize * 1.2}px`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = String(opacity);
                  e.currentTarget.style.fontSize = `${fontSize}px`;
                }}
              >
                {kw.word}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// Main Page Component
export default function SentimentIntelPage() {
  return (
    <div style={{
      background: C.bg,
      color: C.text,
      minHeight: "100vh",
      padding: "24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ color: C.text, fontSize: "32px", fontWeight: "bold", margin: "0 0 8px 0" }}>Sentiment Intelligence</h1>
          <p style={{ color: C.textDim, fontSize: "14px", margin: 0 }}>Market sentiment analysis powered by news, social media, and analyst reports</p>
        </div>

        <MarketSentimentBanner />
        <SymbolSentimentGrid />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <NewsFeed />
          <SocialPulse />
        </div>

        <TopMovers />
        <KeywordCloud />
      </div>
    </div>
  );
}
