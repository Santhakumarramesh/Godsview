'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { safeLocale } from "@/lib/safe";

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
interface FeedHealth {
  feedId: string;
  feedName: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  latencyMs: number;
  ticksPerSec: number;
  clockSkew: number;
  isActive: boolean;
}

interface ValidationStats {
  totalProcessed: number;
  totalAccepted: number;
  totalRejected: number;
  totalCorrected: number;
  rejectionRate: number;
  rejectionTrend: number;
  breakdown: {
    type: string;
    count: number;
    percentage: number;
    severity: 'low' | 'medium' | 'high';
  }[];
}

interface StaleSymbol {
  symbol: string;
  lastPrice: number;
  lastUpdate: string;
  source: string;
  stalenessPercent: number;
  threshold: number;
}

interface SessionState {
  exchange: string;
  state: 'pre-market' | 'regular' | 'after-hours' | 'closed';
  nextOpenTime: string;
  isHoliday: boolean;
}

interface Snapshot {
  id: string;
  timestamp: string;
  eventCount: number;
  symbolCount: number;
  symbols?: string[];
}

interface StoreStats {
  bufferUtilization: number;
  eventsStored: number;
  oldestEvent: string;
  newestEvent: string;
  throughput: number;
  integrityStatus: { symbol: string; status: 'pass' | 'fail' }[];
}

interface CandleCheck {
  symbol: string;
  timestamp: string;
  high: number;
  low: number;
  close: number;
  volume: number;
  flags: string[];
}

interface HealthResponse {
  overall: 'healthy' | 'degraded' | 'critical';
  message: string;
  checkedAt: string;
}

// Component: Status Indicator Dot
const StatusDot = ({ status }: { status: 'healthy' | 'degraded' | 'down' }) => {
  const color = status === 'healthy' ? C.green : status === 'degraded' ? C.amber : C.red;
  const pulse = status !== 'healthy';
  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}80`,
        animation: pulse ? 'pulse 2s infinite' : 'none',
      }}
    />
  );
};

// Component: Header Section
const HeaderSection = ({
  feeds,
  validationStats,
}: {
  feeds: FeedHealth[];
  validationStats: ValidationStats;
}) => {
  const overallStatus =
    feeds.some((f) => f.status === 'down') || validationStats.rejectionRate > 5
      ? 'critical'
      : feeds.some((f) => f.status === 'degraded') || validationStats.rejectionRate > 2
        ? 'degraded'
        : 'healthy';

  const statusColor =
    overallStatus === 'healthy' ? C.green : overallStatus === 'degraded' ? C.amber : C.red;

  const totalTicks = validationStats.totalProcessed;
  const rejectionRate = validationStats.rejectionRate;

  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: C.text,
              margin: '0 0 8px 0',
              fontFamily: C.font,
            }}
          >
            Market Data Integrity
          </h1>
          <p
            style={{
              fontSize: 14,
              color: C.textMuted,
              margin: 0,
              fontFamily: C.font,
            }}
          >
            Phase 109 — Trust Your Inputs
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 32,
            alignItems: 'center',
            paddingLeft: 32,
            borderLeft: `1px solid ${C.borderLight}`,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <StatusDot status={feeds[0]?.status || 'down'} />
              <span
                style={{
                  fontSize: 13,
                  color: statusColor,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  fontFamily: C.font,
                }}
              >
                {overallStatus}
              </span>
            </div>
            <p
              style={{
                fontSize: 12,
                color: C.textMuted,
                margin: 0,
                fontFamily: C.font,
              }}
            >
              Feed Health
            </p>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.text,
                marginBottom: 4,
                fontFamily: C.mono,
              }}
            >
              {safeLocale(totalTicks)}
            </div>
            <p
              style={{
                fontSize: 12,
                color: C.textMuted,
                margin: 0,
                fontFamily: C.font,
              }}
            >
              Ticks Today
            </p>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: rejectionRate > 2 ? C.amber : C.green,
                marginBottom: 4,
                fontFamily: C.mono,
              }}
            >
              {rejectionRate.toFixed(2)}%
            </div>
            <p
              style={{
                fontSize: 12,
                color: C.textMuted,
                margin: 0,
                fontFamily: C.font,
              }}
            >
              Rejection Rate
            </p>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
};

// Component: Feed Health Panel
const FeedHealthPanel = ({ feeds }: { feeds: FeedHealth[] }) => {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Feed Health
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {feeds.map((feed) => (
          <div
            key={feed.feedId}
            style={{
              padding: 16,
              backgroundColor: feed.isActive ? C.card : C.cardAlt,
              border: `1px solid ${feed.isActive ? C.border : C.borderLight}`,
              borderRadius: 8,
              transition: 'all 0.3s ease',
              cursor: feed.isActive ? 'pointer' : 'default',
              transform: feed.isActive ? 'scale(1.02)' : 'scale(1)',
              boxShadow: feed.isActive ? `inset 0 0 20px ${C.green}20` : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <StatusDot status={feed.status} />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.text,
                  flex: 1,
                  fontFamily: C.font,
                }}
              >
                {feed.feedName}
              </span>
              {feed.isActive && (
                <span
                  style={{
                    fontSize: 11,
                    backgroundColor: C.green + '20',
                    color: C.green,
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontWeight: 600,
                    fontFamily: C.font,
                  }}
                >
                  ACTIVE
                </span>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginBottom: 4,
                    fontFamily: C.font,
                  }}
                >
                  Uptime
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: C.text,
                    fontFamily: C.mono,
                  }}
                >
                  {feed.uptime.toFixed(2)}%
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginBottom: 4,
                    fontFamily: C.font,
                  }}
                >
                  Latency
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: C.text,
                    fontFamily: C.mono,
                  }}
                >
                  {feed.latencyMs.toFixed(1)}ms
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginBottom: 4,
                    fontFamily: C.font,
                  }}
                >
                  Ticks/Sec
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: C.text,
                    fontFamily: C.mono,
                  }}
                >
                  {feed.ticksPerSec.toFixed(0)}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginBottom: 4,
                    fontFamily: C.font,
                  }}
                >
                  Clock Skew
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: Math.abs(feed.clockSkew) < 100 ? C.green : C.amber,
                    fontFamily: C.mono,
                  }}
                >
                  {Math.abs(feed.clockSkew)}μs
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Component: Validation Stats Cards
const ValidationStatsSection = ({ stats }: { stats: ValidationStats }) => {
  const cards = [
    { label: 'Total Processed', value: stats.totalProcessed },
    { label: 'Total Accepted', value: stats.totalAccepted },
    { label: 'Total Rejected', value: stats.totalRejected },
    { label: 'Total Corrected', value: stats.totalCorrected },
  ];

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Tick Validation Stats
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {cards.map((card, i) => (
          <div
            key={i}
            style={{
              padding: 20,
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 8,
                fontFamily: C.font,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: C.text,
                fontFamily: C.mono,
              }}
            >
              {card.safeLocale(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Component: Rejection Breakdown Chart
const RejectionBreakdownChart = ({ breakdown }: { breakdown: ValidationStats['breakdown'] }) => {
  const total = breakdown.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(...breakdown.map((b) => b.count));

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return C.red;
      case 'medium':
        return C.amber;
      default:
        return C.blue;
    }
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Rejection Breakdown
      </h2>
      <div
        style={{
          padding: 20,
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {breakdown.map((item, i) => (
            <div key={i}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.text,
                    fontFamily: C.font,
                  }}
                >
                  {item.type}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: C.textDim,
                    fontFamily: C.mono,
                  }}
                >
                  {item.count} ({item.percentage.toFixed(1)}%)
                </span>
              </div>
              <svg width="100%" height="24" style={{ display: 'block' }}>
                <rect
                  x="0"
                  y="4"
                  width={(item.count / maxCount) * 100 + '%'}
                  height="16"
                  fill={getSeverityColor(item.severity)}
                  rx="3"
                  style={{ transition: 'width 0.3s ease' }}
                />
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Component: Stale Symbol Monitor
const StaleSymbolMonitor = ({ symbols }: { symbols: StaleSymbol[] }) => {
  const getStalenessColor = (percent: number) => {
    if (percent >= 100) return C.red;
    if (percent >= 50) return C.amber;
    return C.green;
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Stale Symbol Monitor
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {symbols.slice(0, 12).map((sym, i) => (
          <div
            key={i}
            style={{
              padding: 12,
              backgroundColor: C.cardAlt,
              border: `1px solid ${getStalenessColor(sym.stalenessPercent)}40`,
              borderRadius: 6,
              fontSize: 13,
              fontFamily: C.mono,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: C.text,
                  fontSize: 14,
                }}
              >
                {sym.symbol}
              </span>
              <span
                style={{
                  color: getStalenessColor(sym.stalenessPercent),
                  fontWeight: 600,
                }}
              >
                {sym.stalenessPercent.toFixed(0)}%
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>
                  Price
                </div>
                <div style={{ color: C.text, fontWeight: 500 }}>
                  ${sym.lastPrice.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>
                  Source
                </div>
                <div style={{ color: C.textDim }}>{sym.source}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Component: Session Awareness Panel
const SessionAwarenessPanel = ({ sessions }: { sessions: SessionState[] }) => {
  const getSessionColor = (state: string) => {
    switch (state) {
      case 'regular':
        return C.green;
      case 'pre-market':
      case 'after-hours':
        return C.amber;
      case 'closed':
        return C.textMuted;
      default:
        return C.textMuted;
    }
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Session Awareness
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {sessions.map((session, i) => (
          <div
            key={i}
            style={{
              padding: 16,
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.text,
                  fontFamily: C.font,
                }}
              >
                {session.exchange}
              </span>
              {session.isHoliday && (
                <span
                  style={{
                    fontSize: 11,
                    backgroundColor: C.amber + '20',
                    color: C.amber,
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontWeight: 600,
                    fontFamily: C.font,
                  }}
                >
                  HOLIDAY
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                color: getSessionColor(session.state),
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 10,
                fontFamily: C.font,
              }}
            >
              {session.state}
            </div>
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 2,
                fontFamily: C.font,
              }}
            >
              Next Open
            </div>
            <div
              style={{
                fontSize: 13,
                color: C.textDim,
                fontFamily: C.mono,
              }}
            >
              {session.nextOpenTime}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Component: Snapshot Browser
const SnapshotBrowser = ({ snapshots }: { snapshots: Snapshot[] }) => {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Snapshot Browser
      </h2>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {snapshots.map((snap) => (
          <div key={snap.id}>
            <div
              onClick={() => setExpandedId(expandedId === snap.id ? null : snap.id)}
              style={{
                padding: 12,
                backgroundColor: expandedId === snap.id ? C.card : C.cardAlt,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = C.card;
              }}
              onMouseLeave={(e) => {
                if (expandedId !== snap.id) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = C.cardAlt;
                }
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.text,
                    marginBottom: 4,
                    fontFamily: C.mono,
                  }}
                >
                  {snap.timestamp}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    fontFamily: C.font,
                  }}
                >
                  {snap.eventCount} events • {snap.symbolCount} symbols
                </div>
              </div>
              <div
                style={{
                  color: C.textDim,
                  fontSize: 16,
                  transition: 'transform 0.2s ease',
                  transform: expandedId === snap.id ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              >
                ▼
              </div>
            </div>

            {expandedId === snap.id && snap.symbols && (
              <div
                style={{
                  padding: 12,
                  backgroundColor: C.cardAlt,
                  borderLeft: `2px solid ${C.border}`,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                {snap.symbols.map((sym, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      backgroundColor: C.border,
                      color: C.text,
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontFamily: C.mono,
                    }}
                  >
                    {sym}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Component: Event Store Stats
const EventStoreStats = ({ stats }: { stats: StoreStats }) => {
  const integrityPassCount = stats.integrityStatus.filter((s) => s.status === 'pass').length;
  const integrityFailCount = stats.integrityStatus.filter((s) => s.status === 'fail').length;

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Event Store Stats
      </h2>
      <div
        style={{
          padding: 20,
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 20,
            marginBottom: 24,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 8,
                fontFamily: C.font,
              }}
            >
              Buffer Utilization
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.text,
                marginBottom: 8,
                fontFamily: C.mono,
              }}
            >
              {stats.bufferUtilization.toFixed(1)}%
            </div>
            <svg width="100%" height="8" style={{ display: 'block' }}>
              <rect x="0" y="0" width="100%" height="8" fill={C.borderLight} rx="4" />
              <rect
                x="0"
                y="0"
                width={Math.min(stats.bufferUtilization, 100) + '%'}
                height="8"
                fill={
                  stats.bufferUtilization > 80
                    ? C.red
                    : stats.bufferUtilization > 50
                      ? C.amber
                      : C.green
                }
                rx="4"
              />
            </svg>
          </div>

          <div>
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 8,
                fontFamily: C.font,
              }}
            >
              Events Stored
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.text,
                fontFamily: C.mono,
              }}
            >
              {stats.safeLocale(eventsStored)}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 8,
                fontFamily: C.font,
              }}
            >
              Throughput
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.text,
                fontFamily: C.mono,
              }}
            >
              {stats.throughput.toFixed(0)} evt/s
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 8,
                fontFamily: C.font,
              }}
            >
              Integrity Status
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: C.green,
                marginBottom: 4,
                fontFamily: C.mono,
              }}
            >
              {integrityPassCount} Pass
            </div>
            {integrityFailCount > 0 && (
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.red,
                  fontFamily: C.mono,
                }}
              >
                {integrityFailCount} Fail
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            paddingTop: 20,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: C.textMuted,
                  marginBottom: 6,
                  fontFamily: C.font,
                }}
              >
                Oldest Event
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: C.textDim,
                  fontFamily: C.mono,
                }}
              >
                {stats.oldestEvent}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: C.textMuted,
                  marginBottom: 6,
                  fontFamily: C.font,
                }}
              >
                Newest Event
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: C.textDim,
                  fontFamily: C.mono,
                }}
              >
                {stats.newestEvent}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Component: Candle Integrity Checker
const CandleIntegrityChecker = ({ candles }: { candles: CandleCheck[] }) => {
  const getFlagColor = (flag: string) => {
    if (flag.includes('high') || flag.includes('low')) return C.red;
    if (flag.includes('close')) return C.amber;
    return C.blue;
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: C.text,
          marginBottom: 16,
          fontFamily: C.font,
        }}
      >
        Candle Integrity Checker
      </h2>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {candles.slice(0, 10).map((candle, i) => (
          <div
            key={i}
            style={{
              padding: 12,
              backgroundColor: candle.flags.length > 0 ? C.cardAlt : C.card,
              border:
                candle.flags.length > 0
                  ? `1px solid ${C.amber}40`
                  : `1px solid ${C.border}`,
              borderRadius: 6,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.text,
                    fontFamily: C.font,
                  }}
                >
                  {candle.symbol}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginTop: 2,
                    fontFamily: C.mono,
                  }}
                >
                  {candle.timestamp}
                </div>
              </div>
              <div
                style={{
                  textAlign: 'right',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: C.text,
                    fontFamily: C.mono,
                    fontWeight: 500,
                  }}
                >
                  H:{candle.high.toFixed(2)} L:{candle.low.toFixed(2)}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textDim,
                    marginTop: 2,
                    fontFamily: C.mono,
                  }}
                >
                  C:{candle.close.toFixed(2)} V:{candle.safeLocale(volume)}
                </div>
              </div>
            </div>

            {candle.flags.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  paddingTop: 8,
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                {candle.flags.map((flag, j) => (
                  <span
                    key={j}
                    style={{
                      fontSize: 11,
                      backgroundColor: getFlagColor(flag) + '20',
                      color: getFlagColor(flag),
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontWeight: 600,
                      fontFamily: C.font,
                    }}
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Main Page Component
export default function DataIntegrityPage() {
  // Fetch all data with appropriate refresh intervals
  const { data: healthData } = useQuery({
    queryKey: ['data-integrity', 'health'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/health');
      return res.json() as Promise<HealthResponse>;
    },
    refetchInterval: 30000,
  });

  const { data: feeds = [] } = useQuery({
    queryKey: ['data-integrity', 'feeds'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/feeds');
      return res.json() as Promise<FeedHealth[]>;
    },
    refetchInterval: 10000,
  });

  const { data: validationStats } = useQuery({
    queryKey: ['data-integrity', 'validation'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/validation');
      return res.json() as Promise<ValidationStats>;
    },
    refetchInterval: 10000,
  });

  const { data: staleSymbols = [] } = useQuery({
    queryKey: ['data-integrity', 'stale'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/stale');
      return res.json() as Promise<StaleSymbol[]>;
    },
    refetchInterval: 15000,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['data-integrity', 'sessions'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/sessions');
      return res.json() as Promise<SessionState[]>;
    },
    refetchInterval: 30000,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ['data-integrity', 'snapshots'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/snapshots');
      return res.json() as Promise<Snapshot[]>;
    },
    refetchInterval: 30000,
  });

  const { data: storeStats } = useQuery({
    queryKey: ['data-integrity', 'store-stats'],
    queryFn: async () => {
      const res = await fetch('/api/data-integrity/store-stats');
      return res.json() as Promise<StoreStats>;
    },
    refetchInterval: 30000,
  });

  // Mock candle data for now (would come from API in production)
  const candles: CandleCheck[] = [
    {
      symbol: 'AAPL',
      timestamp: '2026-04-06 16:00',
      high: 150.5,
      low: 149.2,
      close: 150.1,
      volume: 4250000,
      flags: [],
    },
    {
      symbol: 'MSFT',
      timestamp: '2026-04-06 16:00',
      high: 380.2,
      low: 375.8,
      close: 379.5,
      volume: 2150000,
      flags: ['close_outside_range'],
    },
    {
      symbol: 'TSLA',
      timestamp: '2026-04-06 15:55',
      high: 180.2,
      low: 182.1,
      close: 181.0,
      volume: 3500000,
      flags: ['high_below_low'],
    },
    {
      symbol: 'GOOGL',
      timestamp: '2026-04-06 16:00',
      high: 140.1,
      low: 139.8,
      close: 140.0,
      volume: 0,
      flags: ['zero_volume'],
    },
  ];

  const mockValidationStats: ValidationStats = validationStats || {
    totalProcessed: 15234521,
    totalAccepted: 15201234,
    totalRejected: 33287,
    totalCorrected: 12847,
    rejectionRate: 0.218,
    rejectionTrend: -0.15,
    breakdown: [
      { type: 'timestamp_stale', count: 12450, percentage: 37.4, severity: 'high' },
      { type: 'price_spike', count: 8720, percentage: 26.2, severity: 'medium' },
      { type: 'duplicate', count: 6230, percentage: 18.7, severity: 'medium' },
      { type: 'sequence_gap', count: 3850, percentage: 11.6, severity: 'low' },
      { type: 'other', count: 2037, percentage: 6.1, severity: 'low' },
    ],
  };

  return (
    <div
      style={{
        backgroundColor: C.bg,
        minHeight: '100vh',
        padding: 40,
        fontFamily: C.font,
        color: C.text,
      }}
    >
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        {feeds.length > 0 && mockValidationStats && (
          <HeaderSection feeds={feeds} validationStats={mockValidationStats} />
        )}

        {/* Feed Health */}
        {feeds.length > 0 && <FeedHealthPanel feeds={feeds} />}

        {/* Validation Stats */}
        {mockValidationStats && (
          <>
            <ValidationStatsSection stats={mockValidationStats} />
            <RejectionBreakdownChart breakdown={mockValidationStats.breakdown} />
          </>
        )}

        {/* Stale Symbols */}
        {staleSymbols.length > 0 && <StaleSymbolMonitor symbols={staleSymbols} />}

        {/* Session Awareness */}
        {sessions.length > 0 && <SessionAwarenessPanel sessions={sessions} />}

        {/* Snapshots */}
        {snapshots.length > 0 && <SnapshotBrowser snapshots={snapshots} />}

        {/* Event Store Stats */}
        {storeStats && <EventStoreStats stats={storeStats} />}

        {/* Candle Integrity */}
        {candles.length > 0 && <CandleIntegrityChecker candles={candles} />}
      </div>
    </div>
  );
}
