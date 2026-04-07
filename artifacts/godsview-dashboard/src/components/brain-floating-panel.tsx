import { useState, useEffect, useRef, useCallback } from "react";

/* ── Brain subsystem data ─────────────────────────────── */
interface BrainNode {
  id: string;
  name: string;
  status: "active" | "degraded" | "idle" | "error";
  latency: number;
  throughput: number;
  lastUpdate: string;
}

const SUBSYSTEMS = [
  "SupremeBrain", "GlobalContext", "MarketRegime", "MacroBrain",
  "NewsBrain", "SessionBrain", "MemoryBrain", "ReasoningBrain",
  "RiskBrain", "ExecutionBrain", "EvolutionBrain", "SymbolBrain:SPY",
  "SymbolBrain:QQQ", "SymbolBrain:NVDA", "StructureNode", "OrderflowNode",
];

function generateNodes(): BrainNode[] {
  return SUBSYSTEMS.map((name) => ({
    id: name.toLowerCase().replace(/[: ]/g, "-"),
    name,
    status: (["active","active","active","degraded","idle","active","active","active"] as const)[
      Math.floor(Math.random() * 8)
    ],
    latency: Math.floor(Math.random() * 50 + 2),
    throughput: Math.floor(Math.random() * 500 + 10),
    lastUpdate: new Date().toISOString(),
  }));
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500", degraded: "bg-yellow-500", idle: "bg-gray-500", error: "bg-red-500",
};
const STATUS_TEXT: Record<string, string> = {
  active: "text-green-400", degraded: "text-yellow-400", idle: "text-gray-400", error: "text-red-400",
};

/* ── Draggable hook ───────────────────────────────────── */
function useDrag(ref: React.RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState({ x: window.innerWidth - 360, y: 80 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  return { pos, onMouseDown };
}

/* ── Main Component ───────────────────────────────────── */
export default function BrainFloatingPanel() {
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [nodes, setNodes] = useState<BrainNode[]>(generateNodes);
  const panelRef = useRef<HTMLDivElement>(null);
  const { pos, onMouseDown } = useDrag(panelRef);

  // Live updates every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          status: Math.random() > 0.15 ? "active" : Math.random() > 0.5 ? "degraded" : n.status,
          latency: Math.max(1, n.latency + Math.floor(Math.random() * 10 - 5)),
          throughput: Math.max(1, n.throughput + Math.floor(Math.random() * 40 - 20)),
          lastUpdate: new Date().toISOString(),
        }))
      );
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const activeCount = nodes.filter((n) => n.status === "active").length;
  const degradedCount = nodes.filter((n) => n.status === "degraded" || n.status === "error").length;
  const avgLatency = (nodes.reduce((s, n) => s + n.latency, 0) / nodes.length).toFixed(0);

  /* ── Floating trigger button ────────────────────────── */
  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-6 right-6 z-50 bg-purple-600 hover:bg-purple-500 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg shadow-purple-900/50 transition-all group"
        title="Open Brain Panel"
      >
        <span className="material-symbols-rounded text-2xl">neurology</span>
        {degradedCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {degradedCount}
          </span>
        )}
      </button>
    );
  }

  /* ── Floating panel ─────────────────────────────────── */
  return (
    <div
      ref={panelRef}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 bg-[#0e0e1a] border border-purple-800/50 rounded-xl shadow-2xl shadow-purple-900/30 overflow-hidden"
    >
      {/* Title bar — draggable */}
      <div
        onMouseDown={onMouseDown}
        className="flex items-center justify-between px-3 py-2 bg-purple-900/40 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-rounded text-purple-400 text-lg">neurology</span>
          <span className="text-sm font-semibold text-white">God Brain</span>
          <span className="text-xs text-purple-300 ml-1">{activeCount}/{nodes.length} active</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(!minimized)} className="text-gray-400 hover:text-white p-1">
            <span className="material-symbols-rounded text-sm">{minimized ? "expand_more" : "minimize"}</span>
          </button>
          <button onClick={() => setVisible(false)} className="text-gray-400 hover:text-red-400 p-1">
            <span className="material-symbols-rounded text-sm">close</span>
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="w-80 max-h-96 overflow-y-auto">
          {/* Summary bar */}
          <div className="grid grid-cols-3 gap-2 p-3 border-b border-gray-800">
            <div className="text-center">
              <div className="text-green-400 text-lg font-bold">{activeCount}</div>
              <div className="text-[10px] text-gray-500">Active</div>
            </div>
            <div className="text-center">
              <div className="text-yellow-400 text-lg font-bold">{degradedCount}</div>
              <div className="text-[10px] text-gray-500">Issues</div>
            </div>
            <div className="text-center">
              <div className="text-cyan-400 text-lg font-bold">{avgLatency}ms</div>
              <div className="text-[10px] text-gray-500">Avg Latency</div>
            </div>
          </div>

          {/* Node list */}
          <div className="divide-y divide-gray-800/50">
            {nodes.map((node) => (
              <div key={node.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-white/5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[node.status]} flex-shrink-0`} />
                  <span className="text-xs text-gray-300 truncate">{node.name}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 text-[10px]">
                  <span className={STATUS_TEXT[node.status]}>{node.latency}ms</span>
                  <span className="text-gray-500">{node.throughput}/s</span>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-gray-800 flex items-center justify-between">
            <span className="text-[10px] text-gray-500">
              Updated {new Date().toLocaleTimeString()}
            </span>
            <a href="/brain-nodes" className="text-[10px] text-purple-400 hover:text-purple-300">
              Full View →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
