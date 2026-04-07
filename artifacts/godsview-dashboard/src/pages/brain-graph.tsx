'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Design tokens
const C = {
  bg: '#0e0e0f',
  card: '#1a191b',
  cardHigh: '#201f21',
  border: 'rgba(72,72,73,0.25)',
  primary: '#9cff93',
  secondary: '#669dff',
  tertiary: '#ff7162',
  muted: '#adaaab',
  outline: '#767576',
  outlineVar: '#484849',
  gold: '#fbbf24',
  purple: '#a78bfa',
};

// Types
type NodeId =
  | 'tick'
  | 'timeframe'
  | 'structure'
  | 'orderflow'
  | 'context'
  | 'memory'
  | 'risk'
  | 'reasoning';

interface NodeState {
  id: NodeId;
  label: string;
  score: number;
  activeAt?: number;
  layer: number;
  x: number;
  y: number;
}

interface SignalEvent {
  id: string;
  timestamp: number;
  decision: 'APPROVE' | 'REJECT';
  score: number;
  grade: string;
  thesis: string;
  scores: Record<string, number>;
  regime: string;
  session: string;
  dataQuality: string;
  sentiment: string;
  symbol?: string;
  direction?: string;
}

interface Connection {
  from: NodeId;
  to: NodeId;
  weight: number;
}

// Node positions (SVG coordinates)
const NODE_POSITIONS: Record<NodeId, { x: number; y: number }> = {
  tick: { x: 100, y: 120 },
  timeframe: { x: 300, y: 120 },
  structure: { x: 50, y: 280 },
  orderflow: { x: 200, y: 280 },
  context: { x: 350, y: 280 },
  memory: { x: 125, y: 420 },
  risk: { x: 275, y: 420 },
  reasoning: { x: 200, y: 560 },
};

const CONNECTIONS: Connection[] = [
  { from: 'tick', to: 'structure', weight: 0.8 },
  { from: 'tick', to: 'orderflow', weight: 0.9 },
  { from: 'tick', to: 'context', weight: 0.7 },
  { from: 'timeframe', to: 'structure', weight: 0.7 },
  { from: 'timeframe', to: 'orderflow', weight: 0.8 },
  { from: 'timeframe', to: 'context', weight: 0.9 },
  { from: 'structure', to: 'memory', weight: 0.8 },
  { from: 'orderflow', to: 'memory', weight: 0.9 },
  { from: 'context', to: 'risk', weight: 0.85 },
  { from: 'memory', to: 'reasoning', weight: 0.95 },
  { from: 'risk', to: 'reasoning', weight: 0.90 },
];

const generateSyntheticSignal = (): SignalEvent => {
  const symbols = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD'];
  const grades = ['A+', 'A', 'A-', 'B+', 'B', 'C+'];
  const regimes = ['Bull', 'Bear', 'Sideways', 'Volatile'];
  const decisions: ('APPROVE' | 'REJECT')[] = ['APPROVE', 'REJECT'];

  return {
    id: `signal-${Date.now()}`,
    timestamp: Date.now(),
    decision: decisions[Math.floor(Math.random() * decisions.length)],
    score: Math.floor(Math.random() * 40 + 60),
    grade: grades[Math.floor(Math.random() * grades.length)],
    thesis: `${Math.random() > 0.5 ? 'Long' : 'Short'} bias with strong momentum`,
    symbol: symbols[Math.floor(Math.random() * symbols.length)],
    direction: Math.random() > 0.5 ? '↑' : '↓',
    scores: {
      tick: Math.random() * 100,
      timeframe: Math.random() * 100,
      structure: Math.random() * 100,
      orderflow: Math.random() * 100,
      context: Math.random() * 100,
      memory: Math.random() * 100,
    },
    regime: regimes[Math.floor(Math.random() * regimes.length)],
    session: `Session ${Math.floor(Math.random() * 1000)}`,
    dataQuality: `${Math.floor(Math.random() * 40 + 60)}%`,
    sentiment: ['Bullish', 'Neutral', 'Bearish'][
      Math.floor(Math.random() * 3)
    ],
  };
};

const getNodeColor = (score: number): string => {
  if (score >= 75) return C.primary; // green
  if (score >= 50) return C.gold; // yellow
  return C.tertiary; // red
};

const BrainNode: React.FC<{
  node: NodeState;
  isActive: boolean;
  currentTime: number;
}> = ({ node, isActive, currentTime }) => {
  const timeSinceActive = node.activeAt ? currentTime - node.activeAt : Infinity;
  const pulsePhase = isActive ? ((currentTime % 600) / 600) * Math.PI * 2 : 0;
  const pulseOpacity = isActive
    ? 0.3 + Math.abs(Math.sin(pulsePhase)) * 0.7
    : 0.5;

  const color = getNodeColor(node.score);
  const glowIntensity = isActive ? 3 : 1;

  return (
    <g key={node.id}>
      {/* Glow effect */}
      <circle
        cx={node.x}
        cy={node.y}
        r={35}
        fill={color}
        opacity={isActive ? pulseOpacity * 0.2 : 0}
        filter="url(#glow)"
      />
      {/* Node circle */}
      <circle
        cx={node.x}
        cy={node.y}
        r={28}
        fill={C.card}
        stroke={color}
        strokeWidth={isActive ? 2.5 : 1.5}
        opacity={0.9}
        style={{
          transition: 'stroke-width 0.3s ease',
          filter: isActive ? `drop-shadow(0 0 8px ${color})` : 'none',
        }}
      />
      {/* Label */}
      <text
        x={node.x}
        y={node.y - 8}
        textAnchor="middle"
        fill={C.muted}
        fontSize="11"
        fontWeight="600"
      >
        {node.label}
      </text>
      {/* Score */}
      <text
        x={node.x}
        y={node.y + 10}
        textAnchor="middle"
        fill={color}
        fontSize="14"
        fontWeight="bold"
      >
        {Math.round(node.score)}
      </text>
    </g>
  );
};

const AnimatedConnection: React.FC<{
  from: NodeState;
  to: NodeState;
  weight: number;
  isActive: boolean;
  currentTime: number;
  color: string;
}> = ({ from, to, weight, isActive, currentTime, color }) => {
  const length = Math.sqrt(
    Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2)
  );

  // Animated particles flowing along the path
  const particles = isActive ? [0, 0.33, 0.66] : [];
  const particlePhase = (currentTime / 800) % 1;

  return (
    <g key={`${from.id}-${to.id}`}>
      {/* Base line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={C.outlineVar}
        strokeWidth={Math.max(0.5, weight * 2)}
        opacity={0.4}
      />

      {/* Active signal line */}
      {isActive && (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={Math.max(1, weight * 2)}
          opacity={0.7}
          style={{
            filter: `drop-shadow(0 0 4px ${color})`,
          }}
        />
      )}

      {/* Animated particles */}
      {particles.map((offset, idx) => {
        const progress = (particlePhase + offset) % 1;
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;

        return (
          <circle
            key={`particle-${idx}`}
            cx={x}
            cy={y}
            r={2}
            fill={color}
            opacity={isActive ? 0.8 - progress * 0.3 : 0}
            style={{
              filter: `drop-shadow(0 0 3px ${color})`,
            }}
          />
        );
      })}
    </g>
  );
};

const DecisionCard: React.FC<{ signal: SignalEvent }> = ({ signal }) => {
  const bgColor = signal.decision === 'APPROVE' ? C.primary : C.tertiary;
  const bgOpacity = signal.decision === 'APPROVE' ? 0.15 : 0.15;

  return (
    <div
      style={{
        backgroundColor: bgColor + '26',
        border: `1px solid ${bgColor}`,
        borderRadius: '8px',
        padding: '12px 16px',
        minWidth: '180px',
        animation: 'slideInRight 0.6s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ color: bgColor, fontWeight: 'bold', fontSize: '13px' }}>
          {signal.decision}
        </div>
        <div style={{ fontSize: '24px' }}>{signal.direction || '→'}</div>
      </div>
      <div
        style={{
          color: C.muted,
          fontSize: '11px',
          marginTop: '4px',
          display: 'flex',
          gap: '8px',
        }}
      >
        <span style={{ backgroundColor: C.cardHigh, padding: '2px 6px', borderRadius: '3px' }}>
          {signal.grade}
        </span>
        <span>{signal.symbol || 'SIGNAL'}</span>
      </div>
      <div
        style={{
          color: C.gold,
          fontSize: '12px',
          fontWeight: 'bold',
          marginTop: '6px',
        }}
      >
        {signal.score}%
      </div>
    </div>
  );
};

const ScoreBreakdown: React.FC<{ signal: SignalEvent }> = ({ signal }) => {
  const dimensions = [
    { label: 'Tick', key: 'tick' },
    { label: 'Timeframe', key: 'timeframe' },
    { label: 'Structure', key: 'structure' },
    { label: 'Orderflow', key: 'orderflow' },
    { label: 'Context', key: 'context' },
    { label: 'Memory', key: 'memory' },
  ];

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}
    >
      <div style={{ color: C.primary, fontSize: '13px', fontWeight: 'bold', marginBottom: '12px' }}>
        Live Score Breakdown
      </div>

      {dimensions.map((dim) => {
        const score = signal.scores[dim.key] || 0;
        const color = getNodeColor(score);

        return (
          <div key={dim.key} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: C.muted, fontSize: '11px' }}>{dim.label}</span>
              <span style={{ color, fontSize: '11px', fontWeight: 'bold' }}>
                {Math.round(score)}
              </span>
            </div>
            <div
              style={{
                backgroundColor: C.cardHigh,
                borderRadius: '3px',
                height: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  backgroundColor: color,
                  height: '100%',
                  width: `${score}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: '12px', paddingTop: '12px' }}>
        <div style={{ color: C.muted, fontSize: '10px', lineHeight: '1.6' }}>
          <div>
            <strong style={{ color: C.gold }}>Regime:</strong> {signal.regime}
          </div>
          <div>
            <strong style={{ color: C.secondary }}>Session:</strong> {signal.session}
          </div>
          <div>
            <strong style={{ color: C.purple }}>Data Quality:</strong>{' '}
            {signal.dataQuality}
          </div>
          <div>
            <strong style={{ color: C.tertiary }}>Sentiment:</strong> {signal.sentiment}
          </div>
        </div>
      </div>
    </div>
  );
};

export default function BrainGraphPage() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const [nodes, setNodes] = useState<Record<NodeId, NodeState>>({
    tick: { id: 'tick', label: 'Tick', score: 0, layer: 1, ...NODE_POSITIONS.tick },
    timeframe: { id: 'timeframe', label: 'Timeframe', score: 0, layer: 1, ...NODE_POSITIONS.timeframe },
    structure: { id: 'structure', label: 'Structure', score: 0, layer: 2, ...NODE_POSITIONS.structure },
    orderflow: { id: 'orderflow', label: 'Orderflow', score: 0, layer: 2, ...NODE_POSITIONS.orderflow },
    context: { id: 'context', label: 'Context', score: 0, layer: 2, ...NODE_POSITIONS.context },
    memory: { id: 'memory', label: 'Memory', score: 0, layer: 3, ...NODE_POSITIONS.memory },
    risk: { id: 'risk', label: 'Risk', score: 0, layer: 3, ...NODE_POSITIONS.risk },
    reasoning: { id: 'reasoning', label: 'Reasoning', score: 0, layer: 4, ...NODE_POSITIONS.reasoning },
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [signals, setSignals] = useState<SignalEvent[]>([]);
  const [latestSignal, setLatestSignal] = useState<SignalEvent | null>(null);
  const [activeNodes, setActiveNodes] = useState<Set<NodeId>>(new Set());

  // Animation loop
  useEffect(() => {
    const animate = () => {
      setCurrentTime((t) => t + 16); // ~60fps
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Process signal events
  const processSignal = useCallback((signal: SignalEvent) => {
    const now = currentTime;

    // Update node scores
    setNodes((prev) => {
      const updated = { ...prev };
      Object.entries(signal.scores).forEach(([key, score]) => {
        if (key in updated) {
          updated[key as NodeId] = {
            ...updated[key as NodeId],
            score: score,
            activeAt: now,
          };
        }
      });
      return updated;
    });

    // Sequence node activation
    const activationSchedule = [
      { nodes: ['tick', 'timeframe'] as NodeId[], delay: 0 },
      { nodes: ['structure', 'orderflow', 'context'] as NodeId[], delay: 200 },
      { nodes: ['memory', 'risk'] as NodeId[], delay: 400 },
      { nodes: ['reasoning'] as NodeId[], delay: 600 },
    ];

    let scheduledActive = new Set<NodeId>();

    activationSchedule.forEach(({ nodes: nodeIds, delay }) => {
      setTimeout(() => {
        setActiveNodes((prev) => {
          const next = new Set(prev);
          nodeIds.forEach((n) => next.add(n));
          return next;
        });
      }, delay);
    });

    // Fade out after animation
    setTimeout(() => {
      setActiveNodes(new Set());
    }, 2400);

    // Add to recent signals
    setSignals((prev) => [signal, ...prev].slice(0, 10));
    setLatestSignal(signal);
  }, [currentTime]);

  // SSE connection with fallback
  useEffect(() => {
    const synthTimer = setInterval(() => {
      processSignal(generateSyntheticSignal());
    }, 3000);

    try {
      const es = new EventSource('/api/mcp/stream/brain-graph');

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          processSignal(data);
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      };

      es.onerror = () => {
        console.warn('SSE connection failed, using synthetic data');
        es.close();
      };

      eventSourceRef.current = es;
    } catch (e) {
      console.warn('SSE not available, using synthetic data');
    }

    return () => {
      clearInterval(synthTimer);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [processSignal]);

  return (
    <div
      style={{
        backgroundColor: C.bg,
        color: C.muted,
        minHeight: '100vh',
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }

        svg {
          filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.5));
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            color: C.primary,
            fontSize: '28px',
            fontWeight: 'bold',
            margin: '0 0 8px 0',
          }}
        >
          God Brain
        </h1>
        <p style={{ margin: '0', color: C.outline, fontSize: '14px' }}>
          Real-time neural signal flow and decision intelligence
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '24px' }}>
        {/* Main graph area */}
        <div
          ref={canvasRef}
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
          }}
        >
          {/* Brain graph SVG */}
          <div style={{ flex: 1, minHeight: '600px' }}>
            <svg
              viewBox="0 0 400 700"
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: 'transparent',
              }}
            >
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Connections */}
              {CONNECTIONS.map((conn) => {
                const fromNode = nodes[conn.from];
                const toNode = nodes[conn.to];
                const isActive =
                  activeNodes.has(conn.from) || activeNodes.has(conn.to);

                let connColor = C.outlineVar;
                if (isActive) {
                  // Determine color based on direction
                  if (
                    (conn.from === 'tick' || conn.from === 'timeframe') &&
                    (conn.to === 'structure' ||
                      conn.to === 'orderflow' ||
                      conn.to === 'context')
                  ) {
                    connColor = C.primary;
                  } else if (
                    (conn.from === 'structure' ||
                      conn.from === 'orderflow' ||
                      conn.from === 'context') &&
                    (conn.to === 'memory' || conn.to === 'risk')
                  ) {
                    connColor = C.secondary;
                  } else if (
                    (conn.from === 'memory' || conn.from === 'risk') &&
                    conn.to === 'reasoning'
                  ) {
                    connColor = C.gold;
                  }
                }

                return (
                  <AnimatedConnection
                    key={`${conn.from}-${conn.to}`}
                    from={fromNode}
                    to={toNode}
                    weight={conn.weight}
                    isActive={isActive}
                    currentTime={currentTime}
                    color={connColor}
                  />
                );
              })}

              {/* Nodes */}
              {Object.values(nodes).map((node) => (
                <BrainNode
                  key={node.id}
                  node={node}
                  isActive={activeNodes.has(node.id)}
                  currentTime={currentTime}
                />
              ))}
            </svg>
          </div>

          {/* Recent decisions feed */}
          <div
            style={{
              borderTop: `1px solid ${C.border}`,
              paddingTop: '20px',
            }}
          >
            <div
              style={{
                color: C.primary,
                fontSize: '13px',
                fontWeight: 'bold',
                marginBottom: '12px',
              }}
            >
              Recent Decisions
            </div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                overflowX: 'auto',
                paddingBottom: '8px',
              }}
            >
              {signals.length === 0 ? (
                <div style={{ color: C.outline, fontSize: '12px' }}>
                  Waiting for signals...
                </div>
              ) : (
                signals.map((signal) => (
                  <DecisionCard key={signal.id} signal={signal} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {latestSignal ? (
            <ScoreBreakdown signal={latestSignal} />
          ) : (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                padding: '16px',
                color: C.outline,
                fontSize: '12px',
                textAlign: 'center',
              }}
            >
              No signals yet. Waiting for first event...
            </div>
          )}

          {/* Legend */}
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            <div
              style={{
                color: C.primary,
                fontSize: '13px',
                fontWeight: 'bold',
                marginBottom: '12px',
              }}
            >
              Signal Flow
            </div>
            <div style={{ fontSize: '11px', lineHeight: '1.8', color: C.muted }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '8px', height: '8px', backgroundColor: C.primary, borderRadius: '50%', marginTop: '2px' }} />
                <span>Input Layer</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '8px', height: '8px', backgroundColor: C.secondary, borderRadius: '50%', marginTop: '2px' }} />
                <span>Analysis Layer</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '8px', height: '8px', backgroundColor: C.gold, borderRadius: '50%', marginTop: '2px' }} />
                <span>Output Layer</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}