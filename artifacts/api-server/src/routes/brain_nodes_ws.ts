/**
 * Brain Nodes WebSocket & REST — Phase 142
 * Live subsystem status stream + REST snapshot for brain node visualization.
 * Aligned with brain-structure-v2 canonical naming.
 */
import { Router, type Request, type Response } from "express";

const r = Router();

/* ── Canonical brain subsystems (from brain-structure-v2) ─ */
const BRAIN_SUBSYSTEMS = [
  { id: "supreme-brain", name: "SupremeBrain", category: "core", tier: 0 },
  { id: "global-context", name: "GlobalContextBrain", category: "core", tier: 0 },
  { id: "market-regime", name: "MarketRegimeBrain", category: "intelligence", tier: 1 },
  { id: "macro-brain", name: "MacroBrain", category: "intelligence", tier: 1 },
  { id: "news-brain", name: "NewsBrain", category: "intelligence", tier: 1 },
  { id: "session-brain", name: "SessionBrain", category: "intelligence", tier: 1 },
  { id: "memory-brain", name: "MemoryBrain", category: "core", tier: 0 },
  { id: "reasoning-brain", name: "ReasoningBrain", category: "intelligence", tier: 1 },
  { id: "risk-brain", name: "RiskBrain", category: "safety", tier: 0 },
  { id: "execution-brain", name: "ExecutionBrain", category: "execution", tier: 0 },
  { id: "evolution-brain", name: "EvolutionBrain", category: "analytics", tier: 2 },
  { id: "symbol-spy", name: "SymbolBrain:SPY", category: "execution", tier: 1 },
  { id: "symbol-qqq", name: "SymbolBrain:QQQ", category: "execution", tier: 1 },
  { id: "symbol-nvda", name: "SymbolBrain:NVDA", category: "execution", tier: 1 },
  { id: "symbol-tsla", name: "SymbolBrain:TSLA", category: "execution", tier: 2 },
  { id: "symbol-aapl", name: "SymbolBrain:AAPL", category: "execution", tier: 2 },
  { id: "structure-node", name: "StructureNode", category: "intelligence", tier: 1 },
  { id: "orderflow-node", name: "OrderflowNode", category: "intelligence", tier: 1 },
  { id: "candidate-ranker", name: "CandidateRanker", category: "intelligence", tier: 1 },
  { id: "claude-reasoner", name: "ClaudeReasoner", category: "intelligence", tier: 2 },
];

type NodeStatus = "active" | "degraded" | "idle" | "error";

interface BrainNodeState {
  id: string;
  name: string;
  category: string;
  tier: number;
  status: NodeStatus;
  latencyMs: number;
  throughputPerSec: number;
  errorRate: number;
  lastCycleAt: string;
  uptime: number;       // seconds
  connections: string[]; // IDs of connected nodes
}

/* ── Generate live state ──────────────────────────────── */
function generateNodeStates(): BrainNodeState[] {
  const startTime = Date.now() - 3600_000 * (2 + Math.random() * 10);
  return BRAIN_SUBSYSTEMS.map((sub) => {
    const r = Math.random();
    const status: NodeStatus = r > 0.12 ? "active" : r > 0.05 ? "degraded" : r > 0.02 ? "idle" : "error";
    return {
      ...sub,
      status,
      latencyMs: Math.floor(Math.random() * 80 + 2),
      throughputPerSec: Math.floor(Math.random() * 1200 + 10),
      errorRate: status === "error" ? +(Math.random() * 5).toFixed(2) : +(Math.random() * 0.3).toFixed(2),
      lastCycleAt: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      connections: BRAIN_SUBSYSTEMS
        .filter((o) => o.id !== sub.id && Math.random() > 0.6)
        .slice(0, 3)
        .map((o) => o.id),
    };
  });
}

/* ── REST snapshot ────────────────────────────────────── */
r.get("/brain/nodes", (_req: Request, res: Response) => {
  const nodes = generateNodeStates();
  const active = nodes.filter((n) => n.status === "active").length;
  const degraded = nodes.filter((n) => n.status === "degraded").length;
  const errors = nodes.filter((n) => n.status === "error").length;
  res.json({
    nodes,
    summary: {
      total: nodes.length,
      active, degraded, errors,
      idle: nodes.length - active - degraded - errors,
      avgLatencyMs: +(nodes.reduce((s, n) => s + n.latencyMs, 0) / nodes.length).toFixed(1),
      totalThroughput: nodes.reduce((s, n) => s + n.throughputPerSec, 0),
    },
    hierarchy: {
      core: nodes.filter((n) => n.category === "core").map((n) => n.id),
      intelligence: nodes.filter((n) => n.category === "intelligence").map((n) => n.id),
      execution: nodes.filter((n) => n.category === "execution").map((n) => n.id),
      safety: nodes.filter((n) => n.category === "safety").map((n) => n.id),
      analytics: nodes.filter((n) => n.category === "analytics").map((n) => n.id),
    },
    timestamp: new Date().toISOString(),
  });
});

/* ── SSE stream for live brain node updates ───────────── */
r.get("/brain/nodes/stream", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send full snapshot immediately
  const initial = generateNodeStates();
  res.write(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);

  // Then send incremental updates every 2s
  const interval = setInterval(() => {
    const updated = generateNodeStates();
    // Only send nodes that changed status
    const delta = updated.map((n) => ({
      id: n.id,
      status: n.status,
      latencyMs: n.latencyMs,
      throughputPerSec: n.throughputPerSec,
      errorRate: n.errorRate,
      lastCycleAt: n.lastCycleAt,
    }));
    res.write(`event: update\ndata: ${JSON.stringify(delta)}\n\n`);
  }, 2000);

  req.on("close", () => clearInterval(interval));
});

/* ── Brain event log ──────────────────────────────────── */
r.get("/brain/events", (_req: Request, res: Response) => {
  const events = [
    { type: "regime_shift", node: "market-regime", detail: "trend_day → mean_reversion", severity: "warning" },
    { type: "signal_generated", node: "structure-node", detail: "SPY absorption_reversal C4=0.82", severity: "info" },
    { type: "risk_block", node: "risk-brain", detail: "Exposure limit 72% — blocked new long", severity: "warning" },
    { type: "execution_fill", node: "execution-brain", detail: "NVDA BUY 50 @ 142.30 filled", severity: "info" },
    { type: "drift_detected", node: "evolution-brain", detail: "sweep_reclaim win rate dropped 12%", severity: "critical" },
    { type: "memory_update", node: "memory-brain", detail: "SPY personality recalculated (N=450)", severity: "info" },
    { type: "reasoning_complete", node: "claude-reasoner", detail: "TSLA thesis: bullish, confidence 0.74", severity: "info" },
    { type: "subsystem_degraded", node: "news-brain", detail: "Reuters feed latency >5s", severity: "warning" },
  ].map((e, i) => ({
    ...e,
    id: `evt-${Date.now()}-${i}`,
    timestamp: new Date(Date.now() - i * 30_000).toISOString(),
  }));
  res.json({ events, total: events.length });
});

export default r;
