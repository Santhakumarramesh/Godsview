import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { toArray } from '@/lib/safe';
const C = {
  bg: "#0e0e0f", card: "#1a191b", cardAlt: "#141316",
  border: "#2a2a2d", borderFocus: "#3a3a3f",
  text: "#e2e2e6", textDim: "#8b8b92", textMuted: "#5a5a62",
  accent: "#6c5ce7", accentGlow: "rgba(108,92,231,0.25)",
  green: "#00e676", red: "#ff5252", yellow: "#ffd740", blue: "#40c4ff",
  orange: "#ff9100",
};

// ============================================================================
// SECTION 1: PERFORMANCE SUMMARY CARDS
// ============================================================================

interface SummaryMetric {
  label: string;
  value: string;
  trend: number;
  comparison: string;
}

interface SummaryData {
  totalPnL: SummaryMetric;
  winRate: SummaryMetric;
  profitFactor: SummaryMetric;
  sharpeRatio: SummaryMetric;
  sortinoRatio: SummaryMetric;
  maxDrawdown: SummaryMetric;
  expectancy: SummaryMetric;
  avgHoldTime: SummaryMetric;
}

const defaultSummary: SummaryData = {
  totalPnL: { label: 'Total PnL', value: '$847,231', trend: 12.5, comparison: '+12.5% vs prior' },
  winRate: { label: 'Win Rate', value: '58.3%', trend: 2.1, comparison: '+2.1% vs prior' },
  profitFactor: { label: 'Profit Factor', value: '2.34', trend: 0.18, comparison: '+0.18 vs prior' },
  sharpeRatio: { label: 'Sharpe Ratio', value: '2.17', trend: 0.24, comparison: '+0.24 vs prior' },
  sortinoRatio: { label: 'Sortino Ratio', value: '3.12', trend: 0.41, comparison: '+0.41 vs prior' },
  maxDrawdown: { label: 'Max Drawdown', value: '-8.2%', trend: -1.1, comparison: '-1.1% vs prior' },
  expectancy: { label: 'Expectancy', value: '$312.45', trend: 5.2, comparison: '+5.2% vs prior' },
  avgHoldTime: { label: 'Avg Hold Time', value: '4.2h', trend: -0.3, comparison: '-0.3h vs prior' },
};

function SummaryCard({ metric }: { metric: SummaryMetric }) {
  const isNegative = metric.trend < 0;
  const arrow = isNegative ? '↓' : '↑';
  const arrowColor = isNegative ? C.red : C.green;

  return (
    <div style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '16px',
      flex: '1 1 calc(25% - 12px)',
      minWidth: '200px',
    }}>
      <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '8px' }}>
        {metric.label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: '600', color: C.text, marginBottom: '4px' }}>
        {metric.value}
      </div>
      <div style={{ fontSize: '11px', color: C.textDim, display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: arrowColor, fontSize: '14px' }}>{arrow}</span>
        <span>{metric.comparison}</span>
      </div>
    </div>
  );
}

function PerformanceSummary() {
  const { data: summaryData, isLoading, error } = useQuery<SummaryData>({
    queryKey: ['analytics', 'summary'],
    queryFn: () => fetch('/api/analytics/summary').then(r => r.json()),
    staleTime: 60000,
  });

  const data = summaryData || defaultSummary;

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '600', color: C.text, marginBottom: '16px' }}>
        Performance Summary
      </h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
      }}>
        <SummaryCard metric={data.totalPnL} />
        <SummaryCard metric={data.winRate} />
        <SummaryCard metric={data.profitFactor} />
        <SummaryCard metric={data.sharpeRatio} />
        <SummaryCard metric={data.sortinoRatio} />
        <SummaryCard metric={data.maxDrawdown} />
        <SummaryCard metric={data.expectancy} />
        <SummaryCard metric={data.avgHoldTime} />
      </div>
      {error && <div style={{ color: C.red, marginTop: '12px', fontSize: '12px' }}>Failed to load summary</div>}
      {isLoading && <div style={{ color: C.textDim, marginTop: '12px', fontSize: '12px' }}>Loading...</div>}
    </div>
  );
}

// ============================================================================
// SECTION 2: EQUITY CURVE CHART
// ============================================================================

interface EquityCurvePoint {
  date: string;
  cumPnL: number;
  drawdown: number;
}

const defaultEquityCurve: EquityCurvePoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (30 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  cumPnL: Math.sin(i * 0.3) * 200000 + (i * 15000),
  drawdown: Math.max(0, Math.sin(i * 0.25) * -0.05),
}));

function EquityCurveChart() {
  const { data: curveData } = useQuery<EquityCurvePoint[]>({
    queryKey: ['analytics', 'equity-curve'],
    queryFn: () => fetch('/api/analytics/equity-curve').then(r => r.json()),
    staleTime: 60000,
  });

  const fetched = toArray<EquityCurvePoint>(curveData);
  const data = fetched.length > 0 ? fetched : defaultEquityCurve;
  const minPnL = Math.min(0, ...data.map(d => Number(d?.cumPnL) || 0));
  const maxPnL = Math.max(...data.map(d => Number(d?.cumPnL) || 0));
  const pnlRange = (maxPnL - minPnL) || 1;

  const width = 1000;
  const height = 300;
  const padding = { top: 20, right: 40, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
  const points = data.map((d, i) => ({
    x: padding.left + i * xStep,
    y: padding.top + chartHeight - ((Number(d?.cumPnL) || 0) - minPnL) / pnlRange * chartHeight,
    date: d?.date ?? "",
    cumPnL: Number(d?.cumPnL) || 0,
    drawdown: Number(d?.drawdown) || 0,
  }));

  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const lastPoint = points[points.length - 1];
  const fillPathData = lastPoint
    ? pathData + ` L ${lastPoint.x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`
    : "";

  const highWaterMark = Math.max(...data.map(d => Number(d?.cumPnL) || 0));
  const hwmY = padding.top + chartHeight - ((highWaterMark - minPnL) / pnlRange) * chartHeight;

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '600', color: C.text, marginBottom: '16px' }}>
        Equity Curve
      </h2>
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '16px',
        overflow: 'auto',
      }}>
        <svg width={width} height={height} style={{ minWidth: '100%' }}>
          {/* Grid lines */}
          {Array.from({ length: 5 }).map((_, i) => {
            const y = padding.top + (chartHeight / 4) * i;
            return <line key={`gridline-${i}`} x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={C.border} strokeDasharray="4" strokeWidth="0.5" />;
          })}

          {/* Drawdown shading */}
          {points.map((p, i) => {
            if (p.drawdown > 0) {
              const ddY = padding.top + chartHeight - (p.drawdown / 0.1) * chartHeight;
              return (
                <rect
                  key={`drawdown-${i}`}
                  x={Math.max(padding.left, p.x - xStep / 2)}
                  y={ddY}
                  width={xStep}
                  height={p.y - ddY}
                  fill="rgba(255, 82, 82, 0.1)"
                />
              );
            }
            return null;
          })}

          {/* High water mark line */}
          <line x1={padding.left} y1={hwmY} x2={width - padding.right} y2={hwmY} stroke={C.yellow} strokeWidth="1" strokeDasharray="2" opacity="0.6" />

          {/* Fill (green above zero, red below) */}
          <path d={fillPathData} fill={C.green} opacity="0.15" />

          {/* Line */}
          <path d={pathData} stroke={C.green} strokeWidth="2" fill="none" />

          {/* Points */}
          {points.map((p, i) => (
            <circle key={`point-${i}`} cx={p.x} cy={p.y} r="3" fill={C.accent} opacity="0.6" />
          ))}

          {/* Y-axis labels */}
          {Array.from({ length: 5 }).map((_, i) => {
            const value = minPnL + (pnlRange / 4) * i;
            const y = padding.top + chartHeight - (chartHeight / 4) * i;
            return (
              <text key={`y-label-${i}`} x={padding.left - 10} y={y} textAnchor="end" fontSize="11" fill={C.textDim} dominantBaseline="middle">
                ${(value / 1000).toFixed(0)}k
              </text>
            );
          })}

          {/* X-axis labels */}
          {points
            .filter((_, i) => i % Math.ceil(data.length / 6) === 0)
            .map((p, i) => (
              <text key={`x-label-${i}`} x={p.x} y={height - 10} textAnchor="middle" fontSize="11" fill={C.textDim}>
                {p.date}
              </text>
            ))}
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 3: STRATEGY LEADERBOARD TABLE
// ============================================================================

interface LeaderboardEntry {
  rank: number;
  name: string;
  tier: 'ELITE' | 'PROVEN' | 'LEARNING' | 'SEED' | 'DEGRADING' | 'SUSPENDED';
  trades: number;
  winRate: number;
  pnl: number;
  sharpe: number;
  profitFactor: number;
  maxDD: number;
  score: number;
  rankChange: number;
}

const defaultLeaderboard: LeaderboardEntry[] = [
  { rank: 1, name: 'Mean Reversion v3', tier: 'ELITE', trades: 487, winRate: 0.621, pnl: 127540, sharpe: 2.43, profitFactor: 2.67, maxDD: -0.065, score: 98.5, rankChange: 0 },
  { rank: 2, name: 'Momentum Cross', tier: 'ELITE', trades: 234, winRate: 0.582, pnl: 94320, sharpe: 2.11, profitFactor: 2.34, maxDD: -0.082, score: 96.2, rankChange: 1 },
  { rank: 3, name: 'Pairs Trading', tier: 'PROVEN', trades: 156, winRate: 0.563, pnl: 67890, sharpe: 1.87, profitFactor: 2.01, maxDD: -0.095, score: 91.3, rankChange: -1 },
  { rank: 4, name: 'Vol Arb', tier: 'PROVEN', trades: 312, winRate: 0.545, pnl: 54200, sharpe: 1.64, profitFactor: 1.88, maxDD: -0.128, score: 87.9, rankChange: 0 },
  { rank: 5, name: 'Trend Follower', tier: 'LEARNING', trades: 98, winRate: 0.512, pnl: 23450, sharpe: 1.12, profitFactor: 1.56, maxDD: -0.156, score: 78.4, rankChange: 2 },
];

const tierColors: Record<LeaderboardEntry['tier'], string> = {
  ELITE: C.yellow,
  PROVEN: C.green,
  LEARNING: C.blue,
  SEED: C.textMuted,
  DEGRADING: C.orange,
  SUSPENDED: C.red,
};

function StrategyLeaderboard() {
  const [sortBy, setSortBy] = useState<keyof LeaderboardEntry>('score');
  const [sortDesc, setSortDesc] = useState(true);

  const { data: leaderboardData } = useQuery<LeaderboardEntry[]>({
    queryKey: ['analytics', 'leaderboard'],
    queryFn: () => fetch('/api/analytics/leaderboard').then(r => r.json()),
    staleTime: 60000,
  });

  const data = leaderboardData || defaultLeaderboard;
  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDesc ? bVal - aVal : aVal - bVal;
      }
      return 0;
    });
    return copy;
  }, [data, sortBy, sortDesc]);

  const toggleSort = (key: keyof LeaderboardEntry) => {
    if (sortBy === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(key);
      setSortDesc(true);
    }
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '600', color: C.text, marginBottom: '16px' }}>
        Strategy Leaderboard
      </h2>
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px',
        }}>
          <thead>
            <tr style={{ backgroundColor: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
              {(['rank', 'name', 'tier', 'trades', 'winRate', 'pnl', 'sharpe', 'profitFactor', 'maxDD', 'score', 'rankChange'] as const).map(col => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    color: C.textDim,
                    fontWeight: '500',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: sortBy === col ? C.border : 'transparent',
                  }}
                >
                  {col === 'rankChange' ? 'Change' : col.charAt(0).toUpperCase() + col.slice(1)}
                  {sortBy === col && <span style={{ marginLeft: '4px' }}>{sortDesc ? '↓' : '↑'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, idx) => (
              <tr key={`leaderboard-${idx}`} style={{
                borderBottom: `1px solid ${C.border}`,
                backgroundColor: idx % 2 === 0 ? C.card : C.cardAlt,
              }}>
                <td style={{ padding: '12px', color: C.text }}>{entry.rank}</td>
                <td style={{ padding: '12px', color: C.text, fontWeight: '500' }}>{entry.name}</td>
                <td style={{ padding: '12px' }}>
                  <span style={{
                    backgroundColor: tierColors[entry.tier],
                    color: C.bg,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: '600',
                  }}>
                    {entry.tier}
                  </span>
                </td>
                <td style={{ padding: '12px', color: C.text }}>{entry.trades}</td>
                <td style={{ padding: '12px', color: entry.winRate > 0.55 ? C.green : C.text }}>{(entry.winRate * 100).toFixed(1)}%</td>
                <td style={{ padding: '12px', color: entry.pnl > 0 ? C.green : C.red }}>${(entry.pnl / 1000).toFixed(0)}k</td>
                <td style={{ padding: '12px', color: C.text }}>{entry.sharpe.toFixed(2)}</td>
                <td style={{ padding: '12px', color: C.text }}>{entry.profitFactor.toFixed(2)}</td>
                <td style={{ padding: '12px', color: C.red }}>{(entry.maxDD * 100).toFixed(1)}%</td>
                <td style={{ padding: '12px', color: C.accent, fontWeight: '600' }}>{entry.score.toFixed(1)}</td>
                <td style={{ padding: '12px', color: entry.rankChange > 0 ? C.green : entry.rankChange < 0 ? C.red : C.textDim }}>
                  {entry.rankChange > 0 ? '↑' : entry.rankChange < 0 ? '↓' : '—'} {Math.abs(entry.rankChange)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 4: ATTRIBUTION BREAKDOWN
// ============================================================================

interface AttributionBar {
  name: string;
  pnl: number;
  winRate: number;
}

const defaultAttribution: Record<string, AttributionBar[]> = {
  strategy: [
    { name: 'Mean Reversion', pnl: 127540, winRate: 0.621 },
    { name: 'Momentum', pnl: 94320, winRate: 0.582 },
    { name: 'Pairs', pnl: 67890, winRate: 0.563 },
  ],
  regime: [
    { name: 'Trending', pnl: 156000, winRate: 0.598 },
    { name: 'Range', pnl: 98500, winRate: 0.544 },
    { name: 'Volatile', pnl: 34750, winRate: 0.512 },
  ],
  timeframe: [
    { name: '1H', pnl: 145000, winRate: 0.612 },
    { name: '4H', pnl: 89000, winRate: 0.567 },
    { name: '1D', pnl: 55250, winRate: 0.523 },
  ],
  setup: [
    { name: 'Breakout', pnl: 112000, winRate: 0.634 },
    { name: 'Pullback', pnl: 98000, winRate: 0.589 },
    { name: 'Divergence', pnl: 79250, winRate: 0.521 },
  ],
};

function AttributionBreakdown() {
  const [dimension, setDimension] = useState<'strategy' | 'regime' | 'timeframe' | 'setup'>('strategy');
  const { data: attributionData } = useQuery<Record<string, AttributionBar[]>>({
    queryKey: ['analytics', 'attribution', dimension],
    queryFn: () => fetch(`/api/analytics/attribution/${dimension}`).then(r => r.json()),
    staleTime: 60000,
  });

  const data = attributionData || defaultAttribution;
  const items = data[dimension] || [];
  const maxPnL = Math.max(...items.map(i => i.pnl));

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: C.text }}>
          Attribution Breakdown
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['strategy', 'regime', 'timeframe', 'setup'] as const).map(dim => (
            <button
              key={dim}
              onClick={() => setDimension(dim)}
              style={{
                padding: '6px 12px',
                backgroundColor: dimension === dim ? C.accent : C.cardAlt,
                color: dimension === dim ? C.bg : C.text,
                border: `1px solid ${dimension === dim ? C.accent : C.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                transition: 'all 0.2s',
              }}
            >
              {dim.charAt(0).toUpperCase() + dim.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '20px',
      }}>
        {items.map((item, i) => (
          <div key={`attribution-${i}`} style={{ marginBottom: i === items.length - 1 ? 0 : '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: C.text, fontSize: '13px', fontWeight: '500' }}>{item.name}</span>
              <span style={{ color: C.textDim, fontSize: '12px' }}>${(item.pnl / 1000).toFixed(0)}k</span>
            </div>
            <div style={{ position: 'relative', height: '24px', backgroundColor: C.cardAlt, borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: `${(item.pnl / maxPnL) * 100}%`,
                height: '100%',
                backgroundColor: item.pnl > 0 ? C.green : C.red,
                opacity: 0.7,
              }} />
              <div style={{
                position: 'absolute',
                left: `${(item.pnl / maxPnL) * 100 - 2}%`,
                top: '50%',
                transform: 'translateY(-50%)',
                width: '8px',
                height: '8px',
                backgroundColor: C.accent,
                borderRadius: '50%',
                border: `1px solid ${C.text}`,
              }} />
              <span style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.textDim,
                fontSize: '11px',
              }}>
                {(item.winRate * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 5: DAILY P&L CALENDAR
// ============================================================================

interface DailyPnL {
  date: string;
  pnl: number;
  trades: number;
  winRate: number;
}

// Empty 30-day calendar — used when /api/analytics/daily-pnl returns nothing.
// All cells render as zero (honest empty state) instead of randomized fake P&L.
const defaultDailyPnL: DailyPnL[] = Array.from({ length: 30 }, (_, i) => {
  const daysAgo = 29 - i;
  return {
    date: new Date(Date.now() - daysAgo * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    pnl: 0,
    trades: 0,
    winRate: 0,
  };
});

function DailyPnLCalendar() {
  const { data: dailyData } = useQuery<DailyPnL[]>({
    queryKey: ['analytics', 'daily-pnl'],
    queryFn: () => fetch('/api/analytics/daily-pnl').then(r => r.json()),
    staleTime: 60000,
  });

  // Use real data when present (and an array), otherwise fall back to the
  // zero-filled calendar so the page renders without fabricating returns.
  const data = Array.isArray(dailyData) && dailyData.length > 0 ? dailyData : defaultDailyPnL;

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '600', color: C.text, marginBottom: '16px' }}>
        Daily P&L Calendar
      </h2>
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
          {data.map((day, i) => {
            const intensity = Math.abs(day.pnl) / Math.max(...data.map(d => Math.abs(d.pnl)));
            const bgColor = day.pnl > 0
              ? `rgba(0, 230, 118, ${0.2 + intensity * 0.6})`
              : `rgba(255, 82, 82, ${0.2 + intensity * 0.6})`;

            return (
              <div
                key={`daily-${i}`}
                style={{
                  backgroundColor: bgColor,
                  border: `1px solid ${C.border}`,
                  borderRadius: '6px',
                  padding: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  position: 'relative',
                                  }}
                title={`Date: ${day.date}\nPnL: $${day.pnl.toFixed(0)}\nTrades: ${day.trades}\nWin Rate: ${(day.winRate * 100).toFixed(0)}%`}
              >
                <div style={{ fontSize: '11px', color: C.textDim, marginBottom: '4px' }}>
                  {day.date}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: day.pnl > 0 ? C.green : C.red }}>
                  ${(day.pnl / 1000).toFixed(1)}k
                </div>
                <div style={{ fontSize: '10px', color: C.textMuted, marginTop: '4px' }}>
                  {day.trades} trades
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 6: RISK METRICS PANEL
// ============================================================================

interface RiskMetrics {
  var95: number;
  cvar: number;
  tailRatio: number;
  omega: number;
  kelly: number;
  distribution: Array<{ range: string; count: number }>;
  skewness: number;
  kurtosis: number;
}

const defaultRiskMetrics: RiskMetrics = {
  var95: -0.082,
  cvar: -0.124,
  tailRatio: 1.23,
  omega: 2.34,
  kelly: 0.08,
  distribution: [
    { range: '-5% to 0%', count: 8 },
    { range: '0% to 2%', count: 18 },
    { range: '2% to 4%', count: 24 },
    { range: '4% to 6%', count: 14 },
    { range: '6%+', count: 3 },
  ],
  skewness: 0.34,
  kurtosis: 2.81,
};

function RiskMetricsPanel() {
  const { data: riskData } = useQuery<RiskMetrics>({
    queryKey: ['analytics', 'risk-metrics'],
    queryFn: () => fetch('/api/analytics/risk-metrics').then(r => r.json()),
    staleTime: 60000,
  });

  const data = riskData || defaultRiskMetrics;
  const distribution = Array.isArray(data?.distribution) && data.distribution.length > 0
    ? data.distribution
    : defaultRiskMetrics.distribution;
  const maxCount = Math.max(...distribution.map(d => Number(d?.count) || 0)) || 1;

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '600', color: C.text, marginBottom: '16px' }}>
        Risk Metrics
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left: Gauges & Ratios */}
        <div style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: C.textDim, marginBottom: '8px' }}>VaR (95%)</div>
            <div style={{ fontSize: '20px', fontWeight: '600', color: C.red }}>
              {(data.var95 * 100).toFixed(2)}%
            </div>
            <div style={{ fontSize: '10px', color: C.textMuted, marginTop: '4px' }}>
              Max loss in 1 of 20 days
            </div>
          </div>

          <div style={{
            height: '120px',
            backgroundColor: C.cardAlt,
            borderRadius: '8px',
            marginBottom: '20px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 200 120">
              <defs>
                <linearGradient id="gaugeGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor={C.red} />
                  <stop offset="50%" stopColor={C.orange} />
                  <stop offset="100%" stopColor={C.green} />
                </linearGradient>
              </defs>
              <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke={C.border} strokeWidth="8" />
              <path d="M 20 100 A 80 80 0 0 1 60 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="8" />
              <circle cx={20 + 80 * Math.cos(Math.PI * 0.15)} cy={100 - 80 * Math.sin(Math.PI * 0.15)} r="4" fill={C.accent} />
            </svg>
            <div style={{
              position: 'absolute',
              bottom: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '12px',
              fontWeight: '600',
              color: C.text,
            }}>
              {(Math.abs(data.var95) * 100).toFixed(1)}%
            </div>
          </div>

          {[
            { label: 'CVaR', value: (data.cvar * 100).toFixed(2) + '%' },
            { label: 'Tail Ratio', value: data.tailRatio.toFixed(2) },
            { label: 'Omega Ratio', value: data.omega.toFixed(2) },
            { label: 'Kelly %', value: (data.kelly * 100).toFixed(2) + '%' },
          ].map((metric, i) => (
            <div key={`risk-metric-${i}`} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: i < 3 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ fontSize: '12px', color: C.textDim }}>{metric.label}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>{metric.value}</span>
            </div>
          ))}
        </div>

        {/* Right: Distribution Histogram */}
        <div style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '20px',
        }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: C.textDim, marginBottom: '8px' }}>Return Distribution</div>
            <svg width="100%" height="180" viewBox="0 0 300 180" style={{ minHeight: '180px' }}>
              {/* Normal curve overlay */}
              <path
                d={Array.from({ length: 100 }, (_, i) => {
                  const x = (i / 100) * 250 + 25;
                  const z = (i / 100 - 0.5) * 4;
                  const y = 160 - Math.exp(-(z * z) / 2) * 80;
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}
                stroke={C.accent}
                strokeWidth="1.5"
                fill="none"
                opacity="0.6"
              />

              {/* Histogram bars */}
              {data.distribution.map((bin, i) => {
                const barWidth = 240 / data.distribution.length;
                const x = 30 + i * barWidth;
                const height = (bin.count / maxCount) * 120;
                const y = 160 - height;
                return (
                  <rect
                    key={`hist-${i}`}
                    x={x}
                    y={y}
                    width={barWidth - 2}
                    height={height}
                    fill={C.green}
                    opacity="0.5"
                  />
                );
              })}

              {/* Axis labels */}
              {data.distribution.map((bin, i) => (
                <text
                  key={`label-${i}`}
                  x={30 + (i + 0.5) * (240 / data.distribution.length)}
                  y="175"
                  textAnchor="middle"
                  fontSize="9"
                  fill={C.textDim}
                >
                  {bin.range}
                </text>
              ))}
            </svg>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            paddingTop: '12px',
            borderTop: `1px solid ${C.border}`,
          }}>
            <div>
              <div style={{ fontSize: '11px', color: C.textDim, marginBottom: '4px' }}>Skewness</div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: data.skewness > 0 ? C.green : C.red }}>
                {data.skewness.toFixed(3)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: C.textDim, marginBottom: '4px' }}>Kurtosis</div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: C.text }}>
                {data.kurtosis.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function PerformanceAnalyticsPage() {
  return (
    <div style={{
      backgroundColor: C.bg,
      minHeight: '100vh',
      padding: '32px',
      color: C.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>
          Performance Analytics
        </h1>
        <p style={{ fontSize: '14px', color: C.textDim, marginBottom: '32px' }}>
          Real-time performance metrics and strategy insights
        </p>

        <PerformanceSummary />
        <EquityCurveChart />
        <StrategyLeaderboard />
        <AttributionBreakdown />
        <DailyPnLCalendar />
        <RiskMetricsPanel />
      </div>
    </div>
  );
}
