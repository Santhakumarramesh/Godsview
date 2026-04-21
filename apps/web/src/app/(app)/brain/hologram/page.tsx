"use client";

/**
 * Brain Hologram View — GodsView 3D Neural Command Center
 *
 * Premium Three.js visualization:
 * - Central glowing brain sphere with breathing animation
 * - Orbiting ticker nodes sized by confidence/opportunity score
 * - Strategy/agent sub-nodes with signal flow edges
 * - Pulsating active symbols, confidence glow intensity
 * - Red/orange alert flashes on risk events
 * - Click node → deep page navigation
 * - Live WebSocket updates from Brain API
 *
 * Uses @react-three/fiber + drei for React-native 3D rendering.
 * Falls back to Canvas 2D if WebGL is unavailable.
 */

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrainNode {
  id: string;
  label: string;
  type: "asset" | "strategy" | "agent" | "alert" | "core";
  confidence: number;
  active: boolean;
  sentiment?: "bullish" | "bearish" | "neutral";
  riskGate?: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  metrics?: Record<string, string | number>;
  // 3D position (computed by force sim)
  x: number;
  y: number;
  z: number;
  // Orbital parameters
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

// ─── Demo Data ──────────────────────────────────────────────────────────────

function generateDemoNodes(): BrainNode[] {
  const assets = [
    { id: "AAPL", label: "AAPL", confidence: 0.87, active: true, sentiment: "bullish" as const },
    { id: "TSLA", label: "TSLA", confidence: 0.72, active: true, sentiment: "bearish" as const },
    { id: "NVDA", label: "NVDA", confidence: 0.93, active: true, sentiment: "bullish" as const },
    { id: "MSFT", label: "MSFT", confidence: 0.81, active: true, sentiment: "bullish" as const },
    { id: "AMZN", label: "AMZN", confidence: 0.68, active: false, sentiment: "neutral" as const },
    { id: "META", label: "META", confidence: 0.79, active: true, sentiment: "bullish" as const },
    { id: "GOOG", label: "GOOG", confidence: 0.74, active: false, sentiment: "neutral" as const },
    { id: "SPY", label: "SPY", confidence: 0.85, active: true, sentiment: "bullish" as const },
    { id: "QQQ", label: "QQQ", confidence: 0.82, active: true, sentiment: "bullish" as const },
    { id: "AMD", label: "AMD", confidence: 0.64, active: false, sentiment: "bearish" as const },
  ];

  const strategies = [
    { id: "s_momentum", label: "Momentum", confidence: 0.88 },
    { id: "s_mean_rev", label: "Mean Reversion", confidence: 0.73 },
    { id: "s_ob_retest", label: "OB Retest", confidence: 0.91 },
    { id: "s_liq_sweep", label: "Liquidity Sweep", confidence: 0.67 },
  ];

  const agents = [
    { id: "a_scanner", label: "Scanner Agent", confidence: 0.95 },
    { id: "a_structure", label: "Structure Agent", confidence: 0.89 },
    { id: "a_flow", label: "Order Flow Agent", confidence: 0.84 },
    { id: "a_risk", label: "Risk Agent", confidence: 0.92 },
    { id: "a_exec", label: "Execution Agent", confidence: 0.78 },
    { id: "a_memory", label: "Memory Agent", confidence: 0.86 },
  ];

  const nodes: BrainNode[] = [];

  // Core brain node at center
  nodes.push({
    id: "god_brain",
    label: "God Brain",
    type: "core",
    confidence: 1.0,
    active: true,
    x: 0, y: 0, z: 0,
    orbitRadius: 0,
    orbitSpeed: 0,
    orbitPhase: 0,
  });

  // Asset nodes — inner orbit
  assets.forEach((a, i) => {
    const phase = (i / assets.length) * Math.PI * 2;
    nodes.push({
      ...a,
      type: "asset",
      riskGate: a.confidence > 0.8 ? "ALLOW" : a.confidence > 0.6 ? "WATCH" : "REDUCE",
      x: Math.cos(phase) * 4,
      y: (Math.random() - 0.5) * 2,
      z: Math.sin(phase) * 4,
      orbitRadius: 3.5 + Math.random() * 1.5,
      orbitSpeed: 0.15 + Math.random() * 0.15,
      orbitPhase: phase,
    });
  });

  // Strategy nodes — middle orbit
  strategies.forEach((s, i) => {
    const phase = (i / strategies.length) * Math.PI * 2 + 0.3;
    nodes.push({
      ...s,
      type: "strategy",
      active: true,
      x: Math.cos(phase) * 6.5,
      y: (Math.random() - 0.5) * 1.5,
      z: Math.sin(phase) * 6.5,
      orbitRadius: 6 + Math.random(),
      orbitSpeed: 0.08 + Math.random() * 0.06,
      orbitPhase: phase,
    });
  });

  // Agent nodes — outer orbit
  agents.forEach((ag, i) => {
    const phase = (i / agents.length) * Math.PI * 2 + 0.7;
    nodes.push({
      ...ag,
      type: "agent",
      active: true,
      x: Math.cos(phase) * 9,
      y: (Math.random() - 0.5) * 1,
      z: Math.sin(phase) * 9,
      orbitRadius: 8.5 + Math.random(),
      orbitSpeed: 0.05 + Math.random() * 0.04,
      orbitPhase: phase,
    });
  });

  return nodes;
}

function generateDemoEdges(nodes: BrainNode[]): BrainEdge[] {
  const edges: BrainEdge[] = [];
  // Connect all to god_brain
  nodes.forEach((n) => {
    if (n.id !== "god_brain") {
      edges.push({
        source: "god_brain",
        target: n.id,
        weight: n.confidence,
        signalStrength: n.active ? 0.8 : 0.2,
      });
    }
  });
  // Connect agents to strategies
  const strategies = nodes.filter((n) => n.type === "strategy");
  const agents = nodes.filter((n) => n.type === "agent");
  agents.forEach((ag) => {
    strategies.forEach((s) => {
      if (Math.random() > 0.5) {
        edges.push({
          source: ag.id,
          target: s.id,
          weight: 0.5 + Math.random() * 0.5,
          signalStrength: 0.3 + Math.random() * 0.7,
        });
      }
    });
  });
  // Connect strategies to assets
  const assets = nodes.filter((n) => n.type === "asset");
  strategies.forEach((s) => {
    const targetAssets = assets.filter(() => Math.random() > 0.4);
    targetAssets.forEach((a) => {
      edges.push({
        source: s.id,
        target: a.id,
        weight: a.confidence,
        signalStrength: a.active ? 0.9 : 0.1,
      });
    });
  });
  return edges;
}

// ─── Color helpers ──────────────────────────────────────────────────────────

function getNodeColor(node: BrainNode): string {
  switch (node.type) {
    case "core": return "#a78bfa";
    case "asset":
      if (!node.active) return "#4b5563";
      return node.sentiment === "bullish" ? "#34d399" :
             node.sentiment === "bearish" ? "#f87171" : "#fbbf24";
    case "strategy": return "#60a5fa";
    case "agent": return "#c084fc";
    case "alert": return "#fb923c";
    default: return "#9ca3af";
  }
}

function getNodeSize(node: BrainNode): number {
  if (node.type === "core") return 1.2;
  const base = node.type === "asset" ? 0.35 : node.type === "strategy" ? 0.28 : 0.22;
  return base + node.confidence * 0.25;
}

function getDeepLink(node: BrainNode): string {
  switch (node.type) {
    case "asset": return `/market/scanner`;
    case "strategy": return `/strategies/active`;
    case "agent":
      if (node.id.includes("scanner")) return `/intel/agents`;
      if (node.id.includes("risk")) return `/risk/pre-trade`;
      if (node.id.includes("exec")) return `/execution/orders`;
      if (node.id.includes("memory")) return `/memory/recall`;
      if (node.id.includes("flow")) return `/intel/flow`;
      return `/intel/agents`;
    case "alert": return `/ops/incidents`;
    case "core": return `/brain/mission-control`;
    default: return `/brain/mission-control`;
  }
}

// ─── Lazy-loaded 3D Scene ───────────────────────────────────────────────────

const BrainScene3D = dynamic(() => import("./brain-scene-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-gray-950">
      <div className="text-center">
        <div className="animate-pulse text-6xl mb-4">🧠</div>
        <p className="text-gray-400 text-sm">Initializing Neural Network...</p>
      </div>
    </div>
  ),
});

// ─── Canvas 2D Fallback ─────────────────────────────────────────────────────

function Canvas2DFallback({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const animate = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) / 24;

      ctx.clearRect(0, 0, w, h);

      // Background gradient
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
      bgGrad.addColorStop(0, "#0f0a1a");
      bgGrad.addColorStop(1, "#000000");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Update node positions (orbit)
      nodes.forEach((node) => {
        if (node.type === "core") return;
        const angle = node.orbitPhase + t * node.orbitSpeed;
        node.x = Math.cos(angle) * node.orbitRadius;
        node.z = Math.sin(angle) * node.orbitRadius;
      });

      // Draw edges
      edges.forEach((edge) => {
        const src = nodes.find((n) => n.id === edge.source);
        const tgt = nodes.find((n) => n.id === edge.target);
        if (!src || !tgt) return;
        const sx = cx + src.x * scale;
        const sy = cy + src.z * scale;
        const tx = cx + tgt.x * scale;
        const ty = cy + tgt.z * scale;
        ctx.strokeStyle = `rgba(139, 92, 246, ${edge.signalStrength * 0.15})`;
        ctx.lineWidth = edge.weight * 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      });

      // Draw nodes
      nodes.forEach((node) => {
        const nx = cx + node.x * scale;
        const ny = cy + node.z * scale;
        const size = getNodeSize(node) * scale * 0.4;
        const color = getNodeColor(node);

        // Glow
        if (node.active || node.type === "core") {
          const glow = ctx.createRadialGradient(nx, ny, 0, nx, ny, size * 3);
          glow.addColorStop(0, color + "40");
          glow.addColorStop(1, color + "00");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(nx, ny, size * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Core pulsing
        const pulse = node.type === "core" ? 1 + Math.sin(t * 2) * 0.15 : 1;

        // Node circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(nx, ny, size * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (selectedId === node.id) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(nx, ny, size * pulse + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = "#e5e7eb";
        ctx.font = `${Math.max(10, size * 0.7)}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(node.label, nx, ny + size + 14);
      });

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [nodes, edges, selectedId]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) / 24;

    let closest: BrainNode | null = null;
    let closestDist = Infinity;
    nodes.forEach((node) => {
      const nx = cx + node.x * scale;
      const ny = cy + node.z * scale;
      const dist = Math.hypot(mx - nx, my - ny);
      const hitRadius = getNodeSize(node) * scale * 0.5 + 10;
      if (dist < hitRadius && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    });
    onSelect(closest?.id ?? null);
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-crosshair"
      onClick={handleClick}
    />
  );
}

// ─── Main Page Component ────────────────────────────────────────────────────

export default function BrainHologramPage() {
  const [nodes, setNodes] = useState<BrainNode[]>(() => generateDemoNodes());
  const [edges, setEdges] = useState<BrainEdge[]>(() => generateDemoEdges(nodes));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [use3D, setUse3D] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  // Try to load live data from brain API
  useEffect(() => {
    let mounted = true;
    async function fetchBrainGraph() {
      try {
        const graph = await api.brain.getBrainGraph();
        if (!mounted) return;
        if (graph?.nodes?.length) {
          const mappedNodes: BrainNode[] = graph.nodes.map((n, i) => ({
            id: n.id,
            label: n.label,
            type: (n.type as BrainNode["type"]) || "asset",
            confidence: n.value ?? 0.5,
            active: (n.value ?? 0) > 0.5,
            x: n.x ?? 0,
            y: n.y ?? 0,
            z: n.z ?? 0,
            orbitRadius: 3 + Math.random() * 6,
            orbitSpeed: 0.05 + Math.random() * 0.15,
            orbitPhase: (i / graph.nodes.length) * Math.PI * 2,
          }));
          const mappedEdges: BrainEdge[] = graph.edges.map((e) => ({
            source: e.source,
            target: e.target,
            weight: e.weight,
            signalStrength: e.weight,
          }));
          setNodes(mappedNodes);
          setEdges(mappedEdges);
          setApiConnected(true);
        }
      } catch {
        // Use demo data (already set)
        setApiConnected(false);
      }
    }
    fetchBrainGraph();

    // SSE live updates for real-time brain state changes
    let eventSource: EventSource | null = null;
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
      eventSource = new EventSource(`${apiBase}/api/v1/brain/stream`);
      eventSource.onmessage = (event) => {
        if (!mounted) return;
        try {
          const update = JSON.parse(event.data);
          if (update.type === "node_update" && update.nodeId) {
            setNodes((prev) =>
              prev.map((n) =>
                n.id === update.nodeId
                  ? { ...n, confidence: update.confidence ?? n.confidence, active: update.active ?? n.active, sentiment: update.sentiment ?? n.sentiment, riskGate: update.riskGate ?? n.riskGate }
                  : n
              )
            );
          } else if (update.type === "alert" && update.nodeId) {
            setNodes((prev) =>
              prev.map((n) =>
                n.id === update.nodeId ? { ...n, type: "alert" as const, active: true } : n
              )
            );
            // Revert alert after 5 seconds
            setTimeout(() => {
              if (!mounted) return;
              setNodes((prev) =>
                prev.map((n) =>
                  n.id === update.nodeId ? { ...n, type: (update.originalType ?? "asset") as BrainNode["type"] } : n
                )
              );
            }, 5000);
          }
        } catch { /* ignore malformed SSE */ }
      };
      eventSource.onerror = () => { eventSource?.close(); };
    } catch { /* SSE not available */ }

    return () => {
      mounted = false;
      eventSource?.close();
    };
  }, []);

  // Check WebGL availability
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) setUse3D(false);
    } catch {
      setUse3D(false);
    }
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNodeId) return [];
    const connectedIds = new Set<string>();
    edges.forEach((e) => {
      if (e.source === selectedNodeId) connectedIds.add(e.target);
      if (e.target === selectedNodeId) connectedIds.add(e.source);
    });
    return nodes.filter((n) => connectedIds.has(n.id));
  }, [selectedNodeId, nodes, edges]);

  return (
    <section className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden bg-black">
      {/* 3D / 2D Viewport */}
      <div className="flex-1 relative">
        {/* Status bar */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
            apiConnected ? "bg-green-900/60 text-green-300" : "bg-yellow-900/60 text-yellow-300"
          }`}>
            <span className={`inline-block w-2 h-2 rounded-full ${apiConnected ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            {apiConnected ? "Live" : "Demo Mode"}
          </div>
          <button
            onClick={() => setUse3D(!use3D)}
            className="rounded-full bg-gray-800/80 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700/80 transition-colors"
          >
            {use3D ? "Switch to 2D" : "Switch to 3D"}
          </button>
        </div>

        {/* Stats overlay */}
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          {[
            { label: "Nodes", value: nodes.length, color: "text-purple-300" },
            { label: "Active", value: nodes.filter((n) => n.active).length, color: "text-green-300" },
            { label: "Edges", value: edges.length, color: "text-blue-300" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-gray-900/80 px-3 py-2 text-center backdrop-blur-sm">
              <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Render 3D or 2D */}
        {use3D ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center bg-gray-950">
              <div className="animate-pulse text-4xl">🧠</div>
            </div>
          }>
            <BrainScene3D
              nodes={nodes}
              edges={edges}
              selectedId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
          </Suspense>
        ) : (
          <Canvas2DFallback
            nodes={nodes}
            edges={edges}
            selectedId={selectedNodeId}
            onSelect={setSelectedNodeId}
          />
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 z-10 flex gap-4 rounded-lg bg-gray-900/80 px-4 py-2 backdrop-blur-sm">
          {[
            { type: "core", label: "Brain Core", color: "#a78bfa" },
            { type: "asset", label: "Assets", color: "#34d399" },
            { type: "strategy", label: "Strategies", color: "#60a5fa" },
            { type: "agent", label: "Agents", color: "#c084fc" },
          ].map((item) => (
            <div key={item.type} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] text-gray-400">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Inspector Panel */}
      <div className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-950 p-4">
        {selectedNode ? (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: getNodeColor(selectedNode) }}
                />
                <h2 className="text-lg font-bold text-white">{selectedNode.label}</h2>
              </div>
              <span className="inline-block rounded-full bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
                {selectedNode.type}
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Confidence</span>
                <span className="text-white font-medium">
                  {(selectedNode.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${selectedNode.confidence * 100}%`,
                    backgroundColor: getNodeColor(selectedNode),
                  }}
                />
              </div>

              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <span className={selectedNode.active ? "text-green-400" : "text-gray-500"}>
                  {selectedNode.active ? "Active" : "Inactive"}
                </span>
              </div>

              {selectedNode.sentiment && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Sentiment</span>
                  <span className={
                    selectedNode.sentiment === "bullish" ? "text-green-400" :
                    selectedNode.sentiment === "bearish" ? "text-red-400" : "text-yellow-400"
                  }>
                    {selectedNode.sentiment}
                  </span>
                </div>
              )}

              {selectedNode.riskGate && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Risk Gate</span>
                  <span className={
                    selectedNode.riskGate === "ALLOW" ? "text-green-400" :
                    selectedNode.riskGate === "WATCH" ? "text-yellow-400" :
                    selectedNode.riskGate === "REDUCE" ? "text-orange-400" : "text-red-400"
                  }>
                    {selectedNode.riskGate}
                  </span>
                </div>
              )}
            </div>

            {selectedNodeConnections.length > 0 && (
              <div className="mt-6 space-y-2 border-t border-gray-800 pt-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Connected ({selectedNodeConnections.length})
                </h3>
                <div className="space-y-1">
                  {selectedNodeConnections.slice(0, 8).map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-xs bg-gray-900 hover:bg-gray-800 cursor-pointer transition-colors"
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: getNodeColor(node) }}
                      />
                      <span className="text-gray-300">{node.label}</span>
                      <span className="ml-auto text-gray-600">{(node.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link
              href={getDeepLink(selectedNode)}
              className="block w-full mt-6 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 py-2.5 text-center text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-purple-500/30"
            >
              Deep Dive →
            </Link>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
                <span className="text-3xl">🧠</span>
              </div>
              <div className="absolute inset-0 rounded-full bg-violet-500/10 animate-ping" />
            </div>
            <p className="text-sm text-gray-400 mb-1">Neural Command Center</p>
            <p className="text-xs text-gray-600">Click a node to inspect</p>
          </div>
        )}
      </div>
    </section>
  );
}
