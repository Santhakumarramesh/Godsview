/**
 * Phase 103 — Multi-Agent System: in-process event bus
 * =====================================================
 * Lightweight pub/sub used by the explicit agents
 * (signal, validation, risk, execution, learning, governance).
 * Decoupled from the existing brain_event_bus so it can run as
 * a clean orchestration layer dedicated to the agent lifecycle.
 */

export type AgentEventType =
  | "signal.new"
  | "signal.validated"
  | "signal.rejected"
  | "risk.approved"
  | "risk.reduced"
  | "risk.blocked"
  | "execution.requested"
  | "execution.fill"
  | "execution.failed"
  | "learning.update"
  | "governance.veto"
  | "governance.audit";

export interface AgentEvent<T = unknown> {
  type: AgentEventType;
  ts: number;
  source: string;
  decision_id: string;
  payload: T;
}

export type AgentHandler = (evt: AgentEvent) => void | Promise<void>;

export interface AgentLogEntry {
  ts: number;
  source: string;
  type: AgentEventType;
  decision_id: string;
  message: string;
  payload?: unknown;
}

export class AgentBus {
  private subs = new Map<AgentEventType, Set<AgentHandler>>();
  private log: AgentLogEntry[] = [];
  private readonly maxLog = 5000;

  on(type: AgentEventType, handler: AgentHandler): () => void {
    let s = this.subs.get(type);
    if (!s) {
      s = new Set();
      this.subs.set(type, s);
    }
    s.add(handler);
    return () => s!.delete(handler);
  }

  async emit(evt: AgentEvent): Promise<void> {
    this.record({
      ts: evt.ts,
      source: evt.source,
      type: evt.type,
      decision_id: evt.decision_id,
      message: `${evt.type} from ${evt.source}`,
      payload: evt.payload,
    });
    const handlers = this.subs.get(evt.type);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        await h(evt);
      } catch (err) {
        this.record({
          ts: Date.now(),
          source: "agent_bus",
          type: "governance.audit",
          decision_id: evt.decision_id,
          message: `handler_error:${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  trace(decision_id: string): AgentLogEntry[] {
    return this.log.filter((l) => l.decision_id === decision_id);
  }

  recent(limit = 100): AgentLogEntry[] {
    return this.log.slice(-limit);
  }

  reset(): void {
    this.log = [];
  }

  private record(entry: AgentLogEntry) {
    this.log.push(entry);
    if (this.log.length > this.maxLog) {
      this.log.splice(0, this.log.length - this.maxLog);
    }
  }
}

let SINGLETON: AgentBus | undefined;
export function getAgentBus(): AgentBus {
  if (!SINGLETON) SINGLETON = new AgentBus();
  return SINGLETON;
}
