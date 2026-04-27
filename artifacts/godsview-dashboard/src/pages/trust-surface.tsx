import React, { useState, useEffect } from 'react';
import { toArray } from "@/lib/safe";

interface Strategy {
  id: string;
  name: string;
  summary: string;
  type: string;
}

interface Interpretation {
  text: string;
  confidence: number;
  alternatives: {
    text: string;
    reason_lost: string;
  }[];
}

interface EdgeAnalysis {
  causal_mechanism: string;
  persistence_estimate: number;
  capacity_estimate: number;
  confidence: number;
}

interface Critique {
  grade: string;
  strengths: string[];
  weaknesses: string[];
  deal_breakers?: string[];
}

interface KPI {
  name: string;
  value: number;
  status: 'good' | 'marginal' | 'bad';
  label: string;
}

interface Fragility {
  worst_regime: string;
  breaking_point: string;
  parameter_sensitivity: number;
}

interface ShadowStatus {
  is_active: boolean;
  days_remaining?: number;
  performance_vs_expectations?: number;
  promotion_readiness?: number;
}

interface TrustView {
  strategy: Strategy;
  trust_score: number;
  interpretation: Interpretation;
  edge_analysis: EdgeAnalysis;
  critique: Critique;
  backtest_kpis: KPI[];
  fragility: Fragility;
  shadow_status: ShadowStatus;
  calibration_score: number;
  decision: 'GO' | 'NO-GO';
  decision_confidence: number;
  decision_reasoning: string;
  next_action: {
    title: string;
    priority: 'high' | 'medium' | 'low';
    effort_hours: number;
  };
}

export default function TrustSurfaceDashboard() {
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [trustView, setTrustView] = useState<TrustView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        const response = await fetch('/api/strategies');
        const data = await response.json();
        setStrategies(data);
        if (data.length > 0) {
          setSelectedStrategyId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to fetch strategies:', error);
      }
    };

    fetchStrategies();
  }, []);

  useEffect(() => {
    if (!selectedStrategyId) return;

    const fetchTrustView = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/trust/view/${selectedStrategyId}`);
        const data = await response.json();
        setTrustView(data);
      } catch (error) {
        console.error('Failed to fetch trust view:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTrustView();
  }, [selectedStrategyId]);

  const getTrustColor = (score: number) => {
    if (score >= 70) return '#9cff93';
    if (score >= 40) return '#f0e442';
    return '#ff7162';
  };

  const getTrustLabel = (score: number) => {
    if (score >= 70) return 'GO';
    if (score >= 40) return 'CAUTION';
    return 'NO-GO';
  };

  const getKPIColor = (status: string) => {
    switch (status) {
      case 'good':
        return '#9cff93';
      case 'marginal':
        return '#f0e442';
      case 'bad':
        return '#ff7162';
      default:
        return '#484849';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return '#ff7162';
      case 'medium':
        return '#f0e442';
      case 'low':
        return '#93c5fd';
      default:
        return '#484849';
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#1a191b',
        color: '#ffffff',
        minHeight: '100vh',
        padding: '24px',
        fontFamily: '"JetBrains Mono", monospace',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1
          style={{
            fontSize: '28px',
            fontWeight: 700,
            marginBottom: '8px',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '0.05em',
          }}
        >
          Operator Trust Surface
        </h1>
        <p
          style={{
            fontSize: '13px',
            color: '#484849',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          Phase 88 Strategy Transparency View
        </p>
      </div>

      {/* Strategy Selector */}
      <div
        style={{
          backgroundColor: '#1a191b',
          border: '1px solid rgba(72,72,73,0.15)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: '9px',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#484849',
            marginBottom: '8px',
          }}
        >
          Select Strategy
        </label>
        <select
          value={selectedStrategyId}
          onChange={(e) => setSelectedStrategyId(e.target.value)}
          style={{
            width: '100%',
            backgroundColor: 'rgba(72,72,73,0.08)',
            border: '1px solid rgba(72,72,73,0.15)',
            borderRadius: '4px',
            color: '#ffffff',
            padding: '10px 12px',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <option value="">-- Choose a strategy --</option>
          {toArray<Strategy>(strategies).map((strategy: any) => (
            <option key={strategy?.id} value={strategy?.id}>
              {strategy?.name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            fontSize: '14px',
            color: '#484849',
          }}
        >
          Loading trust surface...
        </div>
      )}

      {trustView && (
        <>
          {/* Traffic Light */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
              marginBottom: '32px',
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '24px',
            }}
          >
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                backgroundColor: getTrustColor(trustView.trust_score),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color:
                    trustView.trust_score >= 70
                      ? '#1a191b'
                      : trustView.trust_score >= 40
                      ? '#1a191b'
                      : '#1a191b',
                  textAlign: 'center',
                }}
              >
                {Math.round(trustView.trust_score)}
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: getTrustColor(trustView.trust_score),
                  marginBottom: '8px',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {getTrustLabel(trustView.trust_score)}
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: '#ffffff',
                  marginBottom: '12px',
                  lineHeight: '1.6',
                }}
              >
                Overall operator confidence assessment based on strategy quality,
                backtest performance, and risk analysis.
              </div>
              <div
                style={{
                  fontSize: '9px',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: '#484849',
                }}
              >
                Trust Score
              </div>
            </div>
          </div>

          {/* Strategy Card */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Strategy Overview
            </label>

            <div
              style={{
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#ffffff',
                  marginBottom: '8px',
                }}
              >
                {trustView.strategy.name}
              </div>
              <div
                style={{
                  display: 'inline-block',
                  backgroundColor: '#93c5fd',
                  color: '#1a191b',
                  padding: '4px 8px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 700,
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {trustView.strategy.type}
              </div>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: '#ffffff',
                lineHeight: '1.6',
              }}
            >
              {trustView.strategy.summary}
            </div>
          </div>

          {/* Interpretation Winner */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Interpretation Winner
            </label>

            <div
              style={{
                backgroundColor: 'rgba(156,255,147,0.1)',
                border: '1px solid #9cff93',
                borderRadius: '4px',
                padding: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  color: '#9cff93',
                  fontWeight: 700,
                  marginBottom: '4px',
                }}
              >
                {trustView.interpretation.text}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#484849',
                }}
              >
                Confidence: {Math.round(trustView.interpretation.confidence * 100)}%
              </div>
            </div>

            {trustView.interpretation.alternatives.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                    marginBottom: '8px',
                  }}
                >
                  Alternatives
                </div>
                {trustView.interpretation.alternatives.map((alt, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: 'rgba(72,72,73,0.08)',
                      border: '1px solid rgba(72,72,73,0.15)',
                      borderRadius: '4px',
                      padding: '10px',
                      marginBottom: '8px',
                      opacity: 0.7,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#ffffff',
                        marginBottom: '4px',
                      }}
                    >
                      {alt.text}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#ff7162',
                      }}
                    >
                      Why it lost: {alt.reason_lost}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edge Analysis */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Edge Analysis
            </label>

            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  fontSize: '9px',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: '#484849',
                  marginBottom: '4px',
                }}
              >
                Causal Mechanism
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: '#ffffff',
                }}
              >
                {trustView.edge_analysis.causal_mechanism}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  backgroundColor: 'rgba(72,72,73,0.08)',
                  border: '1px solid rgba(72,72,73,0.15)',
                  borderRadius: '4px',
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                    marginBottom: '6px',
                  }}
                >
                  Persistence Estimate
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#93c5fd',
                  }}
                >
                  {Math.round(trustView.edge_analysis.persistence_estimate * 100)}%
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(72,72,73,0.08)',
                  border: '1px solid rgba(72,72,73,0.15)',
                  borderRadius: '4px',
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                    marginBottom: '6px',
                  }}
                >
                  Capacity Estimate
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#93c5fd',
                  }}
                >
                  {Math.round(trustView.edge_analysis.capacity_estimate)}M
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(72,72,73,0.08)',
                  border: '1px solid rgba(72,72,73,0.15)',
                  borderRadius: '4px',
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                    marginBottom: '6px',
                  }}
                >
                  Confidence
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#f0e442',
                  }}
                >
                  {Math.round(trustView.edge_analysis.confidence * 100)}%
                </div>
              </div>
            </div>

            <div>
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: 'rgba(72,72,73,0.15)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${trustView.edge_analysis.confidence * 100}%`,
                    backgroundColor: '#93c5fd',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Critique */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Critique
            </label>

            <div
              style={{
                display: 'inline-block',
                backgroundColor: '#93c5fd',
                color: '#1a191b',
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '18px',
                fontWeight: 700,
                marginBottom: '16px',
                fontFamily: '"Space Grotesk", sans-serif',
              }}
            >
              Grade {trustView.critique.grade}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
                marginBottom: '16px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                    marginBottom: '8px',
                  }}
                >
                  Strengths
                </div>
                {trustView.critique.strengths.map((strength, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: '12px',
                      color: '#9cff93',
                      marginBottom: '6px',
                      display: 'flex',
                      gap: '8px',
                    }}
                  >
                    <span>+</span>
                    <span>{strength}</span>
                  </div>
                ))}
              </div>

              <div>
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                    marginBottom: '8px',
                  }}
                >
                  Weaknesses
                </div>
                {trustView.critique.weaknesses.map((weakness, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: '12px',
                      color: '#ff7162',
                      marginBottom: '6px',
                      display: 'flex',
                      gap: '8px',
                    }}
                  >
                    <span>-</span>
                    <span>{weakness}</span>
                  </div>
                ))}
              </div>
            </div>

            {trustView.critique.deal_breakers &&
              trustView.critique.deal_breakers.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'rgba(255,113,98,0.1)',
                    border: '1px solid #ff7162',
                    borderRadius: '4px',
                    padding: '12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '9px',
                      fontFamily: '"Space Grotesk", sans-serif',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: '#ff7162',
                      marginBottom: '8px',
                      fontWeight: 700,
                    }}
                  >
                    Deal Breakers
                  </div>
                  {trustView.critique.deal_breakers.map((breaker, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: '12px',
                        color: '#ff7162',
                        marginBottom: '4px',
                      }}
                    >
                      {breaker}
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Backtest Highlights */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Backtest Highlights
            </label>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '12px',
              }}
            >
              {trustView.backtest_kpis.map((kpi) => (
                <div
                  key={kpi.name}
                  style={{
                    backgroundColor: 'rgba(72,72,73,0.08)',
                    border: `1px solid ${getKPIColor(kpi.status)}`,
                    borderRadius: '4px',
                    padding: '12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '9px',
                      fontFamily: '"Space Grotesk", sans-serif',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: '#484849',
                      marginBottom: '6px',
                    }}
                  >
                    {kpi.name}
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: getKPIColor(kpi.status),
                      marginBottom: '4px',
                    }}
                  >
                    {kpi.value.toFixed(2)}
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: getKPIColor(kpi.status),
                    }}
                  >
                    {kpi.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fragility */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Fragility Analysis
            </label>

            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  fontSize: '9px',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: '#484849',
                  marginBottom: '4px',
                }}
              >
                Worst Regime
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: '#ff7162',
                }}
              >
                {trustView.fragility.worst_regime}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  fontSize: '9px',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: '#484849',
                  marginBottom: '4px',
                }}
              >
                Breaking Point
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: '#ffffff',
                }}
              >
                {trustView.fragility.breaking_point}
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: '9px',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: '#484849',
                  marginBottom: '6px',
                }}
              >
                Parameter Sensitivity
              </div>
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: 'rgba(72,72,73,0.15)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  marginBottom: '4px',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${trustView.fragility.parameter_sensitivity}%`,
                    backgroundColor:
                      trustView.fragility.parameter_sensitivity > 70
                        ? '#ff7162'
                        : trustView.fragility.parameter_sensitivity > 40
                        ? '#f0e442'
                        : '#9cff93',
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: '#484849',
                }}
              >
                {Math.round(trustView.fragility.parameter_sensitivity)}% sensitive
              </div>
            </div>
          </div>

          {/* Shadow Status */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Shadow Mode Status
            </label>

            {trustView.shadow_status.is_active ? (
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'rgba(156,255,147,0.1)',
                      border: '1px solid #9cff93',
                      borderRadius: '4px',
                      padding: '12px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '9px',
                        fontFamily: '"Space Grotesk", sans-serif',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: '#484849',
                        marginBottom: '6px',
                      }}
                    >
                      Days Remaining
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#9cff93',
                      }}
                    >
                      {trustView.shadow_status.days_remaining}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'rgba(147,197,253,0.1)',
                      border: '1px solid #93c5fd',
                      borderRadius: '4px',
                      padding: '12px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '9px',
                        fontFamily: '"Space Grotesk", sans-serif',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: '#484849',
                        marginBottom: '6px',
                      }}
                    >
                      Performance vs Expectations
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#93c5fd',
                      }}
                    >
                      {trustView.shadow_status.performance_vs_expectations && Math.round(trustView.shadow_status.performance_vs_expectations * 100)}%
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'rgba(240,228,66,0.1)',
                      border: '1px solid #f0e442',
                      borderRadius: '4px',
                      padding: '12px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '9px',
                        fontFamily: '"Space Grotesk", sans-serif',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: '#484849',
                        marginBottom: '6px',
                      }}
                    >
                      Promotion Readiness
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#f0e442',
                      }}
                    >
                      {trustView.shadow_status.promotion_readiness && Math.round(trustView.shadow_status.promotion_readiness * 100)}%
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: 'rgba(72,72,73,0.08)',
                  border: '1px solid rgba(72,72,73,0.15)',
                  borderRadius: '4px',
                  padding: '12px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '13px',
                    color: '#484849',
                  }}
                >
                  Not in shadow mode
                </div>
              </div>
            )}
          </div>

          {/* Calibration Score */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Calibration Score
            </label>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: getTrustColor(trustView.calibration_score),
                }}
              >
                {Math.round(trustView.calibration_score)}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: 'rgba(72,72,73,0.15)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '8px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${trustView.calibration_score}%`,
                      backgroundColor: getTrustColor(trustView.calibration_score),
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: '9px',
                    fontFamily: '"Space Grotesk", sans-serif',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: '#484849',
                  }}
                >
                  Decision alignment with outcomes
                </div>
              </div>
            </div>
          </div>

          {/* GO / NO-GO */}
          <div
            style={{
              backgroundColor:
                trustView.decision === 'GO'
                  ? 'rgba(156,255,147,0.1)'
                  : 'rgba(255,113,98,0.1)',
              border:
                trustView.decision === 'GO'
                  ? '1px solid #9cff93'
                  : '1px solid #ff7162',
              borderRadius: '8px',
              padding: '24px',
              marginBottom: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color:
                    trustView.decision === 'GO' ? '#9cff93' : '#ff7162',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {trustView.decision}
              </div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#f0e442',
                }}
              >
                {Math.round(trustView.decision_confidence * 100)}% confidence
              </div>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: '#ffffff',
                lineHeight: '1.6',
              }}
            >
              {trustView.decision_reasoning}
            </div>
          </div>

          {/* Next Action */}
          <div
            style={{
              backgroundColor: '#1a191b',
              border: '1px solid rgba(72,72,73,0.15)',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '9px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#484849',
                marginBottom: '12px',
              }}
            >
              Next Action
            </label>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '16px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    marginBottom: '8px',
                  }}
                >
                  {trustView.next_action.title}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#484849',
                  }}
                >
                  Estimated {trustView.next_action.effort_hours}h effort
                </div>
              </div>

              <div
                style={{
                  backgroundColor: getPriorityColor(trustView.next_action.priority),
                  color: '#1a191b',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '9px',
                  fontWeight: 700,
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {trustView.next_action.priority}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}