"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";

// Types for graph nodes and edges
interface GraphNode {
  id: string;
  label: string;
  type: "asset" | "strategy" | "agent" | "alert";
  x: number;
  y: number;
  vx: number;
  vy: number;
  confidence: number;
  active: boolean;
  metrics?: Record<string, string | number>;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  signalStrength: number;
}

interface SimulationState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
}

// Force simulation constants
const SIMULATION_PARAMS = {
  spring_strength: 0.03,
  repulsion_strength: 80,
  damping: 0.95,
  max_velocity: 3,
  min_distance: 30,
};

// Initialize demo graph data
function initializeDemoGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [
    // Assets
    {
      id: "AAPL",
      label: "AAPL",
      type: "asset",
      x: 150,
      y: 100,
      vx: 0,
      vy: 0,
      confidence: 0.92,
      active: true,
      metrics: { price: "$234.50", "52wHigh": "$245.00", volume: "52.4M" },
    },
    {
      id: "NVDA",
      label: "NVDA",
      type: "asset",
      x: 300,
      y: 80,
      vx: 0,
      vy: 0,
      confidence: 0.88,
      active: true,
      metrics: { price: "$945.20", "52wHigh": "$980.00", volume: "28.1M" },
    },
    {
      id: "TSLA",
      label: "TSLA",
      type: "asset",
      x: 450,
      y: 120,
      vx: 0,
      vy: 0,
      confidence: 0.75,
      active: false,
      metrics: { price: "$198.35", "52wHigh": "$210.00", volume: "91.2M" },
    },
    {
      id: "MSFT",
      label: "MSFT",
      type: "asset",
      x: 200,
      y: 250,
      vx: 0,
      vy: 0,
      confidence: 0.91,
      active: true,
      metrics: { price: "$427.80", "52wHigh": "$450.00", volume: "18.5M" },
    },
    {
      id: "AMZN",
      label: "AMZN",
      type: "asset",
      x: 400,
      y: 280,
      vx: 0,
      vy: 0,
      confidence: 0.82,
      active: false,
      metrics: { price: "$198.40", "52wHigh": "$205.00", volume: "42.3M" },
    },
    {
      id: "BTC",
      label: "BTC",
      type: "asset",
      x: 550,
      y: 200,
      vx: 0,
      vy: 0,
      confidence: 0.86,
      active: true,
      metrics: { price: "$68,420", "52wHigh": "$70,000", volume: "28.4B" },
    },
    {
      id: "ES",
      label: "ES",
      type: "asset",
      x: 100,
      y: 400,
      vx: 0,
      vy: 0,
      confidence: 0.89,
      active: true,
      metrics: { price: "5,248.50", change: "+0.45%", volume: "1.2M" },
    },
    {
      id: "NQ",
      label: "NQ",
      type: "asset",
      x: 350,
      y: 420,
      vx: 0,
      vy: 0,
      confidence: 0.85,
      active: true,
      metrics: { price: "17,840.25", change: "+0.62%", volume: "820K" },
    },
    // Strategies
    {
      id: "OB_RETEST",
      label: "OB Retest",
      type: "strategy",
      x: 250,
      y: 150,
      vx: 0,
      vy: 0,
      confidence: 0.84,
      active: true,
      metrics: {
        winRate: "68%",
        avgRR: "1.8",
        trades: "124",
      },
    },
    {
      id: "SWEEP_REV",
      label: "Sweep Reversal",
      type: "strategy",
      x: 400,
      y: 200,
      vx: 0,
      vy: 0,
      confidence: 0.76,
      active: false,
      metrics: { winRate: "62%", avgRR: "1.5", trades: "89" },
    },
    {
      id: "RANGE_BREAK",
      label: "Range Break",
      type: "strategy",
      x: 300,
      y: 320,
      vx: 0,
      vy: 0,
      confidence: 0.79,
      active: true,
      metrics: { winRate: "71%", avgRR: "2.1", trades: "156" },
    },
    {
      id: "TREND_FOLLOW",
      label: "Trend Follow",
      type: "strategy",
      x: 150,
      y: 300,
      vx: 0,
      vy: 0,
      confidence: 0.81,
      active: true,
      metrics: { winRate: "65%", avgRR: "1.9", trades: "201" },
    },
    {
      id: "DIV_CONFIRM",
      label: "Div Confirm",
      type: "strategy",
      x: 500,
      y: 350,
      vx: 0,
      vy: 0,
      confidence: 0.73,
      active: false,
      metrics: { winRate: "58%", avgRR: "1.4", trades: "67" },
    },
    // Agents
    {
      id: "SCANNER",
      label: "Scanner",
      type: "agent",
      x: 200,
      y: 50,
      vx: 0,
      vy: 0,
      confidence: 0.95,
      active: true,
      metrics: {
        status: "Running",
        scansCompleted: "2,847",
        avgScanTime: "240ms",
      },
    },
    {
      id: "STRUCTURE",
      label: "Structure",
      type: "agent",
      x: 350,
      y: 30,
      vx: 0,
      vy: 0,
      confidence: 0.92,
      active: true,
      metrics: {
        status: "Running",
        patternsFound: "156",
        avgConfidence: "0.84",
      },
    },
    {
      id: "FLOW",
      label: "Flow",
      type: "agent",
      x: 500,
      y: 60,
      vx: 0,
      vy: 0,
      confidence: 0.88,
      active: true,
      metrics: { status: "Running", volumeMonitored: "1.2T", alerts: "34" },
    },
    {
      id: "EXECUTION",
      label: "Execution",
      type: "agent",
      x: 450,
      y: 450,
      vx: 0,
      vy: 0,
      confidence: 0.94,
      active: true,
      metrics: {
        status: "Ready",
        ordersToday: "12",
        avgFillTime: "125ms",
      },
    },
    {
      id: "RISK",
      label: "Risk",
      type: "agent",
      x: 250,
      y: 480,
      vx: 0,
      vy: 0,
      confidence: 0.96,
      active: true,
      metrics: {
        status: "Monitoring",
        drawdown: "1.2%",
        riskLimit: "2.0%",
      },
    },
    // Alerts
    {
      id: "ALERT_1",
      label: "Flash Crash",
      type: "alert",
      x: 550,
      y: 400,
      vx: 0,
      vy: 0,
      confidence: 1.0,
      active: true,
      metrics: { severity: "HIGH", timestamp: "14:32:15", duration: "2.3s" },
    },
    {
      id: "ALERT_2",
      label: "Vol Spike",
      type: "alert",
      x: 100,
      y: 200,
      vx: 0,
      vy: 0,
      confidence: 0.94,
      active: true,
      metrics: { severity: "MEDIUM", timestamp: "14:31:42", duration: "1.1s" },
    },
    {
      id: "ALERT_3",
      label: "Divergence",
      type: "alert",
      x: 600,
      y: 250,
      vx: 0,
      vy: 0,
      confidence: 0.88,
      active: false,
      metrics: { severity: "LOW", timestamp: "14:29:18", duration: "0.8s" },
    },
  ];

  const edges: GraphEdge[] = [
    // Asset to Strategy connections
    { source: "AAPL", target: "OB_RETEST", weight: 0.8, signalStrength: 0.9 },
    { source: "NVDA", target: "OB_RETEST", weight: 0.75, signalStrength: 0.85 },
    { source: "NVDA", target: "SWEEP_REV", weight: 0.7, signalStrength: 0.8 },
    { source: "MSFT", target: "RANGE_BREAK", weight: 0.82, signalStrength: 0.88 },
    { source: "ES", target: "TREND_FOLLOW", weight: 0.85, signalStrength: 0.9 },
    { source: "NQ", target: "TREND_FOLLOW", weight: 0.83, signalStrength: 0.87 },
    { source: "BTC", target: "SWEEP_REV", weight: 0.72, signalStrength: 0.78 },
    { source: "TSLA", target: "DIV_CONFIRM", weight: 0.68, signalStrength: 0.75 },

    // Strategy to Agent connections
    { source: "OB_RETEST", target: "SCANNER", weight: 0.9, signalStrength: 0.95 },
    { source: "SWEEP_REV", target: "SCANNER", weight: 0.85, signalStrength: 0.9 },
    { source: "OB_RETEST", target: "STRUCTURE", weight: 0.88, signalStrength: 0.92 },
    { source: "RANGE_BREAK", target: "FLOW", weight: 0.82, signalStrength: 0.88 },
    { source: "TREND_FOLLOW", target: "FLOW", weight: 0.84, signalStrength: 0.89 },
    { source: "OB_RETEST", target: "EXECUTION", weight: 0.86, signalStrength: 0.91 },
    { source: "RANGE_BREAK", target: "EXECUTION", weight: 0.83, signalStrength: 0.88 },
    { source: "TREND_FOLLOW", target: "RISK", weight: 0.87, signalStrength: 0.92 },
    { source: "SWEEP_REV", target: "RISK", weight: 0.8, signalStrength: 0.85 },

    // Alert connections
    { source: "ALERT_1", target: "FLOW", weight: 0.95, signalStrength: 0.98 },
    { source: "ALERT_1", target: "RISK", weight: 0.93, signalStrength: 0.96 },
    { source: "ALERT_2", target: "EXECUTION", weight: 0.88, signalStrength: 0.92 },
    { source: "ALERT_3", target: "STRUCTURE", weight: 0.75, signalStrength: 0.8 },

    // Additional cross-connections for richness
    { source: "BTC", target: "TREND_FOLLOW", weight: 0.76, signalStrength: 0.82 },
    { source: "AMZN", target: "RANGE_BREAK", weight: 0.72, signalStrength: 0.78 },
  ];

  return { nodes, edges };
}

// Force simulation update
function updateForces(
  nodes: GraphNode[],
  edges: GraphEdge[],
  containerWidth: number,
  containerHeight: number
): GraphNode[] {
  const updated = nodes.map((n) => ({ ...n }));

  // Apply spring forces from edges
  for (const edge of edges) {
    const source = updated.find((n) => n.id === edge.source);
    const target = updated.find((n) => n.id === edge.target);

    if (source && target) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const force =
        SIMULATION_PARAMS.spring_strength * (distance - SIMULATION_PARAMS.min_distance);

      const fx = (force * dx) / distance;
      const fy = (force * dy) / distance;

      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }
  }

  // Apply repulsion forces between all nodes
  for (let i = 0; i < updated.length; i++) {
    for (let j = i + 1; j < updated.length; j++) {
      const a = updated[i];
      const b = updated[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;

      if (distance < 300) {
        const force = SIMULATION_PARAMS.repulsion_strength / (distance * distance);

        const fx = (force * dx) / distance;
        const fy = (force * dy) / distance;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // Update positions and apply damping
  for (const node of updated) {
    // Damping
    node.vx *= SIMULATION_PARAMS.damping;
    node.vy *= SIMULATION_PARAMS.damping;

    // Limit velocity
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > SIMULATION_PARAMS.max_velocity) {
      const scale = SIMULATION_PARAMS.max_velocity / speed;
      node.vx *= scale;
      node.vy *= scale;
    }

    // Update position
    node.x += node.vx;
    node.y += node.vy;

    // Boundary constraints
    const padding = 40;
    if (node.x < padding) {
      node.x = padding;
      node.vx *= -0.5;
    }
    if (node.x > containerWidth - padding) {
      node.x = containerWidth - padding;
      node.vx *= -0.5;
    }
    if (node.y < padding) {
      node.y = padding;
      node.vy *= -0.5;
    }
    if (node.y > containerHeight - padding) {
      node.y = containerHeight - padding;
      node.vy *= -0.5;
    }
  }

  return updated;
}

// Get node styling
function getNodeColor(type: string, active: boolean): string {
  if (type === "asset") return active ? "#3b82f6" : "#1e40af";
  if (type === "strategy") return active ? "#10b981" : "#065f46";
  if (type === "agent") return active ? "#a855f7" : "#6b21a8";
  if (type === "alert") return active ? "#ef4444" : "#7f1d1d";
  return "#6b7280";
}

function getNodeShape(type: string): string {
  if (type === "asset") return "circle";
  if (type === "strategy") return "diamond";
  if (type === "agent") return "hexagon";
  if (type === "alert") return "triangle";
  return "circle";
}

function getDeepLink(node: GraphNode): string {
  if (node.type === "asset") return `/market/scanner?symbol=${node.id}`;
  if (node.type === "strategy") return `/strategies/${node.id.toLowerCase()}`;
  if (node.type === "agent") return `/agents/${node.id.toLowerCase()}`;
  if (node.type === "alert") return `/alerts/${node.id.toLowerCase()}`;
  return "/";
}

// Node rendering component
function NodeSVG({
  node,
  isSelected,
  isHovered,
  onHover,
}: {
  node: GraphNode;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const radius = 24;
  const color = getNodeColor(node.type, node.active);

  let nodeElement;

  if (node.type === "asset") {
    // Circle for asset
    nodeElement = (
      <circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={color}
        opacity={0.7 + node.confidence * 0.3}
        stroke={isSelected ? "#fbbf24" : isHovered ? "#fcd34d" : "rgba(255,255,255,0.2)"}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        className={node.active ? "animate-pulse" : ""}
      />
    );
  } else if (node.type === "strategy") {
    // Diamond for strategy
    const points = `${node.x},${node.y - radius} ${node.x + radius},${node.y} ${node.x},${node.y + radius} ${node.x - radius},${node.y}`;
    nodeElement = (
      <polygon
        points={points}
        fill={color}
        opacity={0.7 + node.confidence * 0.3}
        stroke={isSelected ? "#fbbf24" : isHovered ? "#fcd34d" : "rgba(255,255,255,0.2)"}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        className={node.active ? "animate-pulse" : ""}
      />
    );
  } else if (node.type === "agent") {
    // Hexagon for agent
    const hexagon = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const x = node.x + radius * Math.cos(angle);
      const y = node.y + radius * Math.sin(angle);
      hexagon.push(`${x},${y}`);
    }
    nodeElement = (
      <polygon
        points={hexagon.join(" ")}
        fill={color}
        opacity={0.7 + node.confidence * 0.3}
        stroke={isSelected ? "#fbbf24" : isHovered ? "#fcd34d" : "rgba(255,255,255,0.2)"}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        className={node.active ? "animate-pulse" : ""}
      />
    );
  } else if (node.type === "alert") {
    // Triangle for alert
    const points = `${node.x},${node.y - radius} ${node.x + radius},${node.y + radius} ${node.x - radius},${node.y + radius}`;
    nodeElement = (
      <polygon
        points={points}
        fill={color}
        opacity={0.7 + node.confidence * 0.3}
        stroke={isSelected ? "#fbbf24" : isHovered ? "#fcd34d" : "rgba(255,255,255,0.2)"}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        className={node.active ? "animate-pulse" : ""}
      />
    );
  }

  return (
    <g
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      {nodeElement}
      <text
        x={node.x}
        y={node.y}
        textAnchor="middle"
        dy="0.3em"
        fill="white"
        fontSize="11"
        fontWeight="600"
        pointerEvents="none"
        className="text-shadow"
      >
        {node.label}
      </text>
    </g>
  );
}

export default function BrainHologramViewPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [simulation, setSimulation] = useState<SimulationState>(() => {
    const { nodes, edges } = initializeDemoGraph();
    return { nodes, edges, selectedNodeId: null };
  });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">(
    "connected"
  );
  const animationFrameRef = useRef<number>();

  // Container dimensions
  const containerWidth = 1400;
  const containerHeight = 600;

  // Force simulation loop
  useEffect(() => {
    let frameCount = 0;
    const animate = () => {
      frameCount++;

      // Update forces every frame
      setSimulation((prev) => ({
        ...prev,
        nodes: updateForces(prev.nodes, prev.edges, containerWidth, containerHeight),
      }));

      // Simulate connection status changes
      if (frameCount % 300 === 0) {
        const statuses: Array<"connected" | "connecting" | "disconnected"> = [
          "connected",
          "connecting",
        ];
        setConnectionStatus(statuses[Math.floor(Math.random() * statuses.length)]);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const selectedNode = useMemo(
    () => simulation.nodes.find((n) => n.id === simulation.selectedNodeId),
    [simulation.nodes, simulation.selectedNodeId]
  );

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode) return [];
    const connectionIds = new Set<string>();

    simulation.edges.forEach((edge) => {
      if (edge.source === selectedNode.id) {
        connectionIds.add(edge.target);
      } else if (edge.target === selectedNode.id) {
        connectionIds.add(edge.source);
      }
    });

    return Array.from(connectionIds).map(
      (id) => simulation.nodes.find((n) => n.id === id)!
    );
  }, [selectedNode, simulation.nodes, simulation.edges]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSimulation((prev) => ({
      ...prev,
      selectedNodeId: prev.selectedNodeId === nodeId ? null : nodeId,
    }));
  }, []);

  const connectionStatusColor =
    connectionStatus === "connected"
      ? "text-green-500"
      : connectionStatus === "connecting"
        ? "text-yellow-500"
        : "text-red-500";

  const connectionStatusBg =
    connectionStatus === "connected"
      ? "bg-green-500/20"
      : connectionStatus === "connecting"
        ? "bg-yellow-500/20"
        : "bg-red-500/20";

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Brain Hologram View</h1>
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 rounded px-3 py-1 font-mono text-xs ${connectionStatusBg}`}
          >
            <div className={`h-2 w-2 rounded-full ${connectionStatusColor}`} />
            <span className={connectionStatusColor}>
              {connectionStatus === "connected"
                ? "Live"
                : connectionStatus === "connecting"
                  ? "Syncing..."
                  : "Offline"}
            </span>
          </div>
        </div>
      </header>

      <div className="flex gap-6">
        {/* Main graph container */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden rounded-lg border border-gray-700 bg-gray-950"
        >
          <svg
            ref={svgRef}
            width={containerWidth}
            height={containerHeight}
            className="w-full h-full"
            style={{ background: "linear-gradient(135deg, #111827 0%, #1f2937 100%)" }}
          >
            {/* Edges */}
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <style>{`
                @keyframes pulse {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.4; }
                }
                .animate-pulse {
                  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }
                .text-shadow {
                  text-shadow: 0 0 3px rgba(0,0,0,0.8);
                }
              `}</style>
            </defs>

            {/* Draw edges */}
            {simulation.edges.map((edge, idx) => {
              const source = simulation.nodes.find((n) => n.id === edge.source);
              const target = simulation.nodes.find((n) => n.id === edge.target);

              if (!source || !target) return null;

              const isConnectedToSelected =
                simulation.selectedNodeId === edge.source ||
                simulation.selectedNodeId === edge.target;

              return (
                <line
                  key={idx}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="rgba(147, 112, 219, 0.3)"
                  strokeWidth={Math.max(1, edge.weight * 3)}
                  opacity={isConnectedToSelected ? 0.7 : 0.3}
                  filter="url(#glow)"
                />
              );
            })}

            {/* Draw nodes */}
            {simulation.nodes.map((node) => (
              <g
                key={node.id}
                onClick={() => handleNodeClick(node.id)}
                style={{ cursor: "pointer" }}
              >
                <NodeSVG
                  node={node}
                  isSelected={simulation.selectedNodeId === node.id}
                  isHovered={hoveredNodeId === node.id}
                  onHover={setHoveredNodeId}
                />
              </g>
            ))}
          </svg>

          {/* Hover tooltip */}
          {hoveredNodeId && (
            <div className="absolute bottom-4 left-4 rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200">
              <div className="font-semibold text-white">
                {simulation.nodes.find((n) => n.id === hoveredNodeId)?.label}
              </div>
              <div className="text-xs text-gray-400">
                Confidence:{" "}
                {(
                  (simulation.nodes.find((n) => n.id === hoveredNodeId)?.confidence || 0) * 100
                ).toFixed(0)}
                %
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-4 right-4 space-y-2 rounded-lg border border-gray-700 bg-gray-900/80 p-4 text-xs text-gray-300 backdrop-blur">
            <div className="font-semibold text-white mb-3">Legend</div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-blue-500" />
              <span>Assets</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-green-500" style={{ clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)" }} />
              <span>Strategies</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-purple-500" style={{ clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)" }} />
              <span>Agents</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-red-500" style={{ clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)" }} />
              <span>Alerts</span>
            </div>
          </div>
        </div>

        {/* Inspector Panel */}
        <div className="w-80 rounded-lg border border-gray-700 bg-gray-900 p-6 overflow-y-auto max-h-[600px]">
          {selectedNode ? (
            <>
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedNode.label}</h2>
                  <div className="mt-2 inline-block rounded px-2 py-1 text-xs font-semibold">
                    <span
                      style={{
                        color: getNodeColor(selectedNode.type, selectedNode.active),
                      }}
                    >
                      {selectedNode.type.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-gray-700">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Status</span>
                    <span className="text-sm font-semibold text-white">
                      {selectedNode.active ? "🟢 Active" : "⚪ Inactive"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Confidence</span>
                    <span className="text-sm font-semibold text-white">
                      {(selectedNode.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {selectedNode.metrics && (
                  <div className="space-y-2 pt-4 border-t border-gray-700">
                    <h3 className="text-sm font-semibold text-white">Metrics</h3>
                    {Object.entries(selectedNode.metrics).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-gray-400 capitalize">{key}</span>
                        <span className="text-gray-200">{value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedNodeConnections.length > 0 && (
                  <div className="space-y-2 pt-4 border-t border-gray-700">
                    <h3 className="text-sm font-semibold text-white">Connected Nodes</h3>
                    <div className="space-y-1">
                      {selectedNodeConnections.map((node) => (
                        <div
                          key={node.id}
                          className="rounded px-2 py-1 text-xs bg-gray-800 text-gray-300"
                        >
                          <span
                            style={{
                              color: getNodeColor(node.type, node.active),
                            }}
                          >
                            ● {node.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Link
                  href={getDeepLink(selectedNode)}
                  className="block w-full mt-6 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 py-2 text-center text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-purple-500/50"
                >
                  View Details →
                </Link>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-4xl mb-3">🧠</div>
              <p className="text-sm text-gray-400">Click a node to inspect</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
