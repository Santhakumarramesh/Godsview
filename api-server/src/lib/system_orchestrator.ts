/**
 * Phase 58 — System Orchestrator
 * Central coordinator for all GodsView engines.
 * Manages engine lifecycle, health aggregation, and cross-engine communication.
 */

export type EngineState = "stopped" | "starting" | "running" | "degraded" | "error" | "stopping";

export interface EngineRegistration {
  id: string;
  name: string;
  version: string;
  state: EngineState;
  startedAt?: string;
  lastHeartbeat?: string;
  errorCount: number;
  lastError?: string;
  dependencies: string[];
  metadata: Record<string, any>;
}

export interface OrchestratorEvent {
  id: string;
  timestamp: string;
  type: "engine_registered" | "state_change" | "heartbeat" | "error" | "command";
  engineId: string;
  detail: string;
}

export interface SystemHealthSummary {
  overall: "healthy" | "degraded" | "critical" | "offline";
  enginesTotal: number;
  enginesRunning: number;
  enginesDegraded: number;
  enginesError: number;
  enginesStopped: number;
  uptimeMs: number;
  lastHealthCheck: string;
}

export interface OrchestratorSnapshot {
  health: SystemHealthSummary;
  engines: EngineRegistration[];
  recentEvents: OrchestratorEvent[];
  commandsExecuted: number;
}

/* ── state ── */
const engines = new Map<string, EngineRegistration>();
const events: OrchestratorEvent[] = [];
let commandCount = 0;
let nextEventId = 1;
const startTime = Date.now();

function emitEvent(type: OrchestratorEvent["type"], engineId: string, detail: string): OrchestratorEvent {
  const evt: OrchestratorEvent = {
    id: `evt_${nextEventId++}`,
    timestamp: new Date().toISOString(),
    type,
    engineId,
    detail,
  };
  events.push(evt);
  if (events.length > 500) events.splice(0, events.length - 500);
  return evt;
}

/* ── engine lifecycle ── */

export function registerEngine(params: {
  id: string;
  name: string;
  version?: string;
  dependencies?: string[];
  metadata?: Record<string, any>;
}): EngineRegistration {
  if (engines.has(params.id)) {
    const existing = engines.get(params.id)!;
    existing.lastHeartbeat = new Date().toISOString();
    emitEvent("heartbeat", params.id, "Re-registered (heartbeat)");
    return existing;
  }
  const reg: EngineRegistration = {
    id: params.id,
    name: params.name,
    version: params.version ?? "1.0.0",
    state: "stopped",
    errorCount: 0,
    dependencies: params.dependencies ?? [],
    metadata: params.metadata ?? {},
  };
  engines.set(params.id, reg);
  emitEvent("engine_registered", params.id, `Registered: ${params.name}`);
  return reg;
}

export function setEngineState(engineId: string, state: EngineState, error?: string): EngineRegistration {
  const eng = engines.get(engineId);
  if (!eng) throw new Error(`Engine ${engineId} not registered`);
  const prev = eng.state;
  eng.state = state;
  eng.lastHeartbeat = new Date().toISOString();
  if (state === "running" && !eng.startedAt) eng.startedAt = eng.lastHeartbeat;
  if (state === "error" && error) {
    eng.errorCount++;
    eng.lastError = error;
    emitEvent("error", engineId, error);
  }
  emitEvent("state_change", engineId, `${prev} → ${state}`);
  return eng;
}

export function heartbeat(engineId: string): EngineRegistration {
  const eng = engines.get(engineId);
  if (!eng) throw new Error(`Engine ${engineId} not registered`);
  eng.lastHeartbeat = new Date().toISOString();
  emitEvent("heartbeat", engineId, "heartbeat");
  return eng;
}

export function executeCommand(engineId: string, command: string): { ok: boolean; detail: string } {
  const eng = engines.get(engineId);
  if (!eng) throw new Error(`Engine ${engineId} not registered`);
  commandCount++;
  emitEvent("command", engineId, command);
  return { ok: true, detail: `Command '${command}' sent to ${eng.name}` };
}

export function getEngine(engineId: string): EngineRegistration | undefined {
  return engines.get(engineId);
}

export function listEngines(): EngineRegistration[] {
  return [...engines.values()];
}

/* ── health aggregation ── */

export function getSystemHealth(): SystemHealthSummary {
  const all = [...engines.values()];
  const running = all.filter((e) => e.state === "running").length;
  const degraded = all.filter((e) => e.state === "degraded").length;
  const errored = all.filter((e) => e.state === "error").length;
  const stopped = all.filter((e) => e.state === "stopped" || e.state === "stopping").length;

  let overall: SystemHealthSummary["overall"] = "healthy";
  if (all.length === 0) overall = "offline";
  else if (errored > 0) overall = "critical";
  else if (degraded > 0) overall = "degraded";
  else if (running === 0) overall = "offline";

  return {
    overall,
    enginesTotal: all.length,
    enginesRunning: running,
    enginesDegraded: degraded,
    enginesError: errored,
    enginesStopped: stopped,
    uptimeMs: Date.now() - startTime,
    lastHealthCheck: new Date().toISOString(),
  };
}

export function getOrchestratorSnapshot(): OrchestratorSnapshot {
  return {
    health: getSystemHealth(),
    engines: listEngines(),
    recentEvents: events.slice(-50),
    commandsExecuted: commandCount,
  };
}

export function resetOrchestrator(): void {
  engines.clear();
  events.length = 0;
  commandCount = 0;
  nextEventId = 1;
}
