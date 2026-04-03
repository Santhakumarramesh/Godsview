/**
 * brain.tsx — GodsView Living Market Brain
 *
 * A massive 3D neural intelligence visualization where:
 * - Central brain breathes and pulses with neural energy
 * - Stock nodes orbit with dynamic size/glow based on SI confidence
 * - Energy particles flow along neural connections
 * - Strong opportunities rise and glow brighter
 * - Weak/blocked stocks dim and shrink
 * - Real-time SSE feeds SI decisions into the visualization
 * - Click a node → deep intelligence drawer with Market DNA,
 *   Setup Memory, Claude Reasoning, Risk Gate
 */

import { useState, useRef, useMemo, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Billboard, Text, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useBrainConsciousness, useBrainEntities, useBrainIntelligence, useBrainState, useSMCState, useRegimeState, useMarketStress } from "@/lib/api";
import { useLivePrices } from "@/lib/market-store";
import BrainFocusMode from "@/components/BrainFocusMode";

// ─── Types ──────────────────────────────────────────────────────────────────

type StockNodeData = {
  symbol: string;
  displaySymbol: string;
  confidence: number;
  sentiment: "bullish" | "bearish" | "neutral";
  regime: string;
  attentionLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";
  opportunityScore: number;
  setupFamily: string;
  state: "WATCH_LONG" | "WATCH_SHORT" | "STRONG_LONG" | "STRONG_SHORT" | "BLOCKED" | "IDLE";
  price: number;
  changePct: number;
  riskGate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  winRate?: number;
  similarSetups?: number;
  profitFactor?: number;
  decayRate?: number;
  trendiness?: number;
  fakeoutRisk?: number;
  breakoutQuality?: number;
  spreadStability?: number;
  newsSensitivity?: number;
};

type SupremeState = {
  regime: string;
  riskAppetite: string;
  totalCapitalAllocated: number;
  activeBrains: number;
  lastCycleMs: number;
  decayDetected: boolean;
};

type SIDecisionEvent = {
  symbol: string;
  approved: boolean;
  direction: string;
  win_probability: number;
  edge_score: number;
  quality: number;
  rejection_reason?: string;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  timestamp: string;
};

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_STOCKS: StockNodeData[] = [
  { symbol: "BTCUSD", displaySymbol: "BTC", confidence: 88, sentiment: "bullish", regime: "risk-on", attentionLevel: "CRITICAL", opportunityScore: 92, setupFamily: "breakout", state: "STRONG_LONG", price: 87245, changePct: 2.34, riskGate: "ALLOW", winRate: 63, similarSetups: 47, profitFactor: 1.9, trendiness: 85, fakeoutRisk: 22, breakoutQuality: 88, spreadStability: 91, newsSensitivity: 45 },
  { symbol: "ETHUSD", displaySymbol: "ETH", confidence: 74, sentiment: "bullish", regime: "risk-on", attentionLevel: "HIGH", opportunityScore: 78, setupFamily: "continuation", state: "WATCH_LONG", price: 3412, changePct: 1.87, riskGate: "ALLOW", winRate: 58, similarSetups: 32, profitFactor: 1.6, trendiness: 72, fakeoutRisk: 35, breakoutQuality: 65, spreadStability: 82, newsSensitivity: 55 },
  { symbol: "NVDA", displaySymbol: "NVDA", confidence: 82, sentiment: "bullish", regime: "risk-on", attentionLevel: "HIGH", opportunityScore: 85, setupFamily: "breakout", state: "STRONG_LONG", price: 924.5, changePct: 3.12, riskGate: "ALLOW", winRate: 61, similarSetups: 28, profitFactor: 2.1, trendiness: 90, fakeoutRisk: 18, breakoutQuality: 92, spreadStability: 88, newsSensitivity: 62 },
  { symbol: "AAPL", displaySymbol: "AAPL", confidence: 65, sentiment: "neutral", regime: "choppy", attentionLevel: "MEDIUM", opportunityScore: 55, setupFamily: "pullback", state: "WATCH_LONG", price: 198.2, changePct: -0.32, riskGate: "WATCH", winRate: 52, similarSetups: 65, profitFactor: 1.3, trendiness: 58, fakeoutRisk: 42, breakoutQuality: 55, spreadStability: 95, newsSensitivity: 48 },
  { symbol: "TSLA", displaySymbol: "TSLA", confidence: 45, sentiment: "bearish", regime: "high-vol", attentionLevel: "LOW", opportunityScore: 35, setupFamily: "reversal", state: "BLOCKED", price: 172.8, changePct: -2.14, riskGate: "BLOCK", winRate: 38, similarSetups: 12, profitFactor: 0.8, trendiness: 35, fakeoutRisk: 72, breakoutQuality: 30, spreadStability: 55, newsSensitivity: 88 },
  { symbol: "SPY", displaySymbol: "SPY", confidence: 70, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 62, setupFamily: "trend", state: "WATCH_LONG", price: 562.4, changePct: 0.45, riskGate: "ALLOW", winRate: 55, similarSetups: 120, profitFactor: 1.4, trendiness: 68, fakeoutRisk: 30, breakoutQuality: 62, spreadStability: 98, newsSensitivity: 35 },
  { symbol: "QQQ", displaySymbol: "QQQ", confidence: 72, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 68, setupFamily: "trend", state: "WATCH_LONG", price: 485.3, changePct: 0.78, riskGate: "ALLOW", winRate: 56, similarSetups: 95, profitFactor: 1.5, trendiness: 70, fakeoutRisk: 28, breakoutQuality: 66, spreadStability: 96, newsSensitivity: 40 },
  { symbol: "AMZN", displaySymbol: "AMZN", confidence: 58, sentiment: "neutral", regime: "choppy", attentionLevel: "LOW", opportunityScore: 42, setupFamily: "range", state: "IDLE", price: 186.7, changePct: -0.65, riskGate: "WATCH", winRate: 48, similarSetups: 55, profitFactor: 1.1, trendiness: 45, fakeoutRisk: 50, breakoutQuality: 40, spreadStability: 90, newsSensitivity: 52 },
  { symbol: "META", displaySymbol: "META", confidence: 76, sentiment: "bullish", regime: "risk-on", attentionLevel: "HIGH", opportunityScore: 80, setupFamily: "breakout", state: "WATCH_LONG", price: 512.3, changePct: 1.56, riskGate: "ALLOW", winRate: 59, similarSetups: 35, profitFactor: 1.7, trendiness: 78, fakeoutRisk: 25, breakoutQuality: 80, spreadStability: 85, newsSensitivity: 58 },
  { symbol: "SOLUSD", displaySymbol: "SOL", confidence: 69, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 71, setupFamily: "continuation", state: "WATCH_LONG", price: 187.5, changePct: 4.21, riskGate: "ALLOW", winRate: 54, similarSetups: 22, profitFactor: 1.5, trendiness: 75, fakeoutRisk: 38, breakoutQuality: 68, spreadStability: 72, newsSensitivity: 65 },
];

const MOCK_SUPREME: SupremeState = {
  regime: "RISK-ON",
  riskAppetite: "MODERATE",
  totalCapitalAllocated: 78,
  activeBrains: 10,
  lastCycleMs: 1240,
  decayDetected: false,
};

// ─── Color Helpers ──────────────────────────────────────────────────────────

function getNodeColor(stock: StockNodeData): string {
  if (stock.riskGate === "BLOCK") return "#ff4444";
  if (stock.sentiment === "bearish") return "#ff7162";
  if (stock.sentiment === "bullish") return "#00ffcc";
  return "#8888aa";
}

function getNodeEmissive(stock: StockNodeData): string {
  if (stock.riskGate === "BLOCK") return "#660000";
  if (stock.attentionLevel === "CRITICAL") return "#004422";
  if (stock.attentionLevel === "HIGH") return "#003322";
  return "#111122";
}

function getStateLabel(state: string): string {
  switch (state) {
    case "STRONG_LONG": return "STRONG LONG";
    case "STRONG_SHORT": return "STRONG SHORT";
    case "WATCH_LONG": return "WATCH LONG";
    case "WATCH_SHORT": return "WATCH SHORT";
    case "BLOCKED": return "BLOCKED";
    default: return "IDLE";
  }
}

function getStateColor(state: string): string {
  if (state.includes("STRONG")) return "#00ffcc";
  if (state.includes("WATCH")) return "#ffcc00";
  if (state === "BLOCKED") return "#ff4444";
  return "#666688";
}

function getRiskGateColor(gate: string): string {
  if (gate === "ALLOW") return "#00ffcc";
  if (gate === "WATCH") return "#ffcc00";
  if (gate === "REDUCE") return "#ff8844";
  return "#ff4444";
}

// ─── SSE Hook for SI Decisions ──────────────────────────────────────────────

function useSIStream(maxEvents = 30) {
  const [decisions, setDecisions] = useState<SIDecisionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/super-intelligence/stream");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("si_decision", (e) => {
      try {
        const data = JSON.parse(e.data) as SIDecisionEvent;
        setDecisions((prev) => [data, ...prev].slice(0, maxEvents));
      } catch { /* ignore */ }
    });
    return () => { es.close(); esRef.current = null; };
  }, [maxEvents]);

  return { decisions, connected };
}

// ─── 3D Components ──────────────────────────────────────────────────────────

/** Central brain — breathing sphere with neural particle cloud and energy waves */
function CentralBrain({ intensity }: { intensity: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const pulseRing1Ref = useRef<THREE.Mesh>(null);
  const pulseRing2Ref = useRef<THREE.Mesh>(null);

  const particlePositions = useMemo(() => {
    const count = 1200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.8 + Math.random() * 0.8;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    return positions;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const breathe = 1 + Math.sin(t * 0.7) * 0.05 * intensity;

    // Core sphere — slow breathe + gentle rotation
    if (meshRef.current) {
      meshRef.current.scale.setScalar(breathe * 0.75);
      meshRef.current.rotation.y = t * 0.04;
      meshRef.current.rotation.x = Math.sin(t * 0.15) * 0.1;
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.3 + Math.sin(t * 1.5) * 0.15 * intensity;
    }

    // Wireframe shell — opposite rotation for depth
    if (wireRef.current) {
      wireRef.current.scale.setScalar(breathe * 1.15);
      wireRef.current.rotation.y = -t * 0.03;
      wireRef.current.rotation.z = t * 0.02;
    }

    // Outer glow
    if (glowRef.current) {
      const gs = 1.6 + Math.sin(t * 0.5) * 0.15;
      glowRef.current.scale.setScalar(gs);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 1.0) * 0.03 * intensity;
    }

    // Particle cloud — gentle drift
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.025;
      particlesRef.current.rotation.x = Math.sin(t * 0.18) * 0.08;
      const pMat = particlesRef.current.material as THREE.PointsMaterial;
      pMat.opacity = 0.35 + Math.sin(t * 2.0) * 0.15;
    }

    // Expanding pulse rings
    if (pulseRing1Ref.current) {
      const phase1 = (t * 0.4) % 1;
      const s1 = 1.2 + phase1 * 2.5;
      pulseRing1Ref.current.scale.set(s1, s1, 1);
      (pulseRing1Ref.current.material as THREE.MeshBasicMaterial).opacity = 0.12 * (1 - phase1);
    }
    if (pulseRing2Ref.current) {
      const phase2 = ((t * 0.4) + 0.5) % 1;
      const s2 = 1.2 + phase2 * 2.5;
      pulseRing2Ref.current.scale.set(s2, s2, 1);
      (pulseRing2Ref.current.material as THREE.MeshBasicMaterial).opacity = 0.12 * (1 - phase2);
    }
  });

  return (
    <group>
      {/* Solid core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.75, 32, 32]} />
        <meshStandardMaterial
          color="#051a12"
          emissive="#00ffaa"
          emissiveIntensity={0.3}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Wireframe shell */}
      <mesh ref={wireRef}>
        <icosahedronGeometry args={[1.15, 3]} />
        <meshStandardMaterial
          color="#0a2a1e"
          emissive="#00ffcc"
          emissiveIntensity={0.12}
          wireframe
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Outer glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1.6, 32, 32]} />
        <meshBasicMaterial
          color="#00ffcc"
          transparent
          opacity={0.06}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Pulse ring 1 */}
      <mesh ref={pulseRing1Ref} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.95, 1.0, 64]} />
        <meshBasicMaterial color="#00ffcc" transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>

      {/* Pulse ring 2 (offset phase) */}
      <mesh ref={pulseRing2Ref} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.95, 1.0, 64]} />
        <meshBasicMaterial color="#00ddbb" transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>

      {/* Neural particle cloud */}
      <points ref={particlesRef}>
        <bufferGeometry>
          {/* @ts-ignore R3F bufferAttribute typing */}
          <bufferAttribute
            attach="attributes-position"
            args={[particlePositions, 3]}
            count={particlePositions.length / 3}
            array={particlePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial color="#00ffcc" size={0.012} transparent opacity={0.4} sizeAttenuation />
      </points>
    </group>
  );
}

/** Neural link with energy particles flowing from brain to node */
function NeuralLink({
  target,
  strength,
  color,
  isActive,
}: {
  target: [number, number, number];
  strength: number;
  color: string;
  isActive: boolean;
}) {
  const lineRef = useRef<THREE.Line>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 12;

  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(...target);
    const segments = 40;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = start.clone().lerp(end, t);
      const curve = Math.sin(t * Math.PI);
      point.y += curve * 0.4;
      points.push(point);
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [target]);

  // Particle positions along the link
  const particlePositions = useMemo(() => new Float32Array(particleCount * 3), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (lineRef.current) {
      const mat = lineRef.current.material as THREE.LineBasicMaterial;
      const baseOpacity = isActive ? 0.35 : 0.12;
      mat.opacity = baseOpacity + Math.sin(t * 2.5 + strength * 3) * 0.1;
    }

    // Animate particles flowing along the link
    if (particlesRef.current && isActive) {
      const start = new THREE.Vector3(0, 0, 0);
      const end = new THREE.Vector3(...target);
      const positions = particlesRef.current.geometry.attributes.position;
      for (let i = 0; i < particleCount; i++) {
        const phase = ((t * 0.8 + i / particleCount) % 1);
        const point = start.clone().lerp(end, phase);
        point.y += Math.sin(phase * Math.PI) * 0.4;
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      const pMat = particlesRef.current.material as THREE.PointsMaterial;
      pMat.opacity = 0.6 + Math.sin(t * 3) * 0.2;
    }
  });

  const Line = "line" as any;
  return (
    <group>
      <Line ref={lineRef} geometry={geometry}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.15}
          linewidth={1}
        />
      </Line>

      {/* Energy particles flowing along the link */}
      {isActive && (
        <points ref={particlesRef}>
          <bufferGeometry>
            {/* @ts-ignore R3F bufferAttribute typing */}
            <bufferAttribute
              attach="attributes-position"
              args={[particlePositions, 3]}
              count={particleCount}
              array={particlePositions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial color={color} size={0.04} transparent opacity={0.7} sizeAttenuation />
        </points>
      )}
    </group>
  );
}

/** Stock node with dynamic elevation, pulsing aura, and confidence-based glow */
function StockNode({
  stock,
  position,
  onClick,
  isSelected,
  hasNewDecision,
}: {
  stock: StockNodeData;
  position: [number, number, number];
  onClick: (stock: StockNodeData) => void;
  isSelected: boolean;
  hasNewDecision: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const auraRef = useRef<THREE.Mesh>(null);
  const flashRef = useRef(0);

  // Dynamic scaling: strong stocks are bigger (0.28 to 0.68)
  const baseScale = 0.28 + (stock.opportunityScore / 100) * 0.4;
  const color = getNodeColor(stock);
  const emissive = getNodeEmissive(stock);

  // Elevation: strong stocks float higher
  const elevation = (stock.opportunityScore / 100) * 0.8 - 0.2;

  // Track new decision flash
  useEffect(() => {
    if (hasNewDecision) flashRef.current = 1.0;
  }, [hasNewDecision]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // Elevate position
    if (groupRef.current) {
      groupRef.current.position.set(
        position[0],
        position[1] + elevation + Math.sin(t * 0.5 + position[0]) * 0.08,
        position[2]
      );
    }

    if (meshRef.current) {
      const pulseSpeed = stock.attentionLevel === "CRITICAL" ? 3.5 :
        stock.attentionLevel === "HIGH" ? 2.5 : 1.2;
      const pulseAmp = stock.attentionLevel === "CRITICAL" ? 0.07 : 0.03;
      const scale = baseScale + Math.sin(t * pulseSpeed) * pulseAmp;
      meshRef.current.scale.setScalar(isSelected ? scale * 1.35 : scale);

      // Flash on new decision
      if (flashRef.current > 0) {
        const mat = meshRef.current.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.5 + flashRef.current * 2.0;
        flashRef.current = Math.max(0, flashRef.current - 0.02);
      }
    }

    // Rotating pulse ring
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.6;
      ringRef.current.rotation.x = Math.sin(t * 0.35) * 0.25;
      const opacity = isSelected ? 0.5 : 0.15 + Math.sin(t * 2.2) * 0.1;
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = opacity;
    }

    // Expanding aura for high-confidence nodes
    if (auraRef.current) {
      const auraPhase = (t * 0.6) % 1;
      const auraScale = baseScale * (1.5 + auraPhase * 1.5);
      auraRef.current.scale.setScalar(auraScale);
      const auraOpacity = stock.confidence > 70 ? 0.08 * (1 - auraPhase) : 0;
      (auraRef.current.material as THREE.MeshBasicMaterial).opacity = auraOpacity;
    }
  });

  return (
    <Float speed={1.2} rotationIntensity={0.08} floatIntensity={0.2}>
      <group ref={groupRef} position={position}>
        {/* Main node sphere */}
        <mesh
          ref={meshRef}
          onClick={(e) => { e.stopPropagation(); onClick(stock); }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { document.body.style.cursor = "default"; }}
        >
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.5 + (stock.confidence / 100) * 0.5}
            transparent
            opacity={0.85}
          />
        </mesh>

        {/* Rotating pulse ring */}
        <mesh ref={ringRef} scale={[baseScale * 1.9, baseScale * 1.9, 1]}>
          <ringGeometry args={[0.88, 1.0, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>

        {/* Confidence aura (only for high-confidence nodes) */}
        <mesh ref={auraRef}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0} side={THREE.BackSide} />
        </mesh>

        {/* Labels */}
        <Billboard>
          <Text
            position={[0, baseScale + 0.4, 0]}
            fontSize={0.24}
            color="#ffffff"
            anchorX="center"
            anchorY="bottom"
            font="/fonts/SpaceGrotesk-Bold.ttf"
            outlineWidth={0.012}
            outlineColor="#000000"
          >
            {stock.displaySymbol}
          </Text>
          <Text
            position={[0, baseScale + 0.15, 0]}
            fontSize={0.11}
            color={getStateColor(stock.state)}
            anchorX="center"
            anchorY="bottom"
          >
            {`${stock.confidence}% \u00B7 ${getStateLabel(stock.state)}`}
          </Text>
          {/* Price change indicator */}
          <Text
            position={[0, -(baseScale + 0.15), 0]}
            fontSize={0.10}
            color={stock.changePct >= 0 ? "#00ffcc" : "#ff7162"}
            anchorX="center"
            anchorY="top"
          >
            {`${stock.changePct >= 0 ? "\u25B2" : "\u25BC"} ${Math.abs(stock.changePct).toFixed(2)}%`}
          </Text>
        </Billboard>
      </group>
    </Float>
  );
}

/** Background particle field */
function ParticleField() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 2500;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.008;
      ref.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.05) * 0.02;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        {/* @ts-ignore R3F bufferAttribute typing */}
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial color="#223344" size={0.018} transparent opacity={0.35} sizeAttenuation />
    </points>
  );
}

/** Complete 3D scene */
function BrainScene({
  stocks,
  selectedSymbol,
  onSelectStock,
  recentDecisions,
}: {
  stocks: StockNodeData[];
  selectedSymbol: string | null;
  onSelectStock: (stock: StockNodeData) => void;
  recentDecisions: SIDecisionEvent[];
}) {
  // Arrange nodes in a 3D orbital layout — strong stocks get prime positions
  const nodePositions = useMemo(() => {
    const sorted = [...stocks].map((s, origIdx) => ({ s, origIdx }))
      .sort((a, b) => b.s.opportunityScore - a.s.opportunityScore);

    const positions = new Array<[number, number, number]>(stocks.length);
    sorted.forEach(({ origIdx }, rank) => {
      const angle = (rank / stocks.length) * Math.PI * 2 - Math.PI / 2;
      // Inner orbit for top stocks, outer for weaker
      const orbitRadius = rank < 3 ? 3.8 : rank < 6 ? 4.8 : 5.6;
      const x = Math.cos(angle) * orbitRadius;
      const y = Math.sin(angle) * orbitRadius * 0.35 + Math.sin(rank * 1.1) * 0.3;
      const z = Math.sin(angle) * orbitRadius * 0.3;
      positions[origIdx] = [x, y, z];
    });
    return positions;
  }, [stocks]);

  // Track which symbols got recent decisions (for flash effect)
  const recentSymbols = useMemo(() => {
    const set = new Set<string>();
    recentDecisions.slice(0, 5).forEach((d) => set.add(d.symbol));
    return set;
  }, [recentDecisions]);

  // Compute brain intensity from average confidence
  const brainIntensity = useMemo(() => {
    const avg = stocks.reduce((sum, s) => sum + s.confidence, 0) / (stocks.length || 1);
    return avg / 100;
  }, [stocks]);

  return (
    <>
      <ambientLight intensity={0.12} />
      <pointLight position={[0, 0, 0]} intensity={2.0} color="#00ffcc" distance={14} decay={2} />
      <pointLight position={[6, 5, 5]} intensity={0.25} color="#4488ff" />
      <pointLight position={[-6, -4, -5]} intensity={0.15} color="#ff6644" />

      <CentralBrain intensity={brainIntensity} />
      <ParticleField />

      {stocks.map((stock, i) => (
        <group key={stock.symbol}>
          <NeuralLink
            target={nodePositions[i]}
            strength={stock.opportunityScore / 100}
            color={getNodeColor(stock)}
            isActive={stock.attentionLevel === "CRITICAL" || stock.attentionLevel === "HIGH" || selectedSymbol === stock.symbol}
          />
          <StockNode
            stock={stock}
            position={nodePositions[i]}
            onClick={onSelectStock}
            isSelected={selectedSymbol === stock.symbol}
            hasNewDecision={recentSymbols.has(stock.symbol)}
          />
        </group>
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom
        minDistance={3}
        maxDistance={16}
        autoRotate
        autoRotateSpeed={0.25}
        maxPolarAngle={Math.PI * 0.75}
        minPolarAngle={Math.PI * 0.25}
      />
    </>
  );
}

// ─── 2D UI Panels ───────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  backgroundColor: "rgba(10,10,11,0.88)",
  border: "1px solid rgba(72,72,73,0.2)",
  borderRadius: "10px",
  padding: "14px",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "8px",
  color: "#484849",
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  fontFamily: "Space Grotesk, sans-serif",
  fontWeight: 700,
  marginBottom: "10px",
};

function RegimePanel({ supreme }: { supreme: SupremeState }) {
  const regimeColor = supreme.regime === "RISK-ON" ? "#00ffcc" : supreme.regime === "RISK-OFF" ? "#ff7162" : "#ffcc00";
  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Market Regime</div>
      <div style={{ fontSize: "16px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: regimeColor }}>{supreme.regime}</div>
      <div style={{ fontSize: "10px", color: "#767576", marginTop: "6px" }}>
        Appetite: <span style={{ color: "#adaaab" }}>{supreme.riskAppetite}</span>
      </div>
      <div style={{ fontSize: "10px", color: "#767576", marginTop: "3px" }}>
        Capital: <span style={{ color: "#adaaab" }}>{supreme.totalCapitalAllocated}%</span>
      </div>
      <div style={{ fontSize: "10px", color: "#767576", marginTop: "3px" }}>
        Cycle: <span style={{ color: "#adaaab" }}>{supreme.lastCycleMs}ms</span>
      </div>
      {supreme.decayDetected && (
        <div style={{ fontSize: "9px", color: "#ff7162", marginTop: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>warning</span>
          Decay Detected
        </div>
      )}
    </div>
  );
}

function AttentionPanel({ stocks }: { stocks: StockNodeData[] }) {
  const sorted = [...stocks].sort((a, b) => b.opportunityScore - a.opportunityScore);
  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Attention Allocation</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {sorted.slice(0, 5).map((s) => {
          const barColor = getNodeColor(s);
          return (
            <div key={s.symbol}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 600, color: "#ffffff" }}>
                  {s.displaySymbol}
                </span>
                <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: barColor }}>
                  {s.opportunityScore}%
                </span>
              </div>
              <div style={{ height: "3px", borderRadius: "2px", backgroundColor: "rgba(255,255,255,0.05)" }}>
                <div style={{ height: "100%", borderRadius: "2px", width: `${s.opportunityScore}%`, backgroundColor: barColor, transition: "width 0.8s ease" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskGatePanel({ stocks, stress }: { stocks: StockNodeData[]; stress?: any }) {
  const blocked = stocks.filter((s) => s.riskGate === "BLOCK").length;
  const watching = stocks.filter((s) => s.riskGate === "WATCH" || s.riskGate === "REDUCE").length;
  const allowed = stocks.filter((s) => s.riskGate === "ALLOW").length;
  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Risk Gate</div>
      <div style={{ display: "flex", gap: "10px" }}>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: "18px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#00ffcc" }}>{allowed}</div>
          <div style={{ fontSize: "8px", color: "#767576", letterSpacing: "0.1em" }}>ALLOW</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: "18px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ffcc00" }}>{watching}</div>
          <div style={{ fontSize: "8px", color: "#767576", letterSpacing: "0.1em" }}>WATCH</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: "18px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ff4444" }}>{blocked}</div>
          <div style={{ fontSize: "8px", color: "#767576", letterSpacing: "0.1em" }}>BLOCK</div>
        </div>
      </div>
      {stress && (
        <div style={{ marginTop: "12px", borderTop: "1px solid rgba(72,72,73,0.12)", paddingTop: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "8px", color: (stress.systemicStressScore ?? 0) > 0.6 ? "#ff4444" : "#767576", letterSpacing: "0.1em", fontWeight: 700 }}>
              SYSTEMIC STRESS
            </span>
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: (stress.systemicStressScore ?? 0) > 0.6 ? "#ff4444" : (stress.systemicStressScore ?? 0) > 0.3 ? "#ffcc00" : "#00ffcc" }}>
              {Math.round((stress.systemicStressScore ?? 0) * 100)}%
            </span>
          </div>
          <div style={{ height: "2px", borderRadius: "1px", backgroundColor: "rgba(255,255,255,0.05)", marginTop: "4px" }}>
            <div style={{ height: "100%", borderRadius: "1px", width: `${(stress.systemicStressScore ?? 0) * 100}%`, backgroundColor: (stress.systemicStressScore ?? 0) > 0.6 ? "#ff4444" : (stress.systemicStressScore ?? 0) > 0.3 ? "#ffcc00" : "#00ffcc", transition: "width 0.8s ease" }} />
          </div>
          <div style={{ fontSize: "7px", color: "#484849", marginTop: "4px", textTransform: "uppercase" }}>
            {stress.stressRegime} \u00B7 {stress.symbolCount} SYMBOLS
          </div>
        </div>
      )}
    </div>
  );
}

function LiveSIFeed({ decisions }: { decisions: SIDecisionEvent[] }) {
  if (!decisions.length) return null;
  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Live SI Decisions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
        {decisions.slice(0, 6).map((d, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "5px 8px",
            borderRadius: "4px", backgroundColor: d.approved ? "rgba(0,255,204,0.04)" : "rgba(255,68,68,0.04)",
            border: `1px solid ${d.approved ? "rgba(0,255,204,0.12)" : "rgba(255,68,68,0.12)"}`,
          }}>
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: d.approved ? "#00ffcc" : "#ff4444", boxShadow: `0 0 6px ${d.approved ? "#00ffcc" : "#ff4444"}` }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "9px", fontWeight: 700, color: "#fff", fontFamily: "Space Grotesk" }}>
                {d.symbol} <span style={{ color: d.approved ? "#00ffcc" : "#ff4444", fontWeight: 600 }}>{d.approved ? "APPROVED" : "REJECTED"}</span>
              </div>
              <div style={{ fontSize: "8px", color: "#767576", fontFamily: "JetBrains Mono" }}>
                {d.direction} \u00B7 {(d.win_probability * 100).toFixed(0)}% win \u00B7 edge {d.edge_score?.toFixed(2)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopOpportunities({ stocks, onSelect }: { stocks: StockNodeData[]; onSelect: (s: StockNodeData) => void }) {
  const top = [...stocks]
    .filter((s) => s.riskGate !== "BLOCK")
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 4);
  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Top Opportunities</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {top.map((s) => (
          <div
            key={s.symbol}
            onClick={() => onSelect(s)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 10px", borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(72,72,73,0.18)",
              cursor: "pointer", transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(0,255,204,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)")}
          >
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffffff", fontFamily: "Space Grotesk" }}>
                {s.displaySymbol}
              </div>
              <div style={{ fontSize: "9px", color: getStateColor(s.state) }}>
                {getStateLabel(s.state)} \u00B7 {s.setupFamily}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ffffff" }}>
                {s.confidence}%
              </div>
              <div style={{ fontSize: "8px", color: s.changePct >= 0 ? "#00ffcc" : "#ff7162", fontFamily: "JetBrains Mono" }}>
                {s.changePct >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(s.changePct).toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stock Intelligence Drawer ──────────────────────────────────────────────

function StockDrawer({
  stock,
  onClose,
  onOpenFocus,
  decisions,
  intelligence,
  brainState,
  smcState,
  regimeState,
}: {
  stock: StockNodeData | null;
  onClose: () => void;
  onOpenFocus: () => void;
  decisions: SIDecisionEvent[];
  intelligence?: { dna: any; setup_memory: any; context: any } | null;
  brainState?: any;
  smcState?: any;
  regimeState?: any;
}) {
  if (!stock) return null;

  const color = getNodeColor(stock);
  const stockDecisions = decisions.filter((d) => d.symbol === stock.symbol);

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "400px", maxWidth: "92vw",
      backgroundColor: "rgba(10,10,11,0.96)", borderLeft: "1px solid rgba(72,72,73,0.2)",
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      zIndex: 100, padding: "24px", overflowY: "auto",
      animation: "slideInRight 0.25s ease-out",
    }}>
      {/* Close */}
      <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "none", border: "none", color: "#767576", cursor: "pointer", fontSize: "20px" }}>
        <span className="material-symbols-outlined">close</span>
      </button>

      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: color, boxShadow: `0 0 14px ${color}` }} />
          <span style={{ fontSize: "24px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#ffffff" }}>{stock.displaySymbol}</span>
          <span style={{ fontSize: "9px", padding: "2px 8px", borderRadius: "4px", backgroundColor: `${getStateColor(stock.state)}15`, color: getStateColor(stock.state), fontFamily: "Space Grotesk", fontWeight: 600, letterSpacing: "0.1em" }}>
            {getStateLabel(stock.state)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <span style={{ fontSize: "28px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ffffff" }}>
            ${stock.price > 1000 ? stock.price.toLocaleString() : stock.price.toFixed(2)}
          </span>
          <span style={{ fontSize: "13px", fontFamily: "JetBrains Mono", fontWeight: 700, color: stock.changePct >= 0 ? "#00ffcc" : "#ff7162" }}>
            {stock.changePct >= 0 ? "+" : ""}{stock.changePct.toFixed(2)}%
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenFocus}
          style={{
            marginTop: "10px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            borderRadius: "6px",
            border: "1px solid rgba(0,255,204,0.32)",
            backgroundColor: "rgba(0,255,204,0.08)",
            color: "#00ffcc",
            padding: "6px 10px",
            fontSize: "9px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>radar</span>
          Brain Focus Mode
        </button>
      </div>

      {/* Intelligence Metrics Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
        {[
          { label: "Confidence", value: `${stock.confidence}%`, color: stock.confidence > 70 ? "#00ffcc" : stock.confidence > 50 ? "#ffcc00" : "#ff7162" },
          { label: "Opportunity", value: `${stock.opportunityScore}%`, color: "#00ffcc" },
          { label: "Risk Gate", value: stock.riskGate, color: getRiskGateColor(stock.riskGate) },
          { label: "Regime", value: stock.regime.toUpperCase(), color: "#adaaab" },
        ].map((m) => (
          <div key={m.label} style={{ padding: "10px", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.12)" }}>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "Space Grotesk", fontWeight: 700, marginBottom: "4px" }}>{m.label}</div>
            <div style={{ fontSize: "14px", fontFamily: "JetBrains Mono", fontWeight: 700, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Market DNA */}
      <div style={{ ...panelStyle, marginBottom: "12px" }}>
        <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Market DNA</span>
          {intelligence?.dna && (
            <span style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {intelligence.dna.bar_count} bars \u00B7 {intelligence.dna.volatility_regime} vol
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {[
            { trait: "Trendiness", value: intelligence?.dna?.trendiness ?? stock.trendiness ?? 60 },
            { trait: "Breakout Quality", value: intelligence?.dna?.breakout_quality ?? stock.breakoutQuality ?? 55 },
            { trait: "Fakeout Risk", value: intelligence?.dna?.fakeout_risk ?? stock.fakeoutRisk ?? 40, invert: true },
            { trait: "Spread Stability", value: intelligence?.dna?.spread_stability ?? stock.spreadStability ?? 75 },
            { trait: "News Sensitivity", value: intelligence?.dna?.news_sensitivity ?? stock.newsSensitivity ?? 50 },
            { trait: "Momentum Persist.", value: intelligence?.dna?.momentum_persistence ?? 50 },
            { trait: "Mean Reversion", value: intelligence?.dna?.mean_reversion ?? 50 },
          ].map((d) => (
            <div key={d.trait}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span style={{ fontSize: "9px", color: "#adaaab" }}>{d.trait}</span>
                <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: "#767576" }}>{d.value}%</span>
              </div>
              <div style={{ height: "2px", borderRadius: "1px", backgroundColor: "rgba(255,255,255,0.05)" }}>
                <div style={{
                  height: "100%", borderRadius: "1px", width: `${d.value}%`,
                  backgroundColor: d.invert ? (d.value > 50 ? "#ff7162" : "#00ffcc") : (d.value > 60 ? "#00ffcc" : "#ffcc00"),
                  transition: "width 0.5s ease",
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Setup Memory */}
      <div style={{ ...panelStyle, marginBottom: "12px" }}>
        <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Setup Memory</span>
          {intelligence?.setup_memory && intelligence.setup_memory.total_decisions > 0 && (
            <span style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {intelligence.setup_memory.total_decisions} decisions \u00B7 90d
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "16px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#00ffcc" }}>
              {intelligence?.setup_memory?.total_approved ?? stock.similarSetups ?? 0}
            </div>
            <div style={{ fontSize: "7px", color: "#767576", letterSpacing: "0.1em" }}>APPROVED</div>
          </div>
          <div style={{ textAlign: "center" }}>
            {(() => {
              const wr = intelligence?.setup_memory?.overall_win_rate ?? (stock.winRate ? stock.winRate / 100 : 0.5);
              const pct = Math.round(wr * 100);
              return <div style={{ fontSize: "16px", fontFamily: "JetBrains Mono", fontWeight: 700, color: pct > 55 ? "#00ffcc" : "#ffcc00" }}>{pct}%</div>;
            })()}
            <div style={{ fontSize: "7px", color: "#767576", letterSpacing: "0.1em" }}>WIN RATE</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "16px", fontFamily: "JetBrains Mono", fontWeight: 700, color: (intelligence?.setup_memory?.overall_profit_factor ?? stock.profitFactor ?? 1) > 1.5 ? "#00ffcc" : "#ffcc00" }}>
              {(intelligence?.setup_memory?.overall_profit_factor ?? stock.profitFactor ?? 1.0).toFixed(1)}
            </div>
            <div style={{ fontSize: "7px", color: "#767576", letterSpacing: "0.1em" }}>PROFIT F.</div>
          </div>
        </div>

        {/* Top setups from real data */}
        {intelligence?.setup_memory?.top_setups && intelligence.setup_memory.top_setups.length > 0 && (
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "3px" }}>
            <div style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Top Setups</div>
            {intelligence.setup_memory.top_setups.slice(0, 3).map((s: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "9px" }}>
                <span style={{ color: "#adaaab" }}>{s.setup_type}</span>
                <span style={{ fontFamily: "JetBrains Mono", color: s.win_rate > 0.6 ? "#00ffcc" : "#ffcc00" }}>
                  {Math.round(s.win_rate * 100)}% \u00B7 {s.similar_setups} trades
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Decay warnings */}
        {intelligence?.setup_memory?.decaying_setups && intelligence.setup_memory.decaying_setups.length > 0 && (
          <div style={{ fontSize: "9px", color: "#ff7162", marginTop: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>trending_down</span>
            {intelligence.setup_memory.decaying_setups.length} setup(s) decaying \u2014 edge weakening
          </div>
        )}
        {!intelligence?.setup_memory?.decaying_setups?.length && stock.decayRate && stock.decayRate > 0.3 && (
          <div style={{ fontSize: "9px", color: "#ff7162", marginTop: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>trending_down</span>
            Setup decay detected \u2014 edge weakening
          </div>
        )}
      </div>

      {/* Claude Reasoning */}
      <div style={{ ...panelStyle, marginBottom: "12px" }}>
        <div style={labelStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "10px", color: "#00ffcc" }}>psychology</span>
            Claude Reasoning
          </span>
        </div>
        <div style={{ fontSize: "11px", color: "#adaaab", lineHeight: 1.65 }}>
          {stock.state.includes("STRONG")
            ? `${stock.displaySymbol} presents a strong ${stock.setupFamily} setup with ${stock.confidence}% confidence. Structure aligns with ${stock.regime} regime. Order flow confirms directional bias with ${stock.winRate ?? 50}% historical win rate across ${stock.similarSetups ?? 0} similar setups. Risk gate is clear \u2014 position sizing at standard Kelly fraction.`
            : stock.riskGate === "BLOCK"
            ? `${stock.displaySymbol} is currently BLOCKED. ${stock.fakeoutRisk && stock.fakeoutRisk > 50 ? "High fakeout risk (" + stock.fakeoutRisk + "%) " : ""}and adverse regime conditions make execution unreliable. Spread stability at ${stock.spreadStability ?? 0}%. Waiting for improved microstructure before re-evaluation.`
            : `${stock.displaySymbol} is on watch with a forming ${stock.setupFamily} setup. Confidence at ${stock.confidence}% needs confirmation. ${stock.similarSetups ?? 0} similar historical patterns show ${stock.winRate ?? 50}% win rate. Monitoring for trigger conditions and improved order flow alignment.`
          }
        </div>
      </div>

      {/* Execution Signature */}
      <div style={{ ...panelStyle, marginBottom: "12px" }}>
        <div style={labelStyle}>Execution Signature</div>
        <div style={{ fontSize: "10px", color: "#adaaab", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#767576" }}>Spread Stability</span>
            <span style={{ fontFamily: "JetBrains Mono", color: (stock.spreadStability ?? 75) > 80 ? "#00ffcc" : "#ffcc00" }}>{stock.spreadStability ?? 75}%</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#767576" }}>Fill Quality</span>
            <span style={{ fontFamily: "JetBrains Mono", color: "#adaaab" }}>GOOD</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#767576" }}>Best Entry</span>
            <span style={{ fontFamily: "JetBrains Mono", color: "#adaaab" }}>LIMIT</span>
          </div>
        </div>
      </div>

      {/* SMC Zones */}
      <div style={{ ...panelStyle, marginBottom: "12px" }}>
        <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>SMC Zones</span>
          {smcState && (
            <span style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              confluence {Math.round((smcState.confluenceScore ?? 0) * 100)}%
            </span>
          )}
        </div>
        {smcState?.structure && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
            <div style={{ padding: "6px 8px", borderRadius: "5px", backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.12)" }}>
              <div style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Trend</div>
              <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: 700, color: smcState.structure.trend === "bullish" ? "#00ffcc" : smcState.structure.trend === "bearish" ? "#ff7162" : "#ffcc00" }}>
                {smcState.structure.trend?.toUpperCase()}
              </div>
            </div>
            <div style={{ padding: "6px 8px", borderRadius: "5px", backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.12)" }}>
              <div style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Pattern</div>
              <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#adaaab" }}>
                {smcState.structure.pattern?.replace("_", "/")}
              </div>
            </div>
          </div>
        )}
        {/* BOS / CHoCH indicators */}
        {(smcState?.structure?.bos || smcState?.structure?.choch) && (
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            {smcState.structure.bos && (
              <span style={{
                fontSize: "8px", padding: "2px 6px", borderRadius: "3px", fontFamily: "JetBrains Mono", fontWeight: 700,
                backgroundColor: smcState.structure.bosDirection === "bullish" ? "rgba(0,255,204,0.12)" : "rgba(255,113,98,0.12)",
                color: smcState.structure.bosDirection === "bullish" ? "#00ffcc" : "#ff7162",
                border: `1px solid ${smcState.structure.bosDirection === "bullish" ? "rgba(0,255,204,0.25)" : "rgba(255,113,98,0.25)"}`,
              }}>
                BOS {smcState.structure.bosDirection?.toUpperCase()}
              </span>
            )}
            {smcState.structure.choch && (
              <span style={{
                fontSize: "8px", padding: "2px 6px", borderRadius: "3px", fontFamily: "JetBrains Mono", fontWeight: 700,
                backgroundColor: "rgba(255,204,0,0.12)", color: "#ffcc00",
                border: "1px solid rgba(255,204,0,0.25)",
              }}>
                CHoCH \u2014 REVERSAL
              </span>
            )}
          </div>
        )}
        {/* Active OBs */}
        {smcState?.activeOBs?.length > 0 && (
          <div style={{ marginBottom: "6px" }}>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "3px" }}>
              Active Order Blocks ({smcState.activeOBs.length})
            </div>
            {smcState.activeOBs.slice(0, 3).map((ob: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", padding: "2px 0" }}>
                <span style={{ color: ob.side === "bullish" ? "#00ffcc" : "#ff7162" }}>
                  {ob.side === "bullish" ? "\u25B2" : "\u25BC"} {ob.side}
                </span>
                <span style={{ fontFamily: "JetBrains Mono", color: "#767576" }}>
                  ${ob.low?.toFixed(2)} \u2013 ${ob.high?.toFixed(2)} ({Math.round((ob.strength ?? 0) * 100)}%)
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Unfilled FVGs */}
        {smcState?.unfilledFVGs?.length > 0 && (
          <div>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "3px" }}>
              Unfilled FVGs ({smcState.unfilledFVGs.length})
            </div>
            {smcState.unfilledFVGs.slice(0, 3).map((fvg: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", padding: "2px 0" }}>
                <span style={{ color: fvg.side === "bullish" ? "#00ffcc" : "#ff7162" }}>
                  {fvg.side === "bullish" ? "GAP\u2191" : "GAP\u2193"}
                </span>
                <span style={{ fontFamily: "JetBrains Mono", color: "#767576" }}>
                  ${fvg.low?.toFixed(2)} \u2013 ${fvg.high?.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Liquidity targets */}
        {(smcState?.nearestLiquidityAbove || smcState?.nearestLiquidityBelow) && (
          <div style={{ marginTop: "6px", fontSize: "9px" }}>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "3px" }}>Liquidity Targets</div>
            {smcState.nearestLiquidityAbove && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                <span style={{ color: "#ff7162" }}>\u25B2 Above</span>
                <span style={{ fontFamily: "JetBrains Mono", color: "#767576" }}>
                  ${smcState.nearestLiquidityAbove.price?.toFixed(2)} ({smcState.nearestLiquidityAbove.touches} touches)
                </span>
              </div>
            )}
            {smcState.nearestLiquidityBelow && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                <span style={{ color: "#00ffcc" }}>\u25BC Below</span>
                <span style={{ fontFamily: "JetBrains Mono", color: "#767576" }}>
                  ${smcState.nearestLiquidityBelow.price?.toFixed(2)} ({smcState.nearestLiquidityBelow.touches} touches)
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Regime + Spectral Analysis */}
      {regimeState && (
        <div style={{ ...panelStyle, marginBottom: "12px" }}>
          <div style={labelStyle}>Regime &amp; Spectral</div>
          <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#adaaab", marginBottom: "8px" }}>
            {regimeState.label}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <div style={{ padding: "6px 8px", borderRadius: "5px", backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.12)" }}>
              <div style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Trend Strength</div>
              <div style={{ fontSize: "12px", fontFamily: "JetBrains Mono", fontWeight: 700, color: (regimeState.basic?.trendStrength ?? 0) > 0.6 ? "#00ffcc" : "#ffcc00" }}>
                {Math.round((regimeState.basic?.trendStrength ?? 0) * 100)}%
              </div>
            </div>
            <div style={{ padding: "6px 8px", borderRadius: "5px", backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.12)" }}>
              <div style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Confidence</div>
              <div style={{ fontSize: "12px", fontFamily: "JetBrains Mono", fontWeight: 700, color: (regimeState.confidence ?? 0) > 0.5 ? "#00ffcc" : "#767576" }}>
                {Math.round((regimeState.confidence ?? 0) * 100)}%
              </div>
            </div>
          </div>
          {regimeState.spectral?.dominantCycleLength && (
            <div style={{ marginTop: "6px", fontSize: "9px", color: "#767576" }}>
              Dominant Cycle: <span style={{ color: "#adaaab", fontFamily: "JetBrains Mono" }}>{regimeState.spectral.dominantCycleLength} bars</span>
              {" \u00B7 "}
              Stability: <span style={{ color: "#adaaab", fontFamily: "JetBrains Mono" }}>{Math.round((regimeState.spectral.cycleStability ?? 0) * 100)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Brain Readiness Score */}
      {brainState && (
        <div style={{ ...panelStyle, marginBottom: "12px" }}>
          <div style={labelStyle}>Brain Readiness</div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <div style={{ fontSize: "28px", fontFamily: "JetBrains Mono", fontWeight: 700, color: (brainState.readinessScore ?? 0) > 0.6 ? "#00ffcc" : (brainState.readinessScore ?? 0) > 0.35 ? "#ffcc00" : "#ff7162" }}>
              {Math.round((brainState.readinessScore ?? 0) * 100)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "rgba(255,255,255,0.05)", marginBottom: "4px" }}>
                <div style={{ height: "100%", borderRadius: "2px", width: `${(brainState.readinessScore ?? 0) * 100}%`, backgroundColor: (brainState.readinessScore ?? 0) > 0.6 ? "#00ffcc" : (brainState.readinessScore ?? 0) > 0.35 ? "#ffcc00" : "#ff7162", transition: "width 0.5s ease" }} />
              </div>
              <div style={{ fontSize: "8px", color: "#767576", fontFamily: "JetBrains Mono" }}>
                S:{Math.round((brainState.structureScore ?? 0) * 100)} R:{Math.round((brainState.regimeScore ?? 0) * 100)} F:{Math.round((brainState.orderflowScore ?? 0) * 100)} V:{Math.round((brainState.volScore ?? 0) * 100)}
              </div>
            </div>
          </div>
          {brainState.summary && (
            <div style={{ fontSize: "9px", color: "#767576", lineHeight: 1.5 }}>
              {brainState.summary}
            </div>
          )}
          {brainState.microstructureEvents?.length > 0 && (
            <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "3px" }}>
              <div style={{ fontSize: "7px", color: "#484849", letterSpacing: "0.12em", textTransform: "uppercase" }}>Live Events</div>
              {brainState.microstructureEvents.slice(0, 3).map((ev: any, i: number) => (
                <div key={i} style={{ fontSize: "8px", color: ev.eventType?.includes("absorption") ? "#ffcc00" : ev.eventType?.includes("sweep") ? "#ff7162" : "#adaaab", fontFamily: "JetBrains Mono" }}>
                  \u25CF {ev.description}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent SI Decisions for this stock */}
      {stockDecisions.length > 0 && (
        <div style={{ ...panelStyle, marginBottom: "12px" }}>
          <div style={labelStyle}>Recent SI Decisions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {stockDecisions.slice(0, 4).map((d, i) => (
              <div key={i} style={{
                padding: "6px 8px", borderRadius: "4px", fontSize: "9px",
                backgroundColor: d.approved ? "rgba(0,255,204,0.04)" : "rgba(255,68,68,0.04)",
                border: `1px solid ${d.approved ? "rgba(0,255,204,0.1)" : "rgba(255,68,68,0.1)"}`,
              }}>
                <div style={{ fontWeight: 700, color: d.approved ? "#00ffcc" : "#ff4444", fontFamily: "Space Grotesk" }}>
                  {d.approved ? "APPROVED" : "REJECTED"} \u00B7 {d.direction}
                </div>
                <div style={{ color: "#767576", fontFamily: "JetBrains Mono", marginTop: "2px" }}>
                  Win: {(d.win_probability * 100).toFixed(0)}% \u00B7 Edge: {d.edge_score?.toFixed(3)} \u00B7 Quality: {(d.quality * 100).toFixed(0)}%
                </div>
                {d.entry_price && (
                  <div style={{ color: "#555", fontFamily: "JetBrains Mono", marginTop: "2px" }}>
                    Entry: ${d.entry_price.toFixed(2)} \u00B7 SL: ${d.stop_loss?.toFixed(2)} \u00B7 TP: ${d.take_profit?.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brain Page ─────────────────────────────────────────────────────────────

function BrainPageComponent() {
  const [selectedStock, setSelectedStock] = useState<StockNodeData | null>(null);
  const [focusModeOpen, setFocusModeOpen] = useState(false);

  // Real API hooks with graceful fallback
  const { data: brainEntities } = useBrainEntities();
  const { data: consciousness } = useBrainConsciousness();
  const livePrices = useLivePrices();
  const { decisions: siDecisions, connected: sseConnected } = useSIStream();
  const { data: intelligence } = useBrainIntelligence(selectedStock?.symbol ?? "");
  const { data: brainState } = useBrainState(selectedStock?.symbol ?? "");
  const { data: smcState } = useSMCState(selectedStock?.symbol ?? "");
  const { data: regimeState } = useRegimeState(selectedStock?.symbol ?? "");
  
  const entitiesSymbols = useMemo(() => brainEntities?.map((e: any) => e.symbol) || [], [brainEntities]);
  const { data: marketStress } = useMarketStress(entitiesSymbols);

  const stocks = useMemo(() => {
    if (!brainEntities?.length) return MOCK_STOCKS;
    return brainEntities.map((entity: any): StockNodeData => {
      const lp = livePrices.find((p) => p.symbol === entity.symbol);
      const sj = entity.state_json ? JSON.parse(entity.state_json) : {};
      return {
        symbol: entity.symbol,
        displaySymbol: entity.name || entity.symbol.replace("USD", ""),
        confidence: sj.confidence ?? 50,
        sentiment: sj.sentiment ?? (lp && lp.changePct > 0 ? "bullish" : lp && lp.changePct < 0 ? "bearish" : "neutral"),
        regime: entity.regime ?? "unknown",
        attentionLevel: sj.attentionLevel ?? "MEDIUM",
        opportunityScore: sj.opportunityScore ?? 50,
        setupFamily: sj.setupFamily ?? "unknown",
        state: sj.state ?? "IDLE",
        price: lp?.price ?? entity.last_price ?? 0,
        changePct: lp?.changePct ?? 0,
        riskGate: sj.riskGate ?? "ALLOW",
        winRate: sj.winRate,
        similarSetups: sj.similarSetups,
        profitFactor: sj.profitFactor,
        decayRate: sj.decayRate,
        trendiness: sj.trendiness,
        fakeoutRisk: sj.fakeoutRisk,
        breakoutQuality: sj.breakoutQuality,
        spreadStability: sj.spreadStability,
        newsSensitivity: sj.newsSensitivity,
      };
    });
  }, [brainEntities, livePrices]);

  const supreme = useMemo<SupremeState>(() => {
    if (!consciousness) return MOCK_SUPREME;
    return {
      regime: consciousness.regime ?? MOCK_SUPREME.regime,
      riskAppetite: consciousness.riskAppetite ?? MOCK_SUPREME.riskAppetite,
      totalCapitalAllocated: consciousness.totalCapitalAllocated ?? MOCK_SUPREME.totalCapitalAllocated,
      activeBrains: consciousness.activeBrains ?? stocks.length,
      lastCycleMs: consciousness.lastCycleMs ?? MOCK_SUPREME.lastCycleMs,
      decayDetected: consciousness.decayDetected ?? false,
    };
  }, [consciousness, stocks.length]);

  const handleSelectStock = useCallback((stock: StockNodeData) => {
    setSelectedStock((prev) => (prev?.symbol === stock.symbol ? null : stock));
  }, []);

  useEffect(() => {
    if (!selectedStock) {
      setFocusModeOpen(false);
    }
  }, [selectedStock]);

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 40px)", overflow: "hidden" }}>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        @keyframes glowPulse {
          0%, 100% { text-shadow: 0 0 10px rgba(0,255,204,0.5), 0 0 20px rgba(0,255,204,0.3); }
          50% { text-shadow: 0 0 20px rgba(0,255,204,0.8), 0 0 40px rgba(0,255,204,0.5), 0 0 60px rgba(0,255,204,0.3); }
        }

        @keyframes breathingGradient {
          0%, 100% { background: radial-gradient(ellipse at center, #081a14 0%, #0a0a0b 60%, #050506 100%); }
          50% { background: radial-gradient(ellipse at center, #0a1f18 0%, #0c0c0d 60%, #070708 100%); }
        }

        @keyframes neuralPulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.35; }
        }

        @keyframes connectionFlow {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }

        @keyframes superBrainGlow {
          0%, 100% {
            text-shadow:
              0 0 10px rgba(0,255,204,0.6),
              0 0 20px rgba(0,255,204,0.4),
              0 0 30px rgba(0,255,204,0.2);
            letter-spacing: 0.2em;
          }
          50% {
            text-shadow:
              0 0 20px rgba(0,255,204,0.9),
              0 0 40px rgba(0,255,204,0.6),
              0 0 60px rgba(0,255,204,0.4),
              0 0 80px rgba(0,255,204,0.2);
            letter-spacing: 0.25em;
          }
        }

        .brain-canvas-container {
          animation: breathingGradient 8s ease-in-out infinite;
        }

        .brain-title {
          animation: superBrainGlow 3s ease-in-out infinite;
        }

        .neural-network-overlay {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 20% 30%, rgba(0,255,204,0.03) 0%, transparent 50%),
            radial-gradient(circle at 80% 70%, rgba(0,255,204,0.02) 0%, transparent 50%);
          pointer-events: none;
          animation: neuralPulse 4s ease-in-out infinite;
          z-index: 2;
        }

        .connection-line {
          position: absolute;
          height: 2px;
          background: linear-gradient(90deg, rgba(0,255,204,0.3), rgba(0,255,204,0.1), transparent);
          animation: connectionFlow 3s linear infinite;
          pointer-events: none;
        }
      `}</style>

      {/* 3D Canvas with error boundary and fallback */}
      <div style={{ position: "absolute", inset: 0 }} className="brain-canvas-container">
        <Canvas
          camera={{ position: [0, 1.5, 9], fov: 52 }}
          style={{ background: "radial-gradient(ellipse at center, #081a14 0%, #0a0a0b 60%, #050506 100%)" }}
          gl={{ antialias: true, alpha: true, failIfMajorPerformanceCaveat: false }}
          dpr={[1, 1.5]}
          onCreated={(state) => {
            try {
              state.gl.capabilities;
            } catch (e) {
              console.warn("WebGL not fully supported, using fallback rendering");
            }
          }}
        >
          <Suspense fallback={null}>
            <BrainScene
              stocks={stocks}
              selectedSymbol={selectedStock?.symbol ?? null}
              onSelectStock={handleSelectStock}
              recentDecisions={siDecisions}
            />
          </Suspense>
        </Canvas>

        {/* Neural network CSS fallback overlay */}
        <div className="neural-network-overlay" />
      </div>

      {/* Title + SSE status */}
      <div style={{ position: "absolute", top: "16px", left: "20px", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span className="material-symbols-outlined" style={{
            fontSize: "18px",
            color: "#00ffcc",
            animation: "glowPulse 2s ease-in-out infinite",
          }}>neurology</span>
          <span className="brain-title" style={{
            fontSize: "14px",
            fontFamily: "Space Grotesk",
            fontWeight: 700,
            color: "#ffffff",
          }}>
            SUPER BRAIN
          </span>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            backgroundColor: sseConnected ? "#00ffcc" : "#ff4444",
            boxShadow: `0 0 6px ${sseConnected ? "#00ffcc" : "#ff4444"}`,
            animation: sseConnected ? "glowPulse 1.5s ease-in-out infinite" : "none",
          }} />
        </div>
        <div style={{ fontSize: "9px", color: "#484849", fontFamily: "JetBrains Mono", letterSpacing: "0.1em" }}>
          {stocks.length} NODES \u00B7 CYCLE {supreme.lastCycleMs}ms \u00B7 {supreme.regime}
          {sseConnected ? " \u00B7 SI LIVE" : ""}
        </div>
      </div>

      {/* Animated connection lines between panels */}
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
        <defs>
          <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0,255,204,0.3)" />
            <stop offset="50%" stopColor="rgba(0,255,204,0.6)" />
            <stop offset="100%" stopColor="rgba(0,255,204,0.1)" />
          </linearGradient>
        </defs>
      </svg>

      {/* Left panels */}
      <div style={{ position: "absolute", top: "16px", left: "20px", marginTop: "52px", zIndex: 10, display: "flex", flexDirection: "column", gap: "10px", width: "220px" }}>
        <RegimePanel supreme={supreme} />
        <AttentionPanel stocks={stocks} />
        <RiskGatePanel stocks={stocks} stress={marketStress} />
        <LiveSIFeed decisions={siDecisions} />
      </div>

      {/* Right panel */}
      <div style={{ position: "absolute", top: "16px", right: selectedStock ? "420px" : "20px", zIndex: 10, width: "220px", transition: "right 0.25s ease" }}>
        <TopOpportunities stocks={stocks} onSelect={handleSelectStock} />
      </div>

      {/* Bottom signal strip */}
      <div style={{
        position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)",
        zIndex: 10, display: "flex", gap: "8px",
      }}>
        {stocks
          .filter((s) => s.state !== "IDLE")
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 6)
          .map((s) => (
            <div
              key={s.symbol}
              onClick={() => handleSelectStock(s)}
              style={{
                ...panelStyle, padding: "8px 14px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "8px", minWidth: "115px",
                transition: "border-color 0.15s",
                borderColor: selectedStock?.symbol === s.symbol ? getNodeColor(s) : "rgba(72,72,73,0.2)",
              }}
            >
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: getNodeColor(s), boxShadow: `0 0 6px ${getNodeColor(s)}` }} />
              <div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#ffffff", fontFamily: "Space Grotesk" }}>{s.displaySymbol}</div>
                <div style={{ fontSize: "8px", color: getStateColor(s.state), fontFamily: "JetBrains Mono" }}>
                  {getStateLabel(s.state)} \u00B7 {s.confidence}%
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* Stock intelligence drawer */}
      <StockDrawer
        stock={selectedStock}
        onClose={() => {
          setFocusModeOpen(false);
          setSelectedStock(null);
        }}
        onOpenFocus={() => setFocusModeOpen(true)}
        decisions={siDecisions}
        intelligence={intelligence}
        brainState={brainState}
        smcState={smcState}
        regimeState={regimeState}
      />

      {/* Backdrop */}
      {selectedStock && (
        <div
          onClick={() => setSelectedStock(null)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", zIndex: 99 }}
        />
      )}

      {/* Candle-level deep intelligence modal */}
      {focusModeOpen && selectedStock && (
        <BrainFocusMode
          symbol={selectedStock.symbol}
          displaySymbol={selectedStock.displaySymbol}
          onClose={() => setFocusModeOpen(false)}
        />
      )}
    </div>
  );
}

export default BrainPageComponent;
