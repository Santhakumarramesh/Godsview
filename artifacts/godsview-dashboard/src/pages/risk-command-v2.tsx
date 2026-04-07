import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

// ============================================================================
// Design Tokens (Capital-Grade Styling)
// ============================================================================

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardAlt: "#141315",
  border: "rgba(72,72,73,0.25)",
  borderLight: "rgba(72,72,73,0.12)",
  green: "#9cff93",
  red: "#ff7162",
  amber: "#fbbf24",
  blue: "#67e8f9",
  purple: "#c084fc",
  text: "#ffffff",
  textDim: "#adaaab",
  textMuted: "#767576",
  textFaint: "#484849",
  font: "'Space Grotesk', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

// ============================================================================
// Types & Interfaces
// ============================================================================

interface VaRSnapshot {
  historicalVar95: number;
  historicalVar99: number;
  expectedShortfall: number;
  monteCarloVar: number;
  confidence: number;
}

interface Position {
  symbol: string;
  value: number;
  sector: string;
  varContribution: number;
  margin: number;
  riskPercent: number;
}

interface Exposure {
  sector: string;
  exposure: number;
  limit: number;
  percent: number;
}

interface Limit {
  name: string;
  current: number;
  max: number;
  utilization: number;
}

interface MacroEvent {
  id: string;
  title: string;
  timestamp: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

interface PortfolioHealth {
  grossLeverage: number;
  netLeverage: number;
  concentration: number;
  longExposure: number;
  shortExposure: number;
  riskBudgetUsed: number;
  varValue: number;
}

interface OvernightRules {
  sessionState: 'regular' | 'overnight' | 'weekend';
  maxLeverage: number;
  restrictedSectors: string[];
  requiredMargin: number;
  timeUntilChange: string;
}

interface TradeGateResult {
  approved: boolean;
  checks: {
    name: string;
    passed: boolean;
    impact: string;
  }[];
  suggestedSize?: number;
  reason: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

const formatMoney = (val: number, decimals = 0) => {
  const abs = Math.abs(val);
  if (abs >= 1e9) return (val / 1e9).toFixed(decimals) + 'B';
  if (abs >= 1e6) return (val / 1e6).toFixed(decimals) + 'M';
  if (abs >= 1e3) return (val / 1e3).toFixed(decimals) + 'K';
  return val.toFixed(decimals);
};

const formatPercent = (val: number, decimals = 2) =>
  (val * 100).toFixed(decimals) + '%';

const getRiskColor = (risk: number) => {
  if (risk > 0.06) return C.red;
  if (risk > 0.03) return C.amber;
  return C.green;
};

const getImpactColor = (impact: string) => {
  switch (impact) {
    case 'critical':
      return C.red;
    case 'high':
      return C.amber;
    case 'medium':
      return C.blue;
    case 'low':
    default:
      return C.textMuted;
  }
};

const getImpactLabel = (impact: string) => {
  const labels: Record<string, string> = {
    critical: 'CRITICAL',
    high: 'HIGH',
    medium: 'MEDIUM',
    low: 'LOW',
  };
  return labels[impact] || impact;
};

// ============================================================================
// API Hooks
// ============================================================================

const usePortfolioHealth = () => {
  return useQuery<PortfolioHealth>({
    queryKey: ['portfolio-health'],
    queryFn: async () => {
      const res = await fetch('/api/risk-v2/portfolio');
      return res.json();
    },
    refetchInterval: 10000,
  });
};

const usePositions = () => {
  return useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: async () => {
      const res = await fetch('/api/risk-v2/positions');
      return res.json();
    },
    refetchInterval: 10000,
  });
};

const useLimits = () => {
  return useQuery<Limit[]>({
    queryKey: ['limits'],
    queryFn: async () => {
      const res = await fetch('/api/risk-v2/limits');
      return res.json();
    },
    refetchInterval: 30000,
  });
};

const useMacroEvents = () => {
  return useQuery<MacroEvent[]>({
    queryKey: ['macro-events'],
    queryFn: async () => {
      const res = await fetch('/api/risk-v2/events');
      return res.json();
    },
    refetchInterval: 30000,
  });
};

const useExposure = () => {
  return useQuery<Exposure[]>({
    queryKey: ['exposure'],
    queryFn: async () => {
      const res = await fetch('/api/risk-v2/exposure');
      return res.json();
    },
    refetchInterval: 10000,
  });
};

const useOvernightRules = () => {
  return useQuery<OvernightRules>({
    queryKey: ['overnight-rules'],
    queryFn: async () => {
      const res = await fetch('/api/risk-v2/overnight');
      return res.json();
    },
    refetchInterval: 30000,
  });
};

// ============================================================================
// Component: Header
// ============================================================================

interface HeaderProps {
  portfolio: PortfolioHealth;
}

const Header: React.FC<HeaderProps> = ({ portfolio }) => {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${C.card} 0%, ${C.cardAlt} 100%)`,
        borderBottom: `1px solid ${C.border}`,
        padding: '32px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, fontFamily: C.font, color: C.text }}>
            Risk Command v2
          </h1>
          <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: C.textMuted, fontFamily: C.font }}>
            Phase 112 — Capital Protection First
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* Portfolio VaR Badge */}
          <div
            style={{
              background: C.cardAlt,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>Portfolio VaR (95%)</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: C.blue, fontFamily: C.mono }}>
              ${formatMoney(portfolio.varValue, 1)}M
            </div>
          </div>

          {/* Leverage Indicator */}
          <div
            style={{
              background: C.cardAlt,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>Gross Leverage</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: portfolio.grossLeverage > 2 ? C.red : portfolio.grossLeverage > 1.5 ? C.amber : C.green,
                fontFamily: C.mono,
              }}
            >
              {portfolio.grossLeverage.toFixed(2)}x
            </div>
          </div>

          {/* Risk Budget Bar */}
          <div
            style={{
              background: C.cardAlt,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minWidth: '160px',
            }}
          >
            <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>Risk Budget Utilization</div>
            <div style={{ height: '8px', background: C.bg, borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${portfolio.riskBudgetUsed * 100}%`,
                  background: portfolio.riskBudgetUsed > 0.8 ? C.red : portfolio.riskBudgetUsed > 0.5 ? C.amber : C.green,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ fontSize: '11px', color: C.textDim, fontFamily: C.mono }}>
              {formatPercent(portfolio.riskBudgetUsed)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Component: VaR Dashboard (3-Card VaR Section)
// ============================================================================

interface VaRDashboardProps {
  portfolio: PortfolioHealth;
}

const VaRDashboard: React.FC<VaRDashboardProps> = ({ portfolio }) => {
  // Mock VaR data - replace with actual API data
  const varData: VaRSnapshot = {
    historicalVar95: portfolio.varValue * 0.95,
    historicalVar99: portfolio.varValue * 1.3,
    expectedShortfall: portfolio.varValue * 1.5,
    monteCarloVar: portfolio.varValue * 0.98,
    confidence: 95,
  };

  const cards = [
    {
      title: 'Historical VaR',
      metrics: [
        { label: '95% VaR', value: varData.historicalVar95 },
        { label: '99% VaR', value: varData.historicalVar99 },
      ],
    },
    {
      title: 'Expected Shortfall',
      metrics: [
        { label: 'CVaR (95%)', value: varData.expectedShortfall },
        { label: 'Tail Risk', value: varData.expectedShortfall * 1.2 },
      ],
    },
    {
      title: 'Monte Carlo VaR',
      metrics: [
        { label: 'Simulated VaR', value: varData.monteCarloVar },
        { label: 'Confidence', value: varData.confidence / 100 },
      ],
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
      {cards.map((card, idx) => (
        <div
          key={idx}
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
            {card.title}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {card.metrics.map((m, midx) => (
              <div key={midx}>
                <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '4px', fontFamily: C.mono }}>
                  {m.label}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: C.blue, fontFamily: C.mono }}>
                  ${formatMoney(m.value, 1)}M
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Component: Exposure Matrix
// ============================================================================

interface ExposureMatrixProps {
  exposure: Exposure[];
  portfolio: PortfolioHealth;
}

const ExposureMatrix: React.FC<ExposureMatrixProps> = ({ exposure, portfolio }) => {
  const maxExposure = Math.max(...exposure.map(e => e.exposure));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
      {/* Sector Exposure Bars */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
          Sector Exposure
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {exposure.map((exp, idx) => (
            <div key={idx}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: C.text, fontFamily: C.mono }}>{exp.sector}</span>
                <span style={{ fontSize: '11px', color: C.textDim, fontFamily: C.mono }}>
                  {formatPercent(exp.percent)}
                </span>
              </div>
              <div style={{ height: '6px', background: C.bg, borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${(exp.exposure / maxExposure) * 100}%`,
                    background: C.blue,
                    borderRadius: '3px',
                  }}
                />
                {/* Limit line */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: `${(exp.limit / maxExposure) * 100}%`,
                    width: '2px',
                    height: '100%',
                    background: C.red,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Long/Short Balance */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
          Long/Short Balance
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '4px', fontFamily: C.mono }}>Long</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.green, fontFamily: C.mono }}>
              {formatPercent(portfolio.longExposure)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '4px', fontFamily: C.mono }}>Short</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.red, fontFamily: C.mono }}>
              {formatPercent(portfolio.shortExposure)}
            </div>
          </div>
        </div>
      </div>

      {/* Leverage & Concentration */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
          Risk Metrics
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '4px', fontFamily: C.mono }}>Net Leverage</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.purple, fontFamily: C.mono }}>
              {portfolio.netLeverage.toFixed(2)}x
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '4px', fontFamily: C.mono }}>HHI (Concentration)</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.amber, fontFamily: C.mono }}>
              {(portfolio.concentration * 10000).toFixed(0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Component: Position Risk Table
// ============================================================================

interface PositionRiskTableProps {
  positions: Position[];
}

const PositionRiskTable: React.FC<PositionRiskTableProps> = ({ positions }) => {
  const [sortBy, setSortBy] = useState<'symbol' | 'value' | 'risk'>('risk');

  const sorted = useMemo(() => {
    const arr = [...positions];
    switch (sortBy) {
      case 'symbol':
        return arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
      case 'value':
        return arr.sort((a, b) => b.value - a.value);
      case 'risk':
      default:
        return arr.sort((a, b) => b.riskPercent - a.riskPercent);
    }
  }, [positions, sortBy]);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
        Position Risk Analysis
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: C.mono,
            fontSize: '11px',
          }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th
                style={{ textAlign: 'left', padding: '8px', color: C.textMuted, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setSortBy('symbol')}
              >
                Symbol
              </th>
              <th
                style={{ textAlign: 'right', padding: '8px', color: C.textMuted, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setSortBy('value')}
              >
                Value
              </th>
              <th style={{ textAlign: 'left', padding: '8px', color: C.textMuted, fontWeight: 600 }}>Sector</th>
              <th style={{ textAlign: 'right', padding: '8px', color: C.textMuted, fontWeight: 600 }}>VaR Contrib.</th>
              <th style={{ textAlign: 'right', padding: '8px', color: C.textMuted, fontWeight: 600 }}>Margin</th>
              <th
                style={{ textAlign: 'right', padding: '8px', color: C.textMuted, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setSortBy('risk')}
              >
                Risk %
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 10).map((pos, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                <td style={{ padding: '8px', color: C.text }}>{pos.symbol}</td>
                <td style={{ textAlign: 'right', padding: '8px', color: C.text }}>
                  ${formatMoney(pos.value, 1)}M
                </td>
                <td style={{ padding: '8px', color: C.textDim }}>{pos.sector}</td>
                <td style={{ textAlign: 'right', padding: '8px', color: C.blue }}>
                  ${formatMoney(pos.varContribution, 1)}M
                </td>
                <td style={{ textAlign: 'right', padding: '8px', color: C.textDim }}>
                  {formatPercent(pos.margin)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    padding: '8px',
                    color: getRiskColor(pos.riskPercent),
                    fontWeight: 600,
                  }}
                >
                  {formatPercent(pos.riskPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// Component: Macro Event Calendar
// ============================================================================

interface MacroEventCalendarProps {
  events: MacroEvent[];
}

const MacroEventCalendar: React.FC<MacroEventCalendarProps> = ({ events }) => {
  const now = new Date();
  const futureEvents = events
    .filter(e => new Date(e.timestamp) > now)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(0, 7);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
        Macro Event Timeline (Next 7 Days)
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {futureEvents.length === 0 ? (
          <p style={{ color: C.textMuted, fontFamily: C.mono, fontSize: '11px' }}>No significant events scheduled</p>
        ) : (
          futureEvents.map((event, idx) => {
            const eventTime = new Date(event.timestamp);
            const daysAway = Math.ceil((eventTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            return (
              <div
                key={event.id}
                style={{
                  display: 'flex',
                  gap: '12px',
                  padding: '12px',
                  background: C.bg,
                  borderRadius: '6px',
                  borderLeft: `3px solid ${getImpactColor(event.impact)}`,
                }}
              >
                <div style={{ minWidth: '60px' }}>
                  <div style={{ fontSize: '9px', color: C.textFaint, fontFamily: C.mono, marginBottom: '2px' }}>
                    in {daysAway}d
                  </div>
                  <div style={{ fontSize: '10px', color: C.textDim, fontFamily: C.mono }}>
                    {eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: C.text, fontFamily: C.font, marginBottom: '4px' }}>
                    {event.title}
                  </div>
                  <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>
                    {event.description}
                  </div>
                </div>
                <div style={{ minWidth: '80px', textAlign: 'right' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: '9px',
                      fontWeight: 700,
                      color: getImpactColor(event.impact),
                      background: `${getImpactColor(event.impact)}20`,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontFamily: C.mono,
                    }}
                  >
                    {getImpactLabel(event.impact)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Component: Limit Utilization Grid
// ============================================================================

interface LimitUtilizationGridProps {
  limits: Limit[];
}

const LimitUtilizationGrid: React.FC<LimitUtilizationGridProps> = ({ limits }) => {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
        Limit Utilization Dashboard
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {limits.map((limit, idx) => {
          const isWarning = limit.utilization > 0.8;
          const isCritical = limit.utilization > 0.95;

          return (
            <div
              key={idx}
              style={{
                padding: '12px',
                background: isCritical ? `${C.red}10` : isWarning ? `${C.amber}10` : C.bg,
                border: `1px solid ${isCritical ? C.red : isWarning ? C.amber : C.border}`,
                borderRadius: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: C.text, fontFamily: C.mono }}>
                  {limit.name}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: isCritical ? C.red : isWarning ? C.amber : C.green,
                    fontFamily: C.mono,
                  }}
                >
                  {formatPercent(limit.utilization)}
                </span>
              </div>
              <div style={{ height: '6px', background: C.cardAlt, borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${limit.utilization * 100}%`,
                    background: isCritical ? C.red : isWarning ? C.amber : C.green,
                    borderRadius: '3px',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                <span style={{ fontSize: '9px', color: C.textFaint, fontFamily: C.mono }}>
                  {formatMoney(limit.current, 1)}M / {formatMoney(limit.max, 1)}M
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Component: Trade Gate Preview
// ============================================================================

const TradeGatePreview: React.FC = () => {
  const [symbol, setSymbol] = useState('');
  const [size, setSize] = useState('');
  const [result, setResult] = useState<TradeGateResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSimulate = async () => {
    if (!symbol || !size) return;
    setLoading(true);

    try {
      const res = await fetch('/api/risk-v2/trade-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, size: parseFloat(size) }),
      });
      setResult(await res.json());
    } catch (err) {
      console.error('Trade gate error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
        Trade Gate Preview (What-If Simulator)
      </h3>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          style={{
            flex: 1,
            padding: '10px',
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: '6px',
            color: C.text,
            fontFamily: C.mono,
            fontSize: '11px',
          }}
        />
        <input
          type="number"
          placeholder="Size ($M)"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          style={{
            flex: 1,
            padding: '10px',
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: '6px',
            color: C.text,
            fontFamily: C.mono,
            fontSize: '11px',
          }}
        />
        <button
          onClick={handleSimulate}
          disabled={loading}
          style={{
            padding: '10px 20px',
            background: C.blue,
            color: C.bg,
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            fontFamily: C.mono,
            fontSize: '11px',
            cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Simulating...' : 'Simulate'}
        </button>
      </div>

      {result && (
        <div>
          <div
            style={{
              padding: '12px',
              background: result.approved ? `${C.green}15` : `${C.red}15`,
              border: `1px solid ${result.approved ? C.green : C.red}`,
              borderRadius: '6px',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: result.approved ? C.green : C.red,
                fontFamily: C.mono,
                marginBottom: '4px',
              }}
            >
              {result.approved ? 'APPROVED' : 'WOULD BE REJECTED'}
            </div>
            <div style={{ fontSize: '10px', color: C.textDim, fontFamily: C.mono }}>
              {result.reason}
            </div>
            {result.suggestedSize && (
              <div style={{ fontSize: '10px', color: C.textDim, fontFamily: C.mono, marginTop: '4px' }}>
                Suggested size: ${formatMoney(result.suggestedSize, 1)}M
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {result.checks.map((check, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: check.passed ? C.green : C.red,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: C.bg,
                  }}
                >
                  {check.passed ? '✓' : '✕'}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: C.text, fontWeight: 600, fontFamily: C.font }}>
                    {check.name}
                  </div>
                  <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>
                    {check.impact}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Component: Overnight/Weekend Panel
// ============================================================================

interface OvernightPanelProps {
  rules: OvernightRules;
}

const OvernightPanel: React.FC<OvernightPanelProps> = ({ rules }) => {
  const stateLabels: Record<string, string> = {
    regular: 'Regular Hours',
    overnight: 'Overnight Session',
    weekend: 'Weekend',
  };

  const stateColors: Record<string, string> = {
    regular: C.green,
    overnight: C.amber,
    weekend: C.red,
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', color: C.textMuted, fontWeight: 600, fontFamily: C.font }}>
        Session Rules & Overnight Position Management
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
        {/* Current Session State */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '8px', fontFamily: C.mono }}>Current Session</div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: stateColors[rules.sessionState],
              fontFamily: C.font,
              marginBottom: '4px',
            }}
          >
            {stateLabels[rules.sessionState]}
          </div>
          <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>
            Changes in {rules.timeUntilChange}
          </div>
        </div>

        {/* Max Leverage */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '8px', fontFamily: C.mono }}>Max Leverage</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.blue, fontFamily: C.mono }}>
            {rules.maxLeverage.toFixed(2)}x
          </div>
          <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>This session</div>
        </div>

        {/* Required Margin */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '10px', color: C.textFaint, marginBottom: '8px', fontFamily: C.mono }}>Margin Requirement</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.purple, fontFamily: C.mono }}>
            {formatPercent(rules.requiredMargin)}
          </div>
          <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>Portfolio wide</div>
        </div>
      </div>

      {/* Restricted Sectors */}
      {rules.restrictedSectors.length > 0 && (
        <div style={{ marginTop: '16px', padding: '12px', background: `${C.red}10`, border: `1px solid ${C.red}`, borderRadius: '6px' }}>
          <div style={{ fontSize: '10px', color: C.red, fontWeight: 700, fontFamily: C.mono, marginBottom: '8px' }}>
            RESTRICTED SECTORS THIS SESSION
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {rules.restrictedSectors.map((sector, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: '10px',
                  color: C.red,
                  background: `${C.red}20`,
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontFamily: C.mono,
                }}
              >
                {sector}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Page Component
// ============================================================================

export default function RiskCommandV2Page() {
  const portfolio = usePortfolioHealth();
  const positions = usePositions();
  const limits = useLimits();
  const events = useMacroEvents();
  const exposure = useExposure();
  const overnight = useOvernightRules();

  const isLoading = portfolio.isLoading || positions.isLoading || limits.isLoading;

  if (isLoading) {
    return (
      <div
        style={{
          background: C.bg,
          color: C.text,
          minHeight: '100vh',
          padding: '32px',
          fontFamily: C.font,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ fontSize: '14px', color: C.textMuted }}>Loading Risk Command v2...</div>
      </div>
    );
  }

  if (portfolio.error || positions.error) {
    return (
      <div
        style={{
          background: C.bg,
          color: C.text,
          minHeight: '100vh',
          padding: '32px',
          fontFamily: C.font,
        }}
      >
        <div style={{ fontSize: '14px', color: C.red }}>Error loading risk data. Please try again.</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '32px', fontFamily: C.font }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        {/* Header */}
        {portfolio.data && <Header portfolio={portfolio.data} />}

        {/* VaR Dashboard */}
        {portfolio.data && <VaRDashboard portfolio={portfolio.data} />}

        {/* Exposure Matrix */}
        {exposure.data && portfolio.data && <ExposureMatrix exposure={exposure.data} portfolio={portfolio.data} />}

        {/* Position Risk Table */}
        {positions.data && <PositionRiskTable positions={positions.data} />}

        {/* Macro Event Calendar */}
        {events.data && <MacroEventCalendar events={events.data} />}

        {/* Limit Utilization Grid */}
        {limits.data && <LimitUtilizationGrid limits={limits.data} />}

        {/* Trade Gate Preview */}
        <TradeGatePreview />

        {/* Overnight/Weekend Panel */}
        {overnight.data && <OvernightPanel rules={overnight.data} />}

        {/* Footer */}
        <div style={{ marginTop: '32px', padding: '16px', borderTop: `1px solid ${C.border}`, textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: C.textMuted, fontFamily: C.mono }}>
            GodsView Phase 112 Risk Engine v2 • Last update: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}
