import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAlertStream, type SSEStatus } from '../hooks/useEventSource';

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardAlt: "#141316",
  border: "#2a2a2d",
  borderFocus: "#3a3a3f",
  text: "#e2e2e6",
  textDim: "#8b8b92",
  textMuted: "#5a5a62",
  accent: "#6c5ce7",
  accentGlow: "rgba(108,92,231,0.25)",
  green: "#00e676",
  red: "#ff5252",
  yellow: "#ffd740",
  blue: "#40c4ff",
  orange: "#ff9100",
};

// Mock data functions for when API is unavailable
const getMockSummary = () => ({
  totalActive: 24,
  p1Critical: 3,
  p2High: 8,
  acknowledged: 5,
  escalated: 2,
  healthScore: 78,
});

const getMockActiveAlerts = () => [
  { id: 1, priority: "P1", category: "Market", message: "BTC volatility spike > 5%", time: "2m ago", status: "New", acknowledged: false },
  { id: 2, priority: "P2", category: "System", message: "API latency threshold exceeded", time: "5m ago", status: "New", acknowledged: false },
  { id: 3, priority: "P3", category: "Data", message: "Data ingestion lag detected", time: "12m ago", status: "In Review", acknowledged: true },
  { id: 4, priority: "P2", category: "Market", message: "ETH/USD spread widening", time: "18m ago", status: "New", acknowledged: false },
  { id: 5, priority: "P4", category: "Performance", message: "Backtest execution time slow", time: "25m ago", status: "Resolved", acknowledged: true },
];

const getMockRules = () => [
  { id: 1, name: "High Volatility Alert", category: "Market", priority: "P1", conditions: "volatility > 5% over 1h", enabled: true, triggerCount: 47, lastTriggered: "2m ago" },
  { id: 2, name: "API Response Time", category: "System", priority: "P2", conditions: "response_time > 2s", enabled: true, triggerCount: 23, lastTriggered: "8m ago" },
  { id: 3, name: "Data Quality Check", category: "Data", priority: "P3", conditions: "null_count > 5%", enabled: false, triggerCount: 156, lastTriggered: "3h ago" },
  { id: 4, name: "Drawdown Monitor", category: "Performance", priority: "P1", conditions: "portfolio_dd > 10%", enabled: true, triggerCount: 2, lastTriggered: "1d ago" },
];

const getMockChannels = () => [
  { id: 1, name: "Email", type: "email", status: "active", messagesSent: 1234, failureRate: 0.2, lastSent: "1m ago" },
  { id: 2, name: "Slack", type: "slack", status: "active", messagesSent: 5678, failureRate: 0.1, lastSent: "30s ago" },
  { id: 3, name: "PagerDuty", type: "pagerduty", status: "active", messagesSent: 89, failureRate: 0.0, lastSent: "5m ago" },
  { id: 4, name: "SMS", type: "sms", status: "inactive", messagesSent: 234, failureRate: 5.2, lastSent: "2h ago" },
];

const getMockAnomalies = () => ({
  metrics: [
    { id: 1, name: "Trade Volume", current: 1245, baseline: 890, zScore: 2.3, anomalous: true },
    { id: 2, name: "Model Latency", current: 125, baseline: 98, zScore: 1.1, anomalous: false },
    { id: 3, name: "Win Rate", current: 0.62, baseline: 0.55, zScore: 1.8, anomalous: false },
    { id: 4, name: "Drawdown %", current: 8.5, baseline: 3.2, zScore: 3.1, anomalous: true },
    { id: 5, name: "Sharpe Ratio", current: 1.2, baseline: 1.8, zScore: -2.2, anomalous: true },
  ],
  recent: [
    { id: 1, severity: "High", description: "Unusual trade clustering in BTC/USD", time: "15m ago" },
    { id: 2, severity: "Critical", description: "Model confidence drop to 62%", time: "28m ago" },
    { id: 3, severity: "Medium", description: "Data latency spike in crypto feeds", time: "1h ago" },
  ],
});

const getMockEscalation = () => [
  { level: 1, channel: "Email", delay: "0m", active: true },
  { level: 2, channel: "Slack", delay: "5m", active: true },
  { level: 3, channel: "PagerDuty", delay: "15m", active: false },
  { level: 4, channel: "Phone", delay: "30m", active: false },
];

// Convert an ISO-8601 timestamp to a short relative string like "2m ago".
// Keeps the Alert Center page compact when the backend emits real ISO times.
function toRelTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Alert Summary Banner Component
const AlertSummaryBanner = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['alertsSummary'],
    queryFn: () => fetch('/api/alerts/summary').then(r => r.json()),
    retry: false,
  });

  const summary = data || getMockSummary();

  return (
    <div style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ color: C.text, marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Alert Center Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {/* Metric Pills */}
        {[
          { label: 'Total Active', value: summary.totalActive, color: C.accent },
          { label: 'P1 Critical', value: summary.p1Critical, color: C.red },
          { label: 'P2 High', value: summary.p2High, color: C.orange },
          { label: 'Acknowledged', value: summary.acknowledged, color: C.blue },
          { label: 'Escalated', value: summary.escalated, color: C.yellow },
        ].map((metric, i) => (
          <div key={i} style={{
            background: C.cardAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            padding: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: metric.color, marginBottom: '4px' }}>{metric.value}</div>
            <div style={{ fontSize: '12px', color: C.textMuted }}>{metric.label}</div>
          </div>
        ))}
      </div>

      {/* Health Score Gauge */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', color: C.textDim, marginBottom: '8px' }}>System Health Score</div>
          <div style={{
            height: '8px',
            background: C.cardAlt,
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${summary.healthScore}%`,
              background: `linear-gradient(90deg, ${C.green} 0%, ${C.blue} 50%, ${C.orange} 100%)`,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
        <div style={{
          fontSize: '28px',
          fontWeight: '700',
          color: summary.healthScore > 80 ? C.green : summary.healthScore > 60 ? C.yellow : C.red,
          minWidth: '60px',
          textAlign: 'right',
        }}>{summary.healthScore}</div>
      </div>
    </div>
  );
};

// Active Alerts Feed Component
const ActiveAlertsFeed = () => {
  const [filterPriority, setFilterPriority] = useState('All');
  const [filterCategory, setFilterCategory] = useState('All');
  // Phase 9: SSE push (useAlertStream in the page wrapper) is the primary
  // freshness mechanism. The 30s poll is a safety net for the case where
  // the SSE connection is dropped between events or the browser tab has
  // been backgrounded long enough to miss events.
  const [refreshInterval, setRefreshInterval] = useState(30000);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['activeAlerts'],
    queryFn: () => fetch('/api/alerts/active-feed').then(r => r.json()),
    retry: false,
  });

  // The Phase 8 endpoint returns CenterAlert[] directly. Keep a defensive
  // fallback to the mock generator so the page still renders if the
  // backend is unreachable. Normalise backend ISO `triggeredAt` → `time`
  // so the existing row renderer keeps working untouched.
  const raw = Array.isArray(data) ? data : getMockActiveAlerts();
  const alerts = raw.map((a: any) => ({
    ...a,
    time: a.time ?? toRelTime(a.triggeredAt),
    status:
      a.status === 'active'
        ? 'New'
        : a.status === 'acknowledged'
          ? 'In Review'
          : a.status === 'resolved'
            ? 'Resolved'
            : a.status ?? 'New',
  }));

  useEffect(() => {
    const interval = setInterval(() => refetch(), refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, refetch]);

  const filteredAlerts = alerts.filter((a: any) => {
    const priorityMatch = filterPriority === 'All' || a.priority === filterPriority;
    const categoryMatch = filterCategory === 'All' || a.category === filterCategory;
    return priorityMatch && categoryMatch;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'P1': return C.red;
      case 'P2': return C.orange;
      case 'P3': return C.yellow;
      case 'P4': return C.blue;
      default: return C.textMuted;
    }
  };

  return (
    <div style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ color: C.text, marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Active Alerts Feed</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['All', 'P1', 'P2', 'P3', 'P4'].map(p => (
          <button key={p} onClick={() => setFilterPriority(p)} style={{
            padding: '6px 12px',
            background: filterPriority === p ? C.accent : C.cardAlt,
            color: filterPriority === p ? '#fff' : C.textDim,
            border: `1px solid ${filterPriority === p ? C.accentGlow : C.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
          }}>{p}</button>
        ))}
        {['All', 'Market', 'System', 'Data', 'Performance'].map(cat => (
          <button key={cat} onClick={() => setFilterCategory(cat)} style={{
            padding: '6px 12px',
            background: filterCategory === cat ? C.accent : C.cardAlt,
            color: filterCategory === cat ? '#fff' : C.textDim,
            border: `1px solid ${filterCategory === cat ? C.accentGlow : C.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
          }}>{cat}</button>
        ))}
      </div>

      {/* Alerts List */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '400px',
        overflowY: 'auto',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '12px',
      }}>
        {filteredAlerts.map((alert: any) => (
          <div key={alert.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            background: C.cardAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '6px',
            fontSize: '13px',
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: getPriorityColor(alert.priority),
              flexShrink: 0,
            }} />
            <div style={{
              padding: '2px 6px',
              background: getPriorityColor(alert.priority),
              color: '#000',
              borderRadius: '3px',
              fontWeight: '600',
              fontSize: '11px',
              flexShrink: 0,
            }}>{alert.priority}</div>
            <div style={{
              padding: '2px 6px',
              background: C.border,
              color: C.textDim,
              borderRadius: '3px',
              fontSize: '11px',
              flexShrink: 0,
            }}>{alert.category}</div>
            <div style={{ flex: 1, color: C.text }}>{alert.message}</div>
            <div style={{ color: C.textMuted, fontSize: '11px', flexShrink: 0 }}>{alert.time}</div>
            <div style={{
              padding: '2px 6px',
              background: alert.status === 'Resolved' ? C.green : alert.status === 'In Review' ? C.yellow : C.textMuted,
              color: '#000',
              borderRadius: '3px',
              fontSize: '11px',
              fontWeight: '600',
              flexShrink: 0,
            }}>{alert.status}</div>
            <button style={{
              padding: '4px 8px',
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              flexShrink: 0,
            }}>Ack</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// Alert Rules Manager Component
const AlertRulesManager = () => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', category: '', priority: 'P2', conditions: '' });

  const { data } = useQuery({
    queryKey: ['alertRules'],
    queryFn: () => fetch('/api/alerts/rules').then(r => r.json()),
    retry: false,
  });

  const rawRules = Array.isArray(data) ? data : getMockRules();
  const rules = rawRules.map((r: any) => ({
    ...r,
    lastTriggered:
      typeof r.lastTriggered === 'string' && r.lastTriggered.includes('T')
        ? toRelTime(r.lastTriggered)
        : r.lastTriggered,
  }));

  const handleAddRule = () => {
    setShowAddForm(false);
    setNewRule({ name: '', category: '', priority: 'P2', conditions: '' });
  };

  return (
    <div style={{ padding: '20px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ color: C.text, fontSize: '18px', fontWeight: '600' }}>Alert Rules Manager</h2>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{
          padding: '8px 16px',
          background: C.accent,
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '600',
        }}>Add Rule</button>
      </div>

      {showAddForm && (
        <div style={{
          background: C.cardAlt,
          border: `1px solid ${C.borderFocus}`,
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '12px',
        }}>
          <input placeholder="Rule Name" value={newRule.name} onChange={(e) => setNewRule({...newRule, name: e.target.value})} style={{
            padding: '8px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            fontSize: '13px',
            gridColumn: '1 / -1',
          }} />
          <input placeholder="Category" value={newRule.category} onChange={(e) => setNewRule({...newRule, category: e.target.value})} style={{
            padding: '8px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            fontSize: '13px',
          }} />
          <select value={newRule.priority} onChange={(e) => setNewRule({...newRule, priority: e.target.value})} style={{
            padding: '8px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            fontSize: '13px',
          }}>
            <option>P1</option>
            <option>P2</option>
            <option>P3</option>
            <option>P4</option>
          </select>
          <textarea placeholder="Conditions (human-readable)" value={newRule.conditions} onChange={(e) => setNewRule({...newRule, conditions: e.target.value})} style={{
            padding: '8px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            fontSize: '13px',
            gridColumn: '1 / -1',
            minHeight: '60px',
            fontFamily: 'monospace',
          }} />
          <button onClick={handleAddRule} style={{
            padding: '8px 16px',
            background: C.green,
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
          }}>Create</button>
          <button onClick={() => setShowAddForm(false)} style={{
            padding: '8px 16px',
            background: C.red,
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
          }}>Cancel</button>
        </div>
      )}

      {/* Rules Table */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '12px', textAlign: 'left', color: C.textDim, fontWeight: '600' }}>Rule Name</th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.textDim, fontWeight: '600' }}>Category</th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.textDim, fontWeight: '600' }}>Priority</th>
              <th style={{ padding: '12px', textAlign: 'left', color: C.textDim, fontWeight: '600' }}>Conditions</th>
              <th style={{ padding: '12px', textAlign: 'center', color: C.textDim, fontWeight: '600' }}>Enabled</th>
              <th style={{ padding: '12px', textAlign: 'right', color: C.textDim, fontWeight: '600' }}>Triggers</th>
              <th style={{ padding: '12px', textAlign: 'right', color: C.textDim, fontWeight: '600' }}>Last Triggered</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule: any) => (
              <tr key={rule.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '12px', color: C.text }}>{rule.name}</td>
                <td style={{ padding: '12px', color: C.textDim }}>{rule.category}</td>
                <td style={{ padding: '12px' }}>
                  <span style={{
                    padding: '2px 6px',
                    background: rule.priority === 'P1' ? C.red : rule.priority === 'P2' ? C.orange : rule.priority === 'P3' ? C.yellow : C.blue,
                    color: '#000',
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontWeight: '600',
                  }}>{rule.priority}</span>
                </td>
                <td style={{ padding: '12px', color: C.textMuted, fontSize: '12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.conditions}</td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <input type="checkbox" checked={rule.enabled} readOnly style={{ cursor: 'pointer' }} />
                </td>
                <td style={{ padding: '12px', textAlign: 'right', color: C.green, fontWeight: '600' }}>{rule.triggerCount}</td>
                <td style={{ padding: '12px', textAlign: 'right', color: C.textMuted }}>{rule.lastTriggered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Notification Channels Component
const NotificationChannels = () => {
  const { data } = useQuery({
    queryKey: ['alertChannels'],
    queryFn: () => fetch('/api/alerts/channels').then(r => r.json()),
    retry: false,
  });

  const rawChannels = Array.isArray(data) ? data : getMockChannels();
  const channels = rawChannels.map((c: any) => ({
    ...c,
    lastSent:
      typeof c.lastSent === 'string' && c.lastSent.includes('T')
        ? toRelTime(c.lastSent)
        : c.lastSent,
  }));

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'email': return '📧';
      case 'slack': return '💬';
      case 'pagerduty': return '🚨';
      case 'sms': return '📱';
      default: return '📬';
    }
  };

  return (
    <div style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ color: C.text, marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Notification Channels</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
        {channels.map((ch: any) => (
          <div key={ch.id} style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>{getChannelIcon(ch.type)}</span>
                <div>
                  <div style={{ color: C.text, fontWeight: '600', fontSize: '13px' }}>{ch.name}</div>
                  <div style={{ color: C.textMuted, fontSize: '11px' }}>{ch.type}</div>
                </div>
              </div>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: ch.status === 'active' ? C.green : C.red,
              }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
              <div>
                <div style={{ color: C.textMuted, marginBottom: '2px' }}>Messages</div>
                <div style={{ color: C.green, fontWeight: '600' }}>{ch.messagesSent}</div>
              </div>
              <div>
                <div style={{ color: C.textMuted, marginBottom: '2px' }}>Failure Rate</div>
                <div style={{ color: ch.failureRate > 1 ? C.red : C.green, fontWeight: '600' }}>{ch.failureRate.toFixed(1)}%</div>
              </div>
            </div>

            <div style={{ fontSize: '11px', color: C.textMuted }}>Last sent: {ch.lastSent}</div>

            <button style={{
              padding: '6px 12px',
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
            }}>Test Channel</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// Anomaly Detection Panel Component
const AnomalyDetectionPanel = () => {
  const { data } = useQuery({
    queryKey: ['alertAnomalies'],
    queryFn: () => fetch('/api/alerts/anomalies').then(r => r.json()),
    retry: false,
  });

  const rawAnomalies = data && data.metrics && data.recent ? data : getMockAnomalies();
  const anomalies = {
    ...rawAnomalies,
    recent: rawAnomalies.recent.map((a: any) => ({
      ...a,
      time:
        typeof a.time === 'string' && a.time.includes('T')
          ? toRelTime(a.time)
          : a.time,
    })),
  };

  return (
    <div style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ color: C.text, marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Anomaly Detection</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Monitored Metrics */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '16px',
        }}>
          <h3 style={{ color: C.textDim, fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Monitored Metrics</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {anomalies.metrics.map((m: any) => (
              <div key={m.id} style={{
                background: C.cardAlt,
                border: `1px solid ${m.anomalous ? C.red : C.border}`,
                borderRadius: '6px',
                padding: '12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: C.text, fontSize: '12px', fontWeight: '600' }}>{m.name}</div>
                    <div style={{ color: C.textMuted, fontSize: '11px' }}>Current: {m.current} (baseline: {m.baseline})</div>
                  </div>
                  {m.anomalous && (
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: C.red,
                      animation: 'pulse 2s infinite',
                    }} />
                  )}
                </div>
                <div style={{
                  height: '4px',
                  background: C.cardAlt,
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, Math.abs(m.zScore) * 30)}%`,
                    background: m.anomalous ? C.red : C.green,
                  }} />
                </div>
                <div style={{ color: C.textMuted, fontSize: '10px', marginTop: '4px' }}>z-score: {m.zScore.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Anomalies Timeline */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '16px',
        }}>
          <h3 style={{ color: C.textDim, fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Recent Anomalies</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>
            {anomalies.recent.map((a: any, idx: number) => (
              <div key={a.id} style={{
                display: 'flex',
                gap: '12px',
                position: 'relative',
              }}>
                {idx < anomalies.recent.length - 1 && (
                  <div style={{
                    position: 'absolute',
                    left: '11px',
                    top: '30px',
                    width: '1px',
                    height: '30px',
                    background: C.border,
                  }} />
                )}
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: a.severity === 'Critical' ? C.red : a.severity === 'High' ? C.orange : C.yellow,
                  border: `2px solid ${C.card}`,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, paddingTop: '2px' }}>
                  <div style={{ color: C.text, fontSize: '12px', fontWeight: '600' }}>{a.description}</div>
                  <div style={{ color: C.textMuted, fontSize: '11px' }}>
                    <span style={{
                      padding: '2px 6px',
                      background: a.severity === 'Critical' ? C.red : a.severity === 'High' ? C.orange : C.yellow,
                      color: '#000',
                      borderRadius: '2px',
                      marginRight: '8px',
                      fontWeight: '600',
                      fontSize: '10px',
                      display: 'inline-block',
                    }}>{a.severity}</span>
                    {a.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

// Escalation Timeline Component
const EscalationTimeline = () => {
  const { data } = useQuery({
    queryKey: ['alertEscalation'],
    queryFn: () => fetch('/api/alerts/escalation').then(r => r.json()),
    retry: false,
  });

  const escalation = Array.isArray(data) ? data : getMockEscalation();

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ color: C.text, marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Escalation Timeline</h2>
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '24px',
        position: 'relative',
      }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '24px',
          bottom: '24px',
          width: '2px',
          background: C.border,
          transform: 'translateX(-1px)',
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {escalation.map((level: any, idx: number) => (
            <div key={level.level} style={{
              display: 'flex',
              gap: '24px',
              alignItems: 'center',
            }}>
              {/* Left content */}
              <div style={{ flex: 1, textAlign: 'right' }}>
                {idx % 2 === 0 ? (
                  <div>
                    <div style={{ color: C.text, fontWeight: '600', fontSize: '13px' }}>{level.channel}</div>
                    <div style={{ color: C.textMuted, fontSize: '12px' }}>Delay: {level.delay}</div>
                  </div>
                ) : null}
              </div>

              {/* Center node */}
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: level.active ? C.green : C.border,
                border: `2px solid ${level.active ? C.accentGlow : C.border}`,
                position: 'relative',
                zIndex: 2,
                flexShrink: 0,
              }} />

              {/* Right content */}
              <div style={{ flex: 1 }}>
                {idx % 2 === 1 ? (
                  <div>
                    <div style={{ color: C.text, fontWeight: '600', fontSize: '13px' }}>{level.channel}</div>
                    <div style={{ color: C.textMuted, fontSize: '12px' }}>Delay: {level.delay}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Phase 9: Live SSE connection status badge ────────────────────────
// Shown in the page header so operators can tell at a glance whether the
// page is receiving push updates from the api-server or falling back to
// the 30s polling safety net.
const STATUS_COPY: Record<SSEStatus, { label: string; dot: string; text: string }> = {
  connected:    { label: 'Live',         dot: C.green,    text: C.green    },
  connecting:   { label: 'Connecting…',  dot: C.yellow,   text: C.yellow   },
  disconnected: { label: 'Offline',      dot: C.textMuted, text: C.textDim },
  error:        { label: 'Reconnecting', dot: C.red,      text: C.red     },
};

function LiveConnectionBadge({ status, eventCount }: { status: SSEStatus; eventCount: number }) {
  const copy = STATUS_COPY[status];
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: 600,
      color: copy.text,
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: copy.dot,
        boxShadow: status === 'connected' ? `0 0 6px ${C.green}` : 'none',
        animation: status === 'connected' ? 'gvLivePulse 2s infinite' : 'none',
      }} />
      <span>{copy.label}</span>
      <span style={{ color: C.textMuted, fontWeight: 500 }}>·</span>
      <span style={{ color: C.textMuted, fontWeight: 500 }}>
        {eventCount} event{eventCount === 1 ? '' : 's'}
      </span>
      <style>{`
        @keyframes gvLivePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

// Main Page Component
export default function AlertCenterPage() {
  // Phase 9: subscribe to the api-server's `/api/alerts/stream` SSE
  // channel. Every `fireAlert()` on the backend AND every Phase 5
  // scheduler event (promotion eligibility, calibration freshness,
  // ensemble drift, SLO burn-rate breach, …) is published through
  // `SignalStreamHub.publishAlert` → this hook's subscription.
  //
  // On each incoming event we invalidate the React Query caches that
  // back the Alert Center widgets so they refetch immediately instead
  // of waiting for the 30s safety-net poll. This gives the dashboard
  // effectively zero-lag updates under normal conditions and a
  // graceful degradation to 30s polling if the SSE channel drops.
  const { status, eventCount } = useAlertStream(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (eventCount === 0) return;
    queryClient.invalidateQueries({ queryKey: ['activeAlerts'] });
    queryClient.invalidateQueries({ queryKey: ['alertsSummary'] });
    queryClient.invalidateQueries({ queryKey: ['alertAnomalies'] });
    queryClient.invalidateQueries({ queryKey: ['alertRules'] });
    queryClient.invalidateQueries({ queryKey: ['alertChannels'] });
    queryClient.invalidateQueries({ queryKey: ['alertEscalation'] });
  }, [eventCount, queryClient]);

  return (
    <div style={{
      background: C.bg,
      color: C.text,
      minHeight: '100vh',
      overflow: 'auto',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '20px 20px 0 20px',
      }}>
        <LiveConnectionBadge status={status} eventCount={eventCount} />
      </div>
      <AlertSummaryBanner />
      <ActiveAlertsFeed />
      <AlertRulesManager />
      <NotificationChannels />
      <AnomalyDetectionPanel />
      <EscalationTimeline />
    </div>
  );
}
