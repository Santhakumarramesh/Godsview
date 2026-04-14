/**
 * Phase 103 — Multi-Agent System: explicit agents
 * ===============================================
 * Six agents wired through AgentBus form a deterministic decision pipeline:
 *   SignalAgent → ValidationAgent → RiskAgent → ExecutionAgent
 *                                  ↘ LearningAgent
 *                                  ↘ GovernanceAgent
 *
 * Each agent is small, pure-ish, and emits typed events so per-decision
 * traces can be reconstructed for explainability and audits.
 */

import { AgentBus, AgentEvent, getAgentBus } from "./agent_bus.js";
import { RecallStore, getRecallStore } from "../recall_engine/recall_store.js";

export interface RawSignal {
  decision_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  reference_price: number;
  setup_type?: string;
  trend?: "bullish" | "bearish" | "neutral";
  rr?: number;
  confidence?: number;
  source?: string;
  tags?: string[];
}

export interface ValidatedSignal extends RawSignal {
  validation_score: number;
  validation_notes: string[];
  recall_match?: { matches: number; win_rate: number };
}

export interface RiskDecision extends ValidatedSignal {
  risk_state: "approve" | "reduce" | "block";
  size_multiplier: number;
  risk_reasons: string[];
  final_qty: number;
}

export interface ExecutionPlan extends RiskDecision {
  client_order_id: string;
  approved_at: number;
}

export interface AgentPipelineResult {
  decision_id: string;
  trace: ReturnType<AgentBus["trace"]>;
  plan?: ExecutionPlan;
  final_state: "executed" | "blocked" | "rejected";
  reason?: string;
}

export interface AgentDeps {
  bus?: AgentBus;
  recall?: RecallStore;
  /** Hook used by ExecutionAgent. Default returns synthetic ack. */
  submitOrder?: (plan: ExecutionPlan) => Promise<{
    accepted: boolean;
    broker_order_id?: string;
    reason?: string;
  }>;
  /** Hook used by GovernanceAgent for hard vetos. */
  governance?: (plan: RiskDecision) => { veto: boolean; reason?: string };
  /** Hook for LearningAgent — receives final outcome. */
  learn?: (result: AgentPipelineResult) => void;
}

export class SignalAgent {
  constructor(private bus: AgentBus = getAgentBus()) {}
  async ingest(raw: RawSignal): Promise<void> {
    const evt: AgentEvent<RawSignal> = {
      type: "signal.new",
      ts: Date.now(),
      source: "signal_agent",
      decision_id: raw.decision_id,
      payload: raw,
    };
    await this.bus.emit(evt);
  }
}

export class ValidationAgent {
  constructor(
    private bus: AgentBus = getAgentBus(),
    private recall: RecallStore = getRecallStore(),
  ) {
    this.bus.on("signal.new", (e) => this.handle(e as AgentEvent<RawSignal>));
  }
  private async handle(evt: AgentEvent<RawSignal>): Promise<void> {
    const raw = evt.payload;
    const notes: string[] = [];
    let score = (raw.confidence ?? 0.5) * 100;

    if (!raw.symbol || raw.qty <= 0) {
      notes.push("invalid_input");
      await this.bus.emit({
        type: "signal.rejected",
        ts: Date.now(),
        source: "validation_agent",
        decision_id: raw.decision_id,
        payload: { reason: "invalid_input" },
      });
      return;
    }

    const summary = this.recall.summarize({
      symbol: raw.symbol,
      setup_type: raw.setup_type,
      trend: raw.trend,
      rr: raw.rr,
      confidence: raw.confidence,
      tags: raw.tags,
    });
    if (summary.matches >= 5) {
      score *= summary.win_rate < 0.3 ? 0.6 : summary.win_rate > 0.6 ? 1.2 : 1;
      notes.push(
        `recall:${summary.matches} matches @ ${(summary.win_rate * 100).toFixed(0)}% wr`,
      );
    } else {
      notes.push("recall:insufficient_history");
    }

    const validated: ValidatedSignal = {
      ...raw,
      validation_score: Math.max(0, Math.min(100, score)),
      validation_notes: notes,
      recall_match:
        summary.matches > 0
          ? { matches: summary.matches, win_rate: summary.win_rate }
          : undefined,
    };
    await this.bus.emit({
      type: "signal.validated",
      ts: Date.now(),
      source: "validation_agent",
      decision_id: raw.decision_id,
      payload: validated,
    });
  }
}

export class RiskAgent {
  constructor(private bus: AgentBus = getAgentBus()) {
    this.bus.on("signal.validated", (e) =>
      this.handle(e as AgentEvent<ValidatedSignal>),
    );
  }
  private async handle(evt: AgentEvent<ValidatedSignal>): Promise<void> {
    const v = evt.payload;
    const reasons: string[] = [];
    let mult = 1;
    let state: RiskDecision["risk_state"] = "approve";

    if (v.validation_score < 40) {
      state = "block";
      reasons.push("low_confidence");
      mult = 0;
    } else if (v.validation_score < 60) {
      state = "reduce";
      reasons.push("medium_confidence");
      mult = 0.5;
    }
    if (v.rr !== undefined && v.rr < 1.2) {
      state = state === "approve" ? "reduce" : state;
      mult = Math.min(mult, 0.5);
      reasons.push("low_rr");
    }

    const decision: RiskDecision = {
      ...v,
      risk_state: state,
      size_multiplier: mult,
      risk_reasons: reasons,
      final_qty: state === "block" ? 0 : Math.max(1, Math.floor(v.qty * mult)),
    };
    const out: AgentEvent<RiskDecision>["type"] =
      state === "block" ? "risk.blocked" : state === "reduce" ? "risk.reduced" : "risk.approved";
    await this.bus.emit({
      type: out,
      ts: Date.now(),
      source: "risk_agent",
      decision_id: v.decision_id,
      payload: decision,
    });
  }
}

export class GovernanceAgent {
  private veto: NonNullable<AgentDeps["governance"]>;
  constructor(
    private bus: AgentBus = getAgentBus(),
    veto?: AgentDeps["governance"],
  ) {
    this.veto = veto ?? (() => ({ veto: false }));
    this.bus.on("risk.approved", (e) =>
      this.handle(e as AgentEvent<RiskDecision>),
    );
    this.bus.on("risk.reduced", (e) =>
      this.handle(e as AgentEvent<RiskDecision>),
    );
  }
  private async handle(evt: AgentEvent<RiskDecision>): Promise<void> {
    const v = this.veto(evt.payload);
    if (v.veto) {
      await this.bus.emit({
        type: "governance.veto",
        ts: Date.now(),
        source: "governance_agent",
        decision_id: evt.decision_id,
        payload: { reason: v.reason ?? "policy_veto", decision: evt.payload },
      });
      return;
    }
    await this.bus.emit({
      type: "execution.requested",
      ts: Date.now(),
      source: "governance_agent",
      decision_id: evt.decision_id,
      payload: evt.payload,
    });
  }
}

export class ExecutionAgent {
  private submit: NonNullable<AgentDeps["submitOrder"]>;
  constructor(
    private bus: AgentBus = getAgentBus(),
    submitOrder?: AgentDeps["submitOrder"],
  ) {
    this.submit =
      submitOrder ??
      (async (p) => ({
        accepted: true,
        broker_order_id: `paper-${p.client_order_id}`,
      }));
    this.bus.on("execution.requested", (e) =>
      this.handle(e as AgentEvent<RiskDecision>),
    );
  }
  private async handle(evt: AgentEvent<RiskDecision>): Promise<void> {
    const r = evt.payload;
    if (r.final_qty <= 0) return;
    const plan: ExecutionPlan = {
      ...r,
      client_order_id: `cid-${r.decision_id}`,
      approved_at: Date.now(),
    };
    const ack = await this.submit(plan);
    await this.bus.emit({
      type: ack.accepted ? "execution.fill" : "execution.failed",
      ts: Date.now(),
      source: "execution_agent",
      decision_id: r.decision_id,
      payload: { plan, ack },
    });
  }
}

export class LearningAgent {
  private callback: NonNullable<AgentDeps["learn"]>;
  constructor(
    private bus: AgentBus = getAgentBus(),
    learn?: AgentDeps["learn"],
  ) {
    this.callback = learn ?? (() => undefined);
    this.bus.on("execution.fill", (e) => this.consume(e));
    this.bus.on("execution.failed", (e) => this.consume(e));
    this.bus.on("risk.blocked", (e) => this.consume(e));
    this.bus.on("governance.veto", (e) => this.consume(e));
    this.bus.on("signal.rejected", (e) => this.consume(e));
  }
  private consume(evt: AgentEvent): void {
    this.callback({
      decision_id: evt.decision_id,
      trace: this.bus.trace(evt.decision_id),
      final_state:
        evt.type === "execution.fill"
          ? "executed"
          : evt.type === "execution.failed"
            ? "blocked"
            : evt.type === "governance.veto"
              ? "blocked"
              : "rejected",
      reason: evt.type,
    });
  }
}

/** Convenience: wire all six agents and return the bus + traces helper. */
export function bootstrapAgentSystem(deps: AgentDeps = {}): {
  bus: AgentBus;
  signal: SignalAgent;
  validation: ValidationAgent;
  risk: RiskAgent;
  governance: GovernanceAgent;
  execution: ExecutionAgent;
  learning: LearningAgent;
} {
  const bus = deps.bus ?? getAgentBus();
  const recall = deps.recall ?? getRecallStore();
  return {
    bus,
    signal: new SignalAgent(bus),
    validation: new ValidationAgent(bus, recall),
    risk: new RiskAgent(bus),
    governance: new GovernanceAgent(bus, deps.governance),
    execution: new ExecutionAgent(bus, deps.submitOrder),
    learning: new LearningAgent(bus, deps.learn),
  };
}
