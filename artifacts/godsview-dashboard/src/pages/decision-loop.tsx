import React, { useState, useEffect } from 'react';

interface PipelineStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  duration_ms: number;
  confidence: number;
}

interface Interpretation {
  id: string;
  text: string;
  confidence: number;
  is_winner: boolean;
  contradictions?: string[];
}

interface ScreenResult {
  decision: 'PASS' | 'SOFT_REJECT' | 'HARD_REJECT';
  reasoning: string;
}

interface CritiqueGrade {
  overall: string;
  clarity: string;
  feasibility: string;
  risk: string;
  strengths: string[];
  weaknesses: string[];
}

interface Variant {
  id: string;
  name: string;
  robustness_score: number;
  key_difference: string;
  is_best: boolean;
}

interface Recommendation {
  decision: 'DEPLOY' | 'PAPER_TRADE' | 'REJECT' | 'ITERATE';
  confidence: number;
  reasoning: string;
}

interface PipelineStatus {
  id: string;
  strategy_input: string;
  steps: PipelineStep[];
  interpretations: Interpretation[];
  screen_result: ScreenResult;
  critique: CritiqueGrade;
  variants: Variant[];
  recommendation: Recommendation;
  is_complete: boolean;
}

const PIPELINE_STEPS = [
  'INTAKE',
  'MEMORY',
  'PARSE',
  'SCREEN',
  'CRITIQUE',
  'VARIANTS',
  'BACKTEST',
  'ANALYSIS',
  'RANKING',
  'IMPROVE',
  'EXPLAIN',
  'GATE',
  'LEARN',
  'RECOMMEND',
];

export default function DecisionLoopDashboard() {
  const [strategyInput, setStrategyInput] = useState('');
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);

  const handleRunPipeline = async () => {
    if (!strategyInput.trim()) return;

    setIsRunning(true);
    try {
      const response = await fetch('/api/decision-loop/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_input: strategyInput }),
      });

      const data = await response.json();
      setPipelineStatus(data);

      if (!data.is_complete) {
        const interval = setInterval(async () => {
          const statusResponse = await fetch(
            `/api/decision-loop/status/${data.id}`
          );
          const statusData = await statusResponse.json();
          setPipelineStatus(statusData);

          if (statusData.is_complete) {
            clearInterval(interval);
            setIsRunning(false);
          }
        }, 1000);

        setPollInterval(interval);
      } else {
        setIsRunning(false);
      }
    } catch (error) {
      console.error('Pipeline error:', error);
      setIsRunning(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return '#9cff93';
      case 'running':
        return '#93c5fd';
      case 'failed':
        return '#ff7162';
      default:
        return '#484849';
    }
  };

  const getStepProgress = () => {
    if (!pipelineStatus) return 0;
    const completed = pipelineStatus.steps.filter(
      (s) => s.status === 'done'
    ).length;
    return (completed / pipelineStatus.steps.length) * 100;
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
          Decision Loop Pipeline
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
          Phase 87 Strategy Intake & Evaluation
        </p>
      </div>

      {/* Strategy Input Section */}
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
          Strategy Input
        </label>
        <textarea
          value={strategyInput}
          onChange={(e) => setStrategyInput(e.target.value)}
          placeholder="Describe your trading strategy idea here..."
          style={{
            width: '100%',
            minHeight: '120px',
            backgroundColor: 'rgba(72,72,73,0.08)',
            border: '1px solid rgba(72,72,73,0.15)',
            borderRadius: '4px',
            color: '#ffffff',
            padding: '12px',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '13px',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleRunPipeline}
          disabled={isRunning || !strategyInput.trim()}
          style={{
            marginTop: '12px',
            backgroundColor: isRunning ? '#484849' : '#9cff93',
            color: isRunning ? '#484849' : '#1a191b',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: '"Space Grotesk", sans-serif',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {isRunning ? 'Running Pipeline...' : 'Run Pipeline'}
        </button>
      </div>

      {pipelineStatus && (
        <>
          {/* Pipeline Progress */}
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
                marginBottom: '16px',
              }}
            >
              Pipeline Progress
            </label>

            {/* Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '4px',
                backgroundColor: 'rgba(72,72,73,0.15)',
                borderRadius: '2px',
                marginBottom: '16px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${getStepProgress()}%`,
                  backgroundColor: '#9cff93',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            {/* Steps Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '12px',
              }}
            >
              {pipelineStatus.steps.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: 'rgba(72,72,73,0.08)',
                    border: `1px solid ${
                      step.status === 'failed'
                        ? '#ff7162'
                        : step.status === 'done'
                        ? '#9cff93'
                        : 'rgba(72,72,73,0.15)'
                    }`,
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
                    {PIPELINE_STEPS[idx]}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: '6px',
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: getStatusColor(step.status),
                        animation:
                          step.status === 'running'
                            ? 'pulse 1.5s infinite'
                            : 'none',
                      }}
                    />
                    <span
                      style={{
                        fontSize: '11px',
                        color:
                          step.status === 'running'
                            ? '#93c5fd'
                            : step.status === 'done'
                            ? '#9cff93'
                            : step.status === 'failed'
                            ? '#ff7162'
                            : '#484849',
                        textTransform: 'capitalize',
                      }}
                    >
                      {step.status}
                    </span>
                  </div>
                  {step.duration_ms > 0 && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#484849',
                        marginBottom: '4px',
                      }}
                    >
                      {step.duration_ms}ms
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#f0e442',
                    }}
                  >
                    {Math.round(step.confidence * 100)}%
                  </div>
                </div>
              ))}
            </div>

            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
              }
            `}</style>
          </div>

          {/* Interpretation Panel */}
          {pipelineStatus.interpretations.length > 0 && (
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
                Interpretation Panel
              </label>

              {pipelineStatus.interpretations.map((interp) => (
                <div
                  key={interp.id}
                  style={{
                    backgroundColor: interp.is_winner
                      ? 'rgba(156,255,147,0.1)'
                      : 'rgba(72,72,73,0.08)',
                    border: interp.is_winner
                      ? '1px solid #9cff93'
                      : '1px solid rgba(72,72,73,0.15)',
                    borderRadius: '4px',
                    padding: '12px',
                    marginBottom: '8px',
                    opacity: interp.is_winner ? 1 : 0.6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '8px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#ffffff',
                        flex: 1,
                      }}
                    >
                      {interp.text}
                    </div>
                    {interp.is_winner && (
                      <div
                        style={{
                          backgroundColor: '#9cff93',
                          color: '#1a191b',
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '9px',
                          fontWeight: 700,
                          fontFamily: '"Space Grotesk", sans-serif',
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          marginLeft: '8px',
                        }}
                      >
                        Winner
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: '11px',
                      color: '#f0e442',
                    }}
                  >
                    Confidence: {Math.round(interp.confidence * 100)}%
                  </div>

                  {interp.contradictions && interp.contradictions.length > 0 && (
                    <div
                      style={{
                        marginTop: '8px',
                        fontSize: '11px',
                        color: '#ff7162',
                      }}
                    >
                      Contradictions: {interp.contradictions.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Early Screen Result */}
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
              Early Screen Result
            </label>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  backgroundColor:
                    pipelineStatus.screen_result.decision === 'PASS'
                      ? '#9cff93'
                      : pipelineStatus.screen_result.decision === 'SOFT_REJECT'
                      ? '#f0e442'
                      : '#ff7162',
                  color:
                    pipelineStatus.screen_result.decision === 'PASS'
                      ? '#1a191b'
                      : '#1a191b',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {pipelineStatus.screen_result.decision}
              </div>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: '#ffffff',
                lineHeight: '1.5',
              }}
            >
              {pipelineStatus.screen_result.reasoning}
            </div>
          </div>

          {/* Critique Summary */}
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
              Critique Summary
            </label>

            <div
              style={{
                fontSize: '48px',
                fontWeight: 700,
                color: '#9cff93',
                marginBottom: '16px',
              }}
            >
              {pipelineStatus.critique.overall}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '16px',
                flexWrap: 'wrap',
              }}
            >
              {[
                {
                  label: 'Clarity',
                  value: pipelineStatus.critique.clarity,
                },
                {
                  label: 'Feasibility',
                  value: pipelineStatus.critique.feasibility,
                },
                {
                  label: 'Risk',
                  value: pipelineStatus.critique.risk,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    backgroundColor: 'rgba(72,72,73,0.08)',
                    border: '1px solid rgba(72,72,73,0.15)',
                    borderRadius: '4px',
                    padding: '10px 12px',
                    minWidth: '100px',
                  }}
                >
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
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#93c5fd',
                    }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: '12px' }}>
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
              {pipelineStatus.critique.strengths.map((strength, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '13px',
                    color: '#9cff93',
                    marginBottom: '4px',
                  }}
                >
                  + {strength}
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
              {pipelineStatus.critique.weaknesses.map((weakness, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '13px',
                    color: '#ff7162',
                    marginBottom: '4px',
                  }}
                >
                  - {weakness}
                </div>
              ))}
            </div>
          </div>

          {/* Variants Grid */}
          {pipelineStatus.variants.length > 0 && (
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
                Variants
              </label>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '12px',
                }}
              >
                {pipelineStatus.variants.map((variant) => (
                  <div
                    key={variant.id}
                    style={{
                      backgroundColor: 'rgba(72,72,73,0.08)',
                      border: variant.is_best
                        ? '2px solid #f0e442'
                        : '1px solid rgba(72,72,73,0.15)',
                      borderRadius: '4px',
                      padding: '12px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: '#ffffff',
                        marginBottom: '8px',
                      }}
                    >
                      {variant.name}
                      {variant.is_best && (
                        <span
                          style={{
                            marginLeft: '8px',
                            backgroundColor: '#f0e442',
                            color: '#1a191b',
                            padding: '2px 6px',
                            borderRadius: '2px',
                            fontSize: '9px',
                            fontWeight: 700,
                            fontFamily: '"Space Grotesk", sans-serif',
                          }}
                        >
                          BEST
                        </span>
                      )}
                    </div>

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
                      Robustness Score
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#93c5fd',
                        marginBottom: '8px',
                      }}
                    >
                      {Math.round(variant.robustness_score * 100)}%
                    </div>

                    <div
                      style={{
                        fontSize: '11px',
                        color: '#ffffff',
                        lineHeight: '1.4',
                      }}
                    >
                      {variant.key_difference}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendation Banner */}
          <div
            style={{
              backgroundColor:
                pipelineStatus.recommendation.decision === 'DEPLOY'
                  ? 'rgba(156,255,147,0.1)'
                  : pipelineStatus.recommendation.decision === 'PAPER_TRADE'
                  ? 'rgba(240,228,66,0.1)'
                  : pipelineStatus.recommendation.decision === 'ITERATE'
                  ? 'rgba(147,197,253,0.1)'
                  : 'rgba(255,113,98,0.1)',
              border:
                pipelineStatus.recommendation.decision === 'DEPLOY'
                  ? '1px solid #9cff93'
                  : pipelineStatus.recommendation.decision === 'PAPER_TRADE'
                  ? '1px solid #f0e442'
                  : pipelineStatus.recommendation.decision === 'ITERATE'
                  ? '1px solid #93c5fd'
                  : '1px solid #ff7162',
              borderRadius: '8px',
              padding: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  color:
                    pipelineStatus.recommendation.decision === 'DEPLOY'
                      ? '#9cff93'
                      : pipelineStatus.recommendation.decision === 'PAPER_TRADE'
                      ? '#f0e442'
                      : pipelineStatus.recommendation.decision === 'ITERATE'
                      ? '#93c5fd'
                      : '#ff7162',
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {pipelineStatus.recommendation.decision}
              </div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#f0e442',
                }}
              >
                {Math.round(pipelineStatus.recommendation.confidence * 100)}%
              </div>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: '#ffffff',
                lineHeight: '1.6',
              }}
            >
              {pipelineStatus.recommendation.reasoning}
            </div>
          </div>
        </>
      )}
    </div>
  );
}