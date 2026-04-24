"use client";

/**
 * BrainScene3D — Three.js / react-three-fiber 3D brain hologram
 *
 * Renders:
 * - Central glowing brain sphere with breathing animation
 * - Orbiting ticker/strategy/agent nodes
 * - Neural connection lines with signal flow particles
 * - Interactive click-to-select with highlight ring
 * - Ambient particle cloud for depth
 */

import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { Float, Billboard, Text, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ─── Types (must match parent page) ─────────────────────────────────────────

interface BrainNode {
  id: string;
  label: string;
  type: "asset" | "strategy" | "agent" | "alert" | "core";
  confidence: number;
  active: boolean;
  sentiment?: "bullish" | "bearish" | "neutral";
  riskGate?: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  x: number;
  y: number;
  z: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
}

interface BrainEdge {
  source: string;
  target: string;
  weight: number;
  signalStrength: number;
}

// ─── Color mapping ──────────────────────────────────────────────────────────

function getColor(node: BrainNode): THREE.Color {
  switch (node.type) {
    case "core": return new THREE.Color(0xa78bfa);
    case "asset":
      if (!node.active) return new THREE.Color(0x4b5563);
      return node.sentiment === "bullish" ? new THREE.Color(0x34d399) :
             node.sentiment === "bearish" ? new THREE.Color(0xf87171) :
             new THREE.Color(0xfbbf24);
    case "strategy": return new THREE.Color(0x60a5fa);
    case "agent": return new THREE.Color(0xc084fc);
    case "alert": return new THREE.Color(0xfb923c);
    default: return new THREE.Color(0x9ca3af);
  }
}

function getSize(node: BrainNode): number {
  if (node.type === "core") return 0.6;
  const base = node.type === "asset" ? 0.22 : node.type === "strategy" ? 0.18 : 0.15;
  return base + node.confidence * 0.12;
}

// ─── Core Brain Sphere ──────────────────────────────────────────────────────

function CoreSphere({ selected }: { selected: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (meshRef.current) {
      const scale = 0.6 + Math.sin(t * 1.5) * 0.08;
      meshRef.current.scale.setScalar(scale);
      meshRef.current.rotation.y = t * 0.3;
    }
    if (glowRef.current) {
      const glowScale = 1.2 + Math.sin(t * 1.2) * 0.2;
      glowRef.current.scale.setScalar(glowScale);
    }
  });

  return (
    <group>
      {/* Inner core */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[0.6, 3]} />
        <meshStandardMaterial
          color={0xa78bfa}
          emissive={0x7c3aed}
          emissiveIntensity={1.5}
          wireframe
          transparent
          opacity={0.8}
        />
      </mesh>
      {/* Glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.8, 32, 32]} />
        <meshStandardMaterial
          color={0x7c3aed}
          emissive={0x7c3aed}
          emissiveIntensity={0.5}
          transparent
          opacity={0.12}
        />
      </mesh>
      {/* Selection ring */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.0, 0.02, 16, 64]} />
          <meshStandardMaterial color={0xffffff} emissive={0xffffff} emissiveIntensity={2} />
        </mesh>
      )}
    </group>
  );
}

// ─── Orbiting Node ──────────────────────────────────────────────────────────

function OrbitalNode({
  node,
  selected,
  onClick,
}: {
  node: BrainNode;
  selected: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const color = getColor(node);
  const size = getSize(node);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const angle = node.orbitPhase + t * node.orbitSpeed;
    meshRef.current.position.x = Math.cos(angle) * node.orbitRadius;
    meshRef.current.position.z = Math.sin(angle) * node.orbitRadius;
    meshRef.current.position.y = node.y + Math.sin(t * 0.5 + node.orbitPhase) * 0.3;
  });

  return (
    <group ref={meshRef as any} position={[node.x, node.y, node.z]}>
      {/* Node sphere */}
      <mesh onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={node.active ? 1.2 : 0.3}
          transparent
          opacity={node.active ? 0.9 : 0.4}
        />
      </mesh>

      {/* Glow halo for active nodes */}
      {node.active && (
        <mesh>
          <sphereGeometry args={[size * 2, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.3}
            transparent
            opacity={0.08}
          />
        </mesh>
      )}

      {/* Selection ring */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[size + 0.12, 0.015, 8, 32]} />
          <meshStandardMaterial color={0xffffff} emissive={0xffffff} emissiveIntensity={3} />
        </mesh>
      )}

      {/* Label */}
      <Billboard position={[0, size + 0.25, 0]}>
        <Text
          fontSize={0.14}
          color="#e5e7eb"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.01}
          outlineColor="#000000"
        >
          {node.label}
        </Text>
      </Billboard>
    </group>
  );
}

// ─── Neural Connections ─────────────────────────────────────────────────────

function NeuralConnections({
  nodes,
  edges,
}: {
  nodes: BrainNode[];
  edges: BrainEdge[];
}) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const nodeMap = useMemo(() => {
    const map = new Map<string, BrainNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  useFrame(({ clock }) => {
    if (!lineRef.current) return;
    const t = clock.getElapsedTime();
    const positions = lineRef.current.geometry.attributes.position;
    if (!positions) return;

    let idx = 0;
    edges.forEach((edge) => {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) return;

      const srcAngle = src.orbitPhase + t * src.orbitSpeed;
      const tgtAngle = tgt.orbitPhase + t * tgt.orbitSpeed;

      const sx = src.type === "core" ? 0 : Math.cos(srcAngle) * src.orbitRadius;
      const sy = src.type === "core" ? 0 : src.y + Math.sin(t * 0.5 + src.orbitPhase) * 0.3;
      const sz = src.type === "core" ? 0 : Math.sin(srcAngle) * src.orbitRadius;

      const tx = tgt.type === "core" ? 0 : Math.cos(tgtAngle) * tgt.orbitRadius;
      const ty = tgt.type === "core" ? 0 : tgt.y + Math.sin(t * 0.5 + tgt.orbitPhase) * 0.3;
      const tz = tgt.type === "core" ? 0 : Math.sin(tgtAngle) * tgt.orbitRadius;

      positions.setXYZ(idx, sx, sy, sz);
      positions.setXYZ(idx + 1, tx, ty, tz);
      idx += 2;
    });

    positions.needsUpdate = true;
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(edges.length * 6);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [edges.length]);

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial color={0x7c3aed} transparent opacity={0.12} />
    </lineSegments>
  );
}

// ─── Ambient Particles ──────────────────────────────────────────────────────

function AmbientParticles({ count = 200 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 25;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 25;
    }
    return pos;
  }, [count]);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.02;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color={0x6d28d9} size={0.03} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

// ─── Scene Composition ──────────────────────────────────────────────────────

function Scene({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: BrainNode[];
  edges: BrainEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const coreNode = nodes.find((n) => n.type === "core");
  const orbitNodes = nodes.filter((n) => n.type !== "core");

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 5, 0]} intensity={1.5} color={0xa78bfa} />
      <pointLight position={[5, -3, 5]} intensity={0.5} color={0x60a5fa} />
      <pointLight position={[-5, -3, -5]} intensity={0.5} color={0xc084fc} />

      {/* Background */}
      <color attach="background" args={["#030014"]} />
      <fog attach="fog" args={["#030014", 12, 30]} />

      {/* Core brain */}
      {coreNode && (
        <group onClick={() => onSelect(coreNode.id)}>
          <CoreSphere selected={selectedId === coreNode.id} />
        </group>
      )}

      {/* Orbital nodes */}
      {orbitNodes.map((node) => (
        <OrbitalNode
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          onClick={() => onSelect(node.id)}
        />
      ))}

      {/* Neural connections */}
      <NeuralConnections nodes={nodes} edges={edges} />

      {/* Ambient particles */}
      <AmbientParticles count={300} />

      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={3}
        maxDistance={20}
        autoRotate
        autoRotateSpeed={0.3}
        dampingFactor={0.05}
        enableDamping
      />
    </>
  );
}

// ─── Exported Component ─────────────────────────────────────────────────────

export default function BrainScene3D({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: BrainNode[];
  edges: BrainEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 5, 12], fov: 50 }}
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%" }}
      onPointerMissed={() => onSelect(null)}
    >
      <Scene nodes={nodes} edges={edges} selectedId={selectedId} onSelect={onSelect} />
    </Canvas>
  );
}
