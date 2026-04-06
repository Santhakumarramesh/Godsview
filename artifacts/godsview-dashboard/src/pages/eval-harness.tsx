import React, { useState, useEffect } from 'react';

type Evaluator = 'Ambiguity' | 'Rejection' | 'Critique' | 'Variant' | 'Causal' | 'Explain' | 'Recommendation';
type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'ADVERSARIAL' | 'EDGE_CASE';

interface EvaluatorScore {
  name: Evaluator;
  score: number;
  pass: boolean;
}

interface TestCase {
  id: string;
  difficulty: Difficulty;
  input: string;
  expected: string;
  actual: string;
  match: boolean;
  score: number;
}

interface LeaderboardRow {
  system: string;
  overall: number;
  interpretation: number;
  rejection: number;
  variants: number;
  explanation: number;
  recommendation: number;
}

interface Weakness {
  title: string;
  description: string;
  recommendation: string;
}

interface EvalReport {
  overallGrade: string;
  passRate: number;
  lastRunAt: string;
  evaluators: EvaluatorScore[];
  testCases: TestCase[];
  weaknesses: Weakness[];
  regressions: Array<{ metric: string; previous: number; current: number }>;
}

interface LeaderboardData {
  rows: LeaderboardRow[];
}

export default function EvalHarness() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [filter, setFilter] = useState<Difficulty | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const reportRes = await fetch('/api/eval/report');
        const leaderboardRes = await fetch('/api/eval/leaderboard');
        
        if (!reportRes.ok || !leaderboardRes.ok) {
          throw new Error('Failed to fetch data');
        }
        
        const reportData = await reportRes.json();
        const leaderboardData = await leaderboardRes.json();
        
        setReport(reportData);
        setLeaderboard(leaderboardData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleRunEval = async () => {
    try {
      const res = await fetch('/api/eval/report', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to run evaluation');
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run evaluation');
    }
  };

  const getGradeColor = (grade: string): string => {
    switch (grade) {
      case 'A': return '#9cff93';
      case 'B': return '#93c5fd';
      case 'C': return '#f0e442';
      case 'D':
      case 'F': return '#ff7162';
      default: return '#484849';
    }
  };

  const getDifficultyColor = (difficulty: Difficulty): string => {
    switch (difficulty) {
      case 'EASY': return '#9cff93';
      case 'MEDIUM': return '#f0e442';
      case 'HARD': return '#ff7162';
      case 'ADVERSARIAL': return '#ff7162';
      case 'EDGE_CASE': return '#93c5fd';
      default: return '#484849';
    }
  };

  const filteredTestCases = report?.testCases.filter(tc => 
    filter === 'ALL' ? true : tc.difficulty === filter
  ) || [];

  if (loading) {
    return (
      <div style={{
        backgroundColor: '#1a191b',
        color: '#fff',
        padding: '40px',
        minHeight: '100vh',
        fontFamily: 'Space Grotesk, sans-serif'
      }}>
        <p>Loading evaluation data...</p>
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
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '40px',
        borderBottom: '1px solid rgba(72,72,73,0.15)',
        paddingBottom: '20px'
      }}>
        <div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 700,
            margin: '0 0 8px 0'
          }}>
            Decision Loop Evaluation
          </h1>
          <p style={{
            fontSize: '12px',
            color: '#484849',
            margin: 0
          }}>
            Last run: {report?.lastRunAt || 'Never'}
          </p>
        </div>
        <button
          onClick={handleRunEval}
          style={{
            backgroundColor: '#9cff93',
            color: '#1a191b',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'Space Grotesk, sans-serif',
            letterSpacing: '0.15em',
            textTransform: 'uppercase'
          }}
        >
          Run Full Eval
        </button>
      </div>

      {/* Overall Grade */}
      <div style={{
        backgroundColor: '#1a191b',
        border: '1px solid rgba(72,72,73,0.15)',
        padding: '40px',
        borderRadius: '8px',
        marginBottom: '40px',
        textAlign: 'center'
      }}>
        <p style={{
          fontSize: '9px',
          fontWeight: 700,
          color: '#484849',
          margin: '0 0 16px 0',
          letterSpacing: '0.15em',
          textTransform: 'uppercase'
        }}>
          Overall Grade
        </p>
        <div style={{
          fontSize: '80px',
          fontWeight: 700,
          color: getGradeColor(report?.overallGrade || 'C'),
          margin: '0 0 16px 0'
        }}>
          {report?.overallGrade}
        </div>
        <p style={{
          fontSize: '18px',
          fontWeight: 700,
          margin: 0,
          color: '#9cff93'
        }}>
          {report?.passRate}% Pass Rate
        </p>
      </div>

      {/* Evaluator Scores */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '16px',
        marginBottom: '40px'
      }}>
        {report?.evaluators.map((evaluator) => (
          <div
            key={evaluator.name}
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
              margin: '0 0 12px 0',
              letterSpacing: '0.15em',
              textTransform: 'uppercase'
            }}>
              {evaluator.name}
            </p>
            <p style={{
              fontSize: '18px',
              fontWeight: 700,
              margin: '0 0 12px 0',
              color: '#fff'
            }}>
              {evaluator.score}
            </p>
            <div style={{
              width: '100%',
              height: '4px',
              backgroundColor: 'rgba(72,72,73,0.15)',
              borderRadius: '2px',
              overflow: 'hidden',
              marginBottom: '12px'
            }}>
              <div
                style={{
                  height: '100%',
                  width: `${evaluator.score}%`,
                  backgroundColor: evaluator.pass ? '#9cff93' : '#ff7162',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
            <div style={{
              fontSize: '9px',
              color: evaluator.pass ? '#9cff93' : '#ff7162',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.15em'
            }}>
              {evaluator.pass ? 'PASS' : 'FAIL'}
            </div>
          </div>
        ))}
      </div>

      {/* Golden Suite Results */}
      <div style={{
        marginBottom: '40px'
      }}>
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={() => setFilter('ALL')}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: `1px solid ${filter === 'ALL' ? '#9cff93' : 'rgba(72,72,73,0.15)'}`,
              backgroundColor: filter === 'ALL' ? 'rgba(156,255,147,0.1)' : 'transparent',
              color: filter === 'ALL' ? '#9cff93' : '#484849',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'Space Grotesk, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.15em'
            }}
          >
            All
          </button>
          {(['EASY', 'MEDIUM', 'HARD', 'ADVERSARIAL', 'EDGE_CASE'] as const).map(diff => (
            <button
              key={diff}
              onClick={() => setFilter(diff)}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: `1px solid ${filter === diff ? getDifficultyColor(diff) : 'rgba(72,72,73,0.15)'}`,
                backgroundColor: filter === diff ? `${getDifficultyColor(diff)}15` : 'transparent',
                color: filter === diff ? getDifficultyColor(diff) : '#484849',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'Space Grotesk, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.15em'
              }}
            >
              {diff}
            </button>
          ))}
        </div>

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
                }}>ID</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Difficulty</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Input</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Expected</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Actual</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'center',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Match</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {filteredTestCases.map((tc) => (
                <tr
                  key={tc.id}
                  style={{
                    backgroundColor: tc.match ? 'rgba(156,255,147,0.05)' : 'rgba(255,113,98,0.05)',
                    borderBottom: '1px solid rgba(72,72,73,0.15)'
                  }}
                >
                  <td style={{
                    padding: '12px 16px',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#fff'
                  }}>
                    {tc.id}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    color: getDifficultyColor(tc.difficulty)
                  }}>
                    <span style={{
                      backgroundColor: `${getDifficultyColor(tc.difficulty)}20`,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.15em'
                    }}>
                      {tc.difficulty}
                    </span>
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#93c5fd',
                    maxWidth: '200px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {tc.input.substring(0, 30)}...
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    color: '#fff'
                  }}>
                    {tc.expected}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    color: tc.match ? '#9cff93' : '#ff7162'
                  }}>
                    {tc.actual}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    color: tc.match ? '#9cff93' : '#ff7162',
                    fontSize: '16px'
                  }}>
                    {tc.match ? '✓' : '✗'}
                  </td>
                  <td style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#fff'
                  }}>
                    {tc.score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leaderboard */}
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
          System Leaderboard
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
                }}>System</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Overall</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Interpretation</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Rejection</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Variants</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Explanation</th>
                <th style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  color: '#484849',
                  fontWeight: 700,
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em'
                }}>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard?.rows.map((row, idx) => {
                const isGodsView = row.system === 'GodsView';
                const winners = [
                  Math.max(...(leaderboard?.rows.map(r => r.overall) || [])),
                  Math.max(...(leaderboard?.rows.map(r => r.interpretation) || [])),
                  Math.max(...(leaderboard?.rows.map(r => r.rejection) || [])),
                  Math.max(...(leaderboard?.rows.map(r => r.variants) || [])),
                  Math.max(...(leaderboard?.rows.map(r => r.explanation) || [])),
                  Math.max(...(leaderboard?.rows.map(r => r.recommendation) || []))
                ];

                return (
                  <tr
                    key={idx}
                    style={{
                      backgroundColor: isGodsView ? 'rgba(156,255,147,0.08)' : 'transparent',
                      borderBottom: '1px solid rgba(72,72,73,0.15)'
                    }}
                  >
                    <td style={{
                      padding: '12px 16px',
                      color: isGodsView ? '#9cff93' : '#fff',
                      fontWeight: isGodsView ? 700 : 400
                    }}>
                      {row.system}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: row.overall === winners[0] ? '#9cff93' : '#fff',
                      fontWeight: row.overall === winners[0] ? 700 : 400
                    }}>
                      {row.overall}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: row.interpretation === winners[1] ? '#9cff93' : '#fff',
                      fontWeight: row.interpretation === winners[1] ? 700 : 400
                    }}>
                      {row.interpretation}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: row.rejection === winners[2] ? '#9cff93' : '#fff',
                      fontWeight: row.rejection === winners[2] ? 700 : 400
                    }}>
                      {row.rejection}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: row.variants === winners[3] ? '#9cff93' : '#fff',
                      fontWeight: row.variants === winners[3] ? 700 : 400
                    }}>
                      {row.variants}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: row.explanation === winners[4] ? '#9cff93' : '#fff',
                      fontWeight: row.explanation === winners[4] ? 700 : 400
                    }}>
                      {row.explanation}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: row.recommendation === winners[5] ? '#9cff93' : '#fff',
                      fontWeight: row.recommendation === winners[5] ? 700 : 400
                    }}>
                      {row.recommendation}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weakest Areas */}
      {report?.weaknesses && report.weaknesses.length > 0 && (
        <div style={{
          backgroundColor: '#1a191b',
          border: '2px solid #ff7162',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '40px'
        }}>
          <h2 style={{
            fontSize: '14px',
            fontWeight: 700,
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: '#ff7162'
          }}>
            Top 3 Weakest Areas
          </h2>
          <div style={{
            display: 'grid',
            gap: '12px'
          }}>
            {report.weaknesses.slice(0, 3).map((weakness, idx) => (
              <div key={idx} style={{
                backgroundColor: 'rgba(255,113,98,0.05)',
                padding: '12px',
                borderRadius: '4px',
                borderLeft: '3px solid #ff7162'
              }}>
                <p style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#ff7162',
                  margin: '0 0 4px 0'
                }}>
                  {weakness.title}
                </p>
                <p style={{
                  fontSize: '11px',
                  color: '#fff',
                  margin: '0 0 8px 0'
                }}>
                  {weakness.description}
                </p>
                <p style={{
                  fontSize: '10px',
                  color: '#93c5fd',
                  margin: 0,
                  fontStyle: 'italic'
                }}>
                  Recommendation: {weakness.recommendation}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regression Alert */}
      {report?.regressions && report.regressions.length > 0 && (
        <div style={{
          backgroundColor: '#1a191b',
          border: '2px solid #f0e442',
          padding: '16px',
          borderRadius: '8px'
        }}>
          <h2 style={{
            fontSize: '14px',
            fontWeight: 700,
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: '#f0e442'
          }}>
            Regression Alert
          </h2>
          <div style={{
            display: 'grid',
            gap: '12px'
          }}>
            {report.regressions.map((regression, idx) => (
              <div key={idx} style={{
                backgroundColor: 'rgba(240,228,66,0.05)',
                padding: '12px',
                borderRadius: '4px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{
                  fontSize: '12px',
                  color: '#f0e442',
                  fontWeight: 700
                }}>
                  {regression.metric}
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#ff7162',
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  {regression.previous.toFixed(2)} to {regression.current.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
