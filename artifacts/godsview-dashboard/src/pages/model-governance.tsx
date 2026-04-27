'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toArray } from "@/lib/safe";

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

// ============================================================================
// TYPES
// ============================================================================

interface Model {
  id: string;
  name: string;
  version: string;
  status: 'champion' | 'challenger' | 'shadow' | 'retired';
  type: string;
  accuracy: number;
  sharpe: number;
  profitFactor: number;
  deployedAt: string;
  lineage: { version: string; date: string }[];
}

interface Feature {
  id: string;
  name: string;
  type: string;
  source: string;
  latencyMs: number;
  status: 'active' | 'deprecated' | 'experimental';
  usedByModels: number;
}

interface Dataset {
  id: string;
  name: string;
  dateRange: { start: string; end: string };
  symbols: string[];
  rowCount: number;
  hash: string;
  transformations: string[];
  parent?: string;
}

interface DriftReport {
  modelId: string;
  modelName: string;
  driftScore: number;
  checks: { name: string; passed: boolean }[];
  trendSparkline: number[];
  recommendation: 'maintain' | 'retrain' | 'demote' | 'rollback';
}

interface ShadowDeployment {
  id: string;
  challengerId: string;
  challengerName: string;
  championId: string;
  championName: string;
  startDate: string;
  minDaysRequired: number;
  daysCompleted: number;
  metrics: {
    challenger: { winRate: number; avgReturn: number; sharpe: number };
    champion: { winRate: number; avgReturn: number; sharpe: number };
  };
  readinessChecklist: { item: string; completed: boolean }[];
}

interface GovernanceEvent {
  id: string;
  timestamp: string;
  type: 'promotion' | 'demotion' | 'rollback' | 'retrain';
  modelName: string;
  modelId: string;
  details: string;
}

interface HealthStatus {
  allModelsHealthy: boolean;
  modelsNeedingRetrain: number;
  activeShadowDeployments: number;
  featureDeprecationWarnings: number;
}

// ============================================================================
// API HOOKS
// ============================================================================

const useModelRegistry = () =>
  useQuery({
    queryKey: ['model-gov-models'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      return res.json() as Promise<Model[]>;
    },
    refetchInterval: 30000,
  });

const useFeatureRegistry = () =>
  useQuery({
    queryKey: ['model-gov-features'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/features');
      if (!res.ok) throw new Error('Failed to fetch features');
      return res.json() as Promise<Feature[]>;
    },
    refetchInterval: 30000,
  });

const useDatasetLineage = () =>
  useQuery({
    queryKey: ['model-gov-datasets'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/datasets');
      if (!res.ok) throw new Error('Failed to fetch datasets');
      return res.json() as Promise<Dataset[]>;
    },
    refetchInterval: 30000,
  });

const useDriftMonitor = () =>
  useQuery({
    queryKey: ['model-gov-drift'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/drift');
      if (!res.ok) throw new Error('Failed to fetch drift reports');
      return res.json() as Promise<DriftReport[]>;
    },
    refetchInterval: 30000,
  });

const useShadowDeployments = () =>
  useQuery({
    queryKey: ['model-gov-shadows'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/shadows');
      if (!res.ok) throw new Error('Failed to fetch shadow deployments');
      return res.json() as Promise<ShadowDeployment[]>;
    },
    refetchInterval: 30000,
  });

const useGovernanceTimeline = () =>
  useQuery({
    queryKey: ['model-gov-timeline'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/timeline');
      if (!res.ok) throw new Error('Failed to fetch timeline');
      return res.json() as Promise<GovernanceEvent[]>;
    },
    refetchInterval: 30000,
  });

const useHealthStatus = () =>
  useQuery({
    queryKey: ['model-gov-health'],
    queryFn: async () => {
      const res = await fetch('/api/model-gov/health');
      if (!res.ok) throw new Error('Failed to fetch health status');
      return res.json() as Promise<HealthStatus>;
    },
    refetchInterval: 30000,
  });

// ============================================================================
// COMPONENTS: HEADER
// ============================================================================

const Header: React.FC = () => (
  <div
    style={{
      marginBottom: '2rem',
      borderBottom: `1px solid ${C.border}`,
      paddingBottom: '1.5rem',
    }}
  >
    <h1
      style={{
        fontSize: '2rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        margin: '0 0 0.5rem 0',
      }}
    >
      Model Governance
    </h1>
    <p
      style={{
        fontSize: '0.95rem',
        color: C.textDim,
        fontFamily: C.font,
        margin: 0,
      }}
    >
      Phase 113 — Every Model Reproducible, Every Prediction Traceable
    </p>
  </div>
);

// ============================================================================
// COMPONENTS: STATUS BADGES
// ============================================================================

const StatusBadge: React.FC<{ status: string; type?: 'model' | 'feature' }> = ({
  status,
  type = 'model',
}) => {
  const colorMap: Record<string, string> = {
    champion: C.green,
    challenger: C.blue,
    shadow: C.purple,
    retired: C.textMuted,
    active: C.green,
    deprecated: C.amber,
    experimental: C.blue,
  };

  const bgMap: Record<string, string> = {
    champion: 'rgba(156, 255, 147, 0.1)',
    challenger: 'rgba(103, 232, 249, 0.1)',
    shadow: 'rgba(192, 132, 252, 0.1)',
    retired: 'rgba(119, 119, 120, 0.1)',
    active: 'rgba(156, 255, 147, 0.1)',
    deprecated: 'rgba(251, 191, 36, 0.1)',
    experimental: 'rgba(103, 232, 249, 0.1)',
  };

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.25rem 0.75rem',
        borderRadius: '4px',
        backgroundColor: bgMap[status],
        color: colorMap[status],
        fontSize: '0.85rem',
        fontWeight: 600,
        fontFamily: C.font,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
};

const RecommendationBadge: React.FC<{
  recommendation: 'maintain' | 'retrain' | 'demote' | 'rollback';
}> = ({ recommendation }) => {
  const colors: Record<string, string> = {
    maintain: C.green,
    retrain: C.amber,
    demote: C.red,
    rollback: C.red,
  };

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.25rem 0.75rem',
        borderRadius: '4px',
        backgroundColor: `${colors[recommendation]}20`,
        color: colors[recommendation],
        fontSize: '0.8rem',
        fontWeight: 600,
        fontFamily: C.font,
        textTransform: 'capitalize',
      }}
    >
      {recommendation}
    </span>
  );
};

// ============================================================================
// COMPONENTS: MODEL REGISTRY
// ============================================================================

const ModelRegistryPanel: React.FC<{ models: Model[] }> = ({ models }) => (
  <section
    style={{
      marginBottom: '2rem',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '1.5rem',
    }}
  >
    <h2
      style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        marginBottom: '1rem',
        margin: '0 0 1rem 0',
      }}
    >
      Model Registry
    </h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
      {toArray(models).map((model) => (
        <div
          key={model.id}
          style={{
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.borderLight}`,
            borderRadius: '6px',
            padding: '1rem',
          }}
        >
          <div style={{ marginBottom: '0.75rem' }}>
            <h3
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: C.text,
                fontFamily: C.font,
                margin: '0 0 0.25rem 0',
              }}
            >
              {model.name}
            </h3>
            <p style={{ fontSize: '0.8rem', color: C.textMuted, margin: '0', fontFamily: C.mono }}>
              v{model.version}
            </p>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <StatusBadge status={model.status} type="model" />
            <span
              style={{
                marginLeft: '0.5rem',
                fontSize: '0.8rem',
                color: C.textMuted,
                fontFamily: C.font,
              }}
            >
              {model.type}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              fontFamily: C.mono,
            }}
          >
            <div>
              <div style={{ color: C.textMuted }}>Accuracy</div>
              <div style={{ color: C.green, fontWeight: 700 }}>{(model.accuracy * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ color: C.textMuted }}>Sharpe</div>
              <div style={{ color: C.blue, fontWeight: 700 }}>{model.sharpe.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: C.textMuted }}>Profit Factor</div>
              <div style={{ color: C.purple, fontWeight: 700 }}>{model.profitFactor.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: C.textMuted }}>Deployed</div>
              <div style={{ color: C.textDim }}>{new Date(model.deployedAt).toLocaleDateString()}</div>
            </div>
          </div>
          <details
            style={{
              fontSize: '0.8rem',
              color: C.textMuted,
              cursor: 'pointer',
            }}
          >
            <summary style={{ fontWeight: 600, marginTop: '0.5rem' }}>
              Lineage ({model.lineage.length})
            </summary>
            <div style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
              {model.lineage.map((item, i) => (
                <div key={i} style={{ marginBottom: '0.25rem', color: C.textFaint }}>
                  v{item.version} • {new Date(item.date).toLocaleDateString()}
                </div>
              ))}
            </div>
          </details>
        </div>
      ))}
    </div>
  </section>
);

// ============================================================================
// COMPONENTS: FEATURE REGISTRY
// ============================================================================

const FeatureRegistry: React.FC<{ features: Feature[] }> = ({ features }) => (
  <section
    style={{
      marginBottom: '2rem',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '1.5rem',
    }}
  >
    <h2
      style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        margin: '0 0 1rem 0',
      }}
    >
      Feature Registry
    </h2>
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.9rem',
          fontFamily: C.font,
        }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ textAlign: 'left', padding: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
              Name
            </th>
            <th style={{ textAlign: 'left', padding: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
              Type
            </th>
            <th style={{ textAlign: 'left', padding: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
              Source
            </th>
            <th style={{ textAlign: 'left', padding: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
              Latency
            </th>
            <th style={{ textAlign: 'left', padding: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
              Status
            </th>
            <th style={{ textAlign: 'right', padding: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
              Used By
            </th>
          </tr>
        </thead>
        <tbody>
          {features.map((feature) => (
            <tr key={feature.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
              <td style={{ padding: '0.75rem', color: C.text, fontFamily: C.mono }}>{feature.name}</td>
              <td style={{ padding: '0.75rem', color: C.textDim }}>{feature.type}</td>
              <td style={{ padding: '0.75rem', color: C.textDim }}>{feature.source}</td>
              <td style={{ padding: '0.75rem', color: C.textMuted, fontFamily: C.mono }}>
                {feature.latencyMs}ms
              </td>
              <td style={{ padding: '0.75rem' }}>
                <StatusBadge status={feature.status} type="feature" />
              </td>
              <td style={{ padding: '0.75rem', textAlign: 'right', color: C.textDim }}>
                {feature.usedByModels}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

// ============================================================================
// COMPONENTS: DATASET LINEAGE
// ============================================================================

const DatasetLineage: React.FC<{ datasets: Dataset[] }> = ({ datasets }) => (
  <section
    style={{
      marginBottom: '2rem',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '1.5rem',
    }}
  >
    <h2
      style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        margin: '0 0 1rem 0',
      }}
    >
      Dataset Lineage
    </h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
      {datasets.map((ds) => (
        <div
          key={ds.id}
          style={{
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.borderLight}`,
            borderRadius: '6px',
            padding: '1rem',
          }}
        >
          <h3
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: C.text,
              fontFamily: C.font,
              margin: '0 0 0.75rem 0',
            }}
          >
            {ds.name}
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              fontFamily: C.mono,
            }}
          >
            <div>
              <div style={{ color: C.textMuted }}>Date Range</div>
              <div style={{ color: C.textDim }}>
                {ds.dateRange.start} to {ds.dateRange.end}
              </div>
            </div>
            <div>
              <div style={{ color: C.textMuted }}>Row Count</div>
              <div style={{ color: C.textDim }}>{ds.rowCount.toLocaleString()}</div>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.25rem' }}>Symbols</div>
            <div style={{ fontSize: '0.85rem', color: C.textDim, fontFamily: C.mono }}>
              {ds.symbols.join(', ')}
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.25rem' }}>Hash</div>
            <div style={{ fontSize: '0.75rem', color: C.textFaint, fontFamily: C.mono, wordBreak: 'break-all' }}>
              {ds.hash.substring(0, 32)}...
            </div>
          </div>
          {ds.transformations.length > 0 && (
            <details style={{ fontSize: '0.8rem', color: C.textMuted, cursor: 'pointer' }}>
              <summary style={{ fontWeight: 600 }}>Transformations ({ds.transformations.length})</summary>
              <div style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
                {ds.transformations.map((tx, i) => (
                  <div key={i} style={{ marginBottom: '0.25rem', fontSize: '0.75rem', color: C.textFaint }}>
                    • {tx}
                  </div>
                ))}
              </div>
            </details>
          )}
          {ds.parent && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: C.blue }}>
              ← Parent: {ds.parent}
            </div>
          )}
        </div>
      ))}
    </div>
  </section>
);

// ============================================================================
// COMPONENTS: DRIFT MONITOR
// ============================================================================

const DriftGauge: React.FC<{ score: number }> = ({ score }) => {
  const color = score < 0.3 ? C.green : score < 0.6 ? C.amber : C.red;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div
        style={{
          height: '32px',
          backgroundColor: C.cardAlt,
          border: `1px solid ${C.borderLight}`,
          borderRadius: '4px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${score * 100}%`,
            backgroundColor: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ fontSize: '0.75rem', color: color, fontFamily: C.mono, fontWeight: 600 }}>
        {(score * 100).toFixed(1)}%
      </div>
    </div>
  );
};

const Sparkline: React.FC<{ data: number[] }> = ({ data }) => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  return (
    <svg
      viewBox={`0 0 ${data.length * 10} 40`}
      style={{ height: '24px', width: '100%', stroke: C.blue, fill: 'none', strokeWidth: '1.5' }}
    >
      <polyline
        points={data
          .map((v, i) => `${i * 10},${40 - ((v - min) / range) * 35}`)
          .join(' ')}
      />
    </svg>
  );
};

const DriftMonitor: React.FC<{ drifts: DriftReport[] }> = ({ drifts }) => (
  <section
    style={{
      marginBottom: '2rem',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '1.5rem',
    }}
  >
    <h2
      style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        margin: '0 0 1rem 0',
      }}
    >
      Drift Monitor
    </h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
      {drifts.map((drift) => (
        <div
          key={drift.modelId}
          style={{
            backgroundColor: C.cardAlt,
            border: `1px solid ${C.borderLight}`,
            borderRadius: '6px',
            padding: '1rem',
          }}
        >
          <h3
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: C.text,
              fontFamily: C.font,
              margin: '0 0 1rem 0',
            }}
          >
            {drift.modelName}
          </h3>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem' }}>Drift Score</div>
            <DriftGauge score={drift.driftScore} />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem' }}>Checks</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {drift.checks.map((check, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.5rem',
                    backgroundColor: check.passed ? 'rgba(156, 255, 147, 0.1)' : 'rgba(255, 113, 98, 0.1)',
                    borderRadius: '3px',
                    color: check.passed ? C.green : C.red,
                  }}
                >
                  {check.passed ? '✓' : '✗'} {check.name}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem' }}>
              30-Day Trend
            </div>
            <Sparkline data={drift.trendSparkline} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: C.textMuted }}>Recommendation</span>
            <RecommendationBadge recommendation={drift.recommendation} />
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ============================================================================
// COMPONENTS: SHADOW DEPLOYMENTS
// ============================================================================

const ShadowDeployments: React.FC<{ shadows: ShadowDeployment[] }> = ({ shadows }) => (
  <section
    style={{
      marginBottom: '2rem',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '1.5rem',
    }}
  >
    <h2
      style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        margin: '0 0 1rem 0',
      }}
    >
      Shadow Deployments
    </h2>
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      {shadows.map((shadow) => {
        const progressPct = (shadow.daysCompleted / shadow.minDaysRequired) * 100;
        const challengerWinDelta =
          shadow.metrics.challenger.winRate - shadow.metrics.champion.winRate;
        const isSignificant = Math.abs(challengerWinDelta) > 0.05;

        return (
          <div
            key={shadow.id}
            style={{
              backgroundColor: C.cardAlt,
              border: `1px solid ${C.borderLight}`,
              borderRadius: '6px',
              padding: '1.5rem',
            }}
          >
            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: C.text,
                  fontFamily: C.font,
                  margin: 0,
                }}
              >
                {shadow.challengerName} vs {shadow.championName}
              </h3>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: C.textMuted,
                  fontFamily: C.mono,
                }}
              >
                {shadow.daysCompleted} / {shadow.minDaysRequired} days
              </span>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem' }}>Progress</div>
              <div
                style={{
                  height: '8px',
                  backgroundColor: C.card,
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(progressPct, 100)}%`,
                    backgroundColor: progressPct >= 100 ? C.green : C.blue,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem', fontWeight: 600 }}>
                  Challenger
                </div>
                <div style={{ fontSize: '0.85rem', fontFamily: C.mono }}>
                  <div style={{ color: C.text }}>
                    WR: <span style={{ color: C.green }}>{(shadow.metrics.challenger.winRate * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ color: C.textDim }}>
                    Ret: {(shadow.metrics.challenger.avgReturn * 100).toFixed(2)}%
                  </div>
                  <div style={{ color: C.textDim }}>
                    Sharpe: {shadow.metrics.challenger.sharpe.toFixed(2)}
                  </div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem', fontWeight: 600 }}>
                  Champion
                </div>
                <div style={{ fontSize: '0.85rem', fontFamily: C.mono }}>
                  <div style={{ color: C.text }}>
                    WR: <span style={{ color: C.green }}>{(shadow.metrics.champion.winRate * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ color: C.textDim }}>
                    Ret: {(shadow.metrics.champion.avgReturn * 100).toFixed(2)}%
                  </div>
                  <div style={{ color: C.textDim }}>
                    Sharpe: {shadow.metrics.champion.sharpe.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: C.card, borderRadius: '4px' }}>
              <div style={{ fontSize: '0.8rem', color: C.textMuted, marginBottom: '0.5rem' }}>Win Rate Delta</div>
              <div
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: challengerWinDelta > 0 ? C.green : challengerWinDelta < 0 ? C.red : C.textMuted,
                  fontFamily: C.mono,
                }}
              >
                {challengerWinDelta > 0 ? '+' : ''}{(challengerWinDelta * 100).toFixed(2)}%{' '}
                {isSignificant && <span style={{ fontSize: '0.8rem', color: C.amber }}>★</span>}
              </div>
            </div>

            <details style={{ fontSize: '0.8rem', color: C.textMuted, cursor: 'pointer' }}>
              <summary style={{ fontWeight: 600 }}>
                Readiness ({shadow.readinessChecklist.filter((c) => c.completed).length} /
                {shadow.readinessChecklist.length})
              </summary>
              <div style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
                {shadow.readinessChecklist.map((item, i) => (
                  <div key={i} style={{ marginBottom: '0.25rem', color: item.completed ? C.green : C.textFaint }}>
                    {item.completed ? '✓' : '○'} {item.item}
                  </div>
                ))}
              </div>
            </details>
          </div>
        );
      })}
    </div>
  </section>
);

// ============================================================================
// COMPONENTS: GOVERNANCE TIMELINE
// ============================================================================

const EventIcon: React.FC<{ type: string }> = ({ type }) => {
  const icons: Record<string, string> = {
    promotion: '↑',
    demotion: '↓',
    rollback: '⟲',
    retrain: '⟳',
  };
  const colors: Record<string, string> = {
    promotion: C.green,
    demotion: C.amber,
    rollback: C.red,
    retrain: C.blue,
  };
  return (
    <span style={{ fontSize: '1.2rem', color: colors[type], fontWeight: 700 }}>
      {icons[type]}
    </span>
  );
};

const GovernanceTimeline: React.FC<{ events: GovernanceEvent[] }> = ({ events }) => (
  <section
    style={{
      marginBottom: '2rem',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '1.5rem',
    }}
  >
    <h2
      style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color: C.text,
        fontFamily: C.font,
        margin: '0 0 1rem 0',
      }}
    >
      Governance Timeline
    </h2>
    <div
      style={{
        position: 'relative',
        paddingLeft: '2rem',
      }}
    >
      {events.map((event, i) => (
        <div
          key={event.id}
          style={{
            marginBottom: '1.5rem',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '-2.75rem',
              top: '0.25rem',
              width: '1.5rem',
              height: '1.5rem',
              backgroundColor: C.cardAlt,
              border: `2px solid ${C.border}`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <EventIcon type={event.type} />
          </div>
          {i < events.length - 1 && (
            <div
              style={{
                position: 'absolute',
                left: '-2.2rem',
                top: '1.75rem',
                width: '2px',
                height: '1.5rem',
                backgroundColor: C.borderLight,
              }}
            />
          )}
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: C.text, fontFamily: C.font, marginBottom: '0.25rem' }}>
              {event.modelName}
            </div>
            <div style={{ fontSize: '0.85rem', color: C.textDim, marginBottom: '0.25rem', textTransform: 'capitalize' }}>
              {event.type}
            </div>
            <div style={{ fontSize: '0.8rem', color: C.textMuted }}>
              {new Date(event.timestamp).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.8rem', color: C.textFaint, marginTop: '0.25rem' }}>
              {event.details}
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ModelGovernancePage() {
  const modelsQuery = useModelRegistry();
  const featuresQuery = useFeatureRegistry();
  const datasetsQuery = useDatasetLineage();
  const driftQuery = useDriftMonitor();
  const shadowsQuery = useShadowDeployments();
  const eventsQuery = useGovernanceTimeline();
  const healthQuery = useHealthStatus();

  const isLoading =
    modelsQuery.isLoading ||
    featuresQuery.isLoading ||
    datasetsQuery.isLoading ||
    driftQuery.isLoading ||
    shadowsQuery.isLoading ||
    eventsQuery.isLoading ||
    healthQuery.isLoading;

  return (
    <div
      style={{
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: C.font,
        minHeight: '100vh',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <Header />

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: C.textMuted }}>
            Loading model governance data...
          </div>
        ) : (
          <>
            {modelsQuery.data && <ModelRegistryPanel models={modelsQuery.data} />}
            {featuresQuery.data && <FeatureRegistry features={featuresQuery.data} />}
            {datasetsQuery.data && <DatasetLineage datasets={datasetsQuery.data} />}
            {driftQuery.data && <DriftMonitor drifts={driftQuery.data} />}
            {shadowsQuery.data && <ShadowDeployments shadows={shadowsQuery.data} />}
            {eventsQuery.data && <GovernanceTimeline events={eventsQuery.data} />}
          </>
        )}
      </div>
    </div>
  );
}
