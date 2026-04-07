'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// Design tokens
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

// Types
interface Capability {
  id: string;
  category: string;
  name: string;
  claimed: boolean;
  implemented: 'full' | 'partial' | 'stub' | 'missing';
  tested: 'unit' | 'integration' | 'e2e' | 'none';
  exercisedLive: boolean;
  owner: string;
}

interface ReadinessData {
  overallGrade: string;
  compositeScore: number;
  lastAuditTime: string;
}

interface ScoreCard {
  implementationCoverage: number;
  testCoverage: number;
  liveExerciseRate: number;
  configSafety: number;
}

interface EndpointAudit {
  routes: Array<{ group: string; health: number }>;
  orphanEndpoints: string[];
  orphanPages: string[];
  duplicateRoutes: string[];
  totalEndpoints: number;
  totalPages: number;
}

interface DeadCodeEntry {
  file: string;
  type: string;
  description: string;
  suggestion: string;
  severity: 'critical' | 'warning' | 'info';
}

interface ConfigAudit {
  key: string;
  paperValue: string;
  liveValue: string;
  current: string;
  riskLevel: 'safe' | 'caution' | 'dangerous';
}

interface TestTaxonomy {
  unit: number;
  integration: number;
  replay: number;
  paper: number;
  chaos: number;
  soak: number;
  e2e: number;
  totalTests: number;
  health: number;
}

interface ExitCriteria {
  criteriaName: string;
  passed: boolean;
  details: string;
}

// Header Component
const Header: React.FC<{ readiness: ReadinessData }> = ({ readiness }) => (
  <div style={{ padding: '32px', borderBottom: `1px solid ${C.border}`, marginBottom: '32px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <h1 style={{ fontSize: '40px', fontWeight: 700, margin: 0, fontFamily: C.font, color: C.text }}>
          System Truth Audit
        </h1>
        <p style={{ fontSize: '16px', color: C.textMuted, margin: '8px 0 0 0', fontFamily: C.font }}>
          Phase 108 — Prove Claims Match Reality
        </p>
      </div>
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '12px',
              backgroundColor: readiness.overallGrade === 'A' ? C.green : readiness.overallGrade === 'B' ? C.blue : C.amber,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '56px',
              fontWeight: 700,
              fontFamily: C.mono,
              color: C.bg,
              boxShadow: `0 8px 24px rgba(0,0,0,0.4)`,
            }}
          >
            {readiness.overallGrade}
          </div>
        </div>
        <div style={{ width: '240px' }}>
          <div style={{ fontSize: '13px', color: C.textMuted, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Composite Score
          </div>
          <div style={{ fontSize: '32px', fontWeight: 700, margin: '8px 0', color: C.green, fontFamily: C.mono }}>
            {readiness.compositeScore}%
          </div>
          <div style={{ fontSize: '12px', color: C.textFaint, fontFamily: C.font }}>
            Last audit: {new Date(readiness.lastAuditTime).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  </div>
);

// Readiness Score Cards
const ReadinessScoreCards: React.FC<{ scores: ScoreCard }> = ({ scores }) => {
  const cards = [
    { label: 'Implementation Coverage', value: scores.implementationCoverage, icon: '◆' },
    { label: 'Test Coverage', value: scores.testCoverage, icon: '✓' },
    { label: 'Live Exercise Rate', value: scores.liveExerciseRate, icon: '▶' },
    { label: 'Config Safety', value: scores.configSafety, icon: '🔒' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', padding: '0 32px', marginBottom: '40px' }}>
      {cards.map((card, i) => (
        <div
          key={i}
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            padding: '20px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '12px', color: C.textMuted }}>{card.icon}</div>
          <div style={{ fontSize: '12px', color: C.textFaint, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>
            {card.label}
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: card.value >= 80 ? C.green : card.value >= 60 ? C.amber : C.red, fontFamily: C.mono }}>
            {card.value}%
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '4px',
              backgroundColor: C.borderLight,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${card.value}%`,
                backgroundColor: card.value >= 80 ? C.green : card.value >= 60 ? C.amber : C.red,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// Capability Matrix Table
const CapabilityMatrix: React.FC<{ capabilities: Capability[] }> = ({ capabilities }) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'gaps' | 'stubs'>('all');
  const [sortBy, setSortBy] = useState<string>('category');

  const categories = useMemo(() => {
    return Array.from(new Set(capabilities.map((c) => c.category))).sort();
  }, [capabilities]);

  const filtered = useMemo(() => {
    let result = capabilities;
    if (categoryFilter !== 'all') {
      result = result.filter((c) => c.category === categoryFilter);
    }
    if (statusFilter === 'gaps') {
      result = result.filter((c) => c.implemented !== 'full');
    }
    if (statusFilter === 'stubs') {
      result = result.filter((c) => c.implemented === 'stub' || c.implemented === 'missing');
    }
    return result.sort((a, b) => {
      if (sortBy === 'category') return a.category.localeCompare(b.category);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
  }, [capabilities, categoryFilter, statusFilter, sortBy]);

  const getStatusColor = (status: string) => {
    if (status === 'full') return C.green;
    if (status === 'partial') return C.amber;
    return C.red;
  };

  const getTestColor = (test: string) => {
    if (test === 'e2e' || test === 'integration') return C.green;
    if (test === 'unit') return C.amber;
    return C.red;
  };

  return (
    <div style={{ padding: '0 32px', marginBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: C.text, fontFamily: C.font }}>
          Capability Matrix
        </h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: '6px',
              fontFamily: C.font,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{
              padding: '8px 12px',
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: '6px',
              fontFamily: C.font,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Status</option>
            <option value="gaps">Gaps Only</option>
            <option value="stubs">Stubs Only</option>
          </select>
        </div>
      </div>

      <div style={{ overflowX: 'auto', backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: C.font,
            fontSize: '14px',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '16px', textAlign: 'left', color: C.textMuted, fontWeight: 600 }}>Category</th>
              <th style={{ padding: '16px', textAlign: 'left', color: C.textMuted, fontWeight: 600 }}>Capability</th>
              <th style={{ padding: '16px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>Claimed</th>
              <th style={{ padding: '16px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>Implemented</th>
              <th style={{ padding: '16px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>Tested</th>
              <th style={{ padding: '16px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>Exercised Live</th>
              <th style={{ padding: '16px', textAlign: 'left', color: C.textMuted, fontWeight: 600 }}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cap) => (
              <tr
                key={cap.id}
                style={{
                  borderBottom: `1px solid ${C.borderLight}`,
                  '&:hover': { backgroundColor: C.cardAlt },
                }}
              >
                <td style={{ padding: '16px', color: C.textDim }}>{cap.category}</td>
                <td style={{ padding: '16px', color: C.text, fontWeight: 500 }}>{cap.name}</td>
                <td style={{ padding: '16px', textAlign: 'center', color: cap.claimed ? C.green : C.red }}>
                  {cap.claimed ? '✓' : '✗'}
                </td>
                <td style={{ padding: '16px', textAlign: 'center' }}>
                  <span
                    style={{
                      backgroundColor: getStatusColor(cap.implemented),
                      color: C.bg,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: C.mono,
                    }}
                  >
                    {cap.implemented}
                  </span>
                </td>
                <td style={{ padding: '16px', textAlign: 'center' }}>
                  <span
                    style={{
                      backgroundColor: getTestColor(cap.tested),
                      color: C.bg,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: C.mono,
                    }}
                  >
                    {cap.tested}
                  </span>
                </td>
                <td style={{ padding: '16px', textAlign: 'center', color: cap.exercisedLive ? C.green : C.red }}>
                  {cap.exercisedLive ? '✓' : '✗'}
                </td>
                <td style={{ padding: '16px', color: C.textDim }}>{cap.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '12px', fontSize: '13px', color: C.textMuted, fontFamily: C.font }}>
        Showing {filtered.length} of {capabilities.length} capabilities
      </div>
    </div>
  );
};

// Endpoint Audit Panel
const EndpointAuditPanel: React.FC<{ data: EndpointAudit }> = ({ data }) => (
  <div style={{ padding: '0 32px', marginBottom: '40px' }}>
    <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 20px 0', color: C.text, fontFamily: C.font }}>
      Endpoint Audit
    </h2>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
      {/* Route Group Health */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0', color: C.text, fontFamily: C.font }}>
          Route Group Health
        </h3>
        {data.routes.map((route) => (
          <div key={route.group} style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: C.textDim, fontFamily: C.mono }}>{route.group}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: route.health >= 80 ? C.green : route.health >= 60 ? C.amber : C.red, fontFamily: C.mono }}>
                {route.health}%
              </span>
            </div>
            <div style={{ height: '6px', backgroundColor: C.borderLight, borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${route.health}%`,
                  backgroundColor: route.health >= 80 ? C.green : route.health >= 60 ? C.amber : C.red,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Summary Stats */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0', color: C.text, fontFamily: C.font }}>
          Summary
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', color: C.textFaint, fontFamily: C.font, textTransform: 'uppercase' }}>
              Total Endpoints
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: C.blue, fontFamily: C.mono }}>
              {data.totalEndpoints}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: C.textFaint, fontFamily: C.font, textTransform: 'uppercase' }}>
              Total Pages
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: C.purple, fontFamily: C.mono }}>
              {data.totalPages}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
      {/* Orphan Endpoints */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px 0', color: data.orphanEndpoints.length > 0 ? C.red : C.green, fontFamily: C.font }}>
          Orphan Endpoints {data.orphanEndpoints.length > 0 && <span style={{ color: C.red }}>({data.orphanEndpoints.length})</span>}
        </h3>
        <div style={{ fontSize: '13px', color: C.textMuted }}>
          {data.orphanEndpoints.length === 0 ? (
            <span style={{ color: C.green }}>✓ All endpoints have consumers</span>
          ) : (
            <ul style={{ margin: '0', paddingLeft: '20px' }}>
              {data.orphanEndpoints.slice(0, 5).map((ep, i) => (
                <li key={i} style={{ color: C.textDim, fontFamily: C.mono, fontSize: '12px', marginBottom: '4px' }}>
                  {ep}
                </li>
              ))}
              {data.orphanEndpoints.length > 5 && <li style={{ color: C.textMuted }}>...and {data.orphanEndpoints.length - 5} more</li>}
            </ul>
          )}
        </div>
      </div>

      {/* Orphan Pages */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px 0', color: data.orphanPages.length > 0 ? C.red : C.green, fontFamily: C.font }}>
          Orphan Pages {data.orphanPages.length > 0 && <span style={{ color: C.red }}>({data.orphanPages.length})</span>}
        </h3>
        <div style={{ fontSize: '13px', color: C.textMuted }}>
          {data.orphanPages.length === 0 ? (
            <span style={{ color: C.green }}>✓ All pages have backend support</span>
          ) : (
            <ul style={{ margin: '0', paddingLeft: '20px' }}>
              {data.orphanPages.slice(0, 5).map((page, i) => (
                <li key={i} style={{ color: C.textDim, fontFamily: C.mono, fontSize: '12px', marginBottom: '4px' }}>
                  {page}
                </li>
              ))}
              {data.orphanPages.length > 5 && <li style={{ color: C.textMuted }}>...and {data.orphanPages.length - 5} more</li>}
            </ul>
          )}
        </div>
      </div>
    </div>

    {/* Duplicate Routes Warning */}
    {data.duplicateRoutes.length > 0 && (
      <div style={{ backgroundColor: '#3d2424', border: `1px solid ${C.red}`, borderRadius: '12px', padding: '16px', marginTop: '20px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: C.red, marginBottom: '8px', fontFamily: C.font }}>
          ⚠ Duplicate Route Warnings ({data.duplicateRoutes.length})
        </div>
        <div style={{ fontSize: '12px', color: C.textDim }}>
          {data.duplicateRoutes.slice(0, 3).map((route, i) => (
            <div key={i} style={{ marginBottom: '4px', fontFamily: C.mono }}>
              {route}
            </div>
          ))}
          {data.duplicateRoutes.length > 3 && <div style={{ color: C.textMuted }}>...and {data.duplicateRoutes.length - 3} more</div>}
        </div>
      </div>
    )}
  </div>
);

// Dead Code Report
const DeadCodeReport: React.FC<{ entries: DeadCodeEntry[] }> = ({ entries }) => {
  const grouped = useMemo(() => {
    const critical = entries.filter((e) => e.severity === 'critical');
    const warning = entries.filter((e) => e.severity === 'warning');
    const info = entries.filter((e) => e.severity === 'info');
    return { critical, warning, info };
  }, [entries]);

  const getSeverityColor = (severity: string) => {
    if (severity === 'critical') return C.red;
    if (severity === 'warning') return C.amber;
    return C.blue;
  };

  const renderGroup = (label: string, items: DeadCodeEntry[], color: string) => (
    <div key={label}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0', color, fontFamily: C.font }}>
        {label} ({items.length})
      </h3>
      <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
        {items.slice(0, 5).map((entry, i) => (
          <div
            key={i}
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              padding: '16px',
              borderLeft: `4px solid ${color}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div style={{ fontFamily: C.mono, fontSize: '13px', color: C.textDim, flex: 1 }}>{entry.file}</div>
              <span
                style={{
                  backgroundColor: color,
                  color: C.bg,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  fontFamily: C.mono,
                  textTransform: 'uppercase',
                  marginLeft: '12px',
                }}
              >
                {entry.type}
              </span>
            </div>
            <p style={{ margin: '8px 0', fontSize: '13px', color: C.text, fontFamily: C.font }}>
              {entry.description}
            </p>
            <div style={{ fontSize: '12px', color: C.textMuted, fontFamily: C.font, fontStyle: 'italic' }}>
              Suggestion: {entry.suggestion}
            </div>
          </div>
        ))}
        {items.length > 5 && (
          <div style={{ fontSize: '12px', color: C.textMuted, fontFamily: C.font }}>
            ... and {items.length - 5} more {label.toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '0 32px', marginBottom: '40px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 24px 0', color: C.text, fontFamily: C.font }}>
        Dead Code Report
      </h2>
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '24px' }}>
        {grouped.critical.length > 0 && renderGroup('Critical', grouped.critical, C.red)}
        {grouped.warning.length > 0 && renderGroup('Warning', grouped.warning, C.amber)}
        {grouped.info.length > 0 && renderGroup('Info', grouped.info, C.blue)}
        {entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px', color: C.green }}>
            ✓ No dead code detected
          </div>
        )}
      </div>
    </div>
  );
};

// Config Audit Grid
const ConfigAuditGrid: React.FC<{ configs: ConfigAudit[] }> = ({ configs }) => {
  const getRiskColor = (risk: string) => {
    if (risk === 'safe') return C.green;
    if (risk === 'caution') return C.amber;
    return C.red;
  };

  return (
    <div style={{ padding: '0 32px', marginBottom: '40px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 20px 0', color: C.text, fontFamily: C.font }}>
        Configuration Audit
      </h2>

      <div style={{ overflowX: 'auto', backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: C.font,
            fontSize: '13px',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '16px', textAlign: 'left', color: C.textMuted, fontWeight: 600 }}>Config Key</th>
              <th style={{ padding: '16px', textAlign: 'left', color: C.textMuted, fontWeight: 600 }}>Paper Value</th>
              <th style={{ padding: '16px', textAlign: 'left', color: C.textMuted, fontWeight: 600 }}>Live Value</th>
              <th style={{ padding: '16px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>Current</th>
              <th style={{ padding: '16px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>Risk Level</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                <td style={{ padding: '16px', color: C.textDim, fontFamily: C.mono, fontSize: '12px' }}>{config.key}</td>
                <td style={{ padding: '16px', color: C.textMuted, fontFamily: C.mono, fontSize: '12px' }}>{config.paperValue}</td>
                <td style={{ padding: '16px', color: C.textMuted, fontFamily: C.mono, fontSize: '12px' }}>{config.liveValue}</td>
                <td style={{ padding: '16px', textAlign: 'center', color: C.text, fontWeight: 500 }}>
                  <span
                    style={{
                      backgroundColor: config.current === config.liveValue ? C.green : C.amber,
                      color: C.bg,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      fontFamily: C.mono,
                    }}
                  >
                    {config.current}
                  </span>
                </td>
                <td style={{ padding: '16px', textAlign: 'center' }}>
                  <span
                    style={{
                      backgroundColor: getRiskColor(config.riskLevel),
                      color: C.bg,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      fontFamily: C.mono,
                      textTransform: 'uppercase',
                    }}
                  >
                    {config.riskLevel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Test Taxonomy Chart
const TestTaxonomyChart: React.FC<{ data: TestTaxonomy }> = ({ data }) => {
  const testTypes = [
    { name: 'Unit', value: data.unit, color: C.blue },
    { name: 'Integration', value: data.integration, color: C.green },
    { name: 'Replay', value: data.replay, color: C.purple },
    { name: 'Paper', value: data.paper, color: C.amber },
    { name: 'Chaos', value: data.chaos, color: C.red },
    { name: 'Soak', value: data.soak, color: C.textMuted },
    { name: 'E2E', value: data.e2e, color: C.cyan },
  ];

  const max = Math.max(...testTypes.map((t) => t.value), 1);
  const barHeight = 200;

  return (
    <div style={{ padding: '0 32px', marginBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: C.text, fontFamily: C.font }}>
          Test Taxonomy Breakdown
        </h2>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '13px', color: C.textMuted, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Test Health
          </div>
          <div style={{ fontSize: '32px', fontWeight: 700, color: data.health >= 80 ? C.green : data.health >= 60 ? C.amber : C.red, fontFamily: C.mono }}>
            {data.health}%
          </div>
          <div style={{ fontSize: '12px', color: C.textFaint, fontFamily: C.font }}>
            {data.totalTests} total tests
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '32px' }}>
        <svg width="100%" height={barHeight + 80} style={{ overflow: 'visible' }}>
          {testTypes.map((test, i) => {
            const barWidth = (test.value / max) * 400;
            const x = i * 65 + 30;
            const barHeightPx = (test.value / max) * barHeight;

            return (
              <g key={test.name}>
                {/* Bar */}
                <rect
                  x={x}
                  y={barHeight - barHeightPx}
                  width={50}
                  height={barHeightPx}
                  fill={test.color}
                  rx="4"
                />
                {/* Value label */}
                <text
                  x={x + 25}
                  y={barHeight - barHeightPx - 8}
                  textAnchor="middle"
                  fill={C.text}
                  fontSize="13"
                  fontWeight="600"
                  fontFamily={C.mono}
                >
                  {test.value}
                </text>
                {/* Category label */}
                <text
                  x={x + 25}
                  y={barHeight + 24}
                  textAnchor="middle"
                  fill={C.textMuted}
                  fontSize="12"
                  fontFamily={C.font}
                >
                  {test.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// Exit Criteria Checklist
const ExitCriteriaChecklist: React.FC<{ criteria: ExitCriteria[] }> = ({ criteria }) => (
  <div style={{ padding: '0 32px', marginBottom: '40px' }}>
    <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 24px 0', color: C.text, fontFamily: C.font }}>
      Exit Criteria Checklist
    </h2>

    <div style={{ display: 'grid', gap: '16px' }}>
      {criteria.map((item, i) => (
        <div
          key={i}
          style={{
            backgroundColor: C.card,
            border: `1px solid ${item.passed ? C.green : C.red}`,
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            gap: '16px',
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              fontSize: '24px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: item.passed ? C.green : C.red,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.bg,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {item.passed ? '✓' : '✗'}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px 0', color: C.text, fontFamily: C.font }}>
              {item.criteriaName}
            </h3>
            <p style={{ margin: 0, fontSize: '14px', color: C.textMuted, fontFamily: C.font }}>
              {item.details}
            </p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Main Page Component
export default function SystemAuditPage() {
  // Fetch all data
  const { data: readiness = { overallGrade: 'A', compositeScore: 92, lastAuditTime: new Date().toISOString() } } = useQuery({
    queryKey: ['truth-audit-readiness'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/readiness');
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: capabilities = [] } = useQuery({
    queryKey: ['truth-audit-capabilities'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/capabilities');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: scores = { implementationCoverage: 0, testCoverage: 0, liveExerciseRate: 0, configSafety: 0 } } = useQuery({
    queryKey: ['truth-audit-scores'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/readiness');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: endpointData = { routes: [], orphanEndpoints: [], orphanPages: [], duplicateRoutes: [], totalEndpoints: 0, totalPages: 0 } } = useQuery({
    queryKey: ['truth-audit-endpoints'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/endpoints');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: deadCode = [] } = useQuery({
    queryKey: ['truth-audit-dead-code'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/dead-code');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['truth-audit-config'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/config');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: testData = { unit: 0, integration: 0, replay: 0, paper: 0, chaos: 0, soak: 0, e2e: 0, totalTests: 0, health: 0 } } = useQuery({
    queryKey: ['truth-audit-tests'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/tests');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: exitCriteria = [] } = useQuery({
    queryKey: ['truth-audit-exit-criteria'],
    queryFn: async () => {
      const res = await fetch('/api/truth-audit/readiness');
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: '100vh', fontFamily: C.font }}>
      <Header readiness={readiness} />
      <ReadinessScoreCards scores={scores} />
      <CapabilityMatrix capabilities={capabilities} />
      <EndpointAuditPanel data={endpointData} />
      <DeadCodeReport entries={deadCode} />
      <ConfigAuditGrid configs={configs} />
      <TestTaxonomyChart data={testData} />
      <ExitCriteriaChecklist criteria={exitCriteria} />
      <div style={{ height: '64px' }} />
    </div>
  );
}
