import React, { useMemo, useState } from 'react';
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
interface FailsafeState {
  mode: 'normal' | 'degraded' | 'emergency' | 'lockdown';
  canTrade: boolean;
  reconciliationScore: number;
  sizeMultiplier: number;
  escalationLevel: number;
  activeFailures: string[];
  timeInMode: number;
  minStabilityTimer: number;
}

interface OrderState {
  pending: number;
  submitted: number;
  filled: number;
  failed: number;
  cancelled: number;
  duplicate: number;
}

interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  state: string;
  retries: number;
  age: number;
}

interface ReconResult {
  timestamp: number;
  matched: number;
  mismatched: number;
  missing: number;
  score: number;
  discrepancies: Discrepancy[];
  positionMismatches: PositionMismatch[];
}

interface Discrepancy {
  id: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  amount?: number;
}

interface PositionMismatch {
  symbol: string;
  internal: number;
  broker: number;
  delta: number;
}

interface FailsafeRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
  triggerCount: number;
  lastTriggered: number | null;
}

interface Settlement {
  id: string;
  symbol: string;
  qty: number;
  settlementDate: string;
  status: 'pending' | 'settled' | 'failed';
}

interface FailureEvent {
  id: string;
  timestamp: number;
  type: string;
  severity: 'warning' | 'critical';
  duration: number;
  actions: string[];
  resolution: string;
}

// Sparkline component
const Sparkline: React.FC<{ values: number[]; color: string }> = ({ values, color }) => {
  if (!values || values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 120;
  const height = 30;
  const points = values
    .map((v, i) => ({
      x: (i / (values.length - 1 || 1)) * width,
      y: height - ((v - min) / range) * height,
    }))
    .filter((p, i) => i === 0 || i === values.length - 1 || i % 2 === 0);
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <path d={pathData} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
};

// Header component
const Header: React.FC<{
  mode: string;
  canTrade: boolean;
  reconciliationScore: number;
}> = ({ mode, canTrade, reconciliationScore }) => {
  const modeColor =
    mode === 'normal' ? C.green : mode === 'degraded' ? C.amber : mode === 'emergency' ? C.red : C.red;
  return (
    <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: `1px solid ${C.borderLight}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: C.font, fontSize: 36, fontWeight: 700, margin: 0, color: C.text }}>
            Execution Reliability
          </h1>
          <p style={{ fontFamily: C.font, fontSize: 14, color: C.textMuted, margin: '8px 0 0 0' }}>
            Phase 111 — Fail Safe, Not Fail Blind
          </p>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              System Mode
            </div>
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: modeColor + '20',
                border: `1px solid ${modeColor}`,
                borderRadius: 4,
                fontFamily: C.mono,
                fontSize: 13,
                fontWeight: 600,
                color: modeColor,
              }}
            >
              {mode.toUpperCase()}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Can Trade
            </div>
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: canTrade ? C.green + '20' : C.red + '20',
                border: `1px solid ${canTrade ? C.green : C.red}`,
                borderRadius: 4,
                fontFamily: C.mono,
                fontSize: 13,
                fontWeight: 600,
                color: canTrade ? C.green : C.red,
              }}
            >
              {canTrade ? 'YES' : 'NO'}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Recon Score
            </div>
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: reconciliationScore >= 95 ? C.green + '20' : C.amber + '20',
                border: `1px solid ${reconciliationScore >= 95 ? C.green : C.amber}`,
                borderRadius: 4,
                fontFamily: C.mono,
                fontSize: 13,
                fontWeight: 600,
                color: reconciliationScore >= 95 ? C.green : C.amber,
              }}
            >
              {reconciliationScore}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Failsafe Status Banner
const FailsafeBanner: React.FC<{
  mode: string;
  failures: string[];
  sizeMultiplier: number;
  escalationLevel: number;
}> = ({ mode, failures, sizeMultiplier, escalationLevel }) => {
  const bgColor =
    mode === 'normal' ? C.green + '10' : mode === 'degraded' ? C.amber + '10' : mode === 'emergency' ? C.red + '10' : C.red + '15';
  const borderColor =
    mode === 'normal' ? C.green : mode === 'degraded' ? C.amber : mode === 'emergency' ? C.red : C.red;
  const dotColor = borderColor;

  return (
    <div
      style={{
        padding: 20,
        backgroundColor: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        marginBottom: 32,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: failures.length > 0 ? 16 : 0 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: dotColor,
            boxShadow: `0 0 8px ${dotColor}`,
          }}
        />
        <div>
          <div style={{ fontFamily: C.font, fontSize: 14, fontWeight: 600, color: C.text }}>
            {mode === 'normal'
              ? 'System Normal — All Safeguards Active'
              : mode === 'degraded'
                ? 'System Degraded — Reduced Position Sizing'
                : 'System Emergency — Trading Disabled'}
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Size Multiplier: {(sizeMultiplier * 100).toFixed(0)}% • Escalation Level: {escalationLevel}
          </div>
        </div>
      </div>
      {failures.length > 0 && (
        <div style={{ paddingLeft: 24 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.amber, marginBottom: 8, fontWeight: 600 }}>
            ACTIVE FAILURES:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {failures.map((failure, i) => (
              <div
                key={i}
                style={{
                  padding: '4px 10px',
                  backgroundColor: C.red + '20',
                  border: `1px solid ${C.red}`,
                  borderRadius: 3,
                  fontFamily: C.mono,
                  fontSize: 11,
                  color: C.red,
                }}
              >
                {failure}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Order Lifecycle Panel
const OrderLifecyclePanel: React.FC<{ orderState: OrderState; orders: Order[] }> = ({ orderState, orders }) => {
  const total = orderState.pending + orderState.submitted + orderState.filled + orderState.failed + orderState.cancelled;
  const states = [
    { label: 'Pending', count: orderState.pending, color: C.blue },
    { label: 'Submitted', count: orderState.submitted, color: C.purple },
    { label: 'Filled', count: orderState.filled, color: C.green },
    { label: 'Failed', count: orderState.failed, color: C.red },
    { label: 'Cancelled', count: orderState.cancelled, color: C.amber },
  ];

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Order Lifecycle
      </h2>

      {/* State distribution bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', height: 32, borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
          {states.map((s) => (
            <div
              key={s.label}
              style={{
                flex: s.count / (total || 1),
                backgroundColor: s.color + '40',
                borderRight: `1px solid ${C.border}`,
              }}
            />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {states.map((s) => (
            <div key={s.label}>
              <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 600, color: s.color }}>
                {s.count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent orders table */}
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Recent Orders
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                {['ID', 'Symbol', 'Side', 'Type', 'State', 'Retries', 'Age'].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: C.mono,
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.textMuted,
                      textAlign: 'left',
                      padding: '8px 12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 8).map((o) => (
                <tr key={o.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ fontFamily: C.mono, fontSize: 12, color: C.blue, padding: '10px 12px' }}>{o.id.slice(0, 8)}</td>
                  <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px' }}>{o.symbol}</td>
                  <td
                    style={{
                      fontFamily: C.mono,
                      fontSize: 12,
                      color: o.side === 'BUY' ? C.green : C.red,
                      padding: '10px 12px',
                      fontWeight: 600,
                    }}
                  >
                    {o.side}
                  </td>
                  <td style={{ fontFamily: C.mono, fontSize: 12, color: C.textDim, padding: '10px 12px' }}>{o.type}</td>
                  <td
                    style={{
                      fontFamily: C.mono,
                      fontSize: 12,
                      color:
                        o.state === 'filled' ? C.green : o.state === 'failed' ? C.red : o.state === 'cancelled' ? C.amber : C.blue,
                      padding: '10px 12px',
                      fontWeight: 500,
                    }}
                  >
                    {o.state}
                  </td>
                  <td style={{ fontFamily: C.mono, fontSize: 12, color: o.retries > 0 ? C.amber : C.textDim, padding: '10px 12px' }}>
                    {o.retries}
                  </td>
                  <td style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted, padding: '10px 12px' }}>
                    {o.age}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.borderLight}` }}>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Duplicate Rejections
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 600, color: orderState.duplicate > 0 ? C.amber : C.green }}>
            {orderState.duplicate}
          </div>
        </div>
      </div>
    </div>
  );
};

// Reconciliation Dashboard
const ReconciliationDashboard: React.FC<{ recon: ReconResult }> = ({ recon }) => {
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Reconciliation Dashboard
      </h2>

      {/* Recon score gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Matched
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.green }}>{recon.matched}</div>
        </div>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Mismatched
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.amber }}>{recon.mismatched}</div>
        </div>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Missing
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.red }}>{recon.missing}</div>
        </div>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Score
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: recon.score >= 95 ? C.green : C.amber }}>
            {recon.score}%
          </div>
        </div>
      </div>

      {/* Discrepancies */}
      {recon.discrepancies.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Discrepancies
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recon.discrepancies.slice(0, 5).map((d) => (
              <div
                key={d.id}
                style={{
                  padding: 12,
                  backgroundColor: C.cardAlt,
                  border: `1px solid ${C.borderLight}`,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: d.severity === 'high' ? C.red : d.severity === 'medium' ? C.amber : C.blue,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: C.mono, fontSize: 12, color: C.text }}>{d.description}</div>
                </div>
                {d.amount !== undefined && (
                  <div style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted }}>
                    {d.amount > 0 ? '+' : ''}
                    {d.amount.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Position mismatches */}
      {recon.positionMismatches.length > 0 && (
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Position Mismatches
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  {['Symbol', 'Internal Qty', 'Broker Qty', 'Delta'].map((h) => (
                    <th
                      key={h}
                      style={{
                        fontFamily: C.mono,
                        fontSize: 11,
                        fontWeight: 600,
                        color: C.textMuted,
                        textAlign: 'left',
                        padding: '8px 12px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recon.positionMismatches.map((pm) => (
                  <tr key={pm.symbol} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <td style={{ fontFamily: C.mono, fontSize: 12, color: C.blue, padding: '10px 12px', fontWeight: 600 }}>
                      {pm.symbol}
                    </td>
                    <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px' }}>
                      {pm.internal.toFixed(2)}
                    </td>
                    <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px' }}>
                      {pm.broker.toFixed(2)}
                    </td>
                    <td
                      style={{
                        fontFamily: C.mono,
                        fontSize: 12,
                        color: Math.abs(pm.delta) < 0.01 ? C.green : C.red,
                        padding: '10px 12px',
                        fontWeight: 600,
                      }}
                    >
                      {pm.delta > 0 ? '+' : ''}
                      {pm.delta.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// Retry & Cancel Stats
const RetryStats: React.FC<{ orders: Order[] }> = ({ orders }) => {
  const totalRetries = orders.reduce((sum, o) => sum + o.retries, 0);
  const retriedOrders = orders.filter((o) => o.retries > 0).length;
  const avgRetry = retriedOrders > 0 ? (totalRetries / retriedOrders).toFixed(1) : '0';

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Retry & Cancel Stats
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Total Retries
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: totalRetries > 5 ? C.amber : C.green }}>
            {totalRetries}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Retried Orders
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.purple }}>
            {retriedOrders}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Avg Retries/Order
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.blue }}>
            {avgRetry}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Orphan Orders
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.blue }}>
            0
          </div>
        </div>
      </div>
    </div>
  );
};

// Settlement Tracker
const SettlementTracker: React.FC<{ settlements: Settlement[] }> = ({ settlements }) => {
  const pending = settlements.filter((s) => s.status === 'pending').length;
  const settled = settlements.filter((s) => s.status === 'settled').length;
  const failed = settlements.filter((s) => s.status === 'failed').length;

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Settlement Tracker
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Pending
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.blue }}>{pending}</div>
        </div>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Settled
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.green }}>{settled}</div>
        </div>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 16, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Failed
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 600, color: C.red }}>{failed}</div>
        </div>
      </div>

      <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Recent Settlements
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
              {['ID', 'Symbol', 'Qty', 'Settlement Date', 'Status'].map((h) => (
                <th
                  key={h}
                  style={{
                    fontFamily: C.mono,
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.textMuted,
                    textAlign: 'left',
                    padding: '8px 12px',
                    textTransform: 'uppercase',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settlements.slice(0, 6).map((s) => (
              <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                <td style={{ fontFamily: C.mono, fontSize: 12, color: C.blue, padding: '10px 12px' }}>{s.id.slice(0, 8)}</td>
                <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px' }}>{s.symbol}</td>
                <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px' }}>
                  {s.qty.toFixed(2)}
                </td>
                <td style={{ fontFamily: C.mono, fontSize: 12, color: C.textDim, padding: '10px 12px' }}>
                  {s.settlementDate}
                </td>
                <td
                  style={{
                    fontFamily: C.mono,
                    fontSize: 12,
                    color: s.status === 'settled' ? C.green : s.status === 'failed' ? C.red : C.blue,
                    padding: '10px 12px',
                    fontWeight: 600,
                  }}
                >
                  {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Failsafe Rules Grid
const FailsafeRulesGrid: React.FC<{ rules: FailsafeRule[]; onToggle: (ruleId: string) => void }> = ({ rules, onToggle }) => {
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Failsafe Rules
      </h2>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
              {['Rule', 'Trigger', 'Action', 'Status', 'Triggers', 'Last Triggered'].map((h) => (
                <th
                  key={h}
                  style={{
                    fontFamily: C.mono,
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.textMuted,
                    textAlign: 'left',
                    padding: '8px 12px',
                    textTransform: 'uppercase',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px', fontWeight: 500 }}>
                  {r.name}
                </td>
                <td style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, padding: '10px 12px' }}>
                  {r.trigger.slice(0, 20)}...
                </td>
                <td style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, padding: '10px 12px' }}>
                  {r.action.slice(0, 15)}...
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <button
                    onClick={() => onToggle(r.id)}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: r.enabled ? C.green + '20' : C.red + '20',
                      border: `1px solid ${r.enabled ? C.green : C.red}`,
                      borderRadius: 3,
                      fontFamily: C.mono,
                      fontSize: 11,
                      fontWeight: 600,
                      color: r.enabled ? C.green : C.red,
                      cursor: 'pointer',
                    }}
                  >
                    {r.enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                </td>
                <td style={{ fontFamily: C.mono, fontSize: 12, color: C.text, padding: '10px 12px' }}>
                  {r.triggerCount}
                </td>
                <td style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, padding: '10px 12px' }}>
                  {r.lastTriggered ? new Date(r.lastTriggered).toLocaleTimeString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Recovery Timeline
const RecoveryTimeline: React.FC<{ mode: string; timeInMode: number; minStabilityTimer: number }> = ({
  mode,
  timeInMode,
  minStabilityTimer,
}) => {
  if (mode === 'normal') return null;

  const stages = ['lockdown', 'emergency', 'degraded', 'normal'];
  const currentIndex = stages.indexOf(mode);

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Recovery Timeline
      </h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {stages.map((stage, i) => (
          <React.Fragment key={stage}>
            {i > 0 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: i <= currentIndex ? C.amber : C.borderLight,
                }}
              />
            )}
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  backgroundColor: i <= currentIndex ? C.amber + '30' : C.cardAlt,
                  border: `2px solid ${i <= currentIndex ? C.amber : C.borderLight}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i === currentIndex && (
                  <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: C.amber }} />
                )}
              </div>
              <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 8, textTransform: 'uppercase' }}>
                {stage}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 12, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase' }}>
            Time in {mode}
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 600, color: C.amber }}>
            {Math.floor(timeInMode / 1000)}s
          </div>
        </div>
        <div style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.borderLight}`, padding: 12, borderRadius: 6 }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase' }}>
            Min Stability Timer
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 600, color: C.blue }}>
            {Math.max(0, minStabilityTimer - timeInMode)}ms
          </div>
        </div>
      </div>
    </div>
  );
};

// Failure History
const FailureHistory: React.FC<{ events: FailureEvent[] }> = ({ events }) => {
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
      <h2 style={{ fontFamily: C.font, fontSize: 18, fontWeight: 600, margin: '0 0 20px 0', color: C.text }}>
        Failure History
      </h2>

      {events.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: C.textMuted }}>
          <div style={{ fontFamily: C.mono, fontSize: 13 }}>No failure events in last 24 hours</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.slice(0, 6).map((e) => (
            <div
              key={e.id}
              style={{
                padding: 16,
                backgroundColor: C.cardAlt,
                border: `1px solid ${C.borderLight}`,
                borderRadius: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontFamily: C.font, fontSize: 13, fontWeight: 600, color: C.text }}>
                    {e.type}
                  </div>
                  <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {new Date(e.timestamp).toLocaleString()}
                  </div>
                </div>
                <div
                  style={{
                    padding: '4px 10px',
                    backgroundColor: e.severity === 'critical' ? C.red + '20' : C.amber + '20',
                    border: `1px solid ${e.severity === 'critical' ? C.red : C.amber}`,
                    borderRadius: 3,
                    fontFamily: C.mono,
                    fontSize: 10,
                    fontWeight: 600,
                    color: e.severity === 'critical' ? C.red : C.amber,
                  }}
                >
                  {e.severity.toUpperCase()}
                </div>
              </div>
              <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, marginBottom: 8 }}>
                Duration: {(e.duration / 1000).toFixed(1)}s
              </div>
              <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Actions taken:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {e.actions.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '2px 8px',
                      backgroundColor: C.blue + '20',
                      border: `1px solid ${C.blue}`,
                      borderRadius: 2,
                      fontFamily: C.mono,
                      fontSize: 10,
                      color: C.blue,
                    }}
                  >
                    {a}
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: C.mono, fontSize: 11, color: C.green, marginTop: 8 }}>
                ✓ {e.resolution}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Main page
export default function ExecReliabilityPage() {
  const [selectedRule, setSelectedRule] = useState<string | null>(null);

  // Fetch all data
  const stateQuery = useQuery({
    queryKey: ['exec-reliability', 'state'],
    queryFn: async () => {
      const res = await fetch('/api/exec-reliability/state');
      return res.json() as Promise<FailsafeState>;
    },
    refetchInterval: 5000,
  });

  const ordersQuery = useQuery({
    queryKey: ['exec-reliability', 'orders'],
    queryFn: async () => {
      const res = await fetch('/api/exec-reliability/orders');
      return res.json() as Promise<{ state: OrderState; orders: Order[] }>;
    },
    refetchInterval: 5000,
  });

  const reconQuery = useQuery({
    queryKey: ['exec-reliability', 'reconciliation'],
    queryFn: async () => {
      const res = await fetch('/api/exec-reliability/reconciliation');
      return res.json() as Promise<ReconResult>;
    },
    refetchInterval: 15000,
  });

  const rulesQuery = useQuery({
    queryKey: ['exec-reliability', 'rules'],
    queryFn: async () => {
      const res = await fetch('/api/exec-reliability/rules');
      return res.json() as Promise<FailsafeRule[]>;
    },
    refetchInterval: 30000,
  });

  const settlementsQuery = useQuery({
    queryKey: ['exec-reliability', 'settlements'],
    queryFn: async () => {
      const res = await fetch('/api/exec-reliability/settlements');
      return res.json() as Promise<Settlement[]>;
    },
    refetchInterval: 15000,
  });

  const historyQuery = useQuery({
    queryKey: ['exec-reliability', 'history'],
    queryFn: async () => {
      const res = await fetch('/api/exec-reliability/history');
      return res.json() as Promise<FailureEvent[]>;
    },
    refetchInterval: 30000,
  });

  const isLoading =
    stateQuery.isLoading ||
    ordersQuery.isLoading ||
    reconQuery.isLoading ||
    rulesQuery.isLoading ||
    settlementsQuery.isLoading ||
    historyQuery.isLoading;

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: C.textMuted, fontFamily: C.mono }}>
        Loading execution reliability data...
      </div>
    );
  }

  const state = stateQuery.data!;
  const { state: orderState, orders } = ordersQuery.data!;
  const recon = reconQuery.data!;
  const rules = rulesQuery.data!;
  const settlements = settlementsQuery.data!;
  const history = historyQuery.data!;

  const handleToggleRule = async (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    try {
      await fetch(`/api/exec-reliability/rules/${ruleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      // Refetch rules
      rulesQuery.refetch();
    } catch (e) {
      console.error('Failed to toggle rule:', e);
    }
  };

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, fontFamily: C.font, minHeight: '100vh', padding: 32 }}>
      <Header mode={state.mode} canTrade={state.canTrade} reconciliationScore={state.reconciliationScore} />

      <FailsafeBanner
        mode={state.mode}
        failures={state.activeFailures}
        sizeMultiplier={state.sizeMultiplier}
        escalationLevel={state.escalationLevel}
      />

      <OrderLifecyclePanel orderState={orderState} orders={orders} />

      <ReconciliationDashboard recon={recon} />

      <RetryStats orders={orders} />

      <SettlementTracker settlements={settlements} />

      <FailsafeRulesGrid rules={rules} onToggle={handleToggleRule} />

      <RecoveryTimeline mode={state.mode} timeInMode={state.timeInMode} minStabilityTimer={state.minStabilityTimer} />

      <FailureHistory events={history} />
    </div>
  );
}
