import React, { useState, useEffect } from 'react';

type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type SessionStatus = 'RUNNING' | 'EVALUATING' | 'PROMOTED' | 'REJECTED';
type PromotionTier = 'SEED' | 'LEARNING' | 'PROVEN' | 'PAPER' | 'SHADOW' | 'ASSISTED' | 'AUTONOMOUS' | 'ELITE';
type PassFail = 'PASS' | 'FAIL';

interface CalibrationMetric {
  name: string;
  expected: number;
  actual: number;
  ratio: number;
  trend: 'up' | 'down' | 'neutral';
}

interface DriftAlert {
  metric: string;
  current: number;
  threshold: number;
  severity: AlertSeverity;
  detectedAt: string;
}

interface ShadowSession {
  strategyName: string;
  startDate: string;
  daysActive: number;
  shadowSharpe: number;
  shadowDD: number;
  promotionReadiness: number;
  status: SessionStatus;
}

interface PromotionCriterion {
  name: string;
  required: number;
  actual: number;
  result: PassFail;
}

interface PromotionScorecard {
  criteria: PromotionCriterion[];
  recommendation: 'PROMOTE' | 'EXTEND' | 'REJECT';
}

interface TierCount {
  tier: PromotionTier;
  count: number;
}

interface PromotionHistoryEntry {
  timestamp: string;
  strategyName: string;
  decision: 'PROMOTE' | 'REJECT' | 'EXTEND';
  reason: string;
}

interface CalibrationData {
  score: number;
  metrics: CalibrationMetric[];
  driftAlerts: DriftAlert[];
  shadowSessions: ShadowSession[];
  tierCounts: TierCount[];
  history: PromotionHistoryEntry[];
}

export default function CalibrationDashboard() {
  const [data, setData] = useState<CalibrationData | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<PromotionScorecard | null>(null);
  const [expandedTier, setExpandedTier] = useState<PromotionTier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const calibRes = await fetch('/api/trust/calibration');
        
        if (!calibRes.ok) {
          throw new Error('Failed to fetch calibration data');
        }
        
        const calibData = await calibRes.json();
        setData(calibData);

        if (calibData.shadowSessions.length > 0) {
          const firstSessionName = calibData.shadowSessions[0].strategyName;
          setSelectedSession(firstSessionName);
          await fetchScorecard(firstSessionName);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const fetchScorecard = async (sessionName: string) => {
    try {
      const res = await fetch(`/api/trust/shadow/${sessionName}/scorecard`);
      if (res.ok) {
        const scorecardData = await res.json();
        setScorecard(scorecardData);
      }
    } catch (err) {
      console.error('Failed to fetch scorecard:', err);
    }
  };

  const handleSessionSelect = async (sessionName: string) => {
    setSelectedSession(sessionName);
    await fetchScorecard(sessionName);
  };

  const getScoreColor = (score: number): string => {
    if (score > 80) return '#9cff93';
    if (score > 50) return '#f0e442';
    return '#ff7162';
  };

  const getSeverityColor = (severity: AlertSeverity): string => {
    switch (severity) {
      case 'LOW': return '#f0e442';
      case 'MEDIUM': return '#f0e442';
      case 'HIGH': return '#ff7162';
      case 'CRITICAL': return '#ff7162';
      default: return '#484849';
    }
  };

  const getStatusColor = (status: SessionStatus): string => {
    switch (status) {
      case 'RUNNING': return '#93c5fd';
      case 'EVALUATING': return '#f0e442';
      case 'PROMOTED': return '#9cff93';
      case 'REJECTED': return '#ff7162';
      default: return '#484849';
    }
  };

  const getTrendIcon = (trend: 'up' | 'down' | 'neutral'): string => {
    switch (trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      case 'neutral': return '→';
      default: return '';
    }
  };

  if (loading) {
    return (
      <div style={{
        backgroundColor: '#1a191b',
        color: '#fff',
        padding: '40px',
        minHeight: '100vh',
        fontFamily: 'Space Grotesk, sans-serif'
      }}>
        <p>Loading calibration data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        backgroundColor: '#1a191b',
        color: '#ff7162',
        padding: '40px',
        minHeight: '100vh',
        fontFamily: 'Space Grotesk, sans-serif'
      }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#1a191b',
      color: '#fff',
      padding: '40px',
      minHeight: '100vh',
      fontFamily: 'Space Grotesk, sans-serif'
    }}>
      {/* Header */}
      <h1 style={{
        fontSize: '28px',
        fontWeight: 700,
        margin: '0 0 40px 0',
        borderBottom: '1px solid rgba(72,72,73,0.15)',
        paddingBottom: '20px'
      }}>
        Calibration & Shadow Mode Dashboard
      </h1>

      {/* Calibration Score Gauge */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '40px'
      }}>
        <div style={{
          position: 'relative',
          width: '240px',
          height: '240px',
          borderRadius: '50%',
          backgroundColor: 'rgba(72,72,73,0.05)',
          border: `8px solid ${getScoreColor(data?.score || 50)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column'
        }}>
          <p style={{
            fontSize: '9px',
            fontWeight: 700,
            color: '#484849',
            margin: '0 0 8px 0',
            letterSpacing: '0.15em',
            textTransform: 'uppercase'
          }}>
            Calibration Score
          </p>
          <p style={{
            fontSize: '72px',
            fontWeight: 700,
            color: getScoreColor(data?.score || 50),
            margin: '0'
          }}>
            {data?.score}
          </p>
          <p style={{
            fontSize: '9px',
            color: '#484849',
            margin: '8px 0 0 0',
            letterSpacing: '0.15em',
            textTransform: 'uppercase'
          }}>
            / 100
          </p>
        </div>
      </div>

      {/* Calibration Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px',
        marginBottom: '40px'
      }}>
        {data?.metrics.map((metric) => (
          <div
            key={metric.name}
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              padding: '16px',
              borderRadius: '8px'
            }}
          >
            <p style={{
              fontSize: '9px',
              fontWeight: 700,
              color: '#484849',
              margin: '0 0 16px 0',
              letterSpacing: '0.15em',
              textTransform: 'uppercase'
            }}>
              {metric.name}
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginBottom: '16px'
            }}>
              <div>
                <p style={{
                  fontSize: '8px',
                  color: '#484849',
                  margin: '0 0 4px 0',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase'
                }}>
                  Expected
                </p>
                <p style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#93c5fd',
                  margin: 0,
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  {metric.expected.toFixed(2)}
                </p>
              </div>
              <div>
                <p style={{
                  fontSize: '8px',
                  color: '#484849',
                  margin: '0 0 4px 0',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase'
                }}>
                  Actual
                </p>
                <p style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#fff',
                  margin: 0,
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  {metric.actual.toFixed(2)}
                </p>
              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <p style={{
                fontSize: '9px',
                color: '#484849',
                margin: 0,
                letterSpacing: '0.15em',
                textTransform: 'uppercase'
              }}>
                Ratio
              </p>
              <div style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                <p style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: '#fff',
                  margin: 0,
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  {metric.ratio.toFixed(2)}x
                </p>
                <p style={{
                  fontSize: '12px',
                  color: metric.trend === 'up' ? '#9cff93' : metric.trend === 'down' ? '#ff7162' : '#f0e442',
                  margin: 0,
                  fontWeight: 700
                }}>
                  {getTrendIcon(metric.trend)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Drift Alerts */}
      {data?.driftAlerts && data.driftAlerts.length > 0 && (
        <div style={{
          marginBottom: '40px'
        }}>
          <h2 style={{
            fontSize: '14px',
            fontWeight: 700,
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: '#484849'
          }}>
            Drift Alerts
          </h2>
          <div style={{
            display: 'grid',
            gap: '12px'
          }}>
            {data.driftAlerts.map((alert, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#1a191b',
                  border: `1px solid ${getSeverityColor(alert.severity)}`,
                  padding: '12px 16px',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <span style={{
                    backgroundColor: `${getSeverityColor(alert.severity)}20`,
                    color: getSeverityColor(alert.severity),
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '8px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em'
                  }}>
                    {alert.severity}
                  </span>
                  <div>
                    <p style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#fff',
                      margin: 0
                    }}>
                      {alert.metric}
                    </p>
                    <p style={{
                      fontSize: '9px',
                      color: '#484849',
                      margin: '2px 0 0 0'
                    }}>
                      {alert.detectedAt}
                    </p>
                  </div>
                </div>
                <div style={{
                  textAlign: 'right'
                }}>
                  <p style={{
                    fontSize: '11px',
                    color: '#ff7162',
                    margin: 0,
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700
                  }}>
                    {alert.current.toFixed(2)} / {alert.threshold.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shadow Mode Sessions */}
      <div style={{
        marginBottom: '40px'
      }}>
        <h2 style={{
          fontSize: '14px',
          fontWeight: 700,
          margin: '0 0 16px 0',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          color: '#484849'
        }}>
          Shadow Mode Sessions
        </h2>
        <div style={{
          overflowX: 'auto',
          border: '1px solid rgba(72,72,73,0.15)',
          borderRadius: '8px'
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: '12px'
          }}>
            <thead>
              <tr style={{
                borderBottom: '1px solid rgba(72,72,73,0.15)',
                backgroundColor: 'rgba(72,72,73,0.05)'
              }}>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Strategy Name</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Start Date</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Days Active</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Shadow Sharpe</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Shadow DD</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Readiness</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'center',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.shadowSessions.map((session, idx) => (
                <tr
                  key={idx}
                  onClick={() => handleSessionSelect(session.strategyName)}
                  style={{
                    backgroundColor: selectedSession === session.strategyName ? 'rgba(156,255,147,0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(72,72,73,0.15)',
                    cursor: 'pointer'
                  }}
                >
                  <td style={{
                    padding: '12px 16px',
                    color: selectedSession === session.strategyName ? '#9cff93' : '#fff',
                    fontWeight: selectedSession === session.strategyName ? 700 : 400
                  }}>
                    {session.strategyName}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    color: '#fff',
                    fontSize: '11px'
                  }}>
                    {session.startDate}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#fff'
                  }}>
                    {session.daysActive}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#93c5fd'
                  }}>
                    {session.shadowSharpe.toFixed(2)}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: session.shadowDD < 0 ? '#ff7162' : '#fff'
                  }}>
                    {session.shadowDD.toFixed(2)}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    color: getScoreColor(session.promotionReadiness)
                  }}>
                    <span style={{
                      backgroundColor: `${getScoreColor(session.promotionReadiness)}20`,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      fontFamily: 'JetBrains Mono, monospace'
                    }}>
                      {session.promotionReadiness}%
                    </span>
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'center'
                  }}>
                    <span style={{
                      backgroundColor: `${getStatusColor(session.status)}20`,
                      color: getStatusColor(session.status),
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '8px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.15em'
                    }}>
                      {session.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promotion Scorecard */}
      {selectedSession && scorecard && (
        <div style={{
          marginBottom: '40px'
        }}>
          <h2 style={{
            fontSize: '14px',
            fontWeight: 700,
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: '#484849'
          }}>
            Promotion Scorecard: {selectedSession}
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '16px'
          }}>
            {scorecard.criteria.map((criterion, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#1a191b',
                  border: `1px solid ${criterion.result === 'PASS' ? '#9cff93' : '#ff7162'}`,
                  padding: '16px',
                  borderRadius: '8px'
                }}
              >
                <p style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: '#484849',
                  margin: '0 0 12px 0',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase'
                }}>
                  {criterion.name}
                </p>

                <div style={{
                  display: 'grid',
                  gap: '8px',
                  marginBottom: '12px'
                }}>
                  <div>
                    <p style={{
                      fontSize: '8px',
                      color: '#484849',
                      margin: '0 0 2px 0',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase'
                    }}>
                      Required
                    </p>
                    <p style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#fff',
                      margin: 0,
                      fontFamily: 'JetBrains Mono, monospace'
                    }}>
                      {criterion.required.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p style={{
                      fontSize: '8px',
                      color: '#484849',
                      margin: '0 0 2px 0',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase'
                    }}>
                      Actual
                    </p>
                    <p style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: criterion.result === 'PASS' ? '#9cff93' : '#ff7162',
                      margin: 0,
                      fontFamily: 'JetBrains Mono, monospace'
                    }}>
                      {criterion.actual.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div style={{
                  backgroundColor: criterion.result === 'PASS' ? 'rgba(156,255,147,0.2)' : 'rgba(255,113,98,0.2)',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <p style={{
                    fontSize: '9px',
                    color: criterion.result === 'PASS' ? '#9cff93' : '#ff7162',
                    margin: 0,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em'
                  }}>
                    {criterion.result}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            backgroundColor: '#1a191b',
            border: `2px solid ${scorecard.recommendation === 'PROMOTE' ? '#9cff93' : scorecard.recommendation === 'REJECT' ? '#ff7162' : '#f0e442'}`,
            padding: '16px',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <p style={{
              fontSize: '9px',
              fontWeight: 700,
              color: '#484849',
              margin: '0 0 12px 0',
              letterSpacing: '0.15em',
              textTransform: 'uppercase'
            }}>
              Recommendation
            </p>
            <p style={{
              fontSize: '24px',
              fontWeight: 700,
              color: scorecard.recommendation === 'PROMOTE' ? '#9cff93' : scorecard.recommendation === 'REJECT' ? '#ff7162' : '#f0e442',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.15em'
            }}>
              {scorecard.recommendation}
            </p>
          </div>
        </div>
      )}

      {/* Promotion Pipeline */}
      <div style={{
        marginBottom: '40px'
      }}>
        <h2 style={{
          fontSize: '14px',
          fontWeight: 700,
          margin: '0 0 24px 0',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          color: '#484849'
        }}>
          Promotion Pipeline
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '12px'
        }}>
          {data?.tierCounts.map((tierData) => (
            <div
              key={tierData.tier}
              onClick={() => setExpandedTier(expandedTier === tierData.tier ? null : tierData.tier)}
              style={{
                backgroundColor: '#1a191b',
                border: '1px solid rgba(72,72,73,0.15)',
                padding: '16px',
                borderRadius: '8px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                transform: expandedTier === tierData.tier ? 'scale(1.02)' : 'scale(1)'
              }}
            >
              <p style={{
                fontSize: '9px',
                fontWeight: 700,
                color: '#484849',
                margin: '0 0 8px 0',
                letterSpacing: '0.15em',
                textTransform: 'uppercase'
              }}>
                {tierData.tier}
              </p>
              <p style={{
                fontSize: '32px',
                fontWeight: 700,
                color: '#93c5fd',
                margin: 0
              }}>
                {tierData.count}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Promotion History */}
      <div>
        <h2 style={{
          fontSize: '14px',
          fontWeight: 700,
          margin: '0 0 16px 0',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          color: '#484849'
        }}>
          Promotion History
        </h2>
        <div style={{
          display: 'grid',
          gap: '12px'
        }}>
          {data?.history.slice(0, 10).map((entry, idx) => {
            const decisionColor = entry.decision === 'PROMOTE' ? '#9cff93' : entry.decision === 'REJECT' ? '#ff7162' : '#f0e442';
            return (
              <div
                key={idx}
                style={{
                  backgroundColor: '#1a191b',
                  border: `1px solid ${decisionColor}20`,
                  padding: '12px 16px',
                  borderRadius: '8px',
                  borderLeft: `3px solid ${decisionColor}`
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <div>
                    <p style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#fff',
                      margin: 0
                    }}>
                      {entry.strategyName}
                    </p>
                    <p style={{
                      fontSize: '9px',
                      color: '#484849',
                      margin: '4px 0 0 0'
                    }}>
                      {entry.timestamp}
                    </p>
                  </div>
                  <span style={{
                    backgroundColor: `${decisionColor}20`,
                    color: decisionColor,
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '8px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em'
                  }}>
                    {entry.decision}
                  </span>
                </div>
                <p style={{
                  fontSize: '10px',
                  color: '#93c5fd',
                  margin: 0,
                  fontStyle: 'italic'
                }}>
                  {entry.reason}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
