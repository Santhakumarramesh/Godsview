import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

// Design tokens
const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardAlt: "#141318",
  border: "#2a2930",
  text: "#e4e4e7",
  muted: "#71717a",
  accent: "#a78bfa",
  green: "#34d399",
  red: "#f87171",
  yellow: "#fbbf24",
  blue: "#60a5fa",
};

// Utility components
const Badge = ({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'critical' | 'warning' | 'info' | 'success';
}) => {
  const colors = {
    default: { bg: C.border, text: C.text },
    critical: { bg: `${C.red}22`, text: C.red },
    warning: { bg: `${C.yellow}22`, text: C.yellow },
    info: { bg: `${C.blue}22`, text: C.blue },
    success: { bg: `${C.green}22`, text: C.green },
  };
  const style = colors[variant];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: style.bg,
        color: style.text,
      }}
    >
      {children}
    </span>
  );
};

const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div
    style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '16px',
      ...style,
    }}
  >
    {children}
  </div>
);

const SectionHeader = ({ title, icon }: { title: string; icon: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
    <span
      className="material-symbols-outlined"
      style={{ fontSize: '24px', color: C.accent }}
    >
      {icon}
    </span>
    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: C.text }}>
      {title}
    </h2>
  </div>
);

// 1. Decision Packet Explorer
const DecisionPacketExplorer = () => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    symbol: '',
    strategy: '',
    startDate: '',
    endDate: '',
  });

  const { data: packets = [], isLoading } = useQuery({
    queryKey: ['packets', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.symbol) params.append('symbol', filters.symbol);
      if (filters.strategy) params.append('strategy', filters.strategy);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      const res = await fetch(`/api/explainability/packets?${params}`);
      return res.json();
    },
  });

  return (
    <Card style={{ gridColumn: '1 / -1', marginBottom: '20px' }}>
      <SectionHeader title="Decision Packet Explorer" icon="folder_open" />

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter by symbol..."
          value={filters.symbol}
          onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
          style={{
            flex: 1,
            minWidth: '150px',
            padding: '8px 12px',
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            color: C.text,
            fontSize: '14px',
          }}
        />
        <input
          type="text"
          placeholder="Filter by strategy..."
          value={filters.strategy}
          onChange={(e) => setFilters({ ...filters, strategy: e.target.value })}
          style={{
            flex: 1,
            minWidth: '150px',
            padding: '8px 12px',
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            color: C.text,
            fontSize: '14px',
          }}
        />
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          style={{
            padding: '8px 12px',
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            color: C.text,
            fontSize: '14px',
          }}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          style={{
            padding: '8px 12px',
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            color: C.text,
            fontSize: '14px',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '14px',
          }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Trade ID
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Symbol
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Strategy
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Action
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Model Score
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Risk Status
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                P&L
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.muted, fontWeight: '600' }}>
                Timestamp
              </th>
              <th style={{ padding: '12px', textAlign: 'center', color: C.muted, fontWeight: '600' }}>
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} style={{ padding: '20px', textAlign: 'center', color: C.muted }}>
                  Loading packets...
                </td>
              </tr>
            ) : packets.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '20px', textAlign: 'center', color: C.muted }}>
                  No packets found
                </td>
              </tr>
            ) : (
              packets.map((packet: any) => (
                <React.Fragment key={packet.id}>
                  <tr
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      backgroundColor:
                        expandedId === packet.id ? `${C.accent}08` : 'transparent',
                      cursor: 'pointer',
                    }}
                    onClick={() =>
                      setExpandedId(expandedId === packet.id ? null : packet.id)
                    }
                  >
                    <td style={{ padding: '12px', color: C.text }}>
                      <code style={{ fontSize: '12px', color: C.accent }}>
                        {packet.id.slice(0, 8)}
                      </code>
                    </td>
                    <td style={{ padding: '12px', color: C.text }}>{packet.symbol}</td>
                    <td style={{ padding: '12px', color: C.text }}>
                      <Badge>{packet.strategy}</Badge>
                    </td>
                    <td style={{ padding: '12px', color: C.text }}>
                      <Badge
                        variant={packet.action === 'BUY' ? 'success' : 'warning'}
                      >
                        {packet.action}
                      </Badge>
                    </td>
                    <td style={{ padding: '12px', color: C.text }}>
                      {(packet.modelScore * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '12px', color: C.text }}>
                      <Badge
                        variant={
                          packet.riskStatus === 'CRITICAL'
                            ? 'critical'
                            : packet.riskStatus === 'WARNING'
                            ? 'warning'
                            : 'info'
                        }
                      >
                        {packet.riskStatus}
                      </Badge>
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        color:
                          packet.pnl >= 0 ? C.green : C.red,
                        fontWeight: '600',
                      }}
                    >
                      ${packet.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: '12px', color: C.muted, fontSize: '12px' }}>
                      {new Date(packet.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: '18px',
                          color: expandedId === packet.id ? C.accent : C.muted,
                        }}
                      >
                        {expandedId === packet.id ? 'expand_less' : 'expand_more'}
                      </span>
                    </td>
                  </tr>
                  {expandedId === packet.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: '16px', backgroundColor: C.cardAlt }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <div>
                            <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
                              Full Decision Details
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                padding: '12px',
                                backgroundColor: C.bg,
                                borderRadius: '4px',
                                fontSize: '11px',
                                color: C.text,
                                overflowX: 'auto',
                              }}
                            >
                              {JSON.stringify(packet.details, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
                              Feature Importance
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {Object.entries(packet.features || {}).map(
                                ([name, importance]: any) => (
                                  <div key={name}>
                                    <div
                                      style={{
                                        fontSize: '12px',
                                        color: C.text,
                                        marginBottom: '4px',
                                      }}
                                    >
                                      {name}: {(importance * 100).toFixed(1)}%
                                    </div>
                                    <div
                                      style={{
                                        height: '4px',
                                        backgroundColor: C.border,
                                        borderRadius: '2px',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          height: '100%',
                                          backgroundColor: C.accent,
                                          width: `${importance * 100}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// 2. Replay Console
const ReplayConsole = () => {
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [whatIfAdjustments, setWhatIfAdjustments] = useState<Record<string, number>>({});

  const { data: packets = [] } = useQuery({
    queryKey: ['packets-for-replay'],
    queryFn: async () => {
      const res = await fetch('/api/explainability/packets?limit=10');
      return res.json();
    },
  });

  const { data: replayData } = useQuery({
    queryKey: ['replay', selectedPacketId],
    enabled: !!selectedPacketId,
    queryFn: async () => {
      const res = await fetch(`/api/explainability/replays/${selectedPacketId}`);
      return res.json();
    },
  });

  const adjustedDecision = useMemo(() => {
    if (!replayData) return null;
    const adjustments = Object.entries(whatIfAdjustments).reduce((acc, [key, value]) => {
      acc[key] = (replayData.originalInputs[key] || 0) * (1 + value / 100);
      return acc;
    }, {} as Record<string, number>);
    return { ...replayData.originalDecision, ...adjustments };
  }, [replayData, whatIfAdjustments]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <Card>
        <SectionHeader title="Replay Selection" icon="play_circle" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {packets.slice(0, 5).map((p: any) => (
            <button
              key={p.id}
              onClick={() => {
                setSelectedPacketId(p.id);
                setWhatIfAdjustments({});
              }}
              style={{
                padding: '12px',
                backgroundColor:
                  selectedPacketId === p.id ? C.accent : C.cardAlt,
                border: `1px solid ${selectedPacketId === p.id ? C.accent : C.border}`,
                color: selectedPacketId === p.id ? C.bg : C.text,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'all 0.2s',
              }}
            >
              {p.symbol} - {p.action} @ {(p.modelScore * 100).toFixed(0)}%
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader title="Replay Results" icon="analytics" />
        {replayData ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
              }}
            >
              <div
                style={{
                  padding: '12px',
                  backgroundColor: C.bg,
                  borderRadius: '4px',
                  borderLeft: `4px solid ${C.blue}`,
                }}
              >
                <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
                  Original Decision
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: C.blue }}>
                  {replayData.originalDecision.action}
                </div>
                <div style={{ fontSize: '12px', color: C.text, marginTop: '4px' }}>
                  Score: {(replayData.originalDecision.score * 100).toFixed(1)}%
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  backgroundColor: C.bg,
                  borderRadius: '4px',
                  borderLeft: `4px solid ${
                    replayData.replayedDecision.action === replayData.originalDecision.action
                      ? C.green
                      : C.red
                  }`,
                }}
              >
                <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
                  Replayed Decision
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color:
                      replayData.replayedDecision.action === replayData.originalDecision.action
                        ? C.green
                        : C.red,
                  }}
                >
                  {replayData.replayedDecision.action}
                </div>
                <div style={{ fontSize: '12px', color: C.text, marginTop: '4px' }}>
                  Score: {(replayData.replayedDecision.score * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                backgroundColor: `${C.yellow}11`,
                border: `1px solid ${C.yellow}44`,
                borderRadius: '4px',
              }}
            >
              <div style={{ fontSize: '12px', color: C.yellow, fontWeight: '600' }}>
                Divergence: {(Math.abs(replayData.divergence) * 100).toFixed(2)}%
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                backgroundColor: `${C.green}11`,
                border: `1px solid ${C.green}44`,
                borderRadius: '4px',
              }}
            >
              <div style={{ fontSize: '12px', color: C.green, fontWeight: '600' }}>
                Counterfactual P&L: ${replayData.counterfactualPnl.toFixed(2)}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: '14px', textAlign: 'center', padding: '20px' }}>
            Select a packet to replay
          </div>
        )}
      </Card>

      {replayData && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Card>
            <SectionHeader title="What-If Controls" icon="tune" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {Object.keys(replayData.originalInputs || {}).map((key) => (
                <div key={key}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: C.muted,
                      marginBottom: '4px',
                    }}
                  >
                    {key} ({(whatIfAdjustments[key] || 0) > 0 ? '+' : ''}
                    {whatIfAdjustments[key] || 0}%)
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={whatIfAdjustments[key] || 0}
                    onChange={(e) =>
                      setWhatIfAdjustments({
                        ...whatIfAdjustments,
                        [key]: parseFloat(e.target.value),
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// 3. Post-Mortem Center
const PostMortemCenter = () => {
  const { data: postMortems = [] } = useQuery({
    queryKey: ['post-mortems'],
    queryFn: async () => {
      const res = await fetch('/api/explainability/post-mortems');
      return res.json();
    },
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const severityCounts = useMemo(() => {
    return {
      critical: postMortems.filter((p: any) => p.severity === 'critical').length,
      warning: postMortems.filter((p: any) => p.severity === 'warning').length,
      info: postMortems.filter((p: any) => p.severity === 'info').length,
    };
  }, [postMortems]);

  const topRootCauses = useMemo(() => {
    const causes: Record<string, number> = {};
    postMortems.forEach((p: any) => {
      causes[p.rootCause] = (causes[p.rootCause] || 0) + 1;
    });
    return Object.entries(causes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [postMortems]);

  const maxCount = topRootCauses.length > 0 ? topRootCauses[0][1] : 1;

  return (
    <Card>
      <SectionHeader title="Post-Mortem Center" icon="warning" />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div
          style={{
            padding: '12px',
            backgroundColor: `${C.red}11`,
            border: `1px solid ${C.red}44`,
            borderRadius: '4px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
            Critical
          </div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: C.red }}>
            {severityCounts.critical}
          </div>
        </div>
        <div
          style={{
            padding: '12px',
            backgroundColor: `${C.yellow}11`,
            border: `1px solid ${C.yellow}44`,
            borderRadius: '4px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
            Warning
          </div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: C.yellow }}>
            {severityCounts.warning}
          </div>
        </div>
        <div
          style={{
            padding: '12px',
            backgroundColor: `${C.blue}11`,
            border: `1px solid ${C.blue}44`,
            borderRadius: '4px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
            Info
          </div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: C.blue }}>
            {severityCounts.info}
          </div>
        </div>
      </div>

      {/* Root cause chart */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', color: C.muted, marginBottom: '12px', fontWeight: '600' }}>
          Top Root Causes
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {topRootCauses.map(([cause, count]) => (
            <div key={cause}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '4px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: C.text }}>{cause}</span>
                <span style={{ color: C.muted }}>{count}</span>
              </div>
              <div
                style={{
                  height: '6px',
                  backgroundColor: C.border,
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    backgroundColor: C.accent,
                    width: `${(count / maxCount) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {postMortems.slice(0, 3).map((pm: any) => (
          <div key={pm.id}>
            <button
              onClick={() => setExpandedId(expandedId === pm.id ? null : pm.id)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: expandedId === pm.id ? C.cardAlt : 'transparent',
                border: `1px solid ${C.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: C.text,
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Badge variant={pm.severity === 'critical' ? 'critical' : pm.severity === 'warning' ? 'warning' : 'info'}>
                  {pm.severity.toUpperCase()}
                </Badge>
                <span style={{ fontSize: '14px' }}>{pm.tradeId}</span>
              </div>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '18px' }}
              >
                {expandedId === pm.id ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {expandedId === pm.id && (
              <div
                style={{
                  padding: '12px',
                  backgroundColor: C.bg,
                  borderLeft: `4px solid ${
                    pm.severity === 'critical' ? C.red : pm.severity === 'warning' ? C.yellow : C.blue
                  }`,
                  marginTop: '2px',
                  borderRadius: '0 4px 4px 0',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                  <div>
                    <div style={{ color: C.muted, marginBottom: '4px' }}>Root Cause</div>
                    <div style={{ color: C.text, fontWeight: '500' }}>{pm.rootCause}</div>
                  </div>
                  <div>
                    <div style={{ color: C.muted, marginBottom: '4px' }}>Timestamp</div>
                    <div style={{ color: C.text, fontWeight: '500' }}>
                      {new Date(pm.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <div style={{ color: C.muted, marginBottom: '4px' }}>Contributing Factors</div>
                  <ul style={{ margin: '0', paddingLeft: '20px', color: C.text }}>
                    {(pm.factors || []).map((f: string, i: number) => (
                      <li key={i} style={{ fontSize: '12px', marginBottom: '4px' }}>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <div style={{ color: C.muted, marginBottom: '4px' }}>Lessons Learned</div>
                  <div style={{ fontSize: '12px', color: C.text, lineHeight: '1.5' }}>
                    {pm.lessonsLearned}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

// 4. Expected vs Actual
const ExpectedVsActual = () => {
  const { data: comparison = {} } = useQuery({
    queryKey: ['comparison'],
    queryFn: async () => {
      const res = await fetch('/api/explainability/comparison');
      return res.json();
    },
  });

  const slippageData = comparison.slippage || [];
  const maxSlippage = Math.max(...slippageData.map((d: any) => Math.abs(d.value)), 1);

  return (
    <Card>
      <SectionHeader title="Expected vs Actual" icon="compare" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        <div
          style={{
            padding: '12px',
            backgroundColor: C.bg,
            borderRadius: '4px',
          }}
        >
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px' }}>
            Expected Fill Price
          </div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: C.blue }}>
            ${(comparison.expectedFill || 100).toFixed(2)}
          </div>
        </div>
        <div
          style={{
            padding: '12px',
            backgroundColor: C.bg,
            borderRadius: '4px',
          }}
        >
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px' }}>
            Actual Fill Price
          </div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: C.green }}>
            ${(comparison.actualFill || 99.95).toFixed(2)}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', color: C.muted, marginBottom: '12px', fontWeight: '600' }}>
          Slippage Analysis
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {slippageData.slice(0, 5).map((item: any, i: number) => (
            <div key={i}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '4px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: C.text }}>{item.label}</span>
                <span style={{ color: item.value > 0 ? C.red : C.green }}>
                  {item.value > 0 ? '+' : ''}{item.value.toFixed(3)}%
                </span>
              </div>
              <div
                style={{
                  height: '6px',
                  backgroundColor: C.border,
                  borderRadius: '3px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    backgroundColor: item.value > 0 ? C.red : C.green,
                    width: `${Math.min((Math.abs(item.value) / maxSlippage) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '12px', color: C.muted, marginBottom: '12px', fontWeight: '600' }}>
          Latency Breakdown
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {[
            { label: 'Decision Time', value: comparison.decisionLatency || 12, unit: 'ms' },
            { label: 'Transmission', value: comparison.transmissionLatency || 8, unit: 'ms' },
            { label: 'Execution', value: comparison.executionLatency || 45, unit: 'ms' },
            { label: 'Settlement', value: comparison.settlementLatency || 32, unit: 'ms' },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: '12px',
                backgroundColor: C.cardAlt,
                borderRadius: '4px',
              }}
            >
              <div style={{ fontSize: '12px', color: C.muted, marginBottom: '4px' }}>
                {item.label}
              </div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: C.text }}>
                {item.value} <span style={{ fontSize: '12px', color: C.muted }}>{item.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

// 5. Operator Notes & Action Items
const OperatorNotesCenter = () => {
  const [notes, setNotes] = useState<Array<{ id: string; text: string; timestamp: string }>>([]);
  const [newNote, setNewNote] = useState('');
  const [actionItems, setActionItems] = useState<
    Array<{ id: string; title: string; status: 'open' | 'in-progress' | 'resolved' }>
  >([]);
  const [newActionItem, setNewActionItem] = useState('');

  const { data: fetchedNotes = [] } = useQuery({
    queryKey: ['notes'],
    queryFn: async () => {
      const res = await fetch('/api/explainability/notes');
      return res.json();
    },
  });

  const addNote = () => {
    if (newNote.trim()) {
      setNotes([
        ...notes,
        { id: Math.random().toString(), text: newNote, timestamp: new Date().toISOString() },
      ]);
      setNewNote('');
    }
  };

  const addActionItem = () => {
    if (newActionItem.trim()) {
      setActionItems([
        ...actionItems,
        { id: Math.random().toString(), title: newActionItem, status: 'open' },
      ]);
      setNewActionItem('');
    }
  };

  const toggleActionStatus = (id: string) => {
    setActionItems(
      actionItems.map((item) =>
        item.id === id
          ? {
              ...item,
              status:
                item.status === 'open'
                  ? 'in-progress'
                  : item.status === 'in-progress'
                  ? 'resolved'
                  : 'open',
            }
          : item
      )
    );
  };

  return (
    <Card>
      <SectionHeader title="Operator Notes & Action Items" icon="edit_note" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px', fontWeight: '600' }}>
            Add Note
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="Add a note..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addNote()}
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: C.cardAlt,
                border: `1px solid ${C.border}`,
                borderRadius: '4px',
                color: C.text,
                fontSize: '13px',
              }}
            />
            <button
              onClick={addNote}
              style={{
                padding: '8px 12px',
                backgroundColor: C.accent,
                border: 'none',
                borderRadius: '4px',
                color: C.bg,
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '13px',
              }}
            >
              Add
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {[...fetchedNotes, ...notes].slice(-5).map((note: any) => (
              <div
                key={note.id}
                style={{
                  padding: '8px',
                  backgroundColor: C.bg,
                  borderLeft: `3px solid ${C.accent}`,
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                <div style={{ color: C.text, marginBottom: '4px' }}>{note.text}</div>
                <div style={{ color: C.muted, fontSize: '11px' }}>
                  {new Date(note.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px', fontWeight: '600' }}>
            Action Items
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="New action item..."
              value={newActionItem}
              onChange={(e) => setNewActionItem(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addActionItem()}
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: C.cardAlt,
                border: `1px solid ${C.border}`,
                borderRadius: '4px',
                color: C.text,
                fontSize: '13px',
              }}
            />
            <button
              onClick={addActionItem}
              style={{
                padding: '8px 12px',
                backgroundColor: C.green,
                border: 'none',
                borderRadius: '4px',
                color: C.bg,
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '13px',
              }}
            >
              Add
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {actionItems.map((item) => (
              <button
                key={item.id}
                onClick={() => toggleActionStatus(item.id)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: C.bg,
                  border: `1px solid ${
                    item.status === 'open'
                      ? C.yellow
                      : item.status === 'in-progress'
                      ? C.blue
                      : C.green
                  }`,
                  borderRadius: '4px',
                  color: C.text,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '16px',
                    color:
                      item.status === 'open'
                        ? C.yellow
                        : item.status === 'in-progress'
                        ? C.blue
                        : C.green,
                  }}
                >
                  {item.status === 'open'
                    ? 'pending'
                    : item.status === 'in-progress'
                    ? 'schedule'
                    : 'check_circle'}
                </span>
                <span style={{ flex: 1 }}>{item.title}</span>
                <Badge
                  variant={
                    item.status === 'open'
                      ? 'warning'
                      : item.status === 'in-progress'
                      ? 'info'
                      : 'success'
                  }
                >
                  {item.status}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

// Main Page Component
export default function DecisionExplainabilityPage() {
  return (
    <div
      style={{
        backgroundColor: C.bg,
        color: C.text,
        minHeight: '100vh',
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1
            style={{
              margin: '0 0 8px 0',
              fontSize: '32px',
              fontWeight: '700',
              color: C.text,
            }}
          >
            Decision Explainability & Replay
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '14px',
              color: C.muted,
            }}
          >
            Gold Standard dashboard for trade decision analysis, replay, and post-mortems
          </p>
        </div>

        {/* Decision Packet Explorer */}
        <DecisionPacketExplorer />

        {/* Replay Console & Post-Mortem */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr',
            gap: '20px',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: '16px' }}>
            <ReplayConsole />
          </div>
          <PostMortemCenter />
        </div>

        {/* Expected vs Actual & Operator Notes */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
          }}
        >
          <ExpectedVsActual />
          <OperatorNotesCenter />
        </div>
      </div>
    </div>
  );
}
