/**
 * BrainCycleProvider — Live Agent Intelligence Stream
 *
 * This React context connects to the brain cycle SSE stream and provides:
 *   - Live agent status (which agents are running, done, errored)
 *   - Real-time decisions as they flow in
 *   - Cycle lifecycle events (start, end)
 *   - A trigger function to kick off a new brain cycle
 *
 * Usage:
 *   <BrainCycleProvider>
 *     <BrainPage />
 *   </BrainCycleProvider>
 *
 *   // In any child component:
 *   const { agents, decisions, isRunning, triggerCycle } = useBrainCycleContext();
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import type { AgentReportDTO, BrainDecisionDTO, BrainSSEEvent, BrainCycleResponse } from "./api";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentLiveStatus {
  agentId: string;
  symbol: string;
  status: "idle" | "running" | "done" | "error";
  report?: AgentReportDTO;
  startedAt?: number;
  finishedAt?: number;
}

export interface BrainCycleState {
  /** Current cycle ID (0 = no cycle yet) */
  cycleId: number;
  /** Is a cycle currently running? */
  isRunning: boolean;
  /** SSE connection status */
  connected: boolean;
  /** Live agent statuses — key is `${agentId}:${symbol}` */
  agents: Map<string, AgentLiveStatus>;
  /** Decisions received this cycle */
  decisions: BrainDecisionDTO[];
  /** Raw event log (most recent first) */
  events: BrainSSEEvent[];
  /** Cycle start time */
  cycleStartedAt: number | null;
  /** Cycle end time */
  cycleFinishedAt: number | null;
  /** Total cycle latency */
  cycleLatencyMs: number | null;
  /** Trigger a brain cycle for symbols */
  triggerCycle: (symbols: string[]) => Promise<BrainCycleResponse | null>;
  /** Trigger a single-symbol cycle */
  triggerSingle: (symbol: string) => Promise<BrainDecisionDTO | null>;
  /** Error message if cycle failed */
  error: string | null;
}

const defaultState: BrainCycleState = {
  cycleId: 0,
  isRunning: false,
  connected: false,
  agents: new Map(),
  decisions: [],
  events: [],
  cycleStartedAt: null,
  cycleFinishedAt: null,
  cycleLatencyMs: null,
  triggerCycle: async () => null,
  triggerSingle: async () => null,
  error: null,
};

const BrainCycleContext = createContext<BrainCycleState>(defaultState);

export function useBrainCycleContext() {
  return useContext(BrainCycleContext);
}

// ── Provider ───────────────────────────────────────────────────────────────

const MAX_EVENTS = 200;

export function BrainCycleProvider({ children }: { children: ReactNode }) {
  const [cycleId, setCycleId] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Map<string, AgentLiveStatus>>(new Map());
  const [decisions, setDecisions] = useState<BrainDecisionDTO[]>([]);
  const [events, setEvents] = useState<BrainSSEEvent[]>([]);
  const [cycleStartedAt, setCycleStartedAt] = useState<number | null>(null);
  const [cycleFinishedAt, setCycleFinishedAt] = useState<number | null>(null);
  const [cycleLatencyMs, setCycleLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SSE Connection ─────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;

      try {
        const es = new EventSource(`${API_BASE}/brain/cycle/stream`);
        esRef.current = es;

        es.addEventListener("connected", () => {
          if (!cancelled) setConnected(true);
        });

        es.addEventListener("cycle_start", (e) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(e.data) as BrainSSEEvent;
            setCycleId(data.cycleId);
            setIsRunning(true);
            setCycleStartedAt(data.timestamp);
            setCycleFinishedAt(null);
            setCycleLatencyMs(null);
            setAgents(new Map());
            setDecisions([]);
            setError(null);
            pushEvent(data);
          } catch { /* ignore */ }
        });

        es.addEventListener("cycle_end", (e) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(e.data) as BrainSSEEvent;
            setIsRunning(false);
            setCycleFinishedAt(data.timestamp);
            setCycleLatencyMs((data.payload as any)?.latencyMs ?? null);
            pushEvent(data);
          } catch { /* ignore */ }
        });

        es.addEventListener("agent_start", (e) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(e.data) as BrainSSEEvent;
            const key = `${data.agentId}:${data.symbol}`;
            setAgents((prev) => {
              const next = new Map(prev);
              next.set(key, {
                agentId: data.agentId!,
                symbol: data.symbol!,
                status: "running",
                startedAt: data.timestamp,
              });
              return next;
            });
            pushEvent(data);
          } catch { /* ignore */ }
        });

        es.addEventListener("agent_report", (e) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(e.data) as BrainSSEEvent;
            const report = data.payload as AgentReportDTO;
            const key = `${data.agentId}:${data.symbol}`;
            setAgents((prev) => {
              const next = new Map(prev);
              next.set(key, {
                agentId: data.agentId!,
                symbol: data.symbol!,
                status: "done",
                report,
                startedAt: prev.get(key)?.startedAt,
                finishedAt: data.timestamp,
              });
              return next;
            });
            pushEvent(data);
          } catch { /* ignore */ }
        });

        es.addEventListener("agent_error", (e) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(e.data) as BrainSSEEvent;
            const key = `${data.agentId}:${data.symbol}`;
            setAgents((prev) => {
              const next = new Map(prev);
              next.set(key, {
                agentId: data.agentId!,
                symbol: data.symbol!,
                status: "error",
                startedAt: prev.get(key)?.startedAt,
                finishedAt: data.timestamp,
              });
              return next;
            });
            pushEvent(data);
          } catch { /* ignore */ }
        });

        es.addEventListener("brain_decision", (e) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(e.data) as BrainSSEEvent;
            const decision = data.payload as BrainDecisionDTO;
            setDecisions((prev) => [...prev, decision]);
            pushEvent(data);
          } catch { /* ignore */ }
        });

        es.onerror = () => {
          if (cancelled) return;
          setConnected(false);
          es.close();
          esRef.current = null;
          reconnectTimer.current = setTimeout(connect, 5000);
        };
      } catch {
        if (!cancelled) reconnectTimer.current = setTimeout(connect, 5000);
      }
    }

    function pushEvent(data: BrainSSEEvent) {
      setEvents((prev) => [data, ...prev].slice(0, MAX_EVENTS));
    }

    connect();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  // ── Trigger Functions ──────────────────────────────────────────────────

  const triggerCycle = useCallback(async (symbols: string[]): Promise<BrainCycleResponse | null> => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/brain/cycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Brain cycle failed: ${res.status} ${body}`);
      }
      return await res.json() as BrainCycleResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, []);

  const triggerSingle = useCallback(async (symbol: string): Promise<BrainDecisionDTO | null> => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/brain/cycle/single`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Single brain cycle failed: ${res.status} ${body}`);
      }
      const data = await res.json();
      return data.decision as BrainDecisionDTO;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, []);

  // ── Context Value ──────────────────────────────────────────────────────

  const value: BrainCycleState = {
    cycleId,
    isRunning,
    connected,
    agents,
    decisions,
    events,
    cycleStartedAt,
    cycleFinishedAt,
    cycleLatencyMs,
    triggerCycle,
    triggerSingle,
    error,
  };

  return (
    <BrainCycleContext.Provider value={value}>
      {children}
    </BrainCycleContext.Provider>
  );
}
