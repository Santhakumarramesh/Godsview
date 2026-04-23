/**
 * intelligence_graph.ts — Phase 3: God Brain v2 Intelligence Graph
 *
 * Creates a connected reasoning graph that traces how the system
 * arrives at every trading decision. Each decision creates nodes:
 *
 *   Signal → Structure Analysis → Order Flow → Memory Recall →
 *   Confidence Score → Risk Gate → Decision → Execution → Outcome
 *
 * The graph enables:
 *   1. Visual reasoning traces (why did the system decide X?)
 *   2. Pattern detection across decisions (which paths lead to wins?)
 *   3. Bottleneck identification (where do good setups get rejected?)
 *   4. Learning feedback (which reasoning steps need calibration?)
 *   5. Real-time brain hologram node data
 *
 * Integrates with UDE, feedback loop, and brain nodes.
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "intelligence-graph" });

// ── Types ────────────────────────────────────────────────────────────────────

export type GraphNodeType =
  | "signal"
  | "structure"
  | "orderflow"
  | "memory"
  | "confidence"
  | "risk_gate"
  | "decision"
  | "execution"
  | "outcome"
  | "regime"
  | "sentiment"
  | "macro";

export type GraphEdgeType =
  | "feeds_into"
  | "validates"
  | "blocks"
  | "overrides"
  | "recalls"
  | "confirms"
  | "contradicts"
  | "triggers";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Parent decision trace ID */
  traceId: string;
  /** Symbol this node relates to */
  symbol: string;
  /** Score/value at this node (0-1) */
  score: number;
  /** Status indicator */
  status: "active" | "passed" | "failed" | "skipped";
  /** Human-readable detail */
  detail: string;
  /** Metadata payload */
  metadata: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  weight: number;
  label: string;
  traceId: string;
  timestamp: string;
}

export interface ReasoningTrace {
  traceId: string;
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  decision: "approve" | "reject" | "defer";
  confidence: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Total pipeline latency */
  latencyMs: number;
  /** Final explanation */
  explanation: string;
  /** Outcome if known */
  outcome?: "win" | "loss" | "breakeven" | "pending";
  timestamp: string;
}

export interface GraphSummary {
  totalTraces: number;
  totalNodes: number;
  totalEdges: number;
  decisionBreakdown: { approve: number; reject: number; defer: number };
  outcomeBreakdown: { win: number; loss: number; breakeven: number; pending: number };
  avgConfidence: number;
  avgLatencyMs: number;
  topBlockers: { reason: string; count: number }[];
  topWinningPaths: { path: string; winRate: number; count: number }[];
  symbolActivity: { symbol: string; traces: number; winRate: number }[];
}

// ── Storage ──────────────────────────────────────────────────────────────────

const MAX_TRACES = parseInt(process.env.GRAPH_MAX_TRACES ?? "500", 10);
const _traces: Map<string, ReasoningTrace> = new Map();
const _traceOrder: string[] = [];
const _nodeIndex: Map<string, GraphNode[]> = new Map(); // by symbol
const _blockerCounts: Map<string, number> = new Map();

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Build a reasoning trace from a UDE decision result.
 * Called automatically after each evaluateDecision() call.
 */
export function buildReasoningTrace(params: {
  requestId: string;
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  decision: "approve" | "reject" | "defer";
  confidence: number;
  latencyMs: number;
  explanation: string;
  structureScore: number;
  orderFlowScore: number;
  recallScore: number;
  regime: string;
  sentimentScore?: number;
  macroBias?: string;
  riskGatePassed: boolean;
  riskBlockReasons?: string[];
  confidenceFactors: { name: string; score: number; weight: number }[];
  memoryRecall?: { similarSetups: number; winRate: number };
  pipelineStages?: { name: string; durationMs: number; result: string }[];
}): ReasoningTrace {
  const ts = new Date().toISOString();
  const traceId = params.requestId;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let nodeIdx = 0;

  const mkId = (type: string) => `${traceId}_${type}_${nodeIdx++}`;
  const mkEdge = (src: string, tgt: string, type: GraphEdgeType, label: string): GraphEdge => ({
    id: `${src}->${tgt}`,
    source: src, target: tgt, type, weight: 1, label, traceId, timestamp: ts,
  });

  // 1. Signal node (entry point)
  const signalId = mkId("signal");
  nodes.push({
    id: signalId, type: "signal", label: `${params.symbol} ${params.direction} signal`,
    traceId, symbol: params.symbol, score: 1, status: "passed",
    detail: `${params.strategy} setup detected`, metadata: { strategy: params.strategy }, timestamp: ts,
  });

  // 2. Regime node
  const regimeId = mkId("regime");
  nodes.push({
    id: regimeId, type: "regime", label: `Regime: ${params.regime}`,
    traceId, symbol: params.symbol, score: params.regime === "trending_bull" ? 0.8 : params.regime === "volatile" ? 0.4 : 0.6,
    status: "passed", detail: `Market regime classified as ${params.regime}`,
    metadata: { regime: params.regime }, timestamp: ts,
  });
  edges.push(mkEdge(signalId, regimeId, "feeds_into", "context"));

  // 3. Structure analysis node
  const structId = mkId("structure");
  nodes.push({
    id: structId, type: "structure", label: `Structure: ${(params.structureScore * 100).toFixed(0)}%`,
    traceId, symbol: params.symbol, score: params.structureScore, status: params.structureScore > 0.5 ? "passed" : "failed",
    detail: `Chart structure score ${(params.structureScore * 100).toFixed(1)}%`,
    metadata: { structureScore: params.structureScore }, timestamp: ts,
  });
  edges.push(mkEdge(signalId, structId, "feeds_into", "analyze"));

  // 4. Order flow node
  const flowId = mkId("orderflow");
  nodes.push({
    id: flowId, type: "orderflow", label: `Flow: ${(params.orderFlowScore * 100).toFixed(0)}%`,
    traceId, symbol: params.symbol, score: params.orderFlowScore, status: params.orderFlowScore > 0.5 ? "passed" : "failed",
    detail: `Order flow confluence ${(params.orderFlowScore * 100).toFixed(1)}%`,
    metadata: { orderFlowScore: params.orderFlowScore }, timestamp: ts,
  });
  edges.push(mkEdge(signalId, flowId, "feeds_into", "analyze"));

  // 5. Memory recall node
  const memId = mkId("memory");
  const memWinRate = params.memoryRecall?.winRate ?? 0;
  nodes.push({
    id: memId, type: "memory", label: `Recall: ${params.memoryRecall?.similarSetups ?? 0} similar`,
    traceId, symbol: params.symbol, score: params.recallScore, status: params.recallScore > 0.4 ? "passed" : "skipped",
    detail: params.memoryRecall
      ? `Found ${params.memoryRecall.similarSetups} similar setups, ${(memWinRate * 100).toFixed(0)}% win rate`
      : "No similar setups found",
    metadata: { recall: params.memoryRecall ?? {} }, timestamp: ts,
  });
  edges.push(mkEdge(structId, memId, "recalls", "history lookup"));

  // 6. Sentiment node (optional)
  let sentId: string | undefined;
  if (params.sentimentScore !== undefined) {
    sentId = mkId("sentiment");
    nodes.push({
      id: sentId, type: "sentiment", label: `Sentiment: ${(params.sentimentScore * 100).toFixed(0)}%`,
      traceId, symbol: params.symbol, score: params.sentimentScore, status: "passed",
      detail: `News/sentiment score ${(params.sentimentScore * 100).toFixed(1)}%`,
      metadata: { sentimentScore: params.sentimentScore }, timestamp: ts,
    });
    edges.push(mkEdge(signalId, sentId, "feeds_into", "sentiment check"));
  }

  // 7. Confidence aggregation node
  const confId = mkId("confidence");
  nodes.push({
    id: confId, type: "confidence", label: `Confidence: ${(params.confidence * 100).toFixed(0)}%`,
    traceId, symbol: params.symbol, score: params.confidence,
    status: params.confidence >= 0.55 ? "passed" : "failed",
    detail: `Multi-factor confidence: ${params.confidenceFactors.map(f => `${f.name}=${(f.score * 100).toFixed(0)}%`).join(", ")}`,
    metadata: { factors: params.confidenceFactors, overall: params.confidence }, timestamp: ts,
  });
  // All analysis feeds into confidence
  edges.push(mkEdge(structId, confId, "feeds_into", "structure weight"));
  edges.push(mkEdge(flowId, confId, "feeds_into", "flow weight"));
  edges.push(mkEdge(memId, confId, "feeds_into", "memory weight"));
  edges.push(mkEdge(regimeId, confId, "feeds_into", "regime context"));
  if (sentId) edges.push(mkEdge(sentId, confId, "feeds_into", "sentiment weight"));

  // 8. Risk gate node
  const riskId = mkId("risk_gate");
  nodes.push({
    id: riskId, type: "risk_gate", label: params.riskGatePassed ? "Risk: PASS" : "Risk: BLOCKED",
    traceId, symbol: params.symbol, score: params.riskGatePassed ? 1 : 0,
    status: params.riskGatePassed ? "passed" : "failed",
    detail: params.riskGatePassed
      ? "All risk checks passed"
      : `Blocked: ${(params.riskBlockReasons ?? []).join("; ")}`,
    metadata: { passed: params.riskGatePassed, reasons: params.riskBlockReasons ?? [] }, timestamp: ts,
  });
  edges.push(mkEdge(confId, riskId, params.riskGatePassed ? "validates" : "blocks", "risk check"));

  // Track blockers
  if (!params.riskGatePassed && params.riskBlockReasons) {
    for (const reason of params.riskBlockReasons) {
      _blockerCounts.set(reason, (_blockerCounts.get(reason) ?? 0) + 1);
    }
  }

  // 9. Decision node
  const decId = mkId("decision");
  nodes.push({
    id: decId, type: "decision", label: `Decision: ${params.decision.toUpperCase()}`,
    traceId, symbol: params.symbol, score: params.decision === "approve" ? 1 : params.decision === "defer" ? 0.5 : 0,
    status: params.decision === "approve" ? "passed" : params.decision === "defer" ? "active" : "failed",
    detail: params.explanation,
    metadata: { decision: params.decision, confidence: params.confidence }, timestamp: ts,
  });
  edges.push(mkEdge(riskId, decId, params.riskGatePassed ? "validates" : "blocks", "gate result"));

  // Build trace
  const trace: ReasoningTrace = {
    traceId, symbol: params.symbol, strategy: params.strategy,
    direction: params.direction, decision: params.decision,
    confidence: params.confidence, nodes, edges,
    latencyMs: params.latencyMs, explanation: params.explanation,
    outcome: "pending", timestamp: ts,
  };

  // Store
  storeTrace(trace);

  logger.info(
    { traceId, symbol: params.symbol, decision: params.decision, nodes: nodes.length, edges: edges.length },
    `[graph] Reasoning trace built: ${params.decision}`,
  );

  return trace;
}

// ── Storage Helpers ──────────────────────────────────────────────────────────

function storeTrace(trace: ReasoningTrace): void {
  _traces.set(trace.traceId, trace);
  _traceOrder.push(trace.traceId);

  // Index by symbol
  if (!_nodeIndex.has(trace.symbol)) _nodeIndex.set(trace.symbol, []);
  _nodeIndex.get(trace.symbol)!.push(...trace.nodes);

  // Evict old traces
  while (_traceOrder.length > MAX_TRACES) {
    const oldId = _traceOrder.shift()!;
    const old = _traces.get(oldId);
    if (old) {
      // Remove symbol index entries for old trace
      const symNodes = _nodeIndex.get(old.symbol);
      if (symNodes) {
        const oldNodeIds = new Set(old.nodes.map(n => n.id));
        const filtered = symNodes.filter(n => !oldNodeIds.has(n.id));
        if (filtered.length > 0) _nodeIndex.set(old.symbol, filtered);
        else _nodeIndex.delete(old.symbol);
      }
      _traces.delete(oldId);
    }
  }
}

/**
 * Update a trace's outcome after trade closes.
 */
export function updateTraceOutcome(
  traceId: string,
  outcome: "win" | "loss" | "breakeven",
): boolean {
  const trace = _traces.get(traceId);
  if (!trace) return false;

  trace.outcome = outcome;

  // Add outcome node
  const ts = new Date().toISOString();
  const outcomeNode: GraphNode = {
    id: `${traceId}_outcome`,
    type: "outcome",
    label: `Outcome: ${outcome.toUpperCase()}`,
    traceId, symbol: trace.symbol,
    score: outcome === "win" ? 1 : outcome === "breakeven" ? 0.5 : 0,
    status: outcome === "win" ? "passed" : "failed",
    detail: `Trade ${outcome}`,
    metadata: { outcome }, timestamp: ts,
  };
  trace.nodes.push(outcomeNode);

  // Connect decision → outcome
  const decNode = trace.nodes.find(n => n.type === "decision");
  if (decNode) {
    trace.edges.push({
      id: `${decNode.id}->${outcomeNode.id}`,
      source: decNode.id, target: outcomeNode.id,
      type: "triggers", weight: 1, label: "resulted in",
      traceId, timestamp: ts,
    });
  }

  logger.info({ traceId, outcome }, `[graph] Trace outcome updated: ${outcome}`);
  return true;
}

// ── Query Functions ──────────────────────────────────────────────────────────

/** Get a specific reasoning trace */
export function getTrace(traceId: string): ReasoningTrace | undefined {
  return _traces.get(traceId);
}

/** Get recent traces */
export function getRecentTraces(limit = 50): ReasoningTrace[] {
  const ids = _traceOrder.slice(-limit).reverse();
  return ids.map(id => _traces.get(id)!).filter(Boolean);
}

/** Get traces for a specific symbol */
export function getTracesForSymbol(symbol: string, limit = 20): ReasoningTrace[] {
  return getRecentTraces(MAX_TRACES)
    .filter(t => t.symbol === symbol)
    .slice(0, limit);
}

/** Get the full graph (all nodes and edges across traces) */
export function getFullGraph(limit = 100): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const traces = getRecentTraces(limit);
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  for (const t of traces) {
    allNodes.push(...t.nodes);
    allEdges.push(...t.edges);
  }
  return { nodes: allNodes, edges: allEdges };
}

/** Get graph for a specific symbol */
export function getSymbolGraph(symbol: string, limit = 20): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const traces = getTracesForSymbol(symbol, limit);
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  for (const t of traces) {
    allNodes.push(...t.nodes);
    allEdges.push(...t.edges);
  }
  return { nodes: allNodes, edges: allEdges };
}

/** Get graph summary analytics */
export function getGraphSummary(): GraphSummary {
  const traces = Array.from(_traces.values());
  const total = traces.length;

  const decisionBreakdown = { approve: 0, reject: 0, defer: 0 };
  const outcomeBreakdown = { win: 0, loss: 0, breakeven: 0, pending: 0 };
  let totalConf = 0;
  let totalLatency = 0;
  const symbolMap: Map<string, { traces: number; wins: number; total: number }> = new Map();

  for (const t of traces) {
    decisionBreakdown[t.decision]++;
    outcomeBreakdown[t.outcome ?? "pending"]++;
    totalConf += t.confidence;
    totalLatency += t.latencyMs;

    if (!symbolMap.has(t.symbol)) symbolMap.set(t.symbol, { traces: 0, wins: 0, total: 0 });
    const sm = symbolMap.get(t.symbol)!;
    sm.traces++;
    if (t.outcome && t.outcome !== "pending") {
      sm.total++;
      if (t.outcome === "win") sm.wins++;
    }
  }

  // Top blockers
  const topBlockers = Array.from(_blockerCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Winning paths — analyze which node type combinations lead to wins
  const pathCounts: Map<string, { wins: number; total: number }> = new Map();
  for (const t of traces) {
    if (!t.outcome || t.outcome === "pending") continue;
    const path = t.nodes
      .filter(n => n.status === "passed")
      .map(n => n.type)
      .join(" → ");
    if (!pathCounts.has(path)) pathCounts.set(path, { wins: 0, total: 0 });
    const pc = pathCounts.get(path)!;
    pc.total++;
    if (t.outcome === "win") pc.wins++;
  }
  const topWinningPaths = Array.from(pathCounts.entries())
    .map(([path, { wins, total }]) => ({ path, winRate: total > 0 ? wins / total : 0, count: total }))
    .filter(p => p.count >= 3)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  // Symbol activity
  const symbolActivity = Array.from(symbolMap.entries())
    .map(([symbol, { traces: traceCount, wins, total: symTotal }]) => ({
      symbol, traces: traceCount, winRate: symTotal > 0 ? wins / symTotal : 0,
    }))
    .sort((a, b) => b.traces - a.traces);

  return {
    totalTraces: total,
    totalNodes: traces.reduce((sum, t) => sum + t.nodes.length, 0),
    totalEdges: traces.reduce((sum, t) => sum + t.edges.length, 0),
    decisionBreakdown,
    outcomeBreakdown,
    avgConfidence: total > 0 ? totalConf / total : 0,
    avgLatencyMs: total > 0 ? totalLatency / total : 0,
    topBlockers,
    topWinningPaths,
    symbolActivity,
  };
}

/** Get node type distribution across all traces */
export function getNodeTypeDistribution(): Record<GraphNodeType, number> {
  const dist: Record<string, number> = {};
  for (const t of Array.from(_traces.values())) {
    for (const n of t.nodes) {
      dist[n.type] = (dist[n.type] ?? 0) + 1;
    }
  }
  return dist as Record<GraphNodeType, number>;
}

/** Get edge type distribution */
export function getEdgeTypeDistribution(): Record<GraphEdgeType, number> {
  const dist: Record<string, number> = {};
  for (const t of Array.from(_traces.values())) {
    for (const e of t.edges) {
      dist[e.type] = (dist[e.type] ?? 0) + 1;
    }
  }
  return dist as Record<GraphEdgeType, number>;
}
