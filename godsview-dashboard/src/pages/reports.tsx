import { useState, useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface SessionReport {
  id: string;
  date: string;
  session: "NY Morning" | "London Open" | "Asian" | "Overnight";
  duration: string;
  totalTrades: number;
  winners: number;
  losers: number;
  breakeven: number;
  grossPnl: number;
  netPnl: number;
  rRealized: number;
  maxDrawdown: number;
  bestTrade: { symbol: string; pnl: number; r: number };
  worstTrade: { symbol: string; pnl: number; r: number };
  setupBreakdown: { setup: string; count: number; winRate: number }[];
  pipelineHealth: { layer: string; avgScore: number }[];
  brainInsight: string;
  emotionalState: "Disciplined" | "FOMO" | "Revenge" | "Patient" | "Hesitant";
  riskCompliance: number;
}
// ─── Mock Data ───────────────────────────────────────────────────────────────
const REPORTS: SessionReport[] = [
  {
    id: "RPT-20260330-NY",
    date: "2026-03-30",
    session: "NY Morning",
    duration: "4h 12m",
    totalTrades: 6,
    winners: 4,
    losers: 1,
    breakeven: 1,
    grossPnl: 892,
    netPnl: 847,
    rRealized: 4.2,
    maxDrawdown: -118,
    bestTrade: { symbol: "NVDA", pnl: 342, r: 2.1 },
    worstTrade: { symbol: "TSLA", pnl: -118, r: -0.8 },
    setupBreakdown: [
      { setup: "Sweep Reclaim", count: 3, winRate: 100 },
      { setup: "CVD Divergence", count: 2, winRate: 50 },
      { setup: "Absorption Reversal", count: 1, winRate: 0 },
    ],
    pipelineHealth: [
      { layer: "Structure", avgScore: 0.87 },
      { layer: "Order Flow", avgScore: 0.82 },
      { layer: "Recall", avgScore: 0.91 },
      { layer: "ML", avgScore: 0.68 },
      { layer: "Claude", avgScore: 0.84 },
    ],
    brainInsight: "Strong session. Sweep Reclaim setups outperformed — the 81% historical win rate held true. CVD Divergence on ETH was premature; the divergence resolved before the entry trigger. Absorption Reversal on TSLA was the only loser — volume threshold was borderline (1.48× vs 1.5× required). Consider tightening the volume filter for this setup. Brain memory updated with today's outcomes.",
    emotionalState: "Disciplined",
    riskCompliance: 98,
  },
  {
    id: "RPT-20260329-LDN",
    date: "2026-03-29",
    session: "London Open",
    duration: "3h 45m",
    totalTrades: 4,
    winners: 2,
    losers: 2,
    breakeven: 0,
    grossPnl: 214,
    netPnl: 178,
    rRealized: 1.4,
    maxDrawdown: -245,
    bestTrade: { symbol: "BTC/USD", pnl: 456, r: 2.8 },
    worstTrade: { symbol: "ETH/USD", pnl: -245, r: -1.6 },
    setupBreakdown: [
      { setup: "Sweep Reclaim", count: 2, winRate: 50 },
      { setup: "Continuation Pullback", count: 2, winRate: 50 },
    ],
    pipelineHealth: [
      { layer: "Structure", avgScore: 0.74 },
      { layer: "Order Flow", avgScore: 0.78 },
      { layer: "Recall", avgScore: 0.82 },
      { layer: "ML", avgScore: 0.64 },
      { layer: "Claude", avgScore: 0.76 },
    ],
    brainInsight: "Mixed session. The BTC sweep reclaim was textbook — massive delta divergence at the low, clean reclaim above the SK zone. ETH loss was avoidable: the Continuation Pullback triggered during a macro news spike (10Y yield moved 3bps). Claude flagged the macro risk but scored it as 'acceptable'. Consider adding a hard news-proximity filter for crypto during US data releases.",
    emotionalState: "Patient",
    riskCompliance: 92,
  },  {
    id: "RPT-20260328-NY",
    date: "2026-03-28",
    session: "NY Morning",
    duration: "5h 02m",
    totalTrades: 8,
    winners: 3,
    losers: 4,
    breakeven: 1,
    grossPnl: -124,
    netPnl: -172,
    rRealized: -1.2,
    maxDrawdown: -380,
    bestTrade: { symbol: "SPY", pnl: 198, r: 1.4 },
    worstTrade: { symbol: "NVDA", pnl: -156, r: -1.1 },
    setupBreakdown: [
      { setup: "Breakout Failure", count: 3, winRate: 33 },
      { setup: "CVD Divergence", count: 3, winRate: 33 },
      { setup: "Sweep Reclaim", count: 2, winRate: 50 },
    ],
    pipelineHealth: [
      { layer: "Structure", avgScore: 0.62 },
      { layer: "Order Flow", avgScore: 0.58 },
      { layer: "Recall", avgScore: 0.70 },
      { layer: "ML", avgScore: 0.52 },
      { layer: "Claude", avgScore: 0.68 },
    ],
    brainInsight: "Below-average session. Overtraded — 8 trades vs the 5-6 avg. Breakout Failure setups should have been avoided; the regime was BALANCED, not EXTREME (which is where this setup has historical edge). Three CVD Divergence trades in one session indicates possible pattern-forcing. Risk engine triggered a 30-min cooldown after the 3rd consecutive loss which prevented further damage. Key lesson: stick to Sweep Reclaim and Absorption Reversal during BALANCED regimes.",
    emotionalState: "FOMO",
    riskCompliance: 78,
  },
  {
    id: "RPT-20260327-ASN",
    date: "2026-03-27",
    session: "Asian",
    duration: "2h 30m",
    totalTrades: 2,
    winners: 2,
    losers: 0,
    breakeven: 0,
    grossPnl: 324,
    netPnl: 298,
    rRealized: 3.6,
    maxDrawdown: 0,
    bestTrade: { symbol: "BTC/USD", pnl: 218, r: 2.4 },
    worstTrade: { symbol: "ETH/USD", pnl: 106, r: 1.2 },
    setupBreakdown: [
      { setup: "Absorption Reversal", count: 2, winRate: 100 },
    ],
    pipelineHealth: [
      { layer: "Structure", avgScore: 0.92 },
      { layer: "Order Flow", avgScore: 0.88 },
      { layer: "Recall", avgScore: 0.85 },
      { layer: "ML", avgScore: 0.78 },
      { layer: "Claude", avgScore: 0.90 },
    ],
    brainInsight: "Excellent session. Patience rewarded — only 2 trades but both high-conviction Absorption Reversals with all pipeline layers scoring above 0.78. The Asian session's lower volatility made the absorption patterns cleaner and more reliable. Brain memory has been updated: Absorption Reversal during Asian session now has 94% win rate (n=16). This is becoming a high-edge specialization.",
    emotionalState: "Disciplined",
    riskCompliance: 100,
  },
];
// ─── Helpers ─────────────────────────────────────────────────────────────────
const emotionColor: Record<string, string> = {
  Disciplined: "#9cff93", FOMO: "#ff7162", Revenge: "#ff4444", Patient: "#669dff", Hesitant: "#ffd166",
};
const sessionColor: Record<string, string> = {
  "NY Morning": "#669dff", "London Open": "#ffd166", Asian: "#00dfc1", Overnight: "#8c909f",
};

function formatPnl(v: number): string {
  return (v >= 0 ? "+" : "") + "$" + v.toLocaleString();
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ReportsHeader() {
  const totalPnl = REPORTS.reduce((s, r) => s + r.netPnl, 0);
  const totalTrades = REPORTS.reduce((s, r) => s + r.totalTrades, 0);
  const totalWins = REPORTS.reduce((s, r) => s + r.winners, 0);

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="material-symbols-outlined" style={{ color: "#ffd166", fontSize: 28 }}>summarize</span>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#e6e1e5", margin: 0, letterSpacing: "-0.02em" }}>
            SESSION REPORTS
          </h1>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
            POST-SESSION INTELLIGENCE · BRAIN MEMORY UPDATES
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 28 }}>
        {[
          { label: "Period P&L", value: formatPnl(totalPnl), color: totalPnl >= 0 ? "#9cff93" : "#ff7162" },
          { label: "Win Rate", value: `${((totalWins / totalTrades) * 100).toFixed(0)}%`, color: "#669dff" },
          { label: "Total R", value: `${REPORTS.reduce((s, r) => s + r.rRealized, 0).toFixed(1)}R`, color: "#e6e1e5" },
        ].map((stat) => (
          <div key={stat.label} style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ReportCard({ report, isSelected, onClick }: { report: SessionReport; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? "rgba(102,157,255,0.06)" : "#1a191b",
        border: `1px solid ${isSelected ? "rgba(102,157,255,0.3)" : "rgba(72,72,73,0.15)"}`,
        borderRadius: 6, padding: "16px 20px",
        cursor: "pointer", transition: "all 0.15s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: "#e6e1e5" }}>
            {report.date}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            color: sessionColor[report.session],
            background: `${sessionColor[report.session]}15`,
            padding: "2px 8px", borderRadius: 3, letterSpacing: "0.06em",
          }}>
            {report.session.toUpperCase()}
          </span>
        </div>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700,
          color: report.netPnl >= 0 ? "#9cff93" : "#ff7162",
        }}>
          {formatPnl(report.netPnl)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        {[
          { label: "W/L", value: `${report.winners}/${report.losers}`, color: report.winners > report.losers ? "#9cff93" : "#ff7162" },
          { label: "R", value: `${report.rRealized > 0 ? "+" : ""}${report.rRealized}R`, color: report.rRealized > 0 ? "#9cff93" : "#ff7162" },
          { label: "DD", value: formatPnl(report.maxDrawdown), color: "#ff7162" },
        ].map((m) => (
          <div key={m.label}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#666", letterSpacing: "0.06em" }}>{m.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: m.color, fontWeight: 600 }}>{m.value}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: emotionColor[report.emotionalState],
          alignSelf: "flex-end",
        }}>
          {report.emotionalState.toUpperCase()}
        </div>
      </div>
    </div>
  );
}
function ReportDetail({ report }: { report: SessionReport }) {
  const winRate = report.totalTrades > 0 ? ((report.winners / report.totalTrades) * 100).toFixed(0) : "0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary header */}
      <div style={{
        background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
        borderRadius: 6, padding: "20px 24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em" }}>SESSION REPORT</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#e6e1e5", marginTop: 4 }}>
              {report.date} · {report.session}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#666", marginTop: 4 }}>
              Duration: {report.duration} · {report.id}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, fontWeight: 700,
              color: report.netPnl >= 0 ? "#9cff93" : "#ff7162",
            }}>
              {formatPnl(report.netPnl)}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8c909f" }}>
              {report.rRealized > 0 ? "+" : ""}{report.rRealized}R realized
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          {[
            { label: "Trades", value: report.totalTrades.toString(), color: "#e6e1e5" },
            { label: "Win Rate", value: `${winRate}%`, color: Number(winRate) > 60 ? "#9cff93" : "#ffd166" },
            { label: "Max DD", value: formatPnl(report.maxDrawdown), color: "#ff7162" },
            { label: "Risk Score", value: `${report.riskCompliance}%`, color: report.riskCompliance > 90 ? "#9cff93" : "#ffd166" },
            { label: "State", value: report.emotionalState, color: emotionColor[report.emotionalState] },
          ].map((stat) => (
            <div key={stat.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "10px 12px" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#666", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {stat.label}
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: stat.color, marginTop: 2 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Best/Worst trades */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { label: "Best Trade", trade: report.bestTrade, color: "#9cff93" },
          { label: "Worst Trade", trade: report.worstTrade, color: "#ff7162" },
        ].map((item) => (
          <div key={item.label} style={{
            background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
            borderRadius: 6, padding: "14px 18px",
            borderLeft: `3px solid ${item.color}`,
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              {item.label}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, color: "#e6e1e5" }}>
                {item.trade.symbol}
              </span>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: item.color }}>
                  {formatPnl(item.trade.pnl)}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>
                  {item.trade.r > 0 ? "+" : ""}{item.trade.r}R
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Setup breakdown */}
      <div style={{
        background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
        borderRadius: 6, padding: "16px 20px",
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
          Setup Breakdown
        </div>
        {report.setupBreakdown.map((sb) => (
          <div key={sb.setup} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "8px 0",
            borderBottom: "1px solid rgba(72,72,73,0.08)",
          }}>
            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 13, color: "#e6e1e5", flex: 1 }}>
              {sb.setup}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", width: 30, textAlign: "right" }}>
              ×{sb.count}
            </span>
            <div style={{ width: 50, height: 3, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: `${sb.winRate}%`, height: "100%",
                background: sb.winRate > 70 ? "#9cff93" : sb.winRate > 40 ? "#ffd166" : "#ff7162",
                borderRadius: 2,
              }} />
            </div>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, width: 35, textAlign: "right",
              color: sb.winRate > 70 ? "#9cff93" : sb.winRate > 40 ? "#ffd166" : "#ff7162",
            }}>
              {sb.winRate}%
            </span>
          </div>
        ))}
      </div>

      {/* Pipeline health */}
      <div style={{
        background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
        borderRadius: 6, padding: "16px 20px",
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
          Pipeline Health (Session Average)
        </div>
        {report.pipelineHealth.map((ph) => (
          <div key={ph.layer} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", width: 80 }}>
              {ph.layer}
            </span>
            <div style={{ flex: 1, height: 4, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: `${ph.avgScore * 100}%`, height: "100%",
                background: ph.avgScore > 0.8 ? "#9cff93" : ph.avgScore > 0.6 ? "#ffd166" : "#ff7162",
                borderRadius: 2,
              }} />
            </div>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, width: 35, textAlign: "right",
              color: ph.avgScore > 0.8 ? "#9cff93" : ph.avgScore > 0.6 ? "#ffd166" : "#ff7162",
            }}>
              {(ph.avgScore * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {/* Brain Insight */}
      <div style={{
        background: "#1a191b",
        border: "1px solid rgba(72,72,73,0.15)",
        borderLeft: "4px solid #ffd166",
        borderRadius: 6, padding: "18px 22px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#ffd166" }}>neurology</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#ffd166", letterSpacing: "0.08em" }}>
            BRAIN INSIGHT
          </span>
        </div>
        <div style={{
          fontFamily: "Inter, sans-serif", fontSize: 13, color: "#b4b0b8",
          lineHeight: 1.7,
        }}>
          {report.brainInsight}
        </div>
      </div>
    </div>
  );
}
// ─── Main Page ───────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [selectedId, setSelectedId] = useState<string>(REPORTS[0].id);
  const selected = REPORTS.find((r) => r.id === selectedId) || REPORTS[0];

  return (
    <div style={{ minHeight: "100vh", background: "#131314", color: "#e6e1e5" }}>
      <ReportsHeader />

      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "340px 1fr", gap: 24, alignItems: "start" }}>
        {/* Report list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            Recent Sessions ({REPORTS.length})
          </div>
          {REPORTS.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              isSelected={selectedId === report.id}
              onClick={() => setSelectedId(report.id)}
            />
          ))}
        </div>

        {/* Detail view */}
        <ReportDetail report={selected} />
      </div>
    </div>
  );
}