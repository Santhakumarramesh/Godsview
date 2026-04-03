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
import { useBrainConsciousness, useBrainEntities, useBrainIntelligence, useBrainState, useSMCState, useRegimeState, useMarketStress, useRunBacktest, useBacktestList, useBacktestResult, useSchedulerStatus, useStartScheduler, useStopScheduler, useAutonomousBrainStatus, useStartAutonomousBrain, useStopAutonomousBrain, useSetBrainMode, useJobQueue, useEnqueueJob, useStrategies, useStrategyRankings, useSuperIntelStatus, useRetrainSuperIntel, useExecutionBridgeStatus, useClosePosition, useBrainPnL, useStartPnLTracker, useStopPnLTracker, useJobHistory, useJobLatencyStats, useTradeOutcomes, useOutcomeStats, usePortfolioStats, useChartHistory, useStreamBridgeStatus, useStartStreamBridge, useCorrelationSummary, useBrainAlerts, useMarkAlertsRead, useWatchdogReport, useStartWatchdog, useBrainPerformance, usePortfolioEquityCurve, useCircuitBreakerStatus, useTripCircuitBreaker, useResetCircuitBreaker, useBrainRulebook, useRebuildRulebook, useBrainStatusSnapshot, type BacktestResult, type RulebookEntry, type StrategyItem, type StrategyRanking, type SuperIntelStatus, type BrainPositionSnapshot, type BrainPnLSummary, type BridgeStatus, type TradeOutcomeItem, type JobHistoryItem, type OutcomeStats, type BrainAlertItem, type WatchdogReport, type CorrelationSummary, type BrainPerformanceReport, type EquityPoint, type CircuitSnapshot, type Rulebook } from "@/lib/api";
import { useLivePrices } from "@/lib/market-store";
import BrainFocusMode from "@/components/BrainFocusMode";
import { BrainCycleProvider, useBrainCycleContext, type AgentLiveStatus } from "@/lib/brain_cycle_provider";

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
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      try {
        const es = new EventSource("/api/super-intelligence/stream");
        esRef.current = es;
        es.onopen = () => { if (!cancelled) setConnected(true); };
        es.onerror = () => {
          if (cancelled) return;
          setConnected(false);
          es.close();
          esRef.current = null;
          // Reconnect after 5s
          reconnectTimer.current = setTimeout(connect, 5000);
        };
        es.addEventListener("si_decision", (e) => {
          try {
            const data = JSON.parse(e.data) as SIDecisionEvent;
            if (!cancelled) setDecisions((prev) => [data, ...prev].slice(0, maxEvents));
          } catch { /* ignore parse errors */ }
        });
      } catch {
        // EventSource constructor can throw if URL is invalid
        if (!cancelled) reconnectTimer.current = setTimeout(connect, 5000);
      }
    }

    connect();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
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

// ═══════════════════════════════════════════════════════════════════════════
// L7 BACKTEST PANEL
// ═══════════════════════════════════════════════════════════════════════════

function BacktestPanel({ stocks }: { stocks: StockNodeData[] }) {
  const [symbol, setSymbol] = useState(stocks[0]?.symbol ?? "BTCUSD");
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"metrics" | "rulebook" | "regimes">("metrics");

  const runBacktest = useRunBacktest();
  const { data: listData } = useBacktestList();
  const { data: result, isLoading } = useBacktestResult(symbol, expanded);

  const handleRun = () => {
    runBacktest.mutate({ symbol, lookbackBars: 2000 });
  };

  const bt = result?.backtest ?? (result as any)?.backtestOutput;
  const chart = result?.chart ?? {};

  const pct = (n?: number) => n != null ? `${(n * 100).toFixed(1)}%` : "—";
  const fix2 = (n?: number) => n != null ? n.toFixed(2) : "—";

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: "1px solid #1e2235", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", color: "#7c83fd", fontWeight: 700, letterSpacing: "0.15em" }}>L7 BACKTEST AGENT</span>
          {listData?.count ? (
            <span style={{ background: "#1a1d35", color: "#7c83fd", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>{listData.count} runs</span>
          ) : null}
        </div>
        <span style={{ color: "#484849", fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Symbol picker + run button */}
          <div style={{ display: "flex", gap: "5px", marginBottom: "8px" }}>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              style={{ flex: 1, background: "#1a1d35", border: "1px solid #2a2d4a", color: "#e0e0e0", fontSize: "10px", borderRadius: "4px", padding: "3px 6px" }}
            >
              {stocks.map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.symbol}</option>
              ))}
            </select>
            <button
              onClick={handleRun}
              disabled={runBacktest.isPending}
              style={{
                padding: "3px 10px", borderRadius: "4px", border: "none", cursor: "pointer",
                background: runBacktest.isPending ? "#1a1d35" : "#7c83fd",
                color: runBacktest.isPending ? "#666" : "#fff",
                fontSize: "10px", fontWeight: 700,
              }}
            >
              {runBacktest.isPending ? "Running…" : "Run Backtest"}
            </button>
          </div>

          {/* Loading / no data state */}
          {isLoading && <div style={{ color: "#484849", fontSize: "9px", textAlign: "center", padding: "8px 0" }}>Loading…</div>}
          {runBacktest.isError && (
            <div style={{ color: "#ff4444", fontSize: "9px", marginBottom: "6px" }}>
              Error: {runBacktest.error instanceof Error ? runBacktest.error.message : "Backtest failed"}
            </div>
          )}

          {/* Results */}
          {bt && (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
                {(["metrics", "rulebook", "regimes"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    style={{
                      padding: "2px 8px", borderRadius: "3px", border: "none", cursor: "pointer",
                      background: activeTab === t ? "#7c83fd" : "#1a1d35",
                      color: activeTab === t ? "#fff" : "#666",
                      fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
                    }}
                  >{t}</button>
                ))}
              </div>

              {activeTab === "metrics" && (
                <div>
                  {/* Key metrics grid */}
                  {[
                    ["Win Rate", pct(bt.winRate), bt.winRate > 0.55 ? "#00e676" : bt.winRate > 0.45 ? "#ffcc00" : "#ff4444"],
                    ["Sharpe", fix2(bt.sharpeRatio), bt.sharpeRatio > 1.5 ? "#00e676" : bt.sharpeRatio > 0.8 ? "#ffcc00" : "#ff4444"],
                    ["Sortino", fix2(bt.sortinoRatio), bt.sortinoRatio > 2 ? "#00e676" : bt.sortinoRatio > 1 ? "#ffcc00" : "#ff4444"],
                    ["Calmar", fix2(bt.calmarRatio), bt.calmarRatio > 1 ? "#00e676" : "#ffcc00"],
                    ["Prof. Factor", fix2(bt.profitFactor), bt.profitFactor > 1.5 ? "#00e676" : bt.profitFactor > 1 ? "#ffcc00" : "#ff4444"],
                    ["Expectancy", fix2(bt.expectancy) + "R", bt.expectancy > 0.3 ? "#00e676" : "#ffcc00"],
                    ["Max DD", fix2(bt.maxDrawdownR) + "R", bt.maxDrawdownR < 3 ? "#00e676" : bt.maxDrawdownR < 5 ? "#ffcc00" : "#ff4444"],
                    ["Trades", String(bt.totalTrades ?? 0), "#e0e0e0"],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #1a1d35" }}>
                      <span style={{ color: "#666", fontSize: "9px" }}>{label}</span>
                      <span style={{ color: color as string, fontSize: "9px", fontWeight: 700 }}>{value}</span>
                    </div>
                  ))}
                  {/* MTF comparison */}
                  <div style={{ marginTop: "6px", padding: "5px", background: "#12141f", borderRadius: "4px" }}>
                    <div style={{ color: "#666", fontSize: "8px", marginBottom: "3px", letterSpacing: "0.1em" }}>MTF ALIGNMENT IMPACT</div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#00e676", fontSize: "9px" }}>✓ Aligned: {pct(bt.mtfAlignedWR)}</span>
                      <span style={{ color: "#ff4444", fontSize: "9px" }}>✗ Divergent: {pct(bt.mtfDivergentWR)}</span>
                    </div>
                  </div>
                  {/* Chart snapshots */}
                  {chart.snapshotsGenerated > 0 && (
                    <div style={{ marginTop: "5px", color: "#7c83fd", fontSize: "9px" }}>
                      📸 {chart.snapshotsGenerated} chart snapshots — top score: {((chart.topConfirmationScore ?? 0) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )}

              {activeTab === "rulebook" && (
                <div>
                  <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "5px" }}>EMPIRICAL RULEBOOK</div>
                  {(!bt.rulebook || bt.rulebook.length === 0) ? (
                    <div style={{ color: "#484849", fontSize: "9px" }}>No rules yet — run with more bars</div>
                  ) : bt.rulebook.map((rule: RulebookEntry, i: number) => (
                    <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #1a1d35" }}>
                      <div style={{ color: "#e0e0e0", fontSize: "9px" }}>{rule.rule}</div>
                      <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                        <span style={{ color: "#666", fontSize: "8px" }}>Evidence: {rule.evidence}</span>
                        <span style={{ color: rule.impact > 0 ? "#00e676" : "#ff4444", fontSize: "8px" }}>Impact: {rule.impact > 0 ? "+" : ""}{fix2(rule.impact)}R</span>
                        <span style={{ color: "#ffcc00", fontSize: "8px" }}>Rel: {pct(rule.reliability)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "regimes" && (
                <div>
                  <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "5px" }}>REGIME PERFORMANCE</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{ color: "#00e676", fontSize: "9px" }}>Best: {bt.bestRegime?.replace("_", " ") ?? "—"}</span>
                    <span style={{ color: "#ff4444", fontSize: "9px" }}>Worst: {bt.worstRegime?.replace("_", " ") ?? "—"}</span>
                  </div>
                  <div style={{ color: "#484849", fontSize: "8px" }}>
                    Trade in {bt.bestRegime?.replace("_", " ")} regime for highest win rate.
                    Avoid or reduce size in {bt.worstRegime?.replace("_", " ")}.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Recent backtest index */}
          {!bt && listData?.results && listData.results.length > 0 && (
            <div>
              <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "4px" }}>RECENT BACKTESTS</div>
              {listData.results.slice(0, 5).map((r) => (
                <div
                  key={r.symbol}
                  style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", cursor: "pointer", borderBottom: "1px solid #1a1d35" }}
                  onClick={() => setSymbol(r.symbol)}
                >
                  <span style={{ color: "#e0e0e0", fontSize: "9px" }}>{r.symbol}</span>
                  <span style={{ color: "#7c83fd", fontSize: "9px" }}>WR {((r.winRate ?? 0) * 100).toFixed(0)}% / Sh {(r.sharpeRatio ?? 0).toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// L8 CHART PLOT PANEL
// ═══════════════════════════════════════════════════════════════════════════

function ChartPlotPanel({ stocks }: { stocks: StockNodeData[] }) {
  const [symbol, setSymbol] = useState(stocks[0]?.symbol ?? "BTCUSD");
  const [expanded, setExpanded] = useState(false);
  const [showSvg, setShowSvg] = useState(false);

  const runBacktest = useRunBacktest();
  const { data: result, isLoading } = useBacktestResult(symbol, expanded);

  const handleGenerateCharts = () => {
    runBacktest.mutate({ symbol, lookbackBars: 2000 });
  };

  const topSvg = (result as any)?.topSnapshotSvg ?? null;
  const chart = result?.chart ?? {};

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: "1px solid #1e2235", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", color: "#ff9800", fontWeight: 700, letterSpacing: "0.15em" }}>L8 CHART AGENT</span>
          {chart.snapshotsGenerated > 0 && (
            <span style={{ background: "#1a1d35", color: "#ff9800", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>{chart.snapshotsGenerated} snapshots</span>
          )}
        </div>
        <span style={{ color: "#484849", fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          <div style={{ color: "#484849", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "6px" }}>
            ANNOTATED SETUP SNAPSHOTS — captures exact confirmation bars with OBs, FVGs, BOS, orderflow
          </div>

          {/* Symbol + generate */}
          <div style={{ display: "flex", gap: "5px", marginBottom: "8px" }}>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              style={{ flex: 1, background: "#1a1d35", border: "1px solid #2a2d4a", color: "#e0e0e0", fontSize: "10px", borderRadius: "4px", padding: "3px 6px" }}
            >
              {stocks.map((s) => (<option key={s.symbol} value={s.symbol}>{s.symbol}</option>))}
            </select>
            <button
              onClick={handleGenerateCharts}
              disabled={runBacktest.isPending}
              style={{
                padding: "3px 10px", borderRadius: "4px", border: "none", cursor: "pointer",
                background: runBacktest.isPending ? "#1a1d35" : "#ff9800",
                color: runBacktest.isPending ? "#666" : "#000",
                fontSize: "10px", fontWeight: 700,
              }}
            >
              {runBacktest.isPending ? "Plotting…" : "📸 Plot Charts"}
            </button>
          </div>

          {isLoading && <div style={{ color: "#484849", fontSize: "9px", textAlign: "center", padding: "8px" }}>Loading…</div>}

          {/* Snapshot count + quality */}
          {chart.snapshotsGenerated > 0 && (
            <div style={{ marginBottom: "8px", padding: "6px", background: "#12141f", borderRadius: "4px" }}>
              <div style={{ color: "#ff9800", fontSize: "10px", fontWeight: 700 }}>📸 {chart.snapshotsGenerated} snapshots generated</div>
              <div style={{ color: "#666", fontSize: "9px", marginTop: "2px" }}>
                Top setup score: {((chart.topConfirmationScore ?? 0) * 100).toFixed(0)}%
              </div>
              {chart.allSnapshotIds?.length > 0 && (
                <div style={{ color: "#484849", fontSize: "8px", marginTop: "2px" }}>
                  IDs: {chart.allSnapshotIds.slice(0, 3).map((id: string) => id.slice(0, 8)).join(", ")}
                  {chart.allSnapshotIds.length > 3 ? ` +${chart.allSnapshotIds.length - 3} more` : ""}
                </div>
              )}
            </div>
          )}

          {/* SVG preview toggle */}
          {topSvg && (
            <div>
              <button
                onClick={() => setShowSvg(!showSvg)}
                style={{
                  padding: "3px 8px", borderRadius: "4px", border: "1px solid #ff9800",
                  background: "transparent", color: "#ff9800",
                  fontSize: "9px", cursor: "pointer", marginBottom: "6px",
                }}
              >
                {showSvg ? "Hide" : "Preview"} Top Setup Chart
              </button>

              {showSvg && (
                <div style={{
                  width: "100%", overflowX: "auto", borderRadius: "4px",
                  border: "1px solid #2a2d4a", background: "#0d0d14",
                }}>
                  {/* Inline SVG from the agent */}
                  <div
                    style={{ transform: "scale(0.35)", transformOrigin: "top left", width: "1200px", height: "700px" }}
                    dangerouslySetInnerHTML={{ __html: topSvg }}
                  />
                </div>
              )}
            </div>
          )}

          {!topSvg && !isLoading && !runBacktest.isPending && (
            <div style={{ color: "#484849", fontSize: "9px", textAlign: "center", padding: "8px 0" }}>
              Click "Plot Charts" to generate annotated setup snapshots.<br/>
              The agent will walk the bars, detect confirmations, and snapshot each setup.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER PANEL — Non-Stop Brain Control
// ═══════════════════════════════════════════════════════════════════════════
// AUTONOMOUS BRAIN PANEL — Command center for the self-directing brain
// ═══════════════════════════════════════════════════════════════════════════

const BRAIN_MODE_COLORS: Record<string, string> = {
  AGGRESSIVE: "#ff9800",
  NORMAL: "#00ff88",
  DEFENSIVE: "#ff4444",
  PAUSED: "#484849",
};

function AutonomousBrainPanel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "jobs" | "queue">("overview");

  const { data: status } = useAutonomousBrainStatus();
  const startBrain = useStartAutonomousBrain();
  const stopBrain = useStopAutonomousBrain();
  const setMode = useSetBrainMode();
  const { data: jobData } = useJobQueue();
  const enqueue = useEnqueueJob();

  const brain = status?.brain;
  const queue = status?.queue ?? jobData?.stats;
  const isRunning = status?.running ?? false;
  const modeColor = brain?.mode ? BRAIN_MODE_COLORS[brain.mode] ?? "#888" : "#484849";

  const handleStart = () => {
    startBrain.mutate({ symbols: stocks.slice(0, 10).map((s) => s.symbol), cycleIntervalMs: 30_000 });
  };

  const uptimeMin = brain?.startedAt && isRunning ? Math.floor((Date.now() - brain.startedAt) / 60_000) : 0;

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `2px solid ${isRunning ? modeColor : "#1e2235"}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "10px", color: modeColor, fontWeight: 700, letterSpacing: "0.15em" }}>
            {isRunning ? `⚡ BRAIN ${brain?.mode ?? ""}` : "○ AUTONOMOUS BRAIN"}
          </span>
          {isRunning && brain && (
            <span style={{ background: `${modeColor}20`, color: modeColor, padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>
              {brain.cycleCount} cycles
            </span>
          )}
        </div>
        <span style={{ color: "#484849", fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {isRunning && brain ? (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
                {(["overview", "jobs", "queue"] as const).map((t) => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{ padding: "2px 8px", borderRadius: "3px", border: "none", cursor: "pointer", background: activeTab === t ? modeColor : "#1a1d35", color: activeTab === t ? "#000" : "#666", fontSize: "9px", fontWeight: 700, textTransform: "uppercase" }}>{t}</button>
                ))}
              </div>

              {activeTab === "overview" && (
                <>
                  {[
                    ["Mode", brain.mode, modeColor],
                    ["Uptime", `${uptimeMin}m`, "#e0e0e0"],
                    ["Symbols", brain.symbols?.join(", ") ?? "—", "#e0e0e0"],
                    ["Scans", String(brain.scanCount), "#7c83fd"],
                    ["Backtests", String(brain.backtestCount), "#00ccff"],
                    ["Evolutions", String(brain.evolutionCount), "#00ff88"],
                    ["Jobs Done", String(brain.totalJobsCompleted), "#00ff88"],
                    ["Errors", String(brain.errors), brain.errors > 10 ? "#ff4444" : "#666"],
                    ["Win Streak", `${brain.consecutiveWins}W / ${brain.consecutiveLosses}L`, brain.consecutiveLosses >= 5 ? "#ff4444" : "#00ff88"],
                  ].map(([label, value, color]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #1a1d35" }}>
                      <span style={{ color: "#666", fontSize: "9px" }}>{label}</span>
                      <span style={{ color: color as string, fontSize: "9px" }}>{value}</span>
                    </div>
                  ))}

                  {/* Attention map */}
                  {brain.opportunityRank?.length > 0 && (
                    <div style={{ marginTop: "6px" }}>
                      <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "3px" }}>ATTENTION RANK</div>
                      {brain.opportunityRank.slice(0, 5).map((sym, i) => (
                        <div key={sym} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                          <span style={{ color: i === 0 ? "#ffd700" : "#888", fontSize: "9px" }}>{i + 1}. {sym}</span>
                          <span style={{ color: "#7c83fd", fontSize: "9px" }}>{((brain.attentionMap?.[sym] ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Mode switch */}
                  <div style={{ display: "flex", gap: "3px", marginTop: "8px", flexWrap: "wrap" }}>
                    {(["AGGRESSIVE", "NORMAL", "DEFENSIVE"] as const).map((m) => (
                      <button key={m} onClick={() => setMode.mutate(m)} style={{ padding: "2px 6px", borderRadius: "3px", border: `1px solid ${BRAIN_MODE_COLORS[m]}`, background: brain.mode === m ? BRAIN_MODE_COLORS[m] : "transparent", color: brain.mode === m ? "#000" : BRAIN_MODE_COLORS[m], fontSize: "8px", cursor: "pointer" }}>{m}</button>
                    ))}
                  </div>

                  <button onClick={() => stopBrain.mutate()} style={{ width: "100%", marginTop: "8px", padding: "4px", borderRadius: "4px", border: "1px solid #ff4444", background: "transparent", color: "#ff4444", fontSize: "9px", cursor: "pointer" }}>
                    Stop Autonomous Brain
                  </button>
                </>
              )}

              {activeTab === "jobs" && queue && (
                <>
                  <div style={{ marginBottom: "6px" }}>
                    {[
                      ["Queued", queue.queued, "#ffcc00"],
                      ["Running", queue.running, "#00ccff"],
                      ["Done", queue.done, "#00ff88"],
                      ["Failed", queue.failed, "#ff4444"],
                    ].map(([label, count, color]) => (
                      <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span style={{ color: "#666", fontSize: "9px" }}>{label}</span>
                        <span style={{ color: color as string, fontSize: "9px", fontWeight: 700 }}>{count}</span>
                      </div>
                    ))}
                  </div>
                  {/* Type breakdown */}
                  {queue.byType && Object.entries(queue.byType).slice(0, 6).map(([type, count]) => (
                    <div key={type} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                      <span style={{ color: "#484849", fontSize: "8px" }}>{type}</span>
                      <span style={{ color: "#888", fontSize: "8px" }}>{String(count)}</span>
                    </div>
                  ))}
                </>
              )}

              {activeTab === "queue" && (
                <>
                  {/* Manual job enqueue */}
                  <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "5px" }}>MANUAL JOB DISPATCH</div>
                  {(["SCAN_SYMBOL", "BACKTEST", "RETRAIN_ML", "BUILD_RULEBOOK"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => enqueue.mutate({ type, symbol: brain.symbols?.[0] ?? "BTCUSD", reason: "Manual dispatch" })}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "3px 6px", marginBottom: "3px", borderRadius: "3px", border: "1px solid #2a2d4a", background: "#1a1d35", color: "#888", fontSize: "9px", cursor: "pointer" }}
                    >
                      + {type}
                    </button>
                  ))}

                  {/* Recent completed */}
                  {jobData?.recentCompleted && jobData.recentCompleted.length > 0 && (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "3px" }}>RECENT COMPLETED</div>
                      {jobData.recentCompleted.slice(-5).reverse().map((j) => (
                        <div key={j.id} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", borderBottom: "1px solid #1a1d35" }}>
                          <span style={{ color: j.status === "done" ? "#00ff88" : "#ff4444", fontSize: "8px" }}>{j.type}</span>
                          <span style={{ color: "#484849", fontSize: "8px" }}>{j.latencyMs != null ? `${(j.latencyMs / 1000).toFixed(1)}s` : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ color: "#484849", fontSize: "9px", marginBottom: "8px" }}>
                The Autonomous Brain runs all 8 agent layers continuously, assigns jobs to agents, learns from outcomes, and evolves strategies non-stop.
              </div>
              <div style={{ color: "#666", fontSize: "8px", marginBottom: "6px" }}>
                Symbols: {stocks.slice(0, 8).map((s) => s.symbol).join(", ")}
              </div>
              <button onClick={handleStart} disabled={startBrain.isPending} style={{ width: "100%", padding: "6px", borderRadius: "4px", border: "none", background: startBrain.isPending ? "#1a1d35" : "#00ff88", color: startBrain.isPending ? "#666" : "#000", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>
                {startBrain.isPending ? "Starting…" : "⚡ Launch Autonomous Brain"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY EVOLUTION PANEL
// ═══════════════════════════════════════════════════════════════════════════

const TIER_COLORS: Record<string, string> = {
  ELITE: "#ffd700",
  PROVEN: "#00ff88",
  LEARNING: "#7c83fd",
  SEED: "#666",
  DEGRADING: "#ff9800",
  SUSPENDED: "#ff4444",
};

function StrategyEvolutionPanel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const { data: rankData } = useStrategyRankings(stocks.map((s) => s.symbol));
  const { data: stratData } = useStrategies();

  const rankings = rankData?.rankings ?? [];
  const strategies = stratData?.strategies ?? [];
  const eliteCount = strategies.filter((s) => s.tier === "ELITE").length;
  const degradingCount = strategies.filter((s) => s.tier === "DEGRADING" || s.tier === "SUSPENDED").length;

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `1px solid ${eliteCount > 0 ? "#ffd700" : "#1e2235"}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", color: "#ffd700", fontWeight: 700, letterSpacing: "0.15em" }}>STRATEGY EVOLUTION</span>
          {strategies.length > 0 && (
            <span style={{ background: "#1a1d35", color: "#ffd700", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>{strategies.length} active</span>
          )}
          {degradingCount > 0 && (
            <span style={{ background: "#ff443020", color: "#ff4444", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>⚠ {degradingCount} degrading</span>
          )}
        </div>
        <span style={{ color: "#484849", fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {strategies.length === 0 ? (
            <div style={{ color: "#484849", fontSize: "9px", textAlign: "center", padding: "10px" }}>
              No strategies evolved yet. Start the Autonomous Brain to begin.
            </div>
          ) : (
            <>
              {/* Rankings */}
              {rankings.slice(0, 8).map((r) => (
                <div key={`${r.strategyId}-${r.symbol}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid #1a1d35" }}>
                  <div>
                    <span style={{ color: "#e0e0e0", fontSize: "9px", fontWeight: 700 }}>{r.symbol}</span>
                    <span style={{ color: "#484849", fontSize: "8px", marginLeft: "4px" }}>v{r.version}</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ color: TIER_COLORS[r.tier] ?? "#666", fontSize: "8px", fontWeight: 700 }}>{r.tier}</span>
                    <span style={{ color: "#7c83fd", fontSize: "8px" }}>{(r.compositeScore * 100).toFixed(0)}</span>
                  </div>
                </div>
              ))}

              {/* Strategy detail for top strategies */}
              {strategies.filter((s) => s.tier === "ELITE" || s.tier === "PROVEN").slice(0, 3).map((s) => (
                <div key={`${s.strategyId}-${s.symbol}`} style={{ marginTop: "6px", padding: "6px", background: `${TIER_COLORS[s.tier]}10`, borderRadius: "4px", border: `1px solid ${TIER_COLORS[s.tier]}30` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{ color: TIER_COLORS[s.tier], fontSize: "10px", fontWeight: 700 }}>{s.symbol} — {s.tier}</span>
                    <span style={{ color: "#666", fontSize: "8px" }}>{s.changeCount} mutations</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {[
                      ["WR", `${(s.winRate * 100).toFixed(0)}%`],
                      ["Sharpe", s.sharpeRatio.toFixed(1)],
                      ["Score", (s.minConfirmationScore * 100).toFixed(0) + "%"],
                      ["Kelly", `${(s.maxKellyFraction * 100).toFixed(0)}%`],
                    ].map(([label, val]) => (
                      <div key={label} style={{ textAlign: "center" }}>
                        <div style={{ color: "#484849", fontSize: "7px" }}>{label}</div>
                        <div style={{ color: "#e0e0e0", fontSize: "9px", fontWeight: 700 }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {s.requireMTFAlignment && <div style={{ color: "#00ff88", fontSize: "8px", marginTop: "2px" }}>✓ MTF Required</div>}
                  {s.blacklistedRegimes.length > 0 && <div style={{ color: "#ff9800", fontSize: "8px", marginTop: "2px" }}>⊘ {s.blacklistedRegimes.join(", ")}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPER INTELLIGENCE V2 PANEL
// ═══════════════════════════════════════════════════════════════════════════

function SuperIntelV2Panel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0]?.symbol ?? "BTCUSD");

  const { data: intelData } = useSuperIntelStatus();
  const retrain = useRetrainSuperIntel();

  const models = intelData?.models ?? [];
  const selectedModel = models.find((m) => m.symbol === selectedSymbol) ?? models[0];

  const totalOutcomes = models.reduce((sum, m) => sum + m.outcomes, 0);
  const avgAccuracy = models.length > 0 ? models.reduce((sum, m) => sum + m.accuracy, 0) / models.length : 0;

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: "1px solid #1e2235", overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", color: "#cc88ff", fontWeight: 700, letterSpacing: "0.15em" }}>SUPER INTEL v2</span>
          {totalOutcomes > 0 && (
            <span style={{ background: "#1a1d35", color: "#cc88ff", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>{totalOutcomes} outcomes</span>
          )}
          {avgAccuracy > 0 && (
            <span style={{ background: avgAccuracy > 0.6 ? "#00ff8820" : "#1a1d35", color: avgAccuracy > 0.6 ? "#00ff88" : "#888", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>
              {(avgAccuracy * 100).toFixed(0)}% acc
            </span>
          )}
        </div>
        <span style={{ color: "#484849", fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {models.length === 0 ? (
            <div style={{ color: "#484849", fontSize: "9px", textAlign: "center", padding: "10px" }}>
              No model data yet. Record trade outcomes to begin learning.
            </div>
          ) : (
            <>
              {/* Symbol selector */}
              <div style={{ display: "flex", gap: "5px", marginBottom: "8px" }}>
                <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)} style={{ flex: 1, background: "#1a1d35", border: "1px solid #2a2d4a", color: "#e0e0e0", fontSize: "10px", borderRadius: "4px", padding: "3px 6px" }}>
                  {models.map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                </select>
                <button onClick={() => retrain.mutate(selectedSymbol)} disabled={retrain.isPending} style={{ padding: "3px 8px", borderRadius: "4px", border: "none", background: retrain.isPending ? "#1a1d35" : "#cc88ff", color: retrain.isPending ? "#666" : "#000", fontSize: "9px", cursor: "pointer" }}>
                  {retrain.isPending ? "…" : "Retrain"}
                </button>
              </div>

              {selectedModel && (
                <>
                  {/* Model metrics */}
                  {[
                    ["Version", `v${selectedModel.version}`, "#cc88ff"],
                    ["Outcomes", String(selectedModel.outcomes), "#e0e0e0"],
                    ["Accuracy", `${(selectedModel.accuracy * 100).toFixed(1)}%`, selectedModel.accuracy > 0.6 ? "#00ff88" : "#ffcc00"],
                    ["Brier Score", selectedModel.brier.toFixed(3), selectedModel.brier < 0.15 ? "#00ff88" : "#ffcc00"],
                    ["Last Retrain", new Date(selectedModel.lastRetrainedAt).toLocaleTimeString(), "#666"],
                  ].map(([label, value, color]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #1a1d35" }}>
                      <span style={{ color: "#666", fontSize: "9px" }}>{label}</span>
                      <span style={{ color: color as string, fontSize: "9px" }}>{value}</span>
                    </div>
                  ))}

                  {/* Sub-model weights */}
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "3px" }}>ENSEMBLE WEIGHTS</div>
                    {Object.entries(selectedModel.weights).map(([model, w]) => (
                      <div key={model} style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "2px" }}>
                        <span style={{ color: "#666", fontSize: "8px", width: "22px" }}>{model.toUpperCase()}</span>
                        <div style={{ flex: 1, height: "4px", background: "#1a1d35", borderRadius: "2px" }}>
                          <div style={{ width: `${(w * 100)}%`, height: "100%", background: "#cc88ff", borderRadius: "2px" }} />
                        </div>
                        <span style={{ color: "#888", fontSize: "8px", width: "30px", textAlign: "right" }}>{((w as number) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Regime calibration */}
                  {Object.keys(selectedModel.regimeCalibration).length > 0 && (
                    <div style={{ marginTop: "6px" }}>
                      <div style={{ color: "#666", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "3px" }}>REGIME CALIBRATION</div>
                      {Object.entries(selectedModel.regimeCalibration).slice(0, 5).map(([regime, cal]) => (
                        <div key={regime} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                          <span style={{ color: "#484849", fontSize: "8px" }}>{regime}</span>
                          <span style={{ color: (cal as number) > 1 ? "#00ff88" : "#ff9800", fontSize: "8px" }}>{(cal as number).toFixed(2)}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

function SchedulerPanel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const { data: status } = useSchedulerStatus();
  const startScheduler = useStartScheduler();
  const stopScheduler = useStopScheduler();

  const handleStart = () => {
    startScheduler.mutate({ symbols: stocks.slice(0, 10).map((s) => s.symbol), cycleIntervalMs: 30_000 });
  };

  const uptimeSec = status ? Math.floor((Date.now() - (status.lastCycleAt || Date.now())) / 1000) : 0;

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `1px solid ${status?.running ? "#00ff88" : "#1e2235"}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", color: status?.running ? "#00ff88" : "#484849", fontWeight: 700, letterSpacing: "0.15em" }}>
            {status?.running ? "● " : "○ "}AUTO-SCHEDULER
          </span>
          {status?.running && (
            <span style={{ background: "#00ff8820", color: "#00ff88", padding: "1px 5px", borderRadius: "3px", fontSize: "9px" }}>
              {status.cycleCount} cycles
            </span>
          )}
        </div>
        <span style={{ color: "#484849", fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {status?.running ? (
            <>
              <div style={{ marginBottom: "6px" }}>
                {[
                  ["Status", "Running", "#00ff88"],
                  ["Symbols", status.symbols?.join(", ") ?? "—", "#e0e0e0"],
                  ["Cycles", String(status.cycleCount), "#7c83fd"],
                  ["Errors", String(status.errorCount), status.errorCount > 5 ? "#ff4444" : "#666"],
                  ["Last Cycle", status.lastCycleAt ? new Date(status.lastCycleAt).toLocaleTimeString() : "—", "#666"],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #1a1d35" }}>
                    <span style={{ color: "#666", fontSize: "9px" }}>{label}</span>
                    <span style={{ color: color as string, fontSize: "9px" }}>{value}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => stopScheduler.mutate()}
                style={{ width: "100%", padding: "5px", borderRadius: "4px", border: "1px solid #ff4444", background: "transparent", color: "#ff4444", fontSize: "10px", cursor: "pointer" }}
              >
                Stop Scheduler
              </button>
            </>
          ) : (
            <>
              <div style={{ color: "#484849", fontSize: "9px", marginBottom: "8px" }}>
                Start non-stop 8-layer brain cycles for all symbols. L1-L6 every 30s, L7-L8 every hour.
              </div>
              <div style={{ marginBottom: "6px", color: "#666", fontSize: "8px" }}>
                {stocks.slice(0, 10).map((s) => s.symbol).join(", ")}
              </div>
              <button
                onClick={handleStart}
                disabled={startScheduler.isPending}
                style={{
                  width: "100%", padding: "5px", borderRadius: "4px", border: "none",
                  background: startScheduler.isPending ? "#1a1d35" : "#00ff88",
                  color: startScheduler.isPending ? "#666" : "#000",
                  fontSize: "10px", fontWeight: 700, cursor: "pointer",
                }}
              >
                {startScheduler.isPending ? "Starting…" : "▶ Start Non-Stop Brain"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

// ─── Agent Intelligence Panel ──────────────────────────────────────────────
// Shows live agent statuses, brain cycle controls, and decision reasoning

// 6-Layer agent labels with sub-agents
const AGENT_LABELS: Record<string, { label: string; icon: string; isLayer?: boolean; color?: string }> = {
  // Layer agents (primary)
  L1_perception:   { label: "L1 PERCEPTION",    icon: "visibility",       isLayer: true, color: "#00ccff" },
  L2_structure:    { label: "L2 STRUCTURE",      icon: "architecture",     isLayer: true, color: "#00ffcc" },
  L3_context:      { label: "L3 CONTEXT",        icon: "public",           isLayer: true, color: "#ffcc00" },
  L4_memory:       { label: "L4 MEMORY",         icon: "psychology",       isLayer: true, color: "#cc88ff" },
  L5_intelligence: { label: "L5 INTELLIGENCE",   icon: "neurology",        isLayer: true, color: "#ff6688" },
  L6_evolution:    { label: "L6 EVOLUTION",       icon: "auto_awesome",     isLayer: true, color: "#88ff88" },
  // Sub-agents
  structure:       { label: "SMC",               icon: "architecture" },
  regime:          { label: "Regime",             icon: "insights" },
  orderflow:       { label: "Orderflow",         icon: "waterfall_chart" },
  liquidity:       { label: "Liquidity",         icon: "water_drop" },
  volatility:      { label: "Volatility",        icon: "bolt" },
  stress:          { label: "Stress",             icon: "warning" },
  memory:          { label: "Memory",             icon: "psychology" },
  dna:             { label: "DNA",                icon: "dna" },
  risk:            { label: "Risk Gate",          icon: "shield" },
  brain:           { label: "Brain",              icon: "neurology" },
  macro:           { label: "Macro",              icon: "language" },
  sentiment:       { label: "Sentiment",          icon: "sentiment_satisfied" },
  mtf:             { label: "MTF",                icon: "stacked_line_chart" },
  ml_model:        { label: "ML Model",           icon: "model_training" },
  circuit_breaker: { label: "Breaker",            icon: "power_off" },
  attribution:     { label: "Attribution",        icon: "attribution" },
  production_gate: { label: "Prod Gate",          icon: "verified" },
  reasoning:       { label: "Reasoning",          icon: "lightbulb" },
  position_sizer:  { label: "Sizing",             icon: "scale" },
  super_intel:     { label: "Super Intel",        icon: "rocket_launch" },
};

function getAgentStatusColor(status: string): string {
  switch (status) {
    case "running": return "#ffcc00";
    case "done": return "#00ffcc";
    case "error": return "#ff4444";
    default: return "#484849";
  }
}

function getActionColor(action: string): string {
  switch (action) {
    case "STRONG_LONG": return "#00ffcc";
    case "STRONG_SHORT": return "#ff4444";
    case "WATCH_LONG": return "#00cc99";
    case "WATCH_SHORT": return "#ff8844";
    case "BLOCKED": return "#ff4444";
    default: return "#484849";
  }
}

function AgentIntelPanel({ stocks }: { stocks: StockNodeData[] }) {
  const {
    cycleId, isRunning, connected, agents, decisions,
    cycleStartedAt, cycleFinishedAt, cycleLatencyMs,
    triggerCycle, error,
  } = useBrainCycleContext();

  const [expanded, setExpanded] = useState(true);

  const handleRunCycle = useCallback(() => {
    const symbols = stocks.map((s) => s.symbol).slice(0, 10);
    if (symbols.length > 0) triggerCycle(symbols);
  }, [stocks, triggerCycle]);

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);
  const doneCount = agentList.filter((a) => a.status === "done").length;
  const errorCount = agentList.filter((a) => a.status === "error").length;
  const runningCount = agentList.filter((a) => a.status === "running").length;

  return (
    <div style={{
      ...panelStyle,
      padding: "10px 12px",
      maxHeight: expanded ? "520px" : "42px",
      overflow: "hidden",
      transition: "max-height 0.3s ease",
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", marginBottom: expanded ? "8px" : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="material-symbols-outlined" style={{
            fontSize: "14px",
            color: isRunning ? "#ffcc00" : connected ? "#00ffcc" : "#ff4444",
            animation: isRunning ? "glowPulse 0.5s ease-in-out infinite" : "none",
          }}>hub</span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "#ffffff", fontFamily: "Space Grotesk", letterSpacing: "0.08em" }}>
            AGENTS {cycleId > 0 ? `#${cycleId}` : ""}
          </span>
          {isRunning && (
            <span style={{ fontSize: "8px", color: "#ffcc00", fontFamily: "JetBrains Mono", animation: "glowPulse 1s ease-in-out infinite" }}>
              RUNNING
            </span>
          )}
        </div>
        <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#484849", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          expand_more
        </span>
      </div>

      {expanded && (
        <>
          {/* Run Cycle Button */}
          <button
            onClick={handleRunCycle}
            disabled={isRunning}
            style={{
              width: "100%", padding: "6px 10px", marginBottom: "8px",
              borderRadius: "4px", border: "1px solid rgba(0,255,204,0.2)",
              backgroundColor: isRunning ? "rgba(255,204,0,0.05)" : "rgba(0,255,204,0.06)",
              color: isRunning ? "#ffcc00" : "#00ffcc",
              fontSize: "9px", fontWeight: 700, fontFamily: "Space Grotesk",
              letterSpacing: "0.1em", cursor: isRunning ? "wait" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {isRunning ? "CYCLE RUNNING..." : "RUN BRAIN CYCLE"}
          </button>

          {/* 6-Layer Agent Grid */}
          {agentList.length > 0 && (() => {
            // Separate layer agents from sub-agents
            const layers = agentList.filter((a) => a.agentId.startsWith("L"));
            const subs = agentList.filter((a) => !a.agentId.startsWith("L"));

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "8px" }}>
                <div style={{ fontSize: "8px", color: "#484849", fontFamily: "JetBrains Mono", marginBottom: "2px" }}>
                  {layers.filter((a) => a.status === "done").length}/6 LAYERS {runningCount > 0 ? ` \u00B7 ${runningCount} ACTIVE` : ""}{errorCount > 0 ? ` \u00B7 ${errorCount} ERR` : ""}
                </div>

                {/* Layer agents — prominent */}
                {layers.map((agent) => {
                  const info = AGENT_LABELS[agent.agentId] ?? { label: agent.agentId, icon: "smart_toy" };
                  const layerColor = info.color ?? getAgentStatusColor(agent.status);
                  // Find sub-agents belonging to this layer
                  const layerSubs = subs.filter((s) => {
                    // Match by symbol and approximate timing
                    return s.symbol === agent.symbol;
                  });

                  return (
                    <div key={`${agent.agentId}:${agent.symbol}`}>
                      {/* Layer row */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: "5px",
                        padding: "4px 6px", borderRadius: "4px",
                        backgroundColor: agent.status === "running" ? `${layerColor}08` : agent.status === "done" ? `${layerColor}06` : "transparent",
                        borderLeft: `2px solid ${agent.status === "done" ? layerColor : agent.status === "running" ? "#ffcc00" : "#333"}`,
                      }}>
                        <div style={{
                          width: "6px", height: "6px", borderRadius: "50%",
                          backgroundColor: agent.status === "running" ? "#ffcc00" : agent.status === "done" ? layerColor : "#484849",
                          boxShadow: `0 0 4px ${agent.status === "running" ? "#ffcc00" : layerColor}`,
                          animation: agent.status === "running" ? "glowPulse 0.5s ease-in-out infinite" : "none",
                        }} />
                        <span className="material-symbols-outlined" style={{ fontSize: "12px", color: agent.status === "done" ? layerColor : "#666" }}>
                          {info.icon}
                        </span>
                        <span style={{ fontSize: "8px", fontWeight: 700, color: agent.status === "done" ? "#fff" : "#888", fontFamily: "Space Grotesk", flex: 1, letterSpacing: "0.05em" }}>
                          {info.label}
                        </span>
                        {agent.report && (
                          <span style={{
                            fontSize: "8px", fontWeight: 700, fontFamily: "JetBrains Mono",
                            color: agent.report.score > 0.6 ? layerColor : agent.report.score < 0.35 ? "#ff4444" : "#888",
                          }}>
                            {(agent.report.score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {/* Score bar */}
                      {agent.report && (
                        <div style={{ height: "2px", marginLeft: "8px", marginRight: "4px", marginTop: "1px", marginBottom: "2px", borderRadius: "1px", backgroundColor: "#1a1a1a" }}>
                          <div style={{
                            height: "100%", borderRadius: "1px", transition: "width 0.5s ease",
                            width: `${Math.max(2, agent.report.score * 100)}%`,
                            backgroundColor: agent.report.score > 0.6 ? layerColor : agent.report.score > 0.4 ? "#ffcc00" : "#ff4444",
                            opacity: 0.7,
                          }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Latest Decisions */}
          {decisions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "8px", color: "#484849", fontFamily: "JetBrains Mono", letterSpacing: "0.1em" }}>
                DECISIONS
              </div>
              {decisions.slice(0, 4).map((d, i) => (
                <div key={i} style={{
                  padding: "5px 7px", borderRadius: "4px",
                  backgroundColor: "rgba(0,255,204,0.03)",
                  border: `1px solid ${getActionColor(d.action)}22`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "9px", fontWeight: 700, color: getActionColor(d.action), fontFamily: "Space Grotesk" }}>
                      {d.symbol} {d.action.replace("_", " ")}
                    </span>
                    <span style={{ fontSize: "8px", color: "#666", fontFamily: "JetBrains Mono" }}>
                      {(d.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ fontSize: "7px", color: "#767576", fontFamily: "JetBrains Mono", marginTop: "2px", lineHeight: "1.3" }}>
                    {d.reasoning.length > 120 ? d.reasoning.slice(0, 120) + "..." : d.reasoning}
                  </div>
                  {d.riskGate !== "ALLOW" && (
                    <div style={{ fontSize: "7px", color: d.riskGate === "BLOCK" ? "#ff4444" : "#ffcc00", fontFamily: "JetBrains Mono", marginTop: "2px" }}>
                      RISK: {d.riskGate}{d.blockReason ? ` \u2014 ${d.blockReason}` : ""}
                    </div>
                  )}
                  {/* Agent summary bar */}
                  <div style={{ display: "flex", gap: "3px", marginTop: "3px" }}>
                    {d.agentReports?.map((r, j) => {
                      const info = AGENT_LABELS[r.agentId] ?? { label: r.agentId, icon: "smart_toy" };
                      return (
                        <div key={j} title={`${info.label}: ${r.verdict}`} style={{
                          flex: 1, height: "3px", borderRadius: "1.5px",
                          backgroundColor: r.score > 0.6 ? "#00ffcc" : r.score > 0.4 ? "#ffcc00" : "#ff4444",
                          opacity: 0.6,
                        }} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cycle timing */}
          {cycleLatencyMs != null && (
            <div style={{ fontSize: "7px", color: "#484849", fontFamily: "JetBrains Mono", marginTop: "6px", textAlign: "center" }}>
              CYCLE #{cycleId} \u00B7 {cycleLatencyMs}ms \u00B7 {decisions.length} decisions
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: "8px", color: "#ff4444", fontFamily: "JetBrains Mono", marginTop: "4px", padding: "4px", backgroundColor: "rgba(255,68,68,0.05)", borderRadius: "3px" }}>
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: LIVE EXECUTION BRIDGE PANEL
// ═══════════════════════════════════════════════════════════════════════════

function ExecutionBridgePanel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"positions" | "history" | "stats">("positions");
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0]?.symbol ?? "SPY");

  const { data: bridge } = useExecutionBridgeStatus();
  const { data: pnl } = useBrainPnL();
  const { data: portfolio } = usePortfolioStats();
  const { data: outcomes } = useTradeOutcomes(selectedSymbol, 20);
  const closePos = useClosePosition();
  const startTracker = useStartPnLTracker();
  const stopTracker = useStopPnLTracker();

  const bridgeEnabled = bridge?.enabled ?? false;
  const openCount = bridge?.openPositions?.length ?? 0;
  const todayPnl = pnl?.todayPnlR ?? 0;
  const allTimePnl = pnl?.allTimePnlR ?? 0;
  const pnlColor = todayPnl >= 0 ? "#00e676" : "#ff1744";

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `2px solid ${bridgeEnabled ? "#7c3aed" : "#1e2235"}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "10px", color: "#7c3aed", fontWeight: 700, letterSpacing: "0.15em" }}>⚡ LIVE EXECUTION</span>
          {bridgeEnabled && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e676", display: "inline-block" }} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", color: pnlColor, fontWeight: 700 }}>{todayPnl >= 0 ? "+" : ""}{todayPnl.toFixed(2)}R today</span>
          <span style={{ fontSize: "10px", color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Status row */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
            {[
              { label: "POSITIONS", val: openCount, color: openCount > 0 ? "#fbbf24" : "#555" },
              { label: "APPROVED", val: bridge?.totalApproved ?? 0, color: "#00e676" },
              { label: "BLOCKED", val: bridge?.totalBlocked ?? 0, color: "#ff1744" },
              { label: "ALL-TIME R", val: `${allTimePnl >= 0 ? "+" : ""}${allTimePnl.toFixed(1)}`, color: allTimePnl >= 0 ? "#00e676" : "#ff1744" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ flex: 1, minWidth: "44px", background: "#0a0c14", borderRadius: 4, padding: "3px 4px", textAlign: "center" }}>
                <div style={{ fontSize: "11px", color, fontWeight: 700 }}>{val}</div>
                <div style={{ fontSize: "8px", color: "#555" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            {(["positions", "history", "stats"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ flex: 1, padding: "3px 0", background: activeTab === t ? "#7c3aed" : "#1a1d2e", border: "none", borderRadius: 4, color: activeTab === t ? "#fff" : "#666", fontSize: "9px", cursor: "pointer", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t}
              </button>
            ))}
          </div>

          {activeTab === "positions" && (
            <div>
              {(pnl?.openPositions ?? []).length === 0 ? (
                <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "12px 0" }}>No open positions</div>
              ) : (
                (pnl?.openPositions ?? []).map((pos: BrainPositionSnapshot) => (
                  <div key={pos.symbol} style={{ background: "#0a0c14", borderRadius: 4, padding: "6px 8px", marginBottom: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", color: pos.direction === "long" ? "#00e676" : "#ff6b6b", fontWeight: 700 }}>
                        {pos.direction === "long" ? "▲" : "▼"} {pos.symbol}
                      </span>
                      <span style={{ fontSize: "10px", color: pos.unrealizedPnlR >= 0 ? "#00e676" : "#ff1744", fontWeight: 700 }}>
                        {pos.unrealizedPnlR >= 0 ? "+" : ""}{pos.unrealizedPnlR.toFixed(2)}R
                      </span>
                    </div>
                    <div style={{ fontSize: "9px", color: "#666", marginTop: "2px" }}>
                      Entry {pos.entryPrice.toFixed(2)} → Current {pos.currentPrice.toFixed(2)} | {pos.ageMinutes}min
                    </div>
                    <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                      <span style={{ flex: 1, fontSize: "8px", color: "#ff6b6b", background: "#1a1020", padding: "2px 3px", borderRadius: 2, textAlign: "center" }}>
                        SL {pos.stopLoss.toFixed(2)}
                      </span>
                      <span style={{ flex: 1, fontSize: "8px", color: "#00e676", background: "#0a1a10", padding: "2px 3px", borderRadius: 2, textAlign: "center" }}>
                        TP {pos.takeProfit.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "3px", marginTop: "4px" }}>
                      <button onClick={() => closePos.mutate({ symbol: pos.symbol, exitPrice: pos.currentPrice, reason: "MANUAL" })}
                        style={{ flex: 1, padding: "2px 0", background: "#ff1744", border: "none", borderRadius: 3, color: "#fff", fontSize: "8px", cursor: "pointer", fontWeight: 700 }}>
                        CLOSE
                      </button>
                    </div>
                  </div>
                ))
              )}
              {/* P&L Today row */}
              <div style={{ borderTop: "1px solid #1e2235", marginTop: "6px", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "9px", color: "#666" }}>Today: {pnl?.todayWins ?? 0}W / {pnl?.todayLosses ?? 0}L</span>
                <span style={{ fontSize: "9px", color: pnlColor, fontWeight: 700 }}>WR {((pnl?.runningWinRate ?? 0) * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div>
              <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}
                style={{ width: "100%", background: "#1a1d2e", color: "#ccc", border: "1px solid #2a2d3e", borderRadius: 4, padding: "3px 5px", fontSize: "10px", marginBottom: "6px" }}>
                {stocks.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
              </select>
              {(outcomes?.outcomes ?? []).slice(0, 10).map((o: TradeOutcomeItem) => (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #1a1d2e" }}>
                  <span style={{ fontSize: "9px", color: o.outcome === "WIN" ? "#00e676" : o.outcome === "LOSS" ? "#ff6b6b" : "#fbbf24" }}>
                    {o.outcome ?? "?"} {o.direction.toUpperCase()[0]}
                  </span>
                  <span style={{ fontSize: "9px", color: Number(o.pnl_r ?? 0) >= 0 ? "#00e676" : "#ff6b6b" }}>
                    {Number(o.pnl_r ?? 0) >= 0 ? "+" : ""}{Number(o.pnl_r ?? 0).toFixed(2)}R
                  </span>
                  <span style={{ fontSize: "8px", color: "#555" }}>
                    {o.regime?.substring(0, 6) ?? "?"}
                  </span>
                </div>
              ))}
              {(outcomes?.outcomes ?? []).length === 0 && (
                <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "8px 0" }}>No outcomes recorded yet</div>
              )}
            </div>
          )}

          {activeTab === "stats" && (
            <div>
              <div style={{ fontSize: "9px", color: "#666", marginBottom: "6px", letterSpacing: "0.1em" }}>PORTFOLIO PERFORMANCE</div>
              {(portfolio?.stats ?? []).slice(0, 6).map((s: any) => (
                <div key={s.symbol} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid #1a1d2e" }}>
                  <span style={{ fontSize: "9px", color: "#aaa", fontWeight: 600 }}>{s.symbol}</span>
                  <span style={{ fontSize: "9px", color: s.winRate >= 0.5 ? "#00e676" : "#ff6b6b" }}>{(s.winRate * 100).toFixed(0)}% WR</span>
                  <span style={{ fontSize: "9px", color: s.totalPnlR >= 0 ? "#00e676" : "#ff1744", fontWeight: 700 }}>
                    {s.totalPnlR >= 0 ? "+" : ""}{s.totalPnlR.toFixed(1)}R
                  </span>
                </div>
              ))}
              {(portfolio?.stats ?? []).length === 0 && (
                <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "8px 0" }}>No portfolio data yet</div>
              )}
              {/* Bridge config */}
              <div style={{ marginTop: "8px", background: "#0a0c14", borderRadius: 4, padding: "6px 8px" }}>
                <div style={{ fontSize: "8px", color: "#555", marginBottom: "4px" }}>BRIDGE CONFIG</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "9px", color: "#666" }}>Min Score</span>
                  <span style={{ fontSize: "9px", color: "#ccc" }}>{bridge?.config?.minScore ?? "--"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "9px", color: "#666" }}>Min Win Prob</span>
                  <span style={{ fontSize: "9px", color: "#ccc" }}>{((bridge?.config?.minWinProb ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "9px", color: "#666" }}>Max Positions</span>
                  <span style={{ fontSize: "9px", color: "#ccc" }}>{bridge?.config?.maxPositions ?? "--"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "9px", color: "#666" }}>Risk/Trade</span>
                  <span style={{ fontSize: "9px", color: "#ccc" }}>{bridge?.config?.riskPerTradePct ?? "--"}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: JOB HISTORY + LATENCY ANALYTICS PANEL
// ═══════════════════════════════════════════════════════════════════════════

function JobHistoryPanel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"recent" | "latency">("recent");
  const [filterType, setFilterType] = useState<string>("");

  const { data: historyData } = useJobHistory(50, filterType || undefined);
  const { data: latencyData } = useJobLatencyStats();

  const jobTypeOptions = ["", "SCAN_SYMBOL", "BACKTEST", "EVOLVE_STRATEGY", "RETRAIN_ML", "CHART_SNAPSHOT", "RANK_SYMBOLS"];

  const statusColor = (s: string) => {
    if (s === "completed") return "#00e676";
    if (s === "failed") return "#ff1744";
    if (s === "cancelled") return "#fbbf24";
    return "#888";
  };

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: "2px solid #1e2235", overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontSize: "10px", color: "#22d3ee", fontWeight: 700, letterSpacing: "0.15em" }}>📋 JOB HISTORY</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", color: "#666" }}>{historyData?.count ?? 0} records</span>
          <span style={{ fontSize: "10px", color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            {(["recent", "latency"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ flex: 1, padding: "3px 0", background: activeTab === t ? "#22d3ee" : "#1a1d2e", border: "none", borderRadius: 4, color: activeTab === t ? "#000" : "#666", fontSize: "9px", cursor: "pointer", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t}
              </button>
            ))}
          </div>

          {activeTab === "recent" && (
            <div>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                style={{ width: "100%", background: "#1a1d2e", color: "#ccc", border: "1px solid #2a2d3e", borderRadius: 4, padding: "3px 5px", fontSize: "10px", marginBottom: "6px" }}>
                {jobTypeOptions.map((t) => <option key={t} value={t}>{t || "All Types"}</option>)}
              </select>
              {(historyData?.jobs ?? []).slice(0, 15).map((j: JobHistoryItem) => (
                <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid #1a1d2e" }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: "9px", color: "#ccc", fontWeight: 600 }}>{j.job_type.replace("_", " ")}</span>
                    {j.symbol && <span style={{ fontSize: "8px", color: "#555", marginLeft: "4px" }}>{j.symbol}</span>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: "9px", color: statusColor(j.status) }}>{j.status.toUpperCase()[0]}</span>
                    {j.latency_ms && <span style={{ fontSize: "8px", color: "#555", marginLeft: "4px" }}>{j.latency_ms < 1000 ? `${j.latency_ms}ms` : `${(j.latency_ms / 1000).toFixed(1)}s`}</span>}
                  </div>
                </div>
              ))}
              {(historyData?.jobs ?? []).length === 0 && (
                <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "8px 0" }}>No job history yet</div>
              )}
            </div>
          )}

          {activeTab === "latency" && (
            <div>
              {(latencyData?.stats ?? []).map((s: any) => (
                <div key={s.jobType} style={{ background: "#0a0c14", borderRadius: 4, padding: "5px 7px", marginBottom: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                    <span style={{ fontSize: "9px", color: "#ccc", fontWeight: 600 }}>{s.jobType.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: "8px", color: "#555" }}>{s.count} jobs</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#22d3ee", fontWeight: 700 }}>{s.p50LatencyMs ? `${(s.p50LatencyMs / 1000).toFixed(1)}s` : "—"}</div>
                      <div style={{ fontSize: "7px", color: "#555" }}>P50</div>
                    </div>
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#fbbf24", fontWeight: 700 }}>{s.p95LatencyMs ? `${(s.p95LatencyMs / 1000).toFixed(1)}s` : "—"}</div>
                      <div style={{ fontSize: "7px", color: "#555" }}>P95</div>
                    </div>
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: s.failCount > 0 ? "#ff6b6b" : "#00e676", fontWeight: 700 }}>{s.failCount}</div>
                      <div style={{ fontSize: "7px", color: "#555" }}>FAIL</div>
                    </div>
                  </div>
                </div>
              ))}
              {(latencyData?.stats ?? []).length === 0 && (
                <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "8px 0" }}>No latency data yet</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: ALERT FEED PANEL
// ═══════════════════════════════════════════════════════════════════════════

function AlertFeedPanel() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "warnings" | "critical">("all");
  const { data: alertData } = useBrainAlerts(30, activeTab === "all" ? undefined : activeTab.toUpperCase());
  const markRead = useMarkAlertsRead();

  const alerts = alertData?.alerts ?? [];
  const stats = alertData?.stats;
  const unread = stats?.unread ?? 0;

  const levelColor = (level: string) => {
    if (level === "CRITICAL") return "#ff1744";
    if (level === "WARNING") return "#fbbf24";
    return "#22d3ee";
  };

  const codeIcon = (code: string) => {
    if (code.includes("TP_HIT")) return "✓";
    if (code.includes("SL_HIT")) return "✗";
    if (code.includes("ELITE")) return "★";
    if (code.includes("DEFENSIVE")) return "🛡";
    if (code.includes("CONTAGION")) return "⚠";
    if (code.includes("LOSSES")) return "📉";
    if (code.includes("BRAIN_STOPPED")) return "💀";
    return "●";
  };

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `2px solid ${unread > 0 ? "#ff6b35" : "#1e2235"}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "10px", color: "#ff6b35", fontWeight: 700, letterSpacing: "0.15em" }}>🔔 ALERTS</span>
          {unread > 0 && (
            <span style={{ background: "#ff1744", color: "#fff", borderRadius: "8px", padding: "0 5px", fontSize: "8px", fontWeight: 700 }}>{unread}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", color: "#666" }}>{alertData?.count ?? 0} total</span>
          <span style={{ fontSize: "10px", color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            {(["all", "warnings", "critical"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ flex: 1, padding: "3px 0", background: activeTab === t ? "#ff6b35" : "#1a1d2e", border: "none", borderRadius: 4, color: activeTab === t ? "#000" : "#666", fontSize: "9px", cursor: "pointer", fontWeight: 600, textTransform: "uppercase" }}>
                {t}
              </button>
            ))}
          </div>

          {/* Mark all read */}
          {unread > 0 && (
            <button onClick={() => markRead.mutate({ all: true })}
              style={{ width: "100%", padding: "3px 0", background: "#1a1d2e", border: "1px solid #2a2d3e", borderRadius: 4, color: "#888", fontSize: "9px", cursor: "pointer", marginBottom: "6px" }}>
              Mark all read ({unread})
            </button>
          )}

          {/* Alert list */}
          <div style={{ maxHeight: "200px", overflowY: "auto" }}>
            {alerts.slice(0, 15).map((a: BrainAlertItem) => (
              <div key={a.id} style={{
                padding: "5px 7px", marginBottom: "4px", borderRadius: 4,
                background: a.readAt ? "#0a0c14" : "#12142a",
                borderLeft: `3px solid ${levelColor(a.level)}`,
                opacity: a.readAt ? 0.7 : 1,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "9px", color: levelColor(a.level), fontWeight: 700 }}>
                    {codeIcon(a.code)} {a.title}
                  </span>
                  {a.symbol && <span style={{ fontSize: "8px", color: "#555" }}>{a.symbol}</span>}
                </div>
                <div style={{ fontSize: "9px", color: "#888", marginTop: "2px", lineHeight: "1.3" }}>{a.message}</div>
                <div style={{ fontSize: "8px", color: "#444", marginTop: "2px" }}>
                  {new Date(a.createdAt).toISOString().slice(11, 19)}
                </div>
              </div>
            ))}
            {alerts.length === 0 && (
              <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "12px 0" }}>No alerts</div>
            )}
          </div>

          {/* Stats row */}
          <div style={{ borderTop: "1px solid #1e2235", marginTop: "6px", paddingTop: "6px", display: "flex", gap: "6px" }}>
            {[
              { label: "INFO", val: stats?.byLevel?.INFO ?? 0, color: "#22d3ee" },
              { label: "WARN", val: stats?.byLevel?.WARNING ?? 0, color: "#fbbf24" },
              { label: "CRIT", val: stats?.byLevel?.CRITICAL ?? 0, color: "#ff1744" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: "11px", color, fontWeight: 700 }}>{val}</div>
                <div style={{ fontSize: "8px", color: "#555" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: WATCHDOG + STREAM HEALTH PANEL
// ═══════════════════════════════════════════════════════════════════════════

function WatchdogPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: watchdogData } = useWatchdogReport();
  const { data: streamData } = useStreamBridgeStatus();
  const startWatchdog = useStartWatchdog();
  const startStream = useStartStreamBridge();

  const report = watchdogData?.report;
  const overallColor = report?.overallHealth === "HEALTHY" ? "#00e676"
    : report?.overallHealth === "DEGRADED" ? "#fbbf24"
    : report?.overallHealth === "FAILED" ? "#ff1744" : "#888";

  const subsystemColor = (h: string) => {
    if (h === "HEALTHY") return "#00e676";
    if (h === "DEGRADED") return "#fbbf24";
    if (h === "FAILED") return "#ff1744";
    return "#888";
  };

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `2px solid ${overallColor}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "10px", color: overallColor, fontWeight: 700, letterSpacing: "0.15em" }}>🩺 WATCHDOG</span>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: overallColor, display: "inline-block" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", color: "#666" }}>{report?.memoryUsageMb ?? 0}MB</span>
          <span style={{ fontSize: "10px", color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Controls */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            <button onClick={() => startWatchdog.mutate()}
              style={{ flex: 1, padding: "3px 0", background: "#1a2e1a", border: "1px solid #00e676", borderRadius: 4, color: "#00e676", fontSize: "9px", cursor: "pointer" }}>
              Start Watchdog
            </button>
            <button onClick={() => startStream.mutate()}
              style={{ flex: 1, padding: "3px 0", background: "#1a1a2e", border: "1px solid #7c3aed", borderRadius: 4, color: "#7c3aed", fontSize: "9px", cursor: "pointer" }}>
              Start Stream
            </button>
          </div>

          {/* Subsystems */}
          <div style={{ fontSize: "9px", color: "#666", marginBottom: "4px", letterSpacing: "0.1em" }}>SUBSYSTEMS</div>
          {(report?.subsystems ?? []).map((s: any) => (
            <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid #1a1d2e" }}>
              <span style={{ fontSize: "9px", color: "#aaa" }}>{s.name.replace(/_/g, " ")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {s.restartCount > 0 && <span style={{ fontSize: "8px", color: "#fbbf24" }}>↺{s.restartCount}</span>}
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: subsystemColor(s.health), display: "inline-block" }} />
              </div>
            </div>
          ))}

          {/* Stream status */}
          <div style={{ marginTop: "8px", background: "#0a0c14", borderRadius: 4, padding: "5px 7px" }}>
            <div style={{ fontSize: "8px", color: "#555", marginBottom: "3px" }}>STREAM BRIDGE</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "9px", color: "#666" }}>WS</span>
              <span style={{ fontSize: "9px", color: streamData?.stockWsConnected ? "#00e676" : "#ff6b6b" }}>
                {streamData?.stockWsConnected ? "CONNECTED" : "OFFLINE"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "9px", color: "#666" }}>Ticks</span>
              <span style={{ fontSize: "9px", color: "#ccc" }}>{streamData?.totalTicks ?? 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "9px", color: "#666" }}>Subscribed</span>
              <span style={{ fontSize: "9px", color: "#ccc" }}>{(streamData?.stockSubscribed ?? []).length}</span>
            </div>
          </div>

          {/* Uptime + memory */}
          <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
            <div style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#22d3ee", fontWeight: 700 }}>
                {report ? `${Math.floor((report.uptimeSeconds ?? 0) / 3600)}h${Math.floor(((report.uptimeSeconds ?? 0) % 3600) / 60)}m` : "--"}
              </div>
              <div style={{ fontSize: "8px", color: "#555" }}>UPTIME</div>
            </div>
            <div style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: (report?.memoryUsageMb ?? 0) > 1000 ? "#ff6b6b" : "#00e676", fontWeight: 700 }}>
                {report?.memoryUsageMb ?? 0}MB
              </div>
              <div style={{ fontSize: "8px", color: "#555" }}>RAM</div>
            </div>
            <div style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: (report?.stuckJobs ?? []).length > 0 ? "#ff1744" : "#00e676", fontWeight: 700 }}>
                {(report?.stuckJobs ?? []).length}
              </div>
              <div style={{ fontSize: "8px", color: "#555" }}>STUCK</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: CORRELATION + CONTAGION PANEL
// ═══════════════════════════════════════════════════════════════════════════

function CorrelationPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: corrData } = useCorrelationSummary();

  const contagionColor = !corrData?.contagionScore ? "#555"
    : corrData.contagionScore > 0.7 ? "#ff1744"
    : corrData.contagionScore > 0.4 ? "#fbbf24"
    : "#00e676";

  const divColor = !corrData?.diversificationScore ? "#555"
    : corrData.diversificationScore > 0.7 ? "#00e676"
    : corrData.diversificationScore > 0.4 ? "#fbbf24"
    : "#ff6b6b";

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `2px solid ${corrData?.hasContagionAlert ? "#ff1744" : "#1e2235"}`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "10px", color: "#a855f7", fontWeight: 700, letterSpacing: "0.15em" }}>🕸 CORRELATION</span>
          {corrData?.hasContagionAlert && (
            <span style={{ background: "#ff1744", color: "#fff", borderRadius: 3, padding: "0 4px", fontSize: "7px", fontWeight: 700 }}>CONTAGION</span>
          )}
        </div>
        <span style={{ fontSize: "10px", color: "#555" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Key metrics */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            <div style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: contagionColor, fontWeight: 700 }}>{((corrData?.contagionScore ?? 0) * 100).toFixed(0)}%</div>
              <div style={{ fontSize: "8px", color: "#555" }}>CONTAGION</div>
            </div>
            <div style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: divColor, fontWeight: 700 }}>{((corrData?.diversificationScore ?? 1) * 100).toFixed(0)}%</div>
              <div style={{ fontSize: "8px", color: "#555" }}>DIVERSIFIED</div>
            </div>
            <div style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#ccc", fontWeight: 700 }}>{corrData?.trackedSymbols ?? 0}</div>
              <div style={{ fontSize: "8px", color: "#555" }}>SYMBOLS</div>
            </div>
          </div>

          {/* Contagion alert */}
          {corrData?.contagionAlert && (
            <div style={{ background: "#1a0a0a", border: "1px solid #ff1744", borderRadius: 4, padding: "6px 8px", marginBottom: "8px" }}>
              <div style={{ fontSize: "9px", color: "#ff1744", fontWeight: 700 }}>⚠ {corrData.contagionAlert.severity}</div>
              <div style={{ fontSize: "8px", color: "#cc6666", marginTop: "2px" }}>{corrData.contagionAlert.message}</div>
            </div>
          )}

          {/* Top correlations */}
          <div style={{ fontSize: "9px", color: "#666", marginBottom: "4px" }}>TOP CORRELATIONS</div>
          {(corrData?.topCorrelations ?? []).slice(0, 4).map((p: any, i: number) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #1a1d2e" }}>
              <span style={{ fontSize: "8px", color: "#888" }}>{p.symbolA}/{p.symbolB}</span>
              <span style={{ fontSize: "9px", fontWeight: 700, color: p.correlation > 0.8 ? "#ff6b6b" : p.correlation > 0.5 ? "#fbbf24" : "#00e676" }}>
                {(p.correlation * 100).toFixed(0)}%
              </span>
            </div>
          ))}
          {(corrData?.topCorrelations ?? []).length === 0 && (
            <div style={{ textAlign: "center", color: "#444", fontSize: "10px", padding: "6px 0" }}>Insufficient data</div>
          )}

          {/* Portfolio betas to SPY */}
          {(corrData?.portfolioBetas ?? []).length > 0 && (
            <>
              <div style={{ fontSize: "9px", color: "#666", marginBottom: "4px", marginTop: "8px" }}>BETA TO SPY</div>
              {(corrData?.portfolioBetas ?? []).slice(0, 4).map((b: any) => (
                <div key={b.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span style={{ fontSize: "8px", color: "#888" }}>{b.symbol}</span>
                  <span style={{ fontSize: "8px", color: b.direction === "HEDGE" ? "#a855f7" : b.direction === "ALIGNED" ? "#ff6b6b" : "#888" }}>
                    {b.betaToSpy >= 0 ? "+" : ""}{(b.betaToSpy * 100).toFixed(0)}% {b.direction[0]}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: EQUITY CURVE + PERFORMANCE PANEL
// ═══════════════════════════════════════════════════════════════════════════

function PerformancePanel({ stocks }: { stocks: StockNodeData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0]?.symbol ?? "SPY");

  const { data: perfData } = useBrainPerformance(selectedSymbol);
  const { data: portfolioData } = usePortfolioEquityCurve();

  const totalPnlR = perfData?.totalPnlR ?? 0;
  const pnlColor = totalPnlR >= 0 ? "#00e676" : "#ff1744";

  // Mini sparkline for equity curve
  const curve = perfData?.equityCurve ?? [];
  const curvePoints = curve.length > 1 ? (() => {
    const minR = Math.min(...curve.map((p: EquityPoint) => p.cumulativeR));
    const maxR = Math.max(...curve.map((p: EquityPoint) => p.cumulativeR));
    const range = maxR - minR || 1;
    const W = 180, H = 40;
    return curve.map((p: EquityPoint, i: number) => ({
      x: (i / (curve.length - 1)) * W,
      y: H - ((p.cumulativeR - minR) / range) * H,
    }));
  })() : [];

  const svgPath = curvePoints.length > 1
    ? curvePoints.map((p: any, i: number) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    : "";

  return (
    <div style={{ background: "#0f111a", borderRadius: "10px", border: `2px solid #1e2235`, overflow: "hidden" }}>
      <div
        style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#12141f" }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontSize: "10px", color: "#10b981", fontWeight: 700, letterSpacing: "0.15em" }}>📈 PERFORMANCE</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", color: pnlColor, fontWeight: 700 }}>{totalPnlR >= 0 ? "+" : ""}{totalPnlR.toFixed(1)}R</span>
          <span style={{ fontSize: "10px", color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px" }}>
          {/* Symbol selector */}
          <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}
            style={{ width: "100%", background: "#1a1d2e", color: "#ccc", border: "1px solid #2a2d3e", borderRadius: 4, padding: "3px 5px", fontSize: "10px", marginBottom: "8px" }}>
            {stocks.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
          </select>

          {/* Key stats */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap" }}>
            {[
              { label: "WR", val: `${((perfData?.winRate ?? 0) * 100).toFixed(0)}%`, color: (perfData?.winRate ?? 0) > 0.5 ? "#00e676" : "#ff6b6b" },
              { label: "SHARPE", val: (perfData?.sharpeRatio ?? 0).toFixed(2), color: (perfData?.sharpeRatio ?? 0) > 1 ? "#00e676" : "#fbbf24" },
              { label: "MAX DD", val: `${(perfData?.maxDrawdownR ?? 0).toFixed(1)}R`, color: "#ff6b6b" },
              { label: "EXPECT", val: (perfData?.expectancy ?? 0).toFixed(2), color: (perfData?.expectancy ?? 0) > 0 ? "#00e676" : "#ff6b6b" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ flex: 1, minWidth: "44px", background: "#0a0c14", borderRadius: 4, padding: "3px 4px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", color, fontWeight: 700 }}>{val}</div>
                <div style={{ fontSize: "8px", color: "#555" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Equity curve sparkline */}
          {svgPath && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "9px", color: "#666", marginBottom: "3px" }}>EQUITY CURVE ({perfData?.totalTrades ?? 0} trades)</div>
              <svg width="180" height="40" style={{ background: "#0a0c14", borderRadius: 4, display: "block" }}>
                <path d={svgPath} fill="none" stroke={totalPnlR >= 0 ? "#00e676" : "#ff1744"} strokeWidth="1.5" />
                {/* Zero line */}
                {curvePoints.length > 0 && (
                  <line x1="0" y1="20" x2="180" y2="20" stroke="#2a2d3e" strokeWidth="0.5" strokeDasharray="2,2" />
                )}
              </svg>
            </div>
          )}

          {/* By regime */}
          {(perfData?.byRegime ?? []).length > 0 && (
            <>
              <div style={{ fontSize: "9px", color: "#666", marginBottom: "4px" }}>BY REGIME</div>
              {(perfData?.byRegime ?? []).slice(0, 4).map((r: any) => (
                <div key={r.regime} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #1a1d2e" }}>
                  <span style={{ fontSize: "8px", color: "#888" }}>{r.regime.substring(0, 10)}</span>
                  <span style={{ fontSize: "8px", color: r.winRate > 0.5 ? "#00e676" : "#ff6b6b" }}>{(r.winRate * 100).toFixed(0)}% ({r.trades})</span>
                  <span style={{ fontSize: "8px", color: r.totalPnlR >= 0 ? "#00e676" : "#ff6b6b" }}>{r.totalPnlR >= 0 ? "+" : ""}{r.totalPnlR.toFixed(1)}R</span>
                </div>
              ))}
            </>
          )}

          {/* Portfolio total */}
          {portfolioData && (
            <div style={{ marginTop: "8px", background: "#0a0c14", borderRadius: 4, padding: "5px 7px" }}>
              <div style={{ fontSize: "8px", color: "#555", marginBottom: "3px" }}>PORTFOLIO TOTAL</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "9px", color: "#666" }}>All-time P&L</span>
                <span style={{ fontSize: "9px", color: (portfolioData.totalPnlR ?? 0) >= 0 ? "#00e676" : "#ff1744", fontWeight: 700 }}>
                  {(portfolioData.totalPnlR ?? 0) >= 0 ? "+" : ""}{(portfolioData.totalPnlR ?? 0).toFixed(1)}R
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "9px", color: "#666" }}>Sharpe</span>
                <span style={{ fontSize: "9px", color: "#ccc" }}>{(portfolioData.sharpe ?? 0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: CIRCUIT BREAKER PANEL
// ═══════════════════════════════════════════════════════════════════════════

function CircuitBreakerPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: circuitData } = useCircuitBreakerStatus();
  const tripBreaker = useTripCircuitBreaker();
  const resetBreaker = useResetCircuitBreaker();

  const circuit = circuitData as any;
  const state: string = circuit?.state ?? "OPEN";
  const stateColor = state === "TRIPPED" ? "#ff1744" : state === "HALF_OPEN" ? "#ff9100" : "#00e676";
  const stateIcon = state === "TRIPPED" ? "🚨" : state === "HALF_OPEN" ? "⚠️" : "✅";

  return (
    <div style={{ background: "rgba(10,12,20,0.95)", border: `1px solid ${stateColor}40`, borderRadius: 8, padding: "8px 10px", minWidth: 200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded((x) => !x)}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>{stateIcon}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#aaa", letterSpacing: 1 }}>CIRCUIT BREAKER</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: stateColor, background: `${stateColor}22`, padding: "1px 6px", borderRadius: 4 }}>{state}</span>
          <span style={{ fontSize: 9, color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Summary row always visible */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {[
          { label: "DAY P&L", value: circuit ? `${(circuit.dailyPnlR ?? 0) >= 0 ? "+" : ""}${(circuit.dailyPnlR ?? 0).toFixed(1)}R`, color: (circuit?.dailyPnlR ?? 0) >= 0 ? "#00e676" : "#ff1744" },
          { label: "TRADES", value: String(circuit?.dailyTrades ?? 0), color: "#ccc" },
          { label: "WIN%", value: circuit?.dailyTrades > 0 ? `${((circuit.dailyWinRate ?? 0) * 100).toFixed(0)}%` : "—", color: "#888" },
        ].map((m) => (
          <div key={m.label} style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "3px 5px", textAlign: "center" }}>
            <div style={{ fontSize: "7px", color: "#555", marginBottom: 1 }}>{m.label}</div>
            <div style={{ fontSize: "10px", color: m.color, fontWeight: 700 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* Daily limits progress */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: "8px", color: "#555", marginBottom: 3 }}>DAILY LOSS LIMIT</div>
            <div style={{ height: 4, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${Math.min(100, Math.abs(circuit?.dailyPnlR ?? 0) / Math.abs(circuit?.maxDailyLossR ?? 6) * 100)}%`,
                background: state === "TRIPPED" ? "#ff1744" : state === "HALF_OPEN" ? "#ff9100" : "#00e676",
                transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
              <span style={{ fontSize: "8px", color: "#555" }}>0R</span>
              <span style={{ fontSize: "8px", color: "#555" }}>{circuit?.maxDailyLossR ?? -6}R</span>
            </div>
          </div>

          {/* Trip events */}
          {(circuit?.tripEvents?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: "8px", color: "#555", marginBottom: 3 }}>RECENT TRIPS</div>
              {circuit.tripEvents.slice(-3).reverse().map((e: any, i: number) => (
                <div key={i} style={{ fontSize: "8px", color: "#ff9100", marginBottom: 2, padding: "2px 5px", background: "#1a0a0a", borderRadius: 3 }}>
                  {e.reason} — {e.details?.substring(0, 40)}
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => tripBreaker.mutate("Manual emergency stop")}
              style={{ flex: 1, background: "#ff174422", border: "1px solid #ff174444", borderRadius: 4, padding: "4px 6px", fontSize: "8px", color: "#ff1744", cursor: "pointer", fontWeight: 700 }}>
              🛑 TRIP
            </button>
            <button
              onClick={() => resetBreaker.mutate()}
              style={{ flex: 1, background: "#00e67622", border: "1px solid #00e67644", borderRadius: 4, padding: "4px 6px", fontSize: "8px", color: "#00e676", cursor: "pointer", fontWeight: 700 }}>
              ✅ RESET
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: LIVING RULEBOOK PANEL
// ═══════════════════════════════════════════════════════════════════════════

function LivingRulebookPanel() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"insights" | "regimes" | "avoid">("insights");
  const { data: rulebookData } = useBrainRulebook();
  const rebuild = useRebuildRulebook();

  const rulebook = (rulebookData as any)?.rulebook as Rulebook | undefined;
  const totalOutcomes = rulebook?.totalOutcomesAnalyzed ?? 0;
  const eliteCount = rulebook?.byRegime?.filter((r: any) => r.edge === "STRONG").length ?? 0;

  return (
    <div style={{ background: "rgba(10,12,20,0.95)", border: "1px solid #7c4dff40", borderRadius: 8, padding: "8px 10px", minWidth: 200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded((x) => !x)}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>📚</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#aaa", letterSpacing: 1 }}>LIVING RULEBOOK</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#7c4dff" }}>v{rulebook?.version ?? 0}</span>
          <span style={{ fontSize: 9, color: "#555" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Summary always visible */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {[
          { label: "OUTCOMES", value: String(totalOutcomes), color: "#ccc" },
          { label: "ELITE REGIMES", value: String(eliteCount), color: "#ffd600" },
          { label: "INSIGHTS", value: String(rulebook?.eliteInsights?.length ?? 0), color: "#00e676" },
        ].map((m) => (
          <div key={m.label} style={{ flex: 1, background: "#0a0c14", borderRadius: 4, padding: "3px 5px", textAlign: "center" }}>
            <div style={{ fontSize: "7px", color: "#555", marginBottom: 1 }}>{m.label}</div>
            <div style={{ fontSize: "10px", color: m.color, fontWeight: 700 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
            {(["insights", "regimes", "avoid"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ flex: 1, padding: "3px 4px", fontSize: "7px", fontWeight: 700,
                  background: activeTab === t ? "#7c4dff33" : "#0a0c14",
                  border: `1px solid ${activeTab === t ? "#7c4dff" : "#1a1a2e"}`,
                  borderRadius: 3, color: activeTab === t ? "#7c4dff" : "#555", cursor: "pointer", textTransform: "uppercase" }}>
                {t}
              </button>
            ))}
          </div>

          {/* Insights */}
          {activeTab === "insights" && (
            <div style={{ maxHeight: 120, overflowY: "auto" }}>
              {(rulebook?.eliteInsights ?? []).length === 0
                ? <div style={{ fontSize: "8px", color: "#555", textAlign: "center", padding: "8px 0" }}>No insights yet — run more trades</div>
                : (rulebook?.eliteInsights ?? []).map((ins: string, i: number) => (
                  <div key={i} style={{ fontSize: "8px", color: "#00e676", padding: "2px 5px", background: "#001a0a", borderRadius: 3, marginBottom: 2 }}>
                    ✦ {ins}
                  </div>
                ))
              }
            </div>
          )}

          {/* Regimes */}
          {activeTab === "regimes" && (
            <div style={{ maxHeight: 120, overflowY: "auto" }}>
              {(rulebook?.byRegime ?? []).slice(0, 8).map((r: any, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 5px", background: "#0a0c14", borderRadius: 3, marginBottom: 2 }}>
                  <span style={{ fontSize: "8px", color: r.edge === "STRONG" ? "#ffd600" : r.edge === "AVOID" ? "#ff1744" : "#888" }}>{r.regime}</span>
                  <span style={{ fontSize: "8px", color: r.winRate >= 0.6 ? "#00e676" : r.winRate < 0.45 ? "#ff1744" : "#aaa", fontWeight: 700 }}>
                    {(r.winRate * 100).toFixed(0)}% ({r.trades})
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Avoid */}
          {activeTab === "avoid" && (
            <div style={{ maxHeight: 120, overflowY: "auto" }}>
              {(rulebook?.avoidanceList ?? []).length === 0
                ? <div style={{ fontSize: "8px", color: "#555", textAlign: "center", padding: "8px 0" }}>No avoidance rules yet</div>
                : (rulebook?.avoidanceList ?? []).map((rule: string, i: number) => (
                  <div key={i} style={{ fontSize: "8px", color: "#ff1744", padding: "2px 5px", background: "#1a0a0a", borderRadius: 3, marginBottom: 2 }}>
                    ✗ {rule}
                  </div>
                ))
              }
            </div>
          )}

          <button onClick={() => rebuild.mutate()}
            disabled={rebuild.isPending}
            style={{ width: "100%", marginTop: 6, background: "#7c4dff22", border: "1px solid #7c4dff44", borderRadius: 4, padding: "4px 6px", fontSize: "8px", color: "#7c4dff", cursor: "pointer", fontWeight: 700 }}>
            {rebuild.isPending ? "Rebuilding…" : "↺ Rebuild Rulebook"}
          </button>
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
  const { connected: brainConnected, isRunning: brainCycleRunning, cycleId: brainCycleId } = useBrainCycleContext();
  const { data: intelligence } = useBrainIntelligence(selectedStock?.symbol ?? "");
  const { data: brainState } = useBrainState(selectedStock?.symbol ?? "");
  const { data: smcState } = useSMCState(selectedStock?.symbol ?? "");
  const { data: regimeState } = useRegimeState(selectedStock?.symbol ?? "");
  
  const entitiesSymbols = useMemo(() => Array.isArray(brainEntities) ? brainEntities.map((e: any) => e.symbol) : [], [brainEntities]);
  const { data: marketStress } = useMarketStress(entitiesSymbols);

  const stocks = useMemo(() => {
    if (!Array.isArray(brainEntities) || brainEntities.length === 0) return MOCK_STOCKS;
    return brainEntities.map((entity: any): StockNodeData => {
      const lp = livePrices.find((p) => p.symbol === entity.symbol);
      let sj: any = {};
      try { sj = entity.state_json ? JSON.parse(entity.state_json) : {}; } catch { sj = {}; }
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
          {brainConnected ? ` \u00B7 BRAIN #${brainCycleId}` : ""}
          {brainCycleRunning ? " \u00B7 THINKING" : ""}
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
      <div style={{ position: "absolute", top: "16px", left: "20px", marginTop: "52px", zIndex: 10, display: "flex", flexDirection: "column", gap: "10px", width: "220px", maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
        <AutonomousBrainPanel stocks={stocks} />
        <AlertFeedPanel />
        <CircuitBreakerPanel />
        <ExecutionBridgePanel stocks={stocks} />
        <WatchdogPanel />
        <CorrelationPanel />
        <PerformancePanel stocks={stocks} />
        <LivingRulebookPanel />
        <StrategyEvolutionPanel stocks={stocks} />
        <SuperIntelV2Panel stocks={stocks} />
        <AgentIntelPanel stocks={stocks} />
        <BacktestPanel stocks={stocks} />
        <ChartPlotPanel stocks={stocks} />
        <JobHistoryPanel stocks={stocks} />
        <SchedulerPanel stocks={stocks} />
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

function BrainPageWithProvider() {
  return (
    <BrainCycleProvider>
      <BrainPageComponent />
    </BrainCycleProvider>
  );
}

export default BrainPageWithProvider;
