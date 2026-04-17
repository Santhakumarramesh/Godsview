/**
 * brain_event_bus.ts — GodsView Agent Event Bus
 *
 * The central nervous system of GodsView. Every intelligence agent
 * (Structure, Regime, Orderflow, Memory, Risk, etc.) publishes
 * typed events here. The BrainOrchestrator subscribes and synthesizes
 * all agent reports into a unified decision — just like a human trader
 * receiving reports from multiple analysts.
 *
 * Architecture:
 *   Agent → publishes AgentReport → EventBus → BrainOrchestrator → Decision
 *
 * This replaces ad-hoc function calls between engines with a proper
 * event-driven architecture that can be observed, replayed, and logged.
 */

// ── Agent Identity ──────────────────────────────────────────────────────────

/** Individual sub-agent IDs (engine-level) */
export type SubAgentId =
  | "structure"      // SMC Engine — structure, OBs, FVGs, liquidity
  | "regime"         // Regime Engine — trend, cycle, vol state
  | "orderflow"      // Orderflow Engine — delta, CVD, absorption
  | "liquidity"      // Liquidity Mapper — book depth, thin zones
  | "volatility"     // Vol/Stress Engine — vol regime, jumps
  | "memory"         // Setup Memory — past patterns, win rates
  | "dna"            // Market DNA — symbol personality traits
  | "stress"         // Market Stress — cross-symbol correlation
  | "risk"           // Risk Gate — exposure, drawdown, kill switch
  | "super_intel"    // Super Intelligence — ensemble ML + gating
  | "macro"          // Macro Bias — DXY, rates, CPI
  | "sentiment"      // Sentiment — retail positioning, crowd
  | "mtf"            // Multi-Timeframe — directional bias
  | "ml_model"       // ML Model — logistic regression
  | "reasoning"      // Heuristic Reasoning — ICT rules
  | "position_sizer" // Position Sizer — Kelly sizing
  | "circuit_breaker" // Circuit Breaker — drawdown guard
  | "attribution"    // Attribution — gate effectiveness
  | "production_gate"; // Production Gate — final approval

/** Layer-level agent IDs (the 8 layers of intelligence) */
export type LayerAgentId =
  | "L1_perception"     // Layer 1: Market Perception — raw data intake
  | "L2_structure"      // Layer 2: Structural Understanding — patterns & regimes
  | "L3_context"        // Layer 3: Context Awareness — macro, sentiment, stress
  | "L4_memory"         // Layer 4: Memory & Recall — past patterns, DNA
  | "L5_intelligence"   // Layer 5: Intelligence & Decision — ML, sizing, risk
  | "L6_evolution"      // Layer 6: Learning & Evolution — feedback, adaptation
  | "L7_backtest"       // Layer 7: Walk-forward Backtesting Agent — quant metrics & rulebook
  | "L8_chartplot";     // Layer 8: Chart Plotting Agent — annotated setup snapshots

/** Any agent in the system */
export type AgentId = SubAgentId | LayerAgentId | "brain";

export type AgentStatus = "idle" | "running" | "done" | "error" | "stale";

// ── Agent Report ────────────────────────────────────────────────────────────

export interface AgentReport {
  /** Which agent produced this report */
  agentId: AgentId;
  /** Which layer this agent belongs to (if any) */
  layer?: LayerAgentId;
  /** Which symbol this report covers */
  symbol: string;
  /** Agent's current status */
  status: AgentStatus;
  /** 0-1 confidence in this report */
  confidence: number;
  /** 0-1 score — the agent's opinion on trade readiness */
  score: number;
  /** Human-readable one-line verdict */
  verdict: string;
  /** Full structured data from the agent (varies per agent type) */
  data: Record<string, unknown>;
  /** Warnings or flags the agent wants to raise */
  flags: AgentFlag[];
  /** Sub-agent reports (for layer agents that aggregate multiple engines) */
  subReports?: AgentReport[];
  /** When this report was computed */
  timestamp: number;
  /** How long the agent took (ms) */
  latencyMs: number;
}

export interface AgentFlag {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
}

// ── Brain Decision ──────────────────────────────────────────────────────────

export type BrainAction = "STRONG_LONG" | "STRONG_SHORT" | "WATCH_LONG" | "WATCH_SHORT" | "IDLE" | "BLOCKED";

export interface BrainDecision {
  /** Symbol this decision covers */
  symbol: string;
  /** The Brain's action decision */
  action: BrainAction;
  /** 0-1 overall confidence */
  confidence: number;
  /** 0-1 readiness score (composite of all agents) */
  readinessScore: number;
  /** 0-1 attention allocation */
  attentionScore: number;
  /** Human reasoning — WHY the brain decided this */
  reasoning: string;
  /** All agent reports that informed this decision */
  agentReports: AgentReport[];
  /** Risk gate status */
  riskGate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  /** If blocked, why */
  blockReason?: string;
  /** Cycle number (increments each brain cycle) */
  cycleId: number;
  /** When this decision was made */
  timestamp: number;
  /** Total cycle latency (ms) */
  cycleLatencyMs: number;
}

// ── Brain Cycle State ───────────────────────────────────────────────────────

export interface BrainCycleState {
  /** Current cycle number */
  cycleId: number;
  /** Is a cycle currently running? */
  running: boolean;
  /** Current status of each agent */
  agents: Map<AgentId, AgentReport>;
  /** Decisions made this cycle */
  decisions: Map<string, BrainDecision>;
  /** When this cycle started */
  startedAt: number;
  /** When this cycle finished */
  finishedAt?: number;
}

// ── Event Types ─────────────────────────────────────────────────────────────

export type BrainEventType =
  | "cycle:start"
  | "cycle:end"
  | "agent:start"
  | "agent:report"
  | "agent:error"
  | "brain:decision"
  | "brain:alert"
  | "backtest:complete"   // L7 finished a backtest run
  | "chart:snapshot";     // L8 generated a chart snapshot

export interface BrainEvent {
  type: BrainEventType;
  cycleId: number;
  symbol?: string;
  agentId?: AgentId;
  payload: AgentReport | BrainDecision | { message: string } | Record<string, unknown>;
  timestamp: number;
}

type BrainEventListener = (event: BrainEvent) => void;

// ── The Event Bus ───────────────────────────────────────────────────────────

class BrainEventBus {
  private listeners = new Map<BrainEventType | "*", Set<BrainEventListener>>();
  private eventLog: BrainEvent[] = [];
  private maxLog = 1000;
  private _cycleId = 0;
  private _cycleState: BrainCycleState | null = null;

  get cycleId() { return this._cycleId; }
  get cycleState() { return this._cycleState; }

  /** Start a new brain cycle for a set of symbols */
  startCycle(): number {
    this._cycleId++;
    this._cycleState = {
      cycleId: this._cycleId,
      running: true,
      agents: new Map(),
      decisions: new Map(),
      startedAt: Date.now(),
    };
    this.emit({
      type: "cycle:start",
      cycleId: this._cycleId,
      payload: { cycleId: this._cycleId },
      timestamp: Date.now(),
    });
    return this._cycleId;
  }

  /** End the current brain cycle */
  endCycle(): void {
    if (this._cycleState) {
      this._cycleState.running = false;
      this._cycleState.finishedAt = Date.now();
    }
    this.emit({
      type: "cycle:end",
      cycleId: this._cycleId,
      payload: {
        cycleId: this._cycleId,
        latencyMs: this._cycleState ? Date.now() - this._cycleState.startedAt : 0,
        agentCount: this._cycleState?.agents.size ?? 0,
        decisionCount: this._cycleState?.decisions.size ?? 0,
      },
      timestamp: Date.now(),
    });
  }

  /** Agent reports starting work */
  agentStart(agentId: AgentId, symbol: string): void {
    this.emit({
      type: "agent:start",
      cycleId: this._cycleId,
      agentId,
      symbol,
      payload: { agentId, symbol, status: "running" },
      timestamp: Date.now(),
    });
  }

  /** Agent publishes its report */
  agentReport(report: AgentReport): void {
    if (this._cycleState) {
      this._cycleState.agents.set(report.agentId, report);
    }
    this.emit({
      type: "agent:report",
      cycleId: this._cycleId,
      agentId: report.agentId,
      symbol: report.symbol,
      payload: report,
      timestamp: Date.now(),
    });
  }

  /** Agent encountered an error */
  agentError(agentId: AgentId, symbol: string, error: string): void {
    const errorReport: AgentReport = {
      agentId,
      symbol,
      status: "error",
      confidence: 0,
      score: 0,
      verdict: `Agent error: ${error}`,
      data: { error },
      flags: [{ level: "critical", code: "AGENT_ERROR", message: error }],
      timestamp: Date.now(),
      latencyMs: 0,
    };
    if (this._cycleState) {
      this._cycleState.agents.set(agentId, errorReport);
    }
    this.emit({
      type: "agent:error",
      cycleId: this._cycleId,
      agentId,
      symbol,
      payload: errorReport,
      timestamp: Date.now(),
    });
  }

  /** Brain publishes its decision */
  brainDecision(decision: BrainDecision): void {
    if (this._cycleState) {
      this._cycleState.decisions.set(decision.symbol, decision);
    }
    this.emit({
      type: "brain:decision",
      cycleId: this._cycleId,
      symbol: decision.symbol,
      agentId: "brain",
      payload: decision,
      timestamp: Date.now(),
    });
  }

  /** L7 publishes backtest completion */
  backtestComplete(symbol: string, payload: Record<string, unknown>): void {
    this.emit({
      type: "backtest:complete",
      cycleId: this._cycleId,
      symbol,
      agentId: "L7_backtest",
      payload,
      timestamp: Date.now(),
    });
  }

  /** L8 publishes chart snapshot generation */
  chartSnapshot(symbol: string, confirmationId: string, payload: Record<string, unknown>): void {
    this.emit({
      type: "chart:snapshot",
      cycleId: this._cycleId,
      symbol,
      agentId: "L8_chartplot",
      payload: { confirmationId, ...payload },
      timestamp: Date.now(),
    });
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  on(type: BrainEventType | "*", listener: BrainEventListener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => { this.listeners.get(type)?.delete(listener); };
  }

  off(type: BrainEventType | "*", listener: BrainEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Get recent events (for debugging / UI) */
  getRecentEvents(limit = 50): BrainEvent[] {
    return this.eventLog.slice(-limit);
  }

  /** Get all agent reports for the current cycle */
  getCurrentAgentReports(): AgentReport[] {
    if (!this._cycleState) return [];
    return Array.from(this._cycleState.agents.values());
  }

  /** Get all decisions for the current cycle */
  getCurrentDecisions(): BrainDecision[] {
    if (!this._cycleState) return [];
    return Array.from(this._cycleState.decisions.values());
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private emit(event: BrainEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLog) {
      this.eventLog = this.eventLog.slice(-this.maxLog);
    }
    this.listeners.get(event.type)?.forEach((fn) => {
      try { fn(event); } catch (e) { console.error("[BrainEventBus] listener error:", e); }
    });
    this.listeners.get("*")?.forEach((fn) => {
      try { fn(event); } catch (e) { console.error("[BrainEventBus] wildcard listener error:", e); }
    });
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────
export const brainEventBus = new BrainEventBus();
