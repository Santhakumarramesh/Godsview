'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Text, OrbitControls, Sphere, Line, Html } from '@react-three/drei';
import * as THREE from 'three';

// ── Design tokens ───────────────────────────────────────────────────────────
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

// ── Types ───────────────────────────────────────────────────────────────────
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
  position: [number, number, number]; // 3D coords
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

// Navigation targets for click-through
const NODE_ROUTES: Record<NodeId, string> = {
  tick: '/market-scanner',
  timeframe: '/multi-timeframe',
  structure: '/order-blocks',
  orderflow: '/order-flow-dashboard',
  context: '/regime-detection',
  memory: '/recall-engine',
  risk: '/risk-policy',
  reasoning: '/god-brain',
};

// ── 3D Node Positions (spherical layout, layered) ───────────────────────────
const NODE_POSITIONS_3D: Record<NodeId, [number, number, number]> = {
  tick:       [-1.8, 2.4, 0.6],
  timeframe:  [1.8, 2.4, 0.6],
  structure:  [-2.5, 0.6, -0.5],
  orderflow:  [0, 0.6, 1.5],
  context:    [2.5, 0.6, -0.5],
  memory:     [-1.5, -1.4, 0.3],
  risk:       [1.5, -1.4, 0.3],
  reasoning:  [0, -3.0, 0],
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
  { from: 'orderflow', to: 'risk', weight: 0.7 },
  { from: 'memory', to: 'reasoning', weight: 0.95 },
  { from: 'risk', to: 'reasoning', weight: 0.90 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const generateSyntheticSignal = (): SignalEvent => {
  const symbols = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'BTCUSD', 'SPY'];
  const grades = ['A+', 'A', 'A-', 'B+', 'B', 'C+'];
  const regimes = ['Bull', 'Bear', 'Sideways', 'Volatile'];
  const decisions: ('APPROVE' | 'REJECT')[] = ['APPROVE', 'REJECT'];

  return {
    id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    sentiment: ['Bullish', 'Neutral', 'Bearish'][Math.floor(Math.random() * 3)],
  };
};

const getNodeColor = (score: number): string => {
  if (score >= 75) return C.primary;
  if (score >= 50) return C.gold;
  return C.tertiary;
};

const hexToVec3 = (hex: string): THREE.Color => new THREE.Color(hex);

// ── 3D Components ───────────────────────────────────────────────────────────

/** Rotating wireframe brain mesh — decorative center piece */
function BrainMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.LineSegments>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.08;
      meshRef.current.rotation.x += delta * 0.03;
    }
    if (wireRef.current) {
      wireRef.current.rotation.y += delta * 0.08;
      wireRef.current.rotation.x += delta * 0.03;
    }
  });

  const geo = useMemo(() => new THREE.IcosahedronGeometry(3.8, 2), []);
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);

  return (
    <group>
      {/* Wireframe shell */}
      <lineSegments ref={wireRef} geometry={edgesGeo}>
        <lineBasicMaterial color={C.outlineVar} transparent opacity={0.08} />
      </lineSegments>
      {/* Inner glow sphere */}
      <mesh ref={meshRef} geometry={geo}>
        <meshBasicMaterial color={C.primary} transparent opacity={0.015} wireframe />
      </mesh>
    </group>
  );
}

/** A single brain node sphere with glow, label, score, and click handler */
function BrainNodeSphere({
  node,
  isActive,
  onClick,
}: {
  node: NodeState;
  isActive: boolean;
  onClick: (id: NodeId) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const color = getNodeColor(node.score);
  const threeColor = useMemo(() => hexToVec3(color), [color]);

  useFrame((state) => {
    if (!groupRef.current) return;

    // Floating animation
    const t = state.clock.elapsedTime;
    const baseY = node.position[1];
    groupRef.current.position.y = baseY + Math.sin(t * 0.8 + node.position[0]) * 0.06;

    // Pulse glow
    if (glowRef.current) {
      const scale = isActive
        ? 1.6 + Math.sin(t * 4) * 0.3
        : hovered
        ? 1.3
        : 1.0;
      glowRef.current.scale.setScalar(scale);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = isActive
        ? 0.25 + Math.sin(t * 4) * 0.15
        : hovered
        ? 0.15
        : 0.05;
    }
  });

  return (
    <group
      ref={groupRef}
      position={node.position}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      onPointerOver={() => {
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Outer glow */}
      <Sphere ref={glowRef as any} args={[0.55, 16, 16]}>
        <meshBasicMaterial color={threeColor} transparent opacity={0.05} />
      </Sphere>

      {/* Core sphere */}
      <Sphere args={[0.35, 32, 32]}>
        <meshStandardMaterial
          color={threeColor}
          emissive={threeColor}
          emissiveIntensity={isActive ? 0.8 : hovered ? 0.4 : 0.15}
          roughness={0.3}
          metalness={0.6}
          transparent
          opacity={0.92}
        />
      </Sphere>

      {/* Inner bright core */}
      <Sphere args={[0.15, 16, 16]}>
        <meshBasicMaterial color="#ffffff" transparent opacity={isActive ? 0.6 : 0.2} />
      </Sphere>

      {/* Label */}
      <Text
        position={[0, -0.6, 0]}
        fontSize={0.2}
        color={C.muted}
        anchorX="center"
        anchorY="top"
        font={undefined}
      >
        {node.label}
      </Text>

      {/* Score */}
      <Text
        position={[0, 0.6, 0]}
        fontSize={0.22}
        color={color}
        anchorX="center"
        anchorY="bottom"
        fontWeight="bold"
        font={undefined}
      >
        {Math.round(node.score).toString()}
      </Text>

      {/* Active ring indicator */}
      {isActive && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.5, 0.02, 8, 32]} />
          <meshBasicMaterial color={threeColor} transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}

/** Animated connection between two nodes with flowing particles */
function SignalConnection({
  from,
  to,
  weight,
  isActive,
  color,
}: {
  from: [number, number, number];
  to: [number, number, number];
  weight: number;
  isActive: boolean;
  color: string;
}) {
  const particlesRef = useRef<THREE.Group>(null);
  const lineOpacity = isActive ? 0.5 : 0.12;
  const threeColor = useMemo(() => hexToVec3(color), [color]);

  // Midpoint with slight curve
  const mid: [number, number, number] = [
    (from[0] + to[0]) / 2 + (Math.random() - 0.5) * 0.2,
    (from[1] + to[1]) / 2 + 0.3,
    (from[2] + to[2]) / 2 + (Math.random() - 0.5) * 0.2,
  ];

  const curve = useMemo(
    () =>
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(...from),
        new THREE.Vector3(...mid),
        new THREE.Vector3(...to)
      ),
    [from[0], from[1], from[2], to[0], to[1], to[2]]
  );

  const curvePoints = useMemo(() => curve.getPoints(40), [curve]);

  // Particle animation
  useFrame((state) => {
    if (!particlesRef.current || !isActive) return;
    const t = state.clock.elapsedTime;

    particlesRef.current.children.forEach((child, i) => {
      const progress = ((t * 0.5 + i * 0.33) % 1);
      const pos = curve.getPoint(progress);
      child.position.copy(pos);
      (child as THREE.Mesh).material = new THREE.MeshBasicMaterial({
        color: threeColor,
        transparent: true,
        opacity: 0.8 - progress * 0.4,
      });
    });
  });

  return (
    <group>
      {/* Connection line */}
      <Line
        points={curvePoints.map((p) => [p.x, p.y, p.z] as [number, number, number])}
        color={color}
        lineWidth={weight * 2}
        transparent
        opacity={lineOpacity}
      />

      {/* Flowing particles */}
      {isActive && (
        <group ref={particlesRef}>
          {[0, 1, 2].map((i) => (
            <mesh key={i}>
              <sphereGeometry args={[0.04, 8, 8]} />
              <meshBasicMaterial color={color} transparent opacity={0.8} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/** Ambient particle field for atmosphere */
function ParticleField() {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions] = useState(() => {
    const arr = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 12;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 12;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    return arr;
  });

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.015;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color={C.outlineVar} size={0.03} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

/** Main 3D scene contents */
function BrainScene({
  nodes,
  activeNodes,
  onNodeClick,
}: {
  nodes: Record<NodeId, NodeState>;
  activeNodes: Set<NodeId>;
  onNodeClick: (id: NodeId) => void;
}) {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[5, 5, 5]} intensity={0.5} color={C.primary} />
      <pointLight position={[-5, -3, 3]} intensity={0.3} color={C.secondary} />
      <pointLight position={[0, -5, -5]} intensity={0.2} color={C.gold} />

      {/* Atmosphere */}
      <ParticleField />
      <BrainMesh />

      {/* Connections */}
      {CONNECTIONS.map((conn) => {
        const fromNode = nodes[conn.from];
        const toNode = nodes[conn.to];
        const isActive = activeNodes.has(conn.from) || activeNodes.has(conn.to);

        let connColor = C.outlineVar;
        if (isActive) {
          const fromLayer = fromNode.layer;
          const toLayer = toNode.layer;
          if (fromLayer === 1 && toLayer === 2) connColor = C.primary;
          else if (fromLayer === 2 && toLayer === 3) connColor = C.secondary;
          else if (toLayer === 4) connColor = C.gold;
          else connColor = C.purple;
        }

        return (
          <SignalConnection
            key={`${conn.from}-${conn.to}`}
            from={fromNode.position}
            to={toNode.position}
            weight={conn.weight}
            isActive={isActive}
            color={connColor}
          />
        );
      })}

      {/* Nodes */}
      {Object.values(nodes).map((node) => (
        <BrainNodeSphere
          key={node.id}
          node={node}
          isActive={activeNodes.has(node.id)}
          onClick={onNodeClick}
        />
      ))}

      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={4}
        maxDistance={12}
        autoRotate
        autoRotateSpeed={0.3}
        dampingFactor={0.1}
        enableDamping
      />
    </>
  );
}

// ── 2D Overlay Components ───────────────────────────────────────────────────

const DecisionCard: React.FC<{ signal: SignalEvent }> = ({ signal }) => {
  const bgColor = signal.decision === 'APPROVE' ? C.primary : C.tertiary;

  return (
    <div
      style={{
        backgroundColor: bgColor + '1a',
        border: `1px solid ${bgColor}50`,
        borderRadius: '8px',
        padding: '10px 14px',
        minWidth: '160px',
        animation: 'slideInRight 0.5s ease-out',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ color: bgColor, fontWeight: 'bold', fontSize: '12px' }}>
          {signal.decision}
        </div>
        <div style={{ fontSize: '18px' }}>{signal.direction || '→'}</div>
      </div>
      <div style={{ color: C.muted, fontSize: '10px', marginTop: '3px', display: 'flex', gap: '6px' }}>
        <span style={{ backgroundColor: C.cardHigh, padding: '1px 5px', borderRadius: '3px' }}>
          {signal.grade}
        </span>
        <span>{signal.symbol}</span>
      </div>
      <div style={{ color: C.gold, fontSize: '12px', fontWeight: 'bold', marginTop: '4px' }}>
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
        backgroundColor: C.card + 'ee',
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        padding: '14px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ color: C.primary, fontSize: '12px', fontWeight: 'bold', marginBottom: '10px' }}>
        Live Score Breakdown
      </div>
      {dimensions.map((dim) => {
        const score = signal.scores[dim.key] || 0;
        const color = getNodeColor(score);
        return (
          <div key={dim.key} style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: C.muted, fontSize: '10px' }}>{dim.label}</span>
              <span style={{ color, fontSize: '10px', fontWeight: 'bold' }}>{Math.round(score)}</span>
            </div>
            <div style={{ backgroundColor: C.cardHigh, borderRadius: '2px', height: '3px', overflow: 'hidden' }}>
              <div style={{ backgroundColor: color, height: '100%', width: `${score}%`, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        );
      })}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: '10px', paddingTop: '10px' }}>
        <div style={{ fontSize: '10px', lineHeight: '1.6', color: C.muted }}>
          <div><strong style={{ color: C.gold }}>Regime:</strong> {signal.regime}</div>
          <div><strong style={{ color: C.secondary }}>Session:</strong> {signal.session}</div>
          <div><strong style={{ color: C.purple }}>Quality:</strong> {signal.dataQuality}</div>
          <div><strong style={{ color: C.tertiary }}>Sentiment:</strong> {signal.sentiment}</div>
        </div>
      </div>
    </div>
  );
};

// ── Main Page Component ─────────────────────────────────────────────────────

export default function BrainGraphPage() {
  const eventSourceRef = useRef<EventSource | null>(null);

  const [nodes, setNodes] = useState<Record<NodeId, NodeState>>(() => {
    const initial: Record<string, NodeState> = {};
    const layers: Record<NodeId, number> = {
      tick: 1, timeframe: 1, structure: 2, orderflow: 2,
      context: 2, memory: 3, risk: 3, reasoning: 4,
    };
    const labels: Record<NodeId, string> = {
      tick: 'Tick Data', timeframe: 'Timeframe', structure: 'Structure',
      orderflow: 'Order Flow', context: 'Context', memory: 'Memory',
      risk: 'Risk', reasoning: 'God Brain',
    };
    for (const id of Object.keys(NODE_POSITIONS_3D) as NodeId[]) {
      initial[id] = {
        id,
        label: labels[id],
        score: 50,
        layer: layers[id],
        position: NODE_POSITIONS_3D[id],
      };
    }
    return initial as Record<NodeId, NodeState>;
  });

  const [signals, setSignals] = useState<SignalEvent[]>([]);
  const [latestSignal, setLatestSignal] = useState<SignalEvent | null>(null);
  const [activeNodes, setActiveNodes] = useState<Set<NodeId>>(new Set());
  const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null);

  // Handle node click — navigate to relevant page
  const handleNodeClick = useCallback((id: NodeId) => {
    const route = NODE_ROUTES[id];
    if (route) {
      window.location.hash = route;
    }
  }, []);

  // Process incoming signal event
  const processSignal = useCallback((signal: SignalEvent) => {
    // Update node scores
    setNodes((prev) => {
      const updated = { ...prev };
      Object.entries(signal.scores).forEach(([key, score]) => {
        if (key in updated) {
          updated[key as NodeId] = { ...updated[key as NodeId], score };
        }
      });
      return updated;
    });

    // Cascade activation through layers
    const schedule = [
      { ids: ['tick', 'timeframe'] as NodeId[], delay: 0 },
      { ids: ['structure', 'orderflow', 'context'] as NodeId[], delay: 250 },
      { ids: ['memory', 'risk'] as NodeId[], delay: 500 },
      { ids: ['reasoning'] as NodeId[], delay: 750 },
    ];

    schedule.forEach(({ ids, delay }) => {
      setTimeout(() => {
        setActiveNodes((prev) => {
          const next = new Set(prev);
          ids.forEach((n) => next.add(n));
          return next;
        });
      }, delay);
    });

    // Clear activation after full cascade
    setTimeout(() => setActiveNodes(new Set()), 2800);

    setSignals((prev) => [signal, ...prev].slice(0, 8));
    setLatestSignal(signal);
  }, []);

  // SSE connection + synthetic fallback
  useEffect(() => {
    const synthTimer = setInterval(() => {
      processSignal(generateSyntheticSignal());
    }, 3500);

    try {
      const es = new EventSource('/api/mcp/stream/brain-graph');
      es.onmessage = (event) => {
        try {
          processSignal(JSON.parse(event.data));
        } catch {
          /* parse error — ignore */
        }
      };
      es.onerror = () => {
        es.close();
      };
      eventSourceRef.current = es;
    } catch {
      /* SSE unavailable */
    }

    return () => {
      clearInterval(synthTimer);
      eventSourceRef.current?.close();
    };
  }, [processSignal]);

  return (
    <div
      style={{
        backgroundColor: C.bg,
        color: C.muted,
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ padding: '20px 24px 0', zIndex: 10 }}>
        <h1 style={{ color: C.primary, fontSize: '26px', fontWeight: 'bold', margin: '0 0 4px 0' }}>
          God Brain — Neural Command Center
        </h1>
        <p style={{ margin: '0', color: C.outline, fontSize: '13px' }}>
          3D signal flow visualization — click any node to navigate
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '16px', flex: 1, padding: '16px 24px 24px' }}>
        {/* 3D Canvas */}
        <div
          style={{
            backgroundColor: '#000',
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
            minHeight: '600px',
            position: 'relative',
          }}
        >
          <Suspense fallback={<div style={{ color: C.muted, padding: '40px', textAlign: 'center' }}>Loading 3D scene...</div>}>
            <Canvas
              camera={{ position: [0, 1, 8], fov: 50 }}
              gl={{ antialias: true, alpha: true }}
              style={{ background: 'radial-gradient(ellipse at center, #0a0a1a 0%, #000000 100%)' }}
            >
              <BrainScene
                nodes={nodes}
                activeNodes={activeNodes}
                onNodeClick={handleNodeClick}
              />
            </Canvas>
          </Suspense>

          {/* Overlay: mode indicator */}
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              backgroundColor: C.card + 'cc',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '10px',
              color: C.primary,
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: C.primary, animation: 'pulse 2s infinite' }} />
            LIVE — {signals.length} signals processed
          </div>

          {/* Overlay: decision feed */}
          <div
            style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              right: '12px',
              display: 'flex',
              gap: '10px',
              overflowX: 'auto',
              paddingBottom: '4px',
            }}
          >
            {signals.slice(0, 5).map((sig) => (
              <DecisionCard key={sig.id} signal={sig} />
            ))}
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {latestSignal ? (
            <ScoreBreakdown signal={latestSignal} />
          ) : (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '10px',
                padding: '14px',
                color: C.outline,
                fontSize: '11px',
                textAlign: 'center',
              }}
            >
              Awaiting first signal...
            </div>
          )}

          {/* Node Legend */}
          <div
            style={{
              backgroundColor: C.card + 'ee',
              border: `1px solid ${C.border}`,
              borderRadius: '10px',
              padding: '14px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div style={{ color: C.primary, fontSize: '12px', fontWeight: 'bold', marginBottom: '10px' }}>
              Signal Flow Layers
            </div>
            {[
              { label: 'Input Layer', desc: 'Tick Data, Timeframe', color: C.primary },
              { label: 'Analysis Layer', desc: 'Structure, Flow, Context', color: C.secondary },
              { label: 'Evaluation Layer', desc: 'Memory, Risk', color: C.purple },
              { label: 'Decision Layer', desc: 'God Brain Reasoning', color: C.gold },
            ].map((layer) => (
              <div key={layer.label} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
                <div style={{ width: '8px', height: '8px', backgroundColor: layer.color, borderRadius: '50%', marginTop: '3px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '11px', color: C.muted }}>{layer.label}</div>
                  <div style={{ fontSize: '9px', color: C.outline }}>{layer.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Controls hint */}
          <div
            style={{
              backgroundColor: C.card + 'ee',
              border: `1px solid ${C.border}`,
              borderRadius: '10px',
              padding: '12px',
              fontSize: '10px',
              color: C.outline,
              lineHeight: '1.6',
            }}
          >
            <div style={{ color: C.muted, fontWeight: 'bold', marginBottom: '4px' }}>Controls</div>
            Drag to rotate — Scroll to zoom — Click node to navigate
          </div>
        </div>
      </div>
    </div>
  );
}
