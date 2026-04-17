import { useEffect, useRef, useState, useCallback } from "react";

/* ── Types ──────────────────────────────────────────────────────────────────── */
type NodeCategory = "core" | "intelligence" | "execution" | "safety" | "analytics";
type NodeStatus = "healthy" | "degraded" | "critical" | "idle";

interface BrainNode {
  id: string;
  label: string;
  category: NodeCategory;
  status: NodeStatus;
  latencyMs: number;
  throughput: number;
  errorRate: number;
  description: string;
  connections: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface NodeEdge {
  from: string;
  to: string;
  strength: number;
}

/* ── Color Maps ─────────────────────────────────────────────────────────────── */
const CATEGORY_COLORS: Record<NodeCategory, string> = {
  core: "#9cff93",
  intelligence: "#67e8f9",
  execution: "#fbbf24",
  safety: "#ff7162",
  analytics: "#c084fc",
};

const STATUS_COLORS: Record<NodeStatus, string> = {
  healthy: "#9cff93",
  degraded: "#fbbf24",
  critical: "#ff7162",
  idle: "#484849",
};

/* ── 20 Brain Subsystem Definitions ─────────────────────────────────────────── */
const BRAIN_NODES: Omit<BrainNode, "x" | "y" | "vx" | "vy">[] = [
  // Core
  { id: "master-bus", label: "Master Event Bus", category: "core", status: "healthy", latencyMs: 0.3, throughput: 45000, errorRate: 0.001, description: "Central pub/sub backbone connecting all subsystems", connections: ["signal-engine", "risk-gate", "exec-engine", "brain-cortex"] },
  { id: "brain-cortex", label: "Brain Cortex", category: "core", status: "healthy", latencyMs: 2.1, throughput: 12000, errorRate: 0.002, description: "Higher-order reasoning and strategy orchestration", connections: ["regime-detector", "decision-loop", "portfolio-opt"] },
  { id: "data-ingest", label: "Data Ingestion", category: "core", status: "healthy", latencyMs: 1.5, throughput: 85000, errorRate: 0.003, description: "Multi-source market data normalization and routing", connections: ["master-bus", "candle-engine", "tick-processor"] },
  { id: "candle-engine", label: "Candle Engine", category: "core", status: "healthy", latencyMs: 0.8, throughput: 30000, errorRate: 0.001, description: "Real-time OHLCV aggregation across timeframes", connections: ["signal-engine", "pattern-scanner"] },
  // Intelligence
  { id: "signal-engine", label: "Signal Engine", category: "intelligence", status: "healthy", latencyMs: 4.2, throughput: 8000, errorRate: 0.005, description: "Multi-layer signal generation (6-layer pipeline)", connections: ["regime-detector", "sentiment-ai", "decision-loop"] },
  { id: "regime-detector", label: "Regime Detector", category: "intelligence", status: "healthy", latencyMs: 12, throughput: 500, errorRate: 0.008, description: "Market regime classification (trending/ranging/volatile)", connections: ["portfolio-opt", "risk-gate"] },
  { id: "sentiment-ai", label: "Sentiment AI", category: "intelligence", status: "degraded", latencyMs: 45, throughput: 200, errorRate: 0.02, description: "NLP-driven news and social sentiment scoring", connections: ["signal-engine", "news-monitor"] },
  { id: "pattern-scanner", label: "Pattern Scanner", category: "intelligence", status: "healthy", latencyMs: 8, throughput: 3000, errorRate: 0.004, description: "Technical pattern recognition (candlestick + chart)", connections: ["signal-engine"] },
  { id: "news-monitor", label: "News Monitor", category: "intelligence", status: "healthy", latencyMs: 30, throughput: 150, errorRate: 0.01, description: "Real-time news feed with impact weighting", connections: ["sentiment-ai"] },
  { id: "decision-loop", label: "Decision Loop", category: "intelligence", status: "healthy", latencyMs: 6, throughput: 2000, errorRate: 0.003, description: "Strategy selection and confidence scoring", connections: ["exec-engine", "risk-gate"] },
  // Execution
  { id: "exec-engine", label: "Execution Engine", category: "execution", status: "healthy", latencyMs: 1.2, throughput: 15000, errorRate: 0.002, description: "Order routing, smart execution, and venue selection", connections: ["order-manager", "position-tracker"] },
  { id: "order-manager", label: "Order Manager", category: "execution", status: "healthy", latencyMs: 0.5, throughput: 20000, errorRate: 0.001, description: "Order lifecycle management and state machine", connections: ["position-tracker", "risk-gate"] },
  { id: "position-tracker", label: "Position Tracker", category: "execution", status: "healthy", latencyMs: 0.3, throughput: 50000, errorRate: 0.0005, description: "Real-time P&L, exposure, and position state", connections: ["portfolio-opt", "risk-gate"] },
  { id: "tick-processor", label: "Tick Processor", category: "execution", status: "healthy", latencyMs: 0.1, throughput: 120000, errorRate: 0.0001, description: "Ultra-low latency tick-by-tick processing", connections: ["exec-engine", "candle-engine"] },
  // Safety
  { id: "risk-gate", label: "Risk Gate", category: "safety", status: "healthy", latencyMs: 0.4, throughput: 25000, errorRate: 0.0005, description: "Pre-trade risk checks, position limits, drawdown guards", connections: ["circuit-breaker", "capital-guard"] },
  { id: "circuit-breaker", label: "Circuit Breaker", category: "safety", status: "idle", latencyMs: 0.1, throughput: 100000, errorRate: 0, description: "Emergency halt on anomalous conditions", connections: ["master-bus"] },
  { id: "capital-guard", label: "Capital Guard", category: "safety", status: "healthy", latencyMs: 1, throughput: 10000, errorRate: 0.001, description: "Capital allocation limits and tier enforcement", connections: ["portfolio-opt"] },
  // Analytics
  { id: "portfolio-opt", label: "Portfolio Optimizer", category: "analytics", status: "healthy", latencyMs: 25, throughput: 100, errorRate: 0.005, description: "Multi-asset allocation optimization", connections: ["perf-tracker"] },
  { id: "perf-tracker", label: "Performance Tracker", category: "analytics", status: "healthy", latencyMs: 5, throughput: 5000, errorRate: 0.002, description: "Equity curves, Sharpe, drawdown analytics", connections: ["audit-log"] },
  { id: "audit-log", label: "Audit Logger", category: "analytics", status: "healthy", latencyMs: 2, throughput: 40000, errorRate: 0.0001, description: "Immutable event log for compliance and replay", connections: ["master-bus"] },
];

function createEdges(nodes: typeof BRAIN_NODES): NodeEdge[] {
  const edges: NodeEdge[] = [];
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    for (const target of node.connections) {
      if (ids.has(target)) {
        edges.push({ from: node.id, to: target, strength: 0.6 + Math.random() * 0.4 });
      }
    }
  }
  return edges;
}

function initNodes(): BrainNode[] {
  const cx = 500, cy = 350;
  return BRAIN_NODES.map((n, i) => {
    const angle = (i / BRAIN_NODES.length) * Math.PI * 2;
    const radius = 160 + Math.random() * 80;
    return { ...n, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
}

/* ── Main Component ─────────────────────────────────────────────────────────── */
export default function BrainNodesPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<BrainNode[]>(initNodes());
  const edgesRef = useRef<NodeEdge[]>(createEdges(BRAIN_NODES));
  const [selectedNode, setSelectedNode] = useState<BrainNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef(0);

  /* ── Simulated status updates ─────────────────────────────────────────────── */
  useEffect(() => {
    const interval = setInterval(() => {
      const nodes = nodesRef.current;
      const idx = Math.floor(Math.random() * nodes.length);
      const node = nodes[idx];
      node.latencyMs = Math.max(0.1, node.latencyMs + (Math.random() - 0.5) * 2);
      node.throughput = Math.max(10, Math.round(node.throughput + (Math.random() - 0.5) * 200));
      node.errorRate = Math.max(0, Math.min(0.1, node.errorRate + (Math.random() - 0.5) * 0.005));
      if (node.errorRate > 0.03) node.status = "critical";
      else if (node.errorRate > 0.015) node.status = "degraded";
      else if (node.throughput < 50) node.status = "idle";
      else node.status = "healthy";
      if (selectedNode?.id === node.id) setSelectedNode({ ...node });
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedNode]);

  /* ── Find node at point ───────────────────────────────────────────────────── */
  const findNodeAt = useCallback((mx: number, my: number): BrainNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = (mx - rect.left) * sx;
    const y = (my - rect.top) * sy;
    for (const node of nodesRef.current) {
      const r = 24;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 < r * r) return node;
    }
    return null;
  }, []);

  /* ── Mouse Handlers ───────────────────────────────────────────────────────── */
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) {
        node.x = (e.clientX - rect.left) * sx - dragRef.current.offsetX;
        node.y = (e.clientY - rect.top) * sy - dragRef.current.offsetY;
        node.vx = 0;
        node.vy = 0;
      }
      return;
    }
    const hit = findNodeAt(e.clientX, e.clientY);
    setHoveredNode(hit?.id ?? null);
  }, [findNodeAt]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const hit = findNodeAt(e.clientX, e.clientY);
    if (!hit) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    dragRef.current = {
      nodeId: hit.id,
      offsetX: (e.clientX - rect.left) * sx - hit.x,
      offsetY: (e.clientY - rect.top) * sy - hit.y,
    };
  }, [findNodeAt]);

  const onMouseUp = useCallback(() => {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) setSelectedNode({ ...node });
      dragRef.current = null;
    }
  }, []);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) return;
    const hit = findNodeAt(e.clientX, e.clientY);
    setSelectedNode(hit ? { ...hit } : null);
  }, [findNodeAt]);

  /* ── Physics + Render Loop ────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    function tick() {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const W = canvas!.width, H = canvas!.height;
      const cx = W / 2, cy = H / 2;

      /* Physics: repulsion between all node pairs */
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 8000 / (dist * dist);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      /* Physics: spring forces along edges */
      for (const edge of edges) {
        const a = nodeMap.get(edge.from), b = nodeMap.get(edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const target = 120;
        const force = (dist - target) * 0.005 * edge.strength;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      /* Physics: gravity toward center + damping */
      for (const node of nodes) {
        node.vx += (cx - node.x) * 0.0003;
        node.vy += (cy - node.y) * 0.0003;
        node.vx *= 0.92; node.vy *= 0.92;
        if (!dragRef.current || dragRef.current.nodeId !== node.id) {
          node.x += node.vx;
          node.y += node.vy;
        }
        node.x = Math.max(30, Math.min(W - 30, node.x));
        node.y = Math.max(30, Math.min(H - 30, node.y));
      }

      /* Clear */
      ctx.fillStyle = "#0a0a1a";
      ctx.fillRect(0, 0, W, H);

      /* Draw edges */
      for (const edge of edges) {
        const a = nodeMap.get(edge.from), b = nodeMap.get(edge.to);
        if (!a || !b) continue;
        const isHighlighted = hoveredNode === a.id || hoveredNode === b.id;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = isHighlighted ? "rgba(156,255,147,0.4)" : "rgba(72,72,73,0.25)";
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.stroke();

        /* Animated pulse along edge */
        const pulse = ((t * edge.strength * 0.5) % 1);
        const px = a.x + (b.x - a.x) * pulse;
        const py = a.y + (b.y - a.y) * pulse;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted ? "rgba(156,255,147,0.8)" : "rgba(156,255,147,0.3)";
        ctx.fill();
      }

      /* Draw nodes */
      for (const node of nodes) {
        const isHover = hoveredNode === node.id;
        const isSelected = selectedNode?.id === node.id;
        const catColor = CATEGORY_COLORS[node.category];
        const statusColor = STATUS_COLORS[node.status];
        const r = isHover || isSelected ? 26 : 22;

        /* Glow */
        if (isHover || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 8);
          grad.addColorStop(0, catColor + "33");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.fill();
        }

        /* Circle */
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? catColor + "30" : "#1a191b";
        ctx.fill();
        ctx.strokeStyle = isHover || isSelected ? catColor : catColor + "60";
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();

        /* Status dot (pulsing for critical) */
        const statusR = node.status === "critical" ? 4 + Math.sin(t * 6) * 1.5 : 4;
        ctx.beginPath();
        ctx.arc(node.x + r * 0.6, node.y - r * 0.6, statusR, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();

        /* Label */
        ctx.font = "bold 9px 'Space Grotesk', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = isHover || isSelected ? "#ffffff" : "#adaaab";
        ctx.fillText(node.label, node.x, node.y + r + 14);
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [hoveredNode, selectedNode]);

  /* ── Resize handler ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  /* ── Category legend ──────────────────────────────────────────────────────── */
  const categories: NodeCategory[] = ["core", "intelligence", "execution", "safety", "analytics"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-headline tracking-wide" style={{ color: "#ffffff" }}>Brain Nodes</h1>
          <p className="text-xs mt-1" style={{ color: "#767576" }}>Interactive force-directed graph of 20 brain subsystems</p>
        </div>
        <div className="flex items-center gap-3">
          {categories.map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>{cat}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4" style={{ height: "calc(100vh - 180px)" }}>
        {/* Canvas */}
        <div className="flex-1 rounded-lg overflow-hidden relative" style={{ backgroundColor: "#0a0a1a", border: "1px solid rgba(72,72,73,0.2)" }}>
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair"
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onClick={onClick}
            onMouseLeave={() => { setHoveredNode(null); dragRef.current = null; }}
          />
        </div>

        {/* Detail Sidebar */}
        <div className="w-72 rounded-lg overflow-y-auto" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.2)" }}>
          {selectedNode ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[selectedNode.category] }} />
                <h2 className="text-sm font-bold font-headline" style={{ color: "#ffffff" }}>{selectedNode.label}</h2>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "#adaaab" }}>{selectedNode.description}</p>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "#767576" }}>Status</span>
                  <span className="text-[10px] font-bold uppercase" style={{ color: STATUS_COLORS[selectedNode.status] }}>{selectedNode.status}</span>
                </div>
                <div className="flex justify-between items-center px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "#767576" }}>Latency</span>
                  <span className="text-[10px] font-mono" style={{ color: selectedNode.latencyMs > 20 ? "#fbbf24" : "#9cff93" }}>{selectedNode.latencyMs.toFixed(1)}ms</span>
                </div>
                <div className="flex justify-between items-center px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "#767576" }}>Throughput</span>
                  <span className="text-[10px] font-mono" style={{ color: "#67e8f9" }}>{selectedNode.throughput.toLocaleString()}/s</span>
                </div>
                <div className="flex justify-between items-center px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "#767576" }}>Error Rate</span>
                  <span className="text-[10px] font-mono" style={{ color: selectedNode.errorRate > 0.01 ? "#ff7162" : "#9cff93" }}>{(selectedNode.errorRate * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between items-center px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "#767576" }}>Category</span>
                  <span className="text-[10px] uppercase font-bold" style={{ color: CATEGORY_COLORS[selectedNode.category] }}>{selectedNode.category}</span>
                </div>
              </div>

              {/* Connections */}
              <div>
                <h3 className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "#767576" }}>Connections</h3>
                <div className="space-y-1">
                  {selectedNode.connections.map((connId) => {
                    const target = nodesRef.current.find((n) => n.id === connId);
                    if (!target) return null;
                    return (
                      <button
                        key={connId}
                        onClick={() => setSelectedNode({ ...target })}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-white/5 transition-colors"
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[target.category] }} />
                        <span className="text-[10px]" style={{ color: "#adaaab" }}>{target.label}</span>
                        <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[target.status] }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <span className="material-symbols-outlined text-3xl mb-3" style={{ color: "#484849" }}>neurology</span>
              <p className="text-xs" style={{ color: "#767576" }}>Click a node to inspect</p>
              <p className="text-[10px] mt-1" style={{ color: "#484849" }}>Drag nodes to rearrange</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
