/**
 * brain.tsx — The Brain Page
 *
 * Hero page of GodsView: a massive 3D central brain surrounded by
 * live stock nodes, connected by glowing neural links.
 * Node size/glow scales with opportunity score + confidence.
 * Click a node → opens detailed stock drawer.
 */

import { useState, useRef, useMemo, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Billboard, Text, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ─── Types ──────────────────────────────────────────────────────────────────

type StockNodeData = {
  symbol: string;
  displaySymbol: string;
  confidence: number;      // 0-100
  sentiment: "bullish" | "bearish" | "neutral";
  regime: string;
  attentionLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";
  opportunityScore: number; // 0-100
  setupFamily: string;  state: "WATCH_LONG" | "WATCH_SHORT" | "STRONG_LONG" | "STRONG_SHORT" | "BLOCKED" | "IDLE";
  price: number;
  changePct: number;
  riskGate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
};

type SupremeState = {
  regime: string;
  riskAppetite: string;
  totalCapitalAllocated: number;
  activeBrains: number;
  lastCycleMs: number;
  decayDetected: boolean;
};

// ─── Mock Data (will be replaced by API) ────────────────────────────────────

const MOCK_STOCKS: StockNodeData[] = [
  { symbol: "BTCUSD", displaySymbol: "BTC", confidence: 88, sentiment: "bullish", regime: "risk-on", attentionLevel: "CRITICAL", opportunityScore: 92, setupFamily: "breakout", state: "STRONG_LONG", price: 87245, changePct: 2.34, riskGate: "ALLOW" },
  { symbol: "ETHUSD", displaySymbol: "ETH", confidence: 74, sentiment: "bullish", regime: "risk-on", attentionLevel: "HIGH", opportunityScore: 78, setupFamily: "continuation", state: "WATCH_LONG", price: 3412, changePct: 1.87, riskGate: "ALLOW" },
  { symbol: "NVDA", displaySymbol: "NVDA", confidence: 82, sentiment: "bullish", regime: "risk-on", attentionLevel: "HIGH", opportunityScore: 85, setupFamily: "breakout", state: "STRONG_LONG", price: 924.5, changePct: 3.12, riskGate: "ALLOW" },
  { symbol: "AAPL", displaySymbol: "AAPL", confidence: 65, sentiment: "neutral", regime: "choppy", attentionLevel: "MEDIUM", opportunityScore: 55, setupFamily: "pullback", state: "WATCH_LONG", price: 198.2, changePct: -0.32, riskGate: "WATCH" },
  { symbol: "TSLA", displaySymbol: "TSLA", confidence: 45, sentiment: "bearish", regime: "high-vol", attentionLevel: "LOW", opportunityScore: 35, setupFamily: "reversal", state: "BLOCKED", price: 172.8, changePct: -2.14, riskGate: "BLOCK" },
  { symbol: "SPY", displaySymbol: "SPY", confidence: 70, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 62, setupFamily: "trend", state: "WATCH_LONG", price: 562.4, changePct: 0.45, riskGate: "ALLOW" },  { symbol: "SPY", displaySymbol: "SPY", confidence: 70, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 62, setupFamily: "trend", state: "WATCH_LONG", price: 562.4, changePct: 0.45, riskGate: "ALLOW" },
    50→  { symbol: "QQQ", displaySymbol: "QQQ", confidence: 72, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 68, setupFamily: "trend", state: "WATCH_LONG", price: 485.3, changePct: 0.78, riskGate: "ALLOW" },
    51→  { symbol: "AMZN", displaySymbol: "AMZN", confidence: 58, sentiment: "neutral", regime: "choppy", attentionLevel: "LOW", opportunityScore: 42, setupFamily: "range", state: "IDLE", price: 186.7, changePct: -0.65, riskGate: "WATCH" },
    52→  { symbol: "META", displaySymbol: "META", confidence: 76, sentiment: "bullish", regime: "risk-on", attentionLevel: "HIGH", opportunityScore: 80, setupFamily: "breakout", state: "WATCH_LONG", price: 512.3, changePct: 1.56, riskGate: "ALLOW" },
    53→  { symbol: "SOLUSD", displaySymbol: "SOL", confidence: 69, sentiment: "bullish", regime: "risk-on", attentionLevel: "MEDIUM", opportunityScore: 71, setupFamily: "continuation", state: "WATCH_LONG", price: 187.5, changePct: 4.21, riskGate: "ALLOW" },
    54→];
    55→
    56→const MOCK_SUPREME: SupremeState = {
    57→  regime: "RISK-ON",
    58→  riskAppetite: "MODERATE",
    59→  totalCapitalAllocated: 78,
    60→  activeBrains: 10,
    61→  lastCycleMs: 1240,
    62→  decayDetected: false,
    63→};
    64→
    65→// ─── Color Helpers ──────────────────────────────────────────────────────────
    66→
    67→function getNodeColor(stock: StockNodeData): string {
    68→  if (stock.riskGate === "BLOCK") return "#ff4444";
    69→  if (stock.sentiment === "bearish") return "#ff7162";
    70→  if (stock.sentiment === "bullish") return "#00ffcc";
    71→  return "#8888aa";
    72→}

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
// ─── 3D Components ──────────────────────────────────────────────────────────

/** Animated central brain sphere with breathing + glow */
function CentralBrain() {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  // Brain particle system
  const particlePositions = useMemo(() => {
    const count = 800;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.2 + Math.random() * 0.6;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    return positions;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();    // Breathing animation
    if (meshRef.current) {
      const scale = 1 + Math.sin(t * 0.8) * 0.04;
      meshRef.current.scale.setScalar(scale);
      meshRef.current.rotation.y = t * 0.05;
    }
    if (glowRef.current) {
      const glowScale = 1.5 + Math.sin(t * 0.6) * 0.1;
      glowRef.current.scale.setScalar(glowScale);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * 1.2) * 0.03;
    }
    // Rotate particle cloud
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.03;
      particlesRef.current.rotation.x = Math.sin(t * 0.2) * 0.1;
    }
  });

  return (
    <group>
      {/* Inner brain sphere */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1.1, 4]} />
        <meshStandardMaterial
          color="#0a2a22"          emissive="#00ffcc"
          emissiveIntensity={0.15}
          wireframe
          transparent
          opacity={0.6}
        />
      </mesh>

      {/* Solid core */}
      <mesh>
        <sphereGeometry args={[0.7, 32, 32]} />
        <meshStandardMaterial
          color="#061a14"
          emissive="#00ffaa"
          emissiveIntensity={0.3}
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Outer glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1.5, 32, 32]} />
        <meshBasicMaterial
          color="#00ffcc"          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Floating particle cloud */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={particlePositions.length / 3}
            array={particlePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#00ffcc"
          size={0.015}
          transparent
          opacity={0.5}
          sizeAttenuation
        />
      </points>
    </group>  );
}

/** Neural link from center to stock node */
function NeuralLink({
  target,
  strength,
  color,
}: {
  target: [number, number, number];
  strength: number;
  color: string;
}) {
  const lineRef = useRef<THREE.Line>(null);

  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(...target);
    const segments = 30;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = start.clone().lerp(end, t);
      // Add a slight curve
      const mid = 1 - Math.abs(t - 0.5) * 2;      point.y += mid * 0.3 * (Math.sin(t * Math.PI) * 0.5);
      points.push(point);
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [target]);

  useFrame(({ clock }) => {
    if (lineRef.current) {
      const mat = lineRef.current.material as THREE.LineBasicMaterial;
      mat.opacity = 0.15 + Math.sin(clock.getElapsedTime() * 2 + strength) * 0.1;
    }
  });

  return (
    <line ref={lineRef as any} geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={0.2}
        linewidth={1}
      />
    </line>
  );
}
/** Individual stock node sphere with label */
function StockNode({
  stock,
  position,
  onClick,
  isSelected,
}: {
  stock: StockNodeData;
  position: [number, number, number];
  onClick: (stock: StockNodeData) => void;
  isSelected: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  // Scale based on opportunity score (0.25 to 0.65)
  const baseScale = 0.25 + (stock.opportunityScore / 100) * 0.4;
  const color = getNodeColor(stock);
  const emissive = getNodeEmissive(stock);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (meshRef.current) {
      // Pulse based on attention level
      const pulseSpeed = stock.attentionLevel === "CRITICAL" ? 3 : stock.attentionLevel === "HIGH" ? 2 : 1;      const pulseAmp = stock.attentionLevel === "CRITICAL" ? 0.06 : 0.03;
      const scale = baseScale + Math.sin(t * pulseSpeed) * pulseAmp;
      meshRef.current.scale.setScalar(isSelected ? scale * 1.3 : scale);
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.5;
      ringRef.current.rotation.x = Math.sin(t * 0.3) * 0.2;
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity =
        isSelected ? 0.5 : 0.15 + Math.sin(t * 2) * 0.1;
    }
  });

  return (
    <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <group position={position}>
        {/* Node sphere */}
        <mesh
          ref={meshRef}
          onClick={(e) => {
            e.stopPropagation();
            onClick(stock);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";          }}
          onPointerOut={() => {
            document.body.style.cursor = "default";
          }}
        >
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.5}
            transparent
            opacity={0.85}
          />
        </mesh>

        {/* Pulse ring */}
        <mesh ref={ringRef} scale={[baseScale * 1.8, baseScale * 1.8, 1]}>
          <ringGeometry args={[0.9, 1.0, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Symbol label */}
        <Billboard>
          <Text
            position={[0, baseScale + 0.35, 0]}
            fontSize={0.22}
            color="#ffffff"
            anchorX="center"
            anchorY="bottom"
            font="/fonts/SpaceGrotesk-Bold.ttf"
            outlineWidth={0.01}
            outlineColor="#000000"
          >
            {stock.displaySymbol}
          </Text>
          <Text
            position={[0, baseScale + 0.12, 0]}
            fontSize={0.12}
            color={getStateColor(stock.state)}
            anchorX="center"
            anchorY="bottom"
          >
            {`${stock.confidence}% · ${getStateLabel(stock.state)}`}
          </Text>
        </Billboard>      </group>
    </Float>
  );
}

/** Ambient particle field in the background */
function ParticleField() {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const count = 2000;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 30;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 30;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.01;
    }
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial color="#334455" size={0.02} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

/** Full 3D scene */
function BrainScene({
  stocks,
  selectedSymbol,
  onSelectStock,
}: {
  stocks: StockNodeData[];
  selectedSymbol: string | null;
  onSelectStock: (stock: StockNodeData) => void;}) {
  // Arrange nodes in an elliptical orbit around the center
  const nodePositions = useMemo(() => {
    return stocks.map((_, i) => {
      const angle = (i / stocks.length) * Math.PI * 2;
      const rx = 4.5 + Math.sin(i * 1.7) * 0.6;
      const ry = 3.2 + Math.cos(i * 2.3) * 0.4;
      const x = Math.cos(angle) * rx;
      const y = Math.sin(angle) * ry * 0.5 + Math.sin(i * 0.9) * 0.5;
      const z = Math.sin(angle) * rx * 0.3;
      return [x, y, z] as [number, number, number];
    });
  }, [stocks.length]);

  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 0, 0]} intensity={1.5} color="#00ffcc" distance={12} decay={2} />
      <pointLight position={[5, 5, 5]} intensity={0.3} color="#4488ff" />
      <pointLight position={[-5, -3, -5]} intensity={0.2} color="#ff6644" />

      <CentralBrain />
      <ParticleField />

      {stocks.map((stock, i) => (        <group key={stock.symbol}>
          <NeuralLink
            target={nodePositions[i]}
            strength={stock.opportunityScore / 100}
            color={getNodeColor(stock)}
          />
          <StockNode
            stock={stock}
            position={nodePositions[i]}
            onClick={onSelectStock}
            isSelected={selectedSymbol === stock.symbol}
          />
        </group>
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom
        minDistance={3}
        maxDistance={15}
        autoRotate
        autoRotateSpeed={0.3}
        maxPolarAngle={Math.PI * 0.75}
        minPolarAngle={Math.PI * 0.25}
      />    </>
  );
}

// ─── 2D UI Panels ───────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  backgroundColor: "rgba(14,14,15,0.85)",
  border: "1px solid rgba(72,72,73,0.25)",
  borderRadius: "10px",
  padding: "14px",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "8px",
  color: "#484849",
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  fontFamily: "Space Grotesk, sans-serif",
  fontWeight: 700,
  marginBottom: "10px",
};const valueStyle: React.CSSProperties = {
  fontSize: "20px",
  fontFamily: "JetBrains Mono, monospace",
  fontWeight: 700,
  color: "#ffffff",
};

function RegimePanel({ supreme }: { supreme: SupremeState }) {
  const regimeColor = supreme.regime === "RISK-ON" ? "#00ffcc" : supreme.regime === "RISK-OFF" ? "#ff7162" : "#ffcc00";
  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Market Regime</div>
      <div style={{ ...valueStyle, color: regimeColor, fontSize: "16px" }}>{supreme.regime}</div>
      <div style={{ fontSize: "10px", color: "#767576", marginTop: "6px" }}>
        Risk Appetite: <span style={{ color: "#adaaab" }}>{supreme.riskAppetite}</span>
      </div>
      <div style={{ fontSize: "10px", color: "#767576", marginTop: "3px" }}>
        Active Brains: <span style={{ color: "#adaaab" }}>{supreme.activeBrains}</span>
      </div>
      {supreme.decayDetected && (
        <div style={{ fontSize: "9px", color: "#ff7162", marginTop: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>warning</span>
          Decay Detected
        </div>
      )}    </div>
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
                <div style={{ height: "100%", borderRadius: "2px", width: `${s.opportunityScore}%`, backgroundColor: barColor, transition: "width 0.5s ease" }} />
              </div>            </div>
          );
        })}
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
              display: "flex",
              alignItems: "center",              justifyContent: "space-between",
              padding: "8px 10px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(72,72,73,0.18)",
              cursor: "pointer",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(0,255,204,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)")}
          >
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffffff", fontFamily: "Space Grotesk" }}>
                {s.displaySymbol}
              </div>
              <div style={{ fontSize: "9px", color: getStateColor(s.state) }}>
                {getStateLabel(s.state)} · {s.setupFamily}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ffffff" }}>
                {s.confidence}%
              </div>
              <div style={{ fontSize: "8px", color: s.changePct >= 0 ? "#00ffcc" : "#ff7162", fontFamily: "JetBrains Mono" }}>
                {s.changePct >= 0 ? "▲" : "▼"} {Math.abs(s.changePct).toFixed(2)}%              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskGatePanel({ stocks }: { stocks: StockNodeData[] }) {
  const blocked = stocks.filter((s) => s.riskGate === "BLOCK").length;
  const watching = stocks.filter((s) => s.riskGate === "WATCH").length;
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
          <div style={{ fontSize: "8px", color: "#767576", letterSpacing: "0.1em" }}>WATCH</div>        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: "18px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ff4444" }}>{blocked}</div>
          <div style={{ fontSize: "8px", color: "#767576", letterSpacing: "0.1em" }}>BLOCK</div>
        </div>
      </div>
    </div>
  );
}

/** Stock detail drawer (slides in from right) */
function StockDrawer({
  stock,
  onClose,
}: {
  stock: StockNodeData | null;
  onClose: () => void;
}) {
  if (!stock) return null;

  const color = getNodeColor(stock);

  return (
    <div
      style={{        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "380px",
        maxWidth: "90vw",
        backgroundColor: "rgba(14,14,15,0.95)",
        borderLeft: "1px solid rgba(72,72,73,0.25)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 100,
        padding: "24px",
        overflowY: "auto",
        animation: "slideInRight 0.25s ease-out",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          background: "none",
          border: "none",          color: "#767576",
          cursor: "pointer",
          fontSize: "20px",
        }}
      >
        <span className="material-symbols-outlined">close</span>
      </button>

      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: color,
              boxShadow: `0 0 12px ${color}`,
            }}
          />
          <span style={{ fontSize: "22px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#ffffff" }}>
            {stock.displaySymbol}
          </span>
          <span
            style={{              fontSize: "9px",
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: `${getStateColor(stock.state)}15`,
              color: getStateColor(stock.state),
              fontFamily: "Space Grotesk",
              fontWeight: 600,
              letterSpacing: "0.1em",
            }}
          >
            {getStateLabel(stock.state)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <span style={{ fontSize: "28px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ffffff" }}>
            ${stock.price > 1000 ? stock.price.toLocaleString() : stock.price.toFixed(2)}
          </span>
          <span style={{ fontSize: "12px", fontFamily: "JetBrains Mono", fontWeight: 700, color: stock.changePct >= 0 ? "#00ffcc" : "#ff7162" }}>
            {stock.changePct >= 0 ? "+" : ""}{stock.changePct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Metrics grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>        {[
          { label: "Confidence", value: `${stock.confidence}%`, color: stock.confidence > 70 ? "#00ffcc" : stock.confidence > 50 ? "#ffcc00" : "#ff7162" },
          { label: "Opportunity", value: `${stock.opportunityScore}%`, color: "#00ffcc" },
          { label: "Sentiment", value: stock.sentiment.toUpperCase(), color: stock.sentiment === "bullish" ? "#00ffcc" : stock.sentiment === "bearish" ? "#ff7162" : "#8888aa" },
          { label: "Regime", value: stock.regime.toUpperCase(), color: "#adaaab" },
          { label: "Setup Family", value: stock.setupFamily.toUpperCase(), color: "#adaaab" },
          { label: "Risk Gate", value: stock.riskGate, color: stock.riskGate === "ALLOW" ? "#00ffcc" : stock.riskGate === "BLOCK" ? "#ff4444" : "#ffcc00" },
          { label: "Attention", value: stock.attentionLevel, color: stock.attentionLevel === "CRITICAL" ? "#00ffcc" : "#adaaab" },
        ].map((m) => (
          <div key={m.label} style={{ padding: "10px", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.15)" }}>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "Space Grotesk", fontWeight: 700, marginBottom: "4px" }}>
              {m.label}
            </div>
            <div style={{ fontSize: "13px", fontFamily: "JetBrains Mono", fontWeight: 700, color: m.color }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Claude reasoning placeholder */}
      <div style={{ ...panelStyle, marginBottom: "16px" }}>
        <div style={labelStyle}>Claude Reasoning</div>
        <div style={{ fontSize: "11px", color: "#adaaab", lineHeight: 1.6 }}>
          {stock.state.includes("STRONG")            ? `${stock.displaySymbol} shows strong ${stock.setupFamily} setup with ${stock.confidence}% confidence. Structure aligns with ${stock.regime} regime. Order flow confirms directional bias. Risk gate is clear — position sizing at standard.`
            : stock.riskGate === "BLOCK"
            ? `${stock.displaySymbol} is currently BLOCKED. Spread instability and adverse regime conditions make execution unreliable. Waiting for improved microstructure.`
            : `${stock.displaySymbol} is on watch. Setup is forming but not yet confirmed. Monitoring for trigger conditions before entry consideration.`
          }
        </div>
      </div>

      {/* Market DNA placeholder */}
      <div style={panelStyle}>
        <div style={labelStyle}>Market DNA</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {[
            { trait: "Trendiness", value: 72 },
            { trait: "Breakout Cleanliness", value: 68 },
            { trait: "Fakeout Risk", value: 35 },
            { trait: "Spread Stability", value: 81 },
            { trait: "News Sensitivity", value: 55 },
          ].map((d) => (
            <div key={d.trait}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span style={{ fontSize: "9px", color: "#adaaab" }}>{d.trait}</span>
                <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: "#767576" }}>{d.value}%</span>
              </div>
              <div style={{ height: "2px", borderRadius: "1px", backgroundColor: "rgba(255,255,255,0.05)" }}>                <div style={{ height: "100%", borderRadius: "1px", width: `${d.value}%`, backgroundColor: d.value > 60 ? "#00ffcc" : "#ffcc00" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Brain Page ─────────────────────────────────────────────────────────────

export default function BrainPage() {
  const [selectedStock, setSelectedStock] = useState<StockNodeData | null>(null);
  const [stocks] = useState(MOCK_STOCKS);
  const [supreme] = useState(MOCK_SUPREME);

  const handleSelectStock = useCallback((stock: StockNodeData) => {
    setSelectedStock((prev) => (prev?.symbol === stock.symbol ? null : stock));
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 40px)", overflow: "hidden" }}>
      {/* CSS animation for drawer */}
      <style>{`        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      {/* 3D Canvas — full background */}
      <div style={{ position: "absolute", inset: 0 }}>
        <Canvas
          camera={{ position: [0, 2, 8], fov: 55 }}
          style={{ background: "radial-gradient(ellipse at center, #0a1a15 0%, #0e0e0f 70%)" }}
          gl={{ antialias: true, alpha: true }}
        >
          <Suspense fallback={null}>
            <BrainScene
              stocks={stocks}
              selectedSymbol={selectedStock?.symbol ?? null}
              onSelectStock={handleSelectStock}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* Page title overlay */}
      <div style={{ position: "absolute", top: "16px", left: "20px", zIndex: 10 }}>        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "#00ffcc" }}>neurology</span>
          <span style={{ fontSize: "14px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.2em", color: "#ffffff" }}>
            BRAIN
          </span>
        </div>
        <div style={{ fontSize: "9px", color: "#484849", fontFamily: "JetBrains Mono", letterSpacing: "0.1em" }}>
          {stocks.length} NODES · CYCLE {supreme.lastCycleMs}ms · {supreme.regime}
        </div>
      </div>

      {/* Left panels */}
      <div style={{ position: "absolute", top: "16px", left: "20px", marginTop: "50px", zIndex: 10, display: "flex", flexDirection: "column", gap: "10px", width: "220px" }}>
        <RegimePanel supreme={supreme} />
        <AttentionPanel stocks={stocks} />
        <RiskGatePanel stocks={stocks} />
      </div>

      {/* Right panel — Top Opportunities */}
      <div style={{ position: "absolute", top: "16px", right: selectedStock ? "400px" : "20px", zIndex: 10, width: "220px", transition: "right 0.25s ease" }}>
        <TopOpportunities stocks={stocks} onSelect={handleSelectStock} />
      </div>

      {/* Bottom center — Live Signal Strip */}
      <div style={{        position: "absolute",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        display: "flex",
        gap: "8px",
      }}>
        {stocks
          .filter((s) => s.state !== "IDLE")
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5)
          .map((s) => (
            <div
              key={s.symbol}
              onClick={() => handleSelectStock(s)}
              style={{
                ...panelStyle,
                padding: "8px 14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                minWidth: "120px",
                transition: "border-color 0.15s",                borderColor: selectedStock?.symbol === s.symbol ? getNodeColor(s) : "rgba(72,72,73,0.25)",
              }}
            >
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: getNodeColor(s),
                  boxShadow: `0 0 6px ${getNodeColor(s)}`,
                }}
              />
              <div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#ffffff", fontFamily: "Space Grotesk" }}>
                  {s.displaySymbol}
                </div>
                <div style={{ fontSize: "8px", color: getStateColor(s.state), fontFamily: "JetBrains Mono" }}>
                  {getStateLabel(s.state)} · {s.confidence}%
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* Stock detail drawer */}      <StockDrawer stock={selectedStock} onClose={() => setSelectedStock(null)} />

      {/* Backdrop for drawer */}
      {selectedStock && (
        <div
          onClick={() => setSelectedStock(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.3)",
            zIndex: 99,
          }}
        />
      )}
    </div>
  );
}