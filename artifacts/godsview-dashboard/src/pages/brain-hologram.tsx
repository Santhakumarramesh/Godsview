'use client';

/**
 * brain-hologram.tsx — Canvas 2D Neural Network Visualization
 *
 * A dynamic, neon-glowing neural network visualization showing:
 * - Symbol nodes (AAPL, TSLA, SPY) as pulsating circles with confidence glow
 * - Strategy nodes (momentum, mean-reversion, OB-retest) as smaller nodes
 * - Agent nodes (scanner, structure, orderflow, execution, risk) as hexagons
 * - Glowing connection lines showing signal flow
 * - Real-time updates via polling from /api/brain/state
 * - Interactive click-through to relevant pages
 * - Alert badges on active nodes
 * - Dark theme with neon green/yellow/red glow colors
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// @ts-expect-error - react-router-dom may not be installed in all environments
import { useNavigate } from 'react-router-dom';

// ─── Design Tokens ──────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0a0a0a',
  cardBg: '#0f0f0f',
  border: '#1a1a1a',
  glowGreen: '#00ff88',
  glowYellow: '#ffed4e',
  glowRed: '#ff4444',
  symbolText: '#e0e0e0',
  alert: '#ff6b6b',
};

const GLOW_COLORS = {
  high: COLORS.glowGreen,      // high confidence
  medium: COLORS.glowYellow,   // medium confidence
  low: COLORS.glowRed,         // low/alert confidence
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface SymbolNode {
  id: string;
  symbol: string;
  confidence: number; // 0-1
  active: boolean;
  alerts: number;
  position?: { x: number; y: number };
}

interface StrategyNode {
  id: string;
  name: string;
  strength: number; // 0-1
  position?: { x: number; y: number };
}

interface AgentNode {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'alert';
  position?: { x: number; y: number };
}

interface Connection {
  from: string;
  to: string;
  strength: number; // 0-1
}

interface BrainState {
  symbols: SymbolNode[];
  strategies: StrategyNode[];
  agents: AgentNode[];
  connections: Connection[];
  timestamp: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;

// Center positions for different node types
const CENTER = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };

// Radius for each ring
const SYMBOL_RADIUS = 220;
const STRATEGY_RADIUS = 140;
const AGENT_RADIUS = 280;

// ─── Mock Data (fallback) ──────────────────────────────────────────────────

const MOCK_BRAIN_STATE: BrainState = {
  symbols: [
    { id: 'sym1', symbol: 'AAPL', confidence: 0.92, active: true, alerts: 0 },
    { id: 'sym2', symbol: 'TSLA', confidence: 0.76, active: true, alerts: 0 },
    { id: 'sym3', symbol: 'SPY', confidence: 0.68, active: false, alerts: 1 },
    { id: 'sym4', symbol: 'NVDA', confidence: 0.85, active: true, alerts: 0 },
    { id: 'sym5', symbol: 'QQQ', confidence: 0.58, active: false, alerts: 0 },
  ],
  strategies: [
    { id: 'strat1', name: 'Momentum', strength: 0.88 },
    { id: 'strat2', name: 'Mean-Reversion', strength: 0.62 },
    { id: 'strat3', name: 'OB-Retest', strength: 0.79 },
    { id: 'strat4', name: 'Structure', strength: 0.71 },
  ],
  agents: [
    { id: 'agent1', name: 'Scanner', status: 'active' },
    { id: 'agent2', name: 'Structure', status: 'active' },
    { id: 'agent3', name: 'OrderFlow', status: 'idle' },
    { id: 'agent4', name: 'Execution', status: 'active' },
    { id: 'agent5', name: 'Risk', status: 'active' },
  ],
  connections: [
    { from: 'agent1', to: 'strat1', strength: 0.9 },
    { from: 'agent2', to: 'strat3', strength: 0.85 },
    { from: 'strat1', to: 'sym1', strength: 0.88 },
    { from: 'strat2', to: 'sym2', strength: 0.72 },
    { from: 'agent4', to: 'sym1', strength: 0.92 },
    { from: 'agent5', to: 'agent4', strength: 0.8 },
  ],
  timestamp: Date.now(),
};

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Calculate position on a circle
 */
function getCirclePosition(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle),
  };
}

/**
 * Get glow color based on confidence/strength
 */
function getGlowColor(value: number): string {
  if (value >= 0.75) return GLOW_COLORS.high;
  if (value >= 0.5) return GLOW_COLORS.medium;
  return GLOW_COLORS.low;
}

/**
 * Draw a glowing circle (symbol node)
 */
function drawSymbolNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  symbol: string,
  confidence: number,
  pulse: number,
  alerts: number,
): void {
  const glowColor = getGlowColor(confidence);
  const baseGlowSize = 15 + pulse * 5;
  const glowSize = baseGlowSize * (1 + 0.3 * Math.sin(Date.now() / 200));

  // Outer glow
  ctx.fillStyle = glowColor;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(x, y, radius + glowSize, 0, Math.PI * 2);
  ctx.fill();

  // Middle glow ring
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(x, y, radius + glowSize * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // Main circle with stroke
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0a0a0a';
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner glow circle
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(x, y, radius - 2, 0, Math.PI * 2);
  ctx.stroke();

  // Symbol text
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.symbolText;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, x, y - 4);

  // Confidence percentage below symbol
  ctx.font = '10px monospace';
  ctx.fillStyle = glowColor;
  ctx.fillText(`${Math.round(confidence * 100)}%`, x, y + 8);

  // Alert badge
  if (alerts > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.alert;
    ctx.beginPath();
    ctx.arc(x + radius * 0.7, y - radius * 0.7, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(alerts.toString(), x + radius * 0.7, y - radius * 0.7);
  }
}

/**
 * Draw strategy node (smaller, octagon-like)
 */
function drawStrategyNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  name: string,
  strength: number,
): void {
  const glowColor = getGlowColor(strength);
  const glowSize = 8 + strength * 3;

  // Glow
  ctx.fillStyle = glowColor;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(x, y, radius + glowSize, 0, Math.PI * 2);
  ctx.fill();

  // Main circle
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0a0a0a';
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Name text
  ctx.fillStyle = glowColor;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y);
}

/**
 * Draw agent node (hexagon-like)
 */
function drawAgentNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  name: string,
  status: 'active' | 'idle' | 'alert',
): void {
  const statusColor =
    status === 'alert'
      ? COLORS.alert
      : status === 'active'
        ? COLORS.glowGreen
        : '#666666';
  const glowSize = status === 'active' ? 12 : 6;

  // Glow
  ctx.fillStyle = statusColor;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(x, y, radius + glowSize, 0, Math.PI * 2);
  ctx.fill();

  // Draw hexagon
  ctx.globalAlpha = 1;
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const px = x + radius * Math.cos(angle);
    const py = y + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  // Fill hexagon
  ctx.fillStyle = '#0a0a0a';
  ctx.fill();
  ctx.stroke();

  // Name text
  ctx.fillStyle = statusColor;
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y);
}

/**
 * Draw connection line with glow
 */
function drawConnection(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strength: number,
): void {
  const glowColor = getGlowColor(strength);
  const lineWidth = 1 + strength * 2;

  // Glow effect
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = lineWidth + 4;
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Main line
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Energy particle
  const t = (Date.now() % 2000) / 2000;
  const px = x1 + (x2 - x1) * t;
  const py = y1 + (y2 - y1) * t;
  ctx.globalAlpha = 1;
  ctx.fillStyle = glowColor;
  ctx.beginPath();
  ctx.arc(px, py, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Main Canvas Component
 */
const BrainHologramCanvas = React.forwardRef<
  HTMLCanvasElement,
  {
    brainState: BrainState;
    onNodeClick: (nodeId: string, nodeType: 'symbol' | 'strategy' | 'agent') => void;
  }
>(({ brainState, onNodeClick }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Calculate positions for all nodes
  const nodePositions = useMemo(() => {
    const positions: {
      symbols: Record<string, { x: number; y: number }>;
      strategies: Record<string, { x: number; y: number }>;
      agents: Record<string, { x: number; y: number }>;
    } = { symbols: {}, strategies: {}, agents: {} };

    // Symbol nodes (outer ring)
    brainState.symbols.forEach((sym, index) => {
      const angle = (Math.PI * 2 * index) / brainState.symbols.length - Math.PI / 2;
      positions.symbols[sym.id] = getCirclePosition(
        CENTER.x,
        CENTER.y,
        SYMBOL_RADIUS,
        angle,
      );
    });

    // Strategy nodes (middle ring)
    brainState.strategies.forEach((strat, index) => {
      const angle = (Math.PI * 2 * index) / brainState.strategies.length;
      positions.strategies[strat.id] = getCirclePosition(
        CENTER.x,
        CENTER.y,
        STRATEGY_RADIUS,
        angle,
      );
    });

    // Agent nodes (outer ring, larger)
    brainState.agents.forEach((agent, index) => {
      const angle = (Math.PI * 2 * index) / brainState.agents.length + Math.PI / 2;
      positions.agents[agent.id] = getCirclePosition(
        CENTER.x,
        CENTER.y,
        AGENT_RADIUS,
        angle,
      );
    });

    return positions;
  }, [brainState.symbols, brainState.strategies, brainState.agents]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let pulsePhase = 0;

    const animate = () => {
      // Clear canvas
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw subtle grid background
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1;
      for (let i = 0; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < canvas.height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      // Draw connections first (so they're behind nodes)
      brainState.connections.forEach((conn) => {
        let fromPos = null;
        let toPos = null;

        if (brainState.symbols.find((s) => s.id === conn.from)) {
          fromPos = nodePositions.symbols[conn.from];
        } else if (brainState.strategies.find((s) => s.id === conn.from)) {
          fromPos = nodePositions.strategies[conn.from];
        } else if (brainState.agents.find((a) => a.id === conn.from)) {
          fromPos = nodePositions.agents[conn.from];
        }

        if (brainState.symbols.find((s) => s.id === conn.to)) {
          toPos = nodePositions.symbols[conn.to];
        } else if (brainState.strategies.find((s) => s.id === conn.to)) {
          toPos = nodePositions.strategies[conn.to];
        } else if (brainState.agents.find((a) => a.id === conn.to)) {
          toPos = nodePositions.agents[conn.to];
        }

        if (fromPos && toPos) {
          drawConnection(ctx, fromPos.x, fromPos.y, toPos.x, toPos.y, conn.strength);
        }
      });

      // Draw strategy nodes (middle ring)
      brainState.strategies.forEach((strat) => {
        const pos = nodePositions.strategies[strat.id];
        if (pos) {
          drawStrategyNode(ctx, pos.x, pos.y, 12, strat.name, strat.strength);
        }
      });

      // Draw agent nodes (outer larger ring)
      brainState.agents.forEach((agent) => {
        const pos = nodePositions.agents[agent.id];
        if (pos) {
          drawAgentNode(ctx, pos.x, pos.y, 14, agent.name, agent.status);
        }
      });

      // Draw symbol nodes (main ring)
      brainState.symbols.forEach((sym) => {
        const pos = nodePositions.symbols[sym.id];
        if (pos) {
          const pulse = sym.active ? Math.sin(pulsePhase) * 0.5 + 0.5 : 0;
          drawSymbolNode(ctx, pos.x, pos.y, 28, sym.symbol, sym.confidence, pulse, sym.alerts);
        }
      });

      // Draw central "brain" core
      const centerGlow = Math.sin(pulsePhase * 0.5) * 0.3 + 0.7;
      ctx.fillStyle = COLORS.glowGreen;
      ctx.globalAlpha = centerGlow * 0.3;
      ctx.beginPath();
      ctx.arc(CENTER.x, CENTER.y, 60, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = centerGlow * 0.6;
      ctx.beginPath();
      ctx.arc(CENTER.x, CENTER.y, 40, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS.glowGreen;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CENTER.x, CENTER.y, 30, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = COLORS.glowGreen;
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BRAIN', CENTER.x, CENTER.y - 4);
      ctx.font = '8px monospace';
      ctx.fillText('CORE', CENTER.x, CENTER.y + 6);

      pulsePhase += 0.02;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [brainState, nodePositions]);

  return (
    <canvas
      ref={(el) => {
        canvasRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{
        display: 'block',
        width: '100%',
        height: 'auto',
        backgroundColor: COLORS.bg,
        borderRadius: '8px',
        border: `1px solid ${COLORS.border}`,
        cursor: 'pointer',
      }}
      onClick={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
        const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
        const hitRadius = 35;

        // Check symbol nodes
        brainState.symbols.forEach((sym) => {
          const pos = nodePositions.symbols[sym.id];
          if (pos) {
            const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
            if (dist < hitRadius) {
              onNodeClick(sym.id, 'symbol');
            }
          }
        });

        // Check strategy nodes
        brainState.strategies.forEach((strat) => {
          const pos = nodePositions.strategies[strat.id];
          if (pos) {
            const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
            if (dist < 20) {
              onNodeClick(strat.id, 'strategy');
            }
          }
        });

        // Check agent nodes
        brainState.agents.forEach((agent) => {
          const pos = nodePositions.agents[agent.id];
          if (pos) {
            const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
            if (dist < 25) {
              onNodeClick(agent.id, 'agent');
            }
          }
        });
      }}
    />
  );
});

BrainHologramCanvas.displayName = 'BrainHologramCanvas';

// ─── Main Page Component ────────────────────────────────────────────────────

export default function BrainHologramPage(): React.ReactElement {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Start EMPTY, not with mock data — fake data on first paint is a lie.
  const [brainState, setBrainState] = useState<BrainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  // Poll brain state from API
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/brain/state', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`API ${response.status} ${response.statusText}`);
        }

        const data: BrainState = await response.json();
        if (cancelled) return;
        setBrainState(data);
        setLastFetchedAt(Date.now());
        setError(null);
        setUsingMock(false);
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.message || 'Failed to fetch brain state';
        console.warn('brain/state fetch failed:', msg);
        setError(msg);
        // After repeated failures with no data, fall back to MOCK_BRAIN_STATE
        // so the operator at least sees the layout, but BANNER must say it's mock.
        setBrainState((prev) => {
          if (prev) return prev; // keep last successful payload
          setUsingMock(true);
          return MOCK_BRAIN_STATE;
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Stale-data detector: more than 10s since last successful fetch
  const isStale = lastFetchedAt !== null && Date.now() - lastFetchedAt > 10_000;

  // Handle node clicks
  const handleNodeClick = useCallback(
    (nodeId: string, nodeType: 'symbol' | 'strategy' | 'agent') => {
      if (!brainState) return;
      if (nodeType === 'symbol') {
        const sym = brainState.symbols.find((s) => s.id === nodeId);
        if (sym) {
          navigate(`/ticker/${sym.symbol}`, { state: { confidence: sym.confidence } });
        }
      } else if (nodeType === 'strategy') {
        navigate('/strategy-panel', { state: { strategyId: nodeId } });
      } else if (nodeType === 'agent') {
        navigate('/agent-monitor', { state: { agentId: nodeId } });
      }
    },
    [brainState, navigate],
  );

  // ─── Loading / Error / Empty states ────────────────────────────────────
  if (loading && !brainState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', backgroundColor: COLORS.bg, color: COLORS.glowGreen,
                    fontFamily: 'monospace', fontSize: '18px' }}>
        ◆ Loading God Brain state from /api/brain/state…
      </div>
    );
  }

  if (!brainState) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '100%', backgroundColor: COLORS.bg,
                    color: COLORS.glowRed, fontFamily: 'monospace', gap: '12px' }}>
        <div style={{ fontSize: '20px' }}>⚠ Brain state unavailable</div>
        <div style={{ fontSize: '14px', color: '#aaa' }}>
          {error ?? 'No data returned from /api/brain/state'}
        </div>
        <div style={{ fontSize: '12px', color: '#666' }}>
          Check API server is running and DB is reachable.
        </div>
      </div>
    );
  }

  // Empty backend (api up, but no symbols/strategies populated yet)
  const isEmpty = brainState.symbols.length === 0 && brainState.strategies.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: COLORS.bg,
        color: '#e0e0e0',
        fontFamily: 'monospace',
        padding: '20px',
        gap: '15px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: '28px',
            fontWeight: 'bold',
            color: COLORS.glowGreen,
            textShadow: `0 0 20px ${COLORS.glowGreen}`,
          }}
        >
          ◆ BRAIN HOLOGRAM
        </h1>
        <div
          style={{
            display: 'flex',
            gap: '20px',
            fontSize: '12px',
            color: '#888',
          }}
        >
          {loading && <span style={{ color: COLORS.glowYellow }}>updating...</span>}
          {error && (
            <span style={{ color: COLORS.glowRed }} title={error}>
              ⚠ live feed offline
            </span>
          )}
          {usingMock && (
            <span style={{ color: COLORS.glowRed, fontWeight: 'bold' }}>
              SHOWING MOCK DATA — backend unreachable
            </span>
          )}
          {isStale && !usingMock && (
            <span style={{ color: COLORS.glowYellow }}>
              ⓘ stale — last update {Math.round((Date.now() - (lastFetchedAt ?? 0)) / 1000)}s ago
            </span>
          )}
          {isEmpty && (
            <span style={{ color: COLORS.glowYellow }}>
              empty — no symbols or strategies in DB (run seed)
            </span>
          )}
          {lastFetchedAt && !error && !usingMock && (
            <span title={new Date(lastFetchedAt).toISOString()}>
              live · {new Date(lastFetchedAt).toLocaleTimeString()}
            </span>
          )}
          <span>Symbols: {brainState.symbols.length}</span>
          <span>Strategies: {brainState.strategies.length}</span>
          <span>Agents: {brainState.agents.length}</span>
        </div>
      </div>

      {/* Canvas Container */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          backgroundColor: COLORS.cardBg,
          borderRadius: '8px',
          border: `1px solid ${COLORS.border}`,
          padding: '15px',
        }}
      >
        <BrainHologramCanvas ref={canvasRef} brainState={brainState} onNodeClick={handleNodeClick} />
      </div>

      {/* Footer Legend */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '15px',
          fontSize: '11px',
          color: '#999',
        }}
      >
        <div>
          <div style={{ color: COLORS.glowGreen, marginBottom: '5px', fontWeight: 'bold' }}>
            High Confidence (≥75%)
          </div>
          <div>Strong signal strength, green glow indicates high conviction.</div>
        </div>
        <div>
          <div style={{ color: COLORS.glowYellow, marginBottom: '5px', fontWeight: 'bold' }}>
            Medium Confidence (50-75%)
          </div>
          <div>Moderate signal, yellow glow indicates caution needed.</div>
        </div>
        <div>
          <div style={{ color: COLORS.glowRed, marginBottom: '5px', fontWeight: 'bold' }}>
            Low Confidence (&lt;50%)
          </div>
          <div>Weak signal, red glow or alerts. Approach with care.</div>
        </div>
        <div>
          <div style={{ color: COLORS.glowGreen, marginBottom: '5px', fontWeight: 'bold' }}>
            Click Nodes
          </div>
          <div>Click any node to navigate to relevant intelligence page.</div>
        </div>
        <div>
          <div style={{ color: '#ff7b7b', marginBottom: '5px', fontWeight: 'bold' }}>
            Alert Badge
          </div>
          <div>Red badges indicate active alerts or anomalies on that node.</div>
        </div>
        <div>
          <div style={{ color: COLORS.glowGreen, marginBottom: '5px', fontWeight: 'bold' }}>
            Live Updates
          </div>
          <div>Data refreshes every 2 seconds from /api/brain/state.</div>
        </div>
      </div>
    </div>
  );
}
