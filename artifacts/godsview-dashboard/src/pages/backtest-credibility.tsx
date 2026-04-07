import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// Design tokens
const C = {
  bg: '#0e0e0f',
  card: '#1a191b',
  cardAlt: '#141315',
  border: 'rgba(72,72,73,0.25)',
  borderLight: 'rgba(72,72,73,0.12)',
  green: '#9cff93',
  red: '#ff7162',
  amber: '#fbbf24',
  blue: '#67e8f9',
  purple: '#c084fc',
  text: '#ffffff',
  textDim: '#adaaab',
  textMuted: '#767576',
  textFaint: '#484849',
  font: "'Space Grotesk', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

// Types
interface BacktestResult {
  id: string;
  strategyName: string;
  dateRange: { start: string; end: string };
  totalReturn: number;
  sharpe: number;
  credibilityGrade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  overfitRiskLevel: 'low' | 'moderate' | 'high' | 'severe';
  promotable: boolean;
  createdAt: string;
}

interface AssumptionCheck {
  name: string;
  value: string | number;
  realistic: boolean;
  impactSeverity: 'low' | 'medium' | 'high';
  description?: string;
}

interface OverfitTest {
  name: string;
  passed: boolean;
  score: number;
  threshold: number;
}

interface CredibilityReport {
  backtestId: string;
  overallScore: number;
  assumptions: AssumptionCheck[];
  flags: string[];
}

interface LeakageResult {
  featureName: string;
  leakageDetected: boolean;
  leakageType?: 'lookahead' | 'forward-fill' | 'survivorship' | 'other';
  severity: 'low' | 'medium' | 'high';
}

interface OverfitAnalysis {
  backtestId: string;
  tests: OverfitTest[];
  overallScore: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'severe';
  recommendation: string;
}

interface WalkForwardResult {
  windowIndex: number;
  isDate: string;
  oosDate: string;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  divergence: number;
  returnDifferential: number;
}

interface PaperBacktestComparison {
  metric: string;
  paperValue: number;
  backtestValue: number;
  deviationPercent: number;
  flagged: boolean;
}

interface ExecutionAssumptions {
  feeModel: {
    type: string;
    amount: number;
    unit: string;
  };
  slippageModel: {
    type: string;
    description: string;
  };
  latencyMs: number;
  fillModel: string;
  assumptions: string[];
}

// Credential Badge Component
const CredibilityGradeBadge: React.FC<{ grade: string }> = ({ grade }) => {
  const gradeColors: Record<string, string> = {
    A: C.green,
    B: '#b4e7a6',
    C: C.amber,
    D: '#ff9966',
    E: C.red,
    F: '#cc3333',
  };

  const color = gradeColors[grade] || C.textMuted;
  return (
    <div
      style={{
        display: 'inline-block',
        width: '32px',
        height: '32px',
        borderRadius: '6px',
        backgroundColor: color + '20',
        border: `1.5px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: 600,
        color: color,
      }}
    >
      {grade}
    </div>
  );
};

// Risk Level Badge
const RiskLevelBadge: React.FC<{ level: 'low' | 'moderate' | 'high' | 'severe' }> = ({
  level,
}) => {
  const levelConfig: Record<string, { color: string; label: string }> = {
    low: { color: C.green, label: 'Low' },
    moderate: { color: C.amber, label: 'Moderate' },
    high: { color: '#ff9966', label: 'High' },
    severe: { color: C.red, label: 'Severe' },
  };

  const config = levelConfig[level];

  return (
    <div
      style={{
        display: 'inline-block',
        paddingX: '8px',
        paddingY: '4px',
        borderRadius: '4px',
        backgroundColor: config.color + '20',
        border: `1px solid ${config.color}`,
        fontSize: '12px',
        fontWeight: 500,
        color: config.color,
      }}
    >
      {config.label}
    </div>
  );
};

// Simple Gauge Visualization
const OverfitGauge: React.FC<{ score: number }> = ({ score }) => {
  const segments = 20;
  const filledSegments = Math.round((score / 100) * segments);

  return (
    <div
      style={{
        display: 'flex',
        gap: '3px',
        alignItems: 'center',
      }}
    >
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{
            width: '6px',
            height: '20px',
            borderRadius: '2px',
            backgroundColor:
              i < filledSegments
                ? score <= 33
                  ? C.green
                  : score <= 66
                    ? C.amber
                    : C.red
                : C.borderLight,
          }}
        />
      ))}
      <span
        style={{
          marginLeft: '12px',
          fontSize: '14px',
          fontWeight: 600,
          color: C.text,
          minWidth: '40px',
        }}
      >
        {score}
      </span>
    </div>
  );
};

// Assumption Grid Cell
const AssumptionCell: React.FC<{ check: AssumptionCheck }> = ({ check }) => {
  const severityColor = {
    low: C.green,
    medium: C.amber,
    high: C.red,
  }[check.impactSeverity];

  const color = check.realistic ? C.green : severityColor;

  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '6px',
        backgroundColor: C.cardAlt,
        border: `1px solid ${C.borderLight}`,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          color: C.textMuted,
          marginBottom: '6px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {check.name}
      </div>
      <div
        style={{
          fontSize: '13px',
          fontFamily: C.mono,
          color: C.text,
          marginBottom: '6px',
          fontWeight: 500,
        }}
      >
        {typeof check.value === 'number'
          ? check.value.toFixed(2)
          : check.value}
      </div>
      <div
        style={{
          display: 'inline-block',
          paddingX: '6px',
          paddingY: '3px',
          borderRadius: '3px',
          backgroundColor: color + '20',
          border: `1px solid ${color}`,
          fontSize: '10px',
          fontWeight: 600,
          color: color,
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}
      >
        {check.realistic ? '✓ Realistic' : '⚠ ' + check.impactSeverity.toUpperCase()}
      </div>
    </div>
  );
};

// Walk-Forward Chart
const WalkForwardChart: React.FC<{ data: WalkForwardResult[] }> = ({ data }) => {
  if (!data || data.length === 0) return null;

  const width = 600;
  const height = 200;
  const padding = 40;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const minSharpe = Math.min(
    ...data.map(d => Math.min(d.inSampleSharpe, d.outOfSampleSharpe))
  );
  const maxSharpe = Math.max(
    ...data.map(d => Math.max(d.inSampleSharpe, d.outOfSampleSharpe))
  );
  const range = maxSharpe - minSharpe || 1;

  const yScale = (value: number) =>
    height - padding - ((value - minSharpe) / range) * plotHeight;
  const xScale = (index: number) =>
    padding + (index / (data.length - 1 || 1)) * plotWidth;

  return (
    <svg
      width={width}
      height={height}
      style={{ backgroundColor: C.cardAlt, borderRadius: '8px' }}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
        <line
          key={`grid-${i}`}
          x1={padding}
          x2={width - padding}
          y1={height - padding - ratio * plotHeight}
          y2={height - padding - ratio * plotHeight}
          stroke={C.borderLight}
          strokeWidth="1"
          strokeDasharray="4,4"
        />
      ))}

      {/* In-Sample Sharpe (dashed line) */}
      <polyline
        points={data
          .map((d, i) => `${xScale(i)},${yScale(d.inSampleSharpe)}`)
          .join(' ')}
        fill="none"
        stroke={C.blue}
        strokeWidth="2"
        strokeDasharray="5,5"
      />

      {/* Out-of-Sample Sharpe (solid line) */}
      <polyline
        points={data
          .map((d, i) => `${xScale(i)},${yScale(d.outOfSampleSharpe)}`)
          .join(' ')}
        fill="none"
        stroke={C.green}
        strokeWidth="2"
      />

      {/* Data points */}
      {data.map((d, i) => (
        <g key={`point-${i}`}>
          <circle
            cx={xScale(i)}
            cy={yScale(d.inSampleSharpe)}
            r="3"
            fill={C.blue}
          />
          <circle
            cx={xScale(i)}
            cy={yScale(d.outOfSampleSharpe)}
            r="3"
            fill={C.green}
          />
        </g>
      ))}

      {/* Y-axis label */}
      <text
        x="10"
        y="20"
        fontSize="11"
        fill={C.textMuted}
        fontFamily={C.mono}
      >
        Sharpe
      </text>

      {/* X-axis label */}
      <text
        x={width - 80}
        y={height - 10}
        fontSize="11"
        fill={C.textMuted}
        fontFamily={C.mono}
      >
        Window
      </text>
    </svg>
  );
};

// Equity Curve Chart
const EquityCurveChart: React.FC<{
  equityData: number[];
  drawdownData: number[];
  windowBoundaries: number[];
}> = ({ equityData, drawdownData, windowBoundaries }) => {
  const width = 700;
  const height = 250;
  const padding = 40;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const minEquity = Math.min(...equityData);
  const maxEquity = Math.max(...equityData);
  const range = maxEquity - minEquity || 1;

  const yScale = (value: number) =>
    height - padding - ((value - minEquity) / range) * plotHeight;
  const xScale = (index: number) =>
    padding + (index / (equityData.length - 1 || 1)) * plotWidth;

  return (
    <svg
      width={width}
      height={height}
      style={{
        backgroundColor: C.cardAlt,
        borderRadius: '8px',
        border: `1px solid ${C.borderLight}`,
      }}
    >
      {/* Drawdown shading */}
      {drawdownData.map((dd, i) => {
        if (dd > 0) {
          return (
            <rect
              key={`dd-${i}`}
              x={xScale(i)}
              y={yScale(equityData[i]) - dd * plotHeight * 0.5}
              width={
                i < equityData.length - 1
                  ? xScale(i + 1) - xScale(i)
                  : plotWidth / equityData.length
              }
              height={Math.max(dd * plotHeight * 0.5, 1)}
              fill={C.red}
              opacity="0.15"
            />
          );
        }
        return null;
      })}

      {/* Window boundaries */}
      {windowBoundaries.map((boundIdx, i) => (
        <line
          key={`boundary-${i}`}
          x1={xScale(boundIdx)}
          x2={xScale(boundIdx)}
          y1={padding}
          y2={height - padding}
          stroke={C.borderLight}
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      ))}

      {/* Equity curve */}
      <polyline
        points={equityData
          .map((value, i) => `${xScale(i)},${yScale(value)}`)
          .join(' ')}
        fill="none"
        stroke={C.green}
        strokeWidth="2"
      />

      {/* Data points */}
      {equityData.map((value, i) => (
        <circle
          key={`point-${i}`}
          cx={xScale(i)}
          cy={yScale(value)}
          r="2"
          fill={C.green}
        />
      ))}

      {/* Y-axis label */}
      <text
        x="10"
        y="20"
        fontSize="11"
        fill={C.textMuted}
        fontFamily={C.mono}
      >
        Equity
      </text>

      {/* X-axis label */}
      <text
        x={width - 80}
        y={height - 10}
        fontSize="11"
        fill={C.textMuted}
        fontFamily={C.mono}
      >
        Time
      </text>
    </svg>
  );
};

// Main Component
export default function BacktestCredibilityPage() {
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(
    null
  );

  // Query: Recent backtests
  const { data: backtestResults = [], isLoading: loading } = useQuery({
    queryKey: ['backtest-results'],
    queryFn: async () => {
      const res = await fetch('/api/backtest-v2/results');
      if (!res.ok) throw new Error('Failed to fetch backtest results');
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Set initial selected backtest
  React.useEffect(() => {
    if (backtestResults.length > 0 && !selectedBacktestId) {
      setSelectedBacktestId(backtestResults[0].id);
    }
  }, [backtestResults, selectedBacktestId]);

  // Query: Credibility report
  const { data: credibilityReport } = useQuery({
    queryKey: ['credibility-report', selectedBacktestId],
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(`/api/backtest-v2/credibility/${selectedBacktestId}`);
      if (!res.ok) throw new Error('Failed to fetch credibility report');
      return res.json();
    },
    enabled: !!selectedBacktestId,
    refetchInterval: 30000,
  });

  // Query: Overfit analysis
  const { data: overfitAnalysis } = useQuery({
    queryKey: ['overfit-analysis', selectedBacktestId],
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(`/api/backtest-v2/overfit/${selectedBacktestId}`);
      if (!res.ok) throw new Error('Failed to fetch overfit analysis');
      return res.json();
    },
    enabled: !!selectedBacktestId,
    refetchInterval: 30000,
  });

  // Query: Leakage scan
  const { data: leakageResults = [] } = useQuery({
    queryKey: ['leakage-scan', selectedBacktestId],
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(`/api/backtest-v2/leakage/${selectedBacktestId}`);
      if (!res.ok) throw new Error('Failed to fetch leakage scan');
      return res.json();
    },
    enabled: !!selectedBacktestId,
    refetchInterval: 30000,
  });

  // Query: Walk-forward results
  const { data: walkForwardData = [] } = useQuery({
    queryKey: ['walk-forward', selectedBacktestId],
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(`/api/backtest-v2/walk-forward/${selectedBacktestId}`);
      if (!res.ok) throw new Error('Failed to fetch walk-forward results');
      return res.json();
    },
    enabled: !!selectedBacktestId,
    refetchInterval: 30000,
  });

  // Query: Paper vs Backtest Comparison
  const { data: comparison } = useQuery({
    queryKey: ['comparison', selectedBacktestId],
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(`/api/backtest-v2/comparison/${selectedBacktestId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedBacktestId,
    refetchInterval: 30000,
  });

  // Query: Execution Assumptions
  const { data: executionAssumptions } = useQuery({
    queryKey: ['execution-assumptions', selectedBacktestId],
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(
        `/api/backtest-v2/execution-assumptions/${selectedBacktestId}`
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedBacktestId,
    refetchInterval: 30000,
  });

  const selectedBacktest = backtestResults.find(
    (b: BacktestResult) => b.id === selectedBacktestId
  );

  return (
    <div
      style={{
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: C.font,
        minHeight: '100vh',
        padding: '24px',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1
          style={{
            fontSize: '32px',
            fontWeight: 700,
            margin: '0 0 8px 0',
            letterSpacing: '-0.5px',
          }}
        >
          Backtest Credibility Lab
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: C.textMuted,
            margin: 0,
            letterSpacing: '0.3px',
          }}
        >
          Phase 110 — Make Backtests Believable
        </p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: C.textMuted }}>
          Loading backtest results...
        </div>
      )}

      {!loading && (
        <>
          {/* Backtest Summary Cards */}
          <div style={{ marginBottom: '32px' }}>
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 600,
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: C.textDim,
              }}
            >
              Recent Backtests
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '12px',
              }}
            >
              {backtestResults.slice(0, 4).map((backtest: BacktestResult) => (
                <div
                  key={backtest.id}
                  onClick={() => setSelectedBacktestId(backtest.id)}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    backgroundColor:
                      selectedBacktestId === backtest.id ? C.card : C.cardAlt,
                    border: `1px solid ${
                      selectedBacktestId === backtest.id
                        ? C.border
                        : C.borderLight
                    }`,
                    cursor: 'pointer',
                    transition: 'all 200ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedBacktestId !== backtest.id) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        C.border;
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        C.card;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedBacktestId !== backtest.id) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        C.borderLight;
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        C.cardAlt;
                    }
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'start',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          margin: '0 0 4px 0',
                        }}
                      >
                        {backtest.strategyName}
                      </h3>
                      <p
                        style={{
                          fontSize: '11px',
                          color: C.textMuted,
                          margin: 0,
                          fontFamily: C.mono,
                        }}
                      >
                        {backtest.dateRange.start} → {backtest.dateRange.end}
                      </p>
                    </div>
                    <CredibilityGradeBadge grade={backtest.credibilityGrade} />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                      marginBottom: '12px',
                      paddingBottom: '12px',
                      borderBottom: `1px solid ${C.borderLight}`,
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: '10px',
                          color: C.textMuted,
                          margin: '0 0 4px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                        }}
                      >
                        Total Return
                      </p>
                      <p
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          margin: 0,
                          color:
                            backtest.totalReturn >= 0 ? C.green : C.red,
                          fontFamily: C.mono,
                        }}
                      >
                        {(backtest.totalReturn * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p
                        style={{
                          fontSize: '10px',
                          color: C.textMuted,
                          margin: '0 0 4px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                        }}
                      >
                        Sharpe
                      </p>
                      <p
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          margin: 0,
                          color: backtest.sharpe >= 1 ? C.green : C.textDim,
                          fontFamily: C.mono,
                        }}
                      >
                        {backtest.sharpe.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <RiskLevelBadge level={backtest.overfitRiskLevel} />
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        padding: '4px 8px',
                        borderRadius: '3px',
                        backgroundColor: backtest.promotable
                          ? C.green + '20'
                          : C.red + '20',
                        color: backtest.promotable ? C.green : C.red,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                      }}
                    >
                      {backtest.promotable ? '✓ Promotable' : '✗ Not Promotable'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedBacktest && (
            <>
              {/* Assumption Audit Panel */}
              {credibilityReport && (
                <div style={{ marginBottom: '32px' }}>
                  <h2
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: C.textDim,
                    }}
                  >
                    Assumption Audit
                  </h2>

                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      marginBottom: '16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '12px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                          color: C.textMuted,
                        }}
                      >
                        Overall Credibility Score
                      </span>
                      <span
                        style={{
                          fontSize: '18px',
                          fontWeight: 700,
                          color: C.text,
                          fontFamily: C.mono,
                        }}
                      >
                        {credibilityReport.overallScore}%
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '6px',
                        backgroundColor: C.borderLight,
                        borderRadius: '3px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${credibilityReport.overallScore}%`,
                          backgroundColor:
                            credibilityReport.overallScore >= 80
                              ? C.green
                              : credibilityReport.overallScore >= 60
                                ? C.amber
                                : C.red,
                          borderRadius: '3px',
                          transition: 'width 300ms ease',
                        }}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    {credibilityReport.assumptions.map(
                      (check: AssumptionCheck, idx: number) => (
                        <AssumptionCell key={idx} check={check} />
                      )
                    )}
                  </div>

                  {credibilityReport.flags && credibilityReport.flags.length > 0 && (
                    <div
                      style={{
                        marginTop: '16px',
                        padding: '12px',
                        borderRadius: '6px',
                        backgroundColor: C.red + '10',
                        border: `1px solid ${C.red}50`,
                      }}
                    >
                      <p
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: C.red,
                          margin: '0 0 8px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                        }}
                      >
                        ⚠ Credibility Flags
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: '20px',
                          fontSize: '12px',
                          color: C.textDim,
                          lineHeight: '1.6',
                        }}
                      >
                        {credibilityReport.flags.map((flag: string, i: number) => (
                          <li key={i}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Walk-Forward Results */}
              {walkForwardData && walkForwardData.length > 0 && (
                <div style={{ marginBottom: '32px' }}>
                  <h2
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: C.textDim,
                    }}
                  >
                    Walk-Forward Results
                  </h2>

                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      marginBottom: '16px',
                      overflowX: 'auto',
                    }}
                  >
                    <WalkForwardChart data={walkForwardData} />
                  </div>

                  <div
                    style={{
                      overflowX: 'auto',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '12px',
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            Window
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            IS Start
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            OOS Date
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            IS Sharpe
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            OOS Sharpe
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            Divergence
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {walkForwardData.map((wf: WalkForwardResult, idx: number) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: `1px solid ${C.borderLight}`,
                              backgroundColor:
                                idx % 2 === 0 ? 'transparent' : C.cardAlt,
                            }}
                          >
                            <td
                              style={{
                                padding: '12px',
                                color: C.text,
                                fontWeight: 500,
                              }}
                            >
                              {wf.windowIndex}
                            </td>
                            <td
                              style={{
                                padding: '12px',
                                color: C.textDim,
                                fontFamily: C.mono,
                                fontSize: '11px',
                              }}
                            >
                              {wf.isDate}
                            </td>
                            <td
                              style={{
                                padding: '12px',
                                color: C.textDim,
                                fontFamily: C.mono,
                                fontSize: '11px',
                              }}
                            >
                              {wf.oosDate}
                            </td>
                            <td
                              style={{
                                padding: '12px',
                                color: C.blue,
                                fontWeight: 500,
                                fontFamily: C.mono,
                              }}
                            >
                              {wf.inSampleSharpe.toFixed(2)}
                            </td>
                            <td
                              style={{
                                padding: '12px',
                                color: C.green,
                                fontWeight: 500,
                                fontFamily: C.mono,
                              }}
                            >
                              {wf.outOfSampleSharpe.toFixed(2)}
                            </td>
                            <td
                              style={{
                                padding: '12px',
                                color:
                                  Math.abs(wf.divergence) > 0.5
                                    ? C.red
                                    : C.amber,
                                fontWeight: 500,
                                fontFamily: C.mono,
                              }}
                            >
                              {(wf.divergence * 100).toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Overfit Analysis */}
              {overfitAnalysis && (
                <div style={{ marginBottom: '32px' }}>
                  <h2
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: C.textDim,
                    }}
                  >
                    Overfit Analysis
                  </h2>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      marginBottom: '16px',
                    }}
                  >
                    {/* Overfit Gauge */}
                    <div
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        backgroundColor: C.card,
                        border: `1px solid ${C.border}`,
                      }}
                    >
                      <p
                        style={{
                          fontSize: '12px',
                          color: C.textMuted,
                          margin: '0 0 12px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                        }}
                      >
                        Overall Overfit Score
                      </p>
                      <OverfitGauge score={overfitAnalysis.overallScore} />
                      <p
                        style={{
                          fontSize: '11px',
                          color: C.textMuted,
                          margin: '12px 0 0 0',
                        }}
                      >
                        (Lower is better)
                      </p>
                    </div>

                    {/* Risk Level */}
                    <div
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        backgroundColor: C.card,
                        border: `1px solid ${C.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                    >
                      <p
                        style={{
                          fontSize: '12px',
                          color: C.textMuted,
                          margin: '0 0 12px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                        }}
                      >
                        Risk Level
                      </p>
                      <RiskLevelBadge level={overfitAnalysis.riskLevel} />
                    </div>
                  </div>

                  {/* Individual Tests */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      marginBottom: '16px',
                    }}
                  >
                    <p
                      style={{
                        fontSize: '12px',
                        color: C.textMuted,
                        margin: '0 0 12px 0',
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                      }}
                    >
                      Individual Tests
                    </p>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: '12px',
                      }}
                    >
                      {overfitAnalysis.tests.map((test: OverfitTest, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            padding: '12px',
                            borderRadius: '6px',
                            backgroundColor: C.cardAlt,
                            border: `1px solid ${C.borderLight}`,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                color: C.text,
                              }}
                            >
                              {test.name}
                            </span>
                            <span
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                backgroundColor: test.passed
                                  ? C.green + '30'
                                  : C.red + '30',
                                border: `1.5px solid ${test.passed ? C.green : C.red}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                fontWeight: 700,
                                color: test.passed ? C.green : C.red,
                              }}
                            >
                              {test.passed ? '✓' : '✗'}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '10px',
                              color: C.textMuted,
                              marginBottom: '4px',
                            }}
                          >
                            Score: <span style={{ color: C.text }}>{test.score.toFixed(2)}</span>
                            {' / '}
                            <span style={{ color: C.textMuted }}>
                              {test.threshold.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '6px',
                      backgroundColor:
                        overfitAnalysis.riskLevel === 'severe'
                          ? C.red + '15'
                          : overfitAnalysis.riskLevel === 'high'
                            ? '#ff9966' + '15'
                            : C.amber + '15',
                      border: `1px solid ${
                        overfitAnalysis.riskLevel === 'severe'
                          ? C.red + '50'
                          : overfitAnalysis.riskLevel === 'high'
                            ? '#ff9966' + '50'
                            : C.amber + '50'
                      }`,
                    }}
                  >
                    <p
                      style={{
                        fontSize: '12px',
                        color: C.textDim,
                        margin: 0,
                        lineHeight: '1.5',
                      }}
                    >
                      {overfitAnalysis.recommendation}
                    </p>
                  </div>
                </div>
              )}

              {/* Leakage Scanner */}
              {leakageResults && leakageResults.length > 0 && (
                <div style={{ marginBottom: '32px' }}>
                  <h2
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: C.textDim,
                    }}
                  >
                    Leakage Scanner
                  </h2>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    {leakageResults.map((result: LeakageResult, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: '12px',
                          borderRadius: '6px',
                          backgroundColor:
                            result.leakageDetected &&
                            result.severity === 'high'
                              ? C.red + '10'
                              : result.leakageDetected &&
                                  result.severity === 'medium'
                                ? C.amber + '10'
                                : C.cardAlt,
                          border: `1px solid ${
                            result.leakageDetected &&
                            result.severity === 'high'
                              ? C.red + '50'
                              : result.leakageDetected &&
                                  result.severity === 'medium'
                                ? C.amber + '50'
                                : C.borderLight
                          }`,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '8px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: C.text,
                            }}
                          >
                            {result.featureName}
                          </span>
                          {result.leakageDetected && (
                            <span
                              style={{
                                fontSize: '16px',
                              }}
                            >
                              ⚠
                            </span>
                          )}
                        </div>
                        {result.leakageDetected && (
                          <>
                            <p
                              style={{
                                fontSize: '11px',
                                color:
                                  result.severity === 'high'
                                    ? C.red
                                    : result.severity === 'medium'
                                      ? C.amber
                                      : C.green,
                                margin: '6px 0',
                                textTransform: 'uppercase',
                                letterSpacing: '0.3px',
                                fontWeight: 600,
                              }}
                            >
                              {result.leakageType}
                            </p>
                            <p
                              style={{
                                fontSize: '10px',
                                color: C.textMuted,
                                margin: 0,
                              }}
                            >
                              Severity:{' '}
                              <span
                                style={{
                                  color:
                                    result.severity === 'high'
                                      ? C.red
                                      : result.severity === 'medium'
                                        ? C.amber
                                        : C.green,
                                  fontWeight: 600,
                                }}
                              >
                                {result.severity.toUpperCase()}
                              </span>
                            </p>
                          </>
                        )}
                        {!result.leakageDetected && (
                          <p
                            style={{
                              fontSize: '10px',
                              color: C.green,
                              margin: 0,
                              fontWeight: 600,
                            }}
                          >
                            ✓ No leakage detected
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Paper vs Backtest Comparison */}
              {comparison && comparison.length > 0 && (
                <div style={{ marginBottom: '32px' }}>
                  <h2
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: C.textDim,
                    }}
                  >
                    Paper vs Backtest Comparison
                  </h2>

                  <div
                    style={{
                      overflowX: 'auto',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '12px',
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            Metric
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'right',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            Paper
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'right',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            Backtest
                          </th>
                          <th
                            style={{
                              padding: '12px',
                              textAlign: 'right',
                              color: C.textMuted,
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}
                          >
                            Deviation
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.map(
                          (comp: PaperBacktestComparison, idx: number) => (
                            <tr
                              key={idx}
                              style={{
                                borderBottom: `1px solid ${C.borderLight}`,
                                backgroundColor:
                                  idx % 2 === 0 ? 'transparent' : C.cardAlt,
                              }}
                            >
                              <td
                                style={{
                                  padding: '12px',
                                  color: C.text,
                                  fontWeight: 500,
                                }}
                              >
                                {comp.metric}
                                {comp.flagged && (
                                  <span
                                    style={{
                                      marginLeft: '6px',
                                      color: C.red,
                                    }}
                                  >
                                    ⚠
                                  </span>
                                )}
                              </td>
                              <td
                                style={{
                                  padding: '12px',
                                  textAlign: 'right',
                                  color: C.textDim,
                                  fontFamily: C.mono,
                                }}
                              >
                                {comp.paperValue.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  padding: '12px',
                                  textAlign: 'right',
                                  color: C.textDim,
                                  fontFamily: C.mono,
                                }}
                              >
                                {comp.backtestValue.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  padding: '12px',
                                  textAlign: 'right',
                                  color: comp.flagged ? C.red : C.amber,
                                  fontWeight: 500,
                                  fontFamily: C.mono,
                                }}
                              >
                                {comp.deviationPercent.toFixed(1)}%
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Equity Curve */}
              <div style={{ marginBottom: '32px' }}>
                <h2
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    marginBottom: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: C.textDim,
                  }}
                >
                  Equity Curve
                </h2>

                <div
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    backgroundColor: C.card,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <EquityCurveChart
                    equityData={[
                      100, 102, 101, 105, 107, 106, 110, 115, 112, 118, 120,
                      119, 125, 130, 128, 135, 138, 136, 142, 145,
                    ]}
                    drawdownData={[
                      0, 0, 0.01, 0, 0, 0.01, 0, 0, 0.03, 0, 0, 0.01, 0, 0,
                      0.02, 0, 0, 0.02, 0, 0,
                    ]}
                    windowBoundaries={[5, 10, 15]}
                  />
                </div>
              </div>

              {/* Execution Assumptions Summary */}
              {executionAssumptions && (
                <div style={{ marginBottom: '32px' }}>
                  <h2
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: C.textDim,
                    }}
                  >
                    Execution Assumptions
                  </h2>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: '12px',
                      marginBottom: '16px',
                    }}
                  >
                    {/* Fee Model */}
                    <div
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        backgroundColor: C.cardAlt,
                        border: `1px solid ${C.borderLight}`,
                      }}
                    >
                      <p
                        style={{
                          fontSize: '10px',
                          color: C.textMuted,
                          margin: '0 0 6px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                          fontWeight: 600,
                        }}
                      >
                        Fee Model
                      </p>
                      <p
                        style={{
                          fontSize: '12px',
                          color: C.text,
                          margin: '0 0 4px 0',
                          fontWeight: 500,
                        }}
                      >
                        {executionAssumptions.feeModel.type}
                      </p>
                      <p
                        style={{
                          fontSize: '11px',
                          color: C.textDim,
                          margin: 0,
                          fontFamily: C.mono,
                        }}
                      >
                        {executionAssumptions.feeModel.amount}
                        {executionAssumptions.feeModel.unit}
                      </p>
                    </div>

                    {/* Slippage Model */}
                    <div
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        backgroundColor: C.cardAlt,
                        border: `1px solid ${C.borderLight}`,
                      }}
                    >
                      <p
                        style={{
                          fontSize: '10px',
                          color: C.textMuted,
                          margin: '0 0 6px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                          fontWeight: 600,
                        }}
                      >
                        Slippage Model
                      </p>
                      <p
                        style={{
                          fontSize: '12px',
                          color: C.text,
                          margin: '0 0 4px 0',
                          fontWeight: 500,
                        }}
                      >
                        {executionAssumptions.slippageModel.type}
                      </p>
                      <p
                        style={{
                          fontSize: '11px',
                          color: C.textDim,
                          margin: 0,
                        }}
                      >
                        {executionAssumptions.slippageModel.description}
                      </p>
                    </div>

                    {/* Latency */}
                    <div
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        backgroundColor: C.cardAlt,
                        border: `1px solid ${C.borderLight}`,
                      }}
                    >
                      <p
                        style={{
                          fontSize: '10px',
                          color: C.textMuted,
                          margin: '0 0 6px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                          fontWeight: 600,
                        }}
                      >
                        Latency Assumption
                      </p>
                      <p
                        style={{
                          fontSize: '13px',
                          color: C.blue,
                          margin: 0,
                          fontWeight: 600,
                          fontFamily: C.mono,
                        }}
                      >
                        {executionAssumptions.latencyMs}ms
                      </p>
                    </div>

                    {/* Fill Model */}
                    <div
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        backgroundColor: C.cardAlt,
                        border: `1px solid ${C.borderLight}`,
                      }}
                    >
                      <p
                        style={{
                          fontSize: '10px',
                          color: C.textMuted,
                          margin: '0 0 6px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                          fontWeight: 600,
                        }}
                      >
                        Fill Model
                      </p>
                      <p
                        style={{
                          fontSize: '12px',
                          color: C.text,
                          margin: 0,
                        }}
                      >
                        {executionAssumptions.fillModel}
                      </p>
                    </div>
                  </div>

                  {/* Assumptions List */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '6px',
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    <p
                      style={{
                        fontSize: '11px',
                        color: C.textMuted,
                        margin: '0 0 12px 0',
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                        fontWeight: 600,
                      }}
                    >
                      This backtest assumes...
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '20px',
                        fontSize: '12px',
                        color: C.textDim,
                        lineHeight: '1.8',
                      }}
                    >
                      {executionAssumptions.assumptions.map(
                        (assumption: string, i: number) => (
                          <li key={i}>{assumption}</li>
                        )
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
